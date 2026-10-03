// scripts/generateTestMatrix.js
// Sinh bộ câu hỏi kiểm thử cho các tỉnh/thành, CÙNG cấu trúc với test_matrix_TPHCM.xlsx
// (nhóm T1-T8, cột test_id/category/question/expected_answer/must_contain/...),
// bám sát dữ liệu thật đang nạp trong DB (unit_mapping) nên mỗi câu đều có đáp án
// kiểm chứng được.
//
// Cách dùng:
//   node scripts/generateTestMatrix.js --list                  # xem id từng tỉnh trong DB
//   node scripts/generateTestMatrix.js --province-id 7         # sinh cho 1 tỉnh
//   node scripts/generateTestMatrix.js --all                   # sinh cho 7 tỉnh (trừ TP.HCM, id=1)
//   node scripts/generateTestMatrix.js --province-id 7 --seed 123
//
// Kết quả: data/test_matrix_<MÃ>.xlsx (sheet "TestCases_<số câu>" + sheet "Summary").
// Dùng seed cố định (mặc định 42) nên chạy lại cho đúng cùng bộ câu hỏi.

require("dotenv").config();
const path = require("path");
const XLSX = require("xlsx");
const pool = require("../src/config/db");

// ======== SỐ CÂU MỖI NHÓM (chỉnh tại đây; thực tế bị chặn bởi số dữ liệu có sẵn) ========
const TARGETS = {
  T1_1_to_1: 10,
  T2_1_to_N: 20,
  T3_N_to_1: 10,
  T4_mot_phan: 10,
  T5_new_to_old: 8,
  T6_count: 5,
  T7_typo_no_diacritic: 5,
  T8_ambiguous: 2,
  T8_out_of_scope: 2,
};

const OUT_OF_SCOPE_QUESTIONS = [
  (p) => `Thời tiết ở ${p} hôm nay như thế nào?`,
  () => "Giá vàng SJC hôm nay là bao nhiêu?",
  (p) => `Quán cà phê nào ngon nhất ở ${p}?`,
];

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

// "Thành phố Hồ Chí Minh" -> "HCM", "Đồng Nai" -> "DN", "Cần Thơ" -> "CT"
function provinceCode(name) {
  const core = stripDiacritics(name).replace(/^(Tinh|Thanh pho|TP\.?)\s+/i, "");
  return core
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join("");
}

// Lấy n phần tử từ pool, bỏ qua phần tử đã dùng (used) để không trùng giữa các nhóm
function pick(pool, n, used, rng, keyFn) {
  const fresh = shuffle(
    pool.filter((x) => !used.has(keyFn(x))),
    rng,
  ).slice(0, n);
  fresh.forEach((x) => used.add(keyFn(x)));
  return fresh;
}

// Chuỗi must_contain cho danh sách tên đơn vị cũ. Nếu 1 tên là tiền tố của tên khác
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

function oldLabel(e) {
  return `${e.name} (${e.parent})`;
}

// ======== ĐỌC DỮ LIỆU 1 TỈNH ========
async function loadProvinceData(provinceId) {
  const { rows } = await pool.query(
    `SELECT o.id AS old_id, o.name AS old_name, o.parent_name,
            n.id AS new_id, n.name AS new_name, m.merge_type
     FROM unit_mapping m
     JOIN admin_units_old o ON o.id = m.old_unit_id
     JOIN admin_units_new n ON n.id = m.new_unit_id
     WHERE n.province_new_id = $1
     ORDER BY o.id, n.id`,
    [provinceId],
  );

  const byOld = new Map();
  const byNew = new Map();
  for (const r of rows) {
    if (!byOld.has(r.old_id)) {
      byOld.set(r.old_id, {
        old_id: r.old_id,
        name: r.old_name,
        parent: r.parent_name,
        rows: [],
      });
    }
    byOld.get(r.old_id).rows.push({
      new_id: r.new_id,
      new_name: r.new_name,
      merge_type: r.merge_type,
    });

    if (!byNew.has(r.new_id)) {
      byNew.set(r.new_id, { new_id: r.new_id, name: r.new_name, olds: [] });
    }
    byNew.get(r.new_id).olds.push({
      name: r.old_name,
      parent: r.parent_name,
      merge_type: r.merge_type,
    });
  }
  return { oldUnits: [...byOld.values()], newUnits: [...byNew.values()] };
}

