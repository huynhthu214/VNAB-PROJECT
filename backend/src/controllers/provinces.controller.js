const pool = require("../config/db");
const { success, fail } = require("../utils/response");

// GET /provinces?page=&limit=
async function list(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;

    const countResult = await pool.query("SELECT COUNT(*) FROM provinces_new");
    const totalItems = parseInt(countResult.rows[0].count);

    const { rows: provinces } = await pool.query(
      `SELECT id, name AS new_name, effective_date
       FROM provinces_new
       ORDER BY name
       LIMIT $1 OFFSET $2`,
      [limit, offset],
    );

    const items = [];
    for (const p of provinces) {
      const { rows: oldOnes } = await pool.query(
        `SELECT po.name
         FROM province_mapping pm
         JOIN provinces_old po ON po.id = pm.old_province_id
         WHERE pm.new_province_id = $1`,
        [p.id],
      );
      items.push({
        id: `province_${String(p.id).padStart(4, "0")}`,
        new_name: p.new_name,
        old_provinces: oldOnes.map((o) => o.name),
        effective_date: p.effective_date,
      });
    }

    return res.status(200).json(
      success({
        items,
        pagination: {
          page,
          limit,
          total_items: totalItems,
          total_pages: Math.ceil(totalItems / limit),
        },
      }),
    );
  } catch (err) {
    console.error(err);
    return res.status(500).json(fail("Lỗi hệ thống", "INTERNAL_ERROR"));
  }
}

// GET /provinces/:id
async function getById(req, res) {
  try {
    const idNum = parseInt(req.params.id.replace("province_", ""));

    const provinceResult = await pool.query(
      `SELECT id, name AS new_name, effective_date FROM provinces_new WHERE id = $1`,
      [idNum],
    );
    if (provinceResult.rows.length === 0) {
      return res
        .status(404)
        .json(fail("Không tìm thấy tỉnh/thành", "PROVINCE_NOT_FOUND"));
    }

    const { rows: mappings } = await pool.query(
      `SELECT po.name AS old_name, pm.notes, ld.doc_code AS decision_number,
              ld.issue_date AS decision_date, ld.source_url
       FROM province_mapping pm
       JOIN provinces_old po ON po.id = pm.old_province_id
       LEFT JOIN legal_documents ld ON ld.id = pm.decision_document_id
       WHERE pm.new_province_id = $1`,
      [idNum],
    );

    const p = provinceResult.rows[0];
    return res.status(200).json(
      success({
        id: `province_${String(p.id).padStart(4, "0")}`,
        new_name: p.new_name,
        effective_date: p.effective_date,
        old_provinces: mappings.map((m) => ({
          old_name: m.old_name,
          notes: m.notes,
        })),
        decision_number: mappings[0]?.decision_number || null,
        decision_date: mappings[0]?.decision_date || null,
        source_document_url: mappings[0]?.source_url || null,
      }),
    );
  } catch (err) {
    console.error(err);
    return res.status(500).json(fail("Lỗi hệ thống", "INTERNAL_ERROR"));
  }
}

// GET /provinces/search?old_name=
async function searchByOldName(req, res) {
  try {
    const { old_name } = req.query;
    if (!old_name) {
      return res
        .status(400)
        .json(fail("Thiếu tham số old_name", "VALIDATION_ERROR"));
    }

    const { rows } = await pool.query(
      `SELECT po.name AS matched_old_name, pn.id AS new_id, pn.name AS new_name
       FROM provinces_old po
       JOIN province_mapping pm ON pm.old_province_id = po.id
       JOIN provinces_new pn ON pn.id = pm.new_province_id
       WHERE po.name ILIKE $1
       LIMIT 1`,
      [`%${old_name}%`],
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json(fail("Không tìm thấy tỉnh/thành", "PROVINCE_NOT_FOUND"));
    }

    const row = rows[0];
    return res.status(200).json(
      success({
        matched_old_name: row.matched_old_name,
        new_province: {
          id: `province_${String(row.new_id).padStart(4, "0")}`,
          new_name: row.new_name,
        },
      }),
    );
  } catch (err) {
    console.error(err);
    return res.status(500).json(fail("Lỗi hệ thống", "INTERNAL_ERROR"));
  }
}

module.exports = { list, getById, searchByOldName };
