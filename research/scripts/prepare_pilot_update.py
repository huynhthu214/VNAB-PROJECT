"""Publish a versioned pending pilot with reviewed-source corrections and Cà Mau candidates."""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import re

from build_pilot import PILOT, content_hash, legal_evidence, make_sample, nfc, passages, review_row, to_mrc
from group_relations import GROUPS, RAW, folded, matched_groups, read_csv, read_jsonl, snapshot
from import_legacy import jsonl
from inventory_sources import ROOT, csv_bytes, publish
from validate_pilot import validate

CHANGE = {
    "qa_0504cf351761": ((78, "Châu Thành", "một phần"), (87, "Tân Ninh", "phần còn lại")),
    "qa_285f902c8753": ((63, "Cầu Khởi", "một phần"), (89, "Ninh Thạnh", "phần còn lại")),
    "qa_1b3d822e0638": ((42, "Gia Định", "Bình Thạnh"), (49, "Gò Vấp", "Gò Vấp")),
}
URL = {
    "1682/NQ-UBTVQH15": "https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-quyet-so-1682-nq-ubtvqh15-sap-xep-cac-dvhc-cap-xa-cua-tinh-tay-ninh-nam-2025-119250616210257367.htm",
    "1685/NQ-UBTVQH15": "https://xaydungchinhsach.chinhphu.vn/toan-van-nghi-quyet-so-1685-nq-ubtvqh15-sap-xep-cac-dvhc-cap-xa-cua-thanh-pho-ho-chi-minh-nam-2025-119250616211341304.htm",
}


def revise(sample, changes, doc):
    clauses = {c: (a, start, text) for a, c, start, text in passages(doc["full_text"])}
    segments, contexts = [], []
    names = {e["name"] for e in sample["gold_entities"] if e["side"] == "old"}
    if len(names) != 1:
        raise ValueError("Expected one source name")
    name = nfc(names.pop()).casefold()
    for clause, destination, qualifier in changes:
        article, start, text = clauses[clause]
        excerpt = nfc(text).casefold()
        if not all(term.casefold() in excerpt for term in (name, destination, qualifier)):
            raise ValueError(f"Evidence terms missing in clause {clause}")
        segments.append(dict(article=article, clause=clause, start=start, end=start + len(text),
                             file=doc["source_file"], sha256=doc["sha256"]))
        contexts.append(text)
    output = {k: v for k, v in sample.items() if k != "review"}
    evidence = {"kind": "txt_excerpts", "segments": segments}
    if sample["action"] == "clarify":
        evidence["candidate_entities"] = sample["gold_entities"]
        output["gold_entities"] = []
    if sample["type"] == "T2":
        output["answer_text"] = "Một phần Xã Thái Bình vào Xã Châu Thành; phần còn lại vào Phường Tân Ninh."
    output.update(context="\n\n".join(contexts), context_origin="legal_original",
                  article_clause="Điều 1, khoản " + ", ".join(str(item[0]) for item in changes),
                  source_url=URL[sample["source_doc"]], review_status="pending",
                  provenance={**sample["provenance"], "evidence": evidence})
    return output


def natural_location(row):
    def remove_code(text):
        return re.sub(r"\s*\(\d+\)\s*$", "", text)
    return (f'{row["old_unit_name"]} trước sắp xếp '
            f'({remove_code(row["old_district"])}, {remove_code(row["old_province"])})')


