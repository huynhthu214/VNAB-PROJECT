const { safeRewrite } = require("../../safeRewrite");
const pool = require("../config/db");
const { success, fail } = require("../utils/response");
const { parseLegalRef, legalSuffix } = require("../utils/legalRef");
const axios = require("axios");
const {
  callLLM,
  PROVIDERS,
  ServiceUnavailableError,
  RateLimitError,
  isConnectionError,
} = require("../services/llmProviders");

const fs = require("fs");
function debugLog(entry) {
  if (process.env.DEBUG_PROMPT_LOG !== "1") return;
  fs.appendFileSync("prompt_debug.jsonl", JSON.stringify(entry) + "\n");
}

function uniqueSourcesFrom(rows) {
  return [
    ...new Map(
      rows.map((r) => {
        const s = buildSource(r);
        return [`${s.document_id}|${s.section}`, s];
      }),
    ).values(),
  ];
}

function buildSource(row) {
  const { dieu, khoan } = parseLegalRef(row);
  return {
    document_id: row.doc_code || null,
    title: row.doc_title || null,
    section:
      [dieu && `Điều ${dieu}`, khoan && `Khoản ${khoan}`]
        .filter(Boolean)
        .join(", ") || null,
    source_url: row.source_url || null,
  };
}

async function getEmbedding(text) {
  try {
    const res = await axios.post(
      "http://localhost:8001/embed",
      { text },
      { timeout: 30000 },
    );
    return res.data.embedding;
  } catch (err) {
    if (isConnectionError(err)) {
      throw new ServiceUnavailableError("Không kết nối được service embedding");
    }
    throw err;
  }
}

async function rewriteQuestion(question, provider = "gemini") {
  const systemPrompt = `Bạn là trợ lý chuẩn hóa câu hỏi tiếng Việt về địa giới hành chính.
Viết lại câu hỏi sau cho rõ nghĩa hơn: sửa lỗi chính tả, thêm dấu tiếng Việt nếu thiếu,
làm rõ ý mơ hồ. GIỮ NGUYÊN Ý GỐC, không thêm thông tin không có trong câu hỏi.

TUYỆT ĐỐI KHÔNG được đổi CẤP hành chính đang được hỏi. Nếu câu gốc hỏi
đơn vị này "thuộc/chia thành những ĐƠN VỊ HÀNH CHÍNH (phường/xã) nào",
câu viết lại PHẢI vẫn hỏi ở cấp phường/xã — không được đổi thành hỏi
"thuộc TỈNH/THÀNH PHỐ nào". Chỉ đổi cấp hỏi khi câu gốc tự nó đã hỏi ở
cấp tỉnh/thành.

Chỉ trả về câu hỏi đã viết lại, không giải thích gì thêm.`;

  const { text, input_tokens, output_tokens } = await callLLM(
    provider,
    systemPrompt,
    question,
  );
  return {
    rewritten: text?.trim() || question,
    input_tokens: input_tokens ?? 0,
    output_tokens: output_tokens ?? 0,
  };
}

async function rerankChunks(question, chunks, topK = 5) {
  try {
    const res = await axios.post(
      "http://localhost:8001/rerank",
      {
        query: question,
        documents: chunks.map((c) => c.content),
      },
      { timeout: 90000 },
    );
    const { scores } = res.data;
    return chunks
      .map((c, i) => ({ ...c, rerank_score: scores[i] }))
      .sort((a, b) => b.rerank_score - a.rerank_score)
      .slice(0, topK);
  } catch (err) {
    if (isConnectionError(err)) {
      throw new ServiceUnavailableError("Không kết nối được rerank service");
    }
    throw err;
  }
}

