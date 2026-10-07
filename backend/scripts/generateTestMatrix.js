// scripts/generateTestMatrix.js
// Sinh bộ câu hỏi kiểm thử cho các tỉnh/thành, CÙNG cấu trúc với test_matrix_TPHCM.xlsx
// (161 câu, 9 nhóm: T1, T2, T3, T4, T5, T6, T7, T8_ambiguous, T8_out_of_scope).
// Mỗi câu bám dữ liệu thật trong DB (unit_mapping) nên đáp án đều kiểm chứng được.
//
// Cách dùng (đọc thẳng file Excel dữ liệu, KHÔNG cần DB):
//   node scripts/generateTestMatrix.js --excel-dir <thư mục> --list
//   node scripts/generateTestMatrix.js --excel-dir <thư mục> --all                    # TẤT CẢ: HCM (đã sửa lỗi) + 7 tỉnh (profile small)
//   node scripts/generateTestMatrix.js --excel-dir <thư mục> --province "dong nai"    # 1 tỉnh theo tên
//   node scripts/generateTestMatrix.js --excel-dir <thư mục> --province "ho chi minh" --profile full   # bộ 161 câu như TP.HCM
//   Thư mục chứa: *_data_collection.xlsx của 7 tỉnh (+ du_lieu_tphcm*.xlsx nếu có, luôn là id 1).
//   Nên để đủ cả HCM trong thư mục để đếm trùng tên/va chạm trên toàn bộ dữ liệu.
// Đọc từ PostgreSQL (bỏ --excel-dir): --list | --province-id N | --province "tên" | --all
// Tùy chọn chung: --seed 123 | --profile small|full | --out-dir <thư mục ghi kết quả> | --per-province N (mặc định 61 câu/tỉnh)
// TP.HCM trong --all: nếu có data/test_matrix_TPHCM.xlsx (bộ 161 câu đang dùng) thì GIỮ NGUYÊN câu hỏi và chỉ sửa
//   các dòng sai, ghi ra test_matrix_HCM.xlsx (file gốc không bị đụng). Chỉ định file khác: --hcm-base <file>.
//   Muốn bộ HCM sinh mới hoàn toàn (câu khác bộ cũ): --hcm-fresh. Bỏ HCM: --no-hcm.
// Kiểm tra chéo file test có sẵn với dữ liệu (không sửa file gốc):
//   node scripts/generateTestMatrix.js --excel-dir <thư mục> --audit data/test_matrix_TPHCM.xlsx --province-id 1
//   (thêm --fix để ghi thêm bản <tên>_fixed.xlsx)
//
// Kết quả: <out-dir mặc định ../data>/test_matrix_<MÃ>.xlsx (sheet "TestCases_<số câu>" + sheet "TestMatrix").
// Dùng seed cố định (mặc định 42) nên chạy lại cho đúng cùng bộ câu hỏi.
//
// Khác biệt có chủ ý so với bản cũ (đều theo file test_matrix_TPHCM.xlsx):
//  - T2 sinh theo "case": mỗi đơn vị cũ bị chia hỏi 3 cách (test_id dạng XXX-T2-01-1/-2/-3)
//  - T4, T6, T7 lấy từ chính các đơn vị bị chia ở T2 (T4 chỉ hỏi phần "một phần")
//  - T5 dùng lại đúng các đơn vị mới của T3 (hỏi ngược cùng một đơn vị)
//  - T6 đếm số đơn vị MỚI mà 1 đơn vị CŨ được chia ra (bản cũ đếm theo chiều ngược lại)
//  - T7 viết không dấu trên các đơn vị bị chia, câu hỏi và đáp án luôn cùng 1 đơn vị
//  - T8_out_of_scope có must_contain = "ngoài phạm vi", có câu "bẫy" nhắc tên đơn vị thật
//  - expected_answer có hậu tố (toàn bộ)/(một phần); difficulty viết hoa chữ đầu như file mẫu

try {
  require("dotenv").config();
} catch (e) {
  /* dotenv chỉ cần khi đọc DB */
}
const path = require("path");
const XLSX = require("xlsx");
let source = null; // nguồn dữ liệu, chọn trong main(): PostgreSQL hoặc thư mục Excel

// ======== SỐ CÂU MỖI NHÓM ========
// full  = đúng bộ TP.HCM (161 câu). small = tỉnh dữ liệu ít hơn (tối đa ~61 câu).
// T2_cases là số ĐƠN VỊ CŨ bị chia; số câu T2 = T2_cases x 3 cách hỏi.
// Thực tế bị chặn bởi dữ liệu có sẵn, thiếu sẽ được in ra ở cuối.
const PROFILES = {
  full: {
    T1: 15,
    T2_cases: 30,
    T3: 10,
    T4: 15,
    T5: 8,
    T6: 5,
    T7: 5,
    T8_amb: 5,
    T8_oos: 8,
  },
  small: {
    T1: 8,
    T2_cases: 6,
    T3: 8,
    T4: 5,
    T5: 6,
    T6: 3,
    T7: 3,
    T8_amb: 5,
    T8_oos: 5,
  },
};

// Mục tiêu số câu MỖI TỈNH (profile small) để 7 tỉnh có số câu sát nhau. Tỉnh nào ít đơn vị bị chia
// (thiếu câu ở T2/T4/T6/T7) sẽ được bù sang T3, T5, T8_ambiguous, T1 (các nhóm dữ liệu nào cũng có nhiều)
// theo kiểu xoay vòng cho tới khi đủ. Đổi bằng --per-province N; --per-province 0 để tắt cân bằng.
const PER_PROVINCE_TARGET = 61;
const GROW_ORDER = ["T3", "T5", "T8_amb", "T1"];
const GROUP_KEY = {
  T1_1_to_1: "T1",
  T2_1_to_N: "T2_cases",
  T3_N_to_1: "T3",
  T4_mot_phan: "T4",
  T5_new_to_old: "T5",
  T6_count: "T6",
  T7_typo_no_diacritic: "T7",
  T8_ambiguous: "T8_amb",
  T8_out_of_scope: "T8_oos",
};

// Từ khóa Model 1 phải nói ra khi hỏi lại vì tên trùng. Bộ TP.HCM dùng "quận".
// Nếu câu hỏi lại của hệ thống ghi "quận/huyện" thì giữ nguyên; nếu chỉ ghi "huyện" thì đổi tại đây.
const AMBIGUOUS_KEYWORD = "quận";
const OUT_OF_SCOPE_KEYWORD = "ngoài phạm vi";
const FALLBACK_DOC_TITLE = "Nghị quyết 202/2025/QH15"; // dùng khi DB không có văn bản gắn với tỉnh

const PURPOSES = {
  T1_1_to_1: "Lookup cũ → mới, quan hệ 1→1",
  T2_1_to_N: "Đơn vị cũ bị chia, mỗi case hỏi 3 cách",
  T3_N_to_1: "Nhiều cũ → 1 mới",
  T4_mot_phan: "Kiểm tra trạng thái một phần",
  T5_new_to_old: "Chiều mới → cũ",
  T6_count: "COUNT / aggregation",
  T7_typo_no_diacritic: "Thiếu dấu / robustness",
  T8_ambiguous: "Mơ hồ - cần hỏi lại quận/huyện",
  T8_out_of_scope: "Ngoài phạm vi dữ liệu",
};

