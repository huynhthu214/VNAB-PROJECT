"""Audit the approved local Excel and TXT sources without accessing PostgreSQL."""

import argparse
import csv
import hashlib
import io
import json
import posixpath
import re
import unicodedata
import xml.etree.ElementTree as ET
from collections import Counter, defaultdict
from pathlib import Path
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
WORKBOOKS = {
    "du_lieu_tphcm_final_v2.xlsx": ("TP.HCM", 1685),
    "dong_nai_data_collection.xlsx": ("Đồng Nai", 1662),
    "tay_ninh_data_collection.xlsx": ("Tây Ninh", 1682),
    "can_tho_data_collection.xlsx": ("Cần Thơ", 1668),
    "vinh_long_data_collection.xlsx": ("Vĩnh Long", 1687),
    "dong_thap_data_collection.xlsx": ("Đồng Tháp", 1663),
    "an_giang_data_collection.xlsx": ("An Giang", 1654),
    "ca_mau_data_collection.xlsx": ("Cà Mau", 1655),
}
MERGES = {
    "toàn bộ": "toan_bo",
    "một phần": "mot_phan",
    "không sắp xếp": "khong_sap_xep",
    "sắp xếp toàn bộ xã thổ châu thành đặc khu thổ châu": "chuyen_doi",
}
LABELS = (*MERGES.values(), "unknown")
S_OLD = "Phường/Xã cũ"
S_DISTRICT = "Quận/Huyện cũ"
S_PROVINCE = "Tỉnh/TP cũ (trước sáp nhập)"
S_NEW = "Phường/Xã mới (từ 1/7/2025)"
S_NEW_PROVINCE = "Tỉnh/TP mới"
S_CODE = "Mã phường/xã mới"
S_MERGE = "Hình thức sáp nhập"
S_TYPES = {"phường": "phuong", "xã": "xa", "đặc khu": "dac_khu"}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_text(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def stable_id(prefix, *parts):
    return prefix + "_" + digest(json_text(parts).encode("utf-8"))


def norm(value):
    return " ".join(unicodedata.normalize("NFC", value).casefold().split())


def province_key(value):
    value = re.sub(r"\s*\(\d+\)$", "", norm(value))
    return "thành phố hồ chí minh" if value == "tp. hồ chí minh" else value


def workbook(data):
    with ZipFile(io.BytesIO(data)) as archive:
        def xml(name):
            return ET.fromstring(archive.read(name))

        def rich_text(node):
            return "".join(t.text or "" for t in node.findall("{*}t") +
                           node.findall("{*}r/{*}t"))

        strings = []
        if "xl/sharedStrings.xml" in archive.namelist():
            strings = [rich_text(item) for item in xml("xl/sharedStrings.xml")]
        targets = {r.get("Id"): r.get("Target") for r in xml("xl/_rels/workbook.xml.rels")}
        sheets = {}
        for sheet in xml("xl/workbook.xml").findall(".//{*}sheet"):
            rel = next(v for k, v in sheet.attrib.items() if k.endswith("}id"))
            target = targets[rel]
            path = target.lstrip("/") if target.startswith("/") else posixpath.join("xl", target)
            rows = []
            for row in xml(path).findall(".//{*}sheetData/{*}row"):
                cells = {}
                for cell in row.findall("{*}c"):
                    value = cell.findtext("{*}v", default="")
                    if cell.get("t") == "s":
                        value = strings[int(value)]
                    if cell.get("t") == "inlineStr":
                        value = rich_text(cell.find("{*}is"))
                    if value.strip():
                        cells[cell.get("r").rstrip("0123456789")] = value
                if cells:
                    rows.append((int(row.get("r")), cells))
            header_row, header = rows[0] if rows else (None, {})
            sheets[sheet.get("name")] = (
                {"header_row": header_row, "header": header, "data_rows": max(0, len(rows) - 1)},
                [(n, {label: cells.get(col, "") for col, label in header.items()})
                 for n, cells in rows[1:]],
            )
        return sheets


def csv_bytes(rows, fields):
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fields)
    writer.writeheader()
    writer.writerows(rows)
    return buffer.getvalue().encode("utf-8")


def publish(directory, outputs):
    """Allow identical reruns. Require a new directory for a changed snapshot."""
    for name, data in outputs.items():
        path = directory / name
        if path.exists() and path.read_bytes() != data:
            raise SystemExit(f"Existing output differs: {path}. Use a new output directory.")
    directory.mkdir(parents=True, exist_ok=True)
    for name, data in outputs.items():
        path = directory / name
        if not path.exists():
            with path.open("xb") as file:
                file.write(data)


def document_code(number):
    return "202/2025/QH15" if number == 202 else f"{number}/NQ-UBTVQH15"


