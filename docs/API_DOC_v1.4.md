# API DOCUMENTATION v1.4
## Hệ thống hỏi đáp tự động về địa giới hành chính mới khu vực miền Nam (Done Team)

Version: v1.4 | Base URL: `http://localhost:3000/api/v1` (dev) / `https://<domain>/api/v1` (prod)

Tài liệu này là hợp đồng giữa Backend và Frontend, đồng thời là hợp đồng giữa Backend và script batch test. Mọi thay đổi phải được cả hai thành viên đồng ý và cập nhật vào file này trước khi code.

### Thay đổi so với v1.3

v1.4 thay thế cả v1.2 lẫn v1.3. Hai bản cũ chỉ ghi phần thay đổi và dẫn về "file gốc", nên nay gộp thành một file đầy đủ.

| # | Thay đổi | Lý do |
|---|---|---|
| 1 | Thêm mục 1.3 "Quy ước định danh": `id` do PostgreSQL tự sinh, khác nhau giữa các máy | Hai máy ra `PROVINCE_ID` khác nhau (An Giang là 7 trên máy này, 4 trên máy kia) |
| 2 | `POST /qa/ask` ghi rõ 3 field request mà script batch đang gửi: `model`, `llm_provider`, `province_id` | Các field này đã dùng trong `runBatchTest.js` nhưng chưa có trong tài liệu |
| 3 | `province_id` sai hoặc không tồn tại phải trả `PROVINCE_NOT_FOUND` (404), không được bỏ qua im lặng | Gửi nhầm id từ máy khác sẽ lọc sang tỉnh khác mà không báo lỗi (id 11 là Cần Thơ ở máy này, Đồng Nai ở máy kia) |
| 4 | Response `/qa/ask` thêm `qa_log_id` | Script batch đọc field này |
| 5 | Lỗi `RATE_LIMITED` trả thêm `retry_after_ms` | Script batch dùng giá trị này để chờ trước khi gửi lại |
| 6 | `GET /provinces` cập nhật từ 1 dòng thành 8 dòng (TP.HCM và 7 tỉnh) | Bảng `provinces_new` hiện có 8 dòng |
| 7 | Field `muc_do` trong API lấy từ cột `unit_mapping.merge_type` | v1.2 ghi nhầm là `unit_mapping.muc_do`, trong `schema.sql` cột tên `merge_type` |
| 8 | Thêm mục 3 "Quy ước chạy batch test" | Chốt cách đặt tên log, cách gộp kết quả hai máy |

---

## 1. Quy ước chung

| Mục | Quy định |
|---|---|
| Định dạng | JSON, `Content-Type: application/json; charset=utf-8` |
| Encoding | UTF-8 |
| Versioning | Tiền tố `/api/v1` cho mọi endpoint |
| Đặt tên URL | kebab-case, danh từ số nhiều (`/admin-units`, `/provinces`) |
| Đặt tên field JSON | snake_case (`old_name`, `created_at`) |
| Phân trang | Query param `page` (mặc định 1), `limit` (mặc định 20, tối đa 100) |
| Thời gian | ISO 8601, UTC (`"2026-07-28T10:00:00Z"`) |
| Auth | Không bắt buộc cho đồ án (public API). Nếu cần giới hạn, dùng header `X-API-Key` |

### 1.1 Format response chuẩn

Thành công:
```json
{ "success": true, "data": { }, "message": "OK" }
```

Danh sách có phân trang:
```json
{
  "success": true,
  "data": {
    "items": [ ],
    "pagination": { "page": 1, "limit": 20, "total_items": 168, "total_pages": 9 }
  },
  "message": "OK"
}
```

Lỗi:
```json
{
  "success": false,
  "data": null,
  "message": "Không tìm thấy đơn vị hành chính",
  "error_code": "UNIT_NOT_FOUND"
}
```

### 1.2 Bảng mã lỗi

| error_code | HTTP | Ý nghĩa |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Tham số đầu vào sai hoặc thiếu (gồm cả `model` hoặc `llm_provider` ngoài danh sách cho phép) |
| `PROVINCE_NOT_FOUND` | 404 | Không tìm thấy tỉnh/thành. Cũng trả khi `province_id` gửi vào `/qa/ask` không tồn tại |
| `UNIT_NOT_FOUND` | 404 | Không tìm thấy đơn vị cấp xã/phường |
| `DOCUMENT_NOT_FOUND` | 404 | Không tìm thấy văn bản/nguồn trích dẫn |
| `NO_ANSWER_FOUND` | 200 | Hệ thống không tìm được câu trả lời đủ tin cậy (`data.answer = null`). Đây là hành vi hợp lệ, không phải lỗi hệ thống |
| `RATE_LIMITED` | 429 | Gọi quá tần suất. Response có thêm `retry_after_ms` (xem bên dưới) |
| `SERVICE_UNAVAILABLE` | 503 | Không kết nối được dịch vụ AI bên ngoài hoặc cục bộ (embedding, LLM, rerank) |
| `INTERNAL_ERROR` | 500 | Lỗi hệ thống ngoài dự kiến |

Response của `RATE_LIMITED`:
```json
{
  "success": false,
  "data": null,
  "message": "Vượt giới hạn tần suất, thử lại sau.",
  "error_code": "RATE_LIMITED",
  "retry_after_ms": 20000
}
```
`retry_after_ms` không bắt buộc. Nếu thiếu, client tự chọn thời gian chờ (script batch dùng 20 giây, nhân đôi sau mỗi lần thử lại).

### 1.3 Quy ước định danh (mới)

`id` của tỉnh, đơn vị và log trong DB là cột `SERIAL` của PostgreSQL. Giá trị phụ thuộc vào số lần script nạp đã chạy, kể cả những lần `INSERT` bị bỏ qua hoặc lỗi (sequence không rollback). Hai máy nạp cùng một dữ liệu vẫn có thể ra id khác nhau.

Quy tắc:

1. Không hardcode `id` vào script, file test, file cấu hình hoặc tài liệu. Nếu cần id, tra theo tên lúc chạy.
2. Khóa ổn định giữa các máy: với tỉnh là `new_name` (cột `provinces_new.name`, có ràng buộc UNIQUE); với đơn vị cũ là cặp (`old_name`, `old_parent`), không dùng id.
3. File test và đáp án mong đợi lưu theo tên đơn vị cộng `old_parent`, không lưu id.
4. Khi gộp kết quả của hai máy, gộp theo mã tỉnh viết tắt (AG, CM, CT, DN, DT, TN, VL, HCM) dùng ở tên thư mục kết quả, không gộp theo cột `province_id`.
5. Các giá trị `id` trong ví dụ của tài liệu này (`province_0001`, `unit_0007`...) chỉ minh họa định dạng.

---

## 2. Endpoints

### 2.1 `GET /provinces`
Lấy danh sách tỉnh/thành mới. Hiện có 8 dòng: TP. Hồ Chí Minh, Tỉnh An Giang, Tỉnh Cà Mau, Thành phố Cần Thơ, Tỉnh Đồng Nai, Tỉnh Đồng Tháp, Tỉnh Tây Ninh, Tỉnh Vĩnh Long.

Query params: `page`, `limit` (chuẩn phân trang ở mục 1).

Response 200 (ví dụ rút gọn, danh sách thật trả đủ 8 dòng):
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "province_0001",
        "new_name": "TP. Hồ Chí Minh",
        "old_provinces": ["TP. Hồ Chí Minh (cũ)", "Tỉnh Bình Dương", "Tỉnh Bà Rịa - Vũng Tàu"],
        "effective_date": "2025-07-01"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total_items": 8, "total_pages": 1 }
  },
  "message": "OK"
}
```
Client cần id của một tỉnh thì gọi endpoint này rồi so khớp `new_name`. Không giữ id đã lấy ở môi trường khác.

---

### 2.2 `GET /provinces/{id}`
Chi tiết một tỉnh/thành mới, kèm nguồn trích dẫn nghị quyết cấp tỉnh.

Response 200:
```json
{
  "success": true,
  "data": {
    "id": "province_0001",
    "new_name": "TP. Hồ Chí Minh",
    "effective_date": "2025-07-01",
    "old_provinces": [
      { "old_name": "TP. Hồ Chí Minh (cũ)", "notes": "Giữ tên gọi" },
      { "old_name": "Tỉnh Bình Dương", "notes": "Sáp nhập vào TP.HCM" },
      { "old_name": "Tỉnh Bà Rịa - Vũng Tàu", "notes": "Sáp nhập vào TP.HCM" }
    ],
    "decision_number": "202/2025/QH15",
    "decision_date": "2025-06-12",
    "source_document_url": "https://vbpl.vn/..."
  },
  "message": "OK"
}
```
Lỗi: `PROVINCE_NOT_FOUND` (404). Vì `id` khác nhau giữa các máy, không lưu đường dẫn `/provinces/{id}` vào tài liệu hay file test.

---

### 2.3 `GET /provinces/search`
Tra nhanh từ tỉnh cũ sang tỉnh mới.

Query params: `old_name` (string, bắt buộc).

Ví dụ: `GET /provinces/search?old_name=Bình Dương`

Response 200:
```json
{
  "success": true,
  "data": {
    "matched_old_name": "Tỉnh Bình Dương",
    "new_province": { "id": "province_0001", "new_name": "TP. Hồ Chí Minh" }
  },
  "message": "OK"
}
```
Lỗi: `PROVINCE_NOT_FOUND` (404).

---

### 2.4 `GET /admin-units`
Danh sách đơn vị cấp xã/phường (mới), có lọc và phân trang.

| Tên | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `page` | int | Không | Trang hiện tại, mặc định 1 |
| `limit` | int | Không | Số item mỗi trang, mặc định 20 |
| `type` | string | Không | `phuong` \| `xa` \| `dac_khu` |
| `province` | string | Không | Lọc theo tên tỉnh/thành mới, ví dụ `Tỉnh An Giang`. Lọc theo tên, không theo id |
| `keyword` | string | Không | Tìm theo tên mới hoặc tên cũ, không phân biệt hoa thường, không dấu vẫn khớp |

Ví dụ: `GET /admin-units?page=1&limit=20&type=phuong&keyword=ben nghe`

Response 200:
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "unit_0007",
        "new_name": "Phường Sài Gòn",
        "new_type": "phuong",
        "new_province": "TP. Hồ Chí Minh",
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
Ví dụ chỉ minh họa cấu trúc. Số liệu thật lấy theo Phụ lục Nghị quyết 1685/NQ-UBTVQH15.

Lỗi: `VALIDATION_ERROR` (400) nếu `type` ngoài danh sách cho phép.

---

### 2.5 `GET /admin-units/{id}`
Chi tiết một đơn vị cấp xã/phường.

Response 200:
```json
{
  "success": true,
  "data": {
    "id": "unit_0007",
    "new_name": "Phường Sài Gòn",
    "new_type": "phuong",
    "new_province": "TP. Hồ Chí Minh",
    "old_units": [
      { "old_name": "Phường Bến Nghé", "old_parent": "Quận 1", "old_province": "TP. Hồ Chí Minh (cũ)", "muc_do": "toan_bo" },
      { "old_name": "Phường Đa Kao", "old_parent": "Quận 1", "old_province": "TP. Hồ Chí Minh (cũ)", "muc_do": "mot_phan" },
      { "old_name": "Phường Nguyễn Thái Bình", "old_parent": "Quận 1", "old_province": "TP. Hồ Chí Minh (cũ)", "muc_do": "mot_phan" }
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

Ghi chú về field:

- `old_province` của mỗi `old_units` lấy qua `admin_units_old.province_old_id`. Cho biết đơn vị cũ thuộc tỉnh nào trước sáp nhập.
- `muc_do` nhận `toan_bo` hoặc `mot_phan`, lấy từ cột `unit_mapping.merge_type` (đã sửa so với v1.2, xem bảng thay đổi). Với `mot_phan`, frontend hiển thị nhãn phụ (ví dụ badge "một phần") cạnh tên đơn vị cũ để người dùng không hiểu nhầm là nhập trọn vẹn.

Lỗi: `UNIT_NOT_FOUND` (404).

---

### 2.6 `GET /admin-units/search`
Tra nhanh theo tên cũ, dùng cho ô tìm kiếm trên trang chủ.

Query params: `old_name` (string, bắt buộc).

Response 200:
```json
{
  "success": true,
  "data": {
    "matched_old_name": "Phường Tân Định",
    "new_unit": {
      "id": "unit_0012",
      "new_name": "Phường Tân Định",
      "new_province": "TP. Hồ Chí Minh",
      "decision_number": "1685/NQ-UBTVQH15"
    }
  },
  "message": "OK"
}
```
Lỗi: `UNIT_NOT_FOUND` (404) nếu không khớp tên nào. Nên gợi ý các tên gần giống trong `message` (fuzzy match) nếu triển khai được.

Lưu ý tên trùng: nhiều đơn vị cũ trùng tên (ví dụ "Phường 7" có ở 11 quận). Khi tên không đủ phân biệt, backend phải yêu cầu thêm `old_parent` hoặc trả danh sách các khả năng, không được tự chọn dòng đầu tiên.

---

### 2.7 `POST /qa/ask`
Gửi câu hỏi tiếng Việt, nhận câu trả lời kèm nguồn trích dẫn. Đây là endpoint lõi và cũng là endpoint script batch test gọi.

Request body:
```json
{
  "question": "Phường Bến Nghé cũ bây giờ là phường gì?",
  "session_id": "sess_abc123",
  "model": "advanced_rag",
  "llm_provider": "gemini",
  "province_id": 1
}
```

| Field | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `question` | string | Có | Câu hỏi, tối đa 500 ký tự |
| `session_id` | string | Không | Nhóm lịch sử hội thoại |
| `model` | string | Không | `rule_based` \| `naive_rag` \| `advanced_rag` \| `modular_rag`. Dùng khi demo hoặc batch test để chọn model. Giá trị khác trả `VALIDATION_ERROR` |
| `llm_provider` | string | Không | `gemini` \| `groq` \| `cohere` \| `openrouter`. Bị bỏ qua với `rule_based` vì model này không gọi LLM. Script batch hiện chỉ dùng `gemini` và `cohere` |
| `province_id` | integer | Không | `provinces_new.id` của tỉnh cần hỏi, dùng để giới hạn phạm vi tra cứu. Xem quy tắc bên dưới |

Quy tắc cho `province_id`:

1. Giá trị là `id` trong DB đang chạy, không phải mã cố định. Client không hardcode, xem mục 1.3.
2. Backend phải kiểm tra `province_id` có trong `provinces_new` trước khi xử lý. Nếu không có, trả `PROVINCE_NOT_FOUND` (404). Không được bỏ qua giá trị sai rồi tiếp tục như không có tỉnh.
3. Script batch test không đọc id từ file cấu hình. Script tra id theo tên tỉnh ngay lúc khởi động (xem mục 3).

Các field trong `data` của response:

| Field | Kiểu | Áp dụng | Mô tả |
|---|---|---|---|
| `answer` | string \| null | Tất cả | Câu trả lời. `null` khi không đủ tin cậy |
| `answer_type` | string | Tất cả | `structured_lookup` (tra cứu trực tiếp) \| `rag_generated` (LLM sinh từ retrieval) \| `no_answer` |
| `answer_level` | string \| null | Tất cả | `unit` hoặc `province`. Frontend dùng để hiển thị badge khác nhau |
| `model_used` | string | Tất cả | Model đã tạo ra câu trả lời |
| `rewritten_question` | string \| null | Chỉ `advanced_rag` | Câu hỏi sau khi LLM viết lại. `null` với model khác |
| `routing_decision` | string \| null | Chỉ `modular_rag` | `structured` hoặc `hybrid` |
| `confidence` | number | Tất cả | 0 đến 1 |
| `qa_log_id` | integer | Tất cả | Id dòng tương ứng trong `qa_logs`, dùng cho `POST /feedback` và đối chiếu khi chấm tay |
| `sources` | array | Tất cả | Nguồn trích dẫn (xem ví dụ) |

`answer_type` mô tả cách trả lời, `model_used` mô tả model nào tạo ra kết quả. Hai field độc lập. Ví dụ `modular_rag` có thể trả `structured_lookup` khi router chọn đúng nhánh structured.

Thứ tự thử của `structured_lookup`: cấp xã/phường trước, không khớp mới thử cấp tỉnh.

**Ví dụ 1: đơn vị cũ bị chia làm nhiều nơi**

Câu hỏi: `"Phường Đa Kao cũ bây giờ thuộc phường nào?"`
```json
{
  "success": true,
  "data": {
    "answer": "Phường Đa Kao (cũ) không nhập trọn vào một phường mà được chia làm 2: một phần diện tích nhập vào phường Sài Gòn, phần còn lại nhập vào phường Tân Định, theo Nghị quyết 1685/NQ-UBTVQH15.",
    "answer_type": "structured_lookup",
    "answer_level": "unit",
    "model_used": "rule_based",
    "rewritten_question": null,
    "confidence": 0.95,
    "qa_log_id": 99,
    "sources": [
      { "document_id": "doc_0042", "title": "Nghị quyết 1685/NQ-UBTVQH15", "section": "Khoản 1", "source_url": "https://vbpl.vn/..." },
      { "document_id": "doc_0042", "title": "Nghị quyết 1685/NQ-UBTVQH15", "section": "Khoản 2", "source_url": "https://vbpl.vn/..." }
    ]
  },
  "message": "OK"
}
```
Bắt buộc phía backend: khi truy vấn `unit_mapping` theo `old_unit_id` trả về nhiều hơn một dòng, câu trả lời phải dùng mẫu "được chia làm X phần" và `sources` liệt kê đủ các đơn vị mới liên quan. Không lấy dòng đầu rồi trả lời như nhập trọn vào một nơi.

**Ví dụ 2: đơn vị mới gộp từ nhiều nguồn, có cả toàn bộ lẫn một phần**

Câu hỏi: `"Phường Sài Gòn được sáp nhập từ những phường nào?"`
```json
{
  "success": true,
  "data": {
    "answer": "Phường Sài Gòn được hình thành từ toàn bộ phường Bến Nghé, cộng với một phần diện tích của phường Đa Kao và phường Nguyễn Thái Bình (đều thuộc Quận 1 cũ), theo Khoản 1 Nghị quyết 1685/NQ-UBTVQH15.",
    "answer_type": "structured_lookup",
    "answer_level": "unit",
    "model_used": "rule_based",
    "rewritten_question": null,
    "confidence": 0.95,
    "qa_log_id": 100,
    "sources": [
      { "document_id": "doc_0042", "title": "Nghị quyết 1685/NQ-UBTVQH15", "section": "Khoản 1", "source_url": "https://vbpl.vn/..." }
    ]
  },
  "message": "OK"
}
```
Logic sinh câu: nhóm kết quả `unit_mapping` theo `merge_type`, nêu nhóm `toan_bo` trước, sau đó nối nhóm `mot_phan` bằng "cộng với một phần diện tích của...". Không gộp tất cả vào một danh sách phẳng, vì như vậy ngụ ý mọi đơn vị đều nhập trọn.

**Ví dụ 3: câu hỏi cấp tỉnh**
```json
{
  "success": true,
  "data": {
    "answer": "Tỉnh Bình Dương (cũ) hiện nay đã sáp nhập vào TP. Hồ Chí Minh theo Nghị quyết 202/2025/QH15.",
    "answer_type": "structured_lookup",
    "answer_level": "province",
    "model_used": "rule_based",
    "rewritten_question": null,
    "confidence": 0.97,
    "qa_log_id": 101,
    "sources": [
      { "document_id": "doc_0001", "title": "Nghị quyết 202/2025/QH15", "section": "Điều 1", "source_url": "https://vbpl.vn/..." }
    ]
  },
  "message": "OK"
}
```

**Ví dụ 4: Advanced RAG, có câu hỏi viết lại**
```json
{
  "success": true,
  "data": {
    "answer": "Phường Bến Nghé (cũ) hiện nay thuộc Phường Sài Gòn, theo Nghị quyết 1685/NQ-UBTVQH15.",
    "answer_type": "rag_generated",
    "answer_level": "unit",
    "model_used": "advanced_rag",
    "rewritten_question": "Phường Bến Nghé trước sáp nhập hiện nay là phường nào?",
    "confidence": 0.93,
    "qa_log_id": 102,
    "sources": [
      { "document_id": "doc_0042", "title": "Nghị quyết 1685/NQ-UBTVQH15", "excerpt": "...(đoạn trích dưới 40 từ)...", "source_url": "https://vbpl.vn/...", "section": "Khoản 1" }
    ]
  },
  "message": "OK"
}
```

**Ví dụ 5: không có câu trả lời đủ tin cậy**
```json
{
  "success": true,
  "data": {
    "answer": null,
    "answer_type": "no_answer",
    "answer_level": null,
    "model_used": "naive_rag",
    "rewritten_question": null,
    "confidence": 0.0,
    "qa_log_id": 103,
    "sources": [],
    "suggestion": "Câu hỏi nằm ngoài phạm vi dữ liệu hệ thống hiện có."
  },
  "message": "NO_ANSWER_FOUND",
  "error_code": "NO_ANSWER_FOUND"
}
```
Với câu hỏi thuộc loại `ngoai_pham_vi`, kết quả này là đúng. Khi tính accuracy, không coi `no_answer` là lỗi hệ thống.

**Ví dụ 6: `province_id` không tồn tại**
```json
{
  "success": false,
  "data": null,
  "message": "Không tìm thấy tỉnh/thành với province_id đã gửi.",
  "error_code": "PROVINCE_NOT_FOUND"
}
```

**Ví dụ 7: dịch vụ AI không kết nối được**
```json
{
  "success": false,
  "data": null,
  "message": "Xin lỗi, hiện hệ thống đang gặp sự cố kết nối và chưa thể xử lý câu hỏi của bạn. Vui lòng thử lại sau ít phút.",
  "error_code": "SERVICE_UNAVAILABLE"
}
```
Áp dụng khi backend không gọi được embedding API, LLM API hoặc rerank API. HTTP 503. Loại khỏi mẫu số khi tính accuracy (lỗi hạ tầng, không phải lỗi của model).

Lỗi có thể gặp ở endpoint này: `VALIDATION_ERROR` (400), `PROVINCE_NOT_FOUND` (404), `RATE_LIMITED` (429), `SERVICE_UNAVAILABLE` (503).

---

### 2.8 `GET /documents/{id}`
Chi tiết một văn bản pháp lý. Dùng chung cho văn bản cấp tỉnh và cấp xã/phường vì `legal_documents` là một bảng duy nhất.

Response 200:
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
Lỗi: `DOCUMENT_NOT_FOUND` (404).

---

### 2.9 `POST /feedback`
Tùy chọn.
```json
{ "qa_log_id": 99, "is_helpful": true, "note": "" }
```
`qa_log_id` lấy từ response của `/qa/ask`. Response 200:
```json
{ "success": true, "data": { "recorded": true }, "message": "OK" }
```

---

### 2.10 `GET /health`
Script batch gọi endpoint này để chờ backend sẵn sàng (tối đa 60 giây) trước khi warm-up.
```json
{
  "success": true,
  "data": { "status": "ok", "db": "connected", "vector_db": "connected" },
  "message": "OK"
}
```

---

## 3. Quy ước chạy batch test (mới)

Áp dụng cho `runBatchTest.js` và mọi script gọi `/qa/ask` hàng loạt.

| Hạng mục | Quy định |
|---|---|
| Chọn tỉnh | Biến môi trường `PROVINCE` nhận mã viết tắt (HCM, AG, CM, CT, DN, DT, TN, VL). Bảng `PROVINCES` trong script chỉ lưu `name` và `testSet`, không lưu id |
| Lấy `province_id` | Script tra `SELECT id FROM provinces_new WHERE name = $1` lúc khởi động. Tìm được đúng 1 dòng thì dùng, 0 hoặc nhiều hơn 1 dòng thì dừng và in lỗi |
| Giá trị mặc định | Không có. `province_id` thiếu thì script báo lỗi, không tự rơi về 1 |
| Bộ câu hỏi | Mỗi tỉnh dùng một file duy nhất `data/test_matrix_<MÃ>.xlsx`, commit lên Git. Hai máy không tự sinh lại file này |
| Tên file log | Theo mã tỉnh: `log_v2_AG.txt`, không theo id (`log_v2_province_4.txt` là cách đặt cũ, bỏ) |
| Thư mục kết quả | `data/batch_results/official_batch/<MÃ>/` (đã tách theo mã tỉnh) |
| Cột trong file kết quả | Có cả `province_code` và `province_id`. Dùng `province_code` để gộp, `province_id` chỉ để tham khảo trên máy chạy |
| Provider | Cố định một `llm_provider` cho toàn bộ lượt chạy chính thức. Provider dự phòng chỉ dùng khi lỗi hạ tầng và loại khỏi thống kê |
| Lỗi hạ tầng | `success: false` (`SERVICE_UNAVAILABLE`, `RATE_LIMITED` hết số lần thử) loại khỏi mẫu số accuracy. `no_answer` cho câu ngoài phạm vi là kết quả đúng |

---

## 4. Luồng thử bằng Postman

1. `GET /health` để xác nhận server sống.
2. `GET /provinces` để xem 8 tỉnh/thành và ghi lại `id` trên máy mình.
3. `GET /admin-units?keyword=tan dinh` để lấy danh sách gợi ý.
4. `GET /admin-units/{id}` để xem chi tiết một đơn vị (có `old_province` và `muc_do`).
5. `POST /qa/ask` với câu hỏi tự nhiên, thử cả cấp tỉnh lẫn cấp xã/phường, thử đủ 4 giá trị `model`.
6. `POST /qa/ask` với `province_id` cố tình sai (ví dụ 99999), kết quả phải là `PROVINCE_NOT_FOUND`.
7. `GET /documents/{id}` để xem chi tiết nguồn vừa nhận.

Cập nhật `done-team.postman_collection.json` cho các request mới (`model`, `llm_provider`, `province_id`) và đẩy lên Git. Trong collection, lưu `province_id` thành biến môi trường Postman riêng của mỗi máy, không ghi cứng vào request.

---

## 5. Ghi chú cài đặt phía Node.js/Express

Thứ tự route: `/search` khai báo trước `/:id` ở cả `provinces.js` lẫn `adminUnits.js`, nếu không Express hiểu `search` là một giá trị `id`.

```js
router.get('/provinces/search', provinceController.searchByOldName);
router.get('/provinces/:id', provinceController.getById);
router.get('/provinces', provinceController.list);

router.get('/admin-units/search', adminUnitController.searchByOldName);
router.get('/admin-units/:id', adminUnitController.getById);
router.get('/admin-units', adminUnitController.list);

router.post('/qa/ask', qaController.ask);
```

Kiểm tra `province_id` ở đầu `qaController.ask` (phác thảo, cần chỉnh theo code thật):
```js
const { province_id } = req.body;
if (province_id !== undefined && province_id !== null) {
  const { rowCount } = await pool.query(
    'SELECT 1 FROM provinces_new WHERE id = $1',
    [province_id]
  );
  if (!rowCount) {
    return res.status(404).json(fail('Không tìm thấy tỉnh/thành', 'PROVINCE_NOT_FOUND'));
  }
}
```

---

## Phụ lục A: các điểm cần đối chiếu với code thật trước khi chốt v1.4

Tài liệu này được viết từ `schema.sql` v1.3, `runBatchTest.js` và các tài liệu cũ. Chưa đối chiếu với `qa.controller.js` và script nạp dữ liệu, nên các điểm sau cần kiểm tra:

| # | Điểm cần kiểm tra | Vì sao |
|---|---|---|
| 1 | Backend dùng `province_id` để làm gì (lọc `unit_mapping`, lọc retrieval, hay chỉ ghi log) và hành vi khi thiếu field | Quyết định câu mô tả "giới hạn phạm vi tra cứu" ở mục 2.7 có đúng không |
| 2 | Kiểu thật của `id` trả về: tài liệu ghi chuỗi (`province_0001`, `unit_0007`), DB dùng `SERIAL` (số nguyên) và `code` kiểu `'u0007'` | Frontend và Postman phụ thuộc định dạng này |
| 3 | `admin_units_new.code` được sinh thế nào. Nếu ghép từ `id` của sequence thì cùng lỗi lệch giữa hai máy lặp lại ở cấp xã/phường (168 đơn vị trở lên) | Cần sinh `code` theo thứ tự cố định trong Phụ lục Nghị quyết, không theo sequence |
| 4 | Kiểu `qa_log_id`: ví dụ cũ của `/feedback` ghi `"log_00099"`, cột `qa_logs.id` là `SERIAL` | Tài liệu v1.4 đang ghi số nguyên |
| 5 | Giá trị mặc định của `model` và `llm_provider` khi client không gửi | Cần ghi rõ vào bảng request |
| 6 | Danh sách `old_provinces` của 7 tỉnh ngoài TP.HCM trong `GET /provinces` | Ví dụ ở mục 2.1 mới có dữ liệu của TP.HCM |

---

Mọi thay đổi với tài liệu này cần báo trong nhóm chat và cập nhật ngay, để hai bên không code lệch nhau.
