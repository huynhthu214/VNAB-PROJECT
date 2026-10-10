// scripts/exportFailures.js
// Xuất danh sách các câu SAI (chấm tự động) để gửi cho backend điều chỉnh.
//   node scripts/exportFailures.js --provider cohere --province 1
//   node scripts/exportFailures.js --provider cohere --province 1 --out docs/experiments/hcm_v2/failures_hcm_v2.xlsx
// Đọc lượt chạy MỚI NHẤT của mỗi model trong data/batch_results/official_batch (đổi bằng --root).
// Ghi 2 sheet: "Summary" (model x nhóm x lý do) và "Failures" (từng câu sai, kèm nhóm nguyên nhân gợi ý).
// Lưu ý: đây là chấm tự động (so chuỗi), cần đối chiếu với chấm tay trước khi kết luận lỗi hệ thống.

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const ROOT = path.resolve(
  arg("--root", path.join(__dirname, "../data/batch_results/official_batch")),
);
const PROVIDER = arg("--provider", "cohere");
const PROVINCE = Number(arg("--province", 1));
const OUT = path.resolve(
  arg("--out", path.join(ROOT, "..", `failures_province_${PROVINCE}.xlsx`)),
);
const MODELS = ["rule_based", "naive_rag", "advanced_rag", "modular_rag"];

const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
const RE =
  /^results_([a-z0-9]+)_([a-z_0-9]+?)_(\d{4}-\d{2}-\d{2}T[\d-]+Z?)\.xlsx$/i;

const latest = {};
for (const p of walk(ROOT)) {
  const m = path.basename(p).match(RE);
  if (!m || m[1] !== PROVIDER) continue;
  const rows = XLSX.utils.sheet_to_json(
    XLSX.readFile(p).Sheets[XLSX.readFile(p).SheetNames[0]],
  );
  if (!rows.length || Number(rows[0].province_id ?? 1) !== PROVINCE) continue;
  if (!latest[m[2]] || m[3] > latest[m[2]].ts)
    latest[m[2]] = { ts: m[3], rows, file: path.basename(p) };
}
if (!Object.keys(latest).length) {
  console.error("Không thấy kết quả phù hợp trong", ROOT);
  process.exit(1);
}

const isFail = (v) => v === false || v === "FALSE";
function cause(r) {
  const na = r.answer_type === "no_answer";
  switch (r.evaluation_reason) {
    case "MISSING_ENTITY":
      return na
        ? "Từ chối dù có đáp án (ngưỡng / retrieval)"
        : "Trả lời thiếu hoặc sai đơn vị";
    case "NO_ANSWER_FOR_COUNT":
      return "Từ chối câu đếm";
    case "COUNT_MISMATCH":
      return "Sai số lượng đơn vị";
    case "DID_NOT_DISAMBIGUATE":
      return "Không hỏi lại khi tên trùng";
    case "EXPECTED_NO_ANSWER":
      return "Trả lời câu ngoài phạm vi";
    case "FORBIDDEN_ENTITY":
      return "Nhắc đơn vị không được phép";
    default:
      return "Khác";
  }
}

const fails = [];
const summary = {};
for (const model of MODELS) {
  if (!latest[model]) continue;
  const rows = latest[model].rows;
  for (const r of rows.filter((x) => isFail(x.pass))) {
    fails.push({
      model,
      test_id: r.test_id,
      category: r.category,
      question: r.question,
      expected_answer: r.expected_answer,
      answer: r.answer ?? "",
      answer_type: r.answer_type ?? "",
      evaluation_reason: r.evaluation_reason,
      missing_items: r.missing_items ?? "",
      nhom_nguyen_nhan_goi_y: cause(r),
      response_time_ms: r.response_time_ms,
    });
    const k = `${model}|${r.category}|${r.evaluation_reason}`;
    summary[k] = (summary[k] || 0) + 1;
  }
}
const sumRows = Object.entries(summary)
  .map(([k, n]) => {
    const [model, category, reason] = k.split("|");
    return { model, category, reason, so_cau: n };
  })
  .sort(
    (a, b) =>
      MODELS.indexOf(a.model) - MODELS.indexOf(b.model) || b.so_cau - a.so_cau,
  );

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.json_to_sheet(sumRows.length ? sumRows : [{}]),
  "Summary",
);
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.json_to_sheet(fails.length ? fails : [{}]),
  "Failures",
);
XLSX.writeFile(wb, OUT);

console.log(
  "Nguồn:",
  Object.entries(latest)
    .map(([m, v]) => `${m}: ${v.file}`)
    .join("\n       "),
);
console.table(
  MODELS.filter((m) => latest[m]).map((m) => ({
    model: m,
    so_cau: latest[m].rows.length,
    sai_tu_dong: fails.filter((f) => f.model === m).length,
  })),
);
console.log(`Đã ghi ${fails.length} câu sai -> ${OUT}`);
