require("dotenv").config();
const axios = require("axios");
const pool = require("../src/config/db");

async function getEmbedding(text) {
  const res = await axios.post("http://localhost:8001/embed", { text });
  return res.data.embedding;
}

async function run() {
  const { rows: chunks } = await pool.query(
    `SELECT id, content FROM document_chunks WHERE embedding IS NULL`,
  );
  console.log(`Cần embed ${chunks.length} chunk`);

  for (const chunk of chunks) {
    const embedding = await getEmbedding(chunk.content);
    const vectorLiteral = `[${embedding.join(",")}]`;
    await pool.query(
      `UPDATE document_chunks SET embedding = $1, embedding_model = $2 WHERE id = $3`,
      [vectorLiteral, "bge-m3", chunk.id],
    );
    console.log(`Đã embed chunk id=${chunk.id}`);
  }
  await pool.end();
  console.log("Hoàn tất.");
}

run();