// ======== TIỆN ÍCH ========
function getArg(name) {
  const i = process.argv.indexOf(name);
  return i !== -1 ? process.argv[i + 1] : null;
}
const hasFlag = (name) => process.argv.includes(name);

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

function stripDiacritics(s) {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

const lowerFirst = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);
const pad2 = (n) => String(n).padStart(2, "0");

// "TP. Hồ Chí Minh" -> "HCM", "Đồng Nai" -> "DN", "Cần Thơ" -> "CT"
function provinceCode(name) {
  const core = stripDiacritics(name).replace(/^(Tinh|Thanh pho|TP\.?)\s+/i, "");
  return core
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join("");
}

// Chuỗi must_contain cho danh sách đơn vị cũ. Nếu 1 tên là tiền tố của tên khác
// (VD "Phường 1" nằm trong "Phường 10") thì thêm "(quận)" để khỏi khớp nhầm.
function oldNamesForMatch(entries) {
  const names = entries.map((e) => e.name);
  const out = entries.map((e) =>
    names.some((o) => o !== e.name && o.startsWith(e.name))
      ? `${e.name} (${e.parent})`
      : e.name,
  );
  return [...new Set(out)];
}

const oldLabel = (e) => `${e.name} (${e.parent})`;
const mergeSuffix = (m) => (m === "mot_phan" ? "một phần" : "toàn bộ");
const withMerge = (r) => `${r.new_name} (${mergeSuffix(r.merge_type)})`;
const keyNP = (name, parent) => `${name}|${parent}`;
// File dữ liệu 7 tỉnh ghi quận/huyện cũ kèm mã, VD "Thành phố Long Xuyên (883)"; bộ test HCM thì không.
// Bỏ mã ở mọi nơi để câu hỏi tự nhiên và để phát hiện trùng tên đúng.
// Cũng chuẩn hóa cách viết hoa loại đơn vị ("Thị Xã" -> "Thị xã"): dữ liệu Vĩnh Long có
// "Phường Thành Phước" bị ghi 2 dòng với "Thị Xã Bình Minh" và "Thị xã Bình Minh", nếu DB coi là
// 2 đơn vị khác nhau thì đơn vị bị chia 2 sẽ thành 2 đơn vị mỗi cái chỉ có 1 nơi nhập vào.
const cleanParent = (s) =>
  (s || "")
    .replace(/\s*\(\d+\)\s*$/, "")
    .replace(/^Thị Xã(?=\s|$)/, "Thị xã")
    .replace(/^Thành Phố(?=\s|$)/, "Thành phố")
    .replace(/^Thị Trấn(?=\s|$)/, "Thị trấn")
    .trim();
const norm = (s) => stripDiacritics(String(s ?? "")).toLowerCase();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ======== NGUỒN DỮ LIỆU ========
// Mặc định đọc PostgreSQL (qua ../src/config/db). Thêm --excel-dir <thư mục> để đọc thẳng các file
// *_data_collection.xlsx của 7 tỉnh (và du_lieu_tphcm*.xlsx nếu có, gán id 1), không cần DB.
// Cả hai nguồn trả cùng một dạng dữ liệu nên logic sinh câu hỏi phía dưới giống hệt nhau.
function makeDbSource() {
  const pool = require("../src/config/db");
  return {
    name: "PostgreSQL",
    async listProvinces() {
      return (
        await pool.query("SELECT id, name FROM provinces_new ORDER BY id")
      ).rows;
    },
    async getProvince(id) {
      const { rows } = await pool.query(
        "SELECT id, name FROM provinces_new WHERE id = $1",
        [id],
      );
      return rows[0] || null;
    },
    async loadRows(provinceId) {
      return (
        await pool.query(
          `SELECT o.id AS old_id, o.name AS old_name, o.parent_name, o.province_old,
                  n.id AS new_id, n.name AS new_name, m.merge_type
           FROM unit_mapping m
           JOIN admin_units_old o ON o.id = m.old_unit_id
           JOIN admin_units_new n ON n.id = m.new_unit_id
           WHERE n.province_new_id = $1
           ORDER BY o.id, n.id`,
          [provinceId],
        )
      ).rows;
    },
    async loadAllOld() {
      return (
        await pool.query(
          "SELECT name, parent_name, province_old FROM admin_units_old",
        )
      ).rows;
    },
    async docTitle(provinceId) {
      const { rows } = await pool.query(
        `SELECT d.title
         FROM unit_mapping m
         JOIN admin_units_new n ON n.id = m.new_unit_id
         JOIN legal_documents d ON d.id = m.decision_document_id
         WHERE n.province_new_id = $1
         GROUP BY d.title
         ORDER BY COUNT(*) DESC
         LIMIT 1`,
        [provinceId],
      );
      return rows[0]?.title || null;
    },
    async close() {
      await pool.end();
    },
  };
}

function makeExcelSource(dir) {
  const fs = require("fs");
  const files = fs
    .readdirSync(dir)
    .filter((f) => /\.xlsx$/i.test(f) && !f.startsWith("~$"));
  const provFiles = [];
  const hcm = files.find((f) => /^du_lieu_tphcm.*\.xlsx$/i.test(f));
  if (hcm) provFiles.push(hcm);
  provFiles.push(
    ...files.filter((f) => /_data_collection\.xlsx$/i.test(f)).sort(),
  );
  if (provFiles.length === 0) {
    throw new Error(`Không thấy file *_data_collection.xlsx nào trong ${dir}`);
  }

  const provinces = []; // {id, name, title}
  const rows = []; // dòng ánh xạ đã chuẩn hóa, mỗi dòng có prov
  const oldIds = new Map();
  const newIds = new Map();
  provFiles.forEach((file, idx) => {
    const id = file === hcm ? 1 : idx + (hcm ? 1 : 2); // HCM luôn = 1; 7 tỉnh còn lại = 2, 3, ... theo thứ tự tên file
    const wb = XLSX.readFile(path.join(dir, file));
    const xp = XLSX.utils
      .sheet_to_json(wb.Sheets["XaPhuong"], { defval: "" })
      .filter((r) => r.old_unit_name);
    if (xp.length === 0) throw new Error(`${file}: sheet XaPhuong rỗng`);
    // tỉnh cũ của từng dòng nằm ở sheet Sheet1, tra theo (đơn vị cũ, quận/huyện cũ, đơn vị mới)
    const oldProv = new Map();
    if (wb.Sheets["Sheet1"]) {
      for (const r of XLSX.utils.sheet_to_json(wb.Sheets["Sheet1"], {
        defval: "",
      })) {
        oldProv.set(
          `${r["Phường/Xã cũ"]}|${r["Quận/Huyện cũ"]}|${r["Phường/Xã mới (từ 1/7/2025)"]}`,
          r["Tỉnh/TP cũ (trước sáp nhập)"],
        );
      }
    }
    const decisions = {};
    for (const r of xp) {
      const old_name = String(r.old_unit_name).trim();
      const new_name = String(r.new_unit_name).trim();
      const province_old =
        oldProv.get(`${r.old_unit_name}|${r.old_parent}|${r.new_unit_name}`) ||
        "Không rõ tỉnh cũ";
      const ok = `${old_name}|${r.old_parent}|${province_old}`;
      const nk = `${id}|${new_name}`;
      if (!oldIds.has(ok)) oldIds.set(ok, oldIds.size + 1);
      if (!newIds.has(nk)) newIds.set(nk, newIds.size + 1);
      decisions[r.decision_number] = (decisions[r.decision_number] || 0) + 1;
      rows.push({
        prov: id,
        old_id: oldIds.get(ok),
        old_name,
        parent_name: String(r.old_parent),
        province_old,
        new_id: newIds.get(nk),
        new_name,
        // chỉ "một phần" mới là mot_phan; "toàn bộ", "không sắp xếp"... đều quy về toan_bo
        merge_type:
          String(r.merge_type).trim() === "một phần" ? "mot_phan" : "toan_bo",
      });
    }
    const top = Object.entries(decisions).sort((a, b) => b[1] - a[1])[0]?.[0];
    provinces.push({
      id,
      name: String(xp[0].new_parent).trim(),
      title: top ? `Nghị quyết ${top}` : null,
    });
  });
  rows.sort((a, b) => a.old_id - b.old_id || a.new_id - b.new_id);

  return {
    name: `Excel (${provFiles.length} file trong ${dir})`,
    async listProvinces() {
      return provinces.map((p) => ({ id: p.id, name: p.name }));
    },
    async getProvince(id) {
      const p = provinces.find((x) => x.id === id);
      return p ? { id: p.id, name: p.name } : null;
    },
    async loadRows(provinceId) {
      return rows.filter((r) => r.prov === provinceId);
    },
    async loadAllOld() {
      const seen = new Set();
      const out = [];
      for (const r of rows) {
        if (seen.has(r.old_id)) continue;
        seen.add(r.old_id);
        out.push({
          name: r.old_name,
          parent_name: r.parent_name,
          province_old: r.province_old,
        });
      }
      return out;
    },
    async docTitle(provinceId) {
      return provinces.find((x) => x.id === provinceId)?.title || null;
    },
    async close() {},
  };
}

