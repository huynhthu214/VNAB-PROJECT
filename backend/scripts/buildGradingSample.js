// scripts/buildGradingSample.js
// Tạo file CHẤM TAY theo MẪU PHÂN TẦNG, cho cả 2 provider, chia sẵn cho từng người chấm.
//
// Cách dùng (thư mục gốc backend):
//   node scripts/buildGradingSample.js
//   node scripts/buildGradingSample.js --n 15 --n-hcm 24 --overlap 2 --seed 2026
//   node scripts/buildGradingSample.js --assign "NguoiA=HCM,AG,CM,CT;NguoiB=DN,DT,TN,VL"
//   (--root <official_batch> | --out-dir <thư mục ra> | --show-auto hiện cột chấm tự động | --dry chỉ xem khối lượng | --force ghi đè file ĐÃ CHẤM)
//
// Điểm chính:
//  - Tỉnh được nhận diện bằng TÊN THƯ MỤC mã tỉnh (HCM, AG, CM, ...), KHÔNG dùng province_id
//    (id khác nhau giữa 2 máy). Thư mục cũ như province_4, _old... bị bỏ qua.
//  - Mẫu chọn theo CÂU HỎI (test_id), phân tầng theo category, seed cố định => chạy lại ra đúng mẫu cũ.
//    Cùng 1 câu được chấm cho CẢ Gemini lẫn Cohere (so sánh công bằng).
//  - rule_based không gọi LLM nên chỉ giữ 1 bản (provider = "chung").
//  - Mỗi tỉnh có --overlap câu được CẢ 2 NGƯỜI chấm (để tính độ đồng thuận giữa 2 người, Cohen's kappa).
//  - Cột chấm tự động (auto_pass, evaluation_reason, missing_items, nhan_goi_y) bị ẨN mặc định để chấm "mù",
//    tránh bị gợi ý ảnh hưởng. Dữ liệu vẫn nằm trong file, không bỏ cột nên các script tổng hợp đọc được.
//  - Cột M (nhan_cham_tay) và N (nhom_loi) giữ nguyên vị trí dropdown như bản cũ.

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");
const ExcelJS = require("exceljs");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const has = (n) => process.argv.includes(n);

const ROOT = path.resolve(
  arg("--root", path.join(__dirname, "../data/batch_results/official_batch")),
);
const OUT_DIR = path.resolve(
  arg("--out-dir", path.join(ROOT, "..", "cham_tay_mau")),
);
const N = Number(arg("--n", 15));
const N_HCM = Number(arg("--n-hcm", 24));
const OVERLAP = Number(arg("--overlap", 2));
const SEED = Number(arg("--seed", 2026));
const FORCE = has("--force");
const SHOW_AUTO = has("--show-auto");
const DRY = has("--dry"); // chỉ in bảng khối lượng, không ghi file
const ASSIGN = arg(
  "--assign",
  "NguoiA=HCM,AG,CM,CT;NguoiB=DN,DT,TN,VL",
);

const PROVIDERS = ["gemini", "cohere"];
const MODEL_ORDER = ["rule_based", "naive_rag", "advanced_rag", "modular_rag"];
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

// ---------- phân công ----------
const graderOf = new Map(); // mã tỉnh -> tên người chấm
for (const part of ASSIGN.split(";")) {
  const [name, codes] = part.split("=");
  if (!name || !codes) continue;
  codes.split(",").forEach((c) => graderOf.set(c.trim().toUpperCase(), name.trim()));
}
const graders = [...new Set(graderOf.values())];

// ---------- đọc kết quả: lượt MỚI NHẤT của mỗi (mã tỉnh, provider, model) ----------
const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
const FILE_RE =
  /^results_([a-z0-9]+)_([a-z_0-9]+?)_(\d{4}-\d{2}-\d{2}T[\d-]+Z?)\.xlsx$/i;

