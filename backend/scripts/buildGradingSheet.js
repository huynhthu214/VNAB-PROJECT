// scripts/buildGradingSheet.js
// Tạo file Excel để CHẤM TAY 5 nhãn từ kết quả runBatchTest.js.
//
// Cài thư viện (1 lần):  npm i exceljs
// Cách dùng (thư mục gốc backend):
//   node scripts/buildGradingSheet.js --provider cohere
//   node scripts/buildGradingSheet.js --provider cohere --per-province   # MỖI TỈNH 1 FILE, ghi ngay trong thư mục kết quả của tỉnh đó
//   node scripts/buildGradingSheet.js --provider cohere --province 4     # chỉ tỉnh 4, ghi vào thư mục kết quả của tỉnh 4
//   node scripts/buildGradingSheet.js --provider cohere --out data/x.xlsx   # tự chọn nơi ghi (gộp mọi tỉnh đang lọc vào 1 file)
//   (--root <thư mục> để đọc kết quả ở nơi khác; --force để cho phép ghi đè file ĐÃ CHẤM)
// Kết quả mặc định (không có --per-province / --province / --out): data/batch_results/cham_tay_<provider>.xlsx
// Với --per-province / --province: <thư mục kết quả của tỉnh>/cham_tay_<provider>_province_<id>.xlsx
//   (TP.HCM nằm ở thư mục gốc official_batch, các tỉnh khác ở official_batch/province_<id>)
// An toàn: nếu file đích đã có dòng nào được chấm (nhan_cham_tay khác rỗng) thì BỎ QUA, trừ khi có --force.
//
// Mỗi dòng = 1 (tỉnh, câu hỏi, model). 4 model của cùng 1 câu nằm LIỀN NHAU để so sánh.
// Cột "nhan_goi_y" là gợi ý tự động; bạn điền "nhan_cham_tay" (dropdown) theo quyết định của bạn.
// Hai cột input_tokens / output_tokens (lấy từ file results_*, để trống nếu câu không gọi LLM) nằm
// CUỐI bảng (cột P, Q) để không đổi vị trí cột M/N (dropdown) -> aggregateManual.js đọc được để tổng hợp token.

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const ROOT = path.resolve(
  arg("--root", path.join(__dirname, "../data/batch_results/official_batch")),
);
const PROVIDER = arg("--provider", "cohere");
const ONLY_PROVINCE = arg("--province", null);
const OUT_ARG = arg("--out", null);
const PER_PROVINCE = process.argv.includes("--per-province");
const FORCE = process.argv.includes("--force");
const DEFAULT_OUT = path.resolve(
  path.join(ROOT, "..", `cham_tay_${PROVIDER}.xlsx`),
);

const LABELS = ["Đúng", "Sai", "Một phần", "No_answer hợp lệ", "Lỗi hạ tầng"];
const CAUSES = [
  "Retrieval sai chunk",
  "Lẫn đơn vị tỉnh khác",
  "Trùng tên (disambiguation)",
  "Bỏ sót mot_phan",
  "LLM diễn giải lệch",
  "Từ chối sai (ngưỡng quá cao)",
  "Không xử lý không dấu/typo",
  "Router chọn sai nhánh",
  "Checker tự động chấm nhầm",
  "Khác",
];
const MODEL_ORDER = ["rule_based", "naive_rag", "advanced_rag", "modular_rag"];

const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
const FILE_RE =
  /^results_([a-z0-9]+)_([a-z_0-9]+?)_(\d{4}-\d{2}-\d{2}T[\d-]+Z?)\.xlsx$/i;

// lấy lượt chạy MỚI NHẤT của mỗi (tỉnh, model)
const latest = new Map();
for (const p of walk(ROOT)) {
  const m = path.basename(p).match(FILE_RE);
  if (!m || m[1] !== PROVIDER) continue;
  const wb = XLSX.readFile(p);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  if (!rows.length) continue;
  const pid = rows[0].province_id ?? 1;
  if (ONLY_PROVINCE && String(pid) !== String(ONLY_PROVINCE)) continue;
  const key = `${pid}|${m[2]}`;
  if (!latest.has(key) || m[3] > latest.get(key).ts)
    latest.set(key, { ts: m[3], rows, dir: path.dirname(p), pid });
}
if (!latest.size) {
  console.error("Không tìm thấy file results_* phù hợp trong", ROOT);
  process.exit(1);
}

