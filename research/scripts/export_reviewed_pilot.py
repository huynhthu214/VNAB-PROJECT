"""Export only human-approved pilot rows for pipeline testing."""
import argparse
from pathlib import Path

from build_pilot import to_mrc
from group_relations import read_jsonl
from import_legacy import jsonl
from inventory_sources import ROOT, publish
from validate_pilot import validate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reviewed", type=Path, required=True)
    parser.add_argument("--reservation", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--metadata", action="store_true", help="Export MRC schema v1.1 metadata")
    args = parser.parse_args()
    if not args.output_dir.resolve().is_relative_to(ROOT / "research"):
        parser.error("Use a new output directory under research/")
    qa = [q for q in read_jsonl(args.reviewed) if q["review_status"] == "verified"]
    mrc = [to_mrc(q, metadata=args.metadata) for q in qa if q["answer_start"] is not None]
    if not mrc:
        raise ValueError("No approved extractive pilot rows")
    validate(qa, mrc, args.reservation, metadata=args.metadata)
    publish(args.output_dir, {"qa_sample.jsonl": jsonl(qa), "mrc_sample.jsonl": jsonl(mrc)})
    print(f"PASS reviewed pilot QA={len(qa)} MRC={len(mrc)}")


if __name__ == "__main__":
    main()
