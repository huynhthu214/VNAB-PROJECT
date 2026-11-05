// Chuẩn hóa câu hỏi KHÔNG DẤU để tra bảng (sửa T7 cho Model 1 / Model 4).
// Chỉ tác động khi câu hỏi hoàn toàn không có ký tự có dấu tiếng Việt -> không đụng các nhóm câu khác.
// Cách làm: tìm tên đơn vị cũ (và quận/huyện cha) trong câu đã bỏ dấu, rồi NỐI tên chuẩn có dấu vào cuối câu,
// để tryOldUnitMatch (ILIKE theo tên có dấu) khớp được mà không phải sửa logic của nó.
const stripVi = (s) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
const tokens = (s) =>
  " " +
  stripVi(s)
    .replace(/[^a-z0-9]+/g, " ")
    .trim() +
  " ";
const hasDiacritics = (s) =>
  /[^\u0000-\u007f]/.test(
    String(s || "").replace(/[\u2018\u2019\u201c\u201d]/g, ""),
  );
const PREFIX = /^(phuong|xa|thi tran|dac khu)\s+/;

let cache = null;
async function loadNames(pool) {
  if (cache) return cache;
  const { rows } = await pool.query(
    "SELECT DISTINCT name, parent_name FROM admin_units_old WHERE name IS NOT NULL",
  );
  cache = rows.map((r) => {
    const full = tokens(r.name).trim();
    const core = full.replace(PREFIX, "");
    return {
      name: r.name,
      parent: r.parent_name,
      full,
      core,
      parentTok: r.parent_name ? tokens(r.parent_name).trim() : null,
    };
  });
  return cache;
}

async function canonicalizeQuestion(pool, question) {
  if (hasDiacritics(question)) return question; // câu có dấu: giữ nguyên
  const q = tokens(question);
  const names = await loadNames(pool);
  // 1) khớp đầy đủ "phuong tan quy" (ranh giới từ, nên "phuong 1" không khớp "phuong 10")
  let hits = names.filter((n) => q.includes(" " + n.full + " "));
  // 2) không có tiền tố loại đơn vị: khớp phần lõi, chỉ khi không phải số và đủ dài
  if (hits.length === 0) {
    hits = names.filter(
      (n) =>
        !/^\d+$/.test(n.core) &&
        n.core.length >= 6 &&
        q.includes(" " + n.core + " "),
    );
  }
  if (hits.length === 0) return question;
  const best = Math.max(...hits.map((h) => h.full.length));
  const top = hits.filter((h) => h.full.length === best);
  const extra = new Set(top.map((h) => h.name)); // tên chuẩn có dấu
  for (const h of top)
    if (h.parentTok && q.includes(" " + h.parentTok + " ")) extra.add(h.parent);
  return `${question} ${[...extra].join(" ")}`;
}
module.exports = { canonicalizeQuestion, stripVi };
