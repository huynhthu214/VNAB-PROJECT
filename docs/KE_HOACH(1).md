# KẾ HOẠCH TRIỂN KHAI ĐỒ ÁN
## Hệ thống hỏi đáp tự động (RAG) về địa giới hành chính mới TP. Hồ Chí Minh
**Nhóm:** Done Team (2 thành viên) | **Deadline:** 15/11/2026 | **GVHD:** Thầy Trần Thanh Phước

---

## 0. Bối cảnh & điều chỉnh phạm vi theo yêu cầu GVHD

Theo phản hồi của thầy, phạm vi được **thu hẹp về TP.HCM (mới)** trước, chưa mở rộng cả miền Nam. Đây là lựa chọn hợp lý vì:

- Ngày 1/7/2025, TP.HCM chính thức hợp nhất với tỉnh Bình Dương và tỉnh Bà Rịa – Vũng Tàu theo <cite index="4-1">Nghị quyết số 202/2025/QH15 của Quốc hội thông qua ngày 12/6/2025 về việc sắp xếp đơn vị hành chính cấp tỉnh</cite>, trên cơ sở chủ trương tại Nghị quyết 60-NQ/TW ngày 12/4/2025 của Ban Chấp hành Trung ương.
- <cite index="4-1">Sau khi sắp xếp, TP.HCM có diện tích tự nhiên khoảng 6.772,59 km², quy mô dân số khoảng 14.002.598 người, với 168 xã, phường, đặc khu hành chính</cite>, chính thức vận hành từ 1/7/2025.
- Đây là bộ dữ liệu **vừa mới, vừa lớn, vừa có nhu cầu tra cứu thực tế cao** (người dân, doanh nghiệp thường xuyên hỏi "phường/xã cũ X giờ thuộc đâu?") → rất phù hợp làm phạm vi MVP (Minimum Viable Product) trước khi mở rộng ra Bình Dương (cũ) và Bà Rịa – Vũng Tàu (cũ) nếu còn thời gian.

**Phạm vi đề xuất cho đồ án (giai đoạn 1 – bắt buộc hoàn thành):**
> Hệ thống hỏi đáp tự động về đơn vị hành chính TP.HCM sau sắp xếp (168 xã/phường/đặc khu), bao gồm cả dữ liệu 3 địa bàn cũ (TP.HCM cũ, Bình Dương cũ, Bà Rịa – Vũng Tàu cũ) vì bản thân TP.HCM mới đã bao trùm 3 địa bàn này.

**Phạm vi mở rộng (nếu còn thời gian, không bắt buộc):** áp dụng kiến trúc đã xây dựng để nạp thêm dữ liệu các tỉnh/thành khác ở miền Nam.

---

## 1. TIMELINE TỔNG THỂ (15 tuần, 28/7/2026 → 15/11/2026)

| Giai đoạn | Thời gian | Nội dung chính | Deliverable |
|---|---|---|---|
| **GĐ0 – Chốt đề cương** | 28/7 – 3/8 (Tuần 1) | Viết lại đề cương chi tiết theo phạm vi mới, xin duyệt thầy | Đề cương v2 được duyệt |
| **GĐ1 – Khảo sát & thu thập dữ liệu** | 4/8 – 17/8 (Tuần 2–3) | Thu thập văn bản pháp lý, xây bảng ánh xạ đơn vị cũ–mới | Bộ dữ liệu thô + bảng ánh xạ nháp |
| **GĐ2 – Thiết kế hệ thống** | 18/8 – 24/8 (Tuần 4) | Thiết kế CSDL, kiến trúc tổng thể, **chốt API contract** | Tài liệu thiết kế + API spec (OpenAPI) |
| **GĐ3 – Phát triển song song** | 25/8 – 5/10 (Tuần 5–10, 6 tuần) | BE & FE làm song song theo API contract, dùng mock data | BE: API hoạt động qua Postman. FE: UI hoạt động với mock |
| **GĐ4 – Tích hợp & RAG** | 6/10 – 19/10 (Tuần 11–12) | Ghép FE–BE thật, xây pipeline RAG (retrieval + citation) | Hệ thống end-to-end chạy được |
| **GĐ5 – Kiểm thử & đánh giá** | 20/10 – 2/11 (Tuần 13–14) | Test với bộ câu hỏi mẫu, đo độ chính xác, sửa lỗi | Báo cáo đánh giá độ chính xác |
| **GĐ6 – Viết báo cáo & hoàn thiện** | 3/11 – 9/11 (Tuần 15) | Viết báo cáo đồ án, slide bảo vệ | Bản nháp báo cáo hoàn chỉnh |
| **GĐ7 – Buffer & nộp bài** | 10/11 – 15/11 (Tuần 16) | Rà soát, sửa lỗi phát sinh, quay demo, nộp bài | **Nộp đồ án 15/11/2026** |

