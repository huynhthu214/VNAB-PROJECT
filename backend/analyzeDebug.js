// Chạy: node analyzeDebug.js [đường_dẫn/prompt_debug.jsonl]
// Phân loại mỗi dòng log theo giá trị llm_raw.
const fs = require("fs");
const f = process.argv[2] || "prompt_debug.jsonl";
const rows = fs.readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
const cls = (r) =>
  r.llm_raw == null || String(r.llm_raw).trim() === "" ? "A_RONG (loi ha tang)"
  : String(r.llm_raw).trim() === "KHONG_CO_DU_LIEU" ? "B_TU_CHOI (LLM noi khong du du lieu)"
  : "C_CO_CAU_TRA_LOI";
const count = {};
for (const r of rows) {
  const k = `${r.provider} | ${cls(r)}`;
  count[k] = (count[k] || 0) + 1;
}
console.log("Tổng dòng log:", rows.length);
console.table(count);
console.log("\n--- Chi tiết các dòng KHÔNG phải câu trả lời ---");
for (const r of rows.filter((r) => cls(r) !== "C_CO_CAU_TRA_LOI")) {
  console.log(`\n[${cls(r)}] score=${r.top_score} doc=${r.top_doc}`);
  console.log("  gốc    :", r.question);
  console.log("  viết lại:", r.rewritten_question);
}
