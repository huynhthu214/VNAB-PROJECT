// scripts/aggregateManual.js
// Tính accuracy từ file ĐÃ CHẤM TAY (cham_tay_*.xlsx), 1 hoặc NHIỀU file (mỗi tỉnh 1 file).
//
// Cách dùng:
//   node scripts/aggregateManual.js --file <file>                       # 1 file
//   node scripts/aggregateManual.js --file <f1> --file <f2> ...         # nhiều file
//   node scripts/aggregateManual.js --dir data/batch_results/official_batch   # quét mọi cham_tay_*.xlsx (đệ quy)
//   thêm --out <file.xlsx> để chọn nơi ghi (mặc định: cạnh file đầu tiên, hoặc <dir>/accuracy_cham_tay_all.xlsx)
//
// Quy ước (theo KE_HOACH mục 4):
//   - "Lỗi hạ tầng" bị LOẠI khỏi mẫu số.
//   - "No_answer hợp lệ" tính là ĐÚNG.
//   - accuracy_nghiem = (Đúng + No_answer hợp lệ) / mẫu số
//   - accuracy_noi    = (Đúng + No_answer hợp lệ + Một phần) / mẫu số   (tham khảo)
// Dòng chưa điền nhan_cham_tay được báo cáo và KHÔNG tính.
// TOKEN: nếu file chấm tay có cột input_tokens / output_tokens (buildGradingSheet.js bản mới) thì mọi
// bảng có thêm llm_call_cau, avg_input_tokens, avg_output_tokens, tong_token và token_moi_cau_dung
// (tổng token / số câu Đúng + No_answer hợp lệ). Trung bình chỉ tính trên các câu CÓ gọi LLM.
// File chấm tay tạo bằng bản cũ (không có cột token) -> cột token để trống, không lỗi.
// Nhãn không thuộc 5 nhãn hợp lệ (gõ sai/dán sai) được CẢNH BÁO và không tính.
// Dòng trùng (cùng tỉnh + test_id + model) giữa các file chỉ tính 1 lần (ưu tiên dòng đã chấm).

const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const argv = process.argv;
const argOne = (name, def) => {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
};
const argAll = (name) =>
  argv.flatMap((a, i) => (a === name && argv[i + 1] ? [argv[i + 1]] : []));

const walk = (d) =>
  fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(d, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });

const DIR = argOne("--dir", null);
let FILES = argAll("--file").map((f) => path.resolve(f));
if (DIR) {
  FILES.push(
    ...walk(path.resolve(DIR)).filter((p) =>
      /^cham_tay_.*\.xlsx$/i.test(path.basename(p)),
    ),
  );
}
if (!FILES.length) {
  FILES = [
    path.resolve(
      path.join(__dirname, "../data/batch_results/cham_tay_cohere.xlsx"),
    ),
  ];
}
FILES = [...new Set(FILES)];

const LABELS = ["Đúng", "Sai", "Một phần", "No_answer hợp lệ", "Lỗi hạ tầng"];
const MODEL_ORDER = ["rule_based", "naive_rag", "advanced_rag", "modular_rag"];
const norm = (s) => String(s || "").trim();
const pidOf = (r) => Number(r.province_id || 1); // file TP.HCM cũ thiếu cột -> 1

// ---- đọc và gộp, loại trùng ----
const byKey = new Map();
let conflicts = 0;
for (const f of FILES) {
  const wb = XLSX.readFile(f);
  if (!wb.Sheets["ChamTay"]) {
    console.warn(`Bỏ qua (không có sheet ChamTay): ${f}`);
    continue;
  }
  for (const r of XLSX.utils.sheet_to_json(wb.Sheets["ChamTay"])) {
    const row = { ...r, province_id: pidOf(r), _file: path.basename(f) };
    const key = `${row.province_id}|${row.test_id}|${row.model}`;
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, row);
    else {
      const pg = !!norm(prev.nhan_cham_tay),
        cg = !!norm(row.nhan_cham_tay);
      if (pg && cg && norm(prev.nhan_cham_tay) !== norm(row.nhan_cham_tay))
        conflicts++;
      if (!pg && cg) byKey.set(key, row);
    }
  }
}
const rows = [...byKey.values()];

