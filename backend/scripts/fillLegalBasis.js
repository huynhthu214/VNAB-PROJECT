// scripts/fillLegalBasis.js
require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const fs = require("fs");
const pool = require("../src/config/db");

const DOC_CODE = process.argv[2]; // VD 1654/NQ-UBTVQH15
const TXT_PATH = process.argv[3]; // VD ./nq1654.txt
const APPLY = process.argv.includes("--apply");

const TONE_FIX = [
  ["oà", "òa"],
  ["oá", "óa"],
  ["oả", "ỏa"],
  ["oã", "õa"],
  ["oạ", "ọa"],
  ["oè", "òe"],
  ["oé", "óe"],
  ["oẻ", "ỏe"],
  ["oẽ", "õe"],
  ["oẹ", "ọe"],
  ["uỳ", "ùy"],
  ["uý", "úy"],
  ["uỷ", "ủy"],
  ["uỹ", "ũy"],
  ["uỵ", "ụy"],
];

const norm = (s) => {
  let t = s.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
  for (const [a, b] of TONE_FIX) t = t.split(a).join(b);
  return t;
};

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function parseClauses(text) {
  // Trả về mảng { article, clause, body }. Dòng không bắt đầu bằng "N. " hoặc "Điều N." được nối vào khoản hiện tại.
  const out = [];
  let article = null;
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const a = line.match(/^Điều\s+(\d+)\./i);
    if (a) {
      article = Number(a[1]);
      cur = null;
      continue;
    }
    const c = line.match(/^(\d+)\.\s+(.*)$/);
    if (c && article) {
      cur = { article, clause: Number(c[1]), body: norm(c[2]) };
      out.push(cur);
    } else if (cur && !/^(Chương|Mục)\s/i.test(line)) {
      cur.body += " " + norm(line);
    }
  }
  return out;
}

function findClause(clauses, key) {
  const prefix = "(?:tên gọi là|thành lập|hình thành|thành)\\s+";
  const strict = new RegExp(`${prefix}${esc(key)}\\s*(?:[.,;]|$)`, "u");
  const loose = new RegExp(`${prefix}${esc(key)}(?!\\p{L})`, "u");

  let hits = clauses.filter((c) => strict.test(c.body));
  if (hits.length === 0) hits = clauses.filter((c) => loose.test(c.body));

  if (hits.length > 1) {
    console.log(
      `  Cảnh báo: "${key}" khớp ${hits.length} khoản (${hits.map((h) => h.clause).join(", ")}), lấy khoản đầu`,
    );
  }
  return hits[0] || null;
}

function findUnchangedClause(clauses, key) {
  // Văn bản liệt kê tên xã không kèm tiền tố: "06 xã không thực hiện sắp xếp là các xã Mỹ Hòa Hưng, Bình Giang, ..."
  const bare = key.replace(/^(xã|phường|thị trấn|đặc khu)\s+/, "");
  const re = new RegExp(
    `không thực hiện sắp xếp[^.]*?(?<!\\p{L})${esc(bare)}(?!\\p{L})`,
    "u",
  );
  return clauses.find((c) => re.test(c.body)) || null;
}
// Tên tỉnh trong DB sang cách NQ 202 viết: "TP. Hồ Chí Minh" -> "thành phố hồ chí minh"
const provinceKey = (name) => norm(name).replace(/^tp\.?\s+/, "thành phố ");

