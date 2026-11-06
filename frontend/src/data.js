/* =========================================================
   DỮ LIỆU TĨNH DÙNG CHUNG CHO CÁC TAB
   ========================================================= */

/* 8 tỉnh/thành miền Nam sau sáp nhập (Nghị quyết 202/2025/QH15).
   - code     : khóa dùng trong giao diện + khớp với mapData.js
   - apiCode  : khớp cột provinces_new.code trong DB (null → dùng dữ liệu mẫu)
   - oldCodes : mã tỉnh cũ (GSO) để vẽ bản đồ
   - color    : màu nhận diện trên bản đồ */
export const PROVINCES = [
  {
    code: "tphcm",
    name: "TP. Hồ Chí Minh",
    short: "TP.HCM",
    merged: "TP.HCM, Bình Dương, Bà Rịa - Vũng Tàu",
    apiCode: "HCM",
    color: "#0e7c86",
    legalBasis: "Nghị quyết 1685/NQ-UBTVQH15",
    samples: [
      "Phường Bến Nghé cũ bây giờ là phường gì?",
      "Phường Sài Gòn được sáp nhập từ những phường nào?",
      "Phường Đa Kao cũ bây giờ thuộc phường nào?",
    ],
  },
  {
    code: "dongnai",
    name: "Đồng Nai",
    short: "Đồng Nai",
    merged: "Đồng Nai, Bình Phước",
    apiCode: "DN",
    color: "#3b8fd0",
  },
  {
    code: "tayninh",
    name: "Tây Ninh",
    short: "Tây Ninh",
    merged: "Tây Ninh, Long An",
    apiCode: "TN",
    color: "#7b68c8",
  },
  {
    code: "cantho",
    name: "Cần Thơ",
    short: "Cần Thơ",
    merged: "Cần Thơ, Hậu Giang, Sóc Trăng",
    apiCode: "CT",
    color: "#2e9d6c",
  },
  {
    code: "vinhlong",
    name: "Vĩnh Long",
    short: "Vĩnh Long",
    merged: "Vĩnh Long, Bến Tre, Trà Vinh",
    apiCode: "VL",
    color: "#b4619f",
  },
  {
    code: "dongthap",
    name: "Đồng Tháp",
    short: "Đồng Tháp",
    merged: "Đồng Tháp, Tiền Giang",
    apiCode: "DT",
    color: "#e0883a",
  },
  {
    code: "angiang",
    name: "An Giang",
    short: "An Giang",
    merged: "An Giang, Kiên Giang",
    apiCode: "AG",
    color: "#4a5fb8",
  },
  {
    code: "camau",
    name: "Cà Mau",
    short: "Cà Mau",
    merged: "Cà Mau, Bạc Liêu",
    apiCode: "CM",
    color: "#c29b1d",
  },
];

export const NATIONAL_BASIS = {
  code: "202/2025/QH15",
  title: "Nghị quyết về việc sắp xếp đơn vị hành chính cấp tỉnh năm 2025",
};

export const GENERIC_LEGAL_BASIS =
  "Nghị quyết 202/2025/QH15 và nghị quyết chi tiết cấp xã của tỉnh/thành";

export function provinceByCode(code) {
  return PROVINCES.find((p) => p.code === code);
}

export function oldProvinceList(p) {
  return p.merged.split(",").map((x) => x.trim());
}

/* =========================================================
   DỮ LIỆU MẪU — dùng khi chưa bật API tra cứu (xem api.js)
   TP.HCM: theo Nghị quyết 1685/NQ-UBTVQH15. 7 tỉnh còn lại: minh họa.
   ========================================================= */
