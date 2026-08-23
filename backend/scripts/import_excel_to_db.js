require("dotenv").config();
const XLSX = require("xlsx");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const MERGE_TYPE_MAP = { "toàn bộ": "toan_bo", "một phần": "mot_phan" };

// ============================================================================
// Chuẩn hóa tên tỉnh để so khớp giữa các sheet/tỉnh khác nhau, bất kể cách viết
// (VD: "TP. Hồ Chí Minh" vs "Thành phố Hồ Chí Minh" vs "Tỉnh An Giang (89)"
//  đều rút về cùng 1 "core" để so khớp được với nhau)
// ============================================================================
function normalizeProvinceCore(name) {
  return (name || "")
    .replace(/\s*\(\d+\)\s*$/, "") // bỏ mã GSO dạng " (89)" nếu có
    .replace(/^(Tỉnh|TP\.?|Thành phố)\s+/i, "") // bỏ tiền tố Tỉnh/TP./Thành phố
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d");
}

// admin_units_new.code là VARCHAR(20) - không đủ chỗ ghép tên dài, dùng mã ngắn tuần tự ổn định
function buildUnitCodeMap(allNewUnitNames) {
  const uniqueSorted = [...new Set(allNewUnitNames)].sort((a, b) =>
    a.localeCompare(b, "vi"),
  );
  const map = new Map();
  uniqueSorted.forEach((name, i) =>
    map.set(name, `u${String(i + 1).padStart(4, "0")}`),
  );
  return map;
}

// Tải file 1 lần duy nhất, cứu sống RAM
function getWorkbook(filePath) {
  return XLSX.readFile(filePath);
}

function getSheetData(workbook, sheetName) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
}

// ============================================================================
// Xây map "quận/huyện cũ" -> "core tên tỉnh cũ" TỰ ĐỘNG từ sheet "Sheet1"
// (nếu file có sheet này - file mẫu do nhóm tự soạn đều có sẵn cột
//  "Quận/Huyện cũ" + "Tỉnh/TP cũ (trước sáp nhập)"). Không cần code cứng
//  danh sách quận/huyện theo từng tỉnh nữa -> tự mở rộng được cho mọi tỉnh.
// ============================================================================
function buildDistrictToProvinceCoreMap(workbook) {
  const rows = getSheetData(workbook, "Sheet1");
  const map = {};
  if (!rows) return map;
  for (const r of rows) {
    const district = (r["Quận/Huyện cũ"] || "").trim();
    const provinceOld = r["Tỉnh/TP cũ (trước sáp nhập)"];
    if (district && provinceOld) {
      map[district] = normalizeProvinceCore(provinceOld);
    }
  }
  return map;
}

async function upsertLegalDocument(
  client,
  { decision_number, decision_date, source_document_url },
) {
  const { rows } = await client.query(
    `INSERT INTO legal_documents (doc_code, title, issue_date, source_url)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (doc_code) DO UPDATE SET source_url = EXCLUDED.source_url
     RETURNING id`,
    [
      decision_number,
      `Nghị quyết ${decision_number}`,
      decision_date || null,
      source_document_url || "",
    ],
  );
  return rows[0].id;
}

