// scripts/retryFailedRows.js
// Chạy lại CHỈ những câu bị lỗi hạ tầng (success=false: RATE_LIMITED,
// SERVICE_UNAVAILABLE, API_ERROR...) trong 1 file kết quả .xlsx đã chạy,
// rồi merge kết quả mới vào đúng vị trí trong file — không cần chạy lại
// toàn bộ batch, tiết kiệm quota và thời gian.
//
// Tự động đọc model/llm_provider của từng câu NGAY TỪ chính file kết quả
// (cột "model", "llm_provider"), nên dùng được cho bất kỳ model nào
// (rule_based/naive_rag/advanced_rag/modular_rag) mà không cần khai báo.
//
// Cách dùng:
//   node scripts/retryFailedRows.js đường_dẫn_file_ket_qua.xlsx
//
// Ghi ra file mới có hậu tố "_fixed.xlsx", KHÔNG sửa file gốc.

const path = require("path");
const axios = require("axios");
const XLSX = require("xlsx");

const API_BASE_URL = "http://localhost:3000/api/v1";
const provinceId = row.province_id || Number(process.env.PROVINCE_ID || 1);
const apiResult = await callAskApi(row.question, model, provider, provinceId);
const MAX_RETRIES = 3;
const DELAY_BETWEEN_CALLS_MS = 4500; // giãn cách giữa các lần gọi, an toàn RPM

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ============ evaluateAnswer — COPY ĐỒNG BỘ với runBatchTest.js đã sửa ============
// (T6_count đếm số đơn vị thay vì tìm literal digit; regex tách "và" không
// dùng \b vì \b của JS không nhận biết đúng ranh giới ký tự có dấu)
function normalizeAnswerText(s) {
  if (!s) return s;
  return s.replace(/[\u00a0\u202f\u2009\u2007\u2002\u2003]/g, " ");
}

function countAdminUnitMentions(answerText) {
  if (!answerText) return 0;
  const mainPart = answerText.split(/,?\s*theo\s+/i)[0];
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

  if (q.category === "T6_count") {
    if (!result.answer) return { pass: false, reason: "NO_ANSWER_FOR_COUNT" };
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
  if (missing.length > 0)
    return { pass: false, reason: "MISSING_ENTITY", missing };

  const forbidden = (q.must_not_contain || "")
    .split("|")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);
  const foundForbidden = forbidden.filter((item) => answer.includes(item));
  if (foundForbidden.length > 0)
    return { pass: false, reason: "FORBIDDEN_ENTITY", foundForbidden };

  return { pass: true, reason: "PASS" };
}

// ============ Gọi API 1 câu (có retry giống runBatchTest.js) ============
async function callAskApi(question, model, provider, provinceId, attempt = 0) {
  const startTime = Date.now();
  try {
    const res = await axios.post(
      `${API_BASE_URL}/qa/ask`,
      { question, model, llm_provider: provider, province_id: provinceId },
      { timeout: 120000 },
    );
    return {
      success: true,
      answer: res.data?.data?.answer || null,
      answer_type: res.data?.data?.answer_type || null,
      confidence: res.data?.data?.confidence ?? null,
      response_time_ms: Date.now() - startTime,
      error: null,
    };
  } catch (err) {
    const errorCode = err.response?.data?.error_code;

    if (errorCode === "RATE_LIMITED" && attempt < MAX_RETRIES) {
      const retryAfterMs = err.response?.data?.retry_after_ms;
      const waitMs = retryAfterMs || 20000 * Math.pow(2, attempt);
      console.log(
        `    (rate limit, chờ ${Math.round(waitMs / 1000)}s, thử lại ${attempt + 1}/${MAX_RETRIES})`,
      );
      await sleep(waitMs);
      return callAskApi(question, model, provider, provinceId, attempt + 1);
    }
    if (errorCode === "SERVICE_UNAVAILABLE" && attempt < MAX_RETRIES) {
      const waitMs = 5000 * (attempt + 1);
      console.log(
        `    (service bận, chờ ${Math.round(waitMs / 1000)}s, thử lại ${attempt + 1}/${MAX_RETRIES})`,
      );
      await sleep(waitMs);
      return callAskApi(question, model, provider, provinceId, attempt + 1);
    }
    return {
      success: false,
      answer: null,
      answer_type: null,
      confidence: null,
      response_time_ms: Date.now() - startTime,
      error: errorCode || err.message,
    };
  }
}