async function logQa(
  sessionId,
  question,
  answer,
  answerType,
  modelUsed,
  llmProvider,
  routingDecision,
  confidence,
  responseTimeMs,
  rewrittenQuestion = null,
  rerankTopScore = null,
  inputTokens = null,
  outputTokens = null,
) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO qa_logs (session_id, question, answer, answer_type, model_used, llm_provider, routing_decision, confidence, response_time_ms, rewritten_question, rerank_top_score, input_tokens, output_tokens)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
   RETURNING id`,
      [
        sessionId || null,
        question,
        answer,
        answerType,
        modelUsed,
        llmProvider,
        routingDecision,
        confidence,
        responseTimeMs,
        rewrittenQuestion,
        rerankTopScore,
        inputTokens,
        outputTokens,
      ],
    );
    return rows[0].id;
  } catch (err) {
    console.error("Lỗi ghi qa_logs:", err);
    return null;
  }
}
// ============ MODEL 1: RULE-BASED (structured lookup) ============
// Nhận diện câu hỏi đang hỏi theo chiều "mới -> cũ" (hình thành từ, gồm những đơn vị...)
// để ưu tiên gọi tryNewUnitMatch trước, tránh trường hợp tên đơn vị mới trùng tên
// 1 đơn vị cũ thành phần (VD "Phường Bến Thành") khiến tryOldUnitMatch trả lời nhầm chiều.
function isAggregationIntent(question) {
  const q = NORMALIZE_VN ? stripVN(question) : question.toLowerCase();
  const has = (kw) => q.includes(NORMALIZE_VN ? stripVN(kw) : kw);
  return (
    has("được hình thành từ") ||
    has("hình thành từ") ||
    has("sáp nhập từ") ||
    has("được sắp xếp từ") ||
    has("gồm những đơn vị") ||
    (has("trước sắp xếp") && has("gồm"))
  );
}

// ============ MỚI: chặn false-positive structured lookup ============
// Vấn đề đã phát hiện qua thực nghiệm (Chương 4): tryOldUnitMatch/tryNewUnitMatch
// so khớp SUBSTRING tên đơn vị trong câu hỏi, không xét ý định câu hỏi. Nên câu
// như "Giá đất của Phường 1 hiện nay là bao nhiêu?" khớp "Phường 1" và bị trả lời
// nhầm bằng thông tin sáp nhập, dù câu hỏi thực chất về giá đất (ngoài phạm vi).
// Đây LÀ danh sách CHẶN theo chủ đề rõ ràng KHÔNG liên quan ánh xạ hành chính,
// không phải danh sách YÊU CẦU — cách này an toàn hơn (ít rủi ro chặn nhầm câu
// hỏi hợp lệ) so với việc bắt buộc câu hỏi phải chứa từ khoá "thuộc/sáp nhập/...",
// vì bộ câu hỏi kiểm thử có nhiều cách diễn đạt (kể cả không dấu ở nhóm T7) mà ta
// không kiểm soát hết được.
const OUT_OF_SCOPE_TOPIC_KEYWORDS = [
  "giá đất",
  "giá nhà",
  "giá bất động sản",
  "bất động sản",
  "trường đại học",
  "trường học",
  "trường cấp",
  "bệnh viện",
  "thời tiết",
  "dân số",
  "gdp",
  "kinh tế",
  "giá vàng",
  "giá xăng",
  "quán ăn",
  "món ăn",
  "du lịch",
  "khách sạn",
  "tuyển sinh",
];

function isLikelyOutOfScopeTopic(question) {
  const q = NORMALIZE_VN ? stripVN(question) : question.toLowerCase();
  return OUT_OF_SCOPE_TOPIC_KEYWORDS.some((kw) =>
    q.includes(NORMALIZE_VN ? stripVN(kw) : kw),
  );
}

// Gộp logic chạy 3 hàm structured lookup theo đúng thứ tự ưu tiên (dùng
// chung cho Model 1 và nhánh structured của Model 4 — trước đây 2 nơi
// lặp lại y hệt đoạn code này, giờ gộp về 1 chỗ để tránh lệch nhau khi sửa).
// Thí nghiệm M1+/M4+ (việc 5): bật bằng NORMALIZE_VN=true, mặc định tắt.
const NORMALIZE_VN = process.env.NORMALIZE_VN === "true";
console.log("NORMALIZE_VN =", NORMALIZE_VN);

function stripVN(s) {
  return String(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase();
}

// "Thị xã Bình Minh" chứa chuỗi "xã Bình Minh". Nếu tên xã chỉ xuất hiện trong cụm "thị xã ..." thì không tính.
function onlyInsideThiXa(qNorm, oldName) {
  const n = stripVN(oldName);
  if (!n.startsWith("xa ")) return false;
  let from = 0;
  let found = false;
  for (;;) {
    const i = qNorm.indexOf(n, from);
    if (i === -1) break;
    found = true;
    if (qNorm.slice(Math.max(0, i - 4), i) !== "thi ") return false; // có một lần xuất hiện đứng riêng
    from = i + 1;
  }
  return found;
}
async function runStructuredLookup(question, provinceId) {
  if (isLikelyOutOfScopeTopic(question)) return null;
  const { canonicalizeQuestion } = require("../utils/lookupNormalize");

  async function runStructuredLookup(
    question,
    provinceId,
    modelName = "rule_based",
  ) {
    if (isLikelyOutOfScopeTopic(question)) return null;
    const aggIntent = isAggregationIntent(question);
    const on = (process.env.LOOKUP_NORMALIZE || "")
      .split(",")
      .map((s) => s.trim());
    const q = on.includes(modelName)
      ? await canonicalizeQuestion(pool, question)
      : question;
    return aggIntent
      ? (await tryNewUnitMatch(q, provinceId)) ||
          (await tryOldUnitMatch(q, provinceId)) ||
          (await tryOldProvinceMatch(q))
      : (await tryOldUnitMatch(q, provinceId)) ||
          (await tryNewUnitMatch(q, provinceId)) ||
          (await tryOldProvinceMatch(q));
  }

  async function tryOldUnitMatch(question, provinceId = null) {
    const run = (col, param) =>
      pool.query(
        `SELECT o.id AS old_id, o.name AS old_name, o.name_norm, o.parent_name, o.province_old,
              n.name AS new_name, n.province_new_id, pn.name AS new_province_name,
              m.merge_type, m.article_no, m.clause_no, m.point_no,
              d.doc_code, d.title AS doc_title, d.source_url, m.notes
       FROM admin_units_old o
       JOIN unit_mapping m ON m.old_unit_id = o.id
       JOIN admin_units_new n ON n.id = m.new_unit_id
       JOIN provinces_new pn ON pn.id = n.province_new_id
       LEFT JOIN legal_documents d ON d.id = m.decision_document_id
       WHERE $1 ILIKE '%' || ${col} || '%'
       ORDER BY length(o.name) DESC`,
        [param],
      );

    let res = await run("o.name", question); // lượt 1: khớp có dấu, như cũ
    let usedNorm = false;
    const qNorm = NORMALIZE_VN ? stripVN(question) : null;
    if (NORMALIZE_VN && res.rows.length === 0) {
      res = await run("o.name_norm", qNorm); // lượt 2: câu hỏi mất dấu
      usedNorm = true;
    }
    let rows = res.rows;
    if (NORMALIZE_VN)
      rows = rows.filter((r) => !onlyInsideThiXa(qNorm, r.old_name));
    if (rows.length === 0) return null;

    // Lượt 2: nhiều tên khác nhau chỉ ở dấu (Tân Quý / Tân Quy) cùng khớp -> giữ cả nhóm để xét mơ hồ,
    // không được chọn lặng lẽ một tên.
    const keyOf = (r) => (usedNorm ? r.name_norm : r.old_name);
    const bestOldName = rows[0].old_name;
    let sameNameRows = rows.filter((r) => keyOf(r) === keyOf(rows[0]));

    if (provinceId) {
      const inScope = sameNameRows.filter(
        (r) => r.province_new_id === provinceId,
      );
      if (inScope.length === 0) {
        const otherProvinces = [
          ...new Set(sameNameRows.map((r) => r.new_province_name)),
        ];
        return {
          answer: `Không tìm thấy "${bestOldName}" trong phạm vi tỉnh/thành đang chọn. Có đơn vị cùng tên thuộc: ${otherProvinces.join(", ")}. Vui lòng chuyển sang tab tương ứng để tra cứu.`,
          answer_type: "structured_lookup",
          answer_level: "unit",
          model_used: "rule_based",
          confidence: 0.5,
          sources: [],
          suggested_provinces: [
            ...new Set(sameNameRows.map((r) => r.province_new_id)),
          ],
        };
      }
      sameNameRows = inScope;
    }

    let distinctOldIds = [...new Set(sameNameRows.map((r) => r.old_id))];

    if (distinctOldIds.length > 1) {
      const questionLower = NORMALIZE_VN ? qNorm : question.toLowerCase();
      const filteredByParent = sameNameRows.filter(
        (r) =>
          r.parent_name &&
          questionLower.includes(
            NORMALIZE_VN ? stripVN(r.parent_name) : r.parent_name.toLowerCase(),
          ),
      );
      const filteredDistinctIds = [
        ...new Set(filteredByParent.map((r) => r.old_id)),
      ];
      if (filteredDistinctIds.length === 1) {
        sameNameRows = filteredByParent;
        distinctOldIds = filteredDistinctIds;
      }
    }

    if (distinctOldIds.length > 1) {
      const options = distinctOldIds.map((id) => {
        const r = sameNameRows.find((x) => x.old_id === id);
        return `${r.old_name} thuộc ${r.parent_name}, ${r.province_old}`;
      });
      return {
        answer: `Có nhiều đơn vị hành chính cùng tên "${bestOldName}" ở các khu vực khác nhau: ${options.join("; ")}. Vui lòng cho biết cụ thể thuộc quận/huyện nào để tra cứu chính xác.`,
        answer_type: "structured_lookup",
        answer_level: "unit",
        model_used: "rule_based",
        confidence: 0.6,
        sources: [],
      };
    }

    const matched = sameNameRows;
    let answer;
    if (matched.length === 1) {
      const r = matched[0];
      answer = `${r.old_name} (cũ) hiện nay thuộc ${r.new_name}${legalSuffix([r])}.`;
    } else {
      const newNames = matched.map((r) => r.new_name).join(", ");
      answer = `${matched[0].old_name} (cũ) không nhập trọn vào 1 nơi mà được chia làm ${matched.length} phần: ${newNames}${legalSuffix(matched)}.`;
    }

    return {
      answer,
      answer_type: "structured_lookup",
      answer_level: "unit",
      model_used: "rule_based",
      confidence: 0.95,
      sources: uniqueSourcesFrom(matched),
    };
  }

  async function tryNewUnitMatch(question, provinceId = null) {
    const run = (col, param) =>
      pool.query(
        `SELECT n.name AS new_name, n.name_norm, n.province_new_id, pn.name AS new_province_name,
              o.name AS old_name, o.parent_name, m.merge_type,
              d.doc_code, d.title AS doc_title, d.source_url, m.notes,
              m.article_no, m.clause_no, m.point_no
       FROM admin_units_new n
       JOIN provinces_new pn ON pn.id = n.province_new_id
       JOIN unit_mapping m ON m.new_unit_id = n.id
       JOIN admin_units_old o ON o.id = m.old_unit_id
       LEFT JOIN legal_documents d ON d.id = m.decision_document_id
       WHERE $1 ILIKE '%' || ${col} || '%'
       ORDER BY length(n.name) DESC, (o.name LIKE 'Thị trấn%' OR o.name LIKE 'Phường%') DESC, o.name`,
        [param],
      );

    let res = await run("n.name", question);
    let usedNorm = false;
    if (NORMALIZE_VN && res.rows.length === 0) {
      res = await run("n.name_norm", stripVN(question));
      usedNorm = true;
    }
    const rows = res.rows;
    if (rows.length === 0) return null;

    const keyOf = (r) => (usedNorm ? r.name_norm : r.new_name);
    const bestNewName = rows[0].new_name;
    let matched = rows.filter((r) => keyOf(r) === keyOf(rows[0]));

    // ====== MỚI: lọc theo tab tỉnh, hoặc phát hiện trùng tên đa tỉnh ======
    // Đây là chỗ từng gây lỗi nghiêm trọng: tên đơn vị mới trùng nhau giữa các
    // tỉnh (VD "Phường Bình Tân" tồn tại ở cả TP.HCM lẫn tỉnh khác) trước đây bị
    // gộp chung thành 1 câu trả lời sai. Giờ tách rõ theo từng tỉnh trước khi trả lời.
    if (provinceId) {
      const inScope = matched.filter((r) => r.province_new_id === provinceId);
      if (inScope.length === 0) {
        const otherProvinces = [
          ...new Set(matched.map((r) => r.new_province_name)),
        ];
        return {
          answer: `Không tìm thấy "${bestNewName}" trong phạm vi tỉnh/thành đang chọn. Có đơn vị cùng tên thuộc: ${otherProvinces.join(", ")}. Vui lòng chuyển sang tab tương ứng để tra cứu.`,
          answer_type: "structured_lookup",
          answer_level: "unit",
          model_used: "rule_based",
          confidence: 0.5,
          sources: [],
          suggested_provinces: [
            ...new Set(matched.map((r) => r.province_new_id)),
          ],
        };
      }
      matched = inScope;
    } else {
      const distinctProvinces = [
        ...new Set(matched.map((r) => r.province_new_id)),
      ];
      if (distinctProvinces.length > 1) {
        const options = distinctProvinces.map(
          (pid) =>
            matched.find((x) => x.province_new_id === pid).new_province_name,
        );
        return {
          answer: `Có nhiều đơn vị hành chính cùng tên "${bestNewName}" ở các tỉnh/thành khác nhau: ${options.join(", ")}. Vui lòng chọn tab tỉnh tương ứng để tra cứu chính xác.`,
          answer_type: "structured_lookup",
          answer_level: "unit",
          model_used: "rule_based",
          confidence: 0.6,
          sources: [],
        };
      }
    }
    if (usedNorm) {
      const distinctNames = [...new Set(matched.map((r) => r.new_name))];
      if (distinctNames.length > 1) {
        return {
          answer: `Có nhiều đơn vị tên gần giống "${bestNewName}" (khác nhau ở dấu): ${distinctNames.join(", ")}. Vui lòng gõ có dấu để tra cứu chính xác.`,
          answer_type: "structured_lookup",
          answer_level: "unit",
          model_used: "rule_based",
          confidence: 0.6,
          sources: [],
        };
      }
    }
    const toanBo = matched
      .filter((r) => r.merge_type === "toan_bo")
      .map((r) => `${r.old_name} (${r.parent_name})`);
    const motPhan = matched
      .filter((r) => r.merge_type === "mot_phan")
      .map((r) => `${r.old_name} (${r.parent_name})`);

    let parts = [];
    if (toanBo.length) parts.push(`toàn bộ ${toanBo.join(", ")}`);
    if (motPhan.length)
      parts.push(`một phần diện tích của ${motPhan.join(", ")}`);
    const answer = `${bestNewName} được hình thành từ ${parts.join(", cộng với ")}${legalSuffix(matched)}.`;

    return {
      answer,
      answer_type: "structured_lookup",
      answer_level: "unit",
      model_used: "rule_based",
      confidence: 0.95,
      sources: uniqueSourcesFrom(matched),
    };
  }

  async function tryOldProvinceMatch(question) {
    const { rows } = await pool.query(
      `SELECT po.name AS old_name, pn.name AS new_name, 
            pm.article_no, pm.clause_no, pm.point_no,
            d.doc_code, d.title AS doc_title, d.source_url, pm.notes
     FROM provinces_old po
     JOIN province_mapping pm ON pm.old_province_id = po.id
     JOIN provinces_new pn ON pn.id = pm.new_province_id
     LEFT JOIN legal_documents d ON d.id = pm.decision_document_id
     WHERE $1 ILIKE '%' || po.name || '%'
     ORDER BY length(po.name) DESC
     LIMIT 1`,
      [question],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    const answer = `${r.old_name} (cũ) hiện nay đã sáp nhập vào ${r.new_name}${legalSuffix([r])}.`;
    return {
      answer,
      answer_type: "structured_lookup",
      answer_level: "province",
      model_used: "rule_based",
      confidence: 0.97,
      sources: [buildSource(r)],
    };
  }

  // ============ MODEL 2: NAIVE RAG (vector-only) ============
  const SCOPE_KEYWORDS = [
    "Hồ Chí Minh",
    "TP.HCM",
    "Bình Dương",
    "Bà Rịa",
    "Vũng Tàu",
    "An Giang",
    "Kiên Giang",
    "Tây Ninh",
    "Long An",
    "Vĩnh Long",
    "Bến Tre",
    "Trà Vinh",
    "Đồng Nai",
    "Bình Phước",
    "Cần Thơ",
    "Hậu Giang",
    "Sóc Trăng",
    "Đồng Tháp",
    "Tiền Giang",
    "Cà Mau",
    "Bạc Liêu",
  ];

  // Điều kiện phạm vi chunk DÙNG CHUNG cho mọi truy xuất (Naive, Advanced, hybrid của Modular).
  //  - Có provinceId: chỉ lấy chunk của đúng tỉnh đó (chunk tổng hợp có province_new_id).
  //  - Không có: bộ lọc SCOPE_KEYWORDS như cũ (để loại chunk văn bản pháp lý không liên quan),
  //    NHƯNG luôn cho qua chunk tổng hợp (document_id < 0). Trước đây chunk mới->cũ không chứa tên
  //    tỉnh nên bị bộ lọc này loại gần hết (chỉ 47/854 chunk lọt qua), khiến Naive RAG không truy xuất
  //    được loại chunk này.
  // startIdx = chỉ số tham số $ đầu tiên còn trống trong câu truy vấn gọi hàm này.
  function chunkScope(provinceId, startIdx) {
    if (provinceId) {
      return { sql: `c.province_new_id = $${startIdx}`, params: [provinceId] };
    }
    const scopeFilter = SCOPE_KEYWORDS.map(
      (_, i) => `c.content ILIKE $${startIdx + i}`,
    ).join(" OR ");
    return {
      sql: `(c.document_id < 0 OR ${scopeFilter})`,
      params: SCOPE_KEYWORDS.map((kw) => `%${kw}%`),
    };
  }
  let provinceNameCache = null;
  async function getProvinceName(provinceId) {
    if (!provinceId) return null;
    if (!provinceNameCache) {
      const { rows } = await pool.query("SELECT id, name FROM provinces_new");
      provinceNameCache = new Map(rows.map((r) => [Number(r.id), r.name]));
    }
    return provinceNameCache.get(Number(provinceId)) || null;
  }

  function buildSystemPrompt(context, provinceName) {
    const scope = provinceName
      ? `Phạm vi tra cứu: ${provinceName}. Mọi đoạn văn bản dưới đây đều thuộc phạm vi này, kể cả khi đoạn văn bản không ghi tên tỉnh.`
      : `Phạm vi tra cứu: các tỉnh khu vực miền Nam Việt Nam.`;
    return `Bạn là trợ lý tra cứu địa giới hành chính sau sắp xếp (1/7/2025).
