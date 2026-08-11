# API DOCUMENTATION
## Hệ thống hỏi đáp tự động về địa giới hành chính TP.HCM (Done Team)
**Version:** v1.2 (bổ sung field `merge_type` — phân biệt sáp nhập toàn bộ/một phần) | **Base URL:** `http://localhost:3000/api/v1` (dev) / `https://<domain>/api/v1` (prod)

> **Thay đổi so với v1.1:** thêm field `merge_type` (`toan_bo` \| `mot_phan`) vào `old_units[]` trong `GET /admin-units/{id}` và bổ sung 2 ví dụ response mẫu ở mục 2.7 cho trường hợp 1 đơn vị cũ bị chia vào nhiều đơn vị mới. Lý do: rà soát dữ liệu phát hiện ~46-48 dòng thuộc dạng "một phần diện tích" trong Nghị quyết 1685, nếu bỏ qua sẽ trả lời sai bản chất pháp lý.

> Tài liệu này là **hợp đồng (contract)** giữa Backend và Frontend. Mọi thay đổi phải được cả 2 thành viên thống nhất và cập nhật lại file này trước khi code.

> **Đổi mới so với v1:** CSDL giờ có **2 tầng** — cấp tỉnh (`provinces_old`/`provinces_new`/`province_mapping`: TP.HCM + Bình Dương + Bà Rịa-Vũng Tàu → TP.HCM mới) và cấp xã/phường (`admin_units_old`/`admin_units_new`/`unit_mapping`, đã có từ v1). Thay đổi chính:
> - **Thêm mới:** mục 2.1–2.3 — 3 endpoint cấp tỉnh (`/provinces`, `/provinces/{id}`, `/provinces/search`)
> - **Sửa:** `GET /admin-units` và `GET /admin-units/{id}` — bổ sung field `new_province`, và mỗi `old_unit` có thêm `old_province`
> - Đánh số lại toàn bộ mục 2 theo thứ tự: Tỉnh → Xã/phường → RAG → Văn bản → Feedback → Health

---

## 1. Quy ước chung

| Mục | Quy định |
|---|---|
| Định dạng | JSON, `Content-Type: application/json; charset=utf-8` |
| Encoding | UTF-8 (bắt buộc, vì có dấu tiếng Việt) |
| Versioning | Tiền tố `/api/v1` cho mọi endpoint |
| Đặt tên URL | kebab-case, danh từ số nhiều (VD: `/admin-units`, `/provinces`) |
| Đặt tên field JSON | snake_case (VD: `old_name`, `created_at`) |
| Phân trang | Query param `page` (mặc định 1), `limit` (mặc định 20, tối đa 100) |
| Thời gian | ISO 8601, UTC (VD: `"2026-07-28T10:00:00Z"`) |
| Auth | Không bắt buộc cho đồ án (public API); nếu cần giới hạn, dùng header `X-API-Key` đơn giản |

### 1.1 Format response chuẩn (áp dụng cho MỌI endpoint)

**Thành công:**
```json
{ "success": true, "data": { }, "message": "OK" }
```

**Danh sách có phân trang:**
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
| `PROVINCE_NOT_FOUND` | 404 | Không tìm thấy tỉnh/thành *(mới)* |
| `UNIT_NOT_FOUND` | 404 | Không tìm thấy đơn vị hành chính cấp xã/phường |
| `DOCUMENT_NOT_FOUND` | 404 | Không tìm thấy văn bản/nguồn trích dẫn |
| `NO_ANSWER_FOUND` | 200 | RAG không tìm được câu trả lời đủ tin cậy (`data.answer = null`) |
| `RATE_LIMITED` | 429 | Gọi API hỏi đáp quá tần suất cho phép |
| `INTERNAL_ERROR` | 500 | Lỗi hệ thống ngoài dự kiến |

---

## 2. Endpoints

### 2.1 `GET /provinces` *(mới)*
Lấy danh sách tỉnh/thành mới (hiện tại chỉ có 1 dòng "TP. Hồ Chí Minh", nhưng thiết kế sẵn cho việc mở rộng miền Nam sau này).

**Query params:** `page`, `limit` (giống chuẩn phân trang ở mục 1).

