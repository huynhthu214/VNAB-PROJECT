"""Apply explicit human review decisions to a new QA JSONL file."""
import argparse
from collections import Counter
from datetime import datetime
from pathlib import Path

from build_pilot import PILOT, content_hash, review_row
from group_relations import read_csv, read_jsonl
from import_legacy import jsonl
from inventory_sources import ROOT, publish
from validate_pilot import check_qa, schemas

DECISIONS = {"approve": "verified", "reject": "rejected", "revise": "pending"}


def cell(value):
    return str(value if value is not None else "").replace("\r\n", "\n").replace("\r", "\n")


def apply_reviews(samples, rows, reviewer, timestamp):
    validator, _ = schemas()
    known = {q["id"]: q for q in samples}
    if len(known) != len(samples):
        raise ValueError("Duplicate sample ID")
    decisions = {}
    for row in rows:
        sample_id = row.get("id")
        if sample_id not in known or sample_id in decisions:
            raise ValueError("Unknown or duplicate review ID")
        sample = known[sample_id]
        if row.get("content_sha256") != content_hash(sample):
            raise ValueError(f"Stale review hash for {sample_id}")
        expected = review_row(sample)
        for field, value in expected.items():
            if field not in {"review_decision", "reviewer_note"} and (
                    field not in row or cell(row[field]) != cell(value)):
                raise ValueError(f"Review display field changed: {field}")
        decision = row["review_decision"].strip().lower()
        if decision and decision not in DECISIONS:
            raise ValueError(f"Unknown review decision: {decision}")
        decisions[sample_id] = (decision, row["reviewer_note"].strip())
    result = []
    for sample in samples:
        decision, note = decisions.get(sample["id"], ("", ""))
        if decision:
            sample = {**sample, "review_status": DECISIONS[decision],
                      "review": dict(decision=decision, note=note, reviewer=reviewer,
                                     reviewed_at=timestamp, content_sha256=content_hash(sample))}
        check_qa(sample, validator)
        result.append(sample)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--review-csv", required=True, type=Path)
    parser.add_argument("--qa", type=Path, default=PILOT / "qa_sample_candidates.jsonl")
    parser.add_argument("--reviewer", required=True)
    parser.add_argument("--reviewed-at", required=True, help="ISO 8601 timestamp with timezone")
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--check-only", action="store_true")
    args = parser.parse_args()
    if not args.reviewer.strip() or datetime.fromisoformat(args.reviewed_at).tzinfo is None:
        parser.error("Provide reviewer name and a timezone-aware reviewed-at value")
    samples = apply_reviews(read_jsonl(args.qa), read_csv(args.review_csv), args.reviewer, args.reviewed_at)
    if not args.check_only:
        output = args.output.resolve()
        if not output.is_relative_to(ROOT / "research") or output == args.qa.resolve():
            parser.error("Use a new output path under research/")
        publish(output.parent, {output.name: jsonl(samples)})
    print(f"PASS review import {'check-only' if args.check_only else 'written'}: "
          f"{dict(Counter(s['review_status'] for s in samples))}")


if __name__ == "__main__":
    main()