${scope}
Trả lời ngắn gọn, tự nhiên như người đang giải thích, tối đa 2 câu. Nêu tên đơn vị cũ, tên đơn vị mới
và căn cứ pháp lý theo dạng "khoản X Điều Y Nghị quyết Z" (VD: "Xã A được hình thành từ ..., theo khoản 61
Điều 1 Nghị quyết 1654/NQ-UBTVQH15").
Chỉ nêu điều, khoản, điểm khi dòng [Căn cứ: ...] hoặc đoạn văn bản có ghi rõ.
Nếu chỉ có số hiệu văn bản thì chỉ nêu số hiệu, không tự suy ra hay đoán điều khoản.
Nếu đoạn văn bản không đủ thông tin để trả lời câu hỏi, PHẢI trả lời đúng và chỉ đúng chuỗi: KHONG_CO_DU_LIEU

Đoạn văn bản:
${context}`;
  }
  async function tryVectorSearch(
    question,
    provider = "gemini",
    provinceId = null,
  ) {
    // Dùng CHUNG hàm truy xuất với Advanced RAG (cùng phạm vi tỉnh, chỉ khác top-N) để chênh lệch
    // Naive -> Advanced chỉ còn do query rewriting + rerank, đúng nguyên tắc ablation.
    const rows = await vectorSearchTopN(question, 5, provinceId);

    const relevant = rows.filter((r) => r.similarity > 0.4); // Giảm nhẹ ngưỡng similarity xuống 0.4 để an toàn
    if (relevant.length === 0) return null;

    const withRef = (r) =>
      `[Căn cứ: ${r.section_label ? r.section_label + ", " : ""}${r.doc_code}]\n${r.content}`;

    const context = relevant.map(withRef).join("\n---\n");
    const systemPrompt = buildSystemPrompt(
      context,
      await getProvinceName(provinceId),
    );

    const {
      text: llmAnswer,
      input_tokens,
      output_tokens,
    } = await callLLM(provider, systemPrompt, question);
    if (!llmAnswer || typeof llmAnswer !== "string") {
      console.error(
        `Provider ${provider} trả về giá trị không hợp lệ:`,
        llmAnswer,
      );
      return null;
    }
    if (llmAnswer.trim() === "KHONG_CO_DU_LIEU") {
      return {
        no_answer: true,
        model_used: "naive_rag",
        input_tokens,
        output_tokens,
      };
    }

    const uniqueSources = [
      ...new Map(
        relevant.map((r) => [
          r.doc_code + (r.section_label || ""),
          {
            document_id: r.doc_code,
            title: r.title,
            section: r.section_label || null,
            source_url: r.source_url,
          },
        ]),
      ).values(),
    ];

    return {
      answer: llmAnswer.trim(),
      answer_type: "rag_generated",
      answer_level: "unit",
      model_used: "naive_rag",
      llm_provider: provider,
      confidence: Math.max(...relevant.map((r) => r.similarity)),
      input_tokens,
      output_tokens,
      sources: uniqueSources,
    };
  }

  // ============ MODEL 3: ADVANCED RAG (query rewriting + rerank) ============

  async function vectorSearchTopN(question, topN = 10, provinceId = null) {
    const embedding = await getEmbedding(question);
    const vectorLiteral = `[${embedding.join(",")}]`;

    if (provinceId) {
      const scoped = await pool.query(
        `SELECT c.content, c.section_label, d.doc_code, d.title, d.source_url,
              1 - (c.embedding <=> $1) AS similarity
       FROM document_chunks c
       JOIN legal_documents d ON d.id = c.document_id
       WHERE c.province_new_id = $3
       ORDER BY c.embedding <=> $1
       LIMIT $2`,
        [vectorLiteral, topN, provinceId],
      );
      if (scoped.rows.length > 0) return scoped.rows;
      // Không có chunk nào được gán đúng tab này -> rơi xuống tìm không giới hạn bên dưới
    }

    const scope = chunkScope(null, 3);
    const { rows } = await pool.query(
      `SELECT c.content, c.section_label, d.doc_code, d.title, d.source_url,
            1 - (c.embedding <=> $1) AS similarity
     FROM document_chunks c
     JOIN legal_documents d ON d.id = c.document_id
     WHERE ${scope.sql}
     ORDER BY c.embedding <=> $1
     LIMIT $2`,
      [vectorLiteral, topN, ...scope.params],
    );

    return rows;
  }

  const RERANK_THRESHOLD = 0.9;
  const RERANK_THRESHOLD_NEW2OLD = 0.45;

  // Giữ nguyên RERANK_THRESHOLD / RERANK_THRESHOLD_NEW2OLD đã có ở file. Thêm các dòng require/hàm phụ ở đầu file:
  //   const fs = require("fs");
  //   const { safeRewrite } = require("./safeRewrite");   // đặt safeRewrite.js cùng thư mục (hoặc sửa đường dẫn)
  //   function debugLog(entry) { if (process.env.DEBUG_PROMPT_LOG !== "1") return;
  //     fs.appendFileSync("prompt_debug.jsonl", JSON.stringify(entry) + "\n"); }
  //
  // Cờ môi trường (mặc định = hành vi Model 3 gốc, KHÔNG đổi kết quả cũ):
  //   M3_REWRITE=0         bỏ bước viết lại (dùng câu gốc)            -> biến thể 3b / 3c
  //   M3_SAFE_REWRITE=1    dùng câu gốc nếu rewrite mất tên/đổi cấp    -> "Model 3 + safeRewrite"
  //   M3_RERANK=0          bỏ rerank, dùng cosine (ngưỡng 0,4 như M2)  -> biến thể 3a / 3c
  //   M3_CONTEXT_K=n       số chunk đưa vào LLM (mặc định 12)
  //   M3_LLM_QUESTION=original   LLM nhận câu gốc thay vì câu viết lại
  async function tryAdvancedRAG(
    question,
    provider = "gemini",
    provinceId = null,
  ) {
    const useRewrite = process.env.M3_REWRITE !== "0";
    const useRerank = process.env.M3_RERANK !== "0";
    const ctxK = Number(process.env.M3_CONTEXT_K || 12);

    let rewrittenQuestion = question;
    let rewriteFallback = null;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    if (useRewrite) {
      const rw = await rewriteQuestion(question, provider);
      rewrittenQuestion = rw.rewritten;
      totalInputTokens = rw.input_tokens;
      totalOutputTokens = rw.output_tokens;
      if (process.env.M3_SAFE_REWRITE === "1") {
        const s = safeRewrite(question, rw.rewritten);
        rewrittenQuestion = s.text;
        rewriteFallback = s.fallback;
      }
    }

    const noAnswer = (reason, score) => ({
      no_answer: true,
      no_answer_reason: reason,
      model_used: "advanced_rag",
      rewritten_question: rewrittenQuestion,
      rewrite_fallback: rewriteFallback,
      rerank_top_score: score ?? null,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    });

    let reranked;
    if (useRerank) {
      const topN = await vectorSearchTopN(rewrittenQuestion, 20, provinceId);
      if (topN.length === 0) return noAnswer("no_chunks");
      reranked = await rerankChunks(rewrittenQuestion, topN, ctxK);
      const topChunk = reranked[0];
      const synthAll = process.env.M3_SYNTH_ALL === "1";
      const isSynthetic = synthAll
        ? topChunk?.doc_code?.startsWith("SYNTHETIC-")
        : topChunk?.doc_code === "SYNTHETIC-NEW2OLD";
      const thr = isSynthetic ? RERANK_THRESHOLD_NEW2OLD : RERANK_THRESHOLD;
      debugLog({
        kind: "rerank_decision",
        question,
        rewritten_question: rewrittenQuestion,
        top_doc: topChunk?.doc_code,
        top_score: topChunk?.rerank_score,
        thr,
        passed: topChunk && topChunk.rerank_score >= thr,
      });
      if (!topChunk || topChunk.rerank_score < thr) {
        return noAnswer("below_threshold", topChunk?.rerank_score);
      }
    } else {
      const rows = await vectorSearchTopN(rewrittenQuestion, ctxK, provinceId);
      const relevant = rows.filter((r) => r.similarity > 0.4); // ngưỡng cosine của Model 2
      if (relevant.length === 0)
        return noAnswer("below_threshold", rows[0]?.similarity);
      reranked = relevant.map((r) => ({ ...r, rerank_score: r.similarity }));
    }

    const withRef = (r) =>
      `[Căn cứ: ${r.section_label ? r.section_label + ", " : ""}${r.doc_code}]\n${r.content}`;
    const context = reranked.slice(0, ctxK).map(withRef).join("\n---\n");
    const systemPrompt = buildSystemPrompt(
      context,
      await getProvinceName(provinceId),
    );

    const llmQuestion =
      process.env.M3_LLM_QUESTION === "original" ? question : rewrittenQuestion;
    const {
      text: llmAnswer,
      input_tokens: ansIn,
      output_tokens: ansOut,
    } = await callLLM(provider, systemPrompt, llmQuestion);
    totalInputTokens += ansIn ?? 0;
    totalOutputTokens += ansOut ?? 0;

    debugLog({
      ts: new Date().toISOString(),
      provider,
      question,
      rewritten_question: rewrittenQuestion,
      rewrite_fallback: rewriteFallback,
      llm_question: llmQuestion,
      flags: {
        useRewrite,
        useRerank,
        ctxK,
        safe: process.env.M3_SAFE_REWRITE === "1",
      },
      top_score: reranked[0].rerank_score,
      top_doc: reranked[0].doc_code,
      n_chunks: reranked.length,
      llm_raw: llmAnswer,
      context_head: context.slice(0, 1500),
    });

    if (!llmAnswer || llmAnswer.trim() === "")
      return noAnswer("llm_empty", reranked[0].rerank_score);
    if (llmAnswer.trim() === "KHONG_CO_DU_LIEU")
      return noAnswer("llm_refused", reranked[0].rerank_score);

    const uniqueSources = [
      ...new Map(
        reranked.map((c) => [
          c.doc_code + (c.section_label || ""),
          {
            document_id: c.doc_code,
            title: c.title,
            section: c.section_label || null,
            source_url: c.source_url,
          },
        ]),
      ).values(),
    ];

    return {
      answer: llmAnswer.trim(),
      answer_type: "rag_generated",
      answer_level: "unit",
      model_used: "advanced_rag",
      llm_provider: provider,
      rewritten_question: rewrittenQuestion,
      rewrite_fallback: rewriteFallback,
      rerank_top_score: reranked[0].rerank_score,
      confidence: reranked[0].rerank_score,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
      sources: uniqueSources,
    };
  }

  // ============ MODEL 4: MODULAR RAG (router + hybrid retrieval) ============

  async function keywordSearch(question, provinceId = null) {
    const scope = chunkScope(provinceId, 2);
    const { rows } = await pool.query(
      `SELECT c.id, c.content, c.section_label, d.doc_code, d.title, d.source_url,
       ts_rank(c.content_tsv, plainto_tsquery('simple', $1)) AS rank
     FROM document_chunks c
     JOIN legal_documents d ON d.id = c.document_id
     WHERE c.content_tsv @@ plainto_tsquery('simple', $1)
       AND ${scope.sql}
     ORDER BY rank DESC
     LIMIT 5`,
      [question, ...scope.params],
    );
    return rows;
  }

  async function vectorSearchRaw(question, provinceId = null) {
    const embedding = await getEmbedding(question);
    const vectorLiteral = `[${embedding.join(",")}]`;
    const scope = chunkScope(provinceId, 2);
    const { rows } = await pool.query(
      `SELECT c.id, c.content, c.section_label, d.doc_code, d.title, d.source_url,
          1 - (c.embedding <=> $1) AS similarity
   FROM document_chunks c
   JOIN legal_documents d ON d.id = c.document_id
   WHERE ${scope.sql}
   ORDER BY c.embedding <=> $1
   LIMIT 5`,
      [vectorLiteral, ...scope.params],
    );
    return rows;
  }

  function reciprocalRankFusion(listA, listB, k = 60) {
    const scores = new Map();
    listA.forEach((item, index) => {
      scores.set(item.id, { item, score: 1 / (k + index + 1) });
    });
    listB.forEach((item, index) => {
      const rrf = 1 / (k + index + 1);
      if (scores.has(item.id)) {
        scores.get(item.id).score += rrf;
      } else {
        scores.set(item.id, { item, score: rrf });
      }
    });
    return [...scores.values()]
      .sort((a, b) => b.score - a.score)
      .map((e) => e.item);
  }

  async function tryHybridRetrieval(question, provinceId = null) {
    const [keywordResults, vectorResults] = await Promise.all([
      keywordSearch(question, provinceId),
      vectorSearchRaw(question, provinceId),
    ]);
    if (keywordResults.length === 0 && vectorResults.length === 0) return null;
    return reciprocalRankFusion(vectorResults, keywordResults).slice(0, 5);
  }

  async function tryModularRAG(
    question,
    provider = "gemini",
    provinceId = null,
  ) {
    // MỚI: gọi qua runStructuredLookup() thay vì lặp lại logic 3 hàm tra cứu
    // + đã có sẵn bộ lọc isLikelyOutOfScopeTopic() ở trong đó.
    const structuredResult = await runStructuredLookup(
      question,
      provinceId,
      "modular_rag",
    );
    if (structuredResult) {
      return {
        ...structuredResult,
        model_used: "modular_rag",
        routing_decision: "structured",
      };
    }

    const fusedChunks = await tryHybridRetrieval(question, provinceId);
    if (!fusedChunks || fusedChunks.length === 0) return null;

    const withRef = (r) =>
      `[Căn cứ: ${r.section_label ? r.section_label + ", " : ""}${r.doc_code}]\n${r.content}`;

    const context = fusedChunks.map(withRef).join("\n---\n");
    const systemPrompt = buildSystemPrompt(
      context,
      await getProvinceName(provinceId),
    );

    const {
      text: llmAnswer,
      input_tokens,
      output_tokens,
    } = await callLLM(provider, systemPrompt, question);
    if (llmAnswer.trim() === "KHONG_CO_DU_LIEU")
      return {
        no_answer: true,
        model_used: "modular_rag",
        routing_decision: "hybrid_retrieval",
        input_tokens,
        output_tokens,
      };

    const uniqueSources = [
      ...new Map(
        fusedChunks.map((c) => [
          c.doc_code,
          {
            document_id: c.doc_code,
            title: c.title,
            source_url: c.source_url,
          },
        ]),
      ).values(),
    ];

    return {
      answer: llmAnswer.trim(),
      answer_type: "rag_generated",
      answer_level: "unit",
      model_used: "modular_rag",
      routing_decision: "hybrid_retrieval",
      llm_provider: provider,
      confidence: 0.8,
      input_tokens,
      output_tokens,
      sources: uniqueSources,
    };
  }

  // ============ POST /qa/ask ============
  let validProvinceIdsCache = null;
  // Tra id tỉnh theo MÃ (HCM, VL...). Mã là khóa ổn định giữa các máy; id thì khác nhau theo từng DB.
  // Cần cột provinces_new.code (xem migration trong tài liệu). Chưa có cột -> trả null (không cache).
  let provinceCodeCache = null;
  async function getProvinceIdByCode(code) {
    if (!provinceCodeCache) {
      try {
        const { rows } = await pool.query(
          "SELECT id, code FROM provinces_new WHERE code IS NOT NULL",
        );
        provinceCodeCache = new Map(
          rows.map((r) => [String(r.code).toUpperCase(), Number(r.id)]),
        );
      } catch (err) {
        if (err.code === "42703") {
          console.error(
            "provinces_new chưa có cột code — chạy migration thêm cột code.",
          );
          return null;
        }
        throw err;
      }
    }
    return provinceCodeCache.get(String(code).trim().toUpperCase()) ?? null;
  }

  async function getValidProvinceIds() {
    if (!validProvinceIdsCache) {
      const { rows } = await pool.query("SELECT id FROM provinces_new");
      validProvinceIdsCache = rows.map((r) => Number(r.id));
    }
    return validProvinceIdsCache;
  }

  async function ask(req, res) {
    try {
      const {
        question,
        session_id,
        llm_provider,
        model,
        province_id,
        province_code,
      } = req.body;

      const VALID_PROVIDERS = Object.keys(PROVIDERS); // tự động lấy đúng danh sách provider thật sự tồn tại

      if (llm_provider && !VALID_PROVIDERS.includes(llm_provider)) {
        return res
          .status(400)
          .json(
            fail(
              `Provider "${llm_provider}" không hợp lệ. Chọn 1 trong: ${VALID_PROVIDERS.join(", ")}`,
              "VALIDATION_ERROR",
            ),
          );
      }
      const provider = llm_provider || "gemini"; // mặc định khi không truyền, KHÔNG fallback khi truyền sai

      const VALID_PROVINCE_IDS = await getValidProvinceIds();
      let provinceId = null;
      // Ưu tiên province_code (HCM, VL...); province_id (số) vẫn được hỗ trợ để tương thích ngược.
      if (
        province_code !== undefined &&
        province_code !== null &&
        province_code !== ""
      ) {
        provinceId = await getProvinceIdByCode(province_code);
        if (provinceId === null) {
          return res
            .status(400)
            .json(
              fail(
                `province_code "${province_code}" không hợp lệ hoặc chưa được cấu hình trong DB`,
                "VALIDATION_ERROR",
              ),
            );
        }
      } else if (province_id !== undefined && province_id !== null) {
        provinceId = Number(province_id);
        if (!VALID_PROVINCE_IDS.includes(provinceId)) {
          return res
            .status(400)
            .json(
              fail(
                `province_id "${province_id}" không hợp lệ. Chọn 1 trong: ${VALID_PROVINCE_IDS.join(", ")}`,
                "VALIDATION_ERROR",
              ),
            );
        }
      }
      const selectedModel = [
        "rule_based",
        "naive_rag",
        "advanced_rag",
        "modular_rag",
      ].includes(model)
        ? model
        : "modular_rag";
      if (!question || typeof question !== "string" || question.length === 0) {
        return res
          .status(400)
          .json(fail("Câu hỏi không hợp lệ", "VALIDATION_ERROR"));
      }
      if (question.length > 500) {
        return res
          .status(400)
          .json(fail("Câu hỏi quá dài (tối đa 500 ký tự)", "VALIDATION_ERROR"));
      }

      const startTime = Date.now();
      let result;

      if (selectedModel === "rule_based") {
        // MỚI: gọi qua runStructuredLookup() thay vì lặp lại logic 3 hàm tra cứu
        result = await runStructuredLookup(question, provinceId);
      } else if (selectedModel === "naive_rag") {
        result = await tryVectorSearch(question, provider, provinceId);
      } else if (selectedModel === "advanced_rag") {
        try {
          result = await tryAdvancedRAG(question, provider, provinceId);
        } catch (err) {
          // MỚI — DEBUG TẠM THỜI
          console.error(
            "RAW ERROR (advanced_rag):",
            err?.response?.status,
            err?.statusCode,
            err?.message,
            JSON.stringify(err?.body || err?.response?.data || {}),
          );
          if (isConnectionError(err)) {
            return res.status(503).json({
              success: false,
              data: null,
              message:
                "Xin lỗi, hiện hệ thống đang gặp sự cố kết nối và chưa thể xử lý câu hỏi của bạn. Vui lòng thử lại sau ít phút.",
              error_code: "SERVICE_UNAVAILABLE",
            });
          }
          throw err; // lỗi không xác định — vẫn nên biết để debug tiếp, không nuốt âm thầm
        }
      } else {
        result = await tryModularRAG(question, provider, provinceId);
      }
      if (result && result.no_answer) {
        const qaLogId = await logQa(
          session_id,
          question,
          null,
          "no_answer",
          result.model_used,
          provider,
          result.routing_decision || null,
          0,
          Date.now() - startTime,
          result.rewritten_question,
          result.rerank_top_score,
          result.input_tokens ?? null,
          result.output_tokens ?? null,
        );
        return res.status(200).json({
          success: true,
          data: {
            answer: null,
            answer_type: "no_answer",
            answer_level: null,
            confidence: 0,
            sources: [],
            qa_log_id: qaLogId,
            input_tokens: result.input_tokens ?? null,
            output_tokens: result.output_tokens ?? null,
            suggestion:
              "Câu hỏi nằm ngoài phạm vi dữ liệu hệ thống hiện có (TP.HCM sau sắp xếp).",
          },
          message: "NO_ANSWER_FOUND",
          error_code: "NO_ANSWER_FOUND",
        });
      }
      if (result) {
        const qaLogId = await logQa(
          session_id,
          question,
          result.answer,
          result.answer_type,
          result.model_used,
          result.llm_provider || null,
          result.routing_decision || null,
          result.confidence,
          Date.now() - startTime,
          result.rewritten_question || null,
          result.rerank_top_score || null,
          result.input_tokens ?? null,
          result.output_tokens ?? null,
        );
        const {
          model_used,
          llm_provider: _lp,
          routing_decision,
          ...responseData
        } = result;
        return res
          .status(200)
          .json(success({ ...responseData, qa_log_id: qaLogId }));
      }

      const qaLogId = await logQa(
        session_id,
        question,
        null,
        "no_answer",
        selectedModel,
        provider,
        null,
        0,
        Date.now() - startTime,
      );

      return res.status(200).json({
        success: true,
        data: {
          answer: null,
          answer_type: "no_answer",
          answer_level: null,
          confidence: 0,
          sources: [],
          qa_log_id: qaLogId,
          suggestion:
            "Câu hỏi nằm ngoài phạm vi dữ liệu hệ thống hiện có (TP.HCM sau sắp xếp).",
        },
        message: "NO_ANSWER_FOUND",
        error_code: "NO_ANSWER_FOUND",
      });
    } catch (err) {
      console.error(err);
      if (err instanceof RateLimitError) {
        return res.status(429).json({
          ...fail(
            "Hệ thống đang xử lý quá nhiều yêu cầu tới dịch vụ AI. Vui lòng thử lại sau ít phút.",
            "RATE_LIMITED",
          ),
          retry_after_ms: err.retryAfterMs || null,
        });
      }
      if (err instanceof ServiceUnavailableError) {
        return res
          .status(503)
          .json(
            fail(
              "Xin lỗi, hiện hệ thống đang gặp sự cố kết nối và chưa thể xử lý câu hỏi của bạn. Vui lòng thử lại sau ít phút.",
              "SERVICE_UNAVAILABLE",
            ),
          );
      }
      return res.status(500).json(fail("Lỗi hệ thống", "INTERNAL_ERROR"));
    }
  }

  async function searchOfficialSources(query) {
    const res = await axios.get("https://www.googleapis.com/customsearch/v1", {
      params: {
        key: process.env.GOOGLE_SEARCH_API_KEY,
        cx: process.env.GOOGLE_SEARCH_ENGINE_ID, // Custom Search Engine đã giới hạn domain vbpl.vn, chinhphu.vn
        q: query,
      },
    });
    return res.data.items?.slice(0, 3) || [];
  }
}
module.exports = { ask };
