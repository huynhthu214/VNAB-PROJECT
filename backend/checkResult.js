// Chạy: node checkResult.js questions_t1_hcm_full.json result_cohere_advanced_rag.json
const fs = require("fs");
const [qf, rf] = process.argv.slice(2);
const qs = JSON.parse(fs.readFileSync(qf, "utf8"));
const rs = JSON.parse(fs.readFileSync(rf, "utf8"));
const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .normalize("NFC");
const byId = new Map(qs.map((q) => [q.test_id, q]));
const tally = { DUNG: 0, SAI: 0, TU_CHOI: 0, LOI_HA_TANG: 0 };
for (const r of rs) {
  const q = byId.get(r.test_id);
  let v;
  if (r.success === false || r.error) v = "LOI_HA_TANG";
  else if (r.answer_type === "no_answer" || !r.answer) v = "TU_CHOI";
  else {
    const a = norm(r.answer);
    const okIn = (q.must_contain || []).every((x) => a.includes(norm(x)));
    const badIn = (q.must_not_contain || []).some((x) => a.includes(norm(x)));
    v = okIn && !badIn ? "DUNG" : "SAI";
  }
  tally[v]++;
  console.log(`${v.padEnd(11)} ${r.test_id}  ${r.question}`);
  if (v === "SAI")
    console.log(
      `   cần chứa: ${q.must_contain.join(" | ")}\n   trả lời : ${r.answer}`,
    );
}
console.log("\nTổng kết:", tally, "trên", rs.length, "câu");
