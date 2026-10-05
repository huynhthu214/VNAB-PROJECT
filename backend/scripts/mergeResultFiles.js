// scripts/mergeResultFiles.js
// Gộp nhiều file kết quả .xlsx (cùng model/provider, khác khoảng câu hỏi —
// VD advanced_rag chạy ngày 1 (câu 1-100) và ngày 2 (câu 101-161)
// do giới hạn quota của provider) thành 1 file đầy đủ. Sắp xếp lại theo test_id để khớp
// Cách dùng:
//   node scripts/mergeResultFiles.js file_ngay1.xlsx file_ngay2.xlsx [...] output.xlsx
// (file cuối cùng trong danh sách là tên file output)

const XLSX = require("xlsx");

const args = process.argv.slice(2);
if (args.length < 3) {
  console.error(
    "Cách dùng: node scripts/mergeResultFiles.js file1.xlsx file2.xlsx [...] output.xlsx",
  );
  process.exit(1);
}

const outputPath = args[args.length - 1];
const inputPaths = args.slice(0, -1);

const merged = new Map(); // test_id -> row, để tự loại trùng nếu 2 file chồng câu hỏi

for (const p of inputPaths) {
  const wb = XLSX.readFile(p);
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(ws);
  console.log(`${p}: ${rows.length} dòng`);
  for (const r of rows) {
    if (merged.has(r.test_id)) {
      console.log(
        `  (trùng test_id ${r.test_id} — GHI ĐÈ bằng dòng từ file sau)`,
      );
    }
    merged.set(r.test_id, r);
  }
}

// Sắp xếp theo id gốc (cột "id" là số thứ tự trong test_matrix_TPHCM.xlsx)
const rows = [...merged.values()].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));

console.log(`\nTổng sau khi gộp (đã loại trùng): ${rows.length} dòng`);

const ws = XLSX.utils.json_to_sheet(rows);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "merged");
XLSX.writeFile(wb, outputPath);

console.log(`Đã lưu: ${outputPath}`);

const missing = 161 - rows.length;
if (missing > 0) {
  console.log(`\nCẢNH BÁO: thiếu ${missing} câu so với 161 câu đầy đủ.`);
}
const errorCount = rows.filter((r) => r.success === false).length;
if (errorCount > 0) {
  console.log(
    `CẢNH BÁO: còn ${errorCount} câu success=false — chạy scripts/retryFailedRows.js trên file vừa gộp để vá.`,
  );
}
