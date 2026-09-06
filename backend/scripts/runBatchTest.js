require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const XLSX = require("xlsx");

// ============ CẤU HÌNH — ĐỔI 2 DÒNG NÀY GIỮA CÁC LƯỢT CHẠY ============
const LLM_PROVIDER = "gemini";
const MODELS_TO_RUN = ["advanced_rag"];
const TEST_SET_PATH = path.join(__dirname, "../data/pilot_test_set.xlsx");

const API_BASE_URL = "http://localhost:3000/api/v1";
const RESULTS_DIR = path.join(__dirname, "../data/batch_results");
const SUMMARY_PATH = path.join(RESULTS_DIR, "timing_summary.xlsx");

const CONCURRENCY = 4; // chỉ áp dụng cho rule_based (không gọi AI)
const REQUEST_DELAY_MS = 4500; // giãn cách giữa mỗi câu khi gọi LLM (naive_rag, modular_rag)
const DELAY_BETWEEN_MODELS_MS = 5000;

// ============ ĐỌC BỘ CÂU HỎI TỪ FILE XLSX ============
function readTestSet(filePath) {
  const workbook = XLSX.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet);
}

// ============ SIMPLE CONCURRENCY LIMITER (chỉ dùng cho rule_based) ============
function createLimiter(maxConcurrent) {
  let running = 0;
  const queue = [];
  function next() {
    if (queue.length === 0 || running >= maxConcurrent) return;
    running++;
    const { fn, resolve, reject } = queue.shift();
    fn()
      .then(resolve)
      .catch(reject)
      .finally(() => {
        running--;
        next();
      });
  }
  return function limit(fn) {
    return new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============ GỌI API 1 CÂU HỎI (có retry 1 lần nếu bị rate limit) ============
async function callAskApi(question, model, provider, isRetry = false) {
  const startTime = Date.now();
  try {
    const res = await axios.post(
      `${API_BASE_URL}/qa/ask`,
      { question, model, llm_provider: provider },
      { timeout: 120000 },
    );
    return {
      success: true,
      answer: res.data?.data?.answer || null,
      answer_type: res.data?.data?.answer_type || null,
      confidence: res.data?.data?.confidence ?? null,
      qa_log_id: res.data?.data?.qa_log_id ?? null,
      response_time_ms: Date.now() - startTime,
      error: null,
    };
  } catch (err) {
    const errorCode = err.response?.data?.error_code;
    if (errorCode === "RATE_LIMITED" && !isRetry) {
      console.log("    (bị rate limit, chờ 20s rồi thử lại 1 lần)");
      await sleep(20000);
      return callAskApi(question, model, provider, true);
    }
    return {
      success: false,
      answer: null,
      answer_type: null,
      confidence: null,
      qa_log_id: null,
      response_time_ms: Date.now() - startTime,
      error: errorCode || err.message,
    };
  }
}

function appendJsonLine(filePath, obj) {
  fs.appendFileSync(filePath, JSON.stringify(obj) + "\n", "utf-8");
}

function readJsonLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs
    .readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

function buildResultRow(q, model, result) {
  return {
    id: q.id,
    category: q.category,
    question: q.question,
    expected_answer: q.expected_answer,
    model,
    llm_provider: LLM_PROVIDER,
    answer_type: result.answer_type,
    answer: result.answer,
    confidence: result.confidence,
    response_time_ms: result.response_time_ms,
    success: result.success,
    error: result.error,
  };
}

// ============ CHẠY 1 MODEL, TRẢ VỀ THỐNG KÊ ============
async function runModel(model, questions, tempJsonlPath) {
  const isLLMModel = model !== "rule_based";
  console.log(
    `\n=== Bắt đầu chạy model: ${model} | provider: ${LLM_PROVIDER} (${questions.length} câu) ===`,
  );
  const startedAt = Date.now();

  if (!isLLMModel) {
    const limit = createLimiter(CONCURRENCY);
    let done = 0;
    await Promise.all(
      questions.map((q) =>
        limit(async () => {
          const result = await callAskApi(q.question, model, LLM_PROVIDER);
          appendJsonLine(tempJsonlPath, buildResultRow(q, model, result));
          done++;
          if (done % 10 === 0 || done === questions.length)
            console.log(`  [${model}] Đã xong ${done}/${questions.length}`);
        }),
      ),
    );
  } else {
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      const result = await callAskApi(q.question, model, LLM_PROVIDER);
      appendJsonLine(tempJsonlPath, buildResultRow(q, model, result));
      if ((i + 1) % 10 === 0 || i + 1 === questions.length)
        console.log(`  [${model}] Đã xong ${i + 1}/${questions.length}`);
      if (i < questions.length - 1) await sleep(REQUEST_DELAY_MS);
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const rows = readJsonLines(tempJsonlPath);
  const stats = {
    provider: LLM_PROVIDER,
    model,
    total_questions: rows.length,
    success_count: rows.filter((r) => r.success).length,
    error_count: rows.filter((r) => !r.success).length,
    answer_rag_generated: rows.filter((r) => r.answer_type === "rag_generated")
      .length,
    answer_structured_lookup: rows.filter(
      (r) => r.answer_type === "structured_lookup",
    ).length,
    answer_no_answer: rows.filter((r) => r.answer_type === "no_answer").length,
    avg_response_time_ms: Math.round(
      rows.reduce((sum, r) => sum + (r.response_time_ms || 0), 0) / rows.length,
    ),
    total_elapsed_sec: elapsedSec,
    timestamp: new Date().toISOString(),
  };

  console.log(
    `=== Hoàn tất model: ${model} | Tổng thời gian: ${elapsedSec}s ===`,
  );
  console.log(
    `    success: ${stats.success_count}/${stats.total_questions} | rag_generated: ${stats.answer_rag_generated} | structured: ${stats.answer_structured_lookup} | no_answer: ${stats.answer_no_answer} | lỗi: ${stats.error_count}`,
  );

  return stats;
}

function convertJsonlToXlsx(jsonlPath, xlsxPath, sheetName) {
  const rows = readJsonLines(jsonlPath);
  const worksheet = XLSX.utils.json_to_sheet(rows);
  worksheet["!cols"] = [
    { wch: 6 },
    { wch: 20 },
    { wch: 45 },
    { wch: 50 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 45 },
    { wch: 12 },
    { wch: 14 },
    { wch: 10 },
    { wch: 20 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
  XLSX.writeFile(workbook, xlsxPath);
}

// Ghi thêm 1 dòng vào bảng tổng hợp - CỘNG DỒN qua nhiều lần chạy để so sánh Gemini vs Cohere
function appendSummaryRows(newRows) {
  let existingRows = [];
  if (fs.existsSync(SUMMARY_PATH)) {
    const wb = XLSX.readFile(SUMMARY_PATH);
    existingRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
  }
  const allRows = [...existingRows, ...newRows];
  const worksheet = XLSX.utils.json_to_sheet(allRows);
  worksheet["!cols"] = [
    { wch: 10 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
    { wch: 12 },
    { wch: 18 },
    { wch: 22 },
    { wch: 14 },
    { wch: 18 },
    { wch: 16 },
    { wch: 22 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Summary");
  XLSX.writeFile(workbook, SUMMARY_PATH);
}

// ============ MAIN ============
async function warmUp() {
  console.log("Đang warm-up model (embedding + rerank)...");
  try {
    await axios.post(
      `${API_BASE_URL}/qa/ask`,
      {
        question: "Phường Bến Nghé cũ giờ là gì?",
        model: "advanced_rag",
        llm_provider: "gemini",
        province_id: 1, // dùng provider bất kỳ, chỉ để load model vào RAM
      },
      { timeout: 120000 },
    ); // timeout dài vì lần đầu luôn chậm nhất (cold start)
  } catch (err) {
    console.log(
      "Warm-up xong (có thể lỗi nhẹ, không sao, mục đích chỉ để load model):",
      err.message,
    );
  }
  console.log("Warm-up hoàn tất. Đợi 5 giây trước khi bắt đầu batch thật...");
  await new Promise((r) => setTimeout(r, 5000));
}

async function run() {
  await warmUp();
  if (!fs.existsSync(TEST_SET_PATH)) {
    console.error(`Không tìm thấy file: ${TEST_SET_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(RESULTS_DIR))
    fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const questions = readTestSet(TEST_SET_PATH);
  console.log(
    `Đã đọc ${questions.length} câu hỏi. Provider lần này: ${LLM_PROVIDER}. Model: ${MODELS_TO_RUN.join(", ")}`,
  );

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const allStats = [];
  const runStartedAt = Date.now();

  for (const model of MODELS_TO_RUN) {
    const tempJsonlPath = path.join(
      RESULTS_DIR,
      `_temp_${LLM_PROVIDER}_${model}_${timestamp}.jsonl`,
    );
    const xlsxPath = path.join(
      RESULTS_DIR,
      `results_${LLM_PROVIDER}_${model}_${timestamp}.xlsx`,
    );

    const stats = await runModel(model, questions, tempJsonlPath);
    allStats.push(stats);

    convertJsonlToXlsx(tempJsonlPath, xlsxPath, model);
    console.log(`Đã lưu: ${xlsxPath}`);

    if (model !== MODELS_TO_RUN[MODELS_TO_RUN.length - 1]) {
      await sleep(DELAY_BETWEEN_MODELS_MS);
    }
  }
  // Thêm trước dòng appendSummaryRows(allStats);
  const backupPath = path.join(
    RESULTS_DIR,
    `_summary_backup_${timestamp}.xlsx`,
  );
  try {
    if (fs.existsSync(SUMMARY_PATH)) {
      fs.copyFileSync(SUMMARY_PATH, backupPath);
    }
  } catch (err) {
    console.warn(
      "Không backup được timing_summary.xlsx (bỏ qua):",
      err.message,
    );
  }
  appendSummaryRows(allStats);

  const totalElapsedSec = ((Date.now() - runStartedAt) / 1000).toFixed(1);
  console.log("\n=== HOÀN TẤT LƯỢT CHẠY NÀY ===");
  console.log(
    `Provider: ${LLM_PROVIDER} | Tổng thời gian toàn bộ: ${totalElapsedSec}s`,
  );
  console.log(
    `Bảng tổng hợp so sánh (cộng dồn qua các lượt chạy): ${SUMMARY_PATH}`,
  );
  console.log(
    "Mở file timing_summary.xlsx để so sánh Gemini (và Cohere nếu chạy thêm).",
  );
}

run();
