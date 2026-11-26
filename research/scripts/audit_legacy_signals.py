"""Record historical relation signals and verify supplemental pilot CSV coverage."""
import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path

from group_relations import GROUPS, LEGACY, folded, read_csv, read_jsonl, snapshot
from import_legacy import jsonl
from inventory_sources import ROOT, publish

PILOT_CSV = ("pilot_questions_fixed.csv", "backend/data/pilot_questions_fixed.csv",
             "backend/data/pilot_v2/pilot_v2_questions.csv")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    legacy = [row for path in sorted(LEGACY.glob("*.jsonl")) for row in read_jsonl(path)]
    groups = read_jsonl(GROUPS / "relation_groups.jsonl")
    raw, _ = snapshot()
    known_questions = {row["question"] for row in legacy}
    by_mapping = {row["mapping_id"]: row for row in raw}
    related = {mid: g["group_id"] for g in groups for mid in g["mapping_ids"]}
    approved_screen = {g["group_id"] for g in groups if g["historical_signals"]}
    index = defaultdict(set)
    for mapping_id in related:
        for side in ("old", "new"):
            index[folded(by_mapping[mapping_id][f"{side}_unit_name"])].add((side, mapping_id))
    lengths = sorted({len(term) for term in index})

    def mention_edges(values):
        hits = defaultdict(set)
        for value in values:
            tokens = folded(value)
            for length in lengths:
                for start in range(len(tokens) - length + 1):
                    for side, mapping_id in index.get(tokens[start:start + length], ()):
                        hits[side].add(mapping_id)
        return hits

    supplemental = []
    for path in PILOT_CSV:
        for line, row in enumerate(read_csv(ROOT / path), start=2):
            if row["question"] not in known_questions:
                supplemental.append({**row, "version": "supplemental_pilot_csv",
                                     "provenance": {"file": path, "row": line}})
    occurrence = Counter()
    matches, repeated = [], defaultdict(set)
    for row in legacy + supplemental:
        hit = mention_edges(row.get(k) for k in ("question", "expected_answer", "old_unit_name", "must_contain"))
        paired = {mid for mid in hit["old"] & hit["new"]
                  if folded(by_mapping[mid]["old_unit_name"]) != folded(by_mapping[mid]["new_unit_name"])}
        occurrence[row["version"]] += bool(paired)
        repeated[folded(row["question"])].add(row["question"])
        if row["version"] == "supplemental_pilot_csv":
            hit_groups = {related[mid] for mid in hit["old"] | hit["new"]}
            if not hit_groups or not hit_groups <= approved_screen:
                raise ValueError("Supplemental pilot requires a reservation re-screen")
        if paired:
            matches.append(dict(version=row["version"], test_id=row["test_id"], provenance=row["provenance"],
                                possible_mapping_ids=sorted(paired), group_ids=sorted({related[mid] for mid in paired})))
    summary = dict(supplemental_csv_count=len(PILOT_CSV), additional_questions=len(supplemental),
                   relation_signal_rows=len(matches), relation_signals_by_version=dict(occurrence),
                   normalized_question_variant_keys=sum(len(v) > 1 for v in repeated.values()))
    publish(ROOT / "research/reports", {
        "legacy_relation_signals.jsonl": jsonl(matches),
        "legacy_signal_summary.json": (json.dumps(summary, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
    })
    print(summary)


if __name__ == "__main__":
    main()