> Lưu ý: GĐ3 là giai đoạn dài nhất và rủi ro nhất vì 2 người làm song song — đây là lý do phải chốt API contract thật kỹ ở GĐ2 (mục 3 bên dưới) để tránh việc đến GĐ4 mới phát hiện lệch nhau.

---

## 2. PHÂN CÔNG CÔNG VIỆC (Backend / Frontend)

Giả định: **Thành viên A = Backend & Dữ liệu/RAG**, **Thành viên B = Frontend & Testing UX**. Cả hai cùng làm khảo sát dữ liệu và viết báo cáo.

| # | Hạng mục | Người phụ trách | Công việc cụ thể | Tuần |
|---|---|---|---|---|
| 1 | Khảo sát dữ liệu | **Cả 2** | Thu thập Nghị quyết 202/2025/QH15, các quyết định của UBND TP.HCM, HĐND về đặt tên/ranh giới xã phường mới; đối chiếu bản đồ cũ–mới | 2–3 |
| 2 | Thiết kế CSDL | A (chủ trì), B (review) | Thiết kế schema quan hệ (đơn vị hành chính cũ, mới, quyết định pháp lý) | 4 |
| 3 | Thiết kế UI/UX | B (chủ trì), A (review) | Wireframe giao diện hỏi đáp, khung hiển thị nguồn trích dẫn | 4 |
| 4 | **Chốt API contract** | **Cả 2 cùng thống nhất** | Viết OpenAPI spec, thống nhất format response, mã lỗi | 4 |
| 5 | Xây dựng CSDL & nạp dữ liệu | A | Import, chuẩn hóa dữ liệu vào PostgreSQL + Vector DB | 5–7 |
| 6 | Xây dựng module RAG | A | Chunk văn bản, embedding, retrieval, kết nối LLM, sinh câu trả lời kèm trích dẫn | 6–9 |
| 7 | Xây dựng API endpoints | A | `/search`, `/ask`, `/units/{id}`, `/health`... theo spec đã chốt | 5–9 |
| 8 | Xây dựng giao diện Frontend | B | Trang chủ, khung chat hỏi đáp, trang hiển thị chi tiết đơn vị, trang nguồn trích dẫn | 5–9 |
| 9 | Mock server cho Frontend | B (dùng công cụ), A hỗ trợ định nghĩa | Dùng mock data theo đúng API contract để B không bị chặn tiến độ khi chờ BE | 5 |
| 10 | Viết test case API (Postman) | A | Bộ Postman collection test từng endpoint | 6–9 |
| 11 | Viết test case UI/UX | B | Test luồng người dùng, responsive, xử lý lỗi hiển thị | 6–9 |
| 12 | Tích hợp FE–BE thật | Cả 2 (pair-testing) | Thay mock bằng API thật, debug các lệch dữ liệu | 11–12 |
| 13 | Xây bộ câu hỏi kiểm thử (~100–150 câu) | Cả 2 | Chia loại: tra cứu trực tiếp, suy luận, câu hỏi mơ hồ, câu hỏi ngoài phạm vi | 13 |
| 14 | Đo độ chính xác hệ thống | A (kỹ thuật đo), B (tổng hợp báo cáo) | Precision/Recall retrieval, độ chính xác câu trả lời, độ trễ | 13–14 |
| 15 | Viết báo cáo & slide | Cả 2 (chia chương) | A: kiến trúc kỹ thuật + RAG. B: UI/UX + kiểm thử + demo | 15 |

