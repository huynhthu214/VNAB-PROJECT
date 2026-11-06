// Chạy: node runDebug.js questions_t1_hcm.json cohere advanced_rag
// Gửi từng câu vào backend đang chạy, in tóm tắt. Log prompt do SERVER ghi (DEBUG_PROMPT_LOG=1).
const fs = require("fs");
const axios = require("axios");

const [
  file = "questions_t1_hcm.json",
  provider = "gemini",
  model = "advanced_rag",
  tag,
] = process.argv.slice(2);
const BASE = process.env.API_BASE || "http://localhost:3000/api/v1";
const DELAY_MS = 4500; // giống runBatchTest.js, tránh rate limit
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const items = JSON.parse(fs.readFileSync(file, "utf8"));
  const out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const body = { question: it.question, llm_provider: provider, model };
    if (it.province_code) body.province_code = it.province_code;
    let row;
    const post = async () =>
      axios.post(`${BASE}/qa/ask`, body, { timeout: 120000 });
    try {
      let res;
      try {
        res = await post();
      } catch (e1) {
        // lỗi (thường là rate limit): chờ 20s, thử lại đúng 1 lần, giống runBatchTest.js
        console.log(
          `   lỗi: ${e1.response?.data?.message || e1.message} -> chờ 20s thử lại`,
        );
        await sleep(20000);
        res = await post();
      }
      const d = res.data?.data || {};
      row = {
        n: i + 1,
        test_id: it.test_id,
        question: it.question,
        success: res.data?.success,
        answer_type: d.answer_type,
        rewritten_question: d.rewritten_question,
        rerank_top_score: d.rerank_top_score,
        answer: d.answer,
      };
    } catch (e) {
      row = {
        n: i + 1,
        test_id: it.test_id,
        question: it.question,
        success: false,
        error: e.response?.data?.message || e.message,
      };
    }
    out.push(row);
    console.log(
      `[${row.n}/${items.length}] ${row.answer_type || "ERROR"} | ${row.question}`,
    );
    await sleep(DELAY_MS);
  }
  const f = `result_${tag || provider + "_" + model}.json`;
  fs.writeFileSync(f, JSON.stringify(out, null, 2), "utf8");
  console.log("Đã ghi", f);
  // Tóm tắt theo từng câu hỏi: bao nhiêu lần trả lời / từ chối / lỗi
  const sum = {};
  for (const r of out) {
    const k = r.question.slice(0, 60);
    sum[k] = sum[k] || { tra_loi: 0, tu_choi: 0, loi: 0 };
    if (r.error || r.success === false) sum[k].loi++;
    else if (r.answer_type === "no_answer") sum[k].tu_choi++;
    else sum[k].tra_loi++;
  }
  console.table(sum);
})();
