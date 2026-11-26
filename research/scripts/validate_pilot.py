"""Validate Full QA JSONL, extractive JSONL, snapshot evidence and reservation separation."""
import argparse
import json
from pathlib import Path

from jsonschema import Draft202012Validator

from build_pilot import PILOT, content_hash, legal_evidence, passages, to_mrc
from group_relations import GROUPS, RAW, folded, matched_groups, read_csv, read_jsonl, snapshot
from inventory_sources import ROOT


def schemas(*, metadata=False):
    validators = []
    for name in ("qa", "mrc.v1.1" if metadata else "mrc"):
        schema = json.loads((ROOT / f"research/schema/{name}.schema.json").read_text(encoding="utf-8"))
        Draft202012Validator.check_schema(schema)
        validators.append(Draft202012Validator(schema, format_checker=Draft202012Validator.FORMAT_CHECKER))
    return validators


def span_valid(context, text, start):
    return type(start) is int and start >= 0 and bool(text) and context[start:start + len(text)] == text


def check_qa(sample, validator):
    validator.validate(sample)
    start = sample["answer_start"]
    if start is not None and not span_valid(sample["context"], sample["answer_text"], start):
        raise ValueError("Invalid QA span")
    if sample["answerable"] != (sample["action"] == "answer") or (start is not None and not sample["answerable"]):
        raise ValueError("Invalid action/answerable/span combination")
    if sample["action"] == "answer" and not (sample["mapping_ids"] and sample["gold_relations"]
                                             and sample["source_doc"] and sample["source_url"]):
        raise ValueError("Answer without mapping or source")
    review = sample.get("review")
    valid_status = {"approve": "verified", "reject": "rejected", "revise": "pending"}
    if review:
        if (sample["review_status"] != valid_status[review["decision"]] or
                review["content_sha256"] != content_hash(sample)):
            raise ValueError("Review inconsistent with content or status")
    elif sample["review_status"] != "pending":
        raise ValueError("Non-pending sample without review")


