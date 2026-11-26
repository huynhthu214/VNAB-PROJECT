"""Export a deterministic UTF-8 snapshot of the audited mapping and legal sources."""

import argparse
import json
from datetime import date
from pathlib import Path

from inventory_sources import ROOT, audit, csv_bytes, digest, json_text, publish


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=ROOT / "backend/data")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "research/data/raw")
    parser.add_argument("--snapshot-date", type=date.fromisoformat, required=True,
                        help="Snapshot label in local time (YYYY-MM-DD).")
    parser.add_argument("--version", default="v1.0")
    args = parser.parse_args()
    units, provinces, documents, inventory, issues, files = audit(args.source_dir)
    tables = {"unit_mapping.csv": units, "province_mapping.csv": provinces,
              "legal_documents.csv": documents}
    outputs = {name: csv_bytes(rows, list(rows[0])) for name, rows in tables.items()}
    legal_files = [{key: doc[key] for key in
                    ("source_file", "doc_code", "code_in_heading", "encoding", "sha256", "line_count")}
                   for doc in documents]
    sources = files + legal_files
    fingerprint = digest(json_text([(s["source_file"], s["sha256"]) for s in sources]).encode("utf-8"))
    scripts = {}
    for name in ("inventory_sources.py", "export_sources.py"):
        path = Path(__file__).with_name(name)
        scripts[f"research/scripts/{name}"] = digest(path.read_bytes())
    manifest = dict(
        version=args.version, snapshot_date=args.snapshot_date.isoformat(),
        timezone="Asia/Ho_Chi_Minh", source_fingerprint_sha256=fingerprint,
        sources=sources, scripts_sha256=scripts,
        outputs={name: {"rows": len(rows), "sha256": digest(outputs[name])}
                 for name, rows in tables.items()},
        row_policy="One output row per nonempty XaPhuong or Tinh source row. Review flags are in data_issues.csv.",
        join_policy="One-to-one normalized old name, old district, new name and new province. No positional fallback.",
        id_policy="SHA-256 of namespaced keys; mapping uses source path, sheet and Excel row; "
                  "old unit uses old province, old district and old name; new unit uses new province and code.",
        null_policy="An empty CSV field represents a missing value. Unresolved fields remain empty.",
        db_status="NOT RUN",
        inventory_totals={"workbooks": len(files), "sheet1_new_codes": sum(r["sheet1_new_codes"] for r in inventory),
                          "issue_rows": len(issues)},
    )
    outputs["source_manifest.json"] = (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    publish(args.output_dir, outputs)
    print(f"version={args.version} source_sha256={fingerprint} units={len(units)} "
          f"province_rows={len(provinces)} legal_documents={len(documents)}")


if __name__ == "__main__":
    main()
