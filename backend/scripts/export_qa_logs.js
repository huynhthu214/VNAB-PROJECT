require("dotenv").config();
const fs = require("fs");
const { Pool } = require("pg");

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(`
    SELECT id, question, llm_provider, answer_type, confidence, rerank_top_score, input_tokens, output_tokens, response_time_ms,
           to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at
    FROM qa_logs
    WHERE model_used = 'advanced_rag'
    ORDER BY id`);
  await pool.end();
  if (!rows.length) {
    console.error("Không có dòng nào.");
    process.exit(1);
  }
  const esc = (v) => {
    if (v === null || v === undefined) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const cols = Object.keys(rows[0]);
  const out = [
    cols.join(","),
    ...rows.map((r) => cols.map((c) => esc(r[c])).join(",")),
  ].join("\n");
  fs.writeFileSync(
    "docs/analysis/qa_logs_advanced.csv",
    "\ufeff" + out,
    "utf8",
  );
  console.log(rows.length + " dòng, đã ghi docs/analysis/qa_logs_advanced.csv");
})();

