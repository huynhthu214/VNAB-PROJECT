const pool = require("../config/db");
const { success, fail } = require("../utils/response");

// GET /admin-units?page=&limit=&type=&province=&keyword=
async function list(req, res) {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = (page - 1) * limit;
    const { type, province, keyword } = req.query;

    const conditions = [];
    const params = [];

    if (type) {
      params.push(type);
      conditions.push(`n.unit_type = $${params.length}`);
    }
    if (province) {
      params.push(province);
      conditions.push(`pn.name = $${params.length}`);
    }
    if (keyword) {
      params.push(`%${keyword}%`);
      conditions.push(`n.name ILIKE $${params.length}`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const countResult = await pool.query(
      `SELECT COUNT(*) FROM admin_units_new n
       LEFT JOIN provinces_new pn ON pn.id = n.province_new_id
       ${where}`,
      params,
    );
    const totalItems = parseInt(countResult.rows[0].count);

    params.push(limit, offset);
    const { rows } = await pool.query(
      `SELECT n.code AS id, n.name AS new_name, n.unit_type AS new_type,
              pn.name AS new_province,
              n.headquarters_address, n.effective_date
       FROM admin_units_new n
       LEFT JOIN provinces_new pn ON pn.id = n.province_new_id
       ${where}
       ORDER BY n.name
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    return res.status(200).json(
      success({
        items: rows,
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

// GET /admin-units/search?old_name=
async function searchByOldName(req, res) {
  try {
    const { old_name } = req.query;
    if (!old_name) {
      return res
        .status(400)
        .json(fail("Thiếu tham số old_name", "VALIDATION_ERROR"));
    }

    const { rows } = await pool.query(
      `SELECT n.code AS id, n.name AS new_name, o.name AS matched_old_name,
              pn.name AS new_province, d.doc_code AS decision_number
       FROM admin_units_old o
       JOIN unit_mapping m ON m.old_unit_id = o.id
       JOIN admin_units_new n ON n.id = m.new_unit_id
       LEFT JOIN provinces_new pn ON pn.id = n.province_new_id
       LEFT JOIN legal_documents d ON d.id = m.decision_document_id
       WHERE o.name ILIKE $1
       LIMIT 1`,
      [`%${old_name}%`],
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json(fail("Không tìm thấy đơn vị hành chính", "UNIT_NOT_FOUND"));
    }

    const row = rows[0];
    return res.status(200).json(
      success({
        matched_old_name: row.matched_old_name,
        new_unit: {
          id: row.id,
          new_name: row.new_name,
          new_province: row.new_province,
          decision_number: row.decision_number,
        },
      }),
    );
  } catch (err) {
    console.error(err);
    return res.status(500).json(fail("Lỗi hệ thống", "INTERNAL_ERROR"));
  }
}

// GET /admin-units/:id
async function getById(req, res) {
  try {
    const { id } = req.params;

    const unitResult = await pool.query(
      `SELECT n.code AS id, n.name AS new_name, n.unit_type AS new_type,
              pn.name AS new_province,
              n.headquarters_address, n.effective_date
       FROM admin_units_new n
       LEFT JOIN provinces_new pn ON pn.id = n.province_new_id
       WHERE n.code = $1`,
      [id],
    );

    if (unitResult.rows.length === 0) {
      return res
        .status(404)
        .json(fail("Không tìm thấy đơn vị hành chính", "UNIT_NOT_FOUND"));
    }

    // ĐÃ SỬA: thêm m.merge_type (trước đây thiếu, không khớp API_DOC.md mục 2.5)
    const oldUnitsResult = await pool.query(
      `SELECT o.name AS old_name, o.parent_name AS old_parent, po.name AS old_province,
              m.merge_type
       FROM unit_mapping m
       JOIN admin_units_old o ON o.id = m.old_unit_id
       JOIN admin_units_new n ON n.id = m.new_unit_id
       LEFT JOIN provinces_old po ON po.id = o.province_old_id
       WHERE n.code = $1
       ORDER BY m.merge_type, o.name`,
      [id],
    );

    return res.status(200).json(
      success({
        ...unitResult.rows[0],
        old_units: oldUnitsResult.rows,
      }),
    );
  } catch (err) {
    console.error(err);
    return res.status(500).json(fail("Lỗi hệ thống", "INTERNAL_ERROR"));
  }
}

module.exports = { list, searchByOldName, getById };