def new_camau(groups, rows, doc, fingerprint, reserved, used, limit=3):
    terms = defaultdict(set)
    for group in groups:
        if group["group_id"] in reserved:
            for mapping_id in group["mapping_ids"]:
                row = rows[mapping_id]
                for field in ("old_unit_name", "new_unit_name"):
                    terms[folded(row[field])].add(group["group_id"])
    templates = (
        "{} được sắp xếp toàn bộ vào đơn vị mới nào của tỉnh Cà Mau?",
        "Sau sắp xếp, đơn vị nào ở tỉnh Cà Mau tiếp nhận toàn bộ địa bàn của {}?",
        "Toàn bộ địa bàn của {} thuộc đơn vị mới nào tại Cà Mau?",
    )
    result = []
    seen_contexts = set()
    for group in groups:
        gid = group["group_id"]
        if (gid in reserved | used or group["provinces"] != ["Tỉnh Cà Mau"]
                or group["touches_quarantine"] or set(group["merge_counts"]) != {"toan_bo"}):
            continue
        for mid in group["mapping_ids"]:
            row = rows[mid]
            match = legal_evidence(row, doc)
            if not match:
                continue
            context, answer, start, article, clause, offset = match
            question = templates[len(result) % len(templates)].format(natural_location(row))
            if context in seen_contexts or matched_groups(terms, (question, context, answer)):
                continue
            result.append(make_sample(
                [gid], "T1", question, context, answer, [row], fingerprint,
                legal={"answer_start": start, "article_clause": f"Điều {article}, khoản {clause}",
                       "evidence": {"kind": "txt_excerpt", "file": doc["source_file"], "sha256": doc["sha256"],
                                    "start": offset, "end": offset + len(context),
                                    "old_district_raw": row["old_district"], "old_province_raw": row["old_province"],
                                    "old_unit_code": row["old_unit_code"], "new_unit_code": row["new_unit_code"]}}))
            seen_contexts.add(context)
            break
        if len(result) == limit:
            break
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reservation", required=True, type=Path)
    parser.add_argument("--base-qa", type=Path, default=PILOT / "qa_sample_candidates.jsonl")
    parser.add_argument("--output-dir", type=Path, default=PILOT / "v1.1")
    args = parser.parse_args()
    if not args.output_dir.resolve().is_relative_to(ROOT / "research"):
        parser.error("Use a new output directory under research/")
    private = json.loads(args.reservation.read_text(encoding="utf-8"))
    units, manifest = snapshot()
    fingerprint = manifest["source_fingerprint_sha256"]
    groups = read_jsonl(GROUPS / "relation_groups.jsonl")
    original = read_jsonl(args.base_qa)
    documents = {d["doc_code"]: d for d in read_csv(RAW / "legal_documents.csv")}
    pilot = []
    revised = 0
    for sample in original:
        change = next((value for prefix, value in CHANGE.items() if sample["id"].startswith(prefix)), None)
        current = revise(sample, change, documents[sample["source_doc"]]) if change else sample
        if change:
            if content_hash(current) == content_hash(sample):
                raise ValueError("Revision failed to change content")
            revised += 1
        pilot.append(current)
    if revised != len(CHANGE):
        raise ValueError("Missing pilot revision targets")
    used = {gid for q in pilot for gid in q["provenance"]["related_group_ids"]}
    additions = new_camau(groups, {r["mapping_id"]: r for r in units}, documents["1655/NQ-UBTVQH15"],
                          fingerprint, set(private["group_ids"]), used)
    if len(additions) < 2:
        raise ValueError("Fewer than two eligible Cà Mau candidates")
    pilot.extend(additions)
    mrc = [to_mrc(q) for q in pilot if q["answer_start"] is not None]
    validate(pilot, mrc, args.reservation)
    prior_mrc = read_jsonl(PILOT / "mrc_sample_candidates.jsonl")
    if mrc[:len(prior_mrc)] != prior_mrc:
        raise ValueError("Existing MRC pilot changed")
    queue = [review_row(q) for q in pilot]
    publish(args.output_dir, {
        "qa_sample_candidates.jsonl": jsonl(pilot),
        "mrc_sample_candidates.jsonl": jsonl(mrc),
        "pilot_review.csv": b"\xef\xbb\xbf" + csv_bytes(queue, list(queue[0])),
    })
    print(f"PASS revised={revised} unchanged={len(original)-revised} camau={len(additions)} QA={len(pilot)} MRC={len(mrc)}")


if __name__ == "__main__":
    main()