const gradedAny = rows.filter((r) => norm(r.nhan_cham_tay));
const unknown = gradedAny.filter(
  (r) => !LABELS.includes(norm(r.nhan_cham_tay)),
);
const graded = gradedAny.filter((r) => LABELS.includes(norm(r.nhan_cham_tay)));
const pending = rows.length - gradedAny.length;

const toNum = (v) => {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

function stat(rs) {
  const c = (l) => rs.filter((r) => norm(r.nhan_cham_tay) === l).length;
  const dung = c("Đúng"),
    sai = c("Sai"),
    mp = c("Một phần"),
    na = c("No_answer hợp lệ"),
    loi = c("Lỗi hạ tầng");
  const mau = dung + sai + mp + na;
  const pct = (x) => (mau ? +((x / mau) * 100).toFixed(1) : null);
  // token: chỉ tính dòng đã chấm có gọi LLM (token != null), loại "Lỗi hạ tầng"
  const llm = rs.filter(
    (r) =>
      norm(r.nhan_cham_tay) !== "Lỗi hạ tầng" &&
      (toNum(r.input_tokens) !== null || toNum(r.output_tokens) !== null),
  );
  const sumTok = (k) => llm.reduce((a, r) => a + (toNum(r[k]) || 0), 0);
  const tin = sumTok("input_tokens");
  const tout = sumTok("output_tokens");
  return {
    tong: rs.length,
    loi_ha_tang: loi,
    mau_so: mau,
    dung,
    mot_phan: mp,
    no_answer_hop_le: na,
    sai,
    accuracy_nghiem_pct: pct(dung + na),
    accuracy_noi_pct: pct(dung + na + mp),
    llm_call_cau: llm.length,
    avg_input_tokens: llm.length ? Math.round(tin / llm.length) : null,
    avg_output_tokens: llm.length ? Math.round(tout / llm.length) : null,
    tong_token: tin + tout,
    token_moi_cau_dung:
      llm.length && dung + na ? Math.round((tin + tout) / (dung + na)) : null,
  };
}
const group = (rs, keyFn) => {
  const m = new Map();
  rs.forEach((r) => {
    const k = keyFn(r);
    (m.get(k) || m.set(k, []).get(k)).push(r);
  });
  return m;
};
const ordM = (m) => MODEL_ORDER.indexOf(m);

// tiến độ chấm theo tỉnh
const progress = [...group(rows, (r) => r.province_id)]
  .map(([pid, rs]) => ({
    province_id: pid,
    tong_dong: rs.length,
    da_cham: rs.filter((r) => norm(r.nhan_cham_tay)).length,
    chua_cham: rs.filter((r) => !norm(r.nhan_cham_tay)).length,
  }))
  .sort((a, b) => a.province_id - b.province_id);

const byModel = [...group(graded, (r) => `${r.province_id}|${r.model}`)]
  .map(([k, rs]) => {
    const [pid, model] = k.split("|");
    return { province_id: +pid, model, ...stat(rs) };
  })
  .sort(
    (a, b) => a.province_id - b.province_id || ordM(a.model) - ordM(b.model),
  );

const byCat = [
  ...group(graded, (r) => `${r.province_id}|${r.model}|${r.category}`),
]
  .map(([k, rs]) => {
    const [pid, model, category] = k.split("|");
    return { province_id: +pid, model, category, ...stat(rs) };
  })
  .sort(
    (a, b) =>
      a.province_id - b.province_id ||
      ordM(a.model) - ordM(b.model) ||
      a.category.localeCompare(b.category),
  );

// gộp theo model: TP.HCM (id=1) tách riêng với các tỉnh còn lại
const nOther = new Set(
  graded.filter((r) => r.province_id !== 1).map((r) => r.province_id),
).size;
const pooled = [];
for (const model of MODEL_ORDER) {
  const other = graded.filter((r) => r.model === model && r.province_id !== 1);
  if (other.length)
    pooled.push({
      nhom: `${nOther} tỉnh khác (gộp, không gồm TP.HCM)`,
      model,
      ...stat(other),
    });
  const hcm = graded.filter((r) => r.model === model && r.province_id === 1);
  if (hcm.length) pooled.push({ nhom: "TP.HCM", model, ...stat(hcm) });
}

// gộp theo nhóm câu hỏi (các tỉnh khác), để đưa vào báo cáo
const poolCat = [
  ...group(
    graded.filter((r) => r.province_id !== 1),
    (r) => `${r.category}|${r.model}`,
  ),
]
  .map(([k, rs]) => {
    const [category, model] = k.split("|");
    return { category, model, ...stat(rs) };
  })
  .sort(
    (a, b) =>
      a.category.localeCompare(b.category) || ordM(a.model) - ordM(b.model),
  );

// phân bố nhóm lỗi (chỉ Sai / Một phần)
const causes = [
  ...group(
    graded.filter((r) => ["Sai", "Một phần"].includes(norm(r.nhan_cham_tay))),
    (r) => `${r.model}|${norm(r.nhom_loi) || "(chưa chọn)"}`,
  ),
]
  .map(([k, rs]) => ({
    model: k.split("|")[0],
    nhom_loi: k.split("|")[1],
    so_cau: rs.length,
  }))
  .sort((a, b) => ordM(a.model) - ordM(b.model) || b.so_cau - a.so_cau);

// độ lệch giữa checker tự động và chấm tay
const autoOk = (r) => r.auto_pass === "PASS";
const manualOk = (r) =>
  ["Đúng", "No_answer hợp lệ"].includes(norm(r.nhan_cham_tay));
const dis = graded.filter(
  (r) =>
    r.auto_pass !== "ERR" &&
    norm(r.nhan_cham_tay) !== "Lỗi hạ tầng" &&
    autoOk(r) !== manualOk(r),
);
const disagree = dis.map((r) => ({
  province_id: r.province_id,
  test_id: r.test_id,
  model: r.model,
  auto_pass: r.auto_pass,
  nhan_cham_tay: r.nhan_cham_tay,
  ghi_chu: r.ghi_chu || "",
}));

console.log(
  `Đọc ${FILES.length} file, ${rows.length} dòng sau khi loại trùng.`,
);
console.log(
  `Đã chấm ${gradedAny.length}/${rows.length} dòng (còn ${pending} dòng chưa chấm).`,
);
if (
  !rows.some(
    (r) => toNum(r.input_tokens) !== null || toNum(r.output_tokens) !== null,
  )
)
  console.warn(
    "LƯU Ý: không có dòng nào có token. File chấm tay có thể được tạo trước khi buildGradingSheet.js thêm cột input_tokens/output_tokens (hoặc batch chưa ghi token) -> các cột token để trống.",
  );
if (conflicts)
  console.warn(
    `CẢNH BÁO: ${conflicts} dòng trùng giữa các file nhưng nhãn KHÁC nhau (đã lấy dòng đọc trước).`,
  );
if (unknown.length) {
  console.warn(
    `CẢNH BÁO: ${unknown.length} dòng có nhãn KHÔNG hợp lệ, không được tính. Ví dụ:`,
  );
  console.table(
    unknown.slice(0, 10).map((r) => ({
      province_id: r.province_id,
      test_id: r.test_id,
      model: r.model,
      nhan: r.nhan_cham_tay,
    })),
  );
}
console.log("\n=== Tiến độ chấm theo tỉnh ===");
console.table(progress);
console.log("\n=== Tỉnh x model ===");
console.table(byModel);
console.log("\n=== Gộp theo model ===");
console.table(pooled);
console.log("\n=== Nhóm lỗi (Sai + Một phần) ===");
console.table(causes);
console.log(
  `\nChecker tự động lệch với chấm tay: ${dis.length} dòng (xem sheet LechAuto).`,
);

const out = XLSX.utils.book_new();
const add = (name, data) =>
  XLSX.utils.book_append_sheet(
    out,
    XLSX.utils.json_to_sheet(data.length ? data : [{}]),
    name,
  );
add("TienDo", progress);
add("TinhxModel", byModel);
add("TinhxModelxNhom", byCat);
add("GopTheoModel", pooled);
add("GopTheoNhom", poolCat);
add("NhomLoi", causes);
add("LechAuto", disagree);

const OUT = path.resolve(
  argOne(
    "--out",
    DIR && FILES.length > 1
      ? path.join(path.resolve(DIR), "accuracy_cham_tay_all.xlsx")
      : path.join(path.dirname(FILES[0]), "accuracy_cham_tay.xlsx"),
  ),
);
XLSX.writeFile(out, OUT);
console.log("Đã ghi:", OUT);
