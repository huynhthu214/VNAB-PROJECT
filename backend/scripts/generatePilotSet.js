// scripts/generatePilotSet.js
// Dựng PILOT MỚI để chỉnh/kiểm chứng ngưỡng rerank. Pilot KHÔNG được trùng câu hỏi với bộ test đóng băng.
//
// Quy trình:
//   1) Sinh bộ ứng viên bằng generator (seed khác, thư mục ra riêng, KHÔNG đụng data/offical_test):
//        node scripts/generateTestMatrix.js --excel-dir "<thư mục dữ liệu>" --all --hcm-fresh --seed 2026 --out-dir data/pilot_candidates
//   2) Chạy file này để lọc và chọn pilot:
//        node scripts/generatePilotSet.js            (mặc định seed 2026)
//        node scripts/generatePilotSet.js --seed 7   (đổi seed lấy mẫu)
//        node scripts/generatePilotSet.js --force    (cho phép ghi đè pilot_v2.xlsx đã có)
//
// Chỉ ĐỌC: data/offical_test, data/pilot_candidates, pilot_questions_fixed.csv (33 câu pilot cũ)
// Chỉ GHI: data/pilot_v2/pilot_v2.xlsx và data/pilot_v2/pilot_v2_questions.csv
try {
  require("dotenv").config();
} catch (e) {
  /* dotenv không bắt buộc */
}
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const DATA_DIR = path.join(__dirname, "../data");
const FROZEN_DIR = path.join(DATA_DIR, "offical_test"); // bộ test đóng băng (giữ nguyên tên thư mục)
const CAND_DIR = path.join(DATA_DIR, "pilot_candidates"); // ứng viên do generator sinh ở bước 1
const OLD_PILOT_CSV = path.join(__dirname, "../pilot_questions_fixed.csv");
const OUT_DIR = path.join(DATA_DIR, "pilot_v2");
const OUT_XLSX = path.join(OUT_DIR, "pilot_v2.xlsx");
const OUT_CSV = path.join(OUT_DIR, "pilot_v2_questions.csv");
const BY_PROV_DIR = path.join(OUT_DIR, "by_province"); // runBatchTest.js chạy theo từng tỉnh nên cần file riêng cho mỗi tỉnh

function getArg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}
const SEED = Number(getArg("--seed") || 2026); // ghi seed này vào báo cáo
const FORCE = process.argv.includes("--force");

// Số câu CÓ ĐÁP ÁN lấy từ ứng viên cho mỗi nhóm. T6, T7, T8_ambiguous không dùng để chỉnh ngưỡng rerank.
const QUOTA = {
  T1_1_to_1: 8,
  T2_1_to_N: 8,
  T3_N_to_1: 8,
  T4_mot_phan: 6,
  T5_new_to_old: 10,
};

// Câu NGOÀI PHẠM VI viết tay (khác kiểu mẫu của generator). Câu nào trùng bộ test sẽ tự bị loại.
const OOS_KEYWORD = "ngoài phạm vi";
const OOS = [
  "Giá thuê căn hộ ở Phường Sài Gòn hiện nay là bao nhiêu?",
  "Phường Tân Định có bao nhiêu hộ dân?",
  "Ai là chủ tịch UBND Phường Bến Nghé hiện nay?",
  "Số điện thoại UBND Phường Vĩnh Hội là gì?",
  "Muốn đổi giấy phép lái xe sau khi sáp nhập thì nộp ở đâu?",
  "Trường tiểu học nào tốt nhất ở Phường Xuân Hòa?",
  "Tuyến xe buýt nào đi qua Phường Cầu Ông Lãnh?",
  "Diện tích Phường Bàn Cờ là bao nhiêu km2?",
  "Hà Nội có bao nhiêu phường sau sắp xếp?",
  "Tỉnh Quảng Ninh sau sáp nhập có bao nhiêu xã?",
  "Thành phố Đà Nẵng và Quảng Nam hợp nhất thành đơn vị nào?",
  "Hướng dẫn nấu bún bò Huế cho 4 người.",
  "Kết quả trận Việt Nam gặp Thái Lan tối qua?",
  "Giá vàng SJC hôm nay bao nhiêu?",
  "Tỷ lệ thất nghiệp của TP.HCM năm 2025 là bao nhiêu phần trăm?",
  "Dự báo mưa ở Cần Thơ cuối tuần này?",
  "Cách tính thuế thu nhập cá nhân khi bán nhà?",
  "Sau sáp nhập, biển số xe của người dân Bình Dương có đổi không?",
  "Quy hoạch tuyến metro số 2 đi qua những phường nào?",
  "Tên gọi cũ của Phường Tân Hòa Đông thời Pháp thuộc là gì?",
];

