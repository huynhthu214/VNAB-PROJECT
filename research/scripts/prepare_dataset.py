"""Generate pending QA or package reviewed QA with group-isolated train/dev splits."""
import argparse
from collections import Counter, defaultdict, deque
import io
import json
from pathlib import Path
import random
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from build_pilot import content_hash, legal_evidence, make_sample, mapping_context, review_row, to_mrc
from group_relations import GROUPS, RAW, folded, matched_groups, read_csv, read_jsonl, snapshot
from import_legacy import jsonl
from inventory_sources import ROOT, csv_bytes, digest, publish
from prepare_pilot_update import natural_location
from validate_pilot import validate

ALLOWED_LABELS = {"Nhập một phần", "Hợp nhất một phần", "Nhập toàn bộ", "Hợp nhất toàn bộ"}


def require_reservation(path, fingerprint, groups):
    if path.resolve().is_relative_to(ROOT):
        raise ValueError("Reservation must be outside the repository")
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    main, challenge, combined = (data[k] for k in ("main_group_ids", "challenge_group_ids", "group_ids"))
    if (data["status"] != "approved" or data["source_fingerprint_sha256"] != fingerprint
            or len(main) != 40 or not 10 <= len(challenge) <= 15
            or len(set(combined)) != len(combined) or set(combined) != set(main) | set(challenge)
            or len(combined) != len(main) + len(challenge)
            or not set(combined) <= {g["group_id"] for g in groups}):
        raise ValueError("An approved main and challenge reservation for the current snapshot is required")
    return set(combined)


def evidence_for(row, documents):
    document = documents.get(row["source_doc"])
    match = legal_evidence(row, document) if document else None
    if not match:
        return None
    context, answer, start, article, clause, offset = match
    extra = {"answer_start": start, "article_clause": f"Điều {article}, khoản {clause}",
             "evidence": {"kind": "txt_excerpt", "file": document["source_file"], "sha256": document["sha256"],
                          "start": offset, "end": offset + len(context)}}
    return context, answer, extra


def generate(group, members, documents, fingerprint):
    old, new = defaultdict(list), defaultdict(list)
    for row in members:
        old[row["old_unit_id"]].append(row)
        new[row["new_unit_id"]].append(row)
    gid = group["group_id"]
    for rows in old.values():
        first = rows[0]
        place = natural_location(first)
        targets = "; ".join(f'{r["new_unit_name"]} ({"toàn bộ" if r["merge_type"] == "toan_bo" else "một phần"})'
                            for r in rows)
        if len(rows) == 1 and first["merge_type"] == "toan_bo":
            question = f'{place} được sắp xếp toàn bộ vào đơn vị mới nào của {first["new_province"]}?'
            evidence = evidence_for(first, documents)
            context, answer, legal = evidence or (mapping_context(rows), first["new_unit_name"], None)
            yield make_sample([gid], "T1", question, context, answer, rows, fingerprint, legal=legal)
        if len(rows) > 1:
            context = mapping_context(rows)
            yield make_sample([gid], "T2", f'{place} được sắp xếp vào những đơn vị mới nào, theo hình thức nào?',
                              context, targets, rows, fingerprint)
            yield make_sample([gid], "T6", f'Có bao nhiêu đơn vị mới tiếp nhận địa bàn của {place}?',
                              context, str(len({r["new_unit_id"] for r in rows})), rows, fingerprint)
        if any(r["merge_type"] == "mot_phan" for r in rows):
            partial = [r for r in rows if r["merge_type"] == "mot_phan"]
            yield make_sample([gid], "T4", f'Những đơn vị mới nào tiếp nhận một phần địa bàn của {place}?',
                              mapping_context(rows), "; ".join(r["new_unit_name"] for r in partial),
                              partial, fingerprint)
    for rows in new.values():
        first = rows[0]
        target = f'{first["new_unit_name"]} mới ({first["new_province"]})'
        origins = "; ".join(f'{natural_location(r)} ({"toàn bộ" if r["merge_type"] == "toan_bo" else "một phần"})'
                            for r in rows)
        yield make_sample([gid], "T5", f'{target} tiếp nhận địa bàn từ những đơn vị nào trước sắp xếp?',
                          mapping_context(rows), origins, rows, fingerprint)
        if len(rows) > 1 and {r["merge_type"] for r in rows} == {"toan_bo"}:
            places = "; ".join(natural_location(r) for r in rows)
            yield make_sample([gid], "T3", f'Sau sắp xếp, các đơn vị {places} hợp thành đơn vị mới nào?',
                              mapping_context(rows), first["new_unit_name"], rows, fingerprint)
    whole = next((r for r in members if r["merge_type"] == "toan_bo" and len(old[r["old_unit_id"]]) == 1), None)
    if whole:
        place = " ".join(folded(natural_location(whole)))
        yield make_sample([gid], "T7", f'{place} nay thuoc don vi moi nao?',
                          mapping_context([whole]), whole["new_unit_name"], [whole], fingerprint)


