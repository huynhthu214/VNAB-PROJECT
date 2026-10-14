// scripts/aggregateManualSample.js
// Tổng hợp kết quả CHẤM TAY MẪU PHÂN TẦNG (file do buildGradingSample.js tạo).
//
// Cách dùng (thư mục gốc backend), sau khi cả 2 người đã chấm xong:
//   node scripts/aggregateManualSample.js
//   node scripts/aggregateManualSample.js --dir data/batch_results/cham_tay_mau
//
// Đọc: <dir>/cham_tay_<Người>.xlsx (mọi file) + <dir>/manifest_mau.json
// Ghi: <dir>/ket_qua_cham_tay_mau.xlsx
//
// Quy ước nhãn (giống aggregateManual.js cũ):
//   "Lỗi hạ tầng" bị LOẠI khỏi mẫu số; "No_answer hợp lệ" tính là ĐÚNG.
//   accuracy_nghiem = (Đúng + No_answer hợp lệ) / mẫu số ; accuracy_noi = thêm cả "Một phần".
//
// Nhãn CUỐI CÙNG của mỗi dòng = nhãn trong file của người_chính của tỉnh đó.
// Dòng chung_2_nguoi = x nằm ở cả 2 file: nhãn của người kia chỉ dùng để tính độ đồng thuận (kappa).
// Muốn đổi nhãn cuối cùng sau khi bàn bạc: người chính sửa trong file của mình rồi chạy lại.

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const DIR = path.resolve(
  arg("--dir", path.join(__dirname, "../data/batch_results/cham_tay_mau")),
);
const OUT = path.join(DIR, "ket_qua_cham_tay_mau.xlsx");
const manifest = JSON.parse(
  fs.readFileSync(path.join(DIR, "manifest_mau.json"), "utf8"),
);

const MODEL_ORDER = ["rule_based", "naive_rag", "advanced_rag", "modular_rag"];
const LABELS = ["Đúng", "Sai", "Một phần", "No_answer hợp lệ", "Lỗi hạ tầng"];
const norm = (s) => String(s ?? "").trim();
const correct = (l) => l === "Đúng" || l === "No_answer hợp lệ";
const qkey = (r) => `${r.province_code}|${r.test_id}`;
const rkey = (r) => `${r.province_code}|${r.test_id}|${r.model}|${r.provider}`;

// ---------- đọc ----------
const files = fs.readdirSync(DIR).filter((f) => /^cham_tay_.+\.xlsx$/.test(f));
if (!files.length) {
  console.error("Không thấy file cham_tay_*.xlsx trong", DIR);
  process.exit(1);
}
const mine = new Map(); // rkey -> row (nhãn của người chính)
const other = new Map(); // rkey -> row (nhãn của người kia, chỉ dòng chung)
const warnings = [];
for (const f of files) {
  const grader = f.replace(/^cham_tay_/, "").replace(/\.xlsx$/, "");
  const ws = XLSX.readFile(path.join(DIR, f)).Sheets["ChamTay"];
  for (const r of XLSX.utils.sheet_to_json(ws)) {
    r.nhan_cham_tay = norm(r.nhan_cham_tay);
    r.provider = norm(r.provider);
    if (r.nhan_cham_tay && !LABELS.includes(r.nhan_cham_tay)) {
      warnings.push(
        `Nhãn không hợp lệ "${r.nhan_cham_tay}" - ${f} - ${rkey(r)}`,
      );
      continue;
    }
    const isOwner = manifest.provinces[r.province_code]?.grader === grader;
    (isOwner ? mine : other).set(rkey(r), r);
  }
}
const all = [...mine.values()];
const graded = all.filter((r) => r.nhan_cham_tay);
const pending = all.length - graded.length;
if (pending)
  warnings.push(
    `CÒN ${pending}/${all.length} dòng của người chính chưa chấm (không tính).`,
  );