export const MOCK_UNITS = [
  {
    province: "tphcm",
    old_names: [
      "Phường Bến Nghé",
      "Phường Bến Thành",
      "Phường Nguyễn Thái Bình",
    ],
    new_name: "Phường Sài Gòn",
    old_parent: "Quận 1",
    headquarters_address: "86 Lê Thánh Tôn, Quận 1 cũ",
    decision_number: "1685/NQ-UBTVQH15",
    decision_date: "2025-06-16",
  },
  {
    province: "tphcm",
    old_names: ["Phường Tân Định"],
    new_name: "Phường Tân Định",
    old_parent: "Quận 1",
    headquarters_address: "48 Nguyễn Hữu Cầu, Quận 1 cũ",
    decision_number: "1685/NQ-UBTVQH15",
    decision_date: "2025-06-16",
  },
  {
    province: "tphcm",
    old_names: ["Phường Linh Tây"],
    new_name: "Phường Linh Xuân",
    old_parent: "TP. Thủ Đức",
    headquarters_address: "Đường Kha Vạn Cân, TP. Thủ Đức cũ",
    decision_number: "1685/NQ-UBTVQH15",
    decision_date: "2025-06-16",
  },
  {
    province: "dongnai",
    old_names: ["Phường Tân Phong", "Phường Trảng Dài"],
    new_name: "Phường Biên Hòa",
    old_parent: "TP. Biên Hòa cũ",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "dongnai",
    old_names: ["Xã Tân Lợi"],
    new_name: "Xã Đồng Xoài",
    old_parent: "Đồng Phú cũ (Bình Phước cũ)",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "tayninh",
    old_names: ["Phường 2"],
    new_name: "Phường Tây Ninh",
    old_parent: "TP. Tây Ninh cũ",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "tayninh",
    old_names: ["Phường Tân An"],
    new_name: "Phường Tân An",
    old_parent: "TP. Tân An cũ (Long An cũ)",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "cantho",
    old_names: ["Phường An Hòa"],
    new_name: "Phường Ninh Kiều",
    old_parent: "Quận Ninh Kiều cũ",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "cantho",
    old_names: ["Phường 1"],
    new_name: "Phường Vị Thanh",
    old_parent: "TP. Vị Thanh cũ (Hậu Giang cũ)",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "vinhlong",
    old_names: ["Phường 4"],
    new_name: "Phường Vĩnh Long",
    old_parent: "TP. Vĩnh Long cũ",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "vinhlong",
    old_names: ["Phường 1"],
    new_name: "Phường Trà Vinh",
    old_parent: "TP. Trà Vinh cũ (Trà Vinh cũ)",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "dongthap",
    old_names: ["Phường 1"],
    new_name: "Phường Cao Lãnh",
    old_parent: "TP. Cao Lãnh cũ",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "dongthap",
    old_names: ["Phường 8"],
    new_name: "Phường Mỹ Tho",
    old_parent: "TP. Mỹ Tho cũ (Tiền Giang cũ)",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "angiang",
    old_names: ["Phường Mỹ Long"],
    new_name: "Phường Long Xuyên",
    old_parent: "TP. Long Xuyên cũ",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "angiang",
    old_names: ["Phường Vĩnh Thanh Vân"],
    new_name: "Phường Rạch Giá",
    old_parent: "TP. Rạch Giá cũ (Kiên Giang cũ)",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "camau",
    old_names: ["Phường 5"],
    new_name: "Phường Cà Mau",
    old_parent: "TP. Cà Mau cũ",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
  {
    province: "camau",
    old_names: ["Phường 3"],
    new_name: "Phường Bạc Liêu",
    old_parent: "TP. Bạc Liêu cũ (Bạc Liêu cũ)",
    headquarters_address: "(minh họa)",
    decision_number: "—/NQ-UBTVQH15 (minh họa)",
    decision_date: "2025-07-01",
  },
];

/* =========================================================
   TIỆN ÍCH CHUỖI
   ========================================================= */

// Bỏ dấu tiếng Việt, theo từng ký tự để độ dài chuỗi gốc và chuỗi đã bỏ dấu
// luôn bằng nhau (cần cho việc tô sáng đoạn khớp).
export function fold(s) {
  let out = "";
  for (const ch of String(s ?? "").normalize("NFC")) {
    const f = ch
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/đ/g, "d");
    out += f.length === 1 ? f : ch.toLowerCase();
  }
  return out;
}

// Tên đơn vị: "Phường Sài Gòn" → "Phường"; "Thị trấn X" → "Thị trấn"
export function unitKind(name) {
  const n = String(name || "").trim();
  if (/^thị trấn/i.test(n)) return "Thị trấn";
  if (/^phường/i.test(n)) return "Phường";
  if (/^xã/i.test(n)) return "Xã";
  if (/^đặc khu/i.test(n)) return "Đặc khu";
  return "";
}

export function formatDate(iso) {
  if (!iso) return "";
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso);
}

export function mergeLabel(m) {
  return m === "mot_phan" ? "Một phần" : "Toàn bộ";
}

/* Chuyển MOCK_UNITS (mỗi dòng = 1 đơn vị mới + nhiều đơn vị cũ) về dạng chuẩn
   mà các tab dùng: xem normalizeApiUnit trong api.js cho dạng từ backend. */
export function mockToUnits() {
  return MOCK_UNITS.map((u, i) => ({
    id: `mock_${i}`,
    province: u.province,
    newName: u.new_name,
    newType: unitKind(u.new_name),
    oldUnits: u.old_names.map((n) => ({
      name: n,
      type: unitKind(n),
      parent: u.old_parent,
      merge: u.merge_type || "toan_bo",
    })),
    hq: u.headquarters_address && !/minh họa/i.test(u.headquarters_address)
      ? u.headquarters_address
      : "",
    decisionNumber: /minh họa/i.test(u.decision_number)
      ? ""
      : u.decision_number,
    decisionDate: u.decision_date,
    sourceUrl: "",
    sample: u.province !== "tphcm",
  }));
}

export const FALLBACK_DOCS = [
  {
    code: NATIONAL_BASIS.code,
    title: NATIONAL_BASIS.title,
    date: "2025-06-12",
    url: "",
    scope: "Cả nước",
  },
  {
    code: "1685/NQ-UBTVQH15",
    title: "Nghị quyết về việc sắp xếp đơn vị hành chính cấp xã của TP. Hồ Chí Minh năm 2025",
    date: "2025-06-16",
    url: "",
    scope: "TP. Hồ Chí Minh",
  },
];
