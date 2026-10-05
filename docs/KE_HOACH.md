# KẾ HOẠCH TRIỂN KHAI ĐỒ ÁN (BẢN HỢP NHẤT)
## Hệ thống hỏi đáp tự động về địa giới hành chính mới ở khu vực miền Nam Việt Nam
**Nhóm:** Done Team (2 thành viên — Thư: Backend/AI/RAG/Data, Vi: Frontend + dữ liệu các tỉnh khác) | **GVHD:** Thầy Trần Thanh Phước | **Deadline:** 15/11/2026

> File này thay thế `KE_HOACH(1).md` và `KE_HOACH(2).md`. Hai file cũ được viết trước khi framing "4-model ablation" ra đời, trọng tâm khi đó là quy trình phối hợp xây web app (API contract, FE/BE song song). File này cập nhật lại đúng trọng tâm hiện tại: **thực nghiệm và phân tích mô hình là chính, web app chỉ phục vụ demo.**

---

## 0. Ba tiêu chí chấm điểm của giảng viên (khung tổ chức toàn bộ kế hoạch)

| # | Tiêu chí | Ý nghĩa |
|---|---|---|
| 1 | Dữ liệu sẵn có, mô hình sẵn có | Không tự phát minh — trích xuất đúng dữ liệu pháp lý công khai, dùng đúng kỹ thuật RAG/LLM có sẵn |
| 2 | Thực nghiệm được các mô hình trên dữ liệu | Chạy thật, có bộ câu hỏi test cố định, kết quả có cấu trúc, phương pháp hợp lệ (không dùng ngưỡng sai) |
| 3 | Phân tích kết quả, so sánh ưu/khuyết điểm | Giải thích trade-off giữa các model, không chỉ liệt kê số |

Toàn bộ kế hoạch bên dưới tổ chức theo 3 tiêu chí này, không theo timeline song song FE/BE như bản cũ.

---

## 1. Bốn mô hình ablation — thứ tự đúng (đã chốt)

```
Model 1: Rule-based Baseline     — tra bảng unit_mapping trực tiếp, không LLM
Model 2: Naive RAG               — vector search + LLM sinh câu trả lời
Model 3: Advanced RAG            — thêm query rewriting + rerank (BGE-reranker-v2-m3)
Model 4: Modular RAG             — thêm router (structured/hybrid) + hybrid retrieval + RRF
```

> Mỗi model chỉ thêm đúng 1 lớp kỹ thuật so với model liền trước — đây là điều kiện bắt buộc để phân tích ablation hợp lệ ở tiêu chí 3. Không được đảo thứ tự Advanced/Modular trong bất kỳ tài liệu hay slide nào.

---

## 2. Trạng thái hiện tại (chốt tại thời điểm 27/8/2026)

| Hạng mục | Trạng thái |
|---|---|
| Dữ liệu TP.HCM | `du_lieu_tphcm_final_v2.xlsx` — 493 dòng, cross-validate 100%, sẵn sàng |
| Dữ liệu 7 tỉnh còn lại (Vi phụ trách) | Data-ready, **chưa batch-test** |
| Database schema | `schema.sql` v1.3 — 9 bảng, đã migrate trên Docker (`done_team_db`, pgvector/pg16) |
| FastAPI embedding + rerank | `CrossEncoder("BAAI/bge-reranker-v2-m3")`, endpoint `/rerank` đã tích hợp |
| Bộ câu hỏi test | 123 câu, 4 loại (`tra_cuu_truc_tiep`, `suy_luan_tong_hop`, `ngoai_pham_vi`, `mo_ho_viet_sai`) |
| Batch test script | `runBatchTest.js` đã thêm `advanced_rag` vào `MODELS_TO_RUN` |
| **Blocker** | `RERANK_THRESHOLD = 0.5` trong `qa.controller.js` là placeholder — CrossEncoder trả logits, không phải cosine similarity. Toàn bộ kết quả Model 3 chưa tin cậy cho tới khi hiệu chỉnh |

---

## 3. Kế hoạch các bước còn lại (27/8 – 15/11/2026, ~11 tuần)