// ======== SINH BỘ CÂU HỎI ========
function buildTestCases(code, provinceName, data, rng) {
  const cases = [];
  const shortfalls = [];
  const usedOld = new Set();
  const usedNew = new Set();
  const seqs = {};

  function add(category, q) {
    seqs[category] = (seqs[category] || 0) + 1;
    const catShort =
      category === "T8_ambiguous"
        ? "T8A"
        : category === "T8_out_of_scope"
          ? "T8O"
          : category.split("_")[0]; // T1..T7
    cases.push({
      test_id: `${code}-${catShort}-${String(seqs[category]).padStart(3, "0")}`,
      category,
      question: q.question,
      expected_answer: q.expected_answer,
      old_unit_name: q.old_unit_name || "",
      old_parent: q.old_parent || "",
      expected_count: q.expected_count ?? "",
      must_contain: q.must_contain || "",
      must_not_contain: q.must_not_contain || "",
      difficulty: q.difficulty,
      golden: "NO", // đổi thành YES cho các câu đã được người rà soát tay
      notes: q.notes || "",
      province: provinceName,
    });
  }

  function checkShortfall(category, got) {
    if (got < TARGETS[category]) {
      shortfalls.push(`${category}: cần ${TARGETS[category]}, chỉ có ${got}`);
    }
  }

  const keyOld = (o) => o.old_id;
  const keyNew = (n) => n.new_id;

  // ---- T1: 1 đơn vị cũ -> đúng 1 đơn vị mới, sáp nhập toàn bộ ----
  // Loại các đơn vị GIỮ NGUYÊN TÊN (VD "Xã A" -> "Xã A"): must_contain = tên mới
  // sẽ khớp ngay với tên cũ được lặp lại trong câu trả lời, nên câu hỏi không phân
  // biệt được đáp án đúng/sai.
  const sameName = (o) =>
    o.name.trim().toLowerCase() === o.rows[0].new_name.trim().toLowerCase();
  const poolT1 = data.oldUnits.filter(
    (o) =>
      o.rows.length === 1 && o.rows[0].merge_type === "toan_bo" && !sameName(o),
  );
  const t1Templates = [
    (o) => `${o.name}, ${o.parent} cũ hiện nay thuộc đơn vị hành chính nào?`,
    (o) => `${o.name} (${o.parent}) sau sắp xếp được nhập vào đơn vị nào?`,
    (o) =>
      `Sau sắp xếp, ${o.name}, ${o.parent} thuộc đơn vị hành chính mới nào?`,
  ];
  const t1 = pick(poolT1, TARGETS.T1_1_to_1, usedOld, rng, keyOld);
  t1.forEach((o, i) =>
    add("T1_1_to_1", {
      question: t1Templates[i % t1Templates.length](o),
      expected_answer: `${o.name} (cũ) hiện nay thuộc ${o.rows[0].new_name}.`,
      old_unit_name: o.name,
      old_parent: o.parent,
      must_contain: o.rows[0].new_name,
      difficulty: "easy",
    }),
  );
  checkShortfall("T1_1_to_1", t1.length);

  // ---- T2: 1 đơn vị cũ bị chia thành nhiều đơn vị mới ----
  const poolSplit = data.oldUnits.filter((o) => o.rows.length >= 2);
  const t2Templates = [
    (o) =>
      `Địa bàn ${o.name}, ${o.parent} hiện nay thuộc những đơn vị hành chính nào?`,
    (o) =>
      `${o.name}, ${o.parent} được chia thành bao nhiêu đơn vị hành chính mới?`,
  ];
  const t2 = pick(poolSplit, TARGETS.T2_1_to_N, usedOld, rng, keyOld);
  t2.forEach((o, i) => {
    const newNames = o.rows.map((r) => r.new_name);
    add("T2_1_to_N", {
      question: t2Templates[i % t2Templates.length](o),
      expected_answer: `${o.name} (cũ) được chia làm ${newNames.length} phần: ${newNames.join(", ")}.`,
      old_unit_name: o.name,
      old_parent: o.parent,
      expected_count: newNames.length,
      must_contain: newNames.join(" | "),
      difficulty: "medium",
    });
  });
  checkShortfall("T2_1_to_N", t2.length);

  // ---- T4: biến thể câu hỏi về sáp nhập MỘT PHẦN (dùng các đơn vị chưa dùng ở T2) ----
  const poolPartial = data.oldUnits.filter(
    (o) =>
      o.rows.length >= 2 || o.rows.some((r) => r.merge_type === "mot_phan"),
  );
  const t4 = pick(poolPartial, TARGETS.T4_mot_phan, usedOld, rng, keyOld);
  t4.forEach((o) => {
    const newNames = o.rows.map((r) => r.new_name);
    add("T4_mot_phan", {
      question: `Một phần diện tích của ${o.name}, ${o.parent} được sáp nhập vào những đơn vị hành chính nào?`,
      expected_answer: `${o.name} (cũ) được chia làm ${newNames.length} phần: ${newNames.join(", ")}.`,
      old_unit_name: o.name,
      old_parent: o.parent,
      expected_count: newNames.length,
      must_contain: newNames.join(" | "),
      difficulty: "medium",
    });
  });
  checkShortfall("T4_mot_phan", t4.length);

  // ---- T3: nhiều đơn vị cũ -> 1 đơn vị mới (liệt kê đầy đủ) ----
  const poolMulti = data.newUnits.filter((n) => n.olds.length >= 2);
  const t3 = pick(poolMulti, TARGETS.T3_N_to_1, usedNew, rng, keyNew);
  t3.forEach((n) =>
    add("T3_N_to_1", {
      question: `${n.name} được hình thành từ những đơn vị hành chính nào?`,
      expected_answer: `${n.name} được hình thành từ ${n.olds.map(oldLabel).join(", ")}.`,
      expected_count: n.olds.length,
      must_contain: oldNamesForMatch(n.olds).join(" | "),
      difficulty: "hard",
      notes: `${n.olds.length} đơn vị cũ`,
    }),
  );
  checkShortfall("T3_N_to_1", t3.length);

  // ---- T5: hỏi ngược "trước sắp xếp gồm những đơn vị nào" ----
  // (câu có cụm "trước sắp xếp" + "gồm" để khớp isAggregationIntent của Model 1)
  const t5 = pick(poolMulti, TARGETS.T5_new_to_old, usedNew, rng, keyNew);
  t5.forEach((n) =>
    add("T5_new_to_old", {
      question: `Các đơn vị hành chính trước sắp xếp của ${n.name} gồm những đơn vị nào?`,
      expected_answer: `${n.name} được hình thành từ ${n.olds.map(oldLabel).join(", ")}.`,
      expected_count: n.olds.length,
      must_contain: oldNamesForMatch(n.olds).join(" | "),
      difficulty: "hard",
    }),
  );
  checkShortfall("T5_new_to_old", t5.length);

  // ---- T6: đếm số đơn vị cũ. Ưu tiên đơn vị mới chỉ gồm "toàn bộ" ----
  // (evaluateAnswer đếm theo tên "Phường/Xã/..." nên cụm "một phần diện tích của X"
  //  có thể bị đếm thiếu; chọn đơn vị chỉ có toàn bộ để phép chấm công bằng hơn)
  const poolCount = data.newUnits.filter((n) => n.olds.length >= 2);
  const poolCountClean = poolCount.filter((n) =>
    n.olds.every((o) => o.merge_type === "toan_bo"),
  );
  let t6 = pick(poolCountClean, TARGETS.T6_count, usedNew, rng, keyNew);
  if (t6.length < TARGETS.T6_count) {
    t6 = t6.concat(
      pick(poolCount, TARGETS.T6_count - t6.length, usedNew, rng, keyNew),
    );
  }
  t6.forEach((n) =>
    add("T6_count", {
      question: `${n.name} được hình thành từ bao nhiêu đơn vị hành chính cấp xã trước đây?`,
      expected_answer: `${n.name} được hình thành từ ${n.olds.length} đơn vị: ${n.olds.map(oldLabel).join(", ")}.`,
      expected_count: n.olds.length,
      must_contain: String(n.olds.length),
      difficulty: "medium",
    }),
  );
  checkShortfall("T6_count", t6.length);

  // ---- T7: viết không dấu/chữ thường (ưu tiên đơn vị chưa dùng ở T1) ----
  let t7 = pick(poolT1, TARGETS.T7_typo_no_diacritic, usedOld, rng, keyOld);
  if (t7.length < TARGETS.T7_typo_no_diacritic) {
    // không đủ đơn vị mới -> dùng lại đơn vị đã ra ở T1 (câu hỏi khác dạng nên vẫn là test khác)
    const reuse = shuffle(poolT1, rng)
      .filter((o) => !t7.includes(o))
      .slice(0, TARGETS.T7_typo_no_diacritic - t7.length);
    t7 = t7.concat(reuse);
  }
  t7.forEach((o) =>
    add("T7_typo_no_diacritic", {
      question: stripDiacritics(
        `${o.name}, ${o.parent} cũ hiện nay thuộc đơn vị hành chính nào?`,
      ).toLowerCase(),
      expected_answer: `${o.name} (cũ) hiện nay thuộc ${o.rows[0].new_name}.`,
      old_unit_name: o.name,
      old_parent: o.parent,
      must_contain: o.rows[0].new_name,
      difficulty: "hard",
      notes: "không dấu, chữ thường",
    }),
  );
  checkShortfall("T7_typo_no_diacritic", t7.length);

  // ---- T8_ambiguous: cùng 1 tên đơn vị cũ xuất hiện ở >= 2 quận/huyện ----
  const byName = new Map();
  for (const o of data.oldUnits) {
    if (!byName.has(o.name)) byName.set(o.name, new Set());
    byName.get(o.name).add(o.parent);
  }
  const dupNames = shuffle(
    [...byName.entries()].filter(([, parents]) => parents.size >= 2),
    rng,
  ).slice(0, TARGETS.T8_ambiguous);
  dupNames.forEach(([name, parents]) =>
    add("T8_ambiguous", {
      question: `${name} cũ bây giờ thuộc đơn vị hành chính nào?`,
      expected_answer: `Có nhiều đơn vị cùng tên "${name}" (${[...parents].join("; ")}); hệ thống cần hỏi lại quận/huyện.`,
      old_unit_name: name,
      difficulty: "hard",
      notes: `trùng tên ở ${parents.size} quận/huyện`,
    }),
  );
  checkShortfall("T8_ambiguous", dupNames.length);

  // ---- T8_out_of_scope: ngoài phạm vi dữ liệu ----
  OUT_OF_SCOPE_QUESTIONS.slice(0, TARGETS.T8_out_of_scope).forEach((fn) =>
    add("T8_out_of_scope", {
      question: fn(provinceName),
      expected_answer: "Hệ thống trả no_answer (ngoài phạm vi dữ liệu).",
      difficulty: "easy",
    }),
  );

  return { cases, shortfalls };
}

