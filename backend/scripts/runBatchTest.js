require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const XLSX = require("xlsx");
const { Pool } = require("pg");

// ============ CẤU HÌNH — ĐỔI GIỮA CÁC LƯỢT CHẠY ============
const LLM_PROVIDER = process.env.LLM_PROVIDER_OVERRIDE || "gemini"; // "gemini" | "cohere"
const ALL_MODELS = ["rule_based", "naive_rag", "advanced_rag", "modular_rag"];
// MODELS_OVERRIDE (run_config.ps1) hoặc MODELS_TO_RUN đều được, ví dụ "advanced_rag,modular_rag".
// Không đặt -> chạy đủ 4 model.
const modelsEnv = process.env.MODELS_OVERRIDE || process.env.MODELS_TO_RUN;
const MODELS_TO_RUN = modelsEnv
  ? modelsEnv
      .split(",")
      .map((s) => s.trim())
      .filter((m) => ALL_MODELS.includes(m))
  : ALL_MODELS;
const PROVINCES = {
  HCM: { name: "TP. Hồ Chí Minh", testSet: "test_matrix_HCM.xlsx" },
  AG: { name: "Tỉnh An Giang", testSet: "test_matrix_AG.xlsx" },
  CM: { name: "Tỉnh Cà Mau", testSet: "test_matrix_CM.xlsx" },
  CT: { name: "Thành phố Cần Thơ", testSet: "test_matrix_CT.xlsx" },
  DN: { name: "Tỉnh Đồng Nai", testSet: "test_matrix_DN.xlsx" },
  DT: { name: "Tỉnh Đồng Tháp", testSet: "test_matrix_DT.xlsx" },
  TN: { name: "Tỉnh Tây Ninh", testSet: "test_matrix_TN.xlsx" },
  VL: { name: "Tỉnh Vĩnh Long", testSet: "test_matrix_VL.xlsx" },
};
const PROVINCE_CODE = process.env.PROVINCE;
const PROV = PROVINCES[PROVINCE_CODE];
if (!PROV) {
  console.error(
    `Phải đặt $env:PROVINCE = một trong: ${Object.keys(PROVINCES).join(", ")}.`,
  );
  process.exit(1);
}
const RUN_ID = new Date().toISOString().replace(/[:.]/g, "-");
const PROMPT_VERSION = process.env.PROMPT_VERSION || "v2";
let PROVINCE_ID; // gán trong run()

// Tra id tỉnh trên DB của MÁY NÀY theo mã tỉnh (cột provinces_new.code). Nếu DB chưa có cột code
// hoặc chưa gán mã cho tỉnh này thì tra theo tên (cảnh báo) để không chặn việc chạy batch.
async function resolveProvinceId(code, name) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    let rows = [];
    let hasCodeColumn = true;
    try {
      ({ rows } = await pool.query(
        "SELECT id FROM provinces_new WHERE code = $1",
        [code],
      ));
    } catch (err) {
      if (err.code !== "42703") throw err; // 42703 = cột code chưa tồn tại
      hasCodeColumn = false;
    }
    if (rows.length === 0) {
      console.warn(
        hasCodeColumn
          ? `provinces_new chưa có dòng nào code = "${code}" -> tra theo tên "${name}".`
          : `provinces_new chưa có cột code -> tra theo tên "${name}".`,
      );
      ({ rows } = await pool.query(
        "SELECT id FROM provinces_new WHERE name = $1",
        [name.normalize("NFC")],
      ));
    }
    if (rows.length !== 1) {
      const all = await pool.query(
        "SELECT id, name FROM provinces_new ORDER BY id",
      );
      console.error(
        `Tìm thấy ${rows.length} dòng cho ${code} / "${name}". Các tỉnh trong DB:`,
      );
      console.table(all.rows);
      process.exit(1);
    }
    return rows[0].id;
  } finally {
    await pool.end();
  }
}
const TEST_SET_PATH =
  process.env.TEST_SET_PATH || path.join(__dirname, "../data", PROV.testSet);
const QUESTION_START = process.env.QUESTION_START
  ? Number(process.env.QUESTION_START)
  : null;
const QUESTION_END = process.env.QUESTION_END
  ? Number(process.env.QUESTION_END)
  : null;

