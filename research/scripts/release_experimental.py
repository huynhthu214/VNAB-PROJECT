"""Package verified experimental QA while preserving the published pilot split."""
import argparse
from collections import Counter, defaultdict
import io
import json
from pathlib import Path
import random
from zipfile import ZipFile

from build_pilot import PILOT, content_hash, passages
from group_relations import GROUPS, RAW, folded, read_csv, read_jsonl, snapshot
from inventory_sources import ROOT, csv_bytes, digest, norm, publish
from pilot_handoff import project
from prepare_dataset import archive, handoff, preview_leakage, require_reservation, split_blocks, stats
from validate_pilot import validate

BATCH = ROOT / "research/data/candidates/v1"
ISSUES = ROOT / "research/reports/data_issues_release_v1.csv"
UNAFFECTED = {"Phường Thới Hòa": "Thành phố Bến Cát", "Xã Long Sơn": "Thành phố Vũng Tàu",
              "Xã Hòa Hiệp": "Huyện Xuyên Mộc", "Xã Bình Châu": "Huyện Xuyên Mộc",
              "Xã Thạnh An": "Huyện Cần Giờ"}


def label_issues(rows):
    doc = next(d for d in read_csv(RAW / "legal_documents.csv") if d["doc_code"] == "1685/NQ-UBTVQH15")
    context = next(text for article, clause, _, text in passages(doc["full_text"]) if (article, clause) == (1, 164))
    if "không thực hiện sắp xếp" not in norm(context) or not all(
            name.split(" ", 1)[1].casefold() in norm(context) for name in UNAFFECTED):
        raise ValueError("Cannot establish legal basis for unchanged units")
    results = []
    for name, district in UNAFFECTED.items():
        matches = [r for r in rows if r["source_doc"] == doc["doc_code"] and
                   all(norm(r[k]) == norm(name) for k in ("old_unit_name", "new_unit_name")) and
                   norm(r["old_district"]) == norm(district)]
        if len(matches) != 1 or matches[0]["merge_type"] != "toan_bo":
            raise ValueError("Cannot uniquely locate the five toan_bo mappings in snapshot v1.0")
        row = matches[0]
        results.append({k: row[k] for k in ("mapping_id", "source_file", "source_sheet", "source_row",
                                           "old_unit_name", "old_district", "merge_type_raw", "merge_type")}
                       | {"issue": "unchanged_unit_labeled_toan_bo", "source_doc": doc["doc_code"],
                          "article_clause": "Điều 1, khoản 164", "derived_merge_type_proposal": "khong_sap_xep",
                          "disposition": "quarantined", "provenance_sha256": doc["sha256"]})
    return results


def merge_verified(sources, excluded):
    unique, question, meaning = {}, {}, {}
    summary = Counter()
    for sample in [q for rows in sources for q in rows if q["review_status"] == "verified"]:
        if set(sample["mapping_ids"]) & excluded:
            summary["quarantined_verified"] += 1
            continue
        sid = sample["id"]
        if sid in unique:
            if content_hash(unique[sid]) != content_hash(sample):
                raise ValueError("Conflicting content for the same reviewed ID")
            summary["duplicate_id"] += 1
            continue
        qkey = folded(sample["question"])
        targets = sample["type"], sample["action"], tuple(sorted(sample["mapping_ids"])), folded(sample["answer_text"])
        if qkey in question:
            if question[qkey] != targets:
                raise ValueError("Conflicting reviewed answers for the same normalized question")
            summary["duplicate_question"] += 1
            continue
        # Distinct intents (for example forward versus reverse) remain separate.
        key = targets, folded(sample["context"])
        if key in meaning:
            summary["duplicate_mapping_answer_evidence"] += 1
            continue
        unique[sid] = sample
        question[qkey] = targets
        meaning[key] = sid
    return list(unique.values()), summary


def pinned_split(qa, pilot_manifest, seed):
    by_id = {q["id"]: q for q in qa}
    pins = {}
    for row in pilot_manifest:
        sample = by_id[row["id"]]
        if sample["group_id"] != row["group_id"] or content_hash(sample) != row["content_sha256"]:
            raise ValueError("Pilot manifest content or group changed")
        if row["id"] in pins or row["split"] not in {"train", "dev"}:
            raise ValueError("Invalid pilot pins")
        pins[row["id"]] = row["split"]
    if Counter(pins.values()) != {"train": 16, "dev": 4}:
        raise ValueError("Expected the published 16/4 pilot split")
    allocated, remaining = {"train": [], "dev": []}, []
    for block in split_blocks(qa):
        fixed = {pins[q["id"]] for q in block if q["id"] in pins}
        if len(fixed) > 1:
            raise ValueError("A connected component bridges opposite pilot splits")
        if fixed:
            allocated[fixed.pop()].extend(block)
        else:
            remaining.append(block)
    pinned_rows = {name: len(rows) for name, rows in allocated.items()}
    remaining.sort(key=lambda block: min(q["id"] for q in block))
    random.Random(seed).shuffle(remaining)
    target = round(len(qa) * 0.2)
    for block in remaining:
        dev_gap = target - len(allocated["dev"])
        split = "dev" if abs(dev_gap - len(block)) < abs(dev_gap) else "train"
        allocated[split].extend(block)
    for split, samples in allocated.items():
        if not any(q["answer_start"] is not None for q in samples):
            raise ValueError("MRC split is empty")
        if any(pins[q["id"]] != split for q in samples if q["id"] in pins):
            raise ValueError("Pilot split moved")
    return allocated["train"], allocated["dev"], pinned_rows