| Tuần | Ngày | Việc | Đáp ứng tiêu chí | Deliverable |
|---|---|---|---|---|
| 1 | 28/8 – 3/9 | Pilot test 10–20 câu để hiệu chỉnh `RERANK_THRESHOLD` (thang điểm CrossEncoder khác cosine, không dùng lại ngưỡng 0.75 của Model 2) | #2 | Ngưỡng rerank đã chốt, ghi lại lý do chọn |
| 2 | 4/9 – 10/9 | Chạy batch chính thức 123 câu × 4 model, xuất kết quả `.xlsx` | #2 | File kết quả batch đầy đủ |
| 3–4 | 11/9 – 24/9 | Chấm tay 492 kết quả (5 nhãn: đúng/sai/một phần/no_answer hợp lệ/lỗi hạ tầng); tính accuracy tổng + theo loại câu hỏi | #3 | Bảng accuracy theo model × loại câu hỏi |
| 5 | 25/9 – 1/10 | So sánh từng cặp model liền kề (M1→M2, M2→M3, M3→M4): cải thiện gì, tốn gì (độ trễ, chi phí gọi rerank/router) | #3 | Bảng so sánh cặp + phân tích trade-off |
| 6 | 2/10 – 8/10 | Phân tích lỗi: nhóm nguyên nhân sai (retrieval sai chunk, disambiguation trùng tên, bỏ sót `mot_phan`, LLM diễn giải lệch) | #3 | Danh sách lỗi điển hình có ví dụ |
| 7 | 9/10 – 15/10 | (Nếu còn thời gian) Batch test dữ liệu 7 tỉnh còn lại — chỉ làm sau khi TP.HCM đã có kết quả chốt | #1 (mở rộng) | Kết quả batch 7 tỉnh (không bắt buộc) |
| 8 | 16/10 – 22/10 | Dọn code: xóa `routes/qa.js` nếu xác nhận dead code; cập nhật `API_DOC.md`, `THIET_KE_DATABASE.md` theo kết quả thực tế | #1, #2 | Tài liệu kỹ thuật cập nhật |
| 9 | 23/10 – 29/10 | Viết báo cáo: kiến trúc hệ thống, thiết kế CSDL, kết quả thực nghiệm | #1, #2, #3 | Bản nháp báo cáo phần kỹ thuật |
| 10 | 30/10 – 5/11 | Viết báo cáo: phân tích ablation, hạn chế, hướng phát triển; hoàn thiện web demo (chỉ phần trình bày, không thêm tính năng mới) | #3 | Bản nháp báo cáo hoàn chỉnh + slide |
| 11 | 6/11 – 15/11 | Buffer: rà soát số liệu, sửa lỗi phát sinh, quay demo, nộp bài | — | **Nộp đồ án 15/11/2026** |

---

## 4. Nguyên tắc bắt buộc khi thực nghiệm và phân tích

- **`no_answer` ≠ lỗi hệ thống.** `no_answer` là hành vi hợp lệ khi câu hỏi ngoài phạm vi (`ngoai_pham_vi`) → tính là "đúng". `success: false` mới là lỗi hạ tầng → loại khỏi mẫu số khi tính accuracy, không tính là lỗi của model.
- **Web search (nếu có) tách biệt hoàn toàn khỏi 4 model chính** — chỉ dùng khi retrieval nội bộ thất bại, chỉ nguồn chính thống (vbpl.vn, chinhphu.vn), label riêng để không nhiễu kết quả thực nghiệm.
- **Cố định 1 LLM provider cho toàn bộ batch test chính thức.** Hiện có 4 provider (Gemini, Groq, Cohere, OpenRouter) với fallback error handling — nếu dùng lẫn lộn trong cùng lượt so sánh 4 model, không thể xác định câu trả lời sai là do kiến trúc RAG kém hay do provider fallback hôm đó lỗi. Chốt 1 provider chính, fallback chỉ dùng khi lỗi hạ tầng và loại khỏi thống kê.
- **Dữ liệu một phần (`merge_type = 'mot_phan'`) phải xử lý riêng** trong sinh câu trả lời — không mặc định lấy dòng đầu tiên khi 1 đơn vị cũ trả về nhiều dòng trong `unit_mapping`.
- **Tên đơn vị trùng lặp phải disambiguate bằng `parent_name`** (VD "Phường 7" tồn tại ở 11 quận khác nhau).

---

## 5. Phân biệt phạm vi khi báo cáo với giảng viên

Tên đề tài nhắc "khu vực miền Nam Việt Nam" nhưng dữ liệu validated hiện chỉ có TP.HCM (mới). Phải nói rõ trong báo cáo, không để giảng viên tự phát hiện:

| Phạm vi | Trạng thái | Vai trò trong báo cáo |
|---|---|---|
| TP.HCM (mới, hợp nhất từ TP.HCM + Bình Dương + Bà Rịa–Vũng Tàu cũ) | Validated, đã/sẽ thực nghiệm đầy đủ 4 model | Kết quả chính, trọng tâm phân tích |
| 7 tỉnh miền Nam còn lại | Data-ready, kiến trúc hỗ trợ sẵn (đã bỏ CHECK constraint giới hạn tỉnh trong `schema.sql` migration 9) | Hướng phát triển / mở rộng nếu kịp — không phải kết quả chính |

---

## 6. Công cụ & tài liệu tham chiếu

- **DB:** PostgreSQL 16 (pgvector), Docker Compose, container `done_team_db`
- **Embedding/Rerank:** FastAPI local, `bge-m3`, `CrossEncoder("BAAI/bge-reranker-v2-m3")`
- **LLM:** Gemini, Groq, Cohere, OpenRouter (fallback error handling)
- **Testing:** Postman (API), `runBatchTest.js` (batch), kết quả `.xlsx` (tránh lỗi encoding CSV với tiếng Việt)
- **Pháp lý:** Nghị quyết 202/2025/QH15, Nghị quyết 1685/NQ-UBTVQH15; nguồn: vbpl.vn, chinhphu.vn
- **File kỹ thuật hiện hành:** `schema.sql` v1.3, `API_DOC_v1.3.md`, `THIET_KE_DATABASE_v1.2.md`, `qa.controller.js`, `runBatchTest.js`

---

*File này cập nhật khi có thay đổi. Không dùng lại `KE_HOACH(1).md`/`KE_HOACH(2).md` làm tài liệu trình bày tiến độ — 2 file đó phản ánh trọng tâm cũ (xây web app), không khớp với 3 tiêu chí chấm điểm hiện tại.*
