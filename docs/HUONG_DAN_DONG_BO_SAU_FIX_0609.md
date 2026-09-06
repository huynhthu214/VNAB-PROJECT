# Hướng dẫn đồng bộ sau khi sửa bug trộn lẫn dữ liệu tỉnh

## Bối cảnh — vì sao cần làm lại các bước này

**Nguyên nhân:** bug trong `scripts/import_excel_to_db.js` — hàm sinh mã `code` cho
bảng `admin_units_new` dùng bộ đếm tuần tự (`u0001, u0002...`), bộ đếm này **reset
về 0 mỗi lần chạy script**. Vì mỗi tỉnh được import bằng 1 lệnh riêng (chạy nhiều
lần, nhiều tiến trình Node độc lập), hai tỉnh khác nhau có xác suất cao vô tình
sinh trùng `code` → ràng buộc `ON CONFLICT (code)` nối nhầm dữ liệu 2 tỉnh vào
chung 1 bản ghi `admin_units_new`.

**Ai cần làm theo hướng dẫn này:** bất kỳ ai có **database riêng trên máy mình**
(không dùng chung 1 DB server với người đã sửa) — vì lỗi nằm trong dữ liệu đã
insert từ trước, sửa code không tự động sửa dữ liệu cũ đã sai.

Nếu cả nhóm dùng chung 1 database (server chung), chỉ cần 1 người làm theo hướng
dẫn này 1 lần là đủ — người khác chỉ cần `git pull` code mới, không cần chạy lại
các bước database.

---

## Bước 0 — Bắt buộc: backup database trước khi làm bất cứ điều gì

Hướng dẫn này có bước `TRUNCATE` (xoá dữ liệu). Backup trước để có đường lùi.

**Nếu dùng Adminer** (giao diện web quản lý DB):

1. Vào trang chủ Adminer → menu **"Xuất"**
2. Chọn Format: SQL, tick chọn **structure + data**, chọn **tất cả bảng**
3. Bấm Xuất, lưu file `.sql` tải về

**Nếu có `pg_dump` (cài PostgreSQL local):**

```bash
pg_dump -h localhost -p 5432 -U <user> -d <tên_database> -F c -f backup_truoc_khi_fix.dump
```

---

## Bước 1 — `git pull` lấy code mới nhất

Đảm bảo đã có các file đã sửa:

- `src/controllers/qa.controller.js`
- `scripts/import_excel_to_db.js`
- `scripts/generateSyntheticChunks.js`

## Bước 2 — Chạy migration SQL (thêm cột lọc theo tỉnh)

Nếu cột này chưa có trong DB của bạn, chạy:

```sql
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS province_new_id INTEGER REFERENCES provinces_new(id);
CREATE INDEX IF NOT EXISTS idx_document_chunks_province ON document_chunks(province_new_id);
```

## Bước 3 — Xoá dữ liệu bị lỗi

```sql
BEGIN;
TRUNCATE TABLE admin_units_new RESTART IDENTITY CASCADE;
COMMIT;
```

> Trước khi COMMIT, đọc kỹ thông báo `NOTICE: truncate cascades to table "..."` mà
> PostgreSQL in ra — chỉ nên thấy `unit_mapping` bị cascade theo. Nếu thấy bảng lạ
> khác cũng bị cascade, dừng lại (`ROLLBACK`) và báo lại cho người đã viết hướng dẫn.

## Bước 4 — Import lại toàn bộ dữ liệu

```bash
node scripts/import_excel_to_db.js data/du_lieu_tphcm_final_v2.xlsx
node scripts/import_excel_to_db.js data/an_giang_data_collection.xlsx
node scripts/import_excel_to_db.js data/ca_mau_data_collection.xlsx
node scripts/import_excel_to_db.js data/can_tho_data_collection.xlsx
node scripts/import_excel_to_db.js data/dong_nai_data_collection.xlsx
node scripts/import_excel_to_db.js data/dong_thap_data_collection.xlsx
node scripts/import_excel_to_db.js data/tay_ninh_data_collection.xlsx
node scripts/import_excel_to_db.js data/vinh_long_data_collection.xlsx
```

## Bước 5 — Kiểm tra đã sạch chưa

```sql
SELECT n.id, n.name, COUNT(DISTINCT o.province_old) AS so_tinh_cu_khac_nhau
FROM admin_units_new n
JOIN unit_mapping m ON m.new_unit_id = n.id
JOIN admin_units_old o ON o.id = m.old_unit_id
GROUP BY n.id, n.name
HAVING COUNT(DISTINCT o.province_old) > 3
ORDER BY so_tinh_cu_khac_nhau DESC;
```

**Kỳ vọng: 0 dòng trả về** (hoặc chỉ vài dòng có lý do chính đáng thật sự thuộc
cùng 1 tỉnh cũ, gộp từ nhiều huyện). Nếu vẫn thấy nhiều dòng với số tỉnh cao (6-9)
như trước → dừng lại, đừng làm tiếp bước 6, báo lại ngay.

## Bước 6 — Sinh lại chunk tổng hợp + embedding

```bash
node scripts/generateSyntheticChunks.js
node scripts/embedChunks.js
```

## Bước 7 — Đảm bảo `uvicorn` (service embedding/rerank) đang chạy

```bash
uvicorn app:app --reload --port 8001
```

Đợi thấy dòng `Application startup complete` rồi mới chạy backend Node.

---

## Thay đổi API cần biết khi code frontend/test

Endpoint `/api/v1/qa/ask` giờ nhận thêm field **tuỳ chọn** `province_id` (số
nguyên) để lọc kết quả theo đúng tab tỉnh đang chọn:

```json
{
  "question": "...",
  "model": "advanced_rag",
  "llm_provider": "gemini",
  "province_id": 1
}
```

8 giá trị hợp lệ (khớp `provinces_new.id`, mỗi số = 1 tab trên frontend):

| id  | Tỉnh/thành      |
| --- | --------------- |
| 1   | TP. Hồ Chí Minh |
| 7   | An Giang        |
| 9   | Cà Mau          |
| 11  | TP. Cần Thơ     |
| 14  | Đồng Nai        |
| 16  | Đồng Tháp       |
| 18  | Tây Ninh        |
| 20  | Vĩnh Long       |

Nếu không truyền `province_id`, hệ thống vẫn chạy được (không lọc gì, hành vi như
trước đây) — nhưng khi frontend đã có tab, luôn nên truyền kèm để tránh lặp lại
đúng lỗi trộn tỉnh đã sửa ở trên.