def generate_pool(groups, mappings, documents, fingerprint, reserved, limit, *, quarantined=()):
    selected, used_questions, seen_types = [], set(), set()
    terms = defaultdict(set)
    for group in groups:
        if group["group_id"] in reserved:
            for mid in group["mapping_ids"]:
                for key in ("old_unit_name", "new_unit_name"):
                    terms[folded(mappings[mid][key])].add(group["group_id"])
    for group in groups:
        gid = group["group_id"]
        if (gid in reserved or group["touches_quarantine"] or len(group["provinces"]) != 1
                or not set(group["merge_counts"]) <= {"toan_bo", "mot_phan"}
                or any(mid in quarantined for mid in group["mapping_ids"])):
            continue
        members = [mappings[mid] for mid in group["mapping_ids"]]
        if any(r["sheet1_merge_type_raw"] not in ALLOWED_LABELS for r in members):
            continue
        for sample in generate(group, members, documents, fingerprint):
            question = folded(sample["question"])
            key = (gid, sample["type"])
            if key in seen_types or question in used_questions or matched_groups(
                    terms, (sample["question"], sample["context"], sample["answer_text"])):
                continue
            used_questions.add(question)
            seen_types.add(key)
            sample["provenance"]["evidence"]["unit_metadata"] = [
                {key: mappings[mid][key] for key in ("mapping_id", "old_district", "old_province",
                                                      "old_unit_code", "new_unit_code")}
                for mid in sample["mapping_ids"]
            ]
            selected.append(sample)
    return balanced_pick(selected, limit)


def priority(sample):
    if sample["context_origin"] == "legal_original" and sample["answer_start"] is not None:
        return "P0"
    if sample["type"] in {"T2", "T3", "T4"} or (sample["type"] == "T5" and len(sample["old_unit_ids"]) > 1):
        return "P1"
    return "P2"


def balanced_pick(samples, limit):
    def distribute(items, count):
        buckets = defaultdict(deque)
        for item in items:
            buckets[item["province"], item["type"]].append(item)
        selected = []
        # Rotate provinces and types independently through the same deterministic key order.
        keys = sorted(buckets, key=lambda key: (key[0], key[1]))
        while keys and len(selected) < count:
            remaining = []
            for key in keys:
                if len(selected) == count:
                    break
                selected.append(buckets[key].popleft())
                if buckets[key]:
                    remaining.append(key)
            keys = remaining
        return selected

    tiers = {label: [q for q in samples if priority(q) == label] for label in ("P0", "P1", "P2")}
    quotas = {"P0": round(limit * .65), "P1": round(limit * .23)}
    quotas["P2"] = limit - sum(quotas.values())
    chosen = [item for label, items in tiers.items() for item in distribute(items, quotas[label])]
    chosen_ids = {item["id"] for item in chosen}
    for items in tiers.values():
        chosen.extend(distribute([q for q in items if q["id"] not in chosen_ids], limit - len(chosen)))
    return chosen