def details(items):
    result = {}
    for name, samples in (("qa", items), ("mrc", [q for q in items if q["answer_start"] is not None])):
        result[name] = {"rows": len(samples)}
        for column in ("province", "type", "context_origin", "group_id"):
            result[name][column] = dict(sorted(Counter(q[column] for q in samples).items()))
    return result


def check_archive(blob, train, dev, reservation):
    expected = {"qa_train.jsonl", "qa_dev.jsonl", "mrc_train.jsonl", "mrc_dev.jsonl", "qa.schema.json",
                "mrc.schema.json", "split_manifest.csv", "validation_report.json", "dataset_statistics.json",
                "data_card.md", "README.md", "CHANGELOG.md", "checksums.sha256"}
    with ZipFile(io.BytesIO(blob)) as zip_file:
        if set(zip_file.namelist()) != expected or zip_file.testzip() is not None:
            raise ValueError("Invalid release archive contents")
        for line in zip_file.read("checksums.sha256").decode().splitlines():
            sha, name = line.split("  ")
            if digest(zip_file.read(name)) != sha:
                raise ValueError("Archive member checksum mismatch")
        for split, items in (("train", train), ("dev", dev)):
            qa_rows = [json.loads(line) for line in zip_file.read(f"qa_{split}.jsonl").splitlines()]
            mrc_rows = [json.loads(line) for line in zip_file.read(f"mrc_{split}.jsonl").splitlines()]
            if qa_rows != items:
                raise ValueError("Archive QA differs from split")
            validate(qa_rows, mrc_rows, reservation, metadata=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reservation", type=Path, required=True)
    parser.add_argument("--pilot-dir", type=Path, default=ROOT / "research/handoff/pilot-v1.1")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "research/handoff/v1.0")
    parser.add_argument("--seed", type=int, default=20261127)
    args = parser.parse_args()
    if not args.output_dir.resolve().is_relative_to(ROOT / "research"):
        parser.error("Use an output directory in research/")
    raw, source = snapshot()
    fingerprint = source["source_fingerprint_sha256"]
    require_reservation(args.reservation, fingerprint, read_jsonl(GROUPS / "relation_groups.jsonl"))
    issues = label_issues(raw)
    exclusions = {row["mapping_id"] for row in issues}
    pilot_train, pilot_dev = (read_jsonl(args.pilot_dir / f"qa_{split}.jsonl") for split in ("train", "dev"))
    pilot = pilot_train + pilot_dev
    old = read_jsonl(PILOT / "approved_v1/qa_sample.jsonl")
    revised = read_jsonl(PILOT / "v1.1/qa_pending_six_reviewed.jsonl")
    batch = read_jsonl(BATCH / "qa_reviewed.jsonl")
    for source_rows in (pilot, old, revised, batch):
        validate(source_rows, project(source_rows), args.reservation, metadata=True)
    verified_batch = {q["id"]: q for q in batch if q["review_status"] == "verified"}
    shared_p0 = set(verified_batch) & {q["id"] for q in pilot}
    if len(shared_p0) != 3:
        raise ValueError("Expected exactly three shared batch P0 pilot IDs")
    rank_by_id = {r["id"]: int(r["review_rank"]) for r in read_csv(BATCH / "dataset_review.csv")}
    rejects = [q for q in batch if q["review_status"] == "rejected"]
    revises = [q for q in batch if q.get("review", {}).get("decision") == "revise"]
    if ({rank_by_id[q["id"]] for q in rejects} != {2, 3, 4, 6, 7, 9, 11, 51, 67, 72}
            or {rank_by_id[q["id"]] for q in revises} != {235, 239}
            or any(not set(q["mapping_ids"]) <= exclusions for q in revises)):
        raise ValueError("Review exclusions differ from Vi's confirmed decisions")
    verified_pilot = {tuple(q["mapping_ids"]): q for q in pilot}
    for q in rejects:
        original = verified_pilot[tuple(q["mapping_ids"])]
        if any(q[k] != original[k] for k in ("context", "answer_text", "answer_start", "article_clause")):
            raise ValueError("Rejected duplicate differs from verified pilot evidence or answer")
    qa, dedup = merge_verified((pilot, old, revised, batch), exclusions)
    validate(qa, project(qa), args.reservation, metadata=True)
    train, dev, pinned_rows = pinned_split(qa, read_csv(args.pilot_dir / "split_manifest.csv"), args.seed)
    audit = preview_leakage(qa, train, dev)
    audit.update({f"{field}_overlap": len({x for q in train for x in q[field]} &
                                         {x for q in dev for x in q[field]})
                  for field in ("old_unit_ids", "new_unit_ids", "mapping_ids")})
    audit["group_overlap"] = len({gid for q in train for gid in q["provenance"]["related_group_ids"]} &
                                 {gid for q in dev for gid in q["provenance"]["related_group_ids"]})
    if any(audit[k] for k in ("group_overlap", "old_unit_ids_overlap", "new_unit_ids_overlap", "mapping_ids_overlap")):
        raise ValueError("Split dependencies overlap")
    for samples in (train, dev):
        validate(samples, project(samples), args.reservation, metadata=True)
    files = handoff(train, dev, "v1.0", fingerprint, args.seed)
    for name in ("checksums.sha256", "data_card.json", "statistics.json", "validation.log"):
        del files[name]
    statistics = {"train": details(train), "dev": details(dev)}
    report = {"status": "PASS", "source_fingerprint_sha256": fingerprint, "seed": args.seed,
              "counts": {"qa": len(qa), "mrc": len(project(qa)), "qa_train": len(train), "qa_dev": len(dev),
                         "mrc_train": len(project(train)), "mrc_dev": len(project(dev))},
              "pilot_split_preserved": {"train": len(pilot_train), "dev": len(pilot_dev)},
              "linked_rows_in_pilot_blocks": pinned_rows, "split_checks": audit,
              "deduplication": dict(dedup), "shared_p0_once": len(shared_p0),
              "reviewed_batch": dict(Counter(q["review_status"] for q in batch)),
              "quarantined_source_mappings": len(issues), "tokenizer_training": "NOT RUN"}
    for name, data in (("validation_report.json", report), ("dataset_statistics.json", statistics)):
        files[name] = (json.dumps(data, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    files["data_card.md"] = (
        "# Dataset địa giới VNAB v1.0\n\n"
        "Nguồn là snapshot v1.0 từ tám workbook Excel mapping và chín TXT nghị quyết. "
        "Kiểm chứng có hỗ trợ AI, do Vi xem xét và xác nhận. Metadata điều khoản của mẫu mapping đã duyệt "
        "được giữ trong reviewer_note; context_origin của các mẫu này vẫn là mapping. "
        f"Bộ có {len(qa)} Full QA và {len(project(qa))} MRC. MRC thiên về T1.\n\n"
        "Benchmark lịch sử gồm hai phiên bản matrix và các lượt pilot, batch khác nhau. "
        "Provenance lịch sử chưa đầy đủ và có 110 lượt chưa nhận diện được nhóm. "
        "Test chính và challenge phải báo cáo riêng. Một số nhóm challenge có tín hiệu lịch sử. "
        "Pilot đã dùng để điều chỉnh pipeline thuộc dữ liệu phát triển.\n\n"
        "Cách ly hai QA revise ở review rank 235 và 239 do nguồn gán toan_bo cho đơn vị không sắp xếp. "
        "Rà năm dòng nguồn liên quan ở Điều 1 khoản 164 và giữ nguyên snapshot gốc. "
        "Mười QA reject bị loại vì trùng mapping, đáp án và bằng chứng với pilot đã duyệt.\n"
    ).encode("utf-8")
    files["CHANGELOG.md"] = (
        "# Changelog\n\n## v1.0\n\n"
        "- Hợp nhất pilot đã duyệt và ứng viên batch đã duyệt. Ba P0 dùng chung chỉ xuất một lần.\n"
        "- Giữ split đã bàn giao của pilot và mọi mẫu liên kết theo nhóm, ID hay bằng chứng.\n"
        "- Xuất MRC theo schema v1.1 có tám trường metadata.\n"
        "- Loại hai revise và mười reject. Cách ly năm mapping sai nhãn khỏi release.\n"
    ).encode("utf-8")
    files["checksums.sha256"] = "".join(f"{digest(data)}  {name}\n" for name, data in sorted(files.items())).encode()
    blob = archive(files)
    check_archive(blob, train, dev, args.reservation)
    publish(ISSUES.parent, {ISSUES.name: csv_bytes(issues, list(issues[0]))})
    publish(args.output_dir, {**files, "vnab-dataset-v1.0.zip": blob})
    print(json.dumps(report, ensure_ascii=True))


if __name__ == "__main__":
    main()
