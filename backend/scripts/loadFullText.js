require("dotenv").config();
const fs = require("fs");
const path = require("path");
const pool = require("../src/config/db");

async function run() {
  const documents = [
    { doc_code: "202/2025/QH15", file: "nghi_quyet_202.txt" },
    { doc_code: "1685/NQ-UBTVQH15", file: "nghi_quyet_1685.txt" },
  ];

  for (const doc of documents) {
    const filePath = path.join(__dirname, "../data", doc.file);
    const fullText = fs.readFileSync(filePath, "utf-8");

    const result = await pool.query(
      `UPDATE legal_documents SET full_text = $1 WHERE doc_code = $2`,
      [fullText, doc.doc_code],
    );
    console.log(`${doc.doc_code}: cập nhật ${result.rowCount} dòng`);
  }
  await pool.end();
}

run();