// runBatchTest.js bắt buộc có PROVINCE, nên câu ngoài phạm vi cũng phải gán vào một tỉnh:
// câu nhắc tên đơn vị của TP.HCM gán HCM, các câu còn lại chia vòng cho cả 8 tỉnh
const PROV_CODES = ["HCM", "AG", "CM", "CT", "DN", "DT", "TN", "VL"];
const HCM_WORDS =
  /Sài Gòn|Tân Định|Bến Nghé|Vĩnh Hội|Bàn Cờ|Cầu Ông Lãnh|Tân Hòa Đông|Xuân Hòa|TP\.HCM/i;

// Cột ghi ra: cùng cấu trúc bộ test để runBatchTest.js đọc được, thêm province và unit_overlap
const COLS = [
  "test_id",
  "category",
  "source_case",
  "old_unit_name",
  "old_parent",
  "question",
  "expected_answer",
  "expected_count",
  "must_contain",
  "must_not_contain",
  "difficulty",
  "golden",
  "notes",
  "province",
  "unit_overlap",
];

// ======== TIỆN ÍCH ========
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
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

// Chuẩn hóa để so sánh câu hỏi: NFC, chữ thường, bỏ dấu câu cuối, gộp khoảng trắng
const norm = (s) =>
  String(s ?? "")
    .normalize("NFC")
    .toLowerCase()
    .trim()
    .replace(/[?!.\s]+$/, "")
    .replace(/\s+/g, " ");

// Khóa đơn vị: "phường tân tạo, quận bình tân". Không dùng \b vì JS coi chữ có dấu là ký tự không phải từ.
const UNIT = new RegExp(
  "(phường|xã|thị trấn)\\s+[^,?]+?" +
    "(?:,\\s*(?:quận|huyện|thành phố|thị xã|tp\\.?)\\s+[^,?]+?)?" +
    "(?=\\s+(?:cũ|được|sau|bây|giờ|sáp|thuộc|nay|trước|gồm|chia)(?=[\\s?,.]|$)|[?,]|$)",
  "u",
);
function unitKey(q) {
  const m = UNIT.exec(norm(q));
  return m ? m[0] : null;
}

function loadDir(dir) {
  if (!fs.existsSync(dir)) throw new Error(`Không thấy thư mục ${dir}`);
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^test_matrix_.+\.xlsx$/i.test(f))
    .sort();
  if (!files.length)
    throw new Error(`Không có file test_matrix_*.xlsx trong ${dir}`);
  const rows = [];
  for (const f of files) {
    const wb = XLSX.readFile(path.join(dir, f));
    const sheetName =
      wb.SheetNames.find((s) => s.startsWith("TestCases")) || wb.SheetNames[0];
    const province = f.replace(/^test_matrix_/i, "").replace(/\.xlsx$/i, "");
    for (const r of XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      defval: "",
    })) {
      rows.push({ ...r, province });
    }
  }
  return rows;
}

function loadOldPilot() {
  if (!fs.existsSync(OLD_PILOT_CSV)) {
    console.warn(
      `Cảnh báo: không thấy ${OLD_PILOT_CSV}, bỏ qua bước loại 33 câu pilot cũ.`,
    );
    return new Set();
  }
  const lines = fs
    .readFileSync(OLD_PILOT_CSV, "utf8")
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/);
  return new Set(
    lines
      .slice(1)
      .map((l) => l.trim().replace(/^"|"$/g, ""))
      .filter(Boolean)
      .map(norm),
  );
}

