"""Prepare metadata-enriched MRC and package the approved smoke-test pilot."""
import argparse
import json
from pathlib import Path

from build_pilot import PILOT, content_hash, review_row, to_mrc
from group_relations import GROUPS, read_csv, read_jsonl, snapshot
from import_legacy import jsonl
from inventory_sources import ROOT, csv_bytes, publish
from prepare_dataset import archive, handoff, require_reservation, split_blocks, split_samples
from validate_pilot import validate

STAGING = PILOT / "metadata_v1.1"
CANDIDATES = ROOT / "research/data/candidates/v1"
BASE = PILOT / "approved_v1"
VERSION = "pilot-v1.1"
CORE_FIELDS = ("id", "question", "context", "answers")


def project(qa):
    return [to_mrc(sample, metadata=True) for sample in qa if sample["answer_start"] is not None]


def migrate(qa_path, mrc_path, reservation):
    qa = read_jsonl(qa_path)
    original = read_jsonl(mrc_path)
    enriched = project(qa)
    if [{key: row[key] for key in CORE_FIELDS} for row in enriched] != original:
        raise ValueError(f"MRC core fields changed: {mrc_path.name}")
    validate(qa, enriched, reservation, metadata=True)
    return qa, enriched


def choose_additional(base, pilot, candidates, ranked):
    # Preserve the three requested Cà Mau candidates, then take distinct highest-priority P0 groups.
    camau = [q for q in pilot if q["province"] == "Tỉnh Cà Mau"
             and q["context_origin"] == "legal_original" and q["answer_start"] is not None]
    if len(camau) != 3 or any(q["review_status"] != "pending" for q in camau):
        raise ValueError("Expected exactly three pending Cà Mau pilot candidates")
    addition = list(camau)
    combined = base + addition
    if len(split_blocks(combined)) != len(combined):
        raise ValueError("Existing and Cà Mau pilot samples overlap")
    by_id = {row["id"]: row for row in candidates}
    used_provinces = set()
    for row in sorted(ranked, key=lambda r: int(r["review_rank"])):
        if row["review_priority"] != "P0":
            continue
        q = by_id[row["id"]]
        if (q["review_status"] != "pending" or q["context_origin"] != "legal_original"
                or q["answer_start"] is None or q["province"] in used_provinces
                or any(q["id"] == other["id"] for other in combined)):
            continue
        if len(split_blocks(combined + [q])) != len(combined) + 1:
            continue
        addition.append(q)
        combined.append(q)
        used_provinces.add(q["province"])
        if len(addition) == 6:
            break
    if len(addition) != 6:
        raise ValueError("Fewer than three eligible distinct P0 additions")
    return addition


def prepare(reservation, output, seed):
    approved, mrc_approved = migrate(BASE / "qa_sample.jsonl", BASE / "mrc_sample.jsonl", reservation)
    pilot, mrc_pilot = migrate(PILOT / "v1.1/qa_sample_candidates.jsonl",
                               PILOT / "v1.1/mrc_sample_candidates.jsonl", reservation)
    candidates, mrc_batch = migrate(CANDIDATES / "qa_candidates.jsonl", CANDIDATES / "mrc_candidates.jsonl",
                                    reservation)
    base = [q for q in approved if q["answer_start"] is not None]
    addition = choose_additional(base, pilot, candidates, read_csv(CANDIDATES / "dataset_review.csv"))
    validate(base + addition, project(base + addition), reservation, metadata=True)
    train, dev = split_samples(base + addition, seed)
    review = [review_row(q) for q in addition]
    report = {"status": "preview_only_pending_review", "metadata_schema": "v1.1",
              "regression_rows": {"approved": len(mrc_approved), "pilot_v1.1": len(mrc_pilot),
                                  "batch_candidates": len(mrc_batch)},
              "additional_pending": len(addition), "train_preview": len(train), "dev_preview": len(dev),
              "linked_blocks": len(split_blocks(base + addition))}
    publish(output, {"mrc_approved.jsonl": jsonl(mrc_approved), "mrc_pilot_v1.1.jsonl": jsonl(mrc_pilot),
                     "mrc_batch_candidates.jsonl": jsonl(mrc_batch), "qa_additional_candidates.jsonl": jsonl(addition),
                     "mrc_additional_candidates.jsonl": jsonl(project(addition)),
                     "pilot_additional_review.csv": b"\xef\xbb\xbf" + csv_bytes(review, list(review[0])),
                     "validation_preview.json": (json.dumps(report, indent=2) + "\n").encode("utf-8")})
    print(json.dumps(report))


def pack(reservation, reviewed, output, seed, fingerprint):
    approved = [q for q in read_jsonl(BASE / "qa_sample.jsonl") if q["answer_start"] is not None]
    expected = {q["id"]: content_hash(q) for q in read_jsonl(STAGING / "qa_additional_candidates.jsonl")}
    additional = read_jsonl(reviewed)
    if (len(additional) != 6 or {q["id"]: content_hash(q) for q in additional} != expected
            or any(q["review_status"] != "verified" for q in approved + additional)):
        raise ValueError("Pilot handoff requires verified review of all six unchanged additional samples")
    qa = approved + additional
    validate(qa, project(qa), reservation, metadata=True)
    train, dev = split_samples(qa, seed)
    files = handoff(train, dev, VERSION, fingerprint, seed, pilot=True)
    publish(output, {**files, f"vnab-{VERSION}.zip": archive(files)})
    print(f"PASS pilot train={len(train)} dev={len(dev)} QA/MRC")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("prepare", "package"))
    parser.add_argument("--reservation", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--reviewed-additional", type=Path)
    parser.add_argument("--seed", type=int, default=20261127)
    args = parser.parse_args()
    if not args.output_dir.resolve().is_relative_to(ROOT / "research"):
        parser.error("Use an output directory in research/")
    _, source = snapshot()
    fingerprint = source["source_fingerprint_sha256"]
    require_reservation(args.reservation, fingerprint, read_jsonl(GROUPS / "relation_groups.jsonl"))
    if args.stage == "prepare":
        prepare(args.reservation, args.output_dir, args.seed)
    elif args.reviewed_additional is None:
        parser.error("--reviewed-additional is required for package")
    else:
        pack(args.reservation, args.reviewed_additional, args.output_dir, args.seed, fingerprint)


if __name__ == "__main__":
    main()
