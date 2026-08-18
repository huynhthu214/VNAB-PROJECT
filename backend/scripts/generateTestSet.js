require("dotenv").config();
const pool = require("../src/config/db");
const path = require("path");
const XLSX = require("xlsx");

function removeDiacritics(str) {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D");
}

// ============ NHÓM 1: TRA CỨU TRỰC TIẾP ============
async function generateDirectLookup(limit = 40) {
  const { rows } = await pool.query(
    `SELECT o.id AS old_id, o.name AS old_name, n.name AS new_name, m.merge_type, d.doc_code
     FROM admin_units_old o
     JOIN unit_mapping m ON m.old_unit_id = o.id
     JOIN admin_units_new n ON n.id = m.new_unit_id
     LEFT JOIN legal_documents d ON d.id = m.decision_document_id
     WHERE o.name !~ '^(Phường|Xã)\s+\d+$'
     ORDER BY random()
     LIMIT $1`,
    [limit * 2],
  );

  const grouped = new Map();
  for (const r of rows) {
    if (!grouped.has(r.old_id)) grouped.set(r.old_id, []);
    grouped.get(r.old_id).push(r);
  }

  const questions = [];
  for (const [, group] of grouped) {
    if (questions.length >= limit) break;
    const oldName = group[0].old_name;
    let expectedAnswer;
    if (group.length === 1) {
      expectedAnswer = `${oldName} (cũ) hiện nay thuộc ${group[0].new_name}.`;
    } else {
      const newNames = group.map((g) => g.new_name).join(", ");
      expectedAnswer = `${oldName} (cũ) được chia làm ${group.length} phần: ${newNames}.`;
    }
    questions.push({
      category: "tra_cuu_truc_tiep",
      question: `${oldName} cũ bây giờ là đơn vị nào?`,
      expected_answer: expectedAnswer,
      expected_branch: "structured",
      source_doc: group[0].doc_code || "",
    });
  }
  return questions;
}

// ============ NHÓM 2: SUY LUẬN/TỔNG HỢP ============
async function generateAggregation(limit = 40) {
  const { rows: newUnits } = await pool.query(
    `SELECT n.id, n.name FROM admin_units_new n ORDER BY random() LIMIT $1`,
    [limit],
  );

  const questions = [];
  for (const nu of newUnits) {
    const { rows } = await pool.query(
      `SELECT o.name AS old_name, m.merge_type
       FROM unit_mapping m
       JOIN admin_units_old o ON o.id = m.old_unit_id
       WHERE m.new_unit_id = $1`,
      [nu.id],
    );
    if (rows.length === 0) continue;

    const toanBo = rows
      .filter((r) => r.merge_type === "toan_bo")
      .map((r) => r.old_name);
    const motPhan = rows
      .filter((r) => r.merge_type === "mot_phan")
      .map((r) => r.old_name);

    let parts = [];
    if (toanBo.length) parts.push(`toàn bộ ${toanBo.join(", ")}`);
    if (motPhan.length)
      parts.push(`một phần diện tích của ${motPhan.join(", ")}`);

    questions.push({
      category: "suy_luan_tong_hop",
      question: `${nu.name} được sáp nhập từ những đơn vị hành chính cũ nào?`,
      expected_answer: `${nu.name} được hình thành từ ${parts.join(", cộng với ")}.`,
      expected_branch: "structured_or_hybrid",
      source_doc: "",
    });
  }
  return questions;
}

// ============ NHÓM 3: NGOÀI PHẠM VI ============
function generateOutOfScope() {
  const otherProvincePairs = [
    ["Hà Giang", "Tuyên Quang"],
    ["Yên Bái", "Lào Cai"],
    ["Bắc Kạn", "Thái Nguyên"],
  ];

  const questions = [];
  for (const [a, b] of otherProvincePairs) {
    questions.push({
      category: "ngoai_pham_vi",
      question: `Tỉnh ${a} và ${b} được sáp nhập thành tỉnh nào?`,
      expected_answer:
        "NO_ANSWER_FOUND (ngoài phạm vi TP.HCM/Bình Dương/Bà Rịa-Vũng Tàu)",
      expected_branch: "no_answer",
      source_doc: "",
    });
  }

  const offTopic = [
    "Việc sáp nhập TP.HCM ảnh hưởng thế nào đến giá bất động sản?",
    "Ai là người ký Nghị quyết 1685/NQ-UBTVQH15?",
    "GDP của TP.HCM sau sáp nhập là bao nhiêu?",
    "Thời tiết TP.HCM hôm nay thế nào?",
    "Dân số TP.HCM sẽ tăng bao nhiêu phần trăm trong 5 năm tới?",
  ];
  for (const q of offTopic) {
    questions.push({
      category: "ngoai_pham_vi",
      question: q,
      expected_answer: "NO_ANSWER_FOUND (ngoài phạm vi dữ liệu nghị quyết)",
      expected_branch: "no_answer",
      source_doc: "",
    });
  }
  return questions;
}

