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
  return (
    err.code === "ECONNREFUSED" ||
    err.code === "ETIMEDOUT" ||
    err.code === "ENOTFOUND" ||
    err.status >= 500 ||
    err.response?.status >= 500
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
  });
  const result = await model.generateContent(question);
  return result.response.text();
}

async function callGeminiReasoning(systemPrompt, question) {
  const model = genAI.getGenerativeModel({
    model: "gemini-3.1-pro", // model mạnh hơn hẳn flash-lite, hỗ trợ suy luận sâu
    systemInstruction: systemPrompt,
    generationConfig: {
      thinkingConfig: {
        thinkingLevel: "high", // mức suy luận cao nhất hỗ trợ
      },
    },
  });
  const result = await model.generateContent(question);
  return result.response.text();
}

async function callOpenRouter(systemPrompt, question) {
  const res = await axios.post(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      model: "openrouter/free",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
    },
    { headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` } },
  );
  return res.data.choices[0].message.content;
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
  if (!textPart) {
    throw new Error(
      "Cohere không trả về nội dung text hợp lệ: " +
        JSON.stringify(response.message.content),
    );
  }
  return textPart.text;
}

const PROVIDERS = {
  gemini: callGemini,
  cohere: callCohere,
  openrouter: callOpenRouter,
  gemini_reasoning: callGeminiReasoning,
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

async function callLLMWithFallback(
  systemPrompt,
  question,
  preferredProvider = "gemini",
) {
  const order = [
    preferredProvider,
    ...FALLBACK_ORDER.filter((p) => p !== preferredProvider),
  ];
  const attempted = [];

  for (const provider of order) {
    attempted.push(provider);
    try {
      const answer = await callLLM(provider, systemPrompt, question);
      return {
        answer,
        actual_provider: provider,
        fallback_used: attempted.length > 1,
        provider_attempted_order: attempted.join(" -> "),
      };
    } catch (err) {
      if (
        err instanceof RateLimitError ||
        err instanceof ServiceUnavailableError
      )
        continue;
      throw err;
    }
  }
  throw new ServiceUnavailableError("Tất cả LLM provider đều không khả dụng");
}

module.exports = {
  callLLM,
  ServiceUnavailableError,
  RateLimitError,
  isConnectionError,
};
