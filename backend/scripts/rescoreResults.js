// scripts/rescoreResults.js
// Chấm lại các file kết quả .xlsx đã chạy trước đó, KHÔNG gọi lại API.
// Dùng khi sửa logic evaluateAnswer() (ví dụ: cách chấm T6_count) và muốn
// biết accuracy thật mà không tốn quota/thời gian chạy lại batch.
//
// Cách dùng:
//   node scripts/rescoreResults.js đường_dẫn_file_ket_qua.xlsx [đường_dẫn_file_ket_qua_2.xlsx ...]
//
// Ghi đè thêm file mới có hậu tố "_rescored.xlsx", KHÔNG sửa file gốc.

const path = require("path");
const XLSX = require("xlsx");

// ============ COPY NGUYÊN VĂN evaluateAnswer + hàm phụ trợ từ runBatchTest.js ============
// Giữ đồng bộ 2 nơi này theo cách thủ công — nếu sửa logic chấm điểm ở
// runBatchTest.js thì phải copy lại xuống đây.

function normalizeAnswerText(s) {
  if (!s) return s;
  return s.replace(/[\u00a0\u202f\u2009\u2007\u2002\u2003]/g, " ");
}

function countAdminUnitMentions(answerText) {
  if (!answerText) return 0;
  const mainPart = answerText.split(/,?\s*theo\s+/i)[0];
  // LƯU Ý: không dùng \b quanh "và"/"cộng với" — \b của JS chỉ nhận biết
  // ký tự ASCII [A-Za-z0-9_], nên với từ có dấu (à, ộ...) \b không khớp
  // đúng ranh giới từ, làm regex cũ không tách được "...và Xã...".
  // Tách theo khoảng trắng bao quanh thay vì word-boundary.
  const segments = mainPart.split(/,|\s+và\s+|\s+cộng với\s+/i);
  const unitRegex = /^(Phường|Xã|Thị trấn|Đặc khu)\s+\S.*$/i;
  const names = segments.map((s) => s.trim()).filter((s) => unitRegex.test(s));
  return new Set(names.map((s) => s.toLowerCase())).size;
}

function evaluateAnswer(q, result) {
  if (!result.success) {
    return { pass: null, reason: "API_ERROR" };
  }

  const answer = normalizeAnswerText(result.answer || "").toLowerCase();

  if (q.category === "T8_out_of_scope") {
    const hasNoAnswer =
      result.answer_type === "no_answer" ||
      answer.includes("ngoài phạm vi") ||
      answer.includes("không có thông tin");
    return {
      pass: hasNoAnswer,
      reason: hasNoAnswer ? "PASS" : "EXPECTED_NO_ANSWER",
    };
  }

  if (q.category === "T8_ambiguous") {
    const asksForContext =
      answer.includes("quận") ||
      answer.includes("huyện") ||
      answer.includes("bổ sung") ||
      answer.includes("chưa đủ thông tin");
    return {
      pass: asksForContext,
      reason: asksForContext ? "PASS" : "DID_NOT_DISAMBIGUATE",
    };
  }

  // ===== Count (T6) — MỚI =====
  if (q.category === "T6_count") {
    if (!result.answer) {
      return { pass: false, reason: "NO_ANSWER_FOR_COUNT" };
    }
    const expectedCount = Number(q.expected_count ?? q.must_contain);
    const mentionedCount = countAdminUnitMentions(result.answer);
    const literalDigitPresent = new RegExp(`\\b${expectedCount}\\b`).test(
      answer,
    );
    const pass = mentionedCount === expectedCount || literalDigitPresent;
    return {
      pass,
      reason: pass ? "PASS" : "COUNT_MISMATCH",
      mentioned_count: mentionedCount,
    };
  }

  const required = (q.must_contain || "")
    .split("|")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const missing = required.filter((item) => !answer.includes(item));
  if (missing.length > 0) {
    return { pass: false, reason: "MISSING_ENTITY", missing };
  }

  const forbidden = (q.must_not_contain || "")
    .split("|")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const foundForbidden = forbidden.filter((item) => answer.includes(item));
  if (foundForbidden.length > 0) {
    return { pass: false, reason: "FORBIDDEN_ENTITY", foundForbidden };
  }

  return { pass: true, reason: "PASS" };
}

// ============ CHẤM LẠI 1 FILE ============
function rescoreFile(filePath) {
  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);

  const stats = { total: 0, error: 0, pass_old: 0, pass_new: 0, changed: 0 };

  const rescored = rows.map((r) => {
    stats.total++;
    const q = {
      category: r.category,
      expected_count: r.expected_count,
      must_contain: r.must_contain,
      must_not_contain: r.must_not_contain,
    };
    const result = {
      success: r.success,
      answer: r.answer,
      answer_type: r.answer_type,
    };
    const oldPass = r.pass;
    const ev = evaluateAnswer(q, result);

    if (!result.success) stats.error++;
    if (oldPass === true) stats.pass_old++;
    if (ev.pass === true) stats.pass_new++;
    if (oldPass !== ev.pass) stats.changed++;

    return {
      ...r,
      pass: ev.pass,
      evaluation_reason: ev.reason || "",
      missing_items: (ev.missing || []).join(" | "),
      forbidden_items: (ev.foundForbidden || []).join(" | "),
      mentioned_count: ev.mentioned_count ?? "",
      pass_old: oldPass,
    };
  });

  const outWs = XLSX.utils.json_to_sheet(rescored);
  const outWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(outWb, outWs, sheetName);

  const outPath = filePath.replace(/\.xlsx$/i, "_rescored.xlsx");
  XLSX.writeFile(outWb, outPath);

  const valid = stats.total - stats.error;
  console.log(`\n=== ${path.basename(filePath)} ===`);
  console.log(
    `  Tổng: ${stats.total} | lỗi hạ tầng: ${stats.error} | mẫu hợp lệ: ${valid}`,
  );
  console.log(
    `  Pass CŨ: ${stats.pass_old}/${valid} (${((stats.pass_old / valid) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  Pass MỚI: ${stats.pass_new}/${valid} (${((stats.pass_new / valid) * 100).toFixed(1)}%)`,
  );
  console.log(`  Số dòng đổi kết quả pass/fail: ${stats.changed}`);
  console.log(`  Đã lưu: ${outPath}`);
}

// ============ MAIN ============
const files = process.argv.slice(2);
if (files.length === 0) {
  console.error(
    "Cách dùng: node scripts/rescoreResults.js file1.xlsx [file2.xlsx ...]",
  );
  process.exit(1);
}
files.forEach(rescoreFile);