// ======== ĐỌC DỮ LIỆU ========
async function loadProvinceData(provinceId) {
  const rows = await source.loadRows(provinceId);

  // Gộp theo (tên + quận/huyện đã chuẩn hóa + tỉnh cũ) thay vì old_id, để cùng 1 đơn vị
  // bị tách làm nhiều old_id (do lệch cách ghi) vẫn được coi là 1 đơn vị
  const byOld = new Map();
  const byNew = new Map();
  for (const r of rows) {
    const parent = cleanParent(r.parent_name);
    const ok = `${r.old_name}|${parent}|${r.province_old}`;
    if (!byOld.has(ok)) {
      byOld.set(ok, {
        old_id: r.old_id,
        name: r.old_name,
        parent,
        province_old: r.province_old,
        rows: [],
      });
    }
    const unit = byOld.get(ok);
    if (!unit.rows.some((x) => x.new_id === r.new_id)) {
      unit.rows.push({
        new_id: r.new_id,
        new_name: r.new_name,
        merge_type: r.merge_type,
      });
    }

    if (!byNew.has(r.new_id)) {
      byNew.set(r.new_id, { new_id: r.new_id, name: r.new_name, olds: [] });
    }
    const nu = byNew.get(r.new_id);
    if (!nu.olds.some((o) => o.name === r.old_name && o.parent === parent)) {
      nu.olds.push({ name: r.old_name, parent, merge_type: r.merge_type });
    }
  }
  return { oldUnits: [...byOld.values()], newUnits: [...byNew.values()] };
}

// Chỉ mục TOÀN BỘ dữ liệu (mọi tỉnh đã nạp). Cần vì:
//  - "Phường 1" có thể trùng ở nhiều tỉnh, nên độ mơ hồ phải đếm trên toàn bộ
//  - cùng (tên + quận/huyện) có thể trùng giữa các tỉnh cũ khác nhau
//    (VD "Huyện Châu Thành" có ở nhiều tỉnh), khi đó câu hỏi kiểu "X, Huyện Châu Thành"
//    không có đáp án duy nhất và phải loại khỏi các nhóm T1/T2/T4/T6/T7
async function loadGlobalIndex() {
  const rows = await source.loadAllOld();
  const namePlaces = new Map(); // name -> Set("parent|province_old")
  const npProvinces = new Map(); // "name|parent" -> Set(province_old)
  for (const r of rows) {
    const parent = cleanParent(r.parent_name);
    if (!namePlaces.has(r.name)) namePlaces.set(r.name, new Set());
    namePlaces.get(r.name).add(`${parent}|${r.province_old}`);
    const k = keyNP(r.name, parent);
    if (!npProvinces.has(k)) npProvinces.set(k, new Set());
    npProvinces.get(k).add(r.province_old);
  }
  const collisions = new Set(
    [...npProvinces.entries()].filter(([, s]) => s.size >= 2).map(([k]) => k),
  );
  // (tên + quận/huyện) khác nhau nhưng giống hệt khi bỏ dấu (VD "Xã Lộc Thạnh" / "Xã Lộc Thành"):
  // câu hỏi không dấu của T7 sẽ không phân biệt được hai đơn vị này
  const byStripped = new Map();
  for (const k of npProvinces.keys()) {
    const sk = norm(k);
    if (!byStripped.has(sk)) byStripped.set(sk, new Set());
    byStripped.get(sk).add(k);
  }
  const strippedCollisions = new Set();
  for (const set of byStripped.values())
    if (set.size >= 2) set.forEach((k) => strippedCollisions.add(k));
  return { namePlaces, collisions, strippedCollisions };
}

async function loadDocTitle(provinceId) {
  return (await source.docTitle(provinceId)) || FALLBACK_DOC_TITLE;
}

// ======== ĐÁP ÁN CHUẨN TÍNH TỪ DỮ LIỆU (dùng chung cho sinh câu hỏi và kiểm tra) ========
const splitAnswer = (o) => o.rows.map(withMerge).join("; ");
function expectedFor(category, o) {
  const names = o.rows.map((r) => r.new_name);
  if (category === "T1_1_to_1") {
    return {
      expected_answer: withMerge(o.rows[0]),
      expected_count: 1,
      must_contain: names[0],
    };
  }
  if (category === "T4_mot_phan") {
    const p = o.rows
      .filter((r) => r.merge_type === "mot_phan")
      .map((r) => r.new_name);
    return {
      expected_answer: p.join("; "),
      expected_count: p.length,
      must_contain: p.join(" | "),
    };
  }
  if (category === "T6_count") {
    return {
      expected_answer: String(names.length),
      expected_count: names.length,
      must_contain: String(names.length),
    };
  }
  return {
    expected_answer: splitAnswer(o),
    expected_count: names.length,
    must_contain: names.join(" | "),
  }; // T2, T7
}
function expectedForNew(n) {
  return {
    expected_answer: n.olds.map(oldLabel).join("; "),
    expected_count: n.olds.length,
    must_contain: oldNamesForMatch(n.olds).join(" | "),
  };
}