const latest = new Map(); // "CODE|prov|model" -> {ts, rows}
for (const p of walk(ROOT)) {
  const m = path.basename(p).match(FILE_RE);
  if (!m) continue;
  const prov = m[1].toLowerCase();
  if (!PROVIDERS.includes(prov)) continue;
  const code = path.relative(ROOT, p).split(path.sep)[0];
  if (!/^[A-Z]{2,3}$/.test(code)) continue; // chỉ nhận thư mục mã tỉnh
  const key = `${code}|${prov}|${m[2]}`;
  if (latest.has(key) && m[3] <= latest.get(key).ts) continue;
  const wb = XLSX.readFile(p);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  if (rows.length) latest.set(key, { ts: m[3], rows });
}
const codes = [...new Set([...latest.keys()].map((k) => k.split("|")[0]))].sort(
  (a, b) => (a === "HCM" ? -1 : b === "HCM" ? 1 : a.localeCompare(b)),
);
if (!codes.length) {
  console.error("Không thấy thư mục mã tỉnh nào có results_* trong", ROOT);
  process.exit(1);
}

// ---------- tiện ích lấy mẫu ----------
function hash(s) {
  let h = 2166136261;
  for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// chia số câu cho từng nhóm theo tỉ lệ, mỗi nhóm tối thiểu 1 câu
function allocate(sizes, n) {
  const cats = Object.keys(sizes);
  const total = cats.reduce((a, c) => a + sizes[c], 0);
  n = Math.min(n, total);
  const q = {};
  cats.forEach(
    (c) => (q[c] = Math.min(sizes[c], Math.max(1, Math.round((n * sizes[c]) / total)))),
  );
  const sum = () => cats.reduce((a, c) => a + q[c], 0);
  while (sum() > n) {
    const c = cats.filter((x) => q[x] > 1).sort((a, b) => q[b] - q[a])[0];
    if (!c) break;
    q[c]--;
  }
  while (sum() < n) {
    const c = cats
      .filter((x) => q[x] < sizes[x])
      .sort((a, b) => sizes[b] - q[b] - (sizes[a] - q[a]))[0];
    if (!c) break;
    q[c]++;
  }
  return q;
}

// ---------- chọn mẫu từng tỉnh ----------
const plan = {}; // code -> {grader, sampled:[], overlap:[], rowsByQ: Map}
for (const code of codes) {
  const runs = [];
  for (const prov of PROVIDERS)
    for (const model of MODEL_ORDER) {
      const r = latest.get(`${code}|${prov}|${model}`);
      if (r) runs.push({ prov, model, rows: r.rows });
      else console.warn(`THIẾU kết quả: ${code} / ${prov} / ${model}`);
    }
  if (!runs.length) continue;

  // chỉ giữ câu có mặt ở MỌI lượt chạy (để so sánh được)
  let common = null;
  for (const run of runs) {
    const ids = new Set(run.rows.map((r) => r.test_id));
    common = common ? new Set([...common].filter((x) => ids.has(x))) : ids;
  }
  const maxIds = Math.max(...runs.map((r) => new Set(r.rows.map((x) => x.test_id)).size));
  if (common.size < maxIds)
    console.warn(
      `CẢNH BÁO ${code}: chỉ ${common.size}/${maxIds} câu có mặt ở MỌI lượt chạy (có lượt chạy dở hoặc bộ test lệch). Chạy lại lượt thiếu trước khi chấm.`,
    );
  const catOf = new Map();
  runs[0].rows.forEach((r) => catOf.set(r.test_id, r.category));
  const byCat = {};
  [...common].sort().forEach((id) => {
    const c = catOf.get(id) || "?";
    (byCat[c] ||= []).push(id);
  });
  const sizes = Object.fromEntries(Object.entries(byCat).map(([c, v]) => [c, v.length]));
  const quota = allocate(sizes, code === "HCM" ? N_HCM : N);
  const rng = mulberry32(SEED ^ hash(code));
  const sampled = [];
  for (const c of Object.keys(byCat).sort())
    sampled.push(...shuffle(byCat[c], rng).slice(0, quota[c]));
  const overlap = shuffle(sampled, mulberry32(SEED ^ hash(code + "#ov"))).slice(0, OVERLAP);

  // gom các dòng cần chấm: rule_based chỉ 1 bản
  const rowsByQ = new Map();
  for (const run of runs) {
    if (run.model === "rule_based" && run.prov !== "cohere" && runs.some((x) => x.model === "rule_based" && x.prov === "cohere"))
      continue;
    for (const r of run.rows) {
      if (!sampled.includes(r.test_id)) continue;
      (rowsByQ.get(r.test_id) || rowsByQ.set(r.test_id, []).get(r.test_id)).push({
        ...r,
        province_code: code,
        provider: run.model === "rule_based" ? "chung" : run.prov,
      });
    }
  }
  plan[code] = {
    grader: graderOf.get(code) || null,
    sampled,
    overlap,
    quota,
    sizes,
    rowsByQ,
  };
  if (!graderOf.has(code)) console.warn(`Tỉnh ${code} chưa được gán người chấm (--assign).`);
}

// ---------- ghi file ----------
const isBool = (v) => v === true || v === false || v === "TRUE" || v === "FALSE";
const isTrue = (v) => v === true || v === "TRUE";
const splitItems = (s) => String(s || "").split("|").map((x) => x.trim()).filter(Boolean);
function suggest(r) {
  if (!isBool(r.pass) || r.success === false) return "Lỗi hạ tầng";
  if (isTrue(r.pass)) return r.answer_type === "no_answer" ? "No_answer hợp lệ" : "Đúng";
  const total = splitItems(r.must_contain).length;
  const missing = splitItems(r.missing_items).length;
  if (r.answer_type !== "no_answer" && total > 1 && missing > 0 && missing < total) return "Một phần";
  return "Sai";
}
function hasGraded(file) {
  try {
    const ws = XLSX.readFile(file).Sheets["ChamTay"];
    return !!ws && XLSX.utils.sheet_to_json(ws).some((r) => String(r.nhan_cham_tay || "").trim());
  } catch {
    return false;
  }
}

async function writeSheet(rows, out, graderName) {
  const wb = new ExcelJS.Workbook();
  const g = wb.addWorksheet("Huong_dan");
  g.columns = [{ width: 24 }, { width: 110 }];
  [
    ["Nhãn", "Khi nào dùng"],
    ["Đúng", "Câu trả lời đúng và ĐỦ so với expected_answer (đúng đơn vị mới/cũ, đúng số lượng, phân biệt đúng toàn bộ/một phần)."],
    ["Sai", "Trả lời sai thông tin, hoặc từ chối (no_answer) trong khi dữ liệu có đáp án, hoặc lấy nhầm đơn vị/tỉnh khác."],
    ["Một phần", "Đúng một phần: liệt kê thiếu đơn vị, đúng đơn vị nhưng gộp chung toàn bộ/một phần, đúng 1 trong N phần của câu bị chia."],
    ["No_answer hợp lệ", "Hệ thống từ chối ĐÚNG: câu ngoài phạm vi, hoặc câu mơ hồ mà hệ thống hỏi lại để làm rõ. Tính là đúng khi tính accuracy."],
    ["Lỗi hạ tầng", "success=false / API_ERROR / quota / timeout. LOẠI khỏi mẫu số."],
    ["", ""],
    ["Quy tắc", "1) Đọc expected_answer trước, rồi mới đọc answer. 2) Chấm theo NỘI DUNG, không theo việc chứa đúng chuỗi."],
    ["", "3) CHẤM MÙ: các cột auto_pass, evaluation_reason, missing_items, nhan_goi_y đang bị ẩn. KHÔNG bỏ ẩn cho tới khi chấm xong cả file."],
    ["", "4) Với nhãn Sai/Một phần, chọn nhom_loi. Việc checker tự động chấm nhầm sẽ được so sánh tự động sau khi chấm xong, không cần ghi."],
    ["", "5) Mỗi câu có tối đa 7 dòng: rule_based (provider=chung) + 3 model x 2 provider. Chấm cả cụm theo từng câu cho nhất quán."],
    ["", "6) Dòng có chung_2_nguoi = x được CẢ 2 người chấm độc lập: không hỏi nhau, không xem file của nhau."],
    ["", `Người chấm của file này: ${graderName}`],
  ].forEach((r, i) => {
    const row = g.addRow(r);
    if (i === 0) row.font = { bold: true };
  });

  const ws = wb.addWorksheet("ChamTay", { views: [{ state: "frozen", xSplit: 4, ySplit: 1 }] });
  ws.columns = [
    { header: "province_code", key: "province_code", width: 12 },
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
    { header: "provider", key: "provider", width: 10 },
    { header: "chung_2_nguoi", key: "chung_2_nguoi", width: 14 },
    { header: "nguoi_chinh", key: "nguoi_chinh", width: 12 },
  ];
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
  if (!SHOW_AUTO) [9, 10, 11, 12].forEach((i) => (ws.getColumn(i).hidden = true));

  rows.forEach((r, i) => {
    const row = ws.addRow({
      province_code: r.province_code,
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
      provider: r.provider,
      chung_2_nguoi: r.overlap ? "x" : "",
      nguoi_chinh: r.owner,
    });
    row.alignment = { wrapText: true, vertical: "top" };
    const next = rows[i + 1];
    if (!next || next.test_id !== r.test_id || next.province_code !== r.province_code)
      row.border = { bottom: { style: "medium", color: { argb: "FF7F7F7F" } } };
  });

  const last = rows.length + 1;
  ws.dataValidations.add(`M2:M${last}`, { type: "list", allowBlank: true, formulae: [`"${LABELS.join(",")}"`] });
  const lists = wb.addWorksheet("DanhSach");
  const causes = SHOW_AUTO ? CAUSES : CAUSES.filter((c) => !c.startsWith("Checker"));
  causes.forEach((c, i) => (lists.getCell(`A${i + 1}`).value = c));
  lists.state = "hidden";
  ws.dataValidations.add(`N2:N${last}`, { type: "list", allowBlank: true, formulae: [`DanhSach!$A$1:$A$${causes.length}`] });
  ws.autoFilter = { from: "A1", to: "T1" };
  await wb.xlsx.writeFile(out);
}

(async () => {
  if (!DRY) fs.mkdirSync(OUT_DIR, { recursive: true });
  const orderModel = (m) => MODEL_ORDER.indexOf(m);
  const summary = [];

  for (const grader of graders) {
    const rows = [];
    for (const code of Object.keys(plan)) {
      const pl = plan[code];
      const own = pl.grader === grader;
      const ids = own ? pl.sampled : pl.overlap; // người kia chỉ chấm phần chung
      for (const id of ids)
        for (const r of pl.rowsByQ.get(id) || [])
          rows.push({ ...r, overlap: pl.overlap.includes(id), owner: pl.grader || "" });
    }
    rows.sort(
      (a, b) =>
        codes.indexOf(a.province_code) - codes.indexOf(b.province_code) ||
        String(a.test_id).localeCompare(String(b.test_id)) ||
        orderModel(a.model) - orderModel(b.model) ||
        String(a.provider).localeCompare(String(b.provider)),
    );
    const out = path.join(OUT_DIR, `cham_tay_${grader}.xlsx`);
    if (DRY) {
      summary.push({ nguoi_cham: grader, so_dong: rows.length, file: "(dry-run)" });
      continue;
    }
    if (fs.existsSync(out) && hasGraded(out) && !FORCE) {
      console.warn(`BỎ QUA (đã có dòng chấm, dùng --force nếu thật sự muốn ghi đè): ${out}`);
      continue;
    }
    await writeSheet(rows, out, grader);
    summary.push({ nguoi_cham: grader, so_dong: rows.length, file: path.basename(out) });
  }

  if (!DRY)
  fs.writeFileSync(
    path.join(OUT_DIR, "manifest_mau.json"),
    JSON.stringify(
      {
        seed: SEED,
        n: N,
        n_hcm: N_HCM,
        overlap: OVERLAP,
        assign: ASSIGN,
        provinces: Object.fromEntries(
          Object.entries(plan).map(([c, p]) => [c, { grader: p.grader, sizes: p.sizes, quota: p.quota, sampled: p.sampled, overlap: p.overlap }]),
        ),
      },
      null,
      2,
    ),
  );

  console.log("\n=== Mẫu theo tỉnh ===");
  console.table(
    Object.entries(plan).map(([c, p]) => ({
      tinh: c,
      nguoi_chinh: p.grader,
      cau_trong_bo: Object.values(p.sizes).reduce((a, b) => a + b, 0),
      cau_duoc_chon: p.sampled.length,
      cau_chung_2_nguoi: p.overlap.length,
      dong_can_cham: [...p.rowsByQ.values()].reduce((a, v) => a + v.length, 0),
    })),
  );
  console.log("\n=== Khối lượng mỗi người (gồm cả phần chung) ===");
  console.table(summary);
  if (!DRY) console.log(`Manifest: ${path.join(OUT_DIR, "manifest_mau.json")}`);
})();