require("dotenv").config();
const pool = require("../src/config/db");

function chunkByArticle(text, maxWords = 400) {
  // Tách theo "Điều X." — giữ nguyên số điều trong nội dung chunk để dễ truy vết
  const parts = text
    .split(/(?=Điều\s+\d+\.)/g)
    .filter((p) => p.trim().length > 0);

  const chunks = [];
  for (const part of parts) {
    const words = part.split(/\s+/);
    if (words.length <= maxWords) {
      chunks.push(part.trim());
    } else {
      // Điều quá dài -> cắt nhỏ tiếp, có overlap, nhưng vẫn trong phạm vi 1 điều
      for (let i = 0; i < words.length; i += maxWords - 50) {
        chunks.push(words.slice(i, i + maxWords).join(" "));
        if (i + maxWords >= words.length) break;
      }
    }
  }
  return chunks;
}

async function run() {
  const { rows: docs } = await pool.query(
    "SELECT id, full_text FROM legal_documents WHERE full_text IS NOT NULL",
  );
  for (const doc of docs) {
    const chunks = chunkByArticle(doc.full_text);
    for (let i = 0; i < chunks.length; i++) {
      await pool.query(
        `INSERT INTO document_chunks (document_id, chunk_index, content)
          VALUES ($1, $2, $3)
          ON CONFLICT (document_id, chunk_index) 
          DO UPDATE SET content = EXCLUDED.content, embedding = NULL, embedding_model = NULL`,
        [doc.id, i, chunks[i]],
      );
    }
    console.log(
      `Đã chunk văn bản id=${doc.id}: ${chunks.length} đoạn (theo Điều)`,
    );
  }
  await pool.end();
}

run();
