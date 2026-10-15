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

(async () => {
  const clauses = parseClauses(
    fs.readFileSync(TXT_PATH, "utf-8").normalize("NFC"),
  );
  console.log(`Đọc được ${clauses.length} khoản từ văn bản`);
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
