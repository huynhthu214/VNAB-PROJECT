# API DOCUMENTATION (v1.3 — bổ sung cho 4 model)
## Hệ thống hỏi đáp tự động về địa giới hành chính TP.HCM (Done Team)

> **Thay đổi so với v1.2:** hệ thống giờ so sánh **4 model** thay vì 3 (thêm Advanced RAG). Response của `POST /qa/ask` bổ sung field `model_used` và `rewritten_question` (chỉ có giá trị khi dùng Advanced RAG). Thêm error_code `SERVICE_UNAVAILABLE`. Xem lý do đầy đủ ở `DE_XUAT_4_MO_HINH_HOI_DAP_v3.md`.

*(Chỉ liệt kê phần thay đổi/bổ sung so với v1.2. Các mục khác — `/provinces`, `/admin-units`, `/documents/{id}`, `/feedback`, `/health` — giữ nguyên, xem file gốc.)*

---

## 1. Bảng mã lỗi (cập nhật — thêm 1 dòng)

| error_code | HTTP status | Ý nghĩa |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Tham số đầu vào sai/thiếu |
| `PROVINCE_NOT_FOUND` | 404 | Không tìm thấy tỉnh/thành |
| `UNIT_NOT_FOUND` | 404 | Không tìm thấy đơn vị hành chính cấp xã/phường |
| `DOCUMENT_NOT_FOUND` | 404 | Không tìm thấy văn bản/nguồn trích dẫn |
| `NO_ANSWER_FOUND` | 200 | RAG không tìm được câu trả lời đủ tin cậy |
| `RATE_LIMITED` | 429 | Gọi API hỏi đáp quá tần suất cho phép |
| **`SERVICE_UNAVAILABLE`** *(mới)* | **503** | **Không kết nối được tới dịch vụ AI bên ngoài (embedding/LLM/rerank API)** |
| `INTERNAL_ERROR` | 500 | Lỗi hệ thống ngoài dự kiến |

---

## 2. `POST /qa/ask` — cập nhật response cho 4 model

**Request body:** không đổi.
```json
{ "question": "Phường Bến Nghé cũ bây giờ là phường gì?", "session_id": "sess_abc123" }
```

### 2.1 Field mới trong `data`

| Field | Kiểu | Áp dụng cho model nào | Mô tả |
|---|---|---|---|
| `model_used` *(mới)* | string | Tất cả | `rule_based` \| `naive_rag` \| `advanced_rag` \| `modular_rag` — cho biết câu trả lời này đến từ model nào (hữu ích khi demo cho phép người dùng chọn model để so sánh trực tiếp) |
| `rewritten_question` *(mới)* | string \| null | Chỉ `advanced_rag` | Câu hỏi sau khi LLM viết lại (chuẩn hóa chính tả, làm rõ ý mơ hồ) trước khi tìm kiếm. `null` với các model khác |
| `routing_decision` *(đã có từ trước, làm rõ lại)* | string \| null | Chỉ `modular_rag` | `structured` (router chuyển sang tra `unit_mapping` trực tiếp) hoặc `hybrid` (router chuyển sang hybrid retrieval) |

### 2.2 Response mẫu — Model 3 (Advanced RAG)

```json
{
  "success": true,
  "data": {
    "answer": "Phường Bến Nghé (cũ) hiện nay thuộc Phường Sài Gòn, được thành lập trên cơ sở hợp nhất các phường Bến Nghé, Bến Thành và Nguyễn Thái Bình theo Nghị quyết 1685/NQ-UBTVQH15.",
    "answer_type": "rag_generated",
    "answer_level": "unit",
    "model_used": "advanced_rag",
    "rewritten_question": "Phường Bến Nghé trước sáp nhập hiện nay là phường nào?",
    "confidence": 0.93,
    "sources": [
      {
        "document_id": "doc_0042",
        "title": "Nghị quyết 1685/NQ-UBTVQH15",
        "excerpt": "...(đoạn trích ngắn, dưới 40 từ)...",
        "source_url": "https://vbpl.vn/...",
        "section": "Khoản 1"
      }
    ]
  },
  "message": "OK"
}
```

### 2.3 Response mẫu — lỗi kết nối dịch vụ AI (mới)

```json
{
  "success": false,
  "data": null,
  "message": "Xin lỗi, hiện hệ thống đang gặp sự cố kết nối và chưa thể xử lý câu hỏi của bạn. Vui lòng thử lại sau ít phút.",
  "error_code": "SERVICE_UNAVAILABLE"
}
```
> Áp dụng khi backend không gọi được embedding API, LLM API, **hoặc rerank API** (mới, riêng cho Model 3). HTTP status 503. Không tính vào thống kê độ chính xác khi chạy thực nghiệm batch — xem `DE_XUAT_4_MO_HINH_HOI_DAP_v3.md` mục 5.

### 2.4 `answer_type` — làm rõ lại cho 4 model
`structured_lookup` (Model 1, hoặc nhánh structured của Model 4) | `rag_generated` (Model 2, 3, hoặc nhánh hybrid của Model 4) | `no_answer`.

> Lưu ý: `answer_type` mô tả **cách trả lời** (tra cứu trực tiếp vs sinh từ RAG), còn `model_used` mô tả **model nào tạo ra kết quả**. Hai field độc lập nhau — VD Model 4 (`model_used = modular_rag`) có thể trả `answer_type = structured_lookup` khi router chuyển đúng nhánh structured.

---

## 3. Postman Collection cần cập nhật

Thêm test case cho `POST /qa/ask` với 4 giá trị `model_used` khác nhau (nếu backend expose param để chọn model khi test — khuyến nghị thêm query param không bắt buộc `?model=advanced_rag` chỉ dùng cho mục đích test/demo so sánh, không phải flow production thật). Đẩy lại `done-team.postman_collection.json` lên Git sau khi cập nhật.