const API_BASE_URL = "http://localhost:3000/api/v1";
// RESULTS_ROOT (đường dẫn tuyệt đối) có ưu tiên cao nhất.
// Nếu không, RESULTS_TAG="m3_safe" -> ghi vào ../data/batch_results/m3_safe (không đè official_batch).
const RESULTS_ROOT = process.env.RESULTS_ROOT
  ? path.resolve(process.env.RESULTS_ROOT)
  : path.join(
      __dirname,
      "../data/batch_results",
      process.env.RESULTS_TAG || "official_batch",
    );
const RESULTS_DIR = path.join(RESULTS_ROOT, PROVINCE_CODE); // kết quả tách theo tỉnh
const SUMMARY_PATH = path.join(RESULTS_ROOT, "timing_summary.xlsx"); // 1 file tổng hợp chung mọi tỉnh

const CONCURRENCY = 4; // chỉ áp dụng cho rule_based (không gọi AI)

// concurrency=3 cho naive_rag từng chạy sạch 1 lần (22/9, 0 lỗi) nhưng lần
// khác lại gây 429 hàng loạt — tức bản thân số concurrency không phải chốt
// chặn thật sự, giới hạn RPM mới là chốt chặn thật.
//
// Cohere: CHƯA CÓ DỮ LIỆU THẬT ở quy mô 161 câu (mới pilot 30 câu), nên cấu
// hình cố tình THẬN TRỌNG hơn Gemini — gần như tuần tự. Chỉ nới ra (tăng
// concurrency/RPM) sau khi 1 lượt full chạy sạch không có RATE_LIMITED.
const PROVIDER_PROFILES = {
  gemini: {
    concurrency: { naive_rag: 2, advanced_rag: 2, modular_rag: 4 },
    rpm: { naive_rag: 12, advanced_rag: 6, modular_rag: 20 },
  },
  cohere: {
    concurrency: { naive_rag: 1, advanced_rag: 1, modular_rag: 2 },
    rpm: { naive_rag: 8, advanced_rag: 4, modular_rag: 12 },
  },
};

if (!PROVIDER_PROFILES[LLM_PROVIDER]) {
  console.error(
    `LLM_PROVIDER "${LLM_PROVIDER}" không hợp lệ. Chọn 1 trong: ${Object.keys(PROVIDER_PROFILES).join(", ")}`,
  );
  process.exit(1);
}

function getConcurrency(model) {
  return PROVIDER_PROFILES[LLM_PROVIDER]?.concurrency[model] || 1;
}
function getRateLimitRpm(model) {
  return PROVIDER_PROFILES[LLM_PROVIDER]?.rpm[model] || 8;
}

const DELAY_BETWEEN_MODELS_MS = 5000;

// ============ ĐỌC BỘ CÂU HỎI TỪ FILE XLSX ============
function readTestSet(filePath) {
  const workbook = XLSX.readFile(filePath);

  const sheetName =
    workbook.SheetNames.find((n) => n.startsWith("TestCases")) ||
    workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error("Không tìm thấy sheet TestCases trong test set.");
  // const sheet = workbook.Sheets["PilotSet"]; // thay vì "TestCases_150"

  if (!sheet) {
    throw new Error("Không tìm thấy sheet 'TestCases_150' trong test set.");
  }
  // if (!sheet) {
  //   throw new Error("Không tìm thấy sheet 'PilotSet' trong file pilot.");
  // }

  const rows = XLSX.utils.sheet_to_json(sheet);

  return rows.map((row) => ({
    id: row.test_id,
    test_id: row.test_id,

    category: row.category,

    question: row.question,

    expected_answer: row.expected_answer,

    // Không phải field gốc của Test Matrix, nhưng runner cũ cần field này.
    expected_branch: inferExpectedBranch(row.category),

    source_doc: "1685/NQ-UBTVQH15",

    verified_by_team: "chua_duyet",

    // ===== Các field mới, giữ lại để đánh giá sau =====
    old_unit_name: row.old_unit_name || "",
    old_parent: row.old_parent || "",
    expected_count: row.expected_count ?? "",
    must_contain: row.must_contain || "",
    must_not_contain: row.must_not_contain || "",
    difficulty: row.difficulty || "",
    golden: row.golden || "NO",
    notes: row.notes || "",
  }));
}