// ======== SINH BỘ CÂU HỎI ========
function buildTestCases(code, provinceName, data, globalIdx, docTitle, P, rng) {
  const cases = [];
  const shortfalls = [];
  const capped = new Set(); // nhóm không đủ dữ liệu để đạt số câu yêu cầu
  const counters = {};

  function add(group, category, q) {
    counters[group] = (counters[group] || 0) + 1;
    const seq = counters[group];
    const base = `${code}-${group}`;
    const id =
      q.variant !== undefined
        ? `${base}-${pad2(q.source_case)}-${q.variant}`
        : `${base}-${pad2(seq)}`;
    cases.push({
      test_id: id,
      category,
      source_case: q.source_case ?? "",
      old_unit_name: q.old_unit_name || "",
      old_parent: q.old_parent || "",
      question: q.question,
      expected_answer: q.expected_answer,
      expected_count: q.expected_count ?? "",
      must_contain: q.must_contain || "",
      must_not_contain: q.must_not_contain || "",
      difficulty: q.difficulty,
      golden: "NO", // đổi thành YES cho các câu đã được người rà soát tay
      notes: q.notes || "",
    });
  }

  function checkShortfall(label, want, got) {
    if (got < want) {
      shortfalls.push(`${label}: cần ${want}, chỉ có ${got}`);
      capped.add(GROUP_KEY[label.split(" ")[0]]);
    }
  }

  // Đơn vị cũ có cặp (tên + quận/huyện) trùng giữa các tỉnh cũ thì không hỏi được
  // theo kiểu "X, Y" vì không có đáp án duy nhất
  const clear = (o) => !globalIdx.collisions.has(keyNP(o.name, o.parent));
  const hasPartial = (o) => o.rows.some((r) => r.merge_type === "mot_phan");

  // ---- T1: 1 đơn vị cũ -> đúng 1 đơn vị mới, sáp nhập toàn bộ ----
  // Ưu tiên đơn vị ĐỔI TÊN. Đơn vị giữ nguyên tên (VD "Phường Tân Định" -> "Phường Tân Định")
  // chỉ lấy khi thiếu, vì must_contain = tên mới sẽ khớp ngay với tên cũ lặp lại trong câu trả lời.
  const sameName = (o) =>
    o.name.trim().toLowerCase() === o.rows[0].new_name.trim().toLowerCase();
  const poolT1 = data.oldUnits.filter(
    (o) =>
      o.rows.length === 1 && o.rows[0].merge_type === "toan_bo" && clear(o),
  );
  const t1 = shuffle(
    poolT1.filter((o) => !sameName(o)),
    rng,
  ).slice(0, P.T1);
  if (t1.length < P.T1) {
    t1.push(
      ...shuffle(poolT1.filter(sameName), rng).slice(0, P.T1 - t1.length),
    );
  }
  t1.forEach((o, i) =>
    add("T1", "T1_1_to_1", {
      source_case: i + 1,
      question: `${o.name}, ${o.parent} nay thuộc đơn vị hành chính nào?`,
      ...expectedFor("T1_1_to_1", o),
      old_unit_name: o.name,
      old_parent: o.parent,
      difficulty: "Easy",
      notes: sameName(o) ? "Đơn vị giữ nguyên tên (tên mới trùng tên cũ)." : "",
    }),
  );
  checkShortfall("T1_1_to_1", P.T1, t1.length);

  // ---- T2: 1 đơn vị cũ bị chia thành nhiều đơn vị mới, mỗi case hỏi 3 cách ----
  // Ưu tiên đơn vị chia nhiều phần nhất (3+ phần), sau đó 2 phần; cùng nhóm thì xáo theo seed.
  const splitPool = data.oldUnits.filter((o) => o.rows.length >= 2 && clear(o));
  const t2Units = shuffle(splitPool, rng)
    .sort((a, b) => b.rows.length - a.rows.length)
    .slice(0, P.T2_cases);
  const t2Templates = [
    (o) =>
      `${o.name}, ${o.parent} trước đây nay được sắp xếp thành những đơn vị hành chính nào?`,
    (o) =>
      `Địa bàn ${o.name}, ${o.parent} hiện nay thuộc những đơn vị hành chính nào?`,
    (o) =>
      `${o.name}, ${o.parent} được chia thành bao nhiêu đơn vị hành chính mới?`,
  ];
  t2Units.forEach((o, i) => {
    t2Templates.forEach((tpl, v) =>
      add("T2", "T2_1_to_N", {
        source_case: i + 1,
        variant: v + 1,
        question: tpl(o),
        ...expectedFor("T2_1_to_N", o),
        old_unit_name: o.name,
        old_parent: o.parent,
        difficulty: o.rows.length >= 3 ? "Hard" : "Medium-Hard",
        notes:
          "Phải trả đủ toàn bộ đơn vị mới; không được lấy 1 kết quả đầu tiên.",
      }),
    );
  });
  checkShortfall(
    "T2_1_to_N (số đơn vị cũ bị chia)",
    P.T2_cases,
    t2Units.length,
  );

  // ---- T3: nhiều đơn vị cũ -> 1 đơn vị mới (liệt kê đầy đủ) ----
  const poolMulti = data.newUnits.filter((n) => n.olds.length >= 2);
  // Phân tầng như bộ HCM (6/10 câu là Hard = 4+ đơn vị cũ): lấy ~60% từ nhóm nhiều đơn vị cũ nhất
  const hardMulti = shuffle(
    poolMulti.filter((n) => n.olds.length >= 4),
    rng,
  );
  const easyMulti = shuffle(
    poolMulti.filter((n) => n.olds.length < 4),
    rng,
  );
  const nHard = Math.min(hardMulti.length, Math.round(P.T3 * 0.6));
  const t3 = shuffle(
    [...hardMulti.slice(0, nHard), ...easyMulti.slice(0, P.T3 - nHard)],
    rng,
  );
  if (t3.length < P.T3) {
    t3.push(...hardMulti.slice(nHard).slice(0, P.T3 - t3.length));
  }
  t3.forEach((n, i) =>
    add("T3", "T3_N_to_1", {
      source_case: i + 1,
      question: `${n.name}, ${provinceName} được hình thành từ những đơn vị cũ nào?`,
      ...expectedForNew(n),
      difficulty: n.olds.length >= 4 ? "Hard" : "Medium",
      notes: "Chiều ngược: một đơn vị mới nhận địa bàn từ nhiều đơn vị cũ.",
    }),
  );
  checkShortfall("T3_N_to_1", P.T3, t3.length);

  // ---- T4: những đơn vị mới chỉ nhận MỘT PHẦN địa bàn của 1 đơn vị cũ ----
  // Lấy từ chính các đơn vị bị chia ở T2 (như bộ TP.HCM), thiếu thì bổ sung đơn vị khác có "một phần".
  const t2Set = new Set(t2Units.map((o) => o.old_id));
  const extraPartial = shuffle(
    data.oldUnits.filter(
      (o) => hasPartial(o) && clear(o) && !t2Set.has(o.old_id),
    ),
    rng,
  );
  const t4 = [...t2Units.filter(hasPartial), ...extraPartial].slice(0, P.T4);
  t4.forEach((o, i) => {
    add("T4", "T4_mot_phan", {
      source_case: i + 1,
      question: `Trong kết quả sắp xếp ${o.name}, ${o.parent}, những đơn vị mới nào chỉ nhận một phần địa bàn?`,
      ...expectedFor("T4_mot_phan", o),
      old_unit_name: o.name,
      old_parent: o.parent,
      difficulty: "Hard",
      notes: "Phải phân biệt mapping 'một phần' với 'toàn bộ'.",
    });
  });
  checkShortfall("T4_mot_phan", P.T4, t4.length);

  // ---- T5: hỏi ngược "trước sắp xếp gồm những đơn vị nào" (dùng lại các đơn vị mới của T3) ----
  // Câu có cụm "trước sắp xếp" + "gồm" để khớp isAggregationIntent của Model 1.
  const t5 = t3.slice(0, P.T5);
  t5.forEach((n, i) =>
    add("T5", "T5_new_to_old", {
      source_case: i + 1,
      question: `Trước sắp xếp, địa bàn của ${n.name}, ${provinceName} gồm những đơn vị nào?`,
      ...expectedForNew(n),
      difficulty: "Hard",
    }),
  );
  checkShortfall("T5_new_to_old", P.T5, t5.length);

  // ---- T6: đếm số đơn vị MỚI mà 1 đơn vị cũ được chia ra (lấy từ các đơn vị bị chia ở T2) ----
  // must_contain là 1 chữ số nên loại các đơn vị có chính chữ số đó trong tên/quận
  // (VD "Phường 2, Quận 4" với đáp án 2 sẽ khớp dù hệ thống trả sai).
  const t6ok = t2Units.filter(
    (o) => !`${o.name} ${o.parent}`.includes(String(o.rows.length)),
  );
  const big = t6ok.filter((o) => o.rows.length >= 3);
  const small = t6ok.filter((o) => o.rows.length < 3);
  const nBig = Math.min(big.length, Math.ceil(P.T6 * 0.6));
  let t6 = [...big.slice(0, nBig), ...small.slice(0, P.T6 - nBig)];
  if (t6.length < P.T6) {
    t6 = t6.concat(
      t6ok.filter((o) => !t6.includes(o)).slice(0, P.T6 - t6.length),
    );
  }
  t6.forEach((o, i) =>
    add("T6", "T6_count", {
      source_case: i + 1,
      question: `${o.name}, ${o.parent} được sắp xếp thành bao nhiêu đơn vị hành chính mới?`,
      ...expectedFor("T6_count", o),
      old_unit_name: o.name,
      old_parent: o.parent,
      difficulty: "Medium",
      notes: "Kiểm tra COUNT logic.",
    }),
  );
  checkShortfall("T6_count", P.T6, t6.length);

  // ---- T7: viết không dấu trên các đơn vị bị chia (câu hỏi và đáp án luôn cùng 1 đơn vị) ----
  const t7Templates = [
    (n, p) => `${n}, ${p} nay thuộc những đơn vị nào?`,
    (n, p) => `${n} ${p} trước đây nay được sắp xếp ra sao?`,
    (n, p) => `${n} ${p} hiện giờ thuộc những đơn vị nào?`,
    (n, p) => `${n} ${p} nay được chia vào đâu?`,
    (n, p) => `${n} ${p} nay gồm những đơn vị nào?`,
  ];
  const t7 = shuffle(
    t2Units.filter(
      (o) => !globalIdx.strippedCollisions.has(keyNP(o.name, o.parent)),
    ),
    rng,
  ).slice(0, P.T7);
  t7.forEach((o, i) =>
    add("T7", "T7_typo_no_diacritic", {
      source_case: i + 1,
      question: stripDiacritics(
        t7Templates[i % t7Templates.length](o.name, lowerFirst(o.parent)),
      ),
      ...expectedFor("T7_typo_no_diacritic", o),
      old_unit_name: o.name,
      old_parent: o.parent,
      difficulty: "Hard",
      notes: "Robustness: thiếu dấu/viết không dấu.",
    }),
  );
  checkShortfall("T7_typo_no_diacritic", P.T7, t7.length);

  // ---- T8_ambiguous: tên đơn vị cũ trùng nhiều nơi (đếm trên TOÀN DB), ưu tiên tên trùng nhiều nhất ----
  const namesHere = [...new Set(data.oldUnits.map((o) => o.name))];
  // Ưu tiên tên trùng NGAY TRONG tỉnh này: hệ thống lọc theo tab tỉnh trước khi xét mơ hồ
  // (qa.controller.js), nên tên chỉ trùng với tỉnh khác có thể được trả lời luôn thay vì hỏi lại.
  // Thiếu thì mới bù bằng tên trùng ở tỉnh khác (đếm trên toàn bộ dữ liệu).
  const placesInProvince = new Map(); // name -> Set("parent|province_old") trong tỉnh này
  for (const o of data.oldUnits) {
    if (!placesInProvince.has(o.name)) placesInProvince.set(o.name, new Set());
    placesInProvince.get(o.name).add(`${o.parent}|${o.province_old}`);
  }
  const ambAll = shuffle(
    namesHere.map((name) => ({
      name,
      n: globalIdx.namePlaces.get(name)?.size || 1,
      local: placesInProvince.get(name)?.size || 1,
    })),
    rng,
  ).filter((x) => x.n >= 2);
  const ambCandidates = [
    ...ambAll
      .filter((x) => x.local >= 2)
      .sort((a, b) => b.local - a.local || b.n - a.n),
    ...ambAll.filter((x) => x.local < 2).sort((a, b) => b.n - a.n),
  ].slice(0, P.T8_amb);
  const ambTemplates = [
    (n, w) => `${n} cũ nay thuộc ${w} nào?`,
    (n, w) => `${n} cũ bây giờ là ${w} nào?`,
    (n, w) => `${n} hiện nay thuộc đơn vị nào?`,
    (n) => `${n} sau sáp nhập gọi là gì?`,
    (n, w) => `${n} giờ thuộc ${w} nào?`,
  ];
  ambCandidates.forEach(({ name, n }, i) => {
    const w = name.startsWith("Phường") ? "phường" : "đơn vị";
    add("T8", "T8_ambiguous", {
      question: ambTemplates[i % ambTemplates.length](name, w),
      expected_answer: `Yêu cầu người dùng bổ sung quận/huyện cũ vì tên '${name}' không đủ để xác định duy nhất (trùng ở ${n} quận/huyện).`,
      old_unit_name: name,
      must_contain: AMBIGUOUS_KEYWORD,
      difficulty: "Hard",
      notes: `Không được tự đoán một '${name}'.`,
    });
  });
  checkShortfall("T8_ambiguous", P.T8_amb, ambCandidates.length);

  // ---- T8_out_of_scope: ngoài phạm vi dữ liệu. Thứ tự ưu tiên đặt các câu "bẫy" lên đầu ----
  const clearOlds = shuffle(data.oldUnits.filter(clear), rng);
  const sampleOld = clearOlds[0];
  const sampleParent = clearOlds[1]?.parent || sampleOld?.parent;
  const sampleNew = shuffle(data.newUnits, rng)[0];
  const oos = [
    {
      q: `Thời tiết ${provinceName} hôm nay thế nào?`,
      d: "Easy",
      n: "Hoàn toàn không liên quan chủ đề.",
    },
    {
      q: `Ai là người ký ${docTitle}?`,
      d: "Medium",
      n: "Câu hỏi về siêu dữ liệu văn bản, không phải nội dung sáp nhập.",
    },
    {
      q: "Tỉnh Hà Giang và Tuyên Quang được sáp nhập thành tỉnh nào?",
      d: "Medium",
      n: "Tỉnh miền Bắc, hoàn toàn ngoài phạm vi dữ liệu.",
    },
    sampleParent && {
      q: `Việc sáp nhập ảnh hưởng thế nào đến giá bất động sản tại ${sampleParent} cũ?`,
      d: "Medium",
      n: "Có nhắc tên đơn vị hợp lệ nhưng ý hỏi ngoài phạm vi (giá BĐS) — kiểm tra hệ thống không bị đánh lừa bởi tên đơn vị xuất hiện trong câu.",
    },
    sampleNew && {
      q: `${sampleNew.name} có trường đại học nào nổi tiếng?`,
      d: "Hard",
      n: "Case khó — nhắc tên đơn vị hành chính có thật nhưng câu hỏi về giáo dục, không phải sáp nhập. Rule-based dễ match nhầm vì chỉ dò tên.",
    },
    {
      q: `GDP của ${provinceName} sau sáp nhập là bao nhiêu?`,
      d: "Medium",
      n: "Câu hỏi kinh tế, không thuộc phạm vi dữ liệu.",
    },
    sampleOld && {
      q: `Giá đất của ${sampleOld.name}, ${sampleOld.parent} hiện nay là bao nhiêu?`,
      d: "Medium",
      n: "Kiểm tra out-of-scope.",
    },
    {
      q: `Dân số ${provinceName} sẽ tăng bao nhiêu phần trăm trong 5 năm tới?`,
      d: "Medium",
      n: "Câu hỏi dự báo, không có trong dữ liệu nghị quyết.",
    },
  ]
    .filter(Boolean)
    .slice(0, P.T8_oos);
  oos.forEach((x) => {
    add("T8", "T8_out_of_scope", {
      question: x.q,
      expected_answer:
        "Từ chối/giải thích ngoài phạm vi dữ liệu địa giới hành chính của bộ test.",
      must_contain: OUT_OF_SCOPE_KEYWORD,
      difficulty: x.d,
      notes: x.n,
    });
  });
  checkShortfall("T8_out_of_scope", P.T8_oos, oos.length);

  return { cases, shortfalls, capped };
}