def validate(qa, mrc, reservation, *, metadata=False):
    qa_schema, mrc_schema = schemas(metadata=metadata)
    rows, manifest = snapshot()
    fingerprint = manifest["source_fingerprint_sha256"]
    mapping = {r["mapping_id"]: r for r in rows}
    documents = {d["doc_code"]: d for d in read_csv(RAW / "legal_documents.csv")}
    groups = read_jsonl(GROUPS / "relation_groups.jsonl")
    group_by_mapping = {i: g["group_id"] for g in groups for i in g["mapping_ids"]}
    private = json.loads(reservation.read_text(encoding="utf-8"))
    if reservation.resolve().is_relative_to(ROOT) or private["source_fingerprint_sha256"] != fingerprint:
        raise ValueError("Invalid reservation snapshot or storage path")
    reserved = set(private["group_ids"])
    reserved_index = {}
    for mapping_id, gid in group_by_mapping.items():
        if gid in reserved:
            for side in ("old", "new"):
                reserved_index.setdefault(folded(mapping[mapping_id][f"{side}_unit_name"]), set()).add(gid)
    if len({q["id"] for q in qa}) != len(qa) or len({folded(q["question"]) for q in qa}) != len(qa):
        raise ValueError("Duplicate QA ID/question")
    expected_mrc = []
    for item in qa:
        check_qa(item, qa_schema)
        provenance = item["provenance"]
        if provenance["snapshot_sha256"] != fingerprint:
            raise ValueError("Broken source snapshot provenance")
        linked = {group_by_mapping[i] for i in item["mapping_ids"]}
        if (linked != set(provenance["related_group_ids"]) or linked & reserved or
                (linked and item["group_id"] not in linked) or
                matched_groups(reserved_index, (item["question"], item["context"], item["answer_text"]))):
            raise ValueError("Broken group references or reservation overlap")
        references = {ref["mapping_id"]: ref for ref in provenance["mapping_rows"]}
        if set(references) != set(item["mapping_ids"]):
            raise ValueError("Broken mapping provenance")
        mappings = [mapping[i] for i in item["mapping_ids"]]
        evidence = provenance["evidence"]
        candidate_entities = evidence.get("candidate_entities")
        if candidate_entities is not None and (item["action"] != "clarify" or item["gold_entities"]
                                               or item["gold_relations"]):
            raise ValueError("Clarification candidates must be separate from gold")
        entities = candidate_entities if candidate_entities is not None else item["gold_entities"]
        for side in ("old", "new"):
            field = f"{side}_unit_id"
            expected = {(r[field], r[f"{side}_unit_name"]) for r in mappings}
            actual = {(e["id"], e["name"]) for e in entities if e["side"] == side}
            if expected != actual or {i for i, _ in expected} != set(item[f"{side}_unit_ids"]):
                raise ValueError("Broken entity linkage")
        if item["action"] == "answer" and {r["mapping_id"] for r in item["gold_relations"]} != set(item["mapping_ids"]):
            raise ValueError("Incomplete gold mapping list")
        for row in item["gold_relations"]:
            if any(mapping[row["mapping_id"]][k] != value for k, value in row.items()):
                raise ValueError("Broken gold relation")
        for key, ref in references.items():
            row = mapping[key]
            if (ref["file"], ref["sheet"], ref["row"]) != (row["source_file"], row["source_sheet"], int(row["source_row"])):
                raise ValueError("Source coordinates changed")
        if evidence.get("kind") == "txt_excerpts":
            doc = documents[item["source_doc"]]
            actual_passages = {(a, c, start, start + len(text)): text
                               for a, c, start, text in passages(doc["full_text"])}
            excerpts = []
            for segment in evidence["segments"]:
                if (doc["source_file"], doc["sha256"]) != (segment["file"], segment["sha256"]):
                    raise ValueError("Broken TXT segment source")
                key = tuple(segment[k] for k in ("article", "clause", "start", "end"))
                excerpts.append(actual_passages[key])
            if (item["context_origin"] != "legal_original" or item["answer_start"] is not None
                    or len(excerpts) < 2 or "\n\n".join(excerpts) != item["context"]):
                raise ValueError("Broken multi-segment context")
            labels = ", ".join(str(segment["clause"]) for segment in evidence["segments"])
            if item["article_clause"] != f"Điều 1, khoản {labels}":
                raise ValueError("Broken multi-segment citation")
        elif item["context_origin"] == "legal_original":
            doc = documents[item["source_doc"]]
            if (doc["source_file"], doc["sha256"]) != (evidence["file"], evidence["sha256"]):
                raise ValueError("Broken TXT source")
            if doc["full_text"][evidence["start"]:evidence["end"]] != item["context"]:
                raise ValueError("Context differs from TXT source slice")
            match = legal_evidence(mappings[0], doc)
            if not match or match[:3] != (item["context"], item["answer_text"], item["answer_start"]):
                raise ValueError("Old-to-new relationship does not match the evidence rule")
            if item["article_clause"] != f"Điều {match[3]}, khoản {match[4]}":
                raise ValueError("Article/clause marker differs from source")
        if item["answer_start"] is not None:
            expected_mrc.append(to_mrc(item, metadata=metadata))
    for item in mrc:
        mrc_schema.validate(item)
        answers = item["answers"]
        if len(answers["text"]) != len(answers["answer_start"]) or not all(
                span_valid(item["context"], text, start) for text, start in zip(
                    answers["text"], answers["answer_start"])):
            raise ValueError("Invalid MRC spans")
    if mrc != expected_mrc:
        raise ValueError("MRC differs from QA projection")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reservation", type=Path, required=True)
    parser.add_argument("--qa", type=Path, default=PILOT / "qa_sample_candidates.jsonl")
    parser.add_argument("--mrc", type=Path, default=PILOT / "mrc_sample_candidates.jsonl")
    parser.add_argument("--metadata", action="store_true", help="Validate MRC schema v1.1 and metadata parity")
    args = parser.parse_args()
    qa, mrc = read_jsonl(args.qa), read_jsonl(args.mrc)
    validate(qa, mrc, args.reservation, metadata=args.metadata)
    print(f"PASS qa={len(qa)} mrc={len(mrc)} schema span provenance reservation")


if __name__ == "__main__":
    main()
