# KẾ HOẠCH DỰ ÁN
## Xây dựng hệ thống hỏi đáp tự động về địa giới hành chính mới ở TP. Hồ Chí Minh (mới), mở rộng sau cho khu vực miền Nam Việt Nam

**Nhóm:** Done Team (2 thành viên)
**Chuyên ngành:** Hệ thống thông tin

---

## PHẦN 1: CHIẾN LƯỢC TỔNG THỂ

Theo yêu cầu của giảng viên, dự án chia làm **2 giai đoạn**:

| Giai đoạn | Phạm vi | Mục tiêu |
|---|---|---|
| **Giai đoạn 1 (bắt buộc, ưu tiên)** | TP. Hồ Chí Minh mới (hợp nhất từ TP.HCM, Bình Dương, Bà Rịa - Vũng Tàu) | Hệ thống hoàn chỉnh, chạy tốt, làm nền tảng kiến trúc |
| **Giai đoạn 2 (mở rộng, nếu còn thời gian)** | Các tỉnh còn lại khu vực miền Nam | Mở rộng dữ liệu, tái sử dụng kiến trúc đã xây |

**Lý do chọn hướng này hợp lý:** Kiến trúc hệ thống (CSDL, module xử lý câu hỏi, RAG, giao diện) được thiết kế tổng quát ngay từ đầu, nên khi mở rộng dữ liệu sang tỉnh khác ở giai đoạn 2, bạn **chỉ cần nạp thêm dữ liệu**, không cần sửa lại kiến trúc — đây là điểm nên nhấn mạnh khi báo cáo với giảng viên.

---

## PHẦN 2: TIMELINE TỔNG QUÁT (Áp dụng linh hoạt theo thời gian môn học của bạn)

| Tuần | Nội dung chính | Backend (Bạn A) | Frontend (Bạn B) |
|---|---|---|---|
| 1 | Khảo sát, thu thập dữ liệu, thiết kế CSDL | Thiết kế ERD, chuẩn hóa dữ liệu TP.HCM mới | Thiết kế wireframe/giao diện, chọn UI kit |
| 2 | Dựng nền tảng kỹ thuật | Setup server, CSDL, API khung (mock data) | Setup project frontend, dựng layout tĩnh |
| 3 | Xây module lõi | Xây API truy vấn CSDL (chưa có RAG) | Kết nối API thật, hiển thị dữ liệu tra cứu cơ bản |
| 4 | Tích hợp AI | Tích hợp LLM (RAG), API hỏi-đáp tự nhiên | Xây giao diện chat hỏi-đáp, xử lý loading/error |
| 5 | Hoàn thiện tính năng phụ | API trích dẫn nguồn, tối ưu truy vấn | Hiển thị nguồn trích dẫn, UI polish |
| 6 | Tích hợp & kiểm thử | Sửa lỗi API theo phản hồi frontend | Test toàn bộ luồng, sửa UI/UX |
| 7 | Đánh giá hệ thống | Chạy bộ test câu hỏi, đo độ chính xác | Hỗ trợ ghi nhận lỗi từ giao diện |
| 8 | Viết báo cáo, chuẩn bị bảo vệ | Viết phần kiến trúc kỹ thuật | Viết phần giao diện, chuẩn bị demo |
| 9+ | (Nếu còn thời gian) Mở rộng miền Nam | Nạp thêm dữ liệu tỉnh khác | Điều chỉnh UI cho dữ liệu mở rộng |

> Lưu ý: Tuần 2-3, backend nên cung cấp **mock API** (dữ liệu giả lập cố định) ngay cả khi CSDL thật chưa xong, để frontend không bị chờ và có thể làm song song.

---

## PHẦN 3: BẢNG PHÂN CÔNG CÔNG VIỆC CHI TIẾT

### 3.1. Backend (Bạn phụ trách: ___________)

