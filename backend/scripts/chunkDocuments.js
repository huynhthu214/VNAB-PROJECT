require("dotenv").config();
const pool = require("../src/config/db");

function chunkByArticle(text, maxWords = 400) {
  const parts = text
    .split(/(?=Điều\s+\d+\.)/g)
    .filter((p) => p.trim().length > 0);

  const chunks = [];
  for (const part of parts) {
    // Trích nhãn "Điều N" từ TOÀN BỘ điều, trước khi cắt nhỏ -> mọi mảnh con đều giữ được nhãn
    const dieuMatch = part.match(/^Điều\s+(\d+)\./);
    const dieuLabel = dieuMatch ? `Điều ${dieuMatch[1]}` : null; // null = đoạn mở đầu trước Điều 1 (căn cứ pháp lý...)

    const words = part.split(/\s+/);
    if (words.length <= maxWords) {
      chunks.push({ content: part.trim(), section_label: dieuLabel });
    } else {
      for (let i = 0; i < words.length; i += maxWords - 50) {
        const sliceText = words.slice(i, i + maxWords).join(" ");
        chunks.push({ content: sliceText, section_label: dieuLabel }); // ← gắn nhãn cho TẤT CẢ mảnh con, kể cả mảnh giữa/cuối
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
        `INSERT INTO document_chunks (document_id, chunk_index, content, section_label)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (document_id, chunk_index) 
          DO UPDATE SET content = EXCLUDED.content, section_label = EXCLUDED.section_label,
                         embedding = NULL, embedding_model = NULL`,
        [doc.id, i, chunks[i].content, chunks[i].section_label],
      );
    }
    console.log(
      `Đã chunk văn bản id=${doc.id}: ${chunks.length} đoạn (theo Điều)`,
    );
  }
  await pool.end();
}
run();