---

## 3. QUY TẮC THIẾT KẾ API (để 2 người không "vênh" nhau khi ghép & test)

Đây là phần **quan trọng nhất** để tiết kiệm thời gian tích hợp. Hai bạn nên viết ra một file `API_CONTRACT.md` dùng chung trong repo và **không ai được tự ý đổi mà không báo bên kia**.

### 3.1 Nguyên tắc chung
- Base URL: `https://api.done-team.local/api/v1` (versioning ngay từ đầu: `/api/v1/...`)
- Định dạng: JSON, `Content-Type: application/json; charset=utf-8`
- Đặt tên endpoint: **danh từ số nhiều, kebab-case hoặc snake_case thống nhất một kiểu** — chọn `kebab-case` cho URL (VD: `/admin-units`, `/qa/ask`), `snake_case` cho field trong JSON body (VD: `old_name`, `new_name`, `decision_number`).
- HTTP method chuẩn REST: `GET` (đọc), `POST` (tạo/hỏi), `PUT`/`PATCH` (sửa), `DELETE` (xóa) — đồ án chủ yếu dùng GET và POST.

### 3.2 Format response thống nhất (bắt buộc mọi endpoint tuân theo)
```json
// Thành công
{
  "success": true,
  "data": { ... },
  "message": "OK"
}

// Lỗi
{
  "success": false,
  "data": null,
  "message": "Mô tả lỗi dễ hiểu",
  "error_code": "UNIT_NOT_FOUND"
}
```
→ Frontend chỉ cần luôn check `success` trước, không cần đoán cấu trúc lỗi khác nhau giữa các API.

### 3.3 Bảng mã lỗi chuẩn (thống nhất trước, tránh BE tự chế mỗi lần)
| error_code | HTTP status | Ý nghĩa |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Tham số đầu vào sai/thiếu |
| `UNIT_NOT_FOUND` | 404 | Không tìm thấy đơn vị hành chính |
| `NO_ANSWER_FOUND` | 200 | RAG không tìm được câu trả lời phù hợp (vẫn trả 200, `data.answer = null`) |
| `RATE_LIMITED` | 429 | Quá tần suất gọi hỏi đáp |
| `INTERNAL_ERROR` | 500 | Lỗi hệ thống |

### 3.4 Danh sách endpoint đề xuất (chốt trước khi code)
| Method | Endpoint | Mô tả |
|---|---|---|
| `POST` | `/qa/ask` | Gửi câu hỏi tự nhiên, nhận câu trả lời + nguồn trích dẫn |
| `GET` | `/admin-units` | Danh sách đơn vị hành chính (có filter, phân trang) |
| `GET` | `/admin-units/{id}` | Chi tiết 1 đơn vị (tên cũ, tên mới, quyết định, bản đồ) |
| `GET` | `/admin-units/search?old_name=` | Tra cứu nhanh theo tên cũ |
| `GET` | `/documents/{id}` | Xem văn bản pháp lý gốc / đoạn trích được cite |
| `GET` | `/health` | Kiểm tra hệ thống còn sống (dùng để test nhanh khi ghép nối) |

### 3.5 Quy trình làm việc song song không bị chặn nhau
1. **Tuần 4:** Cả hai cùng ngồi viết `API_CONTRACT.md` (OpenAPI/Swagger) — kể cả khi BE chưa code gì cả.
2. B dùng công cụ mock (VD: **Mock Service Worker – MSW**, **json-server**, hoặc Postman Mock Server) để dựng dữ liệu giả **đúng 100% theo contract**, phát triển FE độc lập không phải chờ A.
3. A phát triển BE thật theo đúng contract, tự test bằng Postman collection dùng chung.
4. Mỗi khi 1 endpoint BE thật xong → A báo trong nhóm chat kèm ví dụ response thật → B đổi 1 dòng cấu hình (base URL / feature flag) để chuyển từ mock sang thật, không phải sửa code UI.
5. Dùng chung 1 **Postman Collection** (export file `.json`, đẩy lên Git) để cả hai test bằng cùng bộ request mẫu — tránh tình trạng "trên máy tôi chạy được".
6. Git: mỗi người 1 nhánh `feature/backend-...` / `feature/frontend-...`, merge vào `develop` qua Pull Request, người kia review trước khi merge.
7. Biến môi trường (`API_BASE_URL`, API key LLM...) để trong file `.env.example` dùng chung, không hard-code.