| Hạng mục | Công việc cụ thể | Công nghệ gợi ý |
|---|---|---|
| Dữ liệu | Thu thập dữ liệu địa giới hành chính TP.HCM mới từ Nghị quyết 202/2025/QH15; làm sạch, chuẩn hóa | Excel/CSV → import CSDL |
| CSDL | Thiết kế ERD, tạo bảng: `tinh_moi`, `tinh_cu`, `xa_phuong_moi`, `xa_phuong_cu` (tham khảo mô hình đã trao đổi trước đó) | MySQL / PostgreSQL |
| API tra cứu cơ bản | Endpoint tra cứu trực tiếp theo tên xã/phường cũ hoặc mới | REST API (Node.js/Express, hoặc Python/FastAPI) |
| Module Retrieval | Viết logic tìm kiếm dữ liệu liên quan đến câu hỏi (query CSDL theo từ khóa địa danh nhận diện được) | SQL query / có thể thêm full-text search |
| Tích hợp LLM | Gọi API LLM (OpenAI/Claude/Gemini), soạn prompt kết hợp dữ liệu truy xuất được | LLM API (RAG pattern) |
| API trích dẫn nguồn | Trả kèm thông tin nguồn dữ liệu gốc (VD: số nghị quyết, điều khoản) cùng câu trả lời | Gắn field `source` trong response |
| Kiểm thử backend | Viết test case cho từng API, kiểm tra dữ liệu trả về đúng định dạng | Postman / Thunder Client |
| Triển khai | Deploy backend (nếu cần demo online) | Render/Railway (miễn phí) |

### 3.2. Frontend (Bạn phụ trách: ___________)

| Hạng mục | Công việc cụ thể | Công nghệ gợi ý |
|---|---|---|
| Thiết kế UI | Wireframe giao diện: ô hỏi - đáp, khung hiển thị câu trả lời, phần tra cứu nhanh | Figma (tùy chọn) |
| Giao diện chính | Xây trang hỏi-đáp dạng chat đơn giản | React / Vue / HTML-CSS-JS thuần |
| Kết nối API | Gọi API backend, xử lý loading, lỗi mạng, timeout | Axios / Fetch API |
| Hiển thị kết quả | Render câu trả lời tự nhiên + phần trích dẫn nguồn (nếu có) | Component riêng cho "nguồn trích dẫn" |
| Tính năng phụ | Ô tra cứu nhanh theo tên xã/tỉnh (không cần qua LLM, tra thẳng CSDL) | Autocomplete/search box |
| Bản đồ (nếu làm) | Tích hợp Leaflet.js hiển thị ranh giới khi tra cứu 1 khu vực | Leaflet.js + GeoJSON |
| Responsive | Đảm bảo giao diện chạy tốt trên máy tính (ưu tiên, vì demo thường trên laptop) | CSS Flexbox/Grid |
| Kiểm thử frontend | Test toàn bộ luồng nhập câu hỏi → nhận câu trả lời, test các trường hợp lỗi | Test thủ công theo checklist |

### 3.3. Công việc chung (cả 2 người)
- Họp đầu mỗi tuần để rà soát tiến độ, thống nhất API contract (xem Phần 4).
- Viết báo cáo: chia đôi theo phần mình phụ trách, ghép lại cuối kỳ.
- Chuẩn bị demo và trả lời phản biện.

---

## PHẦN 4: QUY TẮC THIẾT KẾ API (API CONTRACT)

Đây là phần **quan trọng nhất để 2 người làm việc độc lập không bị xung đột**. Hãy thống nhất và ghi ra văn bản (VD: 1 file `API_CONTRACT.md` dùng chung) **trước khi bắt đầu code**, không đợi đến lúc ghép mới bàn.

### 4.1. Quy tắc đặt tên endpoint (naming convention)

- Dùng **danh từ số nhiều, chữ thường, nối bằng dấu gạch ngang** cho URL:
  - ✅ `/api/administrative-units`
  - ❌ `/api/getAdminUnit`, `/api/GetData`

- Cấu trúc gợi ý cho đồ án này:

| Method | Endpoint | Chức năng |
|---|---|---|
| `POST` | `/api/ask` | Gửi câu hỏi tự nhiên, nhận câu trả lời từ RAG |
| `GET` | `/api/units/search?query=...` | Tra cứu nhanh theo tên xã/tỉnh (không qua LLM) |
| `GET` | `/api/units/{id}` | Lấy chi tiết 1 đơn vị hành chính theo ID |
| `GET` | `/api/units/{id}/boundary` | Lấy dữ liệu ranh giới (GeoJSON) nếu làm bản đồ |

### 4.2. Định dạng request/response cố định (RẤT QUAN TRỌNG)

**Mọi response đều theo khuôn mẫu chung**, để frontend luôn biết cách xử lý mà không cần đoán:

```json
// Response thành công
{
  "success": true,
  "data": { ... },
  "message": "OK"
}

// Response lỗi
{
  "success": false,
  "data": null,
  "message": "Không tìm thấy đơn vị hành chính phù hợp"
}
```

**Ví dụ cụ thể cho `/api/ask`:**

Request:
```json
{
  "question": "Xã Bình Thạnh, huyện Cao Lãnh cũ nay thuộc đâu?"
}
```

Response:
```json
{
  "success": true,
  "data": {
    "answer": "Xã Bình Thạnh, huyện Cao Lãnh trước đây nay thuộc Phường Cao Lãnh, TP. Hồ Chí Minh.",
    "sources": [
      {
        "old_unit": "Xã Bình Thạnh",
        "new_unit": "Phường Cao Lãnh",
        "reference": "Nghị quyết 202/2025/QH15"
      }
    ]
  },
  "message": "OK"
}
```

→ **Frontend chỉ cần code 1 lần** cách xử lý `success/data/message`, áp dụng cho mọi API, không phải học lại cấu trúc riêng cho từng endpoint.

### 4.3. Quy tắc mã lỗi HTTP thống nhất

| Mã lỗi | Ý nghĩa | Khi nào dùng |
|---|---|---|
| 200 | Thành công | Trả dữ liệu bình thường |
| 400 | Request sai định dạng | Thiếu field `question`, sai kiểu dữ liệu |
| 404 | Không tìm thấy | Tra cứu không ra kết quả |
| 500 | Lỗi server | Lỗi khi gọi LLM, lỗi CSDL |

### 4.4. Quy trình làm việc để tránh "chờ nhau"

1. **Trước khi code:** Backend viết trước tài liệu API (endpoint, request/response mẫu như trên) và gửi cho frontend — dùng chung 1 file `API_CONTRACT.md` trong repo Git.
2. **Backend cung cấp mock API sớm:** Dùng dữ liệu giả (hard-code sẵn 3-5 câu trả lời mẫu) để trả về đúng định dạng đã thống nhất, giúp frontend code song song không cần chờ backend xong thật.
3. **Dùng Postman/Thunder Client:** Backend test API độc lập trước, đảm bảo đúng contract rồi mới báo frontend gọi thật.
4. **Version code chung qua Git:** Dùng 1 repository (GitHub), chia nhánh riêng (`backend`, `frontend`), merge định kỳ, tránh conflict.
5. **Đặt biến môi trường rõ ràng:** Backend cung cấp file `.env.example` ghi rõ `API_BASE_URL`, để frontend cấu hình đúng khi test local và khi deploy.

---

## PHẦN 5: HƯỚNG DẪN CHI TIẾT TỪNG BƯỚC THỰC HIỆN

### Bước 1: Thu thập và chuẩn hóa dữ liệu (Tuần 1)
1. Tìm văn bản chính thức: Nghị quyết 202/2025/QH15, các quyết định liên quan đến sáp nhập TP.HCM, Bình Dương, Bà Rịa - Vũng Tàu.
2. Trích xuất dữ liệu vào file Excel/CSV trung gian với các cột: `tên đơn vị cũ`, `cấp (xã/huyện/tỉnh)`, `tên đơn vị mới`, `trung tâm hành chính mới`.
3. Rà soát, loại bỏ trùng lặp, thống nhất cách viết tên (VD: "Q.1" vs "Quận 1" — chọn 1 chuẩn duy nhất).

