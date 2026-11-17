// src/controllers/directory.controller.js
// Hai endpoint cho các tab Tra cứu / Khám phá / Giới thiệu của frontend:
//   GET /api/v1/units?province_code=HCM      (hoặc ?province_id=1)
//   GET /api/v1/legal-documents
// Chỉ đọc bảng sẵn có: provinces_new, admin_units_new, unit_mapping,
// admin_units_old, legal_documents (đúng schema do import_excel_to_db.js tạo).
const pool = require("../config/db");

const CACHE_MS = 5 * 60 * 1000; // dữ liệu hầu như tĩnh -> cache bộ nhớ 5 phút
const cache = new Map(); // key -> { at, body }

function fail(res, status, error_code, message) {
  return res
    .status(status)
    .json({ success: false, data: null, message, error_code });
}

// Gom các dòng (mỗi dòng = 1 cặp đơn vị cũ -> mới) thành mỗi đơn vị mới 1 phần tử.
function buildUnits(rows) {
  const byNew = new Map();
  for (const r of rows) {
    let u = byNew.get(r.new_id);
    if (!u) {
      u = {
        new_unit_name: r.new_unit_name,
        new_unit_type: r.new_unit_type || "",
        old_units: [],
        headquarters_address: r.headquarters_address || "",
        decision_number: r.decision_number || "",
        decision_date: r.decision_date || "",
        source_url: r.source_url || "",
      };
      byNew.set(r.new_id, u);
    }
    // mỗi đơn vị mới lấy văn bản của dòng đầu tiên có văn bản
    if (!u.decision_number && r.decision_number) {
      u.decision_number = r.decision_number;
      u.decision_date = r.decision_date || "";
      u.source_url = r.source_url || "";
    }
    u.old_units.push({
      name: r.old_name,
      type: r.old_type || "",
      parent_name: r.parent_name || "",
      merge_type: r.merge_type === "mot_phan" ? "mot_phan" : "toan_bo",
    });
  }
  return [...byNew.values()];
}

async function listUnits(req, res) {
  try {
    const { province_code, province_id } = req.query;
    let where;
    let param;
    if (province_code) {
      where = "UPPER(pn.code) = UPPER($1)";
      param = String(province_code).trim();
    } else if (province_id && Number.isInteger(Number(province_id))) {
      where = "pn.id = $1";
      param = Number(province_id);
    } else {
      return fail(
        res,
        400,
        "VALIDATION_ERROR",
        "Thiếu province_code hoặc province_id.",
      );
    }

    const key = `units:${where}:${param}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) {
      res.set("Cache-Control", "public, max-age=300");
      return res.json(hit.body);
    }

    // to_jsonb(nu)->>'headquarters_address': lấy trụ sở nếu bảng có cột đó,
    // không có thì trả NULL chứ không làm câu truy vấn lỗi.
    const { rows } = await pool.query(
      `SELECT nu.id AS new_id,
              nu.name AS new_unit_name,
              nu.unit_type AS new_unit_type,
              to_jsonb(nu)->>'headquarters_address' AS headquarters_address,
              ou.name AS old_name,
              ou.unit_type AS old_type,
              ou.parent_name,
              um.merge_type,
              ld.doc_code AS decision_number,
              to_char(ld.issue_date, 'YYYY-MM-DD') AS decision_date,
              ld.source_url
         FROM admin_units_new nu
         JOIN provinces_new pn ON pn.id = nu.province_new_id
         JOIN unit_mapping um ON um.new_unit_id = nu.id
         JOIN admin_units_old ou ON ou.id = um.old_unit_id
         LEFT JOIN legal_documents ld ON ld.id = um.decision_document_id
        WHERE ${where}
        ORDER BY nu.name, ou.name`,
      [param],
    );

    const body = {
      success: true,
      data: { units: buildUnits(rows) },
      message: "OK",
    };
    cache.set(key, { at: Date.now(), body });
    res.set("Cache-Control", "public, max-age=300");
    return res.json(body);
  } catch (err) {
    console.error("[directory] listUnits:", err.message);
    return fail(res, 500, "INTERNAL_ERROR", "Không đọc được danh sách đơn vị.");
  }
}

async function listLegalDocuments(_req, res) {
  try {
    const hit = cache.get("docs");
    if (hit && Date.now() - hit.at < CACHE_MS) return res.json(hit.body);
    // không SELECT full_text (rất nặng)
    const { rows } = await pool.query(
      `SELECT doc_code, title,
              to_char(issue_date, 'YYYY-MM-DD') AS issue_date,
              source_url
         FROM legal_documents
        WHERE doc_code IS NOT NULL
        ORDER BY issue_date DESC NULLS LAST, doc_code`,
    );
    const body = { success: true, data: rows, message: "OK" };
    cache.set("docs", { at: Date.now(), body });
    return res.json(body);
  } catch (err) {
    console.error("[directory] listLegalDocuments:", err.message);
    return fail(
      res,
      500,
      "INTERNAL_ERROR",
      "Không đọc được danh sách văn bản.",
    );
  }
}

module.exports = { listUnits, listLegalDocuments, buildUnits };
