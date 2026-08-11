const pool = require("../config/db");
const { success, fail } = require("../utils/response");
const axios = require("axios");
const {
  callLLM,
  ServiceUnavailableError,
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
    const res = await axios.post("http://localhost:8001/embed", { text });
    return res.data.embedding;
  } catch (err) {
    if (isConnectionError(err)) {
      throw new ServiceUnavailableError("Không kết nối được service embedding");
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
) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO qa_logs (session_id, question, answer, answer_type, model_used, llm_provider, routing_decision, confidence, response_time_ms)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
      ],
    );
    return rows[0].id;
  } catch (err) {
    console.error("Lỗi ghi qa_logs:", err);
    return null;
  }
}
// ============ MODEL 1: RULE-BASED (structured lookup) ============

async function tryOldUnitMatch(question) {
  const { rows } = await pool.query(
    `SELECT o.name AS old_name, n.name AS new_name, m.merge_type,
            d.doc_code, d.title AS doc_title, d.source_url, m.notes
     FROM admin_units_old o
     JOIN unit_mapping m ON m.old_unit_id = o.id
     JOIN admin_units_new n ON n.id = m.new_unit_id
     LEFT JOIN legal_documents d ON d.id = m.decision_document_id
     WHERE $1 ILIKE '%' || o.name || '%'
     ORDER BY length(o.name) DESC`,
    [question],
  );
  if (rows.length === 0) return null;

  const bestOldName = rows[0].old_name;
  const matched = rows.filter((r) => r.old_name === bestOldName);

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

async function tryNewUnitMatch(question) {
  const { rows } = await pool.query(
    `SELECT n.name AS new_name, o.name AS old_name, m.merge_type,
            d.doc_code, d.title AS doc_title, d.source_url, m.notes
     FROM admin_units_new n
     JOIN unit_mapping m ON m.new_unit_id = n.id
     JOIN admin_units_old o ON o.id = m.old_unit_id
     LEFT JOIN legal_documents d ON d.id = m.decision_document_id
     WHERE $1 ILIKE '%' || n.name || '%'
     ORDER BY length(n.name) DESC`,
    [question],
  );
  if (rows.length === 0) return null;

  const bestNewName = rows[0].new_name;
  const matched = rows.filter((r) => r.new_name === bestNewName);

  const toanBo = matched
    .filter((r) => r.merge_type === "toan_bo")
    .map((r) => r.old_name);
  const motPhan = matched
    .filter((r) => r.merge_type === "mot_phan")
    .map((r) => r.old_name);

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

const SCOPE_KEYWORDS = ["Hồ Chí Minh", "Bình Dương", "Bà Rịa", "Vũng Tàu"];

async function tryVectorSearch(question, provider = "gemini") {
  const embedding = await getEmbedding(question);
  const vectorLiteral = `[${embedding.join(",")}]`;

  const scopeFilter = SCOPE_KEYWORDS.map(
    (_, i) => `c.content ILIKE $${i + 2}`,
  ).join(" OR ");
  const scopeParams = SCOPE_KEYWORDS.map((kw) => `%${kw}%`);

  const { rows } = await pool.query(
    `SELECT c.content, d.doc_code, d.title, d.source_url,
            1 - (c.embedding <=> $1) AS similarity
     FROM document_chunks c
     JOIN legal_documents d ON d.id = c.document_id
     WHERE (${scopeFilter})
     ORDER BY c.embedding <=> $1
     LIMIT 5`,
    [vectorLiteral, ...scopeParams],
  );

  const relevant = rows.filter((r) => r.similarity > 0.5);
  if (relevant.length === 0) return null;

  const context = relevant.map((r) => r.content).join("\n---\n");
  const systemPrompt = `Bạn là trợ lý tra cứu địa giới hành chính TP.HCM sau sắp xếp (1/7/2025).
Chỉ trả lời dựa trên đoạn văn bản được cung cấp dưới đây, không dùng kiến thức ngoài đoạn văn bản này.
Nếu đoạn văn bản không đủ thông tin để trả lời câu hỏi, PHẢI trả lời đúng và chỉ đúng chuỗi: KHONG_CO_DU_LIEU

Đoạn văn bản:
${context}`;

  const llmAnswer = await callLLM(provider, systemPrompt, question);
  if (llmAnswer.trim() === "KHONG_CO_DU_LIEU") return null;

  const uniqueSources = [
    ...new Map(
      relevant.map((r) => [
        r.doc_code,
        {
          document_id: r.doc_code,
          title: r.title,
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
    sources: uniqueSources,
  };
}

// ============ MODEL 3: MODULAR RAG (router + hybrid retrieval) ============

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
    `SELECT c.id, c.content, d.doc_code, d.title, d.source_url,
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

async function tryModularRAG(question, provider = "gemini") {
  const structuredResult =
    (await tryOldUnitMatch(question)) ||
    (await tryNewUnitMatch(question)) ||
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
Nếu đoạn văn bản không đủ thông tin để trả lời câu hỏi, PHẢI trả lời đúng và chỉ đúng chuỗi: KHONG_CO_DU_LIEU

Đoạn văn bản:
${context}`;

  const llmAnswer = await callLLM(provider, systemPrompt, question);
  if (llmAnswer.trim() === "KHONG_CO_DU_LIEU") return null;

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
    sources: uniqueSources,
  };
}

// ============ POST /qa/ask ============

async function ask(req, res) {
  try {
    const { question, session_id, llm_provider, model } = req.body;
    const provider = ["gemini", "groq", "cohere"].includes(llm_provider)
      ? llm_provider
      : "gemini";
    const selectedModel = ["rule_based", "naive_rag", "modular_rag"].includes(
      model,
    )
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
      result =
        (await tryOldUnitMatch(question)) ||
        (await tryNewUnitMatch(question)) ||
        (await tryOldProvinceMatch(question));
    } else if (selectedModel === "naive_rag") {
      result = await tryVectorSearch(question, provider);
    } else {
      result = await tryModularRAG(question, provider);
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

module.exports = { ask };
