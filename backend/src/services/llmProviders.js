const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

class ServiceUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "ServiceUnavailableError";
  }
}

function isConnectionError(err) {
  const causeCode = err.cause?.code;
  return (
    err.code === "ECONNREFUSED" ||
    err.code === "ETIMEDOUT" ||
    err.code === "ECONNABORTED" || // ← THÊM — axios timeout
    err.status >= 500 ||
    err.response?.status >= 500 ||
    err.message === "fetch failed" ||
    (err.message && err.message.includes("timeout")) || // ← THÊM — bắt cả câu "timeout of Nms exceeded"
    causeCode === "ECONNREFUSED" ||
    causeCode === "ETIMEDOUT" ||
    causeCode === "ENOTFOUND"
  );
}

function isRateLimitError(err) {
  return err.status === 429 || err.response?.status === 429;
}

class RateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = "RateLimitError";
  }
}

async function callGemini(systemPrompt, question) {
  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash-lite",
    systemInstruction: systemPrompt,
    generationConfig: {
      thinkingConfig: { thinkingLevel: "medium" }, // bật suy luận vừa phải, không cần "high" để tiết kiệm token/thời gian
    },
  });
  const result = await model.generateContent(question);
  const usage = result.response.usageMetadata; // Gemini SDK tự trả kèm
  return {
    text: result.response.text(),
    input_tokens: usage?.promptTokenCount ?? null,
    output_tokens: usage?.candidatesTokenCount ?? null,
  };
}

async function callGroq(systemPrompt, question) {
  const res = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: "openai/gpt-oss-120b",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
    },
    { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } },
  );
  return {
    text: res.data.choices[0].message.content,
    input_tokens: res.data.usage?.prompt_tokens ?? null,
    output_tokens: res.data.usage?.completion_tokens ?? null,
  };
}

const { CohereClientV2 } = require("cohere-ai");
const cohere = new CohereClientV2({ token: process.env.COHERE_API_KEY });

async function callCohere(systemPrompt, question) {
  const response = await cohere.chat({
    model: "command-a-plus-05-2026",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: question },
    ],
  });
  const textPart = response.message.content.find((c) => c.type === "text");
  if (!textPart) throw new Error("Cohere không trả về nội dung text hợp lệ");

  return {
    text: textPart.text,
    input_tokens: response.usage?.tokens?.inputTokens ?? null,
    output_tokens: response.usage?.tokens?.outputTokens ?? null,
  };
}

const PROVIDERS = {
  gemini: callGemini,
  cohere: callCohere,
  groq: callGroq,
};

async function callLLM(providerName, systemPrompt, question) {
  const fn = PROVIDERS[providerName];
  if (!fn) throw new Error(`Provider không hợp lệ: ${providerName}`);
  try {
    return await fn(systemPrompt, question);
  } catch (err) {
    if (isRateLimitError(err)) {
      throw new RateLimitError(`Vượt giới hạn tần suất: ${providerName}`);
    }
    if (isConnectionError(err)) {
      throw new ServiceUnavailableError(
        `Không kết nối được LLM provider: ${providerName}`,
      );
    }
    throw err;
  }
}

module.exports = {
  callLLM,
  PROVIDERS,
  ServiceUnavailableError,
  RateLimitError,
  isConnectionError,
};
