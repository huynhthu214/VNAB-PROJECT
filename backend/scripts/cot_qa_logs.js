require("dotenv").config();
const { Pool } = require("pg");
(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { rows } = await pool.query(
    "SELECT id, question, llm_provider, answer_type, confidence, rerank_top_score,input_tokens, output_tokens, response_time_ms,to_char(created_at, 'YYYY-MM-DD HH24:MI:SS') AS created_at",
  );
  console.table(rows);
  await pool.end();
})();
