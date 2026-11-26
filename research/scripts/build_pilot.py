"""Build pending pilot candidates after excluding the provisional reservation."""
import argparse
import json
import re
import unicodedata
from collections import Counter, defaultdict
from functools import lru_cache
from pathlib import Path

from group_relations import GROUPS, RAW, folded, matched_groups, read_csv, read_jsonl, snapshot
from import_legacy import jsonl
from inventory_sources import ROOT, csv_bytes, digest, json_text, publish, stable_id

PILOT = ROOT / "research/data/pilot"
PROVINCES = ("TP. Hồ Chí Minh", "Tỉnh Đồng Nai", "Tỉnh Tây Ninh", "Thành phố Cần Thơ",
             "Tỉnh Vĩnh Long", "Tỉnh Đồng Tháp", "Tỉnh An Giang", "Tỉnh Cà Mau")
MARKER = re.compile(r"(?im)^\s*(?:Điều\s+(?P<article>\d+)\s*[.:]|(?P<clause>\d+)\s*[.)][ \t]+)")
DESTINATION = re.compile(r"\bthành\s+(?:xã|phường|đặc khu)\s+(?:mới\s+)?có\s+tên\s+gọi\s+là\s+", re.I)
PARTIAL = re.compile(r"\bmột\s+phần\b", re.I)
WHOLE = re.compile(r"\btoàn\s+bộ\b", re.I)


def nfc(text):
    return unicodedata.normalize("NFC", text)


class NormalizedText:
    """Map NFC boundaries through canonical decomposition to the original text."""

    def __init__(self, original):
        self.original = original
        self.text = nfc(original)
        self.offsets = None
        if self.text != original:
            boundaries = {0: 0}
            position = 0
            for index, character in enumerate(original, 1):
                position += len(unicodedata.normalize("NFD", character))
                boundaries[position] = index
            self.offsets = [0]
            position = 0
            for character in self.text:
                position += len(unicodedata.normalize("NFD", character))
                self.offsets.append(boundaries.get(position))

    def slice(self, start, end):
        if self.offsets is None:
            return start, self.original[start:end]
        low, high = self.offsets[start], self.offsets[end]
        if low is None or high is None or nfc(self.original[low:high]) != self.text[start:end]:
            raise ValueError("NFC match does not align with original text boundaries")
        return low, self.original[low:high]


@lru_cache(maxsize=16)
def passages(text):
    view = NormalizedText(text)
    markers = list(MARKER.finditer(view.text))
    article = None
    result = []
    for index, marker in enumerate(markers):
        if marker["article"]:
            article = int(marker["article"])
            continue
        if article != 1:
            continue
        end = markers[index + 1].start() if index + 1 < len(markers) else len(view.text)
        start, raw = view.slice(marker.start(), end)
        context = raw.strip()
        result.append((article, int(marker["clause"]), start + len(raw) - len(raw.lstrip()), context))
    return tuple(result)


def name_regex(name):
    return re.compile(r"(?<!\w)" + r"\s+".join(re.escape(word) for word in nfc(name).split()) + r"(?!\w)", re.I)


def legal_evidence(row, document):
    """Require old entity in the whole-area source phrase and new entity as the destination."""
    old, new = name_regex(row["old_unit_name"]), name_regex(row["new_unit_name"])
    candidates = []
    for article, clause, offset, context in passages(document["full_text"]):
        view = NormalizedText(context)
        target = DESTINATION.search(view.text)
        if not target:
            continue
        answer = new.match(view.text, target.end())
        if not answer:
            continue
        whole = WHOLE.search(view.text, 0, target.start())
        if not whole:
            continue
        partial = PARTIAL.search(view.text, whole.end(), target.start())
        if not old.search(view.text, whole.end(), partial.start() if partial else target.start()):
            continue
        answer_start, answer_text = view.slice(*answer.span())
        candidates.append((context, answer_text, answer_start, article, clause, offset))
    return candidates[0] if len(candidates) == 1 else None


def location(row):
    return f'{row["old_unit_name"]} ({row["old_district"]}, {row["old_province"]})'


def mapping_context(rows):
    labels = {"toan_bo": "toàn bộ", "mot_phan": "một phần"}
    return "\n".join(f'{location(row)} → {row["new_unit_name"]} ({row["new_province"]})'
                     f' — {labels[row["merge_type"]]}.' for row in rows)


