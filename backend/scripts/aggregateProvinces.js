// scripts/aggregateProvinces.js
// Gộp kết quả runBatchTest.js của nhiều tỉnh -> accuracy theo tỉnh x model x nhóm câu hỏi.
//
// Cách dùng (chạy ở thư mục gốc backend):
//   node scripts/aggregateProvinces.js                      # mọi provider
//   node scripts/aggregateProvinces.js --provider cohere    # chỉ 1 provider
//   node scripts/aggregateProvinces.js --root data/batch_results/official_batch
//
// Đọc mọi file results_<provider>_<model>_<timestamp>.xlsx nằm trong thư mục MÃ TỈNH (HCM, AG, CM, ...).
// Tỉnh được nhận diện bằng TÊN THƯ MỤC, KHÔNG dùng province_id (id khác nhau giữa 2 máy).
// Thư mục/file khác (province_4, _old, file lẻ ở official_batch, _temp_, timing_summary) bị bỏ qua.
// Không có --provider thì chỉ lấy gemini và cohere.
// Nếu cùng (tỉnh, provider, model) có nhiều lượt chạy -> chỉ lấy lượt MỚI NHẤT.
// Lưu ý: "pass" ở đây là chấm TỰ ĐỘNG (must_contain / must_not_contain...) từ runBatchTest.js,
// chưa thay thế bước chấm tay 5 nhãn. Dòng API_ERROR (pass = null) bị loại khỏi mẫu số.
//
// TOKEN: nếu file results_* có cột input_tokens / output_tokens (runBatchTest.js bản mới) thì mỗi
// bảng có thêm: llm_call_cau (số câu có gọi LLM), avg_input_tokens / avg_output_tokens (TB trên các
// câu CÓ gọi LLM), tong_input_tokens, tong_output_tokens, tong_token, token_moi_cau_dung
// (tổng token / số câu đúng — chi phí token cho 1 câu trả lời đúng).
// File results cũ (chưa có cột token) -> các cột token để trống/0, không lỗi.

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

function getArg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const ROOT = path.resolve(
  getArg(
    "--root",
    path.join(__dirname, "../data/batch_results/official_batch"),
  ),
);
const PROVIDER_FILTER = getArg("--provider", null);
const OUT_PATH = path.join(ROOT, "..", "accuracy_by_province.xlsx");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

const FILE_RE =
  /^results_([a-z0-9]+)_([a-z_0-9]+?)_(\d{4}-\d{2}-\d{2}T[\d-]+Z?)\.xlsx$/i;

const ALLOWED = ["gemini", "cohere"];
const files = walk(ROOT)
  .map((p) => ({ p, m: path.basename(p).match(FILE_RE) }))
  .filter((x) => x.m)
  .map((x) => ({
    p: x.p,
    provider: x.m[1].toLowerCase(),
    model: x.m[2],
    ts: x.m[3],
    code: path.relative(ROOT, x.p).split(path.sep)[0],
  }))
  .filter((x) => /^[A-Z]{2,3}$/.test(x.code)) // chỉ thư mục mã tỉnh
  .filter((x) =>
    PROVIDER_FILTER
      ? x.provider === PROVIDER_FILTER.toLowerCase()
      : ALLOWED.includes(x.provider),
  );

if (files.length === 0) {
  console.error(`Không thấy file results_*.xlsx nào trong ${ROOT}`);
  process.exit(1);
}

// Đọc từng file; tỉnh = mã thư mục
const runs = new Map(); // key: province|provider|model -> {ts, rows, file}
for (const f of files) {
  const wb = XLSX.readFile(f.p);
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  if (rows.length === 0) continue;
  const key = `${f.code}|${f.provider}|${f.model}`;
  const prev = runs.get(key);
  if (!prev || f.ts > prev.ts) runs.set(key, { ...f, rows });
}

const isBool = (v) =>
  v === true || v === false || v === "TRUE" || v === "FALSE";
const isPass = (v) => v === true || v === "TRUE";
const toNum = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function stat(rows) {
  const valid = rows.filter((r) => isBool(r.pass));
  const pass = valid.filter((r) => isPass(r.pass)).length;
  const apiErr = rows.filter((r) => !isBool(r.pass)).length;
  const times = rows
    .map((r) => Number(r.response_time_ms))
    .filter(Number.isFinite);
  // token: chỉ tính các câu CÓ gọi LLM (token != null); câu structured/lỗi không kéo trung bình xuống 0
  const llm = rows.filter(
    (r) => toNum(r.input_tokens) !== null || toNum(r.output_tokens) !== null,
  );
  const sumTok = (k) => llm.reduce((a, r) => a + (toNum(r[k]) || 0), 0);
  const tin = sumTok("input_tokens");
  const tout = sumTok("output_tokens");
  return {
    tong_cau: rows.length,
    loi_ha_tang: apiErr,
    mau_so: valid.length,
    dung: pass,
    accuracy_pct: valid.length
      ? +((pass / valid.length) * 100).toFixed(1)
      : null,
    avg_ms: times.length
      ? Math.round(times.reduce((a, b) => a + b, 0) / times.length)
      : null,
    llm_call_cau: llm.length,
    avg_input_tokens: llm.length ? Math.round(tin / llm.length) : null,
    avg_output_tokens: llm.length ? Math.round(tout / llm.length) : null,
    tong_input_tokens: tin,
    tong_output_tokens: tout,
    tong_token: tin + tout,
    token_moi_cau_dung:
      llm.length && pass ? Math.round((tin + tout) / pass) : null,
  };
}