// ---------- thống kê ----------
function wilson(k, n, z = 1.96) {
  if (!n) return [null, null];
  const p = k / n,
    d = 1 + (z * z) / n,
    c = p + (z * z) / (2 * n),
    h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [+(((c - h) / d) * 100).toFixed(1), +(((c + h) / d) * 100).toFixed(1)];
}
const pct = (x, n) => (n ? +((x / n) * 100).toFixed(1) : null);

// Ước lượng có trọng số theo tầng (tỉnh x category): trọng số = số câu trong bộ / số câu đã chấm của tầng.
function stat(rs) {
  const c = (l) => rs.filter((r) => r.nhan_cham_tay === l).length;
  const dung = c("Đúng"),
    sai = c("Sai"),
    mp = c("Một phần"),
    na = c("No_answer hợp lệ"),
    loi = c("Lỗi hạ tầng");
  const valid = rs.filter(
    (r) => r.nhan_cham_tay && r.nhan_cham_tay !== "Lỗi hạ tầng",
  );
  const mau = valid.length;
  const ok = dung + na;
  const [lo, hi] = wilson(ok, mau);
  // có trọng số
  const strata = new Map();
  for (const r of valid) {
    const k = `${r.province_code}|${r.category}`;
    const s =
      strata.get(k) ||
      strata
        .set(k, {
          n: 0,
          ok: 0,
          N: manifest.provinces[r.province_code]?.sizes?.[r.category] || 0,
        })
        .get(k);
    s.n++;
    if (correct(r.nhan_cham_tay)) s.ok++;
  }
  let W = 0,
    acc = 0;
  for (const s of strata.values()) {
    W += s.N;
    acc += s.N * (s.ok / s.n);
  }
  return {
    so_cau_cham: rs.length,
    loi_ha_tang: loi,
    mau_so: mau,
    dung,
    no_answer_hop_le: na,
    mot_phan: mp,
    sai,
    acc_nghiem_pct: pct(ok, mau),
    ci95_thap: lo,
    ci95_cao: hi,
    acc_noi_pct: pct(ok + mp, mau),
    acc_nghiem_co_trong_so_pct: W ? +((acc / W) * 100).toFixed(1) : null,
  };
}
const group = (rs, fn) => {
  const m = new Map();
  rs.forEach((r) => (m.get(fn(r)) || m.set(fn(r), []).get(fn(r))).push(r));
  return m;
};
const modelRank = (m) => MODEL_ORDER.indexOf(m);

// rule_based có provider = "chung": nhân bản cho cả 2 provider khi so sánh
const rowsFor = (prov) =>
  graded.filter(
    (r) =>
      r.provider === prov ||
      (r.provider === "chung" && r.model === "rule_based"),
  );
const providers = [
  ...new Set(graded.map((r) => r.provider).filter((p) => p !== "chung")),
].sort();

const byModel = [];
for (const prov of providers)
  for (const model of MODEL_ORDER)
    for (const nhom of ["Tất cả tỉnh", "TP.HCM", "Các tỉnh khác"]) {
      const rs = rowsFor(prov).filter(
        (r) =>
          r.model === model &&
          (nhom === "Tất cả tỉnh" ||
            (nhom === "TP.HCM") === (r.province_code === "HCM")),
      );
      if (rs.length) byModel.push({ provider: prov, model, nhom, ...stat(rs) });
    }

const byProvince = [];
for (const prov of providers)
  for (const code of Object.keys(manifest.provinces))
    for (const model of MODEL_ORDER) {
      const rs = rowsFor(prov).filter(
        (r) => r.province_code === code && r.model === model,
      );
      if (rs.length)
        byProvince.push({
          provider: prov,
          province_code: code,
          model,
          ...stat(rs),
        });
    }

const byCategory = [];
for (const prov of providers)
  for (const model of MODEL_ORDER) {
    const rs = rowsFor(prov).filter((r) => r.model === model);
    for (const [cat, x] of [...group(rs, (r) => r.category)].sort())
      byCategory.push({ provider: prov, model, category: cat, ...stat(x) });
  }