def split_blocks(samples):
    """Link samples by groups, entities, questions and overlapping evidence spans."""
    parent = list(range(len(samples)))

    def find(index):
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    by_key, excerpts = {}, defaultdict(list)
    for index, sample in enumerate(samples):
        keys = [("question", folded(sample["question"])), ("context", folded(sample["context"]))]
        provenance = sample["provenance"]
        keys.extend(("group", gid) for gid in provenance["related_group_ids"] or [sample["group_id"]])
        for name in ("old_unit_ids", "new_unit_ids", "mapping_ids"):
            keys.extend((name, id_) for id_ in sample[name])
        for key in keys:
            previous = by_key.setdefault(key, index)
            parent[find(index)] = find(previous)
        evidence = provenance["evidence"]
        segments = evidence.get("segments", [evidence] if evidence.get("kind") == "txt_excerpt" else [])
        for segment in segments:
            excerpts[segment["file"], segment["sha256"]].append((segment["start"], segment["end"], index))
    for intervals in excerpts.values():
        max_end, previous = -1, None
        for start, end, index in sorted(intervals):
            if start < max_end:
                parent[find(index)] = find(previous)
            if end > max_end:
                max_end, previous = end, index
    blocks = defaultdict(list)
    for index, sample in enumerate(samples):
        blocks[find(index)].append(sample)
    return list(blocks.values())


def split_samples(samples, seed):
    blocks = split_blocks(samples)
    if len(blocks) < 2:
        raise ValueError("Need at least two independent reviewed components to split train/dev")
    ordered = sorted(blocks, key=lambda block: min(q["id"] for q in block))
    random.Random(seed).shuffle(ordered)
    span_blocks = [block for block in ordered if any(q["answer_start"] is not None for q in block)]
    if len(span_blocks) >= 2:
        ordered = [span_blocks[0], *(block for block in ordered if block not in (span_blocks[0], span_blocks[-1])),
                   span_blocks[-1]]
    target = max(1, round(len(samples) * 0.2))
    dev, train = [], []
    for index, block in enumerate(ordered):
        if len(dev) < target and index < len(ordered) - 1:
            dev.extend(block)
        else:
            train.extend(block)
    return train, dev


def stats(items):
    return dict(qa=len(items), mrc=sum(q["answer_start"] is not None for q in items),
                groups=len({gid for q in items for gid in q["provenance"]["related_group_ids"]}),
                province=dict(Counter(q["province"] for q in items)),
                type=dict(Counter(q["type"] for q in items)),
                context_origin=dict(Counter(q["context_origin"] for q in items)),
                priority=dict(Counter(priority(q) for q in items)))


def preview_leakage(qa, train, dev):
    forward, reverse = set(), set()
    occurrences = defaultdict(list)
    for q in qa:
        if q["type"] in {"T1", "T2", "T3", "T4", "T7"}:
            forward.update(q["mapping_ids"])
        if q["type"] == "T5":
            reverse.update(q["mapping_ids"])
        evidence = q["provenance"]["evidence"]
        if evidence.get("kind") == "txt_excerpt":
            occurrences[evidence["file"], evidence["sha256"]].append((evidence["start"], evidence["end"]))
    identical, overlap = 0, 0
    for intervals in occurrences.values():
        for index, (start, end) in enumerate(intervals):
            for other_start, other_end in intervals[:index]:
                if (start, end) == (other_start, other_end):
                    identical += 1
                elif start < other_end and other_start < end:
                    overlap += 1
    # Rebuilding the blocks independently verifies that no split separates linked evidence or entities.
    dev_ids = {q["id"] for q in dev}
    if any(len({q["id"] in dev_ids for q in block}) != 1 for block in split_blocks(train + dev)):
        raise ValueError("Preview separates linked groups or evidence")
    return {"forward_reverse_shared_mappings": len(forward & reverse),
            "identical_evidence_pairs": identical, "overlapping_evidence_pairs_excluding_identical": overlap,
            "linked_blocks_cut_by_preview": 0}


def reviewed_unique(items):
    seen = {}
    for qa in items:
        key = folded(qa["question"])
        other = seen.get(key)
        if other is None:
            seen[key] = qa
        elif any(qa[k] != other[k] for k in ("action", "group_id", "answerable")) or (
                set(qa["mapping_ids"]) != set(other["mapping_ids"])
                or folded(qa["answer_text"]) != folded(other["answer_text"])):
            raise ValueError("Conflicting reviewed QA for the same normalized question")
    return list(seen.values())