function inferExpectedBranch(category) {
  switch (category) {
    case "T1_1_to_1":
    case "T2_1_to_N":
    case "T4_mot_phan":
      return "structured";

    case "T3_N_to_1":
    case "T5_new_to_old":
    case "T6_count":
      return "structured_or_hybrid";

    case "T7_typo_no_diacritic":
      return "structured_or_hybrid";

    case "T8_ambiguous":
      return "structured_or_hybrid";

    case "T8_out_of_scope":
      return "no_answer";

    default:
      return "";
  }
}

// ============ SIMPLE CONCURRENCY LIMITER ============
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

// ============ RATE LIMITER THEO REQUEST/PHÚT ============
// Khác với createLimiter (giới hạn số request ĐANG chạy song song), hàm này
// giới hạn NHỊP KHỞI request mới — đúng thứ RPM của provider thật sự kiểm
// soát. Nhiều request vẫn có thể đang "in-flight" cùng lúc, nhưng thời điểm
// BẮT ĐẦU của mỗi request được giãn đều theo đúng requestsPerMinute.
function createRateLimiter(requestsPerMinute) {
  const minIntervalMs = 60000 / requestsPerMinute;
  let nextSlot = Date.now();
  return function schedule(fn) {
    const myTurn = Math.max(nextSlot, Date.now());
    nextSlot = myTurn + minIntervalMs;
    const waitMs = myTurn - Date.now();
    return (waitMs > 0 ? sleep(waitMs) : Promise.resolve()).then(fn);
  };
}

