// Chạy trong thư mục có safeRewrite.js:  node analyzeRewrite.js prompt_debug.jsonl
// Với mỗi dòng log, hỏi: safeRewrite có chặn câu viết lại này không? rồi đối chiếu với việc LLM từ chối.
const fs = require("fs");
const { safeRewrite } = require("./safeRewrite");
const f = process.argv[2] || "prompt_debug.jsonl";
const rows = fs
  .readFileSync(f, "utf8")
  .split("\n")
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const refused = (r) =>
  r.llm_raw != null && String(r.llm_raw).trim() === "KHONG_CO_DU_LIEU";
const tab = {};
const variants = {};
for (const r of rows) {
  const s = safeRewrite(r.question, r.rewritten_question);
  const key = `${r.question.slice(0, 38)} | ${refused(r) ? "TU_CHOI" : "TRA_LOI"} | safeRewrite ${s.fallback ? "CHAN" : "cho qua"}`;
  tab[key] = (tab[key] || 0) + 1;
  const vk = r.question.slice(0, 38);
  variants[vk] = variants[vk] || new Map();
  const m = variants[vk];
  const e = m.get(r.rewritten_question) || {
    n: 0,
    refused: 0,
    blocked: !!s.fallback,
  };
  e.n++;
  if (refused(r)) e.refused++;
  m.set(r.rewritten_question, e);
}
console.table(tab);
console.log("\nCác dạng câu viết lại (n lượt, số lần bị từ chối):");
for (const [q, m] of Object.entries(variants)) {
  console.log("\n" + q);
  for (const [rw, e] of m)
    console.log(
      `  [${e.n} lượt, ${e.refused} từ chối${e.blocked ? ", safeRewrite CHẶN" : ""}] ${rw}`,
    );
}