**Response 200:**
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
    "pagination": { "page": 1, "limit": 20, "total_items": 1, "total_pages": 1 }
  },
  "message": "OK"
}
```

---

### 2.2 `GET /provinces/{id}` *(mới)*
Chi tiết 1 tỉnh/thành mới, gồm cả nguồn trích dẫn nghị quyết cấp tỉnh.

**Response 200:**
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
**Lỗi:** `PROVINCE_NOT_FOUND` (404).

---

### 2.3 `GET /provinces/search` *(mới)*
Tra cứu nhanh: tỉnh cũ → tỉnh mới (dùng khi mở rộng dữ liệu các tỉnh miền Nam khác).

**Query params:** `old_name` (string, bắt buộc)

**Ví dụ:** `GET /provinces/search?old_name=Bình Dương`

**Response 200:**
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
**Lỗi:** `PROVINCE_NOT_FOUND` (404).

---

### 2.4 `GET /admin-units` *(đã cập nhật)*
Lấy danh sách đơn vị hành chính cấp xã/phường (mới), có filter và phân trang.

**Query params:**
| Tên | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `page` | int | Không | Trang hiện tại, mặc định 1 |
| `limit` | int | Không | Số item/trang, mặc định 20 |
| `type` | string | Không | Lọc theo loại: `phuong` \| `xa` \| `dac_khu` |
| `province` | string | Không | *(mới)* Lọc theo tỉnh/thành mới, VD `TP. Hồ Chí Minh` — hữu ích khi mở rộng nhiều tỉnh |
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
> Ví dụ minh họa mang tính mẫu cấu trúc dữ liệu — số liệu thực tế cần lấy đúng theo Phụ lục Nghị quyết 1685/NQ-UBTVQH15.

**Lỗi có thể gặp:** `VALIDATION_ERROR` (400) nếu `type` không thuộc enum cho phép.

---

### 2.5 `GET /admin-units/{id}` *(đã cập nhật)*
Lấy chi tiết 1 đơn vị hành chính cấp xã/phường.

**Response 200:**
```json
{
  "success": true,
  "data": {
    "id": "unit_0007",
    "new_name": "Phường Sài Gòn",
    "new_type": "phuong",
    "new_province": "TP. Hồ Chí Minh",
    "old_units": [
      { "old_name": "Phường Bến Nghé", "old_parent": "Quận 1", "old_province": "TP. Hồ Chí Minh (cũ)", "merge_type": "toan_bo" },
      { "old_name": "Phường Đa Kao", "old_parent": "Quận 1", "old_province": "TP. Hồ Chí Minh (cũ)", "merge_type": "mot_phan" },
      { "old_name": "Phường Nguyễn Thái Bình", "old_parent": "Quận 1", "old_province": "TP. Hồ Chí Minh (cũ)", "merge_type": "mot_phan" }
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
> Field `old_province` trong mỗi phần tử `old_units` (lấy qua `admin_units_old.province_old_id`) là điểm khác biệt chính so với v1 — cho biết đơn vị cũ này thuộc tỉnh nào trước sáp nhập, quan trọng khi dữ liệu mở rộng ra nhiều tỉnh.
>
> **Field `merge_type` *(mới — v1.2)*:** giá trị `toan_bo` hoặc `mot_phan`, lấy từ `unit_mapping.merge_type` — cho biết đơn vị cũ này góp toàn bộ hay chỉ một phần diện tích/dân số vào đơn vị mới. Frontend nên hiển thị nhãn phụ (VD badge "một phần") bên cạnh tên đơn vị cũ khi giá trị là `mot_phan`, để người dùng không hiểu nhầm là sáp nhập trọn vẹn.

**Lỗi:** `UNIT_NOT_FOUND` (404) nếu `id` không tồn tại.

---

### 2.6 `GET /admin-units/search`
Tra cứu nhanh 1-lệnh theo tên cũ (dùng cho ô tìm kiếm nổi bật trên trang chủ). *(không đổi so với v1)*

**Query params:** `old_name` (string, bắt buộc)

**Response 200:**
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
**Lỗi:** `UNIT_NOT_FOUND` (404) nếu không khớp tên nào; response nên gợi ý các tên gần giống trong `message` (fuzzy match) nếu có thể triển khai.

---

### 2.7 `POST /qa/ask` (endpoint quan trọng nhất — lõi RAG)
Gửi câu hỏi tự nhiên bằng tiếng Việt, nhận câu trả lời kèm nguồn trích dẫn. *(không đổi cấu trúc, nhưng giờ có thể trả lời cả câu hỏi cấp tỉnh)*

**Request body:**
```json
{ "question": "Phường Bến Nghé cũ bây giờ là phường gì?", "session_id": "sess_abc123" }
```
| Field | Kiểu | Bắt buộc | Mô tả |
|---|---|---|---|
| `question` | string | Có | Câu hỏi người dùng, tối đa 500 ký tự |
| `session_id` | string | Không | Dùng để nhóm lịch sử hội thoại |

**Response 200 — có câu trả lời (cấp xã/phường):**
```json
{
  "success": true,
  "data": {
    "answer": "Phường Bến Nghé (cũ) hiện nay thuộc Phường Sài Gòn, được thành lập trên cơ sở hợp nhất các phường Bến Nghé, Bến Thành và Nguyễn Thái Bình theo Nghị quyết 1685/NQ-UBTVQH15.",
    "answer_type": "structured_lookup",
    "answer_level": "unit",
    "confidence": 0.96,
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

**Response 200 — câu hỏi ở cấp tỉnh** *(trường hợp mới)*:
```json
{
  "success": true,
  "data": {
    "answer": "Tỉnh Bình Dương (cũ) hiện nay đã sáp nhập vào TP. Hồ Chí Minh theo Nghị quyết 202/2025/QH15.",
    "answer_type": "structured_lookup",
    "answer_level": "province",
    "confidence": 0.97,
    "sources": [
      {
        "document_id": "doc_0001",
        "title": "Nghị quyết 202/2025/QH15",
        "excerpt": "...",
        "source_url": "https://vbpl.vn/...",
        "section": "Điều 1"
      }
    ]
  },
  "message": "OK"
}
```
> Field `answer_level` *(mới)* cho biết câu trả lời tra cứu ở tầng nào: `province` hay `unit` — hữu ích để Frontend hiển thị icon/badge khác nhau.

**Response 200 — trường hợp đơn vị CŨ bị chia làm nhiều nơi** *(mới — v1.2, quan trọng)*:

Câu hỏi mẫu: `"Phường Đa Kao cũ bây giờ thuộc phường nào?"`
```json
{
  "success": true,
  "data": {
    "answer": "Phường Đa Kao (cũ) không nhập trọn vào 1 phường mà được chia làm 2: một phần diện tích nhập vào phường Sài Gòn, phần còn lại nhập vào phường Tân Định, theo Nghị quyết 1685/NQ-UBTVQH15.",
    "answer_type": "structured_lookup",
    "answer_level": "unit",
    "confidence": 0.95,
    "sources": [
      { "document_id": "doc_0042", "title": "Nghị quyết 1685/NQ-UBTVQH15", "section": "Khoản 1", "source_url": "https://vbpl.vn/..." },
      { "document_id": "doc_0042", "title": "Nghị quyết 1685/NQ-UBTVQH15", "section": "Khoản 2", "source_url": "https://vbpl.vn/..." }
    ]
  },
  "message": "OK"
}
```
> **Bắt buộc phía backend:** khi truy vấn `unit_mapping` theo `old_unit_id` trả về nhiều hơn 1 dòng, code sinh câu trả lời phải chuyển sang mẫu câu "được chia làm X phần...", liệt kê đủ tất cả đơn vị mới liên quan trong `sources`. Không được chỉ lấy dòng đầu tiên rồi trả lời như nhập trọn vào 1 nơi.

**Response 200 — trường hợp đơn vị MỚI gộp từ nhiều nguồn (có cả toàn bộ lẫn một phần)** *(mới — v1.2)*:

Câu hỏi mẫu: `"Phường Sài Gòn được sáp nhập từ những phường nào?"`
```json
{
  "success": true,
  "data": {
    "answer": "Phường Sài Gòn được hình thành từ toàn bộ phường Bến Nghé, cộng với một phần diện tích của phường Đa Kao và phường Nguyễn Thái Bình (đều thuộc Quận 1 cũ), theo Khoản 1 Nghị quyết 1685/NQ-UBTVQH15.",
    "answer_type": "structured_lookup",
    "answer_level": "unit",
    "confidence": 0.95,
    "sources": [
      { "document_id": "doc_0042", "title": "Nghị quyết 1685/NQ-UBTVQH15", "section": "Khoản 1", "source_url": "https://vbpl.vn/..." }
    ]
  },
  "message": "OK"
}
```
> Logic sinh câu: nhóm kết quả `unit_mapping` theo `merge_type` trước khi ghép câu — liệt kê nhóm `toan_bo` trước ("được hình thành từ toàn bộ..."), sau đó nối thêm nhóm `mot_phan` ("cộng với một phần diện tích của..."). Không gộp chung tất cả thành 1 danh sách phẳng vì sẽ nói sai bản chất pháp lý (ngụ ý tất cả đều nhập trọn).

**Response 200 — không tìm được câu trả lời đủ tin cậy:**
```json
{
  "success": true,
  "data": {
    "answer": null,
    "answer_type": "no_answer",
    "answer_level": null,
    "confidence": 0.0,
    "sources": [],
    "suggestion": "Câu hỏi nằm ngoài phạm vi dữ liệu hệ thống hiện có (TP.HCM sau sắp xếp)."
  },
  "message": "NO_ANSWER_FOUND",
  "error_code": "NO_ANSWER_FOUND"
}
```

**Field `answer_type`:** `structured_lookup` (tra cứu trực tiếp — ưu tiên thử cấp xã/phường trước, không khớp mới thử cấp tỉnh) | `rag_generated` (LLM tổng hợp từ semantic search) | `no_answer`.

**Lỗi có thể gặp:** `VALIDATION_ERROR` (400), `RATE_LIMITED` (429).

---

### 2.8 `GET /documents/{id}`
Xem chi tiết 1 văn bản pháp lý. *(không đổi — dùng chung cho cả văn bản cấp tỉnh và cấp xã/phường vì `legal_documents` là 1 bảng duy nhất)*

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

### 2.9 `POST /feedback` (tùy chọn — điểm cộng khi báo cáo)
*(không đổi so với v1)*
```json
{ "qa_log_id": "log_00099", "is_helpful": true, "note": "" }
```
**Response 200:**
```json
{ "success": true, "data": { "recorded": true }, "message": "OK" }
```

---

### 2.10 `GET /health`
*(giữ nguyên, dời xuống cuối vì đây là endpoint tiện ích chứ không thuộc nghiệp vụ)*
```json
{
  "success": true,
  "data": { "status": "ok", "db": "connected", "vector_db": "connected" },
  "message": "OK"
}
```

---

## 3. Ví dụ luồng sử dụng (dùng để 2 bạn test bằng Postman)

1. `GET /health` → xác nhận server sống.
2. `GET /provinces` → xem tỉnh/thành hiện có *(mới)*.
3. `GET /admin-units?keyword=tan dinh` → lấy danh sách gợi ý.
4. `GET /admin-units/{id}` → xem chi tiết 1 đơn vị (giờ có kèm `old_province`).
5. `POST /qa/ask` với câu hỏi tự nhiên (thử cả câu hỏi cấp tỉnh và cấp xã/phường) → nhận câu trả lời + nguồn.
6. `GET /documents/{id}` → xem chi tiết nguồn vừa nhận được ở bước 5.

→ Cập nhật lại **Postman Collection** (`done-team.postman_collection.json`) thêm 3 request mới cho `/provinces`, đẩy lên Git.

---

## 4. Gợi ý cài đặt phía Node.js/Express (khớp với API doc v1.1)

```js
// routes/provinces.js (MỚI)
router.get('/provinces/search', provinceController.searchByOldName); // để TRƯỚC /:id
router.get('/provinces/:id', provinceController.getById);
router.get('/provinces', provinceController.list);

// routes/adminUnits.js
router.get('/admin-units/search', adminUnitController.searchByOldName); // để TRƯỚC /:id
router.get('/admin-units/:id', adminUnitController.getById);
router.get('/admin-units', adminUnitController.list);

// routes/qa.js
router.post('/qa/ask', qaController.ask);

// utils/response.js — dùng chung toàn bộ app
function success(data, message = 'OK') {
  return { success: true, data, message };
}
function fail(message, error_code) {
  return { success: false, data: null, message, error_code };
}
module.exports = { success, fail };
```

**Ví dụ query JOIN 2 tầng cho `adminUnitController.getById` (khớp `schema_province_extension.sql`):**
```js
const { rows } = await pool.query(
  `SELECT n.code AS id, n.name AS new_name, n.unit_type AS new_type,
          pn.name AS new_province,
          n.headquarters_address
   FROM admin_units_new n
   LEFT JOIN provinces_new pn ON pn.id = n.province_new_id
   WHERE n.code = $1`,
  [id]
);
```

> Lưu ý thứ tự route: `/search` phải khai báo **trước** `/:id` ở cả `provinces.js` lẫn `adminUnits.js`, nếu không Express sẽ hiểu nhầm `search` là 1 giá trị `id`.

---

*Mọi thay đổi với tài liệu này cần thông báo trong nhóm chat và cập nhật ngay để tránh 2 bên code lệch nhau.*