// ============ GỌI API 1 CÂU HỎI (có retry nếu bị rate limit / service bận) ============
async function callAskApi(question, model, provider, provinceId, attempt = 0) {
  if (provinceId == null) {
    throw new Error("callAskApi thiếu provinceId");
  }
  const MAX_RETRIES = 3;
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
      qa_log_id: res.data?.data?.qa_log_id ?? null,
      input_tokens: res.data?.data?.input_tokens ?? null,
      output_tokens: res.data?.data?.output_tokens ?? null,
      response_time_ms: Date.now() - startTime,
      error: null,
    };
  } catch (err) {
    const errorCode = err.response?.data?.error_code;
    if (errorCode === "RATE_LIMITED" && attempt < MAX_RETRIES) {
      const retryAfterMs = err.response?.data?.retry_after_ms;
      const waitMs = retryAfterMs || 20000 * Math.pow(2, attempt);
      console.log(
        `    (bị rate limit, chờ ${Math.round(waitMs / 1000)}s, thử lại lần ${attempt + 1}/${MAX_RETRIES})`,
      );
      await sleep(waitMs);
      return callAskApi(question, model, provider, provinceId, attempt + 1);
    }
    // SERVICE_UNAVAILABLE thường là embedding/rerank service cục bộ (FastAPI,
    // 1 worker đồng bộ) bị nghẽn tạm thời khi nhiều request chạy đồng thời,
    // KHÔNG phải lỗi vĩnh viễn như rate limit thật. Chờ ngắn hơn.
    if (errorCode === "SERVICE_UNAVAILABLE" && attempt < MAX_RETRIES) {
      const waitMs = 5000 * (attempt + 1);
      console.log(
        `    (service cục bộ bận, chờ ${Math.round(waitMs / 1000)}s, thử lại lần ${attempt + 1}/${MAX_RETRIES})`,
      );
      await sleep(waitMs);
      return callAskApi(question, model, provider, provinceId, attempt + 1);
    }
    return {
      success: false,
      answer: null,
      answer_type: null,
      confidence: null,
      qa_log_id: null,
      input_tokens: null,
      output_tokens: null,
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

function normalizeAnswerText(s) {
  if (!s) return s;
  return s.replace(/[\u00a0\u202f\u2009\u2007\u2002\u2003]/g, " ");
}

function countAdminUnitMentions(answerText) {
  if (!answerText) return 0;
  // Cắt bỏ phần "theo <số nghị quyết>" để không đếm nhầm số hiệu văn bản
  const mainPart = answerText.split(/,?\s*theo\s+/i)[0];
  // LƯU Ý: không dùng \b quanh "và"/"cộng với" — \b của JS chỉ nhận biết
  // ký tự ASCII [A-Za-z0-9_], nên với từ có dấu (à, ộ...) \b không khớp
  // đúng ranh giới từ. Tách theo khoảng trắng bao quanh thay vì word-boundary.
  const segments = mainPart.split(/,|\s+và\s+|\s+cộng với\s+/i);
  const unitRegex = /^(Phường|Xã|Thị trấn|Đặc khu)\s+\S.*$/i;
  const names = segments.map((s) => s.trim()).filter((s) => unitRegex.test(s));
  return new Set(names.map((s) => s.toLowerCase())).size;
}

function evaluateAnswer(q, result) {
  if (!result.success) {
    return {
      pass: null,
      reason: "API_ERROR",
    };
  }

  const answer = normalizeAnswerText(result.answer || "").toLowerCase();

  // ===== Out of scope =====
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

  // ===== Ambiguous =====
  if (q.category === "T8_ambiguous") {
    // Chỉ tính là PASS khi câu trả lời THỰC SỰ yêu cầu làm rõ. Không dùng riêng
    // "quận"/"huyện" vì câu trả lời đã chốt một đơn vị cũng nhắc tên quận/huyện.
    const CLARIFY_PHRASES = [
      "nhiều đơn vị",
      "cho biết cụ thể",
      "vui lòng cho biết",
      "làm rõ",
      "bổ sung thông tin",
      "chưa đủ thông tin",
    ];
    const asksForContext = CLARIFY_PHRASES.some((p) => answer.includes(p));

    return {
      pass: asksForContext,
      reason: asksForContext ? "PASS" : "DID_NOT_DISAMBIGUATE",
    };
  }

  // ===== Count (T6) =====
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

  // ===== must_contain =====
  const required = (q.must_contain || "")
    .split("|")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  const missing = required.filter((item) => !answer.includes(item));

  if (missing.length > 0) {
    return {
      pass: false,
      reason: "MISSING_ENTITY",
      missing,
    };
  }

  // ===== must_not_contain =====
  const forbidden = (q.must_not_contain || "")
    .split("|")
    .map((x) => x.trim().toLowerCase())
    .filter(Boolean);

  const foundForbidden = forbidden.filter((item) => answer.includes(item));

  if (foundForbidden.length > 0) {
    return {
      pass: false,
      reason: "FORBIDDEN_ENTITY",
      foundForbidden,
    };
  }

  return {
    pass: true,
    reason: "PASS",
  };
}

function buildResultRow(q, model, result) {
  const evaluation = evaluateAnswer(q, result);

  return {
    id: q.id,
    test_id: q.test_id,
    category: q.category,

    old_unit_name: q.old_unit_name,
    old_parent: q.old_parent,

    question: q.question,
    expected_answer: q.expected_answer,
    expected_count: q.expected_count,

    must_contain: q.must_contain,
    must_not_contain: q.must_not_contain,

    model,
    llm_provider: LLM_PROVIDER,
    province_code: PROVINCE_CODE,
    province_id: PROVINCE_ID,

    answer_type: result.answer_type,
    answer: result.answer,
    confidence: result.confidence,
    response_time_ms: result.response_time_ms,

    // null = câu không gọi LLM (rule_based, modular nhánh structured) hoặc lỗi
    input_tokens: result.input_tokens ?? null,
    output_tokens: result.output_tokens ?? null,
    total_tokens:
      result.input_tokens == null && result.output_tokens == null
        ? null
        : (result.input_tokens ?? 0) + (result.output_tokens ?? 0),

    success: result.success,
    error: result.error,

    // ===== EVALUATION =====
    pass: evaluation.pass,
    evaluation_reason: evaluation.reason || "",
    missing_items: (evaluation.missing || []).join(" | "),
    forbidden_items: (evaluation.foundForbidden || []).join(" | "),

    difficulty: q.difficulty,
    golden: q.golden,
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
          const result = await callAskApi(
            q.question,
            model,
            LLM_PROVIDER,
            PROVINCE_ID,
          );
          appendJsonLine(tempJsonlPath, buildResultRow(q, model, result));
          done++;
          if (done % 10 === 0 || done === questions.length)
            console.log(`  [${model}] Đã xong ${done}/${questions.length}`);
        }),
      ),
    );
  } else {
    // Chạy song song có giới hạn, kiểm soát bằng 3 lớp:
    // (1) createLimiter: không quá N request chạy đồng thời
    // (2) createRateLimiter: không quá M request KHỞI ĐỘNG mỗi phút
    // (3) circuit breaker: nếu >=8/10 lần hoàn thành GẦN NHẤT đều lỗi, dừng
    //     lên lịch các câu còn lại. Cần thiết vì đã quan sát thấy Cohere hết
    //     quota rồi chạy tiếp 100+ câu lỗi liên tục vô ích.
    const limit = createLimiter(getConcurrency(model));
    const throttle = createRateLimiter(getRateLimitRpm(model));
    const CIRCUIT_BREAKER_WINDOW = 10;
    const CIRCUIT_BREAKER_ERROR_THRESHOLD = 8;
    let recentResults = []; // true = thành công, false = lỗi
    let circuitOpen = false;
    let done = 0;
    let skipped = 0;
    await Promise.all(
      questions.map((q) =>
        limit(() =>
          throttle(async () => {
            if (circuitOpen) {
              skipped++;
              return;
            }
            const result = await callAskApi(
              q.question,
              model,
              LLM_PROVIDER,
              PROVINCE_ID,
            );
            appendJsonLine(tempJsonlPath, buildResultRow(q, model, result));
            done++;

            recentResults.push(result.success);
            if (recentResults.length > CIRCUIT_BREAKER_WINDOW)
              recentResults.shift();
            const recentErrorCount = recentResults.filter((s) => !s).length;
            if (
              !circuitOpen &&
              recentResults.length === CIRCUIT_BREAKER_WINDOW &&
              recentErrorCount >= CIRCUIT_BREAKER_ERROR_THRESHOLD
            ) {
              circuitOpen = true;
              console.error(
                `\n!!! DỪNG SỚM [${model}]: ${recentErrorCount}/${CIRCUIT_BREAKER_WINDOW} câu gần nhất đều lỗi ` +
                  `(lỗi gần nhất: ${result.error}). Khả năng cao quota cạn/key sai — ` +
                  `KIỂM TRA TRƯỚC KHI CHẠY TIẾP. Các câu chưa xử lý sẽ bị bỏ qua (không ` +
                  `tính vào file kết quả), không phải lỗi — chạy lại sau khi khắc phục.`,
              );
            }

            if (done % 10 === 0 || done === questions.length)
              console.log(`  [${model}] Đã xong ${done}/${questions.length}`);
          }),
        ),
      ),
    );
    if (skipped > 0) {
      console.log(
        `  [${model}] Đã bỏ qua ${skipped} câu do circuit breaker dừng sớm.`,
      );
    }
  }

  const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
  const rows = readJsonLines(tempJsonlPath);
  const elapsed = Number(((Date.now() - startedAt) / 1000).toFixed(1));
  // Chỉ tính các câu CÓ gọi LLM (token != null); câu structured/no-LLM không kéo trung bình xuống 0
  const llmRows = rows.filter(
    (r) => r.input_tokens != null || r.output_tokens != null,
  );
  const sumTok = (key) => llmRows.reduce((sum, r) => sum + (r[key] || 0), 0);
  const stats = {
    run_id: RUN_ID,
    prompt_version: PROMPT_VERSION,
    provider: LLM_PROVIDER,
    province_code: PROVINCE_CODE,
    province_name: PROV.name,
    province_id: PROVINCE_ID,
    model,
    total_questions: rows.length,
    success_count: rows.filter((r) => r.success).length,
    error_count: rows.filter((r) => !r.success).length,
    pass_count: rows.filter((r) => r.pass === true).length,
    valid_count: rows.filter((r) => r.pass !== null).length,
    answer_rag_generated: rows.filter((r) => r.answer_type === "rag_generated")
      .length,
    answer_structured_lookup: rows.filter(
      (r) => r.answer_type === "structured_lookup",
    ).length,
    answer_no_answer: rows.filter((r) => r.answer_type === "no_answer").length,
    avg_response_time_ms: Math.round(
      rows.reduce((sum, r) => sum + (r.response_time_ms || 0), 0) / rows.length,
    ),
    total_elapsed_sec: elapsed,
    llm_call_questions: llmRows.length,
    avg_input_tokens: llmRows.length
      ? Math.round(sumTok("input_tokens") / llmRows.length)
      : null,
    avg_output_tokens: llmRows.length
      ? Math.round(sumTok("output_tokens") / llmRows.length)
      : null,
    total_input_tokens: sumTok("input_tokens"),
    total_output_tokens: sumTok("output_tokens"),
    total_tokens: sumTok("input_tokens") + sumTok("output_tokens"),
    timestamp: new Date().toISOString(),
  };

  console.log(
    `=== Hoàn tất model: ${model} | Tổng thời gian: ${elapsedSec}s ===`,
  );
  console.log(
    `    pass THẬT (đã loại API_ERROR): ${stats.pass_count}/${stats.valid_count} | success: ${stats.success_count}/${stats.total_questions} | rag_generated: ${stats.answer_rag_generated} | structured: ${stats.answer_structured_lookup} | no_answer: ${stats.answer_no_answer} | lỗi: ${stats.error_count}`,
  );
  console.log(
    `    token: ${stats.llm_call_questions} câu gọi LLM | TB input: ${stats.avg_input_tokens ?? "-"} | TB output: ${stats.avg_output_tokens ?? "-"} | tổng: ${stats.total_tokens}`,
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

// Ghi thêm dòng vào bảng tổng hợp - CỘNG DỒN qua nhiều lần chạy để so sánh Gemini vs Cohere
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
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 18 },
    { wch: 18 },
    { wch: 14 },
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Summary");
  XLSX.writeFile(workbook, SUMMARY_PATH);
}

