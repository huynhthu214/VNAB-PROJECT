// scripts/test4.js
// Gọi trực tiếp 4 câu từng bị lỗi rewrite (đổi cấp phường/xã -> cấp tỉnh),
// KHÔNG qua runBatchTest.js/Excel, để kiểm tra nhanh sau khi sửa prompt
// trong qa.controller.js. In luôn rewritten_question để so sánh trước/sau.
//
// Cách dùng: node scripts/test4.js

const axios = require("axios");

const API_BASE_URL = "http://localhost:3000/api/v1";

const QUESTIONS = [
  {
    id: "HCM-T2-29-3",
    question:
      "Phường 4, Quận 4 được chia thành bao nhiêu đơn vị hành chính mới?",
    old_rewrite:
      "Phường 4, Quận 4 được sắp xếp thành bao nhiêu đơn vị hành chính mới?",
    old_rerank_score: 0.8495,
    old_answer_type: "no_answer",
  },
  {
    id: "T2-Chanh-My",
    question:
      "Địa bàn Phường Chánh Mỹ, Thành phố Thủ Dầu Một hiện nay thuộc những đơn vị hành chính nào?",
    old_rewrite:
      "Phường Chánh Mỹ thuộc thành phố Thủ Dầu Một hiện nay trực thuộc tỉnh nào?",
    old_rerank_score: 0.9991,
    old_answer_type: "no_answer",
  },
  {
    id: "T2-My-Phuoc",
    question:
      "Địa bàn Phường Mỹ Phước, Thành phố Bến Cát hiện nay thuộc những đơn vị hành chính nào?",
    old_rewrite:
      "Phường Mỹ Phước, thành phố Bến Cát hiện nay thuộc đơn vị hành chính cấp tỉnh nào?",
    old_rerank_score: 0.9993,
    old_answer_type: "no_answer",
  },
  {
    id: "T2-Lai-Uyen",
    question:
      "Địa bàn Thị trấn Lai Uyên, Huyện Bàu Bàng hiện nay thuộc những đơn vị hành chính nào?",
    old_rewrite:
      "Thị trấn Lai Uyên, huyện Bàu Bàng hiện nay thuộc đơn vị hành chính cấp tỉnh nào?",
    old_rerank_score: 0.9992,
    old_answer_type: "no_answer",
  },
];

async function askOne(q) {
  try {
    const res = await axios.post(
      `${API_BASE_URL}/qa/ask`,
      {
        question: q.question,
        model: "advanced_rag",
        llm_provider: "gemini",
        province_id: 1,
      },
      { timeout: 120000 },
    );
    return { ok: true, data: res.data?.data || {}, message: res.data?.message };
  } catch (err) {
    return {
      ok: false,
      error: err.response?.data || err.message,
    };
  }
}

async function run() {
  console.log("Đang gọi 4 câu qua advanced_rag / gemini...\n");

  for (const q of QUESTIONS) {
    console.log("=".repeat(80));
    console.log(`[${q.id}] ${q.question}`);
    console.log(`  Rewrite CŨ : "${q.old_rewrite}"`);
    console.log(
      `  rerank_score CŨ: ${q.old_rerank_score} | answer_type CŨ: ${q.old_answer_type}`,
    );

    const result = await askOne(q);

    if (!result.ok) {
      console.log("  LỖI GỌI API:", result.error);
      continue;
    }

    const {
      answer,
      answer_type,
      rewritten_question,
      rerank_top_score,
      sources,
    } = result.data;

    console.log(
      `  Rewrite MỚI: "${rewritten_question ?? "(không có trong response — có thể là no_answer, xem qa_logs)"}"`,
    );
    console.log(`  answer_type MỚI: ${answer_type}`);
    console.log(`  answer: ${answer ?? "(null)"}`);
    if (sources?.length) {
      console.log(`  sources: ${sources.map((s) => s.document_id).join(", ")}`);
    }

    // So sánh nhanh: rewrite có còn đổi cấp phường/xã -> tỉnh không
    const rw = (rewritten_question || "").toLowerCase();
    const stillDrifted =
      (rw.includes("tỉnh nào") ||
        rw.includes("cấp tỉnh") ||
        rw.includes("thành phố nào")) &&
      !q.question.toLowerCase().includes("tỉnh");
    if (rewritten_question) {
      console.log(
        stillDrifted
          ? "  ⚠️  VẪN CÒN drift cấp hành chính (phường/xã -> tỉnh)"
          : "  ✅ Rewrite đã giữ đúng cấp câu hỏi gốc",
      );
    }
    console.log();
  }

  console.log("Lưu ý: nếu answer_type vẫn là 'no_answer', response KHÔNG trả");
  console.log(
    "rewritten_question (controller chỉ log vào DB, không trả về client",
  );
  console.log("cho nhánh no_answer). Khi đó tra thủ công bằng SQL:");
  console.log(`
SELECT question, rewritten_question, rerank_top_score, answer_type, created_at
FROM qa_logs
WHERE model_used = 'advanced_rag'
ORDER BY created_at DESC
LIMIT 4;
`);
}

run();