def archive(files):
    buffer = io.BytesIO()
    with ZipFile(buffer, "w", compression=ZIP_DEFLATED) as zip_file:
        for name, content in sorted(files.items()):
            zip_file.writestr(ZipInfo(name), content, compress_type=ZIP_DEFLATED)
    with ZipFile(buffer) as zip_file:
        if zip_file.testzip() is not None or set(zip_file.namelist()) != set(files):
            raise ValueError("Invalid handoff archive")
    return buffer.getvalue()


def handoff(train, dev, version, fingerprint, seed, *, pilot=False):
    files, manifest = {}, []
    for split, items in {"train": train, "dev": dev}.items():
        files[f"qa_{split}.jsonl"] = jsonl(items)
        files[f"mrc_{split}.jsonl"] = jsonl([to_mrc(q, metadata=True) for q in items if q["answer_start"] is not None])
        manifest.extend({"id": q["id"], "split": split, "group_id": q["group_id"], "type": q["type"],
                         "content_sha256": content_hash(q)}
                        for q in items)
    files["split_manifest.csv"] = csv_bytes(manifest, ["id", "split", "group_id", "type", "content_sha256"])
    statistics = {"train": stats(train), "dev": stats(dev)}
    for output, source in (("qa.schema.json", "qa.schema.json"), ("mrc.schema.json", "mrc.v1.1.schema.json")):
        files[output] = (ROOT / "research/schema" / source).read_bytes()
    purpose = ("Pilot phục vụ smoke test. Mẫu dùng để huấn luyện hoặc điều chỉnh pipeline phải được giữ ngoài "
               "tập đánh giá độc lập. QA và MRC trong pilot dùng cùng split và cùng ID."
               if pilot else "Train/dev dùng để phát triển. Mẫu pilot đã dùng để điều chỉnh pipeline thuộc dữ liệu phát triển.")
    files["README.md"] = (f"# VNAB {version}\n\n{purpose}\n\n"
                          "Chạy từ thư mục đã giải nén.\n\n```python\n"
                          "from datasets import load_dataset\n"
                          'mrc = load_dataset("json", data_files={"train": "mrc_train.jsonl", '
                          '"validation": "mrc_dev.jsonl"})\n'
                          'qa = load_dataset("json", data_files={"train": "qa_train.jsonl", '
                          '"validation": "qa_dev.jsonl"})\n```\n\n'
                          "JSONL UTF-8. MRC schema v1.1 giữ id, question, context, answers.text và "
                          "answers.answer_start theo bản ghi phẳng SQuAD. Offset là chỉ số ký tự Unicode Python từ 0 "
                          "trong context nguyên văn. Metadata kế thừa Full QA gồm group_id, province, type, "
                          "source_doc, article_clause, context_origin, answerable và review_status. "
                          "Full QA còn giữ các ID, provenance, quan hệ và audit review. "
                          "Manifest ghi split và hash nội dung. Gói chứa văn bản UTF-8 để Thư tự tokenize "
                          "bằng AutoTokenizer với use_fast=True.\n").encode("utf-8")
    counts = {name: content.count(b"\n") for name, content in files.items() if name.endswith(".jsonl")}
    result = dict(version=version, source_snapshot_sha256=fingerprint, split_seed=seed, rows=counts,
                  statistics=statistics, schema_span_provenance_metadata="PASS", reservation_overlap="PASS",
                  split_checks=preview_leakage(train + dev, train, dev), tokenizer_batch="NOT RUN")
    report = (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    if pilot:
        for field in ("old_unit_ids", "new_unit_ids", "mapping_ids"):
            left = {value for q in train for value in q[field]}
            right = {value for q in dev for value in q[field]}
            result["split_checks"][f"{field}_overlap"] = len(left & right)
        train_groups = {gid for q in train for gid in q["provenance"]["related_group_ids"]}
        dev_groups = {gid for q in dev for gid in q["provenance"]["related_group_ids"]}
        result["split_checks"]["group_overlap"] = len(train_groups & dev_groups)
        result["split_checks"]["duplicate_ids"] = len(train + dev) - len({q["id"] for q in train + dev})
        if any(result["split_checks"][key] for key in ("old_unit_ids_overlap", "new_unit_ids_overlap",
                                                       "mapping_ids_overlap", "group_overlap", "duplicate_ids")):
            raise ValueError("Pilot split contains repeated IDs or split dependencies")
        files["validation_report.json"] = (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    else:
        files["data_card.json"] = report
        files["statistics.json"] = (json.dumps(statistics, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
        files["validation.log"] = b"PASS schema, span, provenance, metadata and reservation\nNOT RUN tokenizer/batch\n"
    files["checksums.sha256"] = "".join(f"{digest(data)}  {name}\n" for name, data in sorted(files.items())).encode()
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("generate", "package"))
    parser.add_argument("--reservation", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--reviewed", type=Path, nargs="+")
    parser.add_argument("--limit", type=int, default=240)
    parser.add_argument("--seed", type=int, default=20261127)
    parser.add_argument("--version", default="v1.0")
    args = parser.parse_args()
    if not args.output_dir.resolve().is_relative_to(ROOT / "research") or args.limit < 1:
        parser.error("Use an output directory in research/ and a positive limit")
    if not args.version or not all(c.isalnum() or c in ".-_" for c in args.version):
        parser.error("Use a simple version label")
    raw, manifest = snapshot()
    fingerprint = manifest["source_fingerprint_sha256"]
    groups = read_jsonl(GROUPS / "relation_groups.jsonl")
    reserved = require_reservation(args.reservation, fingerprint, groups)
    if args.stage == "generate":
        documents = {d["doc_code"]: d for d in read_csv(RAW / "legal_documents.csv")}
        issues = ROOT / "research/reports/data_issues_release_v1.csv"
        quarantined = {row["mapping_id"] for row in read_csv(issues)
                       if row["disposition"] == "quarantined"} if issues.exists() else set()
        qa = generate_pool(groups, {r["mapping_id"]: r for r in raw}, documents, fingerprint, reserved, args.limit,
                           quarantined=quarantined)
        if not qa:
            raise ValueError("Empty candidate pool")
        mrc = [to_mrc(q) for q in qa if q["answer_start"] is not None]
        validate(qa, mrc, args.reservation)
        review_order = sorted(qa, key=lambda q: (priority(q), q["group_id"], q["context"],
                                                tuple(q["mapping_ids"]), q["type"], q["id"]))
        review = [{"review_priority": priority(q), "review_rank": index, **review_row(q)}
                  for index, q in enumerate(review_order, 1)]
        train, dev = split_samples(qa, args.seed)
        preview = {"status": "candidate_preview", "candidates": stats(qa),
                   "first_100_to_review": stats(review_order[:100]),
                   "split_preview": {"train": stats(train), "dev": stats(dev)},
                   "linked_blocks": len(split_blocks(qa)),
                   "largest_linked_block": max(map(len, split_blocks(qa))),
                   "leakage": preview_leakage(qa, train, dev)}
        publish(args.output_dir, {"qa_candidates.jsonl": jsonl(qa), "mrc_candidates.jsonl": jsonl(mrc),
                                  "dataset_review.csv": b"\xef\xbb\xbf" + csv_bytes(review, list(review[0])),
                                  "candidate_preview.json": (json.dumps(preview, ensure_ascii=False, indent=2)
                                                             + "\n").encode("utf-8")})
        print(f"PASS pending={len(qa)} extractive={len(mrc)}")
        return
    if not args.reviewed:
        parser.error("--reviewed is required for package")
    qa = reviewed_unique(q for path in args.reviewed for q in read_jsonl(path) if q["review_status"] == "verified")
    validate(qa, [to_mrc(q, metadata=True) for q in qa if q["answer_start"] is not None],
             args.reservation, metadata=True)
    train, dev = split_samples(qa, args.seed)
    if not all(any(q["answer_start"] is not None for q in split) for split in (train, dev)):
        raise ValueError("Handoff acceptance failed: empty MRC train or dev; pilot-only delivery")
    files = handoff(train, dev, args.version, fingerprint, args.seed)
    publish(args.output_dir, {**files, f"vnab-{args.version}.zip": archive(files)})
    print(f"PASS train={len(train)} dev={len(dev)}")


if __name__ == "__main__":
    main()