// Lấy k dòng, xoay vòng giữa các tỉnh để pilot không dồn vào một tỉnh
function roundRobin(rows, k) {
  const byProv = new Map();
  for (const r of rows) {
    if (!byProv.has(r.province)) byProv.set(r.province, []);
    byProv.get(r.province).push(r);
  }
  const ranked = [];
  for (const [prov, list] of byProv)
    list.forEach((r, i) => ranked.push({ r, i, prov }));
  ranked.sort((x, y) => x.i - y.i || x.prov.localeCompare(y.prov));
  return ranked.slice(0, k).map((x) => x.r);
}

const csvCell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

// ======== CHẠY ========
function run() {
  if (fs.existsSync(OUT_XLSX) && !FORCE) {
    console.error(
      `Đã có ${OUT_XLSX}. Pilot cần giữ nguyên để tái lập; thêm --force nếu thật sự muốn ghi đè.`,
    );
    process.exit(1);
  }
  if (!fs.existsSync(CAND_DIR)) {
    console.error(
      `Chưa có ${CAND_DIR}. Sinh ứng viên trước:\n` +
        `  node scripts/generateTestMatrix.js --excel-dir "<thư mục dữ liệu>" --all --hcm-fresh --seed 2026 --out-dir data/pilot_candidates`,
    );
    process.exit(1);
  }
  if (path.resolve(CAND_DIR) === path.resolve(FROZEN_DIR)) {
    console.error(
      "Thư mục ứng viên trùng thư mục bộ test đóng băng, dừng lại.",
    );
    process.exit(1);
  }

  const frozen = loadDir(FROZEN_DIR);
  const cand = loadDir(CAND_DIR);
  const banned = new Set([
    ...frozen.map((r) => norm(r.question)),
    ...loadOldPilot(),
  ]);
  const frozenUnits = new Set(
    frozen.map((r) => unitKey(r.question)).filter(Boolean),
  );
  console.log(
    `Bộ test đóng băng: ${frozen.length} câu. Ứng viên: ${cand.length} câu. Seed: ${SEED}`,
  );

  // Loại câu trùng nguyên văn (cả bộ test lẫn pilot cũ) và trùng lẫn nhau, gắn cờ trùng đơn vị
  const seen = new Set();
  const pool = [];
  for (const r of cand) {
    const k = norm(r.question);
    if (!k || banned.has(k) || seen.has(k)) continue;
    seen.add(k);
    const uk = unitKey(r.question);
    pool.push({ ...r, unit_overlap: uk ? frozenUnits.has(uk) : false });
  }
  const overlapN = pool.filter((r) => r.unit_overlap).length;
  console.log(
    `Ứng viên sau khi loại câu trùng nguyên văn: ${pool.length} (trùng đơn vị với bộ test: ${overlapN})`,
  );

  const rng = mulberry32(SEED);
  const picked = [];
  const report = [];
  for (const [cat, n] of Object.entries(QUOTA)) {
    let rows = shuffle(
      pool.filter((r) => r.category === cat),
      rng,
    );
    const total = rows.length;
    if (cat === "T2_1_to_N") {
      // mỗi case T2 có 3 cách hỏi, chỉ lấy 1 cách cho mỗi (tỉnh, case)
      const used = new Set();
      rows = rows.filter((r) => {
        const key = `${r.province}|${r.source_case}`;
        if (used.has(key)) return false;
        used.add(key);
        return true;
      });
    }
    const clean = roundRobin(
      rows.filter((r) => !r.unit_overlap),
      n,
    );
    const dirty =
      clean.length < n
        ? roundRobin(
            rows.filter((r) => r.unit_overlap),
            n - clean.length,
          )
        : [];
    picked.push(...clean, ...dirty);
    report.push([
      cat,
      n,
      clean.length + dirty.length,
      clean.length,
      dirty.length,
      total,
    ]);
  }

  // Câu ngoài phạm vi viết tay
  const oosKept = OOS.filter((q) => !banned.has(norm(q)));
  let rr = 0;
  const oosRows = oosKept.map((q, i) => ({
    test_id: `OOS-${String(i + 1).padStart(2, "0")}`,
    category: "T8_out_of_scope",
    question: q,
    expected_answer: "Ngoài phạm vi dữ liệu",
    must_contain: OOS_KEYWORD,
    province: HCM_WORDS.test(q) ? "HCM" : PROV_CODES[rr++ % PROV_CODES.length],
    unit_overlap: false,
  }));

  // Đổi mã để không lẫn với bộ test khi phân tích log và kết quả
  const pilot = [...picked, ...oosRows].map((r) => {
    const out = {};
    for (const c of COLS) out[c] = r[c] ?? "";
    out.test_id = `PIL-${out.test_id}`;
    return out;
  });

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ws = XLSX.utils.json_to_sheet(pilot, { header: COLS });
  ws["!cols"] = [16, 22, 11, 24, 22, 70, 70, 14, 50, 18, 14, 8, 50, 10, 12].map(
    (w) => ({ wch: w }),
  );
  const byCat = {};
  pilot.forEach((r) => (byCat[r.category] = (byCat[r.category] || 0) + 1));
  const matrix = Object.entries(byCat).map(([category, test_count]) => ({
    category,
    test_count,
    purpose: "Pilot chỉnh/kiểm chứng ngưỡng rerank",
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `TestCases_${pilot.length}`);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(matrix),
    "TestMatrix",
  );
  XLSX.writeFile(wb, OUT_XLSX);

  // File theo tỉnh, cùng định dạng test_matrix_<MÃ>.xlsx để runBatchTest.js đọc được
  fs.mkdirSync(BY_PROV_DIR, { recursive: true });
  for (const f of fs.readdirSync(BY_PROV_DIR)) {
    if (/^test_matrix_.+\.xlsx$/i.test(f))
      fs.unlinkSync(path.join(BY_PROV_DIR, f)); // tránh sót file cũ khi chạy lại --force
  }
  const groups = new Map();
  for (const r of pilot) {
    if (!groups.has(r.province)) groups.set(r.province, []);
    groups.get(r.province).push(r);
  }
  for (const [code, rows] of groups) {
    const wsP = XLSX.utils.json_to_sheet(rows, { header: COLS });
    wsP["!cols"] = ws["!cols"];
    const cnt = {};
    rows.forEach((r) => (cnt[r.category] = (cnt[r.category] || 0) + 1));
    const wbP = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wbP, wsP, `TestCases_${rows.length}`);
    XLSX.utils.book_append_sheet(
      wbP,
      XLSX.utils.json_to_sheet(
        Object.entries(cnt).map(([category, test_count]) => ({
          category,
          test_count,
          purpose: "Pilot ngưỡng rerank",
        })),
      ),
      "TestMatrix",
    );
    XLSX.writeFile(wbP, path.join(BY_PROV_DIR, `test_matrix_${code}.xlsx`));
  }

  const csv = [
    "test_id,category,province,question",
    ...pilot.map((r) =>
      [r.test_id, r.category, r.province, r.question].map(csvCell).join(","),
    ),
  ];
  fs.writeFileSync(OUT_CSV, "\uFEFF" + csv.join("\n") + "\n", "utf8");

  console.log(
    `\n${"nhóm".padEnd(18)}${"cần".padStart(5)}${"lấy".padStart(5)}${"đơn vị mới".padStart(12)}${"trùng đơn vị".padStart(14)}${"sẵn có".padStart(8)}`,
  );
  for (const r of report) {
    console.log(
      `${r[0].padEnd(18)}${String(r[1]).padStart(5)}${String(r[2]).padStart(5)}${String(r[3]).padStart(12)}${String(r[4]).padStart(14)}${String(r[5]).padStart(8)}`,
    );
  }
  console.log(
    `${"T8_out_of_scope".padEnd(18)}viết tay: ${oosKept.length}/${OOS.length} (loại ${OOS.length - oosKept.length} câu trùng bộ test)`,
  );

  const byProv = {};
  pilot.forEach((r) => (byProv[r.province] = (byProv[r.province] || 0) + 1));
  console.log(
    `\nTheo tỉnh: ${Object.entries(byProv)
      .map(([p, n]) => `${p}=${n}`)
      .join(", ")}`,
  );
  console.log(`Tổng cộng: ${pilot.length} câu (seed ${SEED})`);
  console.log(
    `Đã lưu: ${OUT_XLSX}\n        ${OUT_CSV}\n        ${BY_PROV_DIR}\\test_matrix_<MÃ>.xlsx (${groups.size} file: ${[...groups.keys()].sort().join(", ")})`,
  );
}

run();
