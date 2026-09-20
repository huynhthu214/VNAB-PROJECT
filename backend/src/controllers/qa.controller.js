const pool = require("../config/db");
const { success, fail } = require("../utils/response");
const axios = require("axios");
const {
  callLLM,
  PROVIDERS,
  ServiceUnavailableError,
  RateLimitError,
  isConnectionError,
} = require("../services/llmProviders");

function extractKhoan(notes) {
  const m = (notes || "").match(/Khoản\s+(\d+)/);
  return m ? `Khoản ${m[1]}` : null;
}

function buildSource(row) {
  return {
    document_id: row.doc_code || null,
    title: row.doc_title || null,
    section: extractKhoan(row.notes),
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
  const q = question.toLowerCase();
  return (
    q.includes("được hình thành từ") ||
    q.includes("hình thành từ") ||
    q.includes("sáp nhập từ") ||
    q.includes("được sắp xếp từ") ||
    q.includes("gồm những đơn vị") ||
    (q.includes("trước sắp xếp") && q.includes("gồm"))
  );
}

async function tryOldUnitMatch(question, provinceId = null) {
  const { rows } = await pool.query(
    `SELECT o.id AS old_id, o.name AS old_name, o.parent_name, o.province_old,
            n.name AS new_name, n.province_new_id, pn.name AS new_province_name,
            m.merge_type,
            d.doc_code, d.title AS doc_title, d.source_url, m.notes
     FROM admin_units_old o
     JOIN unit_mapping m ON m.old_unit_id = o.id
     JOIN admin_units_new n ON n.id = m.new_unit_id
     JOIN provinces_new pn ON pn.id = n.province_new_id
     LEFT JOIN legal_documents d ON d.id = m.decision_document_id
     WHERE $1 ILIKE '%' || o.name || '%'
     ORDER BY length(o.name) DESC`,
    [question],
  );
  if (rows.length === 0) return null;

  const bestOldName = rows[0].old_name;
  let sameNameRows = rows.filter((r) => r.old_name === bestOldName);

  // ====== MỚI: lọc theo tab tỉnh đang chọn (nếu có) ======
  // Vì tên đơn vị hành chính trùng nhau rất phổ biến giữa các tỉnh (VD "Phường 16"
  // tồn tại ở nhiều quận khác nhau), phải thu hẹp về đúng phạm vi tab trước khi
  // xét tiếp logic mơ hồ theo quận/huyện bên dưới - tránh trộn lẫn dữ liệu khác tỉnh.
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

  // Nếu trùng tên nhiều nơi (trong CÙNG tab, hoặc không chọn tab) -> thử lọc thêm theo tên quận/huyện NẾU câu hỏi có nhắc tới
  if (distinctOldIds.length > 1) {
    const questionLower = question.toLowerCase();
    const filteredByParent = sameNameRows.filter(
      (r) =>
        r.parent_name && questionLower.includes(r.parent_name.toLowerCase()),
    );
    const filteredDistinctIds = [
      ...new Set(filteredByParent.map((r) => r.old_id)),
    ];

    // Chỉ áp dụng nếu lọc ra được ĐÚNG 1 đơn vị duy nhất - tránh lọc nhầm còn 2+ vẫn mơ hồ
    if (filteredDistinctIds.length === 1) {
      sameNameRows = filteredByParent;
      distinctOldIds = filteredDistinctIds;
    }
  }

  // Sau khi thử lọc, vẫn còn nhiều đơn vị khác nhau trùng tên -> thật sự mơ hồ, hỏi lại
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

  // Đã xác định được đúng 1 đơn vị (từ đầu hoặc nhờ lọc theo quận) -> trả lời bình thường
  const matched = sameNameRows;
  let answer;
  if (matched.length === 1) {
    const r = matched[0];
    answer = `${r.old_name} (cũ) hiện nay thuộc ${r.new_name}${r.doc_code ? `, theo ${r.doc_code}` : ""}.`;
  } else {
    const newNames = matched.map((r) => r.new_name).join(", ");
    answer = `${bestOldName} (cũ) không nhập trọn vào 1 nơi mà được chia làm ${matched.length} phần: ${newNames}${matched[0].doc_code ? `, theo ${matched[0].doc_code}` : ""}.`;
  }

  return {
    answer,
    answer_type: "structured_lookup",
    answer_level: "unit",
    model_used: "rule_based",
    confidence: 0.95,
    sources: matched.map(buildSource),
  };
}

async function tryNewUnitMatch(question, provinceId = null) {
  const { rows } = await pool.query(
    `SELECT n.name AS new_name, n.province_new_id, pn.name AS new_province_name,
            o.name AS old_name, o.parent_name, m.merge_type,
            d.doc_code, d.title AS doc_title, d.source_url, m.notes
     FROM admin_units_new n
     JOIN provinces_new pn ON pn.id = n.province_new_id
     JOIN unit_mapping m ON m.new_unit_id = n.id
     JOIN admin_units_old o ON o.id = m.old_unit_id
     LEFT JOIN legal_documents d ON d.id = m.decision_document_id
     WHERE $1 ILIKE '%' || n.name || '%'
     ORDER BY length(n.name) DESC`,
    [question],
  );
  if (rows.length === 0) return null;

  const bestNewName = rows[0].new_name;
  let matched = rows.filter((r) => r.new_name === bestNewName);

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
  const answer = `${bestNewName} được hình thành từ ${parts.join(", cộng với ")}${matched[0].doc_code ? `, theo ${matched[0].doc_code}` : ""}.`;

  return {
    answer,
    answer_type: "structured_lookup",
    answer_level: "unit",
    model_used: "rule_based",
    confidence: 0.95,
    sources: matched.map(buildSource),
  };
}

async function tryOldProvinceMatch(question) {
  const { rows } = await pool.query(
    `SELECT po.name AS old_name, pn.name AS new_name,
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
  const answer = `${r.old_name} (cũ) hiện nay đã sáp nhập vào ${r.new_name}${r.doc_code ? `, theo ${r.doc_code}` : ""}.`;
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

// ============ MODEL 2: NAIVE RAG (vector-only) ============

async function tryVectorSearch(question, provider = "gemini") {
  const embedding = await getEmbedding(question);
  const vectorLiteral = `[${embedding.join(",")}]`;

  const scopeFilter = SCOPE_KEYWORDS.map(
    (_, i) => `c.content ILIKE $${i + 2}`,
  ).join(" OR ");
  const scopeParams = SCOPE_KEYWORDS.map((kw) => `%${kw}%`);

  const { rows } = await pool.query(
    `SELECT c.content, c.section_label, d.doc_code, d.title, d.source_url,
            1 - (c.embedding <=> $1) AS similarity
     FROM document_chunks c
     JOIN legal_documents d ON d.id = c.document_id
     WHERE (${scopeFilter})
     ORDER BY c.embedding <=> $1
     LIMIT 5`,
    [vectorLiteral, ...scopeParams],
  );

  const relevant = rows.filter((r) => r.similarity > 0.4); // Giảm nhẹ ngưỡng similarity xuống 0.4 để an toàn
  if (relevant.length === 0) return null;

  const context = relevant.map((r) => r.content).join("\n---\n");
  const systemPrompt = `Bạn là trợ lý tra cứu địa giới hành chính TP.HCM sau sắp xếp (1/7/2025).
Chỉ trả lời dựa trên đoạn văn bản được cung cấp dưới đây, không dùng kiến thức ngoài đoạn văn bản này.
Trả lời bằng 1 câu hoàn chỉnh, có chủ ngữ - vị ngữ rõ ràng, nêu tên đơn vị cũ, tên đơn vị mới,
và số hiệu văn bản pháp lý liên quan (VD: "Phường X (cũ) nay thuộc Phường Y, theo Nghị quyết ...").
Nếu đoạn văn bản không đủ thông tin để trả lời câu hỏi, PHẢI trả lời đúng và chỉ đúng chuỗi: KHONG_CO_DU_LIEU

Đoạn văn bản:
${context}`;

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

  const scopeFilter = SCOPE_KEYWORDS.map(
    (_, i) => `c.content ILIKE $${i + 3}`,
  ).join(" OR ");
  const scopeParams = SCOPE_KEYWORDS.map((kw) => `%${kw}%`);

  const { rows } = await pool.query(
    `SELECT c.content, c.section_label, d.doc_code, d.title, d.source_url,
            1 - (c.embedding <=> $1) AS similarity
     FROM document_chunks c
     JOIN legal_documents d ON d.id = c.document_id
     WHERE (${scopeFilter})
     ORDER BY c.embedding <=> $1
     LIMIT $2`,
    [vectorLiteral, topN, ...scopeParams],
  );

  return rows;
}

const RERANK_THRESHOLD = 0.9;
// Ngưỡng riêng cho chunk tổng hợp chiều mới->cũ (SYNTHETIC-NEW2OLD) — CrossEncoder
// chấm điểm thấp hệ thống cho loại chunk này do khác văn phong câu hỏi, dù nội
// dung đúng chủ đề. Đã hiệu chỉnh từ pilot test (điểm quan sát 0.46-0.90).
const RERANK_THRESHOLD_NEW2OLD = 0.45;

async function tryAdvancedRAG(
  question,
  provider = "gemini",
  provinceId = null,
) {
  const rw = await rewriteQuestion(question, provider);
  const rewrittenQuestion = rw.rewritten;
  let totalInputTokens = rw.input_tokens;
  let totalOutputTokens = rw.output_tokens;

  const topN = await vectorSearchTopN(rewrittenQuestion, 20, provinceId);
  if (topN.length === 0) {
    return {
      no_answer: true,
      model_used: "advanced_rag",
      rewritten_question: rewrittenQuestion,
      rerank_top_score: null,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    };
  }

  const reranked = await rerankChunks(rewrittenQuestion, topN, 12);

  const topChunk = reranked[0];
  const effectiveThreshold =
    topChunk?.doc_code === "SYNTHETIC-NEW2OLD"
      ? RERANK_THRESHOLD_NEW2OLD
      : RERANK_THRESHOLD;

  if (!topChunk || topChunk.rerank_score < effectiveThreshold) {
    return {
      no_answer: true,
      model_used: "advanced_rag",
      rewritten_question: rewrittenQuestion,
      rerank_top_score: topChunk?.rerank_score ?? null,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    };
  }

  const context = reranked.map((c) => c.content).join("\n---\n");
  const systemPrompt = `Bạn là trợ lý tra cứu địa giới hành chính TP.HCM sau sắp xếp (1/7/2025).
Chỉ trả lời dựa trên đoạn văn bản được cung cấp dưới đây, không dùng kiến thức ngoài đoạn văn bản này.
Trả lời bằng 1 câu hoàn chỉnh, có chủ ngữ - vị ngữ rõ ràng, nêu tên đơn vị cũ, tên đơn vị mới,
và số hiệu văn bản pháp lý liên quan (VD: "Phường X (cũ) nay thuộc Phường Y, theo Nghị quyết ...").
Nếu đoạn văn bản không đủ thông tin để trả lời câu hỏi, PHẢI trả lời đúng và chỉ đúng chuỗi: KHONG_CO_DU_LIEU

Đoạn văn bản:
${context}`;

  const {
    text: llmAnswer,
    input_tokens: ansIn,
    output_tokens: ansOut,
  } = await callLLM(provider, systemPrompt, rewrittenQuestion);
  totalInputTokens += ansIn ?? 0;
  totalOutputTokens += ansOut ?? 0;

  if (!llmAnswer || llmAnswer.trim() === "KHONG_CO_DU_LIEU") {
    return {
      no_answer: true,
      model_used: "advanced_rag",
      rewritten_question: rewrittenQuestion,
      rerank_top_score: reranked[0].rerank_score,
      input_tokens: totalInputTokens,
      output_tokens: totalOutputTokens,
    };
  }

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
    rerank_top_score: reranked[0].rerank_score,
    confidence: reranked[0].rerank_score,
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
    sources: uniqueSources,
  };
}

// ============ MODEL 4: MODULAR RAG (router + hybrid retrieval) ============

async function keywordSearch(question) {
  const scopeFilter = SCOPE_KEYWORDS.map(
    (_, i) => `c.content ILIKE $${i + 2}`,
  ).join(" OR ");
  const scopeParams = SCOPE_KEYWORDS.map((kw) => `%${kw}%`);

  const { rows } = await pool.query(
    `SELECT c.id, c.content, d.doc_code, d.title, d.source_url,
            ts_rank(c.content_tsv, plainto_tsquery('simple', $1)) AS rank
     FROM document_chunks c
     JOIN legal_documents d ON d.id = c.document_id
     WHERE c.content_tsv @@ plainto_tsquery('simple', $1)
       AND (${scopeFilter})
     ORDER BY rank DESC
     LIMIT 5`,
    [question, ...scopeParams],
  );
  return rows;
}

async function vectorSearchRaw(question) {
  const embedding = await getEmbedding(question);
  const vectorLiteral = `[${embedding.join(",")}]`;

  const scopeFilter = SCOPE_KEYWORDS.map(
    (_, i) => `c.content ILIKE $${i + 2}`,
  ).join(" OR ");
  const scopeParams = SCOPE_KEYWORDS.map((kw) => `%${kw}%`);

  const { rows } = await pool.query(
    `SELECT c.content, c.section_label, d.doc_code, d.title, d.source_url,
          1 - (c.embedding <=> $1) AS similarity
   FROM document_chunks c
   JOIN legal_documents d ON d.id = c.document_id
   WHERE (${scopeFilter})
   ORDER BY c.embedding <=> $1
   LIMIT 5`,
    [vectorLiteral, ...scopeParams],
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

async function tryHybridRetrieval(question) {
  const [keywordResults, vectorResults] = await Promise.all([
    keywordSearch(question),
    vectorSearchRaw(question),
  ]);
  if (keywordResults.length === 0 && vectorResults.length === 0) return null;
  return reciprocalRankFusion(vectorResults, keywordResults).slice(0, 5);
}

async function tryModularRAG(question, provider = "gemini", provinceId = null) {
  const aggIntent = isAggregationIntent(question);
  const structuredResult = aggIntent
    ? (await tryNewUnitMatch(question, provinceId)) ||
      (await tryOldUnitMatch(question, provinceId)) ||
      (await tryOldProvinceMatch(question))
    : (await tryOldUnitMatch(question, provinceId)) ||
      (await tryNewUnitMatch(question, provinceId)) ||
      (await tryOldProvinceMatch(question));
  if (structuredResult) {
    return {
      ...structuredResult,
      model_used: "modular_rag",
      routing_decision: "structured",
    };
  }

  const fusedChunks = await tryHybridRetrieval(question);
  if (!fusedChunks || fusedChunks.length === 0) return null;

  const context = fusedChunks.map((c) => c.content).join("\n---\n");
  const systemPrompt = `Bạn là trợ lý tra cứu địa giới hành chính TP.HCM sau sắp xếp (1/7/2025).
Chỉ trả lời dựa trên đoạn văn bản được cung cấp dưới đây, không dùng kiến thức ngoài đoạn văn bản này.
Trả lời bằng 1 câu hoàn chỉnh, có chủ ngữ - vị ngữ rõ ràng, nêu tên đơn vị cũ, tên đơn vị mới,
và số hiệu văn bản pháp lý liên quan (VD: "Phường X (cũ) nay thuộc Phường Y, theo Nghị quyết ...").
Nếu đoạn văn bản không đủ thông tin để trả lời câu hỏi, PHẢI trả lời đúng và chỉ đúng chuỗi: KHONG_CO_DU_LIEU

Đoạn văn bản:
${context}`;

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

async function ask(req, res) {
  try {
    const { question, session_id, llm_provider, model, province_id } = req.body;

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

    // province_id ứng với 8 tab tỉnh/thành trên frontend (= id trong bảng provinces_new)
    const VALID_PROVINCE_IDS = [1, 7, 9, 11, 14, 16, 18, 20];
    let provinceId = null;
    if (province_id !== undefined && province_id !== null) {
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
      const aggIntent = isAggregationIntent(question);
      result = aggIntent
        ? (await tryNewUnitMatch(question, provinceId)) ||
          (await tryOldUnitMatch(question, provinceId)) ||
          (await tryOldProvinceMatch(question))
        : (await tryOldUnitMatch(question, provinceId)) ||
          (await tryNewUnitMatch(question, provinceId)) ||
          (await tryOldProvinceMatch(question));
    } else if (selectedModel === "naive_rag") {
      result = await tryVectorSearch(question, provider);
    } else if (selectedModel === "advanced_rag") {
      try {
        result = await tryAdvancedRAG(question, provider, provinceId);
      } catch (err) {
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

module.exports = { ask };