// ======== GHI FILE ========
function writeXlsx(code, cases) {
  const outPath = path.join(__dirname, `../data/test_matrix_${code}.xlsx`);
  const ws = XLSX.utils.json_to_sheet(cases);
  ws["!cols"] = [
    { wch: 16 },
    { wch: 22 },
    { wch: 70 },
    { wch: 70 },
    { wch: 22 },
    { wch: 18 },
    { wch: 14 },
    { wch: 50 },
    { wch: 18 },
    { wch: 12 },
    { wch: 8 },
    { wch: 24 },
    { wch: 24 },
  ];

  const byCat = {};
  cases.forEach((c) => (byCat[c.category] = (byCat[c.category] || 0) + 1));
  const summaryRows = Object.entries(byCat).map(([category, so_cau]) => ({
    category,
    so_cau,
  }));
  summaryRows.push({ category: "TỔNG", so_cau: cases.length });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `TestCases_${cases.length}`);
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(summaryRows),
    "Summary",
  );
  XLSX.writeFile(wb, outPath);
  return outPath;
}

async function runOne(provinceId, seed) {
  const { rows } = await pool.query(
    "SELECT id, name FROM provinces_new WHERE id = $1",
    [provinceId],
  );
  if (rows.length === 0) {
    console.error(`Không có province_id=${provinceId} trong provinces_new.`);
    return;
  }
  const provinceName = rows[0].name;
  const code = provinceCode(provinceName);
  const data = await loadProvinceData(provinceId);

  console.log(
    `\n=== ${provinceName} (id=${provinceId}, mã ${code}) | ${data.oldUnits.length} đơn vị cũ, ${data.newUnits.length} đơn vị mới ===`,
  );
  if (data.oldUnits.length === 0) {
    console.warn(
      "  Chưa có dữ liệu unit_mapping cho tỉnh này — bỏ qua. Đã chạy import_excel_to_db.js chưa?",
    );
    return;
  }

  const rng = mulberry32(seed + provinceId);
  const { cases, shortfalls } = buildTestCases(code, provinceName, data, rng);
  const outPath = writeXlsx(code, cases);

  console.log(`  Đã sinh ${cases.length} câu -> ${outPath}`);
  if (shortfalls.length) {
    console.log("  Nhóm thiếu so với mục tiêu (do dữ liệu tỉnh này không đủ):");
    shortfalls.forEach((s) => console.log(`    - ${s}`));
  }
}

async function main() {
  try {
    if (hasFlag("--list")) {
      const { rows } = await pool.query(
        "SELECT id, name FROM provinces_new ORDER BY id",
      );
      rows.forEach((r) =>
        console.log(`${r.id}\t${r.name}\t(mã ${provinceCode(r.name)})`),
      );
      return;
    }

    const seed = Number(getArg("--seed") || 42);
    let ids = [];
    if (hasFlag("--all")) {
      // Lấy id thật từ DB (id có thể lệch nếu DB từng được dựng lại); bỏ TP.HCM (id=1) vì đã có bộ test riêng
      const { rows } = await pool.query(
        "SELECT id FROM provinces_new WHERE id <> 1 ORDER BY id",
      );
      ids = rows.map((r) => r.id);
    } else if (getArg("--province-id")) ids = [Number(getArg("--province-id"))];
    else {
      console.error(
        "Cách dùng: node scripts/generateTestMatrix.js --list | --province-id N | --all [--seed 42]",
      );
      process.exitCode = 1;
      return;
    }

    for (const id of ids) await runOne(id, seed);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("Lỗi:", err);
  process.exit(1);
});
