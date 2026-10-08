// scripts/aggregateManual.js
// Tính accuracy từ file ĐÃ CHẤM TAY (cham_tay_<provider>.xlsx).
// Cách dùng:  node scripts/aggregateManual.js --file data/batch_results/cham_tay_cohere.xlsx
//
// Quy ước (theo KE_HOACH mục 4):
//   - "Lỗi hạ tầng" bị LOẠI khỏi mẫu số.
//   - "No_answer hợp lệ" tính là ĐÚNG.
//   - accuracy_nghiem = (Đúng + No_answer hợp lệ) / mẫu số
//   - accuracy_noi    = (Đúng + No_answer hợp lệ + Một phần) / mẫu số   (tham khảo)
// Dòng chưa điền nhan_cham_tay sẽ được báo cáo và KHÔNG tính.

const path = require("path");
const XLSX = require("xlsx");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const FILE = path.resolve(
  arg(
    "--file",
    path.join(__dirname, "../data/batch_results/cham_tay_cohere.xlsx"),
  ),
);
const wb = XLSX.readFile(FILE);
const rows = XLSX.utils.sheet_to_json(wb.Sheets["ChamTay"]);

const MODEL_ORDER = ["rule_based", "naive_rag", "advanced_rag", "modular_rag"];
const norm = (s) => String(s || "").trim();
const graded = rows.filter((r) => norm(r.nhan_cham_tay));
const pending = rows.length - graded.length;

function stat(rs) {
  const c = (l) => rs.filter((r) => norm(r.nhan_cham_tay) === l).length;
  const dung = c("Đúng"),
    sai = c("Sai"),
    mp = c("Một phần"),
    na = c("No_answer hợp lệ"),
    loi = c("Lỗi hạ tầng");
  const mau = dung + sai + mp + na;
  const pct = (x) => (mau ? +((x / mau) * 100).toFixed(1) : null);
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

const byModel = [],
  byCat = [],
  causes = [];
for (const [k, rs] of [
  ...group(graded, (r) => `${r.province_id}|${r.model}`),
].sort()) {
  const [pid, model] = k.split("|");
  byModel.push({ province_id: +pid, model, ...stat(rs) });
}
byModel.sort(
  (a, b) =>
    a.province_id - b.province_id ||
    MODEL_ORDER.indexOf(a.model) - MODEL_ORDER.indexOf(b.model),
);
for (const [k, rs] of group(
  graded,
  (r) => `${r.province_id}|${r.model}|${r.category}`,
)) {
  const [pid, model, category] = k.split("|");
  byCat.push({ province_id: +pid, model, category, ...stat(rs) });
}
byCat.sort(
  (a, b) =>
    a.province_id - b.province_id ||
    MODEL_ORDER.indexOf(a.model) - MODEL_ORDER.indexOf(b.model) ||
    a.category.localeCompare(b.category),
);

// tổng theo model: TP.HCM (id=1) tách riêng với các tỉnh còn lại
const pooled = [];
for (const model of MODEL_ORDER) {
  const other = graded.filter(
    (r) => r.model === model && Number(r.province_id || 1) !== 1,
  );
  if (other.length)
    pooled.push({
      nhom: "Các tỉnh khác (gộp, không gồm TP.HCM)",
      model,
      ...stat(other),
    });
  const hcm = graded.filter(
    (r) => r.model === model && Number(r.province_id || 1) === 1,
  );
  if (hcm.length) pooled.push({ nhom: "TP.HCM", model, ...stat(hcm) });
}

// phân bố nhóm lỗi (chỉ Sai / Một phần)
for (const [k, rs] of group(
  graded.filter((r) => ["Sai", "Một phần"].includes(norm(r.nhan_cham_tay))),
  (r) => `${r.model}|${norm(r.nhom_loi) || "(chưa chọn)"}`,
))
  causes.push({
    model: k.split("|")[0],
    nhom_loi: k.split("|")[1],
    so_cau: rs.length,
  });
causes.sort(
  (a, b) =>
    MODEL_ORDER.indexOf(a.model) - MODEL_ORDER.indexOf(b.model) ||
    b.so_cau - a.so_cau,
);

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
  `Đã chấm ${graded.length}/${rows.length} dòng (còn ${pending} dòng chưa chấm).`,
);
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
add("TinhxModel", byModel);
add("TinhxModelxNhom", byCat);
add("GopTheoModel", pooled);
add("NhomLoi", causes);
add("LechAuto", disagree);
const OUT = path.join(path.dirname(FILE), "accuracy_cham_tay.xlsx");
XLSX.writeFile(out, OUT);
console.log("Đã ghi:", OUT);