def read_legal(source, label, number):
    name = f"nghi_quyet_{number}.txt"
    data = (source / name).read_bytes()
    text = data.decode("utf-8-sig")
    # The 2025 texts place their document number before the recitals.
    heading = re.split(r"(?im)^\s*căn cứ\b", unicodedata.normalize("NFC", text), maxsplit=1)[0]
    code = document_code(number)
    articles = defaultdict(list)
    article = None
    points = 0
    for line in unicodedata.normalize("NFC", text).splitlines():
        match = re.match(r"^\s*Điều\s+(\d+)\s*[.:]", line, re.I)
        if match:
            article = match[1]
            articles[article]
        elif article:
            clause = re.match(r"^\s*(\d+)[.)]\s", line)
            if clause:
                articles[article].append(int(clause[1]))
            points += bool(re.match(r"^\s*[a-zđ]\)\s", line, re.I))
    return dict(source_file=f"backend/data/{name}", doc_code=code, source_sheet="", source_row="",
                code_in_heading=bool(re.search(re.escape(code), heading, re.I)),
                title=("Sắp xếp đơn vị hành chính cấp tỉnh" if number == 202
                       else f"Sắp xếp đơn vị hành chính cấp xã – {label}"),
                title_origin="inventory_label", encoding="UTF-8 BOM" if data.startswith(b"\xef\xbb\xbf") else "UTF-8",
                sha256=digest(data), line_count=len(text.splitlines()),
                article_numbers=json_text(list(articles)), clause_markers=json_text(dict(articles)),
                point_marker_count=points, context_origin="legal_original", full_text=text)


