// scripts/aggregateProvinces.js
// Gộp kết quả runBatchTest.js của nhiều tỉnh -> accuracy theo tỉnh x model x nhóm câu hỏi.
//
// Cách dùng (chạy ở thư mục gốc backend):
//   node scripts/aggregateProvinces.js                      # mọi provider
//   node scripts/aggregateProvinces.js --provider cohere    # chỉ 1 provider
//   node scripts/aggregateProvinces.js --root data/batch_results/official_batch
//
// Đọc mọi file results_<provider>_<model>_<timestamp>.xlsx (bỏ _temp_ và timing_summary).
// Nếu cùng (tỉnh, provider, model) có nhiều lượt chạy -> chỉ lấy lượt MỚI NHẤT.
// Lưu ý: "pass" ở đây là chấm TỰ ĐỘNG (must_contain / must_not_contain...) từ runBatchTest.js,
// chưa thay thế bước chấm tay 5 nhãn. Dòng API_ERROR (pass = null) bị loại khỏi mẫu số.

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

function getArg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const ROOT = path.resolve(
  getArg("--root", path.join(__dirname, "../data/batch_results/official_batch")),
);
const PROVIDER_FILTER = getArg("--provider", null);
const OUT_PATH = path.join(ROOT, "..", "accuracy_by_province.xlsx");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const FILE_RE = /^results_([a-z0-9]+)_([a-z_0-9]+?)_(\d{4}-\d{2}-\d{2}T[\d-]+Z?)\.xlsx$/i;

const files = walk(ROOT)
  .map((p) => ({ p, m: path.basename(p).match(FILE_RE) }))
  .filter((x) => x.m)
  .map((x) => ({ p: x.p, provider: x.m[1], model: x.m[2], ts: x.m[3] }))
  .filter((x) => !PROVIDER_FILTER || x.provider === PROVIDER_FILTER);

if (files.length === 0) {
  console.error(`Không thấy file results_*.xlsx nào trong ${ROOT}`);
  process.exit(1);
}

// Đọc từng file, lấy province_id từ chính dữ liệu (không suy từ tên thư mục)
const runs = new Map(); // key: province|provider|model -> {ts, rows, file}
for (const f of files) {
  const wb = XLSX.readFile(f.p);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  if (rows.length === 0) continue;
  // file TP.HCM cũ (trước khi có cột province_id) -> mặc định là TP.HCM (id=1)
  const provinceId = rows[0].province_id ?? 1;
  const key = `${provinceId}|${f.provider}|${f.model}`;
  const prev = runs.get(key);
  if (!prev || f.ts > prev.ts) runs.set(key, { ...f, provinceId, rows });
}

const isBool = (v) => v === true || v === false || v === "TRUE" || v === "FALSE";
const isPass = (v) => v === true || v === "TRUE";

function stat(rows) {
  const valid = rows.filter((r) => isBool(r.pass));
  const pass = valid.filter((r) => isPass(r.pass)).length;
  const apiErr = rows.filter((r) => !isBool(r.pass)).length;
  const times = rows.map((r) => Number(r.response_time_ms)).filter(Number.isFinite);
  return {
    tong_cau: rows.length,
    loi_ha_tang: apiErr,
    mau_so: valid.length,
    dung: pass,
    accuracy_pct: valid.length ? +((pass / valid.length) * 100).toFixed(1) : null,
    avg_ms: times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null,
  };
}

const MODEL_ORDER = ["rule_based", "naive_rag", "advanced_rag", "modular_rag"];
const byModel = [];
const byCategory = [];

const sorted = [...runs.values()].sort(
  (a, b) =>
    Number(a.provinceId) - Number(b.provinceId) ||
    a.provider.localeCompare(b.provider) ||
    MODEL_ORDER.indexOf(a.model) - MODEL_ORDER.indexOf(b.model),
);

for (const r of sorted) {
  byModel.push({
    province_id: r.provinceId,
    provider: r.provider,
    model: r.model,
    ...stat(r.rows),
    file: path.basename(r.file ?? r.p),
  });
  const cats = [...new Set(r.rows.map((x) => x.category))].sort();
  for (const c of cats) {
    byCategory.push({
      province_id: r.provinceId,
      provider: r.provider,
      model: r.model,
      category: c,
      ...stat(r.rows.filter((x) => x.category === c)),
    });
  }
}

// Bảng gộp 7 tỉnh (loại province_id = 1) theo model, để so với TP.HCM
const nOther = new Set(sorted.filter((r) => Number(r.provinceId) !== 1).map((r) => r.provinceId)).size;
const pooled = [];
for (const model of MODEL_ORDER) {
  const rows = sorted
    .filter((r) => r.model === model && Number(r.provinceId) !== 1)
    .flatMap((r) => r.rows);
  if (rows.length) pooled.push({ nhom: `${nOther} tỉnh khác (gộp)`, model, ...stat(rows) });
}
for (const model of MODEL_ORDER) {
  const rows = sorted
    .filter((r) => r.model === model && Number(r.provinceId) === 1)
    .flatMap((r) => r.rows);
  if (rows.length) pooled.push({ nhom: "TP.HCM", model, ...stat(rows) });
}

console.log("\n=== Accuracy theo tỉnh x model ===");
console.table(byModel.map(({ file, ...rest }) => rest));
console.log("\n=== TP.HCM vs 7 tỉnh gộp (báo cáo riêng, đừng gộp thành 1 con số) ===");
console.table(pooled);

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byModel), "TinhxModel");
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byCategory), "TinhxModelxNhom");
XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(pooled), "TPHCM_vs_7Tinh");
XLSX.writeFile(wb, OUT_PATH);
console.log(`\nĐã ghi: ${OUT_PATH}`);