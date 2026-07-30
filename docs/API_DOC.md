# API DOCUMENTATION
## Hệ thống hỏi đáp tự động về địa giới hành chính TP.HCM (Done Team)
**Version:** v1 | **Base URL:** `http://localhost:3000/api/v1` (dev) / `https://<domain>/api/v1` (prod)

> Tài liệu này là **hợp đồng (contract)** giữa Backend và Frontend. Mọi thay đổi phải được cả 2 thành viên thống nhất và cập nhật lại file này trước khi code.

---

## 1. Quy ước chung

| Mục | Quy định |
|---|---|
| Định dạng | JSON, `Content-Type: application/json; charset=utf-8` |
| Encoding | UTF-8 (bắt buộc, vì có dấu tiếng Việt) |
| Versioning | Tiền tố `/api/v1` cho mọi endpoint |
| Đặt tên URL | kebab-case, danh từ số nhiều (VD: `/admin-units`) |
| Đặt tên field JSON | snake_case (VD: `old_name`, `created_at`) |
| Phân trang | Query param `page` (mặc định 1), `limit` (mặc định 20, tối đa 100) |
| Thời gian | ISO 8601, UTC (VD: `"2026-07-28T10:00:00Z"`) |
| Auth | Không bắt buộc cho đồ án (public API); nếu cần giới hạn, dùng header `X-API-Key` đơn giản |

### 1.1 Format response chuẩn (áp dụng cho MỌI endpoint)

**Thành công:**
```json
{
  "success": true,
  "data": { },
  "message": "OK"
}
```

**Danh sách có phân trang:**
```json
{
  "success": true,
  "data": {
    "items": [ ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total_items": 168,
      "total_pages": 9
    }
  },
  "message": "OK"
}
```

**Lỗi:**
```json
{
  "success": false,
  "data": null,
  "message": "Không tìm thấy đơn vị hành chính",
  "error_code": "UNIT_NOT_FOUND"
}
```

### 1.2 Bảng mã lỗi chuẩn

| error_code | HTTP status | Ý nghĩa |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Tham số đầu vào sai/thiếu |
| `UNIT_NOT_FOUND` | 404 | Không tìm thấy đơn vị hành chính |
| `DOCUMENT_NOT_FOUND` | 404 | Không tìm thấy văn bản/nguồn trích dẫn |
| `NO_ANSWER_FOUND` | 200 | RAG không tìm được câu trả lời đủ tin cậy (`data.answer = null`) |
| `RATE_LIMITED` | 429 | Gọi API hỏi đáp quá tần suất cho phép |
| `INTERNAL_ERROR` | 500 | Lỗi hệ thống ngoài dự kiến |

---

## 2. Endpoints

### 2.1 `GET /health`
Kiểm tra hệ thống còn sống — dùng để test nhanh khi 2 bạn ghép nối.

**Response 200:**
```json
{
  "success": true,
  "data": { "status": "ok", "db": "connected", "vector_db": "connected" },
  "message": "OK"
}
```

---

### 2.2 `GET /admin-units`
Lấy danh sách đơn vị hành chính (mới), có filter và phân trang.

**Query params:**
| Tên | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `page` | int | Không | Trang hiện tại, mặc định 1 |
| `limit` | int | Không | Số item/trang, mặc định 20 |
| `type` | string | Không | Lọc theo loại: `phuong` \| `xa` \| `dac_khu` |
| `keyword` | string | Không | Tìm theo tên mới hoặc tên cũ (không phân biệt hoa/thường, không dấu cũng match được) |

**Ví dụ:** `GET /admin-units?page=1&limit=20&type=phuong&keyword=ben nghe`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "unit_0007",
        "new_name": "Phường Sài Gòn",
        "new_type": "phuong",
        "old_units": ["Phường Bến Nghé", "Phường Bến Thành", "Phường Nguyễn Thái Bình"],
        "headquarters_address": "86 Lê Thánh Tôn, Quận 1 cũ",
        "decision_number": "1685/NQ-UBTVQH15",
        "decision_date": "2025-06-16"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total_items": 168, "total_pages": 9 }
  },
  "message": "OK"
}
```
> Ví dụ minh họa mang tính mẫu cấu trúc dữ liệu — số liệu thực tế (tên phường, đơn vị cũ ghép vào) cần lấy đúng theo Phụ lục Nghị quyết 1685/NQ-UBTVQH15, không dùng số liệu mẫu này để nạp vào hệ thống thật.

**Lỗi có thể gặp:** `VALIDATION_ERROR` (400) nếu `type` không thuộc enum cho phép.

---

### 2.3 `GET /admin-units/{id}`
Lấy chi tiết 1 đơn vị hành chính.

**Path param:** `id` (string) — mã đơn vị.

**Response 200:** giống 1 item ở mục 2.2, kèm thêm:
```json
{
  "success": true,
  "data": {
    "id": "unit_0007",
    "new_name": "Phường Sài Gòn",
    "new_type": "phuong",
    "old_units": [
      { "old_name": "Phường Bến Nghé", "old_parent": "Quận 1", "old_parent_province": "TP.HCM (cũ)" }
    ],
    "headquarters_address": "86 Lê Thánh Tôn, Quận 1 cũ",
    "decision_number": "1685/NQ-UBTVQH15",
    "decision_date": "2025-06-16",
    "source_document_url": "https://vbpl.vn/...",
    "map_geojson_url": "https://.../unit_0007.geojson"
  },
  "message": "OK"
}
```
**Lỗi:** `UNIT_NOT_FOUND` (404) nếu `id` không tồn tại.

---

### 2.4 `GET /admin-units/search`
Tra cứu nhanh 1-lệnh theo tên cũ (dùng cho ô tìm kiếm nổi bật trên trang chủ).

**Query params:** `old_name` (string, bắt buộc)

**Ví dụ:** `GET /admin-units/search?old_name=Phường Tân Định`

**Response 200:**
```json
{
  "success": true,
  "data": {
    "matched_old_name": "Phường Tân Định",
    "new_unit": {
      "id": "unit_0012",
      "new_name": "Phường Tân Định",
      "decision_number": "1685/NQ-UBTVQH15"
    }
  },
  "message": "OK"
}
```
**Lỗi:** `UNIT_NOT_FOUND` (404) nếu không khớp tên nào; response nên gợi ý các tên gần giống trong `message` (fuzzy match) nếu có thể triển khai.

---

### 2.5 `POST /qa/ask` (endpoint quan trọng nhất — lõi RAG)
Gửi câu hỏi tự nhiên bằng tiếng Việt, nhận câu trả lời kèm nguồn trích dẫn.

**Request body:**
```json
{
  "question": "Phường Bến Nghé cũ bây giờ là phường gì?",
  "session_id": "sess_abc123"
}
```
| Field | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `question` | string | Có | Câu hỏi người dùng, tối đa 500 ký tự |
| `session_id` | string | Không | Dùng để nhóm lịch sử hội thoại (nếu làm tính năng hỏi nối tiếp) |

**Response 200 — có câu trả lời:**
```json
{
  "success": true,
  "data": {
    "answer": "Phường Bến Nghé (cũ) hiện nay thuộc Phường Sài Gòn, được thành lập trên cơ sở hợp nhất các phường Bến Nghé, Bến Thành và Nguyễn Thái Bình theo Nghị quyết 1685/NQ-UBTVQH15.",
    "answer_type": "structured_lookup",
    "confidence": 0.96,
    "sources": [
      {
        "document_id": "doc_0042",
        "title": "Nghị quyết 1685/NQ-UBTVQH15",
        "excerpt": "...(đoạn trích ngắn, dưới 40 từ)...",
        "source_url": "https://vbpl.vn/...",
        "section": "Phụ lục, mục 7"
      }
    ]
  },
  "message": "OK"
}
```

**Response 200 — không tìm được câu trả lời đủ tin cậy:**
```json
{
  "success": true,
  "data": {
    "answer": null,
    "answer_type": "no_answer",
    "confidence": 0.0,
    "sources": [],
    "suggestion": "Câu hỏi nằm ngoài phạm vi dữ liệu hệ thống hiện có (TP.HCM sau sắp xếp)."
  },
  "message": "NO_ANSWER_FOUND",
  "error_code": "NO_ANSWER_FOUND"
}
```

**Field `answer_type` có thể là:**
- `structured_lookup`: trả lời trực tiếp từ bảng ánh xạ (độ tin cậy cao nhất).
- `rag_generated`: câu trả lời được LLM tổng hợp từ các đoạn văn bản truy xuất.
- `no_answer`: không đủ dữ liệu liên quan.

**Lỗi có thể gặp:** `VALIDATION_ERROR` (400, câu hỏi rỗng/quá dài), `RATE_LIMITED` (429).

---

### 2.6 `GET /documents/{id}`
Xem chi tiết 1 văn bản pháp lý (dùng khi người dùng bấm vào nguồn trích dẫn để xem thêm).

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "doc_0042",
    "title": "Nghị quyết 1685/NQ-UBTVQH15",
    "issuing_body": "Ủy ban Thường vụ Quốc hội",
    "issue_date": "2025-06-16",
    "source_url": "https://vbpl.vn/...",
    "full_text_available": true
  },
  "message": "OK"
}
```
**Lỗi:** `DOCUMENT_NOT_FOUND` (404).

---

### 2.7 `POST /feedback` (tùy chọn — điểm cộng khi báo cáo)
Cho phép người dùng đánh giá câu trả lời đúng/sai, phục vụ số liệu đánh giá độ chính xác thực tế.

**Request body:**
```json
{ "qa_log_id": "log_00099", "is_helpful": true, "note": "" }
```
**Response 200:**
```json
{ "success": true, "data": { "recorded": true }, "message": "OK" }
```

---

## 3. Ví dụ luồng sử dụng (dùng để 2 bạn test bằng Postman)

1. `GET /health` → xác nhận server sống.
2. `GET /admin-units?keyword=tan dinh` → lấy danh sách gợi ý.
3. `GET /admin-units/{id}` → xem chi tiết 1 đơn vị.
4. `POST /qa/ask` với câu hỏi tự nhiên → nhận câu trả lời + nguồn.
5. `GET /documents/{id}` → xem chi tiết nguồn vừa nhận được ở bước 4.

→ Xuất bộ request này thành 1 **Postman Collection** (`done-team.postman_collection.json`), đẩy lên Git, cả A và B dùng chung để test, tránh tình trạng "máy tôi chạy được".

---

## 4. Gợi ý cài đặt phía Node.js/Express (khớp với API doc này)

```js
// routes/adminUnits.js
router.get('/admin-units', adminUnitController.list);
router.get('/admin-units/search', adminUnitController.searchByOldName); // để TRƯỚC route /:id
router.get('/admin-units/:id', adminUnitController.getById);

// routes/qa.js
router.post('/qa/ask', qaController.ask);

// middleware format response chuẩn — dùng chung cho toàn bộ app
function success(data, message = 'OK') {
  return { success: true, data, message };
}
function fail(message, error_code) {
  return { success: false, data: null, message, error_code };
}
module.exports = { success, fail };
```
> Lưu ý thứ tự route: `/admin-units/search` phải khai báo **trước** `/admin-units/:id`, nếu không Express sẽ hiểu nhầm `search` là 1 giá trị `id`.

---

*Mọi thay đổi với tài liệu này cần thông báo trong nhóm chat và cập nhật ngay để tránh 2 bên code lệch nhau.*