---

## 4. HƯỚNG DẪN KỸ THUẬT CHI TIẾT

### 4.1 Thu thập & chuẩn hóa dữ liệu (GĐ1)
- **Nguồn dữ liệu chính thức cần thu thập:**
  - Nghị quyết 202/2025/QH15 (Quốc hội) — văn bản gốc về sắp xếp đơn vị hành chính cấp tỉnh.
  - Các Nghị quyết của Ủy ban Thường vụ Quốc hội / HĐND TP.HCM về sắp xếp đơn vị hành chính cấp xã (tên phường/xã mới, ranh giới, trụ sở đặt tại đâu).
  - Cổng thông tin điện tử Chính phủ, Cổng thông tin TP.HCM, Sở Nội vụ TP.HCM.
- **Chuẩn hóa thành bảng ánh xạ** với các trường tối thiểu:
  `old_unit_name | old_unit_type | old_parent (quận/huyện/tỉnh cũ) | new_unit_name | new_unit_type | new_parent | decision_number | decision_date | source_document_url | notes`
- Lưu song song 2 dạng: (a) **dữ liệu có cấu trúc** (bảng ánh xạ, để trả lời câu hỏi tra cứu chính xác — không cần LLM đoán), (b) **dữ liệu phi cấu trúc** (toàn văn nghị quyết, quyết định — dùng cho RAG khi câu hỏi phức tạp/diễn giải).

### 4.2 Thiết kế CSDL
- **PostgreSQL** (hoặc MySQL) cho dữ liệu có cấu trúc: bảng `admin_units_old`, `admin_units_new`, `unit_mapping`, `legal_documents`.
- **Vector Database** (Chroma, Qdrant, hoặc pgvector ngay trong Postgres — khuyến nghị pgvector để không phải quản lý 2 hệ CSDL) cho phần embedding văn bản pháp lý, dùng cho RAG.
- Thiết kế sao cho mỗi **chunk văn bản trong vector DB đều lưu `document_id`, `source_url`, `page/section`** để khi trả lời có thể trích dẫn chính xác về đâu.

### 4.3 Kiến trúc RAG (module lõi, do A phụ trách)
Luồng xử lý một câu hỏi:
1. **Nhận câu hỏi** → tiền xử lý (chuẩn hóa dấu tiếng Việt, tách từ khóa tên địa danh).
2. **Truy vấn dữ liệu có cấu trúc trước** (nếu câu hỏi dạng "X cũ giờ là gì?" thì tra bảng `unit_mapping` trực tiếp — nhanh, chính xác 100%, không cần LLM đoán).
3. Nếu không khớp trực tiếp → **Retrieval trên Vector DB**: embed câu hỏi, lấy top-k đoạn văn bản pháp lý liên quan.
4. (Tùy chọn nâng cao) **Rerank** top-k bằng mô hình rerank để tăng độ chính xác.
5. **Sinh câu trả lời**: đưa câu hỏi + các đoạn trích vào LLM, yêu cầu LLM chỉ trả lời dựa trên đoạn trích được cung cấp, kèm trích dẫn nguồn (chỉ số đoạn/tài liệu).
6. **Đối chiếu & hiển thị nguồn**: trả về kèm `source_document_url`, đoạn trích gốc rút gọn để người dùng tự kiểm chứng — đúng yêu cầu "hiển thị nguồn trích dẫn để tăng độ tin cậy" trong đề cương ban đầu.
7. Nếu retrieval không tìm được đoạn nào đủ liên quan (dưới ngưỡng similarity) → trả `NO_ANSWER_FOUND`, không để LLM "bịa" câu trả lời (chống hallucination).

