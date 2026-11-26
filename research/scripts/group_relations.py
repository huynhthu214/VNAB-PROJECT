"""Build relation components and optionally export a private reservation proposal."""
import argparse
import csv
import json
import re
import statistics
import unicodedata
from collections import Counter, defaultdict, deque
from pathlib import Path

from import_legacy import jsonl
from inventory_sources import ROOT, csv_bytes, digest, publish, stable_id

RAW = ROOT / "research/data/raw"
GROUPS = ROOT / "research/data/groups"
LEGACY = ROOT / "research/data/legacy"
QUARANTINE = {("du_lieu_tphcm_final_v2.xlsx", "494"),
              ("tay_ninh_data_collection.xlsx", "36"),
              ("an_giang_data_collection.xlsx", "299")}


def read_csv(path):
    with path.open(encoding="utf-8-sig", newline="") as file:
        return list(csv.DictReader(file))


def read_jsonl(path):
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def snapshot():
    manifest = json.loads((RAW / "source_manifest.json").read_text(encoding="utf-8"))
    for name, meta in manifest["outputs"].items():
        path = RAW / name
        if digest(path.read_bytes()) != meta["sha256"] or len(read_csv(path)) != meta["rows"]:
            raise ValueError(f"Snapshot mismatch in {name}")
    return read_csv(RAW / "unit_mapping.csv"), manifest


def nodes(row):
    return ("old", row["old_unit_id"]), ("new", row["new_unit_id"])


def components(rows):
    adjacency = defaultdict(set)
    for row in rows:
        old, new = nodes(row)
        adjacency[old].add(new)
        adjacency[new].add(old)
    by_node = {}
    for node in sorted(adjacency):
        if node in by_node:
            continue
        found = {node}
        queue = deque([node])
        while queue:
            for neighbor in adjacency[queue.popleft()] - found:
                found.add(neighbor)
                queue.append(neighbor)
        group = stable_id("grp", *sorted(found))
        by_node.update(dict.fromkeys(found, group))
    return by_node


def folded(value):
    text = unicodedata.normalize("NFD", str(value or "").casefold()).replace("đ", "d")
    return tuple(re.findall(r"[^\W_]+", "".join(c for c in text if unicodedata.category(c) != "Mn")))


def aliases(value):
    term = folded(value)
    result = {term} if term else set()
    for prefix in (("xa",), ("phuong",), ("thi", "tran"), ("dac", "khu"), ("huyen",)):
        if term[:len(prefix)] == prefix and len(term) - len(prefix) >= 2:
            result.add(term[len(prefix):])
    return result


def mention_index(rows, by_node):
    index = defaultdict(set)
    for row in rows:
        group = by_node[nodes(row)[0]]
        for field in ("old_unit_name", "new_unit_name"):
            for term in aliases(row[field]):
                index[term].add(group)
    return dict(index)


def matched_groups(index, values):
    lengths = {len(term) for term in index}
    groups = set()
    for value in values:
        tokens = folded(value)
        for length in lengths:
            for start in range(len(tokens) - length + 1):
                groups.update(index.get(tokens[start:start + length], ()))
    return groups


def partition(rows, issues):
    uncertain = {(r["source_file"], r["source_row"]) for r in issues
                 if r["source_sheet"] == "XaPhuong" and r["issue"] in {
                     "unresolved_sheet1_join", "new_code_identity_conflict", "duplicate_relation_key",
                     "joined_province_pair_not_unique_in_tinh", "unexpected_document", "missing_required"}}
    accepted, isolated = [], []
    for row in rows:
        path, number = row["source_file"], row["source_row"]
        invalid = ((Path(path).name, number) in QUARANTINE or (path, number) in uncertain
                   or not row["old_unit_id"] or not row["new_unit_id"]
                   or row["merge_type"] in {"unknown", "chuyen_doi"})
        (isolated if invalid else accepted).append(row)
    return accepted, isolated


def proposal(groups, limit=40):
    provinces = defaultdict(deque)
    eligible = [g for g in groups if g["reservation_eligibility"] == "candidate"]
    for group in sorted(eligible, key=lambda g: (-g["mapping_count"], g["group_id"])):
        provinces[group["provinces"][0]].append(group)
    selected = []
    while len(selected) < limit and any(provinces.values()):
        for name in sorted(provinces):
            if provinces[name] and len(selected) < limit:
                selected.append(provinces[name].popleft())
    return selected