// ======== KIỂM TRA CHÉO TỪNG CÂU VỚI DỮ LIỆU ========
// Dùng cho (1) bộ câu vừa sinh, chặn lỗi trước khi ghi file; (2) file test có sẵn (--audit).
// Nguyên tắc: câu hỏi là "nguồn sự thật" (đơn vị nào được hỏi), đáp án phải khớp dữ liệu của đúng đơn vị đó.
// Bắt các lỗi từng gặp ở bộ HCM: đáp án của đơn vị khác, old_unit_name/old_parent lệch câu hỏi,
// số lần trùng tên ghi sai.
const splitBar = (s) =>
  String(s ?? "")
    .split("|")
    .map((x) => x.trim())
    .filter(Boolean);
const stripParen = (s) => s.replace(/\s*\([^)]*\)\s*$/, "");
const sameSet = (a, b) => {
  const x = new Set(a),
    y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
};
// tên có đứng riêng trong câu không ("phuong 1" không được khớp trong "phuong 16")
// strict = so khớp đúng dấu (phân biệt "Lộc Thạnh" với "Lộc Thành"); loose = bỏ dấu, chỉ dùng cho T7
const mentions = (question, text, loose = false) => {
  const f = loose ? norm : (x) => String(x).toLowerCase();
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRe(f(text))}(?![\\p{L}\\p{N}])`,
    "u",
  ).test(f(question));
};

function auditCases(cases, data, provinceName, globalIdx) {
  const issues = [];
  const longest = (arr, f) => arr.sort((a, b) => f(b).length - f(a).length)[0];

  for (const c of cases) {
    const report = (level, msg, fix) =>
      issues.push({ test_id: c.test_id, level, msg, fix: fix || null });
    const cat = c.category;

    if (
      [
        "T1_1_to_1",
        "T2_1_to_N",
        "T4_mot_phan",
        "T6_count",
        "T7_typo_no_diacritic",
      ].includes(cat)
    ) {
      const pick = (loose) =>
        data.oldUnits.filter(
          (o) =>
            mentions(c.question, o.name, loose) &&
            mentions(c.question, o.parent, loose),
        );
      let found = pick(false);
      if (found.length === 0) found = pick(true);
      // nhiều đơn vị chỉ khác dấu: ưu tiên đơn vị mà old_unit_name của dòng đang chỉ tới
      const named = found.filter(
        (o) => o.name === c.old_unit_name && o.parent === c.old_parent,
      );
      if (found.length > 1 && named.length === 1) found = named;
      if (found.length === 0) {
        report(
          "ERROR",
          "Không nhận ra đơn vị cũ nào (tên + quận/huyện) trong câu hỏi",
        );
        continue;
      }
      const u = longest(found, (o) => o.name + o.parent);
      const want = expectedFor(
        cat === "T7_typo_no_diacritic" ? "T7_typo_no_diacritic" : cat,
        u,
      );
      const fix = { old_unit_name: u.name, old_parent: u.parent, ...want };

      if (c.old_unit_name !== u.name || c.old_parent !== u.parent) {
        report(
          "ERROR",
          `old_unit_name/old_parent (${c.old_unit_name}, ${c.old_parent}) lệch với đơn vị trong câu hỏi (${u.name}, ${u.parent})`,
          fix,
        );
      }
      if (cat === "T6_count") {
        if (
          Number(c.expected_count) !== want.expected_count ||
          String(c.must_contain) !== want.must_contain
        ) {
          report(
            "ERROR",
            `Số đếm sai: file ghi ${c.expected_count}, dữ liệu có ${want.expected_count}`,
            fix,
          );
        }
      } else if (
        !sameSet(splitBar(c.must_contain), splitBar(want.must_contain)) ||
        Number(c.expected_count) !== want.expected_count
      ) {
        report(
          "ERROR",
          `must_contain không khớp dữ liệu của ${u.name}, ${u.parent}: file ghi [${c.must_contain}], dữ liệu là [${want.must_contain}]`,
          fix,
        );
      }
      if (cat === "T1_1_to_1" && u.rows.length !== 1)
        report("ERROR", "T1 nhưng đơn vị bị chia nhiều phần");
      if (globalIdx.collisions.has(keyNP(u.name, u.parent))) {
        report(
          "WARN",
          "Cặp (tên + quận/huyện) trùng giữa các tỉnh cũ, câu hỏi có thể có nhiều đáp án",
        );
      }
    } else if (cat === "T3_N_to_1" || cat === "T5_new_to_old") {
      const found = data.newUnits.filter((n) =>
        new RegExp(
          `(^|[^\\p{L}\\p{N}])${escapeRe(n.name.toLowerCase())},\\s*${escapeRe(provinceName.toLowerCase())}`,
          "u",
        ).test(c.question.toLowerCase()),
      );
      if (found.length === 0) {
        report("ERROR", "Không nhận ra đơn vị mới trong câu hỏi");
        continue;
      }
      const n = longest(found, (x) => x.name);
      const want = expectedForNew(n);
      const got = splitBar(c.must_contain).map(stripParen);
      if (
        !sameSet(got, splitBar(want.must_contain).map(stripParen)) ||
        Number(c.expected_count) !== want.expected_count
      ) {
        report(
          "ERROR",
          `Danh sách đơn vị cũ của ${n.name} không khớp dữ liệu: file ghi [${c.must_contain}], dữ liệu là [${want.must_contain}]`,
          want,
        );
      }
    } else if (cat === "T8_ambiguous") {
      const total = globalIdx.namePlaces.get(c.old_unit_name)?.size || 0;
      if (total < 2) {
        report(
          "ERROR",
          `Tên '${c.old_unit_name}' chỉ có ${total} nơi, không mơ hồ`,
        );
        continue;
      }
      const m = String(c.expected_answer).match(/trùng ở (\d+)/);
      if (m && Number(m[1]) !== total) {
        // Chỉ cảnh báo, không tự sửa: số này đếm trên toàn DB (mọi tỉnh đã nạp) còn câu chữ cũ có thể
        // ghi "trong phạm vi TP.HCM"; expected_answer của nhóm này không dùng để chấm (chỉ must_contain)
        report(
          "WARN",
          `expected_answer ghi trùng ở ${m[1]} nơi, đếm trên toàn DB hiện có ${total} nơi (chỉ ảnh hưởng câu chữ, không ảnh hưởng điểm)`,
        );
      }
    } else if (cat === "T8_out_of_scope") {
      if (c.must_contain !== OUT_OF_SCOPE_KEYWORD) {
        report("WARN", `must_contain nên là '${OUT_OF_SCOPE_KEYWORD}'`, {
          must_contain: OUT_OF_SCOPE_KEYWORD,
        });
      }
    }
  }
  return issues;
}

function printIssues(issues) {
  issues.forEach((i) => console.log(`  [${i.level}] ${i.test_id}: ${i.msg}`));
}

// Chế độ --audit <file.xlsx> --province-id N [--fix]: kiểm tra file test có sẵn,
// --fix ghi thêm bản <tên>_fixed.xlsx đã sửa đúng các dòng lỗi (không đụng file gốc)
async function auditFile(file, provinceId, doFix, globalIdx, outPathOverride) {
  const prov = await source.getProvince(provinceId);
  if (!prov) return console.error(`Không có province_id=${provinceId}`);
  const pr = [prov];
  const data = await loadProvinceData(provinceId);
  const wb = XLSX.readFile(file);
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: "" });
  const issues = auditCases(rows, data, pr[0].name, globalIdx);
  console.log(
    `\n=== Audit ${path.basename(file)}: ${rows.length} câu, ${issues.filter((i) => i.level === "ERROR").length} lỗi, ${issues.filter((i) => i.level === "WARN").length} cảnh báo ===`,
  );
  printIssues(issues);
  if (!doFix)
    return {
      issues,
      remainingErrors: issues.filter((i) => i.level === "ERROR").length,
    };

  const byId = new Map(rows.map((r) => [r.test_id, r]));
  issues
    .filter((i) => i.fix)
    .forEach((i) => Object.assign(byId.get(i.test_id), i.fix));
  const outWb = XLSX.utils.book_new();
  const newSheet = `TestCases_${rows.length}`;
  const ws = XLSX.utils.json_to_sheet(rows, { header: Object.keys(rows[0]) });
  ws["!cols"] = wb.Sheets[sheetName]["!cols"];
  XLSX.utils.book_append_sheet(outWb, ws, newSheet);
  wb.SheetNames.slice(1).forEach((n) =>
    XLSX.utils.book_append_sheet(outWb, wb.Sheets[n], n),
  );
  const outPath = outPathOverride || file.replace(/\.xlsx$/i, "_fixed.xlsx");
  XLSX.writeFile(outWb, outPath);
  // kiểm tra lại chính bản vừa sửa: phải hết lỗi
  const remainingErrors = auditCases(rows, data, pr[0].name, globalIdx).filter(
    (i) => i.level === "ERROR",
  ).length;
  console.log(
    `  Đã ghi bản sửa -> ${outPath} (${new Set(issues.filter((i) => i.fix).map((i) => i.test_id)).size} dòng được sửa, còn ${remainingErrors} lỗi)`,
  );
  return { issues, remainingErrors };
}

// TP.HCM: giữ NGUYÊN 161 câu của bộ test hiện tại (để so sánh được với kết quả đã chạy), chỉ sửa các
// dòng đáp án/metadata sai và giữ nguyên cột golden, notes. Ghi ra test_matrix_HCM.xlsx.
// Không có file gốc (hoặc --hcm-fresh) thì sinh bộ MỚI theo profile full: câu hỏi sẽ khác bộ cũ.
async function runHcm(seed, globalIdx) {
  const fs = require("fs");
  const outDir = getArg("--out-dir") || path.join(__dirname, "../data");
  const excelDir = getArg("--excel-dir");
  const candidates = [
    getArg("--hcm-base"),
    path.join(outDir, "test_matrix_TPHCM.xlsx"),
    path.join(__dirname, "../data/test_matrix_TPHCM.xlsx"),
    excelDir && path.join(excelDir, "test_matrix_TPHCM.xlsx"),
  ].filter(Boolean);
  const base = hasFlag("--hcm-fresh")
    ? null
    : candidates.find((f) => fs.existsSync(f));
  if (!base) {
    console.warn(
      "\n[HCM] Không thấy test_matrix_TPHCM.xlsx (đặt vào data\\ hoặc dùng --hcm-base <file>). Sinh bộ HCM MỚI theo profile full, " +
        "câu hỏi sẽ KHÁC bộ 161 câu đã chạy, không so sánh trực tiếp với kết quả cũ được.",
    );
    return runOne(1, seed, "full", globalIdx);
  }
  fs.mkdirSync(outDir, { recursive: true });
  console.log(
    `\n[HCM] Dựa trên bộ có sẵn ${base}, giữ nguyên câu hỏi, sửa các dòng lỗi.`,
  );
  const { remainingErrors } = await auditFile(
    base,
    1,
    true,
    globalIdx,
    path.join(outDir, "test_matrix_HCM.xlsx"),
  );
  if (remainingErrors > 0)
    throw new Error("Bản HCM sau khi sửa vẫn còn lỗi, xem log phía trên.");
}

// ======== GHI FILE ========
function writeXlsx(code, cases) {
  const outDir = getArg("--out-dir") || path.join(__dirname, "../data");
  require("fs").mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `test_matrix_${code}.xlsx`);
  const ws = XLSX.utils.json_to_sheet(cases);
  ws["!cols"] = [
    { wch: 16 }, // test_id
    { wch: 22 }, // category
    { wch: 11 }, // source_case
    { wch: 24 }, // old_unit_name
    { wch: 22 }, // old_parent
    { wch: 70 }, // question
    { wch: 70 }, // expected_answer
    { wch: 14 }, // expected_count
    { wch: 50 }, // must_contain
    { wch: 18 }, // must_not_contain
    { wch: 14 }, // difficulty
    { wch: 8 }, // golden
    { wch: 50 }, // notes
  ];

  const byCat = {};
  cases.forEach((c) => (byCat[c.category] = (byCat[c.category] || 0) + 1));
  const matrixRows = Object.keys(PURPOSES)
    .filter((c) => byCat[c])
    .map((category) => ({
      category,
      test_count: byCat[category],
      purpose: PURPOSES[category],
    }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `TestCases_${cases.length}`);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(matrixRows),
    "TestMatrix",
  );
  XLSX.writeFile(wb, outPath);
  return outPath;
}

async function runOne(provinceId, seed, profileName, globalIdx) {
  const prov = await source.getProvince(provinceId);
  if (!prov) {
    console.error(`Không có province_id=${provinceId} (xem --list).`);
    return;
  }
  const provinceName = prov.name;
  const code = provinceCode(provinceName);
  const data = await loadProvinceData(provinceId);

  console.log(
    `\n=== ${provinceName} (id=${provinceId}, mã ${code}) | ${data.oldUnits.length} đơn vị cũ, ${data.newUnits.length} đơn vị mới | profile ${profileName} ===`,
  );
  if (data.oldUnits.length === 0) {
    console.warn(
      "  Chưa có dữ liệu unit_mapping cho tỉnh này — bỏ qua. Đã chạy import_excel_to_db.js chưa?",
    );
    return;
  }

  const docTitle = await loadDocTitle(provinceId);
  const build = (P) =>
    buildTestCases(
      code,
      provinceName,
      data,
      globalIdx,
      docTitle,
      P,
      mulberry32(seed + provinceId),
    );
  const P = { ...PROFILES[profileName] };
  let res = build(P);
  const baseTotal = res.cases.length;
  const target =
    profileName === "small"
      ? Number(getArg("--per-province") ?? PER_PROVINCE_TARGET)
      : 0;
  if (target > 0) {
    // bù câu còn thiếu sang các nhóm còn dữ liệu, xoay vòng T3 -> T5 -> T8_ambiguous -> T1
    let i = 0;
    for (let guard = 0; res.cases.length < target && guard < 500; guard++) {
      let g,
        tried = 0;
      do {
        g = GROW_ORDER[i++ % GROW_ORDER.length];
        tried++;
      } while (res.capped.has(g) && tried <= GROW_ORDER.length);
      if (res.capped.has(g)) break; // mọi nhóm đã hết dữ liệu
      P[g]++;
      res = build(P);
    }
  }
  const { cases, shortfalls } = res;
  const issues = auditCases(cases, data, provinceName, globalIdx);
  if (issues.some((i) => i.level === "ERROR")) {
    printIssues(issues);
    throw new Error(
      `Bộ câu hỏi của ${provinceName} không qua kiểm tra chéo, không ghi file.`,
    );
  }
  const outPath = writeXlsx(code, cases);

  const nCollide = data.oldUnits.filter((o) =>
    globalIdx.collisions.has(keyNP(o.name, o.parent)),
  ).length;
  const byGroup = {};
  cases.forEach(
    (c) =>
      (byGroup[GROUP_KEY[c.category]] =
        (byGroup[GROUP_KEY[c.category]] || 0) + 1),
  );
  console.log(`  Đã sinh ${cases.length} câu -> ${outPath}`);
  console.log(
    `  Theo nhóm: ${Object.entries(byGroup)
      .map(([k, v]) => `${k.replace("_cases", "")}=${v}`)
      .join(" ")}`,
  );
  if (target > 0 && cases.length > baseTotal)
    console.log(
      `  Đã bù ${cases.length - baseTotal} câu sang T3/T5/T8_ambiguous/T1 để sát mục tiêu ${target} câu/tỉnh.`,
    );
  if (target > 0 && cases.length < target)
    console.log(
      `  CHƯA đủ mục tiêu ${target} câu: các nhóm bù đều hết dữ liệu.`,
    );
  if (nCollide) {
    console.log(
      `  Có ${nCollide} đơn vị cũ trùng (tên + quận/huyện) với tỉnh cũ khác, đã loại khỏi T1/T2/T4/T6/T7.`,
    );
  }
  if (shortfalls.length) {
    console.log("  Nhóm thiếu so với mục tiêu (do dữ liệu tỉnh này không đủ):");
    shortfalls.forEach((s) => console.log(`    - ${s}`));
  }
}

async function main() {
  try {
    const excelDir = getArg("--excel-dir");
    source = excelDir ? makeExcelSource(excelDir) : makeDbSource();
    console.log(`Nguồn dữ liệu: ${source.name}`);
    if (hasFlag("--list")) {
      const rows = await source.listProvinces();
      rows.forEach((r) =>
        console.log(`${r.id}\t${r.name}\t(mã ${provinceCode(r.name)})`),
      );
      return;
    }

    const seed = Number(getArg("--seed") || 42);
    const profileName = getArg("--profile") || "small";
    if (!PROFILES[profileName]) {
      console.error(`--profile phải là: ${Object.keys(PROFILES).join(" | ")}`);
      process.exitCode = 1;
      return;
    }

    if (getArg("--audit")) {
      const globalIdx0 = await loadGlobalIndex();
      await auditFile(
        getArg("--audit"),
        Number(getArg("--province-id") || 1),
        hasFlag("--fix"),
        globalIdx0,
      );
      return;
    }

    let ids = [];
    if (hasFlag("--all")) {
      // Tất cả tỉnh, gồm cả TP.HCM (id=1, xử lý riêng ở runHcm); thêm --no-hcm để bỏ HCM
      ids = (await source.listProvinces())
        .map((r) => r.id)
        .filter((id) => !(hasFlag("--no-hcm") && id === 1));
    } else if (getArg("--province-id")) ids = [Number(getArg("--province-id"))];
    else if (getArg("--province")) {
      // chọn theo tên, VD --province "dong nai" (không phân biệt dấu/hoa thường)
      const want = norm(getArg("--province"));
      const hit = (await source.listProvinces()).filter((r) =>
        norm(r.name).includes(want),
      );
      if (hit.length !== 1) {
        console.error(
          `--province "${getArg("--province")}" khớp ${hit.length} tỉnh (xem --list).`,
        );
        process.exitCode = 1;
        return;
      }
      ids = [hit[0].id];
    } else {
      console.error(
        "Cách dùng: node scripts/generateTestMatrix.js --list | --province-id N | --province <tên> | --all [--seed 42] [--profile small|full] [--no-hcm] [--hcm-base file] [--hcm-fresh] | --audit file.xlsx --province-id N [--fix] (thêm --excel-dir <thư mục> để đọc Excel thay cho DB, --out-dir để chọn nơi ghi)",
      );
      process.exitCode = 1;
      return;
    }

    const globalIdx = await loadGlobalIndex();
    for (const id of ids) {
      if (id === 1) await runHcm(seed, globalIdx);
      else await runOne(id, seed, profileName, globalIdx);
    }
  } finally {
    if (source) await source.close();
  }
}

main().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});