const isBool = (v) =>
  v === true || v === false || v === "TRUE" || v === "FALSE";
const isTrue = (v) => v === true || v === "TRUE";
const splitItems = (s) =>
  String(s || "")
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);

function suggest(r) {
  if (!isBool(r.pass) || r.success === false) return "Lỗi hạ tầng";
  if (isTrue(r.pass))
    return r.answer_type === "no_answer" ? "No_answer hợp lệ" : "Đúng";
  const total = splitItems(r.must_contain).length;
  const missing = splitItems(r.missing_items).length;
  if (
    r.answer_type !== "no_answer" &&
    total > 1 &&
    missing > 0 &&
    missing < total
  )
    return "Một phần";
  return "Sai";
}

const all = [];
// file TP.HCM cũ không có cột province_id -> gán 1
for (const { rows } of latest.values())
  all.push(...rows.map((r) => ({ ...r, province_id: r.province_id ?? 1 })));
all.sort(
  (a, b) =>
    Number(a.province_id) - Number(b.province_id) ||
    String(a.test_id).localeCompare(String(b.test_id)) ||
    MODEL_ORDER.indexOf(a.model) - MODEL_ORDER.indexOf(b.model),
);

async function writeSheet(all, OUT) {
  const wb = new ExcelJS.Workbook();

  // ---- Sheet hướng dẫn ----
  const g = wb.addWorksheet("Huong_dan");
  g.columns = [{ width: 24 }, { width: 110 }];
  [
    ["Nhãn", "Khi nào dùng"],
    [
      "Đúng",
      "Câu trả lời đúng và ĐỦ so với expected_answer (đúng đơn vị mới/cũ, đúng số lượng, phân biệt đúng toàn bộ/một phần).",
    ],
    [
      "Sai",
      "Trả lời sai thông tin, hoặc từ chối (no_answer) trong khi dữ liệu có đáp án, hoặc lấy nhầm đơn vị/tỉnh khác.",
    ],
    [
      "Một phần",
      "Đúng một phần: liệt kê thiếu đơn vị, đúng đơn vị nhưng gộp chung toàn bộ/một phần, đúng 1 trong N phần của câu bị chia.",
    ],
    [
      "No_answer hợp lệ",
      "Hệ thống từ chối ĐÚNG: câu hỏi ngoài phạm vi, hoặc câu mơ hồ mà hệ thống hỏi lại để làm rõ. Tính là đúng khi tính accuracy.",
    ],
    [
      "Lỗi hạ tầng",
      "success=false / API_ERROR / quota / timeout. LOẠI khỏi mẫu số, không tính là lỗi model.",
    ],
    ["", ""],
    [
      "Quy tắc",
      "1) Đọc expected_answer trước, rồi mới đọc answer. 2) Chấm theo NỘI DUNG, không theo việc có chứa đúng chuỗi hay không (checker tự động chỉ so chuỗi).",
    ],
    [
      "",
      "3) Nếu nhan_cham_tay khác nhan_goi_y, ghi lý do ở ghi_chu (đặc biệt khi checker chấm nhầm).",
    ],
    [
      "",
      "4) Với nhãn Sai/Một phần, chọn nhom_loi. Đây là dữ liệu cho mục phân tích lỗi Chương 4.",
    ],
    [
      "",
      "5) Mỗi câu có 4 dòng (4 model) liền nhau, hãy chấm theo từng câu để nhất quán.",
    ],
    [
      "",
      "6) Câu 'golden = NO' do sinh từ DB: nếu nghi đáp án mẫu sai, đối chiếu Phụ lục nghị quyết và ghi vào ghi_chu.",
    ],
  ].forEach((r, i) => {
    const row = g.addRow(r);
    if (i === 0) row.font = { bold: true };
  });

  // ---- Sheet chấm tay ----
  const ws = wb.addWorksheet("ChamTay", {
    views: [{ state: "frozen", xSplit: 4, ySplit: 1 }],
  });
  ws.columns = [
    { header: "province_id", key: "province_id", width: 11 },
    { header: "test_id", key: "test_id", width: 14 },
    { header: "category", key: "category", width: 20 },
    { header: "model", key: "model", width: 14 },
    { header: "question", key: "question", width: 48 },
    { header: "expected_answer", key: "expected_answer", width: 48 },
    { header: "answer", key: "answer", width: 60 },
    { header: "answer_type", key: "answer_type", width: 16 },
    { header: "auto_pass", key: "auto_pass", width: 10 },
    { header: "evaluation_reason", key: "evaluation_reason", width: 20 },
    { header: "missing_items", key: "missing_items", width: 26 },
    { header: "nhan_goi_y", key: "nhan_goi_y", width: 18 },
    { header: "nhan_cham_tay", key: "nhan_cham_tay", width: 18 },
    { header: "nhom_loi", key: "nhom_loi", width: 26 },
    { header: "ghi_chu", key: "ghi_chu", width: 36 },
    { header: "input_tokens", key: "input_tokens", width: 13 },
    { header: "output_tokens", key: "output_tokens", width: 13 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFD9E1F2" },
  };

  all.forEach((r, i) => {
    const row = ws.addRow({
      province_id: r.province_id,
      test_id: r.test_id,
      category: r.category,
      model: r.model,
      question: r.question,
      expected_answer: r.expected_answer,
      answer: r.answer ?? "",
      answer_type: r.answer_type ?? "",
      auto_pass: isBool(r.pass) ? (isTrue(r.pass) ? "PASS" : "FAIL") : "ERR",
      evaluation_reason: r.evaluation_reason ?? "",
      missing_items: r.missing_items ?? "",
      nhan_goi_y: suggest(r),
      nhan_cham_tay: "",
      nhom_loi: "",
      ghi_chu: "",
      input_tokens: r.input_tokens ?? "",
      output_tokens: r.output_tokens ?? "",
    });
    row.alignment = { wrapText: true, vertical: "top" };
    // kẻ đường phân cách giữa các câu hỏi
    const next = all[i + 1];
    if (
      !next ||
      next.test_id !== r.test_id ||
      next.province_id !== r.province_id
    ) {
      row.border = { bottom: { style: "medium", color: { argb: "FF7F7F7F" } } };
    }
  });

  const last = all.length + 1;
  ws.dataValidations.add(`M2:M${last}`, {
    type: "list",
    allowBlank: true,
    formulae: [`"${LABELS.join(",")}"`],
  });
  // danh sách nhóm lỗi dài hơn 255 ký tự nên đặt ở sheet phụ
  const lists = wb.addWorksheet("DanhSach");
  CAUSES.forEach((c, i) => (lists.getCell(`A${i + 1}`).value = c));
  lists.state = "hidden";
  ws.dataValidations.add(`N2:N${last}`, {
    type: "list",
    allowBlank: true,
    formulae: [`DanhSach!$A$1:$A$${CAUSES.length}`],
  });

  ws.autoFilter = { from: "A1", to: "Q1" };
  await wb.xlsx.writeFile(OUT);
  const nQ = new Set(all.map((r) => `${r.province_id}|${r.test_id}`)).size;
  console.log(
    `Đã tạo ${OUT}\n  ${all.length} dòng cần chấm (${nQ} câu x tối đa 4 model).`,
  );
}

function hasGraded(file) {
  try {
    const wb = XLSX.readFile(file);
    const ws = wb.Sheets["ChamTay"];
    if (!ws) return false;
    return XLSX.utils
      .sheet_to_json(ws)
      .some((r) => String(r.nhan_cham_tay || "").trim());
  } catch {
    return false;
  }
}

(async () => {
  const targets = []; // { rows, out }
  const provinceIds = [...new Set(all.map((r) => String(r.province_id)))];
  const dirOf = (pid) => {
    // thư mục của lượt chạy MỚI NHẤT của tỉnh đó
    const c = [...latest.values()]
      .filter((v) => String(v.pid) === pid)
      .sort((a, b) => (a.ts < b.ts ? 1 : -1));
    return c[0].dir;
  };
  if (PER_PROVINCE || (ONLY_PROVINCE && !OUT_ARG)) {
    for (const pid of provinceIds) {
      targets.push({
        rows: all.filter((r) => String(r.province_id) === pid),
        out: path.join(dirOf(pid), `cham_tay_${PROVIDER}_province_${pid}.xlsx`),
      });
    }
  } else {
    targets.push({ rows: all, out: path.resolve(OUT_ARG || DEFAULT_OUT) });
  }
  for (const t of targets) {
    if (fs.existsSync(t.out) && hasGraded(t.out) && !FORCE) {
      console.warn(
        `BỎ QUA (đã có dòng chấm tay, dùng --force nếu thật sự muốn ghi đè): ${t.out}`,
      );
      continue;
    }
    await writeSheet(t.rows, t.out);
  }
})();
