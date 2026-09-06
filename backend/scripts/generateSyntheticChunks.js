require("dotenv").config();
const pool = require("../src/config/db");

// Hai "document ảo" cố định để chứa các chunk tổng hợp tự động.
// Dùng id âm để chắc chắn không đụng id thật của legal_documents.
const DOC_ID_OLD_TO_NEW = -1;
const DOC_ID_NEW_TO_OLD = -2;

async function ensurePlaceholderDocs() {
  await pool.query(
    `INSERT INTO legal_documents (id, doc_code, title, full_text, source_url)
     VALUES (-1, 'SYNTHETIC-OLD2NEW', 'Dữ liệu tổng hợp tự động: đơn vị cũ -> đơn vị mới', NULL, 'internal://synthetic-old-to-new')
     ON CONFLICT (id) DO NOTHING`,
  );
  await pool.query(
    `INSERT INTO legal_documents (id, doc_code, title, full_text, source_url)
     VALUES (-2, 'SYNTHETIC-NEW2OLD', 'Dữ liệu tổng hợp tự động: đơn vị mới -> đơn vị cũ', NULL, 'internal://synthetic-new-to-old')
     ON CONFLICT (id) DO NOTHING`,
  );
}

async function upsertChunk(
  documentId,
  chunkIndex,
  content,
  sectionLabel,
  provinceNewId = null,
) {
  await pool.query(
    `INSERT INTO document_chunks (document_id, chunk_index, content, section_label, province_new_id)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (document_id, chunk_index)
     DO UPDATE SET content = EXCLUDED.content, section_label = EXCLUDED.section_label,
                    province_new_id = EXCLUDED.province_new_id,
                    embedding = NULL, embedding_model = NULL`,
    [documentId, chunkIndex, content, sectionLabel, provinceNewId],
  );
}

// Xoá các chunk_index dư thừa từ lần chạy trước (nếu số lượng đơn vị giảm đi)
async function trimExtraChunks(documentId, keepCount) {
  await pool.query(
    `DELETE FROM document_chunks WHERE document_id = $1 AND chunk_index >= $2`,
    [documentId, keepCount],
  );
}

// ============ 1) CŨ -> MỚI: 1 chunk / 1 đơn vị cũ ============
// (Cùng logic với tryOldUnitMatch, nhưng gộp sẵn nếu 1 đơn vị cũ bị chia làm nhiều phần)
async function generateOldToNew() {
  const { rows } = await pool.query(`
    SELECT o.id AS old_id, o.name AS old_name, o.parent_name, o.province_old,
           n.name AS new_name, n.province_new_id, d.doc_code
    FROM admin_units_old o
    JOIN unit_mapping m ON m.old_unit_id = o.id
    JOIN admin_units_new n ON n.id = m.new_unit_id
    LEFT JOIN legal_documents d ON d.id = m.decision_document_id
    ORDER BY o.id
  `);

  const grouped = new Map();
  for (const r of rows) {
    if (!grouped.has(r.old_id)) {
      grouped.set(r.old_id, {
        old_name: r.old_name,
        parent_name: r.parent_name,
        province_old: r.province_old,
        doc_code: r.doc_code,
        new_names: [],
        province_new_ids: new Set(),
      });
    }
    const g = grouped.get(r.old_id);
    g.new_names.push(r.new_name);
    g.province_new_ids.add(r.province_new_id);
  }

  let idx = 0;
  for (const g of grouped.values()) {
    const noiDung =
      g.new_names.length === 1
        ? `${g.old_name}, ${g.parent_name}, ${g.province_old} (cũ) hiện nay thuộc ${g.new_names[0]}${g.doc_code ? `, theo ${g.doc_code}` : ""}.`
        : `${g.old_name}, ${g.parent_name}, ${g.province_old} (cũ) hiện nay được chia thành ${g.new_names.length} phần, thuộc ${g.new_names.join(", ")}${g.doc_code ? `, theo ${g.doc_code}` : ""}.`;
    // Nếu tất cả đơn vị mới đều thuộc CÙNG 1 tỉnh -> gán rõ province_new_id.
    // Nếu bị chia sang nhiều tỉnh khác nhau (hiếm) -> để NULL (chunk hiển thị ở mọi tab).
    const provinceNewId =
      g.province_new_ids.size === 1 ? [...g.province_new_ids][0] : null;
    await upsertChunk(
      DOC_ID_OLD_TO_NEW,
      idx,
      noiDung,
      "synthetic_old_to_new",
      provinceNewId,
    );
    idx++;
  }
  await trimExtraChunks(DOC_ID_OLD_TO_NEW, idx);
  console.log(`[cũ->mới] Đã sinh/cập nhật ${idx} chunk`);
}

// ============ 2) MỚI -> CŨ: 1 chunk / 1 đơn vị mới, gộp đủ các đơn vị cũ ============
// (Cùng logic với tryNewUnitMatch - đây là phần quan trọng nhất để sửa lỗi
//  câu hỏi kiểu "X được sáp nhập từ những đơn vị nào?")
async function generateNewToOld() {
  const { rows } = await pool.query(`
    SELECT n.id AS new_id, n.name AS new_name, n.province_new_id,
           o.name AS old_name, o.parent_name, m.merge_type, d.doc_code
    FROM admin_units_new n
    JOIN unit_mapping m ON m.new_unit_id = n.id
    JOIN admin_units_old o ON o.id = m.old_unit_id
    LEFT JOIN legal_documents d ON d.id = m.decision_document_id
    ORDER BY n.id
  `);

  const grouped = new Map();
  for (const r of rows) {
    if (!grouped.has(r.new_id)) {
      grouped.set(r.new_id, {
        new_name: r.new_name,
        province_new_id: r.province_new_id,
        doc_code: r.doc_code,
        toanBo: [],
        motPhan: [],
      });
    }
    const g = grouped.get(r.new_id);
    const label = `${r.old_name} (${r.parent_name})`;
    if (r.merge_type === "toan_bo") g.toanBo.push(label);
    else g.motPhan.push(label);
  }

  let idx = 0;
  for (const g of grouped.values()) {
    const parts = [];
    if (g.toanBo.length) parts.push(`toàn bộ ${g.toanBo.join(", ")}`);
    if (g.motPhan.length)
      parts.push(`một phần diện tích của ${g.motPhan.join(", ")}`);
    const noiDung = `${g.new_name} được hình thành từ ${parts.join(", cộng với ")}${g.doc_code ? `, theo ${g.doc_code}` : ""}.`;
    await upsertChunk(
      DOC_ID_NEW_TO_OLD,
      idx,
      noiDung,
      "synthetic_new_to_old",
      g.province_new_id,
    );
    idx++;
  }
  await trimExtraChunks(DOC_ID_NEW_TO_OLD, idx);
  console.log(`[mới->cũ] Đã sinh/cập nhật ${idx} chunk`);
}

async function run() {
  await ensurePlaceholderDocs();
  await generateOldToNew();
  await generateNewToOld();
  await pool.end();
  console.log(
    "Hoàn tất sinh chunk tổng hợp. Chạy tiếp: node scripts/embedChunks.js",
  );
}

run().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});