// ---------- nhóm lỗi ----------
const causes = [];
for (const [k, rs] of group(
  graded.filter((r) => ["Sai", "Một phần"].includes(r.nhan_cham_tay)),
  (r) => `${r.provider}|${r.model}|${norm(r.nhom_loi) || "(chưa chọn)"}`,
)) {
  const [provider, model, nhom_loi] = k.split("|");
  causes.push({ provider, model, nhom_loi, so_dong: rs.length });
}
causes.sort(
  (a, b) =>
    a.provider.localeCompare(b.provider) ||
    modelRank(a.model) - modelRank(b.model) ||
    b.so_dong - a.so_dong,
);

// ---------- so sánh cặp Gemini vs Cohere trên CÙNG câu hỏi ----------
function binom2(b, c) {
  // McNemar chính xác (2 phía)
  const n = b + c;
  if (!n) return null;
  const k = Math.min(b, c);
  let p = 0,
    term = Math.pow(0.5, n),
    comb = 1;
  for (let i = 0; i <= k; i++) {
    if (i > 0) comb = (comb * (n - i + 1)) / i;
    p += comb * term;
  }
  return +Math.min(1, 2 * p).toFixed(4);
}
const paired = [];
for (const model of MODEL_ORDER.filter((m) => m !== "rule_based")) {
  const g = new Map(),
    c = new Map();
  for (const r of graded.filter(
    (x) => x.model === model && x.nhan_cham_tay !== "Lỗi hạ tầng",
  ))
    (r.provider === "gemini" ? g : r.provider === "cohere" ? c : null)?.set(
      qkey(r),
      correct(r.nhan_cham_tay),
    );
  let both = 0,
    onlyG = 0,
    onlyC = 0,
    none = 0;
  for (const [k, v] of g) {
    if (!c.has(k)) continue;
    const w = c.get(k);
    if (v && w) both++;
    else if (v) onlyG++;
    else if (w) onlyC++;
    else none++;
  }
  paired.push({
    model,
    so_cau_ghep_cap: both + onlyG + onlyC + none,
    ca_hai_dung: both,
    chi_gemini_dung: onlyG,
    chi_cohere_dung: onlyC,
    ca_hai_sai: none,
    mcnemar_p: binom2(onlyG, onlyC),
  });
}

// ---------- checker tự động vs chấm tay ----------
function kappa(a, b) {
  // a, b: mảng nhãn (chuỗi) cùng độ dài
  const n = a.length;
  if (!n) return null;
  const cats = [...new Set([...a, ...b])];
  const po = a.filter((x, i) => x === b[i]).length / n;
  const pe = cats.reduce(
    (s, c) =>
      s +
      (a.filter((x) => x === c).length / n) *
        (b.filter((x) => x === c).length / n),
    0,
  );
  return pe === 1 ? 1 : +((po - pe) / (1 - pe)).toFixed(3);
}
const checker = [];
const autoRows = graded.filter(
  (r) =>
    ["PASS", "FAIL"].includes(norm(r.auto_pass)) &&
    r.nhan_cham_tay !== "Lỗi hạ tầng",
);
const mkChecker = (label, rs) => {
  if (!rs.length) return;
  const a = rs.map((r) => (norm(r.auto_pass) === "PASS" ? "ok" : "no"));
  const m = rs.map((r) => (correct(r.nhan_cham_tay) ? "ok" : "no"));
  const fp = rs.filter((r, i) => a[i] === "ok" && m[i] === "no").length;
  const fn = rs.filter((r, i) => a[i] === "no" && m[i] === "ok").length;
  const agree = rs.length - fp - fn;
  const [lo, hi] = wilson(agree, rs.length);
  checker.push({
    nhom: label,
    so_dong: rs.length,
    dong_y_pct: pct(agree, rs.length),
    ci95_thap: lo,
    ci95_cao: hi,
    pass_nham: fp,
    fail_nham: fn,
    kappa_auto_vs_tay: kappa(a, m),
  });
};
mkChecker("Tất cả", autoRows);
for (const model of MODEL_ORDER)
  mkChecker(
    model,
    autoRows.filter((r) => r.model === model),
  );
