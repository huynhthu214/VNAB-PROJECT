require("dotenv").config();
const { legalSuffix } = require("../src/utils/legalRef");
const pool = require("../src/config/db");

// Hai "document ảo" cố định để chứa các chunk tổng hợp tự động.
// Dùng id âm để chắc chắn không đụng id thật của legal_documents.
const DOC_ID_OLD_TO_NEW = -1;
const DOC_ID_NEW_TO_OLD = -2;
// Document riêng cho dữ liệu ánh xạ cấp tỉnh
const DOC_ID_PROVINCE_OLD_TO_NEW = -3;
const DOC_ID_PROVINCE_NEW_TO_OLD = -4;

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
  await pool.query(
    `INSERT INTO legal_documents
    (id, doc_code, title, full_text, source_url)
   VALUES (
     -3,
     'SYNTHETIC-PROVINCE-OLD2NEW',
     'Dữ liệu tổng hợp tự động: tỉnh cũ -> tỉnh mới',
     NULL,
     'internal://synthetic-province-old-to-new'
   )
   ON CONFLICT (id) DO NOTHING`,
  );

  await pool.query(
    `INSERT INTO legal_documents
    (id, doc_code, title, full_text, source_url)
   VALUES (
     -4,
     'SYNTHETIC-PROVINCE-NEW2OLD',
     'Dữ liệu tổng hợp tự động: tỉnh mới -> tỉnh cũ',
     NULL,
     'internal://synthetic-province-new-to-old'
   )
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
                   embedding = CASE WHEN document_chunks.content = EXCLUDED.content
                                    THEN document_chunks.embedding ELSE NULL END,
                   embedding_model = CASE WHEN document_chunks.content = EXCLUDED.content
                                    THEN document_chunks.embedding_model ELSE NULL END`,
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
       n.name AS new_name, n.province_new_id, d.doc_code, d.title AS doc_title,
       m.article_no, m.clause_no, m.point_no
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
        rows: [],
      });
    }
    const g = grouped.get(r.old_id);
    g.new_names.push(r.new_name);
    g.province_new_ids.add(r.province_new_id);
    g.rows.push(r);
  }

  let idx = 0;
  for (const g of grouped.values()) {
    const prov = String(g.province_old || "").replace(/\s*\(cũ\)\s*$/i, "");
    const suffix = legalSuffix(g.rows);
    const noiDung =
      g.new_names.length === 1
        ? `${g.old_name}, ${g.parent_name}, ${prov} (cũ) hiện nay thuộc ${g.new_names[0]}${suffix}.`
        : `${g.old_name}, ${g.parent_name}, ${prov} (cũ) hiện nay được chia thành ${g.new_names.length} phần, thuộc ${g.new_names.join(", ")}${suffix}.`;
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
       o.name AS old_name, o.parent_name, m.merge_type, d.doc_code, d.title AS doc_title,
       m.article_no, m.clause_no, m.point_no
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
        rows: [],
      });
    }
    const g = grouped.get(r.new_id);
    g.rows.push(r);
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
    const noiDung = `${g.new_name} được hình thành từ ${parts.join(", cộng với ")}${legalSuffix(g.rows)}.`;
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

// ============ 3) CẤP TỈNH: CŨ -> MỚI ============
async function generateProvinceOldToNew() {
  const { rows } = await pool.query(`
    SELECT
      po.id AS old_id,
      po.name AS old_name,
      pn.id AS new_id,
      pn.name AS new_name,
      pm.article_no,
      pm.clause_no,
      pm.point_no,
      d.doc_code,
      d.title AS doc_title
    FROM provinces_old po
    JOIN province_mapping pm
      ON pm.old_province_id = po.id
    JOIN provinces_new pn
      ON pn.id = pm.new_province_id
    LEFT JOIN legal_documents d
      ON d.id = pm.decision_document_id
    ORDER BY po.id
  `);

  const grouped = new Map();

  for (const r of rows) {
    if (!grouped.has(r.old_id)) {
      grouped.set(r.old_id, {
        old_name: r.old_name,
        new_names: [],
        new_ids: new Set(),
        rows: [],
      });
    }

    const g = grouped.get(r.old_id);
    g.new_names.push(r.new_name);
    g.new_ids.add(r.new_id);
    g.rows.push(r);
  }

  let idx = 0;

  for (const g of grouped.values()) {
    const noiDung =
      g.new_names.length === 1
        ? `${g.old_name} (cũ) hiện nay thuộc ${g.new_names[0]}${legalSuffix(g.rows)}.`
        : `${g.old_name} (cũ) hiện nay được phân chia vào các tỉnh/thành: ${g.new_names.join(", ")}${legalSuffix(g.rows)}.`;

    const provinceNewId = g.new_ids.size === 1 ? [...g.new_ids][0] : null;

    await upsertChunk(
      DOC_ID_PROVINCE_OLD_TO_NEW,
      idx,
      noiDung,
      "synthetic_province_old_to_new",
      provinceNewId,
    );

    idx++;
  }

  await trimExtraChunks(DOC_ID_PROVINCE_OLD_TO_NEW, idx);

  console.log(`[tỉnh cũ->mới] Đã sinh/cập nhật ${idx} chunk`);
}

// ============ 4) CẤP TỈNH: MỚI -> CŨ ============
async function generateProvinceNewToOld() {
  const { rows } = await pool.query(`
    SELECT
      pn.id AS new_id,
      pn.name AS new_name,
      po.name AS old_name,
      pm.article_no,
      pm.clause_no,
      pm.point_no,
      d.doc_code,
      d.title AS doc_title
    FROM provinces_new pn
    JOIN province_mapping pm
      ON pm.new_province_id = pn.id
    JOIN provinces_old po
      ON po.id = pm.old_province_id
    LEFT JOIN legal_documents d
      ON d.id = pm.decision_document_id
    ORDER BY pn.id, po.id
  `);

  const grouped = new Map();

  for (const r of rows) {
    if (!grouped.has(r.new_id)) {
      grouped.set(r.new_id, {
        new_name: r.new_name,
        old_names: [],
        rows: [],
      });
    }

    const g = grouped.get(r.new_id);
    g.old_names.push(r.old_name);
    g.rows.push(r);
  }

  let idx = 0;

  for (const g of grouped.values()) {
    const noiDung =
      `${g.new_name} hiện nay tương ứng với các tỉnh/thành cũ: ` +
      `${g.old_names.join(", ")}${legalSuffix(g.rows)}.`;

    await upsertChunk(
      DOC_ID_PROVINCE_NEW_TO_OLD,
      idx,
      noiDung,
      "synthetic_province_new_to_old",
      [...grouped.keys()][idx],
    );

    idx++;
  }

  await trimExtraChunks(DOC_ID_PROVINCE_NEW_TO_OLD, idx);

  console.log(`[tỉnh mới->cũ] Đã sinh/cập nhật ${idx} chunk`);
}

async function run() {
  await ensurePlaceholderDocs();

  // Cấp xã/phường
  await generateOldToNew();
  await generateNewToOld();

  // Cấp tỉnh
  await generateProvinceOldToNew();
  await generateProvinceNewToOld();

  await pool.end();

  console.log(
    "Hoàn tất sinh chunk tổng hợp. Chạy tiếp: node scripts/embedChunks.js",
  );
}

run().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});