def make_sample(group_ids, kind, question, context, answer, rows, snapshot_hash, action="answer",
                legal=None, evidence=None):
    group_id = group_ids[0] if group_ids else stable_id("scope", kind)
    entities = {}
    relations = []
    for row in rows:
        for side in ("old", "new"):
            entity_id = row[f"{side}_unit_id"]
            entities[entity_id] = {"id": entity_id, "name": row[f"{side}_unit_name"], "side": side}
        if action == "answer":
            relations.append({k: row[k] for k in ("mapping_id", "old_unit_id", "new_unit_id",
                                                 "merge_type_raw", "merge_type")})
    def single(key):
        values = {r[key] for r in rows}
        return next(iter(values)) if len(values) == 1 else None

    return dict(id=stable_id("qa", group_id, kind, question),
                province=single("new_province") or "Ngoài phạm vi", group_id=group_id,
                type=kind, question=question, context=context, context_origin="legal_original" if legal else "mapping",
                answer_text=answer, answer_start=legal["answer_start"] if legal else None,
                answerable=action == "answer", gold_entities=list(entities.values()), gold_relations=relations,
                mapping_ids=[r["mapping_id"] for r in rows],
                old_unit_ids=sorted({r["old_unit_id"] for r in rows}),
                new_unit_ids=sorted({r["new_unit_id"] for r in rows}),
                merge_type_raw=single("merge_type_raw") if action == "answer" else None,
                merge_type=single("merge_type") if action == "answer" else None,
                action=action, source_doc=single("source_doc"), source_url=single("source_url"),
                article_clause=legal["article_clause"] if legal else None,
                provenance=dict(snapshot_sha256=snapshot_hash, related_group_ids=group_ids,
                                evidence=legal["evidence"] if legal else evidence or {"kind": "mapping_rows"},
                                mapping_rows=[dict(mapping_id=r["mapping_id"], file=r["source_file"],
                                                   sheet=r["source_sheet"], row=int(r["source_row"])) for r in rows]),
                review_status="pending")


MRC_METADATA_FIELDS = ("group_id", "province", "type", "source_doc", "article_clause",
                       "context_origin", "answerable", "review_status")


def to_mrc(sample, *, metadata=False):
    record = dict(id=sample["id"], question=sample["question"], context=sample["context"],
                  answers={"text": [sample["answer_text"]], "answer_start": [sample["answer_start"]]})
    if metadata:
        record.update({field: sample[field] for field in MRC_METADATA_FIELDS})
    return record


def content_hash(sample):
    content = {k: v for k, v in sample.items() if k not in {"review_status", "review"}}
    return digest(json_text(content).encode("utf-8"))


def review_row(sample):
    return dict(id=sample["id"], province=sample["province"], type=sample["type"],
                group_id=sample["group_id"], question=sample["question"], answer_text=sample["answer_text"],
                context=sample["context"], context_origin=sample["context_origin"], source_doc=sample["source_doc"],
                article_clause=sample["article_clause"], source_url=sample["source_url"],
                evidence_file=sample["provenance"]["evidence"].get("file", "") or " | ".join(
                    dict.fromkeys(s["file"] for s in sample["provenance"]["evidence"].get("segments", []))),
                mapping_ids=" | ".join(sample["mapping_ids"]),
                span_check="PASS" if sample["answer_start"] is not None else "N/A",
                content_sha256=content_hash(sample), review_decision="", reviewer_note="")


