// scripts/provinceUtil.js
// Dùng chung cho aggregateProvinces.js / buildGradingSheet.js / aggregateManual.js.
//
// Vì sao cần: province_id là id trong DB của TỪNG MÁY (provinces_new.id) nên 2 máy có thể khác nhau.
// Khóa tỉnh ổn định giữa các máy là MÃ TỈNH (HCM, AG, CM, CT, DN, DT, TN, VL) — do runBatchTest.js
// ghi vào cột province_code của mọi dòng kết quả. Các script tổng hợp nhóm theo mã này, không theo id.
//
// File kết quả CŨ (chưa có cột province_code):
//   - thiếu cả province_id            -> coi là HCM (file TP.HCM đời đầu)
//   - có province_id                  -> tra theo --map <id>=<mã>[,<id>=<mã>...] (có thể truyền nhiều lần)
//       ví dụ:  node scripts/aggregateProvinces.js --map 4=VL,20=VL
//   - province_id = 1 không có --map  -> coi là HCM (giữ hành vi cũ)
//   - id khác không có --map          -> mã tạm "ID_<id>" và in CẢNH BÁO để bạn bổ sung --map

const HCM_CODE = "HCM";
const PROVINCE_ORDER = ["HCM", "AG", "CM", "CT", "DN", "DT", "TN", "VL"];

function parseLegacyMap(argv) {
  const m = {};
  argv.forEach((a, i) => {
    if (a !== "--map" || !argv[i + 1]) return;
    argv[i + 1].split(",").forEach((pair) => {
      const [id, code] = pair.split("=");
      if (id && code) m[String(id).trim()] = code.trim().toUpperCase();
    });
  });
  return m;
}

const LEGACY_MAP = parseLegacyMap(process.argv);
const unmapped = new Set();

function provinceCodeOf(row) {
  const c = row.province_code == null ? "" : String(row.province_code).trim();
  if (c) return c.toUpperCase();
  const hasId =
    row.province_id !== undefined &&
    row.province_id !== null &&
    row.province_id !== "";
  const key = String(hasId ? row.province_id : 1);
  if (LEGACY_MAP[key]) return LEGACY_MAP[key];
  if (key === "1") return HCM_CODE;
  unmapped.add(key);
  return `ID_${key}`;
}

function reportUnmapped() {
  if (!unmapped.size) return;
  console.warn(
    `CẢNH BÁO: file cũ chưa có province_code với province_id = ${[...unmapped].join(", ")} -> tạm gọi là ID_<id>. ` +
      `Thêm --map <id>=<mã tỉnh> (VD: --map ${[...unmapped][0]}=VL) để gộp đúng tỉnh.`,
  );
}

const rank = (code) => {
  const i = PROVINCE_ORDER.indexOf(code);
  return i === -1 ? 999 : i;
};
const cmpProvince = (a, b) =>
  rank(a) - rank(b) || String(a).localeCompare(String(b));

module.exports = {
  HCM_CODE,
  PROVINCE_ORDER,
  provinceCodeOf,
  reportUnmapped,
  cmpProvince,
};
