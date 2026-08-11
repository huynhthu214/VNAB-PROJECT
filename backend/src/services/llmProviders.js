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

async function callGemini(systemPrompt, question) {
  const model = genAI.getGenerativeModel({
    model: "gemini-3.5-flash-lite",
    systemInstruction: systemPrompt,
  });
  const result = await model.generateContent(question);
  return result.response.text();
}

async function callGroq(systemPrompt, question) {
  const res = await axios.post(
    "https://api.groq.com/openai/v1/chat/completions",
    {
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
    },
    { headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}` } },
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
  return response.message.content[0].text;
}

const PROVIDERS = { gemini: callGemini, groq: callGroq, cohere: callCohere };

async function callLLM(providerName, systemPrompt, question) {
  const fn = PROVIDERS[providerName];
  if (!fn) {
    throw new Error(
      `Provider không hợp lệ: ${providerName}. Chọn: gemini, groq, mistral`,
    );
  }
  try {
    return await fn(systemPrompt, question);
  } catch (err) {
    if (isConnectionError(err)) {
      throw new ServiceUnavailableError(
        `Không kết nối được LLM provider: ${providerName}`,
      );
    }
    throw err;
  }
}

module.exports = { callLLM, ServiceUnavailableError, isConnectionError };