// ============ MAIN ============
async function waitForBackendReady(maxWaitMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    try {
      const r = await axios.get(`${API_BASE_URL}/health`, { timeout: 3000 });
      if (r.status === 200) return;
    } catch (_) {}
    await sleep(2000);
  }
  console.error("Backend không sẵn sàng sau 60s. Dừng batch.");
  process.exit(1);
}

async function warmUp() {
  await waitForBackendReady();
  console.log("Đang warm-up model (embedding + rerank)...");
  try {
    await axios.post(
      `${API_BASE_URL}/qa/ask`,
      {
        question: "Phường Bến Nghé cũ giờ là gì?",
        model: "advanced_rag",
        llm_provider: LLM_PROVIDER,
        province_id: PROVINCE_ID,
      },
      { timeout: 120000 },
    );
  } catch (err) {
    console.log("Warm-up lỗi nhẹ (chỉ để load model):", err.message);
  }
  await sleep(5000);
}

async function run() {
  PROVINCE_ID = await resolveProvinceId(PROVINCE_CODE, PROV.name);
  console.log(
    `${PROVINCE_CODE} (${PROV.name}) -> provinces_new.id = ${PROVINCE_ID} trên DB này`,
  );
  await warmUp();
  if (!fs.existsSync(TEST_SET_PATH)) {
    console.error(`Không tìm thấy file: ${TEST_SET_PATH}`);
    process.exit(1);
  }
  if (!fs.existsSync(RESULTS_DIR))
    fs.mkdirSync(RESULTS_DIR, { recursive: true });

  const allQuestions = readTestSet(TEST_SET_PATH);
  const questions =
    QUESTION_START !== null && QUESTION_END !== null
      ? allQuestions.slice(QUESTION_START, QUESTION_END)
      : allQuestions;

  if (QUESTION_START !== null || QUESTION_END !== null) {
    console.log(
      `CHẠY 1 PHẦN: câu ${QUESTION_START ?? 0} - ${QUESTION_END ?? allQuestions.length} (trong tổng ${allQuestions.length} câu).`,
    );
  }
  console.log(
    `Đã đọc ${questions.length} câu hỏi (tổng bộ test: ${allQuestions.length}). Provider: ${LLM_PROVIDER}. Model: ${MODELS_TO_RUN.join(", ")}`,
  );

  const timestamp = RUN_ID;
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
    fs.unlinkSync(tempJsonlPath);

    if (model !== MODELS_TO_RUN[MODELS_TO_RUN.length - 1]) {
      await sleep(DELAY_BETWEEN_MODELS_MS);
    }
  }
  const totalElapsedSec = Number(
    ((Date.now() - runStartedAt) / 1000).toFixed(1),
  );
  allStats.forEach((s) => (s.run_total_elapsed_sec = totalElapsedSec));
  appendSummaryRows(allStats);

  console.log("\n=== HOÀN TẤT LƯỢT CHẠY NÀY ===");
  console.log(
    `Provider: ${LLM_PROVIDER} | Tổng thời gian toàn bộ: ${totalElapsedSec}s`,
  );
  console.log(
    `Bảng tổng hợp so sánh (cộng dồn qua các lượt chạy): ${SUMMARY_PATH}`,
  );
  console.log("Mở file timing_summary.xlsx để so sánh Gemini và Cohere.");
}

run();
