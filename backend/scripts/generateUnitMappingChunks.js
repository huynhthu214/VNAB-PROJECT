require("dotenv").config();
const pool = require("../src/config/db");

async function run() {
  console.log("Đang lấy dữ liệu từ unit_mapping...");
  const { rows } = await pool.query(
    `SELECT o.name AS old_name, o.parent_name, o.province_old,
            n.name AS new_name, m.merge_type,
            d.id AS document_id, d.doc_code
     FROM unit_mapping m
     JOIN admin_units_old o ON o.id = m.old_unit_id
     JOIN admin_units_new n ON n.id = m.new_unit_id
     LEFT JOIN legal_documents d ON d.id = m.decision_document_id`,
  );

  console.log(`Đã lấy ${rows.length} dòng ánh xạ.`);

  // Xóa các chunk loại "unit_mapping" cũ nếu chạy lại (idempotent, đánh số riêng từ 90000 để không đụng chunk văn bản gốc)
  await pool.query(`DELETE FROM document_chunks WHERE chunk_index >= 90000`);

  let idx = 90000;
  let inserted = 0;

  for (const r of rows) {
    // Bỏ qua nếu không xác định được document_id (không có legal_document liên kết)
    if (!r.document_id) continue;

    const sentence =
      r.merge_type === "toan_bo"
        ? `${r.old_name}, ${r.parent_name}, ${r.province_old} hiện nay thuộc ${r.new_name}.`
        : `${r.old_name}, ${r.parent_name}, ${r.province_old} một phần diện tích hiện nay thuộc ${r.new_name}.`;

    await pool.query(
      `INSERT INTO document_chunks (document_id, chunk_index, content)
       VALUES ($1, $2, $3)
       ON CONFLICT (document_id, chunk_index) 
       DO UPDATE SET content = EXCLUDED.content, embedding = NULL, embedding_model = NULL`,
      [r.document_id, idx, sentence],
    );
    idx++;
    inserted++;
  }

  console.log(
    `Đã tạo ${inserted} chunk mới từ unit_mapping (bỏ qua ${rows.length - inserted} dòng thiếu document_id).`,
  );
  await pool.end();
}

run();