async function runProvince(clauses) {
  const { rows: provinces } = await pool.query(
    `SELECT DISTINCT pn.id, pn.name
     FROM provinces_new pn
     JOIN province_mapping pm ON pm.new_province_id = pn.id
     JOIN legal_documents d ON d.id = pm.decision_document_id
     WHERE d.doc_code = $1
     ORDER BY pn.id`,
    [DOC_CODE],
  );

  const plan = [];
  const problems = [];
  for (const p of provinces) {
    const re = new RegExp(
      `có tên gọi là\\s+${esc(provinceKey(p.name))}\\s*(?:[.,;]|$)`,
      "u",
    );
    const hits = clauses.filter((c) => re.test(c.body));
    if (hits.length !== 1) {
      problems.push(`${p.name}: ${hits.length} khoản khớp`);
      console.log(`LỖI ${p.name}: ${hits.length} khoản khớp (cần đúng 1)`);
      continue;
    }
    const h = hits[0];
    plan.push({ id: p.id, name: p.name, article: h.article, clause: h.clause });
    console.log(`${p.name} -> khoản ${h.clause} Điều ${h.article}`);
    console.log(`    ${h.body.slice(0, 110)}...`);
  }

  console.log(
    `\nKkhớp ${plan.length}/${provinces.length}. ${problems.join("; ")}`,
  );
  if (!APPLY) {
    console.log("Chế độ thử, chưa ghi DB. Thêm --apply để ghi.");
    return;
  }
  if (problems.length) {
    console.log("Có vấn đề nên không ghi DB.");
    process.exit(1);
  }
  let total = 0;
  for (const p of plan) {
    const r = await pool.query(
      `UPDATE province_mapping SET article_no = $1, clause_no = $2
       WHERE new_province_id = $3
         AND decision_document_id = (SELECT id FROM legal_documents WHERE doc_code = $4)`,
      [p.article, p.clause, p.id, DOC_CODE],
    );
    total += r.rowCount;
    console.log(`${p.name}: cập nhật ${r.rowCount} dòng`);
  }
  console.log(`Đã ghi vào DB, tổng ${total} dòng.`);
}
(async () => {
  const clauses = parseClauses(
    fs.readFileSync(TXT_PATH, "utf-8").normalize("NFC"),
  );
  console.log(`Đọc được ${clauses.length} khoản từ văn bản`);
  const {
    rows: [pc],
  } = await pool.query(
    `SELECT count(*)::int AS n FROM province_mapping pm
     JOIN legal_documents d ON d.id = pm.decision_document_id
     WHERE d.doc_code = $1`,
    [DOC_CODE],
  );
  if (pc.n > 0) {
    console.log(
      `${DOC_CODE} là văn bản cấp tỉnh (${pc.n} dòng province_mapping)`,
    );
    await runProvince(clauses);
    process.exit(0);
  }
  console.log(
    "Đuôi 3 khoản đầu:",
    clauses
      .slice(0, 3)
      .map((c) => `${c.article}.${c.clause}: ...${c.body.slice(-160)}`),
  );
  const { rows: units } = await pool.query(
    `SELECT DISTINCT n.id, n.name
     FROM admin_units_new n
     JOIN unit_mapping m ON m.new_unit_id = n.id
     JOIN legal_documents d ON d.id = m.decision_document_id
     WHERE d.doc_code = $1`,
    [DOC_CODE],
  );

  let ok = 0,
    miss = [];
  for (const u of units) {
    const key = norm(u.name);
    let hit = findClause(clauses, key);
    if (!hit) hit = findUnchangedClause(clauses, key);
    if (!hit) {
      miss.push(u.name);
      continue;
    }
    ok++;
    console.log(`${u.name} -> khoản ${hit.clause} Điều ${hit.article}`);
    if (APPLY) {
      await pool.query(
        `UPDATE unit_mapping SET article_no = $1, clause_no = $2
         WHERE new_unit_id = $3
           AND decision_document_id = (SELECT id FROM legal_documents WHERE doc_code = $4)`,
        [hit.article, hit.clause, u.id, DOC_CODE],
      );
    }
  }
  console.log(
    `\nKhớp ${ok}/${units.length}. Không khớp: ${miss.join("; ") || "không có"}`,
  );
  console.log(
    APPLY ? "Đã ghi vào DB." : "Chế độ thử, chưa ghi DB. Thêm --apply để ghi.",
  );
  process.exit(0);
})();