def audit(source):
    units, provinces, issues, inventory, files = [], [], [], [], []
    documents = [read_legal(source, "Cấp tỉnh", 202)]
    for filename, (label, number) in WORKBOOKS.items():
        path = f"backend/data/{filename}"
        data = (source / filename).read_bytes()
        sheets = workbook(data)
        documents.append(read_legal(source, label, number))
        units_start, provinces_start = len(units), len(provinces)
        files.append(dict(source_file=path, sha256=digest(data),
                          sheets={name: meta for name, (meta, _) in sheets.items()}))

        def issue(sheet, row, code, detail):
            issues.append(dict(province=label, source_file=path, source_sheet=sheet,
                               source_row=row, issue=code, detail=detail))

        required = {
            "XaPhuong": ("old_unit_name", "old_unit_type", "old_parent", "new_unit_name",
                         "new_unit_type", "new_parent", "decision_number", "source_document_url",
                         "merge_type", "review_status", "notes"),
            "Sheet1": (S_OLD, S_DISTRICT, S_PROVINCE, S_NEW, S_NEW_PROVINCE, S_CODE,
                       S_MERGE, "Loại đơn vị mới"),
            "Tinh": ("old_province_name", "new_province_name", "decision_number",
                     "decision_date", "effective_date", "source_document_url", "notes"),
        }
        for sheet, fields in required.items():
            headers = sheets[sheet][0]["header"].values()
            missing = sorted(set(fields) - set(headers))
            if missing or len(headers) != len(set(headers)):
                raise ValueError(f"{path}/{sheet}: missing={missing}, duplicate header check")

        province_pairs = Counter()
        for n, row in sheets["Tinh"][1]:
            pair = tuple(province_key(row[k]) for k in required["Tinh"][:2])
            province_pairs[pair] += 1
            if province_pairs[pair] > 1:
                issue("Tinh", n, "duplicate_province_pair", json_text(pair))
            if not all(row[k].strip() for k in required["Tinh"][:-1]):
                issue("Tinh", n, "missing_required", "Thiếu trường bắt buộc")
            if row["decision_number"].strip() != document_code(202):
                issue("Tinh", n, "unexpected_document", row["decision_number"])
            old, new = pair
            provinces.append(dict(
                mapping_id=stable_id("pm", path, "Tinh", n),
                old_province_id=stable_id("po", old) if old else "",
                new_province_id=stable_id("pn", new) if new else "",
                old_province=row["old_province_name"], new_province=row["new_province_name"],
                source_doc=row["decision_number"], source_url=row["source_document_url"],
                decision_date=row["decision_date"], effective_date=row["effective_date"],
                source_notes=row["notes"], article_no="", clause_no="", point_no="",
                source_file=path, source_sheet="Tinh", source_row=n, review_status="pending",
            ))

        def relation_key(old, district, new, province):
            return norm(old), norm(district), norm(new), province_key(province)

        sheet_index = defaultdict(list)
        for n, row in sheets["Sheet1"][1]:
            key = relation_key(row[S_OLD], row[S_DISTRICT], row[S_NEW], row[S_NEW_PROVINCE])
            sheet_index[key].append((n, row))
            absent = [k for k in required["Sheet1"] if not row[k].strip()]
            if absent:
                issue("Sheet1", n, "missing_required", json_text(absent))
            pair = province_key(row[S_PROVINCE]), province_key(row[S_NEW_PROVINCE])
            if province_pairs[pair] != 1:
                issue("Sheet1", n, "province_pair_not_unique_in_tinh", json_text(pair))

        xa_index = defaultdict(list)
        for n, row in sheets["XaPhuong"][1]:
            key = relation_key(row["old_unit_name"], row["old_parent"],
                               row["new_unit_name"], row["new_parent"])
            xa_index[key].append(n)
        for key, candidates in sheet_index.items():
            if key not in xa_index:
                for n, _ in candidates:
                    issue("Sheet1", n, "missing_xaphuong_match", json_text(key))
        sheet_pairs = {(province_key(r[S_PROVINCE]), province_key(r[S_NEW_PROVINCE]))
                       for _, r in sheets["Sheet1"][1]}
        for n, row in sheets["Tinh"][1]:
            pair = tuple(province_key(row[k]) for k in required["Tinh"][:2])
            if pair not in sheet_pairs:
                issue("Tinh", n, "province_pair_missing_in_sheet1", json_text(pair))

        for n, row in sheets["XaPhuong"][1]:
            key = relation_key(row["old_unit_name"], row["old_parent"],
                               row["new_unit_name"], row["new_parent"])
            matches = sheet_index.get(key, [])
            sheet_row, partner = "", {}
            if all(key) and len(matches) == len(xa_index[key]) == 1:
                sheet_row, partner = matches[0]
            else:
                issue("XaPhuong", n, "unresolved_sheet1_join",
                      json_text({"key": key, "sheet1_rows": [i for i, _ in matches],
                                 "xaphuong_rows": xa_index[key]}))
            if len(xa_index[key]) > 1:
                issue("XaPhuong", n, "duplicate_relation_key", json_text(xa_index[key]))
            missing = [k for k in required["XaPhuong"] if k != "notes" and not row[k].strip()]
            if missing:
                issue("XaPhuong", n, "missing_required", json_text(missing))
            category = MERGES.get(norm(row["merge_type"]), "unknown")
            if category in {"chuyen_doi", "unknown"}:
                issue("XaPhuong", n, "verify_merge_label", row["merge_type"])
            old_province = partner.get(S_PROVINCE, "")
            old_key = province_key(old_province), key[1], key[0]
            code = partner.get(S_CODE, "").strip()
            if partner:
                if province_pairs[(old_key[0], key[3])] != 1:
                    issue("XaPhuong", n, "joined_province_pair_not_unique_in_tinh", str(sheet_row))
                partner_type = S_TYPES.get(norm(partner["Loại đơn vị mới"]))
                if partner_type != norm(row["new_unit_type"]):
                    issue("XaPhuong", n, "new_unit_type_disagreement", str(sheet_row))
                sheet_merge = norm(partner[S_MERGE])
                sheet_category = {"nhập toàn bộ": "toan_bo", "hợp nhất toàn bộ": "toan_bo",
                                  "nhập một phần": "mot_phan", "hợp nhất một phần": "mot_phan"}.get(
                                      sheet_merge, MERGES.get(sheet_merge))
                if sheet_category != category:
                    issue("XaPhuong", n, "sheet1_merge_label_check", json_text(
                        {"sheet1_row": sheet_row, "sheet1_label": partner[S_MERGE],
                         "xaphuong_label": row["merge_type"]}))
            if row["decision_number"].strip() != document_code(number):
                issue("XaPhuong", n, "unexpected_document", row["decision_number"])
            units.append(dict(
                mapping_id=stable_id("um", path, "XaPhuong", n),
                old_unit_id=stable_id("uo", *old_key) if all(old_key) else "",
                old_unit_name=row["old_unit_name"], old_unit_type=row["old_unit_type"],
                old_district=row["old_parent"], old_province=old_province,
                old_unit_code=partner.get("Mã phường/xã cũ", ""),
                new_unit_id=stable_id("un", key[3], code) if key[3] and code else "",
                new_unit_name=row["new_unit_name"], new_unit_type=row["new_unit_type"],
                new_province=row["new_parent"], new_unit_code=code,
                merge_type_raw=row["merge_type"], merge_type=category,
                source_doc=row["decision_number"], source_url=row["source_document_url"],
                article_no="", clause_no="", point_no="", source_file=path,
                source_sheet="XaPhuong", source_row=n, sheet1_row=sheet_row,
                sheet1_merge_type_raw=partner.get(S_MERGE, ""),
                review_status="pending", source_review_status=row["review_status"],
                source_notes=row["notes"], context_origin="mapping",
            ))
        local_units = units[units_start:]
        local_provinces = provinces[provinces_start:]
        targets, origins, old_names, new_codes = (defaultdict(set) for _ in range(4))
        for row in local_units:
            old, new = row["old_unit_id"], row["new_unit_id"]
            if old:
                old_names[norm(row["old_unit_name"])].add(old)
            if new:
                new_codes[new].add((norm(row["new_unit_name"]), norm(row["new_unit_type"])))
            if old and new:
                targets[old].add(new)
                origins[new].add(old)
        for row in local_units:
            if len(new_codes.get(row["new_unit_id"], ())) > 1:
                issue("XaPhuong", row["source_row"], "new_code_identity_conflict", row["new_unit_code"])
        counts = Counter(row["merge_type"] for row in local_units)
        inventory.append(dict(
            province=label, workbook=path, source_rows=len(local_units),
            old_units_resolved=len({r["old_unit_id"] for r in local_units if r["old_unit_id"]}),
            new_units_resolved=len(new_codes),
            sheet1_new_codes=len({r[S_CODE].strip() for _, r in sheets["Sheet1"][1] if r[S_CODE].strip()}),
            province_rows=len(local_provinces), joined_rows=sum(bool(r["sheet1_row"]) for r in local_units),
            old_multiple_targets=sum(len(v) > 1 for v in targets.values()),
            new_multiple_origins=sum(len(v) > 1 for v in origins.values()),
            old_homonyms=sum(len(v) > 1 for v in old_names.values()),
            unit_source_documents=len({r["source_doc"].strip() for r in local_units if r["source_doc"].strip()}),
            unit_source_urls=len({r["source_url"].strip() for r in local_units if r["source_url"].strip()}),
            province_source_documents=len({r["source_doc"].strip() for r in local_provinces if r["source_doc"].strip()}),
            province_source_urls=len({r["source_url"].strip() for r in local_provinces if r["source_url"].strip()}),
            **{k: counts[k] for k in LABELS},
            merge_type_raw_counts=json_text(dict(Counter(r["merge_type_raw"] for r in local_units))),
        ))

    homonyms, new_homonyms = defaultdict(set), defaultdict(set)
    for row in units:
        if row["old_unit_id"]:
            homonyms[norm(row["old_unit_name"])].add(
                (province_key(row["old_province"]), norm(row["old_district"])))
        if row["new_unit_id"]:
            new_homonyms[norm(row["new_unit_name"])].add(province_key(row["new_province"]))
    for row in units:
        places = homonyms[norm(row["old_unit_name"])]
        if row["old_unit_id"] and len(places) > 1:
            issues.append(dict(province=row["new_province"], source_file=row["source_file"],
                               source_sheet=row["source_sheet"], source_row=row["source_row"],
                               issue="old_name_multiple_locations", detail=json_text(sorted(places))))
        new_places = new_homonyms[norm(row["new_unit_name"])]
        if row["new_unit_id"] and len(new_places) > 1:
            issues.append(dict(province=row["new_province"], source_file=row["source_file"],
                               source_sheet=row["source_sheet"], source_row=row["source_row"],
                               issue="new_name_multiple_provinces", detail=json_text(sorted(new_places))))
    for document in documents:
        if not document["code_in_heading"] or document["article_numbers"] == "[]":
            issues.append(dict(province="", source_file=document["source_file"], source_sheet="",
                               source_row="", issue="verify_legal_structure",
                               detail=document["doc_code"]))
    urls = defaultdict(set)
    for row in units + provinces:
        if row["source_doc"].strip() and row["source_url"].strip():
            urls[row["source_doc"].strip()].add(row["source_url"].strip())
    for document in documents:
        links = sorted(urls[document["doc_code"]])
        document["source_url"] = links[0] if len(links) == 1 else ""
        document["source_urls"] = json_text(links)
    return units, provinces, documents, inventory, issues, files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-dir", type=Path, default=ROOT / "backend/data")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "research/reports")
    args = parser.parse_args()
    units, provinces, docs, inventory, issues, files = audit(args.source_dir)
    document_metadata = [{k: v for k, v in doc.items() if k != "full_text"} for doc in docs]
    fields = ["province", "source_file", "source_sheet", "source_row", "issue", "detail"]
    publish(args.output_dir, {
        "inventory.csv": csv_bytes(inventory, list(inventory[0])),
        "data_issues.csv": csv_bytes(issues, fields),
        "source_structure.json": (json.dumps({"workbooks": files, "legal_documents": document_metadata},
                                             indent=2, ensure_ascii=False) + "\n").encode("utf-8"),
    })
    print(f"workbooks={len(files)} unit_rows={len(units)} province_rows={len(provinces)} "
          f"legal_documents={len(docs)} issues={len(issues)}")


if __name__ == "__main__":
    main()