### Bước 2: Thiết kế cơ sở dữ liệu (Tuần 1)
1. Vẽ sơ đồ ERD dựa trên mô hình 4 bảng đã đề cập (`tinh_moi`, `tinh_cu`, `xa_phuong_moi`, `xa_phuong_cu`).
2. Xác định khóa chính, khóa ngoại, quan hệ 1-nhiều giữa đơn vị cũ và mới.
3. Tạo CSDL thật (MySQL/PostgreSQL), import dữ liệu đã chuẩn hóa ở Bước 1.

### Bước 3: Xây dựng API truy vấn cơ bản (Tuần 2-3)
1. Viết API `/api/units/search` — tra cứu trực tiếp theo tên, chưa cần AI.
2. Test kỹ API này trước — đây là nền tảng để module RAG sau này lấy dữ liệu.

### Bước 4: Xây dựng module RAG (Tuần 3-4)
1. Viết hàm nhận diện tên địa danh trong câu hỏi (cách đơn giản: so khớp với danh sách tên xã/tỉnh có trong CSDL bằng thuật toán so khớp chuỗi gần đúng — fuzzy matching).
2. Dùng kết quả nhận diện để query CSDL lấy dữ liệu liên quan.
3. Ghép dữ liệu vào prompt, gọi API LLM, nhận câu trả lời.
4. Trả kết quả theo đúng định dạng đã thống nhất trong API contract.

### Bước 5: Xây dựng giao diện (song song từ Tuần 2)
1. Dựng layout tĩnh trước (chưa cần dữ liệu thật).
2. Khi backend có mock API, kết nối thử để đảm bảo luồng hoạt động đúng.
3. Khi backend xong API thật, chỉ cần đổi endpoint, không cần sửa logic hiển thị (nhờ đã tuân theo contract chung).

### Bước 6: Tích hợp và kiểm thử toàn hệ thống (Tuần 6)
1. Gộp code backend + frontend, chạy thử toàn bộ luồng thực tế.
2. Test các trường hợp: câu hỏi đúng, câu hỏi không có trong dữ liệu, câu hỏi mơ hồ.
3. Ghi nhận lỗi, phân công sửa theo đúng phần phụ trách.

### Bước 7: Đánh giá hệ thống (Tuần 7)
1. Soạn bộ câu hỏi kiểm thử (khoảng 20-30 câu, đa dạng cách hỏi).
2. Chạy hệ thống, ghi nhận tỷ lệ trả lời đúng/sai.
3. Phân tích nguyên nhân các câu trả lời sai (do dữ liệu thiếu, do nhận diện địa danh sai, hay do LLM diễn đạt lệch).

### Bước 8: Viết báo cáo và chuẩn bị bảo vệ (Tuần 8)
1. Backend viết phần: kiến trúc hệ thống, thiết kế CSDL, RAG.
2. Frontend viết phần: thiết kế giao diện, trải nghiệm người dùng.
3. Ghép báo cáo, làm slide, phân công ai thuyết trình phần nào.

---

## PHẦN 6: LƯU Ý QUAN TRỌNG

- **Giai đoạn 1 phải chạy ổn định trước khi nghĩ đến mở rộng** — giảng viên đã yêu cầu rõ, đừng làm dữ liệu dàn trải nhiều tỉnh khi TP.HCM mới còn chưa hoàn thiện.
- **Ưu tiên tính đúng đắn của dữ liệu hơn là số lượng tính năng** — 1 hệ thống trả lời đúng 90% với ít tính năng vẫn tốt hơn nhiều tính năng nhưng trả lời sai nhiều.
- Tính năng bản đồ (Leaflet.js) nên để **sau cùng**, coi là điểm cộng, không phải yêu cầu bắt buộc — như đã trao đổi trước đó.