def build(reservation):
    rows, manifest = snapshot()
    fingerprint = manifest["source_fingerprint_sha256"]
    private = json.loads(reservation.read_text(encoding="utf-8"))
    if reservation.resolve().is_relative_to(ROOT) or private["source_fingerprint_sha256"] != fingerprint:
        raise ValueError("Reservation must be private and for the current snapshot")
    if private["status"] not in {"proposed", "approved"} or not private["group_ids"]:
        raise ValueError("Missing reservation proposal or approved group IDs")
    reserved = set(private["group_ids"])
    groups = read_jsonl(GROUPS / "relation_groups.jsonl")
    if not reserved <= {g["group_id"] for g in groups}:
        raise ValueError("Unknown group in reservation")
    by_id = {r["mapping_id"]: r for r in rows}
    documents = {r["doc_code"]: r for r in read_csv(RAW / "legal_documents.csv")}
    bad = {g["group_id"] for g in groups if g["touches_quarantine"] or "khong_sap_xep" in g["merge_counts"]}
    reserved_index = defaultdict(set)
    for group in groups:
        if group["group_id"] not in reserved:
            continue
        for mapping_id in group["mapping_ids"]:
            row = by_id[mapping_id]
            for k in ("old_unit_name", "new_unit_name"):
                reserved_index[folded(row[k])].add(group["group_id"])
    pilot, available = [], defaultdict(list)
    used_groups, used_contexts = set(), set()
    for group in groups:
        gid = group["group_id"]
        if gid in reserved or gid in bad or "mot_phan" in group["merge_counts"]:
            continue
        members = [by_id[i] for i in group["mapping_ids"]]
        for row in members:
            document = documents.get(row["source_doc"])
            evidence = legal_evidence(row, document) if document else None
            if evidence:
                context, answer, start, article, clause, offset = evidence
                if matched_groups(reserved_index, (context,)):
                    continue
                available[row["new_province"]].append((gid, row, document, context, answer,
                                                       start, article, clause, offset))
                break
    for province in PROVINCES:
        count = 0
        for gid, row, document, context, answer, start, article, clause, offset in available[province]:
            if gid in used_groups or context in used_contexts:
                continue
            pilot.append(make_sample(
                [gid], "T1", f'{location(row)} được sắp xếp toàn bộ vào đơn vị nào của {province}?',
                context, answer, [row], fingerprint,
                legal={"answer_start": start, "article_clause": f"Điều {article}, khoản {clause}",
                       "evidence": {"kind": "txt_excerpt", "file": document["source_file"],
                                    "sha256": document["sha256"], "start": offset, "end": offset + len(context)}}))
            used_groups.add(gid)
            used_contexts.add(context)
            count += 1
            if count == 2:
                break

    for kind in ("T2", "T6"):
        for group in groups:
            gid = group["group_id"]
            if gid in reserved | bad | used_groups:
                continue
            by_old = defaultdict(list)
            for mapping_id in group["mapping_ids"]:
                row = by_id[mapping_id]
                by_old[row["old_unit_id"]].append(row)
            options = [members for members in by_old.values() if len(members) > 1 and
                       {r["merge_type"] for r in members} <= {"toan_bo", "mot_phan"} and
                       all(r["sheet1_merge_type_raw"] in {"Nhập một phần", "Hợp nhất một phần",
                                                         "Nhập toàn bộ", "Hợp nhất toàn bộ"}
                           for r in members)]
            if not options:
                continue
            members = options[0]
            context = mapping_context(members)
            if matched_groups(reserved_index, (context,)):
                continue
            subject = location(members[0])
            question = (f'{subject} được sắp xếp vào những đơn vị nào và theo hình thức nào?' if kind == "T2"
                        else f'{subject} được sắp xếp vào bao nhiêu đơn vị mới?')
            answers = [f'{r["new_unit_name"]} ({"một phần" if r["merge_type"] == "mot_phan" else "toàn bộ"})'
                       for r in members]
            answer = "; ".join(answers) if kind == "T2" else str(len({r["new_unit_id"] for r in members}))
            pilot.append(make_sample([gid], kind, question, context, answer, members, fingerprint))
            used_groups.add(gid)
            break

    homonyms = defaultdict(dict)
    for group in groups:
        for mapping_id in group["mapping_ids"]:
            row = by_id[mapping_id]
            homonyms[row["new_province"], folded(row["old_unit_name"])].setdefault(
                row["old_unit_id"], (group["group_id"], row))
    for (_, _), candidates in sorted(homonyms.items()):
        if len(candidates) < 2:
            continue
        gids = sorted({g for g, _ in candidates.values()})
        members = [r for _, r in candidates.values()]
        if set(gids) & (reserved | bad | used_groups):
            continue
        if len({r["old_district"] for r in members}) < 2:
            continue
        first = members[0]
        context = "\n".join(location(r) for r in members)
        if matched_groups(reserved_index, (context,)):
            continue
        pilot.append(make_sample(gids, "T8_ambiguous",
                                f'{first["old_unit_name"]} trong khu vực nay thuộc {first["new_province"]} '
                                "được sắp xếp vào đơn vị nào?",
                                context, "Bạn vui lòng cho biết quận/huyện cũ để xác định đúng đơn vị.",
                                members, fingerprint, "clarify"))
        break
    provinces = read_csv(RAW / "province_mapping.csv")
    scoped = sorted({r["new_province"] for r in provinces})
    pilot.append(make_sample([], "T8_out_of_scope", "Sau sắp xếp, đơn vị hành chính ở Tokyo thuộc đơn vị nào?",
                             "Phạm vi tỉnh/thành của bộ dữ liệu: " + "; ".join(scoped) + ".",
                             "Câu hỏi nằm ngoài phạm vi địa giới được bộ dữ liệu hỗ trợ.",
                             [], fingerprint, "abstain",
                             evidence={"kind": "snapshot_scope", "file": "research/data/raw/province_mapping.csv"}))
    return pilot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reservation", required=True, type=Path)
    args = parser.parse_args()
    pilot = build(args.reservation)
    mrc = [to_mrc(q) for q in pilot if q["answer_start"] is not None]
    sheet = [review_row(q) for q in pilot]
    publish(PILOT, {"qa_sample_candidates.jsonl": jsonl(pilot), "mrc_sample_candidates.jsonl": jsonl(mrc),
                    "pilot_review.csv": b"\xef\xbb\xbf" + csv_bytes(sheet, list(sheet[0]))})
    print(f"pending={len(pilot)} extractive={len(mrc)} types={dict(Counter(q['type'] for q in pilot))}")


if __name__ == "__main__":
    main()