// ============ NHÓM 4: MƠ HỒ/VIẾT SAI ============
async function generateAmbiguous(limit = 35) {
  const { rows } = await pool.query(
    `SELECT * FROM (
       SELECT DISTINCT o.name AS old_name, n.name AS new_name
       FROM admin_units_old o
       JOIN unit_mapping m ON m.old_unit_id = o.id
       JOIN admin_units_new n ON n.id = m.new_unit_id
       WHERE o.name !~ '^(Phường|Xã)\s+\d+$'
     ) sub
     ORDER BY random()
     LIMIT $1`,
    [limit],
  );

  const questions = [];
  rows.forEach((r, i) => {
    const variant = i % 3;
    let questionText;
    if (variant === 0) {
      questionText = `${removeDiacritics(r.old_name)} bây giờ là gì?`;
    } else if (variant === 1) {
      const shortened = r.old_name.replace(/^(Phường|Xã|Thị trấn)\s+/, "");
      questionText = `${shortened} cũ giờ thuộc đâu vậy ta?`;
    } else {
      questionText = `cho hoi ${removeDiacritics(r.old_name).toLowerCase()} sau sap nhap la phuong nao`;
    }
    questions.push({
      category: "mo_ho_viet_sai",
      question: questionText,
      expected_answer: `${r.old_name} (cũ) hiện nay thuộc ${r.new_name}. (Ghi chú: cần kiểm tra thủ công vì có thể khớp nhiều dòng do viết sai/thiếu dấu)`,
      expected_branch: "structured_or_hybrid",
      source_doc: "",
    });
  });
  return questions;
}

async function run() {
  console.log("Đang sinh bộ câu hỏi test từ database thật...");

  const group1 = await generateDirectLookup(40);
  const group2 = await generateAggregation(40);
  const group3 = generateOutOfScope();
  const group4 = await generateAmbiguous(35);

  const all = [...group1, ...group2, ...group3, ...group4].map((q, i) => ({
    id: i + 1,
    category: q.category,
    question: q.question,
    expected_answer: q.expected_answer,
    expected_branch: q.expected_branch,
    source_doc: q.source_doc,
    verified_by_team: "chua_duyet",
  }));

  console.log(`Nhóm 1 (tra cứu trực tiếp): ${group1.length} câu`);
  console.log(`Nhóm 2 (suy luận/tổng hợp): ${group2.length} câu`);
  console.log(`Nhóm 3 (ngoài phạm vi): ${group3.length} câu`);
  console.log(`Nhóm 4 (mơ hồ/viết sai): ${group4.length} câu`);
  console.log(`TỔNG: ${all.length} câu`);

  // Tạo file Excel thật (.xlsx) - tránh hoàn toàn lỗi format CSV
  const worksheet = XLSX.utils.json_to_sheet(all);

  worksheet["!cols"] = [
    { wch: 6 }, // id
    { wch: 20 }, // category
    { wch: 50 }, // question
    { wch: 60 }, // expected_answer
    { wch: 20 }, // expected_branch
    { wch: 20 }, // source_doc
    { wch: 15 }, // verified_by_team
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "TestSet");

  const outputPath = path.join(
    __dirname,
    "../data/test_set_ground_truth_DRAFT.xlsx",
  );
  XLSX.writeFile(workbook, outputPath);

  console.log(`\nĐã lưu file DRAFT tại: ${outputPath}`);
  console.log(
    "Mở trực tiếp bằng Excel/Google Sheets - không còn lỗi format nữa.",
  );
  console.log(
    "QUAN TRỌNG: đây là bản DRAFT - cả nhóm phải rà soát lại từng dòng,",
  );
  console.log(
    "đặc biệt nhóm 'mo_ho_viet_sai' và 'ngoai_pham_vi', trước khi đổi tên",
  );
  console.log(
    "thành test_set_ground_truth.xlsx (bản chính thức, không sửa sau khi bắt đầu chạy thực nghiệm).",
  );

  await pool.end();
}

run();