const MODEL_ORDER = ["rule_based", "naive_rag", "advanced_rag", "modular_rag"];
const byModel = [];
const byCategory = [];

const codeRank = (c) => (c === "HCM" ? "0" : "1") + c;
const sorted = [...runs.values()].sort(
  (a, b) =>
    codeRank(a.code).localeCompare(codeRank(b.code)) ||
    a.provider.localeCompare(b.provider) ||
    MODEL_ORDER.indexOf(a.model) - MODEL_ORDER.indexOf(b.model),
);

for (const r of sorted) {
  byModel.push({
    province_code: r.code,
    provider: r.provider,
    model: r.model,
    ...stat(r.rows),
    file: path.basename(r.file ?? r.p),
  });
  const cats = [...new Set(r.rows.map((x) => x.category))].sort();
  for (const c of cats) {
    byCategory.push({
      province_code: r.code,
      provider: r.provider,
      model: r.model,
      category: c,
      ...stat(r.rows.filter((x) => x.category === c)),
    });
  }
}

// Bảng gộp các tỉnh khác (loại HCM) theo provider x model, để so với TP.HCM
const nOther = new Set(
  sorted.filter((r) => r.code !== "HCM").map((r) => r.code),
).size;
const providers = [...new Set(sorted.map((r) => r.provider))].sort();
const pooled = [];
for (const provider of providers)
  for (const isHcm of [false, true])
    for (const model of MODEL_ORDER) {
      const rows = sorted
        .filter(
          (r) =>
            r.provider === provider &&
            r.model === model &&
            (r.code === "HCM") === isHcm,
        )
        .flatMap((r) => r.rows);
      if (rows.length)
        pooled.push({
          nhom: isHcm ? "TP.HCM" : `${nOther} tỉnh khác (gộp)`,
          provider,
          model,
          ...stat(rows),
        });
    }

// Kiểm tra: cùng tỉnh, mọi provider x model phải có cùng số câu (cùng bộ test_gemini)
const sizeByCode = new Map();
for (const r of sorted) {
  const set =
    sizeByCode.get(r.code) || sizeByCode.set(r.code, new Map()).get(r.code);
  set.set(`${r.provider}/${r.model}`, r.rows.length);
}
for (const [code, m] of sizeByCode) {
  const vals = new Set(m.values());
  if (vals.size > 1 || m.size !== providers.length * 4)
    console.warn(
      `CẢNH BÁO ${code}: số câu hoặc số lượt chạy không đồng đều`,
      Object.fromEntries(m),
    );
}

console.log("\n=== Accuracy theo tỉnh x model ===");
console.table(byModel.map(({ file, ...rest }) => rest));
console.log(
  "\n=== TP.HCM vs các tỉnh khác (báo cáo riêng, đừng gộp thành 1 con số) ===",
);
console.table(pooled);

// Bảng rộng: mỗi tỉnh 1 dòng, cột = provider x model (accuracy %). Dùng để báo cáo từng tỉnh độc lập.
const wide = [];
const codesOrdered = [...new Set(sorted.map((r) => r.code))];
for (const code of codesOrdered) {
  const row = { province_code: code };
  for (const provider of providers)
    for (const model of MODEL_ORDER) {
      const x = byModel.find(
        (b) =>
          b.province_code === code &&
          b.provider === provider &&
          b.model === model,
      );
      row[`${provider}_${model}`] = x ? x.accuracy_pct : null;
    }
  row.tong_cau =
    byModel.find((b) => b.province_code === code)?.tong_cau ?? null;
  // chênh lệch Gemini - Cohere (điểm %) cho 3 model dùng LLM
  if (providers.includes("gemini") && providers.includes("cohere"))
    for (const model of MODEL_ORDER.filter((m) => m !== "rule_based")) {
      const g = row[`gemini_${model}`],
        c = row[`cohere_${model}`];
      row[`chenh_gemini_cohere_${model}`] =
        g != null && c != null ? +(g - c).toFixed(1) : null;
    }
  wide.push(row);
}
console.log("\n=== Accuracy từng tỉnh (rộng) ===");
console.table(wide);

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.json_to_sheet(byModel),
  "TinhxModel",
);
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.json_to_sheet(byCategory),
  "TinhxModelxNhom",
);
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.json_to_sheet(wide),
  "TungTinh_Rong",
);
XLSX.utils.book_append_sheet(
  wb,
  XLSX.utils.json_to_sheet(pooled),
  "TPHCM_vs_7Tinh",
);
XLSX.writeFile(wb, OUT_PATH);
console.log(`\nĐã ghi: ${OUT_PATH}`);