for (const [cat, rs] of [...group(autoRows, (r) => r.category)].sort())
  mkChecker(`category ${cat}`, rs);
const lech = autoRows
  .filter((r) => (norm(r.auto_pass) === "PASS") !== correct(r.nhan_cham_tay))
  .map((r) => ({
    province_code: r.province_code,
    test_id: r.test_id,
    model: r.model,
    provider: r.provider,
    auto_pass: r.auto_pass,
    nhan_cham_tay: r.nhan_cham_tay,
    nhom_loi: r.nhom_loi || "",
    ghi_chu: r.ghi_chu || "",
  }));

// ---------- đồng thuận giữa 2 người (dòng chung) ----------
const agreeRows = [];
const bat = [];
for (const [k, r] of mine) {
  const o = other.get(k);
  if (!o || !r.nhan_cham_tay || !o.nhan_cham_tay) continue;
  agreeRows.push([r.nhan_cham_tay, o.nhan_cham_tay]);
  if (r.nhan_cham_tay !== o.nhan_cham_tay)
    bat.push({
      province_code: r.province_code,
      test_id: r.test_id,
      model: r.model,
      provider: r.provider,
      nhan_nguoi_chinh: r.nhan_cham_tay,
      nhan_nguoi_kia: o.nhan_cham_tay,
      ghi_chu_chinh: r.ghi_chu || "",
      ghi_chu_kia: o.ghi_chu || "",
    });
}
const A = agreeRows.map((x) => x[0]),
  B = agreeRows.map((x) => x[1]);
const bin = (arr) => arr.map((l) => (correct(l) ? "ok" : "no"));
const inter = [
  {
    so_dong_chung: agreeRows.length,
    dong_y_5_nhan_pct: pct(
      agreeRows.filter(([x, y]) => x === y).length,
      agreeRows.length,
    ),
    kappa_5_nhan: kappa(A, B),
    dong_y_dung_sai_pct: pct(
      bin(A).filter((x, i) => x === bin(B)[i]).length,
      agreeRows.length,
    ),
    kappa_dung_sai: kappa(bin(A), bin(B)),
  },
];
const expectOverlap = Object.values(manifest.provinces).reduce(
  (s, p) => s + p.overlap.length,
  0,
);
if (agreeRows.length === 0)
  warnings.push(
    "Chưa có dòng chung nào được CẢ 2 người chấm -> chưa tính được kappa giữa 2 người.",
  );

// ---------- in và ghi ----------
console.log(
  `Đã chấm ${graded.length}/${all.length} dòng (người chính). Câu chung 2 người: ${expectOverlap} câu.`,
);
if (warnings.length) console.log("\n=== CẢNH BÁO ===\n" + warnings.join("\n"));
console.log("\n=== Accuracy chấm tay theo provider x model (Tất cả tỉnh) ===");
console.table(
  byModel.filter((r) => r.nhom === "Tất cả tỉnh").map(({ nhom, ...x }) => x),
);
console.log("\n=== So sánh cặp Gemini vs Cohere (cùng câu hỏi) ===");
console.table(paired);
console.log("\n=== Checker tự động vs chấm tay ===");
console.table(checker.slice(0, 5));
console.log("\n=== Đồng thuận giữa 2 người ===");
console.table(inter);

const wb = XLSX.utils.book_new();
const add = (name, data) =>
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(data.length ? data : [{}]),
    name,
  );
add("ProviderxModel", byModel);
add("TinhxModel", byProvince);
add("Nhom_category", byCategory);
add("SoSanhCap", paired);
add("NhomLoi", causes);
add("Checker_vs_Tay", checker);
add("LechAuto", lech);
add("DongThuan_2Nguoi", inter);
add("BatDongY_2Nguoi", bat);
add(
  "CanhBao",
  warnings.map((w) => ({ canh_bao: w })),
);
XLSX.writeFile(wb, OUT);
console.log("\nĐã ghi:", OUT);
