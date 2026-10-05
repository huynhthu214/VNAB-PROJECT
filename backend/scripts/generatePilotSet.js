require("dotenv").config();
const path = require("path");
const XLSX = require("xlsx");

const SOURCE_PATH = path.join(__dirname, "../data/test_matrix_TPHCM.xlsx");
const OUTPUT_PATH = path.join(__dirname, "../data/pilot_test_set.xlsx");

// Số câu lấy mẫu mỗi loại — tổng khoảng 16-20 câu, đủ đại diện 4 nhóm
const SAMPLE_PER_CATEGORY = 4;

function run() {
  const workbook = XLSX.readFile(SOURCE_PATH);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const allRows = XLSX.utils.sheet_to_json(sheet);

  console.log(`Đọc được ${allRows.length} câu từ test_matrix_TPHCM.xlsx`);

  // Gom theo category
  const byCategory = new Map();
  for (const row of allRows) {
    const cat = row.category || "unknown";
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat).push(row);
  }

  // Lấy mẫu ngẫu nhiên mỗi nhóm
  const sampled = [];
  for (const [cat, rows] of byCategory) {
    const shuffled = [...rows].sort(() => Math.random() - 0.5);
    const picked = shuffled.slice(0, SAMPLE_PER_CATEGORY);
    sampled.push(...picked);
    console.log(`  ${cat}: lấy ${picked.length}/${rows.length} câu`);
  }

  const worksheet = XLSX.utils.json_to_sheet(sampled);
  worksheet["!cols"] = [
    { wch: 6 },
    { wch: 20 },
    { wch: 50 },
    { wch: 60 },
    { wch: 20 },
    { wch: 20 },
    { wch: 15 },
  ];

  const outWorkbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(outWorkbook, worksheet, "PilotSet");
  XLSX.writeFile(outWorkbook, OUTPUT_PATH);

  console.log(`\nTổng cộng: ${sampled.length} câu`);
  console.log(`Đã lưu tại: ${OUTPUT_PATH}`);
}

run();