async function importData(client, filePath) {
  const wb = getWorkbook(filePath);
  const districtToProvinceCore = buildDistrictToProvinceCoreMap(wb);
  const hasSheet1 = Object.keys(districtToProvinceCore).length > 0;
  if (!hasSheet1) {
    console.warn(
      `  ⚠️  Không tìm thấy sheet "Sheet1" (hoặc thiếu cột) trong file này ` +
        `-> sẽ không tự xác định được tỉnh cũ theo quận/huyện. Cần thêm sheet ` +
        `"Sheet1" với cột "Quận/Huyện cũ" + "Tỉnh/TP cũ (trước sáp nhập)".`,
    );
  }

  // ---------- Nạp Tỉnh ----------
  const provRows = getSheetData(wb, "Tinh") || [];
  // provinceOldNameMap: core-name -> tên tỉnh cũ CHÍNH XÁC như trong DB (dùng làm FK)
  const provinceOldNameMap = {};
  // provinceNewIdMap: tên tỉnh mới CHÍNH XÁC (cột new_province_name / new_parent) -> id trong provinces_new
  const provinceNewIdMap = {};

  for (const r of provRows) {
    if (!r.old_province_name || !r.new_province_name) continue;
    const docId = await upsertLegalDocument(client, r);

    const { rows: newProv } = await client.query(
      `INSERT INTO provinces_new (name, effective_date) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [r.new_province_name, r.effective_date || null],
    );
    provinceNewIdMap[r.new_province_name.trim()] = newProv[0].id;

    const { rows: oldProv } = await client.query(
      `INSERT INTO provinces_old (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [r.old_province_name],
    );
    provinceOldNameMap[normalizeProvinceCore(r.old_province_name)] =
      r.old_province_name.trim();

    await client.query(
      `INSERT INTO province_mapping (old_province_id, new_province_id, decision_document_id, notes)
       VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [oldProv[0].id, newProv[0].id, docId, r.notes || ""],
    );
  }

  // ---------- Nạp Xã/Phường ----------
  const unitRows = getSheetData(wb, "XaPhuong") || [];
  let countOK = 0,
    countSkipped = 0;

  const validRows = unitRows.filter(
    (r) =>
      r.review_status === "Đã rà" &&
      r.old_unit_name &&
      r.new_unit_name &&
      r.old_parent,
  );
  const codeMap = buildUnitCodeMap(validRows.map((r) => r.new_unit_name));
  const ALLOWED_OLD_TYPES = ["phuong", "xa", "thi_tran", "huyen"];

  for (const r of unitRows) {
    if (
      r.review_status !== "Đã rà" ||
      !r.old_unit_name ||
      !r.new_unit_name ||
      !r.old_parent
    ) {
      countSkipped++;
      continue;
    }
    const docId = await upsertLegalDocument(client, r);

    // ---- Xác định tỉnh CŨ của dòng này (tự động, không hard-code) ----
    const districtKey = (r.old_parent || "").trim();
    const provinceOldCore = districtToProvinceCore[districtKey];
    const provinceOldFkName = provinceOldCore
      ? provinceOldNameMap[provinceOldCore]
      : null;
    if (!provinceOldFkName) {
      console.warn(
        `  ⚠️  Không xác định được TỈNH CŨ cho quận/huyện "${districtKey}" ` +
          `(đơn vị "${r.old_unit_name}") - bỏ qua dòng này. Kiểm tra lại ` +
          `Sheet1 có đủ dòng cho quận/huyện này không.`,
      );
      countSkipped++;
      continue;
    }
    // nhãn hiển thị dạng text, chỉ mang tính thông tin (không còn CHECK constraint ràng buộc)
    const provinceOldLabel = `${provinceOldFkName} (cũ)`;

    // ---- Xác định tỉnh MỚI của dòng này (đọc trực tiếp từ cột new_parent) ----
    const newParentName = (r.new_parent || "").trim();
    const provinceNewId = provinceNewIdMap[newParentName];
    if (!provinceNewId) {
      console.warn(
        `  ⚠️  Không tìm thấy tỉnh MỚI "${newParentName}" trong sheet "Tinh" ` +
          `(đơn vị "${r.new_unit_name}") - bỏ qua dòng này. Kiểm tra cột ` +
          `new_parent có khớp đúng new_province_name trong sheet Tinh không.`,
      );
      countSkipped++;
      continue;
    }

    const oldType = ALLOWED_OLD_TYPES.includes(r.old_unit_type)
      ? r.old_unit_type
      : "xa";
    if (!ALLOWED_OLD_TYPES.includes(r.old_unit_type)) {
      console.warn(
        `  ⚠️  "${r.old_unit_name}" có unit_type="${r.old_unit_type}" không hợp lệ - tạm gán "xa"`,
      );
    }

    let { rows: oldUnit } = await client.query(
      `INSERT INTO admin_units_old (name, unit_type, parent_name, province_old, province_old_id)
       VALUES ($1, $2, $3, $4, (SELECT id FROM provinces_old WHERE name = $5))
       ON CONFLICT DO NOTHING RETURNING id`,
      [
        r.old_unit_name,
        oldType,
        r.old_parent,
        provinceOldLabel,
        provinceOldFkName,
      ],
    );
    let oldUnitId = oldUnit[0]?.id;

    if (!oldUnitId) {
      const { rows: found } = await client.query(
        `SELECT id FROM admin_units_old WHERE name=$1 AND parent_name=$2 LIMIT 1`,
        [r.old_unit_name, r.old_parent],
      );
      oldUnitId = found[0]?.id;
    }

    const code = codeMap.get(r.new_unit_name);
    const { rows: newUnit } = await client.query(
      `INSERT INTO admin_units_new (code, name, unit_type, province_new_id)
       VALUES ($1, $2, $3, $4) ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [code, r.new_unit_name, r.new_unit_type || "", provinceNewId],
    );

    await client.query(
      `INSERT INTO unit_mapping (old_unit_id, new_unit_id, decision_document_id, merge_type, notes)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (old_unit_id, new_unit_id) DO UPDATE SET merge_type = EXCLUDED.merge_type`,
      [
        oldUnitId,
        newUnit[0].id,
        docId,
        MERGE_TYPE_MAP[(r.merge_type || "").trim()] || "toan_bo",
        r.notes || "",
      ],
    );
    countOK++;
  }
  return { provCount: provRows.length, countOK, countSkipped };
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath)
    return (
      console.error(
        "Cách dùng: node import_excel_to_db.js duong_dan_file.xlsx",
      ) || process.exit(1)
    );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const stats = await importData(client, filePath);
    await client.query("COMMIT");
    console.log(
      `HOÀN TẤT. Đã nạp ${stats.provCount} dòng tỉnh, ${stats.countOK} dòng phường. Bỏ qua ${stats.countSkipped} dòng chưa đủ điều kiện.`,
    );
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Import thất bại, đã rollback toàn bộ:", err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
