"""Import historical matrices and compare actual batch questions without using predictions."""
import argparse
import json
from collections import Counter, defaultdict

from inventory_sources import ROOT, csv_bytes, digest, publish, workbook

DATA = ROOT / "backend/data"
EXPERIMENTS = ROOT / "backend/docs/experiments"
VERSIONS = {"offical": DATA / "offical_test", "cohere": EXPERIMENTS / "v2_cohere/tests"}


def jsonl(rows):
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows).encode("utf-8")


def load_matrix(path, version, province=None):
    data = path.read_bytes()
    for sheet, (_, rows) in workbook(data).items():
        for number, row in rows:
            if not row.get("question"):
                continue
            yield {**row, "must_not_contain": row.get("must_not_contain", ""),
                   "province": province or row.get("province", ""),
                   "version": version, "provenance": {"file": path.relative_to(ROOT).as_posix(),
                                                      "sheet": sheet, "row": number, "sha256": digest(data)}}


def match_batches(index):
    reports, extras = [], {}
    roots = [DATA / "batch_results", EXPERIMENTS]
    files = sorted({f for root in roots for pattern in ("results*.xlsx", "*.jsonl")
                    for f in root.rglob(pattern) if "qa_logs" not in f.name.casefold()})
    for path in files:
        relative = path.relative_to(ROOT).as_posix()
        counts = Counter()
        try:
            if path.suffix == ".xlsx":
                rows = (r for _, tab in workbook(path.read_bytes()).values() for _, r in tab)
            else:
                rows = (json.loads(line) for line in path.read_text(encoding="utf-8-sig").splitlines()
                        if line.strip())
            for row in rows:
                question = row.get("question")
                if not isinstance(question, str) or not question.strip():
                    continue
                test_id = str(row.get("test_id") or "")
                key = (test_id, question)
                variants = index.get(key, set())
                status = "+".join(sorted(variants)) if variants else "unmatched"
                counts[status] += 1
                if not variants and key not in extras:
                    extras[key] = {k: row.get(k, "") for k in ("old_unit_name", "old_parent", "expected_answer",
                                                              "must_contain", "category")}
                    extras[key].update(question=question, test_id=test_id, version="batch_unmatched",
                                       provenance={"file": relative})
        except (ValueError, KeyError, OSError) as exc:
            counts["read_error"] += 1
            reports.append({"file": relative, "offical": 0, "cohere": 0, "both": 0,
                            "unmatched": counts["unmatched"], "read_error": type(exc).__name__})
            continue
        if counts:
            reports.append({"file": relative, "offical": counts["offical"], "cohere": counts["cohere"],
                            "both": counts["cohere+offical"], "unmatched": counts["unmatched"], "read_error": ""})
    return reports, list(extras.values())


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.parse_args()
    sets = {version: [row for f in sorted(folder.glob("test_matrix_*.xlsx"))
                      for row in load_matrix(f, version, f.stem.rsplit("_", 1)[-1])]
            for version, folder in VERSIONS.items()}
    pilots = list(load_matrix(DATA / "pilot_test_set.xlsx", "pilot_v1", "HCM"))
    pilots += list(load_matrix(DATA / "pilot_v2/pilot_v2.xlsx", "pilot_v2"))
    pilot_dir = DATA / "pilot_v2/by_province"
    for file in sorted(pilot_dir.glob("test_matrix_*.xlsx")):
        pilots.extend(load_matrix(file, "pilot_v2_by_province", file.stem.rsplit("_", 1)[-1]))
    index = defaultdict(set)
    for version, rows in sets.items():
        for row in rows:
            index[row["test_id"], row["question"]].add(version)
    keyed = {v: {(r["province"], r["test_id"]): r for r in rows} for v, rows in sets.items()}
    if any(len(keyed[v]) != len(sets[v]) for v in sets):
        raise ValueError("Duplicate province/test_id within a matrix version")
    differences = []
    compared_fields = ("question", "category", "expected_answer", "must_contain", "must_not_contain")
    for province, test_id in sorted(set(keyed["offical"]) | set(keyed["cohere"])):
        one = keyed["offical"].get((province, test_id), {})
        two = keyed["cohere"].get((province, test_id), {})
        changed = [field for field in compared_fields if one.get(field) != two.get(field)]
        if changed or not (one and two):
            differences.append(dict(province=province, test_id=test_id, offical_question=one.get("question", ""),
                                    cohere_question=two.get("question", ""), changed_fields="|".join(changed),
                                    presence="both" if one and two else "offical" if one else "cohere"))
    batches, extra = match_batches(index)
    publish(ROOT / "research/data/legacy", {
        **{f"legacy_{k}.jsonl": jsonl(v) for k, v in sets.items()},
        "historical_pilots.jsonl": jsonl(pilots), "batch_unmatched_questions.jsonl": jsonl(extra),
    })
    publish(ROOT / "research/reports", {
        "legacy_differences.csv": csv_bytes(differences, list(differences[0])),
        "legacy_batch_matches.csv": csv_bytes(batches, list(batches[0])),
    })
    print({**{k: len(v) for k, v in sets.items()}, "pilot_rows": len(pilots), "different_ids": len(differences),
           "batch_files": len(batches), "batch_unmatched_unique_keys": len(extra)})


if __name__ == "__main__":
    main()