// ============ MAIN ============
async function run() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error(
      "Cách dùng: node scripts/retryFailedRows.js file_ket_qua.xlsx",
    );
    process.exit(1);
  }

  const wb = XLSX.readFile(filePath);
  const sheetName = wb.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName]);

  const failedIndexes = rows
    .map((r, i) => (r.success === false || r.success === 0 ? i : -1))
    .filter((i) => i !== -1);

  if (failedIndexes.length === 0) {
    console.log(
      "Không có câu nào bị lỗi (success=false) trong file này. Không cần làm gì.",
    );
    return;
  }

  console.log(
    `Tìm thấy ${failedIndexes.length} câu bị lỗi trong tổng ${rows.length} câu. Bắt đầu chạy lại...\n`,
  );

  let fixedCount = 0;
  let stillFailedCount = 0;

  for (let n = 0; n < failedIndexes.length; n++) {
    const idx = failedIndexes[n];
    const row = rows[idx];
    const model = row.model;
    const provider = row.llm_provider || "gemini";

    console.log(
      `[${n + 1}/${failedIndexes.length}] ${row.test_id} (${row.category}) | model=${model} | lỗi cũ: ${row.error}`,
    );

    const apiResult = await callAskApi(
      row.question,
      model,
      provider,
      PROVINCE_ID,
    );

    const q = {
      category: row.category,
      expected_count: row.expected_count,
      must_contain: row.must_contain,
      must_not_contain: row.must_not_contain,
    };
    const ev = evaluateAnswer(q, apiResult);

    rows[idx] = {
      ...row,
      answer_type: apiResult.answer_type,
      answer: apiResult.answer,
      confidence: apiResult.confidence,
      response_time_ms: apiResult.response_time_ms,
      success: apiResult.success,
      error: apiResult.error,
      pass: ev.pass,
      evaluation_reason: ev.reason || "",
      missing_items: (ev.missing || []).join(" | "),
      forbidden_items: (ev.foundForbidden || []).join(" | "),
    };

    if (apiResult.success) {
      fixedCount++;
      console.log(
        `  -> OK. answer_type=${apiResult.answer_type} | pass=${ev.pass}`,
      );
    } else {
      stillFailedCount++;
      console.log(`  -> VẪN LỖI: ${apiResult.error}`);
    }

    if (n < failedIndexes.length - 1) {
      await sleep(DELAY_BETWEEN_CALLS_MS);
    }
  }

  const outWs = XLSX.utils.json_to_sheet(rows);
  const outWb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(outWb, outWs, sheetName);
  const outPath = filePath.replace(/\.xlsx$/i, "_fixed.xlsx");
  XLSX.writeFile(outWb, outPath);

  const totalValid = rows.filter((r) => r.success).length;
  const totalPass = rows.filter((r) => r.pass === true).length;

  console.log("\n=== HOÀN TẤT ===");
  console.log(`Đã sửa được: ${fixedCount}/${failedIndexes.length} câu`);
  console.log(`Vẫn còn lỗi: ${stillFailedCount}/${failedIndexes.length} câu`);
  console.log(
    `Accuracy toàn bộ file sau khi vá: ${totalPass}/${totalValid} (${((totalPass / totalValid) * 100).toFixed(1)}%)`,
  );
  console.log(`Đã lưu: ${outPath}`);

  if (stillFailedCount > 0) {
    console.log(
      "\nCòn câu lỗi -> chạy lại đúng lệnh này thêm 1 lần nữa trên file _fixed.xlsx vừa tạo:",
    );
    console.log(`  node scripts/retryFailedRows.js ${outPath}`);
  }
}

run();