def private_export(path, selected, fingerprint):
    path = path.resolve()
    if path.is_relative_to(ROOT):
        raise ValueError("Reservation must be outside the repository")
    publish(path.parent, {path.name: (json.dumps({
        "status": "proposed", "source_fingerprint_sha256": fingerprint,
        "group_ids": [g["group_id"] for g in selected],
        "groups": [{k: g[k] for k in ("group_id", "provinces", "mapping_count", "old_count", "new_count")}
                   for g in selected],
    }, ensure_ascii=False, indent=2) + "\n").encode("utf-8")})


def build():
    rows, manifest = snapshot()
    clean, isolated = partition(rows, read_csv(ROOT / "research/reports/data_issues.csv"))
    by_node = components(clean)
    index = mention_index(clean, by_node)
    grouped = defaultdict(list)
    for row in clean:
        grouped[by_node[nodes(row)[0]]].append(row)
    uncertain_groups = {by_node[node] for row in isolated for node in nodes(row) if node in by_node}
    for row in isolated:
        uncertain_groups |= matched_groups(index, (row["old_unit_name"], row["new_unit_name"]))
    mentions = defaultdict(Counter)
    probe_rows = []
    for path in sorted(LEGACY.glob("*.jsonl")):
        for row in read_jsonl(path):
            fields = ("question", "old_unit_name", "expected_answer", "must_contain")
            hit = matched_groups(index, (row.get(k) for k in fields))
            for group in hit:
                mentions[group][row["version"]] += 1
            probe_rows.append(dict(version=row["version"], test_id=row["test_id"], question=row["question"],
                                   status="multi_group" if len(hit) > 1 else "name_signal" if hit else "unresolved",
                                   group_ids=sorted(hit), provenance=row["provenance"]))
    groups = []
    for group, members in sorted(grouped.items()):
        labels = Counter(r["merge_type"] for r in members)
        provinces = sorted({r["new_province"] for r in members})
        reason = ("historical_name_signal" if mentions[group] else
                  "touches_quarantine" if group in uncertain_groups else
                  "scope_or_label_requires_review" if len(provinces) != 1 or labels["khong_sap_xep"] else
                  "candidate")
        groups.append(dict(group_id=group, provinces=provinces,
                           old_count=len({r["old_unit_id"] for r in members}),
                           new_count=len({r["new_unit_id"] for r in members}),
                           mapping_count=len(members), merge_counts=dict(labels),
                           mapping_ids=[r["mapping_id"] for r in members], historical_signals=dict(mentions[group]),
                           touches_quarantine=group in uncertain_groups, reservation_eligibility=reason))
    return clean, isolated, groups, probe_rows, manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--private-output", type=Path, help="Optional proposal JSON path outside the repository")
    parser.add_argument("--reservation-limit", type=int, default=40)
    args = parser.parse_args()
    if args.reservation_limit < 1:
        parser.error("--reservation-limit must be positive")
    rows, isolated, groups, probes, manifest = build()
    selected = proposal(groups, args.reservation_limit)
    sizes = [g["mapping_count"] for g in groups]
    summary = dict(component_count=len(groups), clean_rows=len(rows), isolated_rows=len(isolated),
                   min_edges=min(sizes), median_edges=statistics.median(sizes), max_edges=max(sizes),
                   groups_by_edge_count=dict(sorted(Counter(sizes).items())),
                   partial_groups=sum("mot_phan" in g["merge_counts"] for g in groups),
                   historical_signal_groups=sum(bool(g["historical_signals"]) for g in groups),
                   matrix_or_pilot_signal_groups=sum(any(v != "batch_unmatched" for v in g["historical_signals"]) for g in groups),
                   eligible_provisional=sum(g["reservation_eligibility"] == "candidate" for g in groups),
                   proposal_count=len(selected), proposal_by_province=dict(Counter(g["provinces"][0] for g in selected)),
                   historical_probe_status=dict(Counter(r["status"] for r in probes)),
                   historical_status_by_version={v: dict(Counter(r["status"] for r in probes if r["version"] == v))
                                                 for v in sorted({r["version"] for r in probes})})
    publish(GROUPS, {"relation_groups.jsonl": jsonl(groups), "historical_group_signals.jsonl": jsonl(probes),
                     "quarantined_mappings.csv": csv_bytes(isolated, list(isolated[0]))})
    publish(ROOT / "research/reports", {"group_summary.json": (json.dumps(summary, ensure_ascii=False, indent=2)
                                                              + "\n").encode("utf-8")})
    if args.private_output:
        private_export(args.private_output, selected, manifest["source_fingerprint_sha256"])
    print(json.dumps(summary, ensure_ascii=True))


if __name__ == "__main__":
    main()