### 4.4 Gợi ý stack công nghệ
| Thành phần | Gợi ý công cụ |
|---|---|
| Backend framework | Python (FastAPI) hoặc Node.js (Express/NestJS) |
| CSDL quan hệ | PostgreSQL |
| Vector DB | pgvector / Qdrant / Chroma |
| Embedding | mô hình embedding đa ngôn ngữ hỗ trợ tiếng Việt |
| LLM sinh câu trả lời | API LLM (OpenAI/Claude) hoặc mô hình mở nếu cần chạy offline |
| Frontend | React (Vite) hoặc Vue 3 |
| Test API | Postman / Newman (chạy tự động) |
| Quản lý mã nguồn | Git + GitHub, quy trình branch/PR như mục 3.5 |

### 4.5 Kiểm thử & đánh giá độ chính xác (GĐ5)
- Xây bộ **~100–150 câu hỏi test**, chia nhóm:
  - Tra cứu trực tiếp: "Phường Bến Nghé cũ bây giờ thuộc phường nào?"
  - Suy luận/tổng hợp: "Những xã nào của Bình Dương cũ nay thuộc TP.HCM?"
  - Câu hỏi mơ hồ/viết sai chính tả: kiểm tra độ bền của hệ thống.
  - Câu hỏi ngoài phạm vi: kiểm tra hệ thống có từ chối đúng cách thay vì bịa.
- **Chỉ số đo lường:**
  - Retrieval: Precision@k, Recall@k trên các đoạn văn bản liên quan đã gán nhãn tay.
  - Câu trả lời: đối chiếu thủ công đúng/sai/một phần trên từng nhóm câu hỏi, tính tỉ lệ % chính xác theo từng loại.
  - Độ trễ trung bình mỗi câu hỏi (ms).
- Trình bày kết quả dạng bảng + biểu đồ trong báo cáo, nêu rõ hạn chế (VD: câu hỏi mơ hồ dễ sai hơn câu hỏi trực tiếp).

### 4.6 Cấu trúc báo cáo đề xuất
1. Đặt vấn đề & phạm vi (giải thích lý do thu hẹp về TP.HCM theo góp ý GVHD)
2. Khảo sát dữ liệu & nguồn pháp lý
3. Kiến trúc hệ thống (sơ đồ tổng thể, sơ đồ luồng RAG)
4. Thiết kế CSDL
5. Chi tiết cài đặt Backend/Frontend
6. Kết quả kiểm thử & đánh giá độ chính xác
7. Hạn chế & hướng phát triển (mở rộng ra Bình Dương cũ, Bà Rịa – Vũng Tàu cũ, rồi cả miền Nam)
8. Phân công công việc & tự đánh giá đóng góp từng thành viên

---

## 5. RỦI RO CẦN LƯU Ý & MỐC CẢNH BÁO

| Rủi ro | Mốc cảnh báo | Cách phòng tránh |
|---|---|---|
| Dữ liệu pháp lý rải rác, thiếu văn bản gốc | Cuối tuần 3 | Nếu đến hết tuần 3 chưa đủ dữ liệu cho toàn bộ 168 đơn vị, ưu tiên hoàn thiện 1 khu vực mẫu (VD: khu vực trung tâm cũ) rồi mở rộng dần |
| API contract thay đổi giữa chừng làm FE phải sửa lại | Bất kỳ lúc nào trong GĐ3 | Mọi thay đổi contract phải thông báo trước, ghi log thay đổi trong `API_CONTRACT.md` |
| LLM trả lời sai/bịa thông tin (hallucination) | GĐ4–5 | Bắt buộc có bước kiểm tra similarity threshold + luôn hiển thị nguồn để người dùng tự đối chiếu |
| Tích hợp FE–BE trễ hơn dự kiến | Đầu tuần 11 | Nhờ làm mock từ tuần 5, rủi ro này giảm đáng kể; nếu vẫn trễ, cắt bớt tính năng phụ (VD: rerank nâng cao) chứ không cắt phần lõi RAG |
| Không đủ thời gian viết báo cáo | Tuần 15 | Viết báo cáo song song ngay từ GĐ3–4 (viết phần kiến trúc/thiết kế trước khi mọi thứ chạy xong), không dồn hết vào tuần cuối |

---

*Tài liệu này nên được lưu trong repo chung (VD: `docs/KE_HOACH.md`) và cập nhật khi có thay đổi để cả nhóm cùng theo dõi.*
