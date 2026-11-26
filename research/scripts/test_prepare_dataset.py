"""Synthetic regression tests for Unicode evidence, generation and handoff."""
import io
import unittest
import unicodedata
from zipfile import ZipFile

from build_pilot import legal_evidence, review_row, to_mrc
from import_pilot_review import apply_reviews
from prepare_dataset import archive, generate, generate_pool, handoff, split_samples
from validate_pilot import check_qa, schemas, span_valid


def mapping(mid, old, new, merge="toan_bo"):
    return dict(mapping_id=mid, old_unit_id=old, new_unit_id=new, old_unit_name=f"Xã {old}",
                new_unit_name=f"Xã {new}", old_district="Huyện Mẫu (101)",
                old_province="Tỉnh Mẫu (11)", new_province="Tỉnh Mẫu", source_doc="MẪU",
                source_url="https://example.invalid", merge_type=merge,
                merge_type_raw="toàn bộ" if merge == "toan_bo" else "một phần",
                sheet1_merge_type_raw="Nhập toàn bộ" if merge == "toan_bo" else "Nhập một phần",
                old_unit_code="0001", new_unit_code="0002",
                source_file="fixture.xlsx", source_sheet="XaPhuong", source_row="2")


class DatasetTests(unittest.TestCase):
    def test_decomposed_evidence_and_partial_guard(self):
        row = mapping("m1", "Hòa", "Thành")
        text = ("Điều 1. Mẫu\n1. Sắp xếp toàn bộ xã Hòa, một phần xã Bình "
                "thành xã mới có tên gọi là xã Thành.\nĐiều 2. Mẫu")
        text = unicodedata.normalize("NFD", text)
        doc = {"full_text": text}
        context, answer, start, _, _, offset = legal_evidence(row, doc)
        self.assertEqual(context, text[offset:offset + len(context)])
        self.assertNotEqual(answer, unicodedata.normalize("NFC", answer))
        self.assertTrue(span_valid(context, answer, start))
        self.assertIsNone(legal_evidence(mapping("m2", "Bình", "Thành"), doc))

    def test_generated_qa_and_hash_review(self):
        rows = [mapping("m1", "A", "C", "mot_phan"), mapping("m2", "A", "D", "mot_phan"),
                mapping("m3", "B", "C"), mapping("m4", "E", "F"), mapping("m5", "G", "F")]
        generated = list(generate({"group_id": "g"}, rows, {}, "fixture"))
        self.assertEqual({q["type"] for q in generated}, set("T" + str(i) for i in range(1, 8)))
        qa_schema, _ = schemas()
        for q in generated:
            check_qa(q, qa_schema)
            self.assertNotIn("(101)", q["question"])
        sample = next(q for q in generated if q["type"] == "T2")
        self.assertEqual(set(sample["new_unit_ids"]), {"C", "D"})
        review = {**review_row(sample), "review_decision": "approve"}
        verified = apply_reviews([sample], [review], "fixture", "2026-11-26T21:00:00+07:00")
        self.assertEqual(verified[0]["review_status"], "verified")
        with self.assertRaisesRegex(ValueError, "Stale"):
            apply_reviews([{**sample, "answer_text": "changed"}], [review], "fixture", "2026-11-26T21:00:00+07:00")

    def test_pool_reservation_and_review_metadata(self):
        kept = mapping("a", "Bình", "Hòa")
        held = mapping("b", "Khác", "Mới")
        groups = [dict(group_id=gid, mapping_ids=[row["mapping_id"]], touches_quarantine=False,
                       provinces=["Tỉnh Mẫu"], merge_counts={"toan_bo": 1})
                  for gid, row in (("keep", kept), ("reserved", held))]
        samples = generate_pool(groups, {"a": kept, "b": held}, {}, "fixture", {"reserved"}, 10)
        self.assertTrue(samples)
        self.assertEqual({q["group_id"] for q in samples}, {"keep"})
        self.assertEqual(samples[0]["provenance"]["evidence"]["unit_metadata"][0]["new_unit_code"], "0002")
        self.assertTrue(all(q["review_status"] == "pending" for q in samples))
        self.assertEqual(generate_pool(groups, {"a": kept, "b": held}, {}, "fixture", {"reserved"}, 10,
                                       quarantined={"a"}), [])

    def test_split_and_archive(self):
        def sample(id_, groups, source, start, end):
            return dict(id=id_, group_id=groups[0], type="T1", province="Tỉnh Mẫu",
                        context_origin="legal_original", question=f"Câu {id_}", context=f"Đáp án {id_}",
                        answer_start=0, answer_text="Đáp án", old_unit_ids=[], new_unit_ids=[], mapping_ids=[],
                        source_doc=None, article_clause=None, answerable=True, review_status="verified",
                        provenance={"related_group_ids": groups, "evidence": {
                            "kind": "txt_excerpt", "file": source, "sha256": "fixture",
                            "start": start, "end": end}})

        samples = [sample("a", ["g1", "g2"], "A", 0, 50), sample("b", ["g2"], "B", 1, 2),
                   sample("c", ["g3"], "A", 49, 100), sample("d", ["g4"], "A", 100, 200)]
        train, dev = split_samples(samples, 10)
        self.assertIn({"a", "b", "c"}, [{q["id"] for q in train}, {q["id"] for q in dev}])
        self.assertEqual((train, dev), split_samples(samples, 10))
        self.assertEqual(to_mrc(samples[0])["answers"]["answer_start"], [0])
        files = handoff(train, dev, "fixture", "fixture", 10)
        content = archive(files)
        self.assertEqual(content, archive(files))
        with ZipFile(io.BytesIO(content)) as zip_file:
            self.assertFalse(any("test" in name or "reservation" in name for name in zip_file.namelist()))
            self.assertEqual(set(zip_file.namelist()), set(files))
        pilot_files = handoff(train, dev, "pilot-fixture", "fixture", 10, pilot=True)
        self.assertEqual(set(pilot_files), {
            "qa_train.jsonl", "qa_dev.jsonl", "mrc_train.jsonl", "mrc_dev.jsonl",
            "qa.schema.json", "mrc.schema.json", "split_manifest.csv", "validation_report.json",
            "checksums.sha256", "README.md",
        })
        self.assertIn(b'"review_status": "verified"', pilot_files["mrc_train.jsonl"])


if __name__ == "__main__":
    unittest.main()
