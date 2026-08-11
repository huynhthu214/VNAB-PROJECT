const XLSX = require("xlsx");
const { Pool } = require("pg");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const MERGE_TYPE_MAP = { "toàn bộ": "toan_bo", "một phần": "mot_phan" };

// Bảng tra: quận/huyện cũ -> tỉnh cũ. Giá trị PHẢI khớp CHECK constraint admin_units_old_province_old_check
const DISTRICT_TO_PROVINCE = {};
[
  "Quận 1",
  "Quận 3",
  "Quận 4",
  "Quận 5",
  "Quận 6",
  "Quận 7",
  "Quận 8",
  "Quận 10",
  "Quận 11",
  "Quận 12",
  "Quận Bình Thạnh",
  "Quận Phú Nhuận",
  "Quận Tân Bình",
  "Quận Tân Phú",
  "Quận Bình Tân",
  "Quận Gò Vấp",
  "Huyện Bình Chánh",
  "Huyện Cần Giờ",
  "Huyện Củ Chi",
  "Huyện Hóc Môn",
  "Huyện Nhà Bè",
  "Thành phố Thủ Đức",
].forEach((d) => (DISTRICT_TO_PROVINCE[d] = "TP.HCM (cũ)"));
[
  "Thành phố Thủ Dầu Một",
  "Thành phố Dĩ An",
  "Thành phố Thuận An",
  "Thành phố Tân Uyên",
  "Thành phố Bến Cát",
  "Huyện Bàu Bàng",
  "Huyện Bắc Tân Uyên",
  "Huyện Dầu Tiếng",
  "Huyện Phú Giáo",
].forEach((d) => (DISTRICT_TO_PROVINCE[d] = "Bình Dương (cũ)"));
[
  "Thành phố Vũng Tàu",
  "Thành phố Bà Rịa",
  "Thành phố Phú Mỹ",
  "Huyện Châu Đức",
  "Huyện Xuyên Mộc",
  "Huyện Long Đất",
  "Huyện Côn Đảo",
].forEach((d) => (DISTRICT_TO_PROVINCE[d] = "Bà Rịa - Vũng Tàu (cũ)"));

// provinces_old.name (tên đầy đủ) khác với chuỗi trong cột province_old (viết tắt + "(cũ)") - cần ánh xạ qua lại
const PROVINCE_OLD_FK_NAME = {
  "TP.HCM (cũ)": "TP. Hồ Chí Minh",
  "Bình Dương (cũ)": "Tỉnh Bình Dương",
  "Bà Rịa - Vũng Tàu (cũ)": "Tỉnh Bà Rịa - Vũng Tàu",
};

function getProvinceOld(districtName) {
  const clean = (districtName || "").trim();
  const province = DISTRICT_TO_PROVINCE[clean];
  if (!province)
    console.warn(`  ⚠️  Không xác định được tỉnh cũ cho: "${clean}"`);
  return province || null;
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
  if (!sheet) throw new Error(`Không tìm thấy sheet "${sheetName}".`);
  return XLSX.utils.sheet_to_json(sheet, { defval: "" });
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

  // Nạp Tỉnh
  const provRows = getSheetData(wb, "Tinh");
  let tphcmNewProvinceId = null;
  for (const r of provRows) {
    if (!r.old_province_name || !r.new_province_name) continue;
    const docId = await upsertLegalDocument(client, r);

    const { rows: newProv } = await client.query(
      `INSERT INTO provinces_new (name, effective_date) VALUES ($1, $2) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [r.new_province_name, r.effective_date || null],
    );
    tphcmNewProvinceId = newProv[0].id; // hiện chỉ có 1 tỉnh mới, ghi đè là đủ

    const { rows: oldProv } = await client.query(
      `INSERT INTO provinces_old (name) VALUES ($1) ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
      [r.old_province_name],
    );

    await client.query(
      `INSERT INTO province_mapping (old_province_id, new_province_id, decision_document_id, notes) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
      [oldProv[0].id, newProv[0].id, docId, r.notes || ""],
    );
  }

  // Nạp Xã/Phường
  const unitRows = getSheetData(wb, "XaPhuong");
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
  // unit_type hợp lệ cho admin_units_old: 'phuong'|'xa'|'thi_tran'|'huyen' (huyen chỉ dùng cho Côn Đảo)
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

    const provinceOld = getProvinceOld(r.old_parent);
    if (!provinceOld) {
      countSkipped++;
      continue; // không đoán bừa quận/huyện không xác định được tỉnh cũ
    }
    const provinceOldFkName = PROVINCE_OLD_FK_NAME[provinceOld];

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
      [r.old_unit_name, oldType, r.old_parent, provinceOld, provinceOldFkName],
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
      [code, r.new_unit_name, r.new_unit_type || "", tphcmNewProvinceId],
    );

    await client.query(
      `INSERT INTO unit_mapping (old_unit_id, new_unit_id, decision_document_id, merge_type, notes) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (old_unit_id, new_unit_id) DO UPDATE SET merge_type = EXCLUDED.merge_type`,
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
