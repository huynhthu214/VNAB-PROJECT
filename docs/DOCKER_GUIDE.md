# HƯỚNG DẪN DOCKER — TỪ ĐẦU ĐẾN CUỐI DỰ ÁN
## Done Team — Hệ thống hỏi đáp địa giới hành chính TP.HCM

> File `docker-compose.yml` này chỉ container hóa **database (PostgreSQL + pgvector)** và **Adminer**. Backend/Frontend vẫn chạy trực tiếp bằng `npm run dev` trên máy như đã hướng dẫn ở phần trước — không cần Docker cho 2 phần này với quy mô đồ án.

---

## 0. Cài đặt Docker (chỉ làm 1 lần)
- **Windows/Mac:** tải **Docker Desktop** tại https://www.docker.com/products/docker-desktop/ → cài đặt → mở app, đợi biểu tượng cá voi chuyển sang trạng thái "running".
- **Windows:** Docker Desktop yêu cầu **WSL2** — nếu chưa có, chạy `wsl --install` trong PowerShell (quyền Admin), khởi động lại máy, rồi mới cài Docker Desktop.
- **Linux:** cài **Docker Engine** + **Docker Compose plugin** theo hướng dẫn chính thức tại https://docs.docker.com/engine/install/
- Kiểm tra cài thành công:
```bash
docker --version
docker compose version
```

---

## 1. GIAI ĐOẠN THIẾT LẬP DỰ ÁN (Tuần 4–5)

### 1.1 Chuẩn bị file
Đặt `docker-compose.yml`, `.env` (copy từ `.env.docker.example`), và `schema.sql` cùng cấp thư mục (VD: gốc repo hoặc `database/`).

### 1.2 Khởi động lần đầu
```bash
docker compose up -d
```
- `up`: tạo và chạy container theo `docker-compose.yml`.
- `-d`: chạy nền (detached), không chiếm terminal.
- **Lần đầu chạy**, vì volume `pgdata` còn rỗng, PostgreSQL sẽ **tự động chạy `schema.sql`** (nhờ dòng mount vào `/docker-entrypoint-initdb.d/`) → 6 bảng được tạo sẵn ngay khi container khởi động, không cần chạy tay.

### 1.3 Kiểm tra container đã chạy đúng chưa
```bash
docker compose ps
```
Phải thấy `done_team_db` và `done_team_adminer` ở trạng thái `running (healthy)`.

### 1.4 Xem log để debug nếu lỗi
```bash
docker compose logs -f db
```
`-f` giữ terminal theo dõi log liên tục (`Ctrl+C` để thoát xem, không tắt container).

### 1.5 Kiểm tra schema đã tạo đúng chưa (không cần mở DBeaver)
```bash
docker exec -it done_team_db psql -U postgres -d done_team_db -c "\dt"
```
Phải liệt kê đủ 6 bảng.

---

## 2. GIAI ĐOẠN LÀM VIỆC HÀNG NGÀY (Tuần 5–14)

### 2.1 Bật lại container khi mở máy mới (đã tạo từ trước, chỉ cần start)
```bash
docker compose start
```
> Khác với `up`: `start` chỉ khởi động lại container đã tồn tại, **không tạo mới, không chạy lại `schema.sql`** (vì volume đã có dữ liệu) — dùng lệnh này cho công việc hàng ngày.

### 2.2 Tắt container khi xong việc (giữ nguyên dữ liệu)
```bash
docker compose stop
```

### 2.3 Vào thẳng psql trong container để chạy SQL nhanh (không cần mở DBeaver)
```bash
docker exec -it done_team_db psql -U postgres -d done_team_db
```
Sau khi vào, gõ SQL bình thường, VD: `SELECT * FROM admin_units_new LIMIT 5;` → gõ `\q` để thoát.

### 2.4 Chạy 1 file SQL bất kỳ vào database (VD: khi sửa schema, thêm bảng mới)
```bash
docker exec -i done_team_db psql -U postgres -d done_team_db < schema.sql
```
> Dùng khi bạn **sửa `schema.sql`** sau này (VD thêm cột) và muốn áp dụng lại mà không phải xóa container.

### 2.5 Nạp dữ liệu thật (168 đơn vị hành chính) từ file `.sql` hoặc `.csv`
Nếu có file `seed_data.sql`:
```bash
docker exec -i done_team_db psql -U postgres -d done_team_db < seed_data.sql
```
Nếu có file CSV (VD `admin_units_old.csv`), copy vào container trước rồi dùng lệnh `\copy` của psql:
```bash
docker cp admin_units_old.csv done_team_db:/tmp/admin_units_old.csv
docker exec -it done_team_db psql -U postgres -d done_team_db -c "\copy admin_units_old(name, unit_type, parent_name, province_old) FROM '/tmp/admin_units_old.csv' WITH CSV HEADER"
```

### 2.6 Truy cập Adminer (giao diện web quản lý DB, không cần cài app)
Mở trình duyệt: `http://localhost:8080` → chọn hệ quản trị **PostgreSQL** → Server: `db` (tên service trong docker-compose, không phải `localhost`) → nhập user/pass → Login.

---

## 3. SAO LƯU & PHỤC HỒI (làm định kỳ, đặc biệt trước khi nạp dữ liệu hàng loạt)

### 3.1 Backup toàn bộ database ra file
```bash
docker exec done_team_db pg_dump -U postgres -Fc done_team_db > backup_$(date +%Y%m%d_%H%M).dump
```
> `-Fc`: định dạng custom của PostgreSQL, nén sẵn, phục hồi linh hoạt hơn file `.sql` thô.

### 3.2 Phục hồi từ file backup (khi lỡ nạp sai dữ liệu)
```bash
docker exec -i done_team_db pg_restore -U postgres -d done_team_db --clean --if-exists < backup_20260901_1400.dump
```
> `--clean --if-exists`: tự xóa object cũ trước khi phục hồi, tránh lỗi trùng.

### 3.3 Export riêng 1 bảng ra CSV (để đính kèm báo cáo)
```bash
docker exec -it done_team_db psql -U postgres -d done_team_db -c "\copy admin_units_new TO '/tmp/admin_units_new.csv' WITH CSV HEADER"
docker cp done_team_db:/tmp/admin_units_new.csv ./admin_units_new.csv
```

---

## 4. GIAI ĐOẠN TÍCH HỢP & KIỂM THỬ (Tuần 11–14)

### 4.1 Khởi động lại sạch để test "cài đặt từ đầu" (mô phỏng máy giám khảo/thầy chạy thử)
```bash
docker compose down -v      # xóa container VÀ xóa volume (mất hết dữ liệu)
docker compose up -d        # tạo lại từ đầu, schema.sql tự chạy lại
```
> Lệnh này **cực kỳ quan trọng** trước khi nộp bài — dùng để xác nhận: nếu ai đó (thầy/giám khảo) chỉ có 2 file `docker-compose.yml` + `schema.sql` rồi chạy `docker compose up -d`, hệ thống có dựng đúng từ con số 0 không.

### 4.2 Xem dung lượng dữ liệu đang chiếm bao nhiêu
```bash
docker system df -v
```

---

## 5. GIAI ĐOẠN CUỐI — DỌN DẸP TRƯỚC KHI NỘP BÀI

### 5.1 Dừng container nhưng vẫn giữ dữ liệu (an toàn nhất)
```bash
docker compose stop
```

### 5.2 Xóa container nhưng GIỮ dữ liệu (volume vẫn còn, lần sau `up` lại có data ngay)
```bash
docker compose down
```

### 5.3 Xóa sạch hoàn toàn (container + volume + dữ liệu) — CHỈ dùng khi chắc chắn không cần nữa
```bash
docker compose down -v
```

### 5.4 Dọn rác Docker trên máy (image/container không dùng nữa, giải phóng ổ cứng)
```bash
docker system prune -a
```
> Cẩn thận: lệnh này xóa TẤT CẢ image/container không đang chạy trên máy, kể cả của dự án khác — chỉ chạy khi chắc chắn.

---

## 6. BẢNG TRA CỨU NHANH (dán lên đây để khỏi phải nhớ)

| Muốn làm gì | Lệnh |
|---|---|
| Chạy lần đầu | `docker compose up -d` |
| Bật lại (đã có sẵn) | `docker compose start` |
| Tắt (giữ data) | `docker compose stop` |
| Xóa container (giữ data) | `docker compose down` |
| Xóa sạch cả data | `docker compose down -v` |
| Xem trạng thái | `docker compose ps` |
| Xem log | `docker compose logs -f db` |
| Vào psql trong container | `docker exec -it done_team_db psql -U postgres -d done_team_db` |
| Chạy file SQL | `docker exec -i done_team_db psql -U postgres -d done_team_db < ten_file.sql` |
| Backup | `docker exec done_team_db pg_dump -U postgres -Fc done_team_db > backup.dump` |
| Restore | `docker exec -i done_team_db pg_restore -U postgres -d done_team_db --clean --if-exists < backup.dump` |
| Mở Adminer | trình duyệt → `http://localhost:8080` |

---

## 7. LỖI THƯỜNG GẶP

| Lỗi | Nguyên nhân & cách sửa |
|---|---|
| `port is already allocated` khi `docker compose up` | Cổng 5432 đã bị chiếm (có thể do đã cài PostgreSQL sẵn trên máy) → đổi `POSTGRES_PORT` trong `.env` sang cổng khác, VD `5433` |
| Sửa `schema.sql` nhưng chạy `up` không thấy thay đổi | `docker-entrypoint-initdb.d` **chỉ chạy khi volume rỗng** (lần đầu) — phải `docker compose down -v` rồi `up -d` lại, hoặc dùng lệnh mục 2.4 để áp dụng thủ công |
| Container `db` cứ restart liên tục | Xem log bằng `docker compose logs db` — thường do sai cú pháp trong `schema.sql` hoặc thiếu extension `vector` chưa được image hỗ trợ (đảm bảo dùng đúng image `pgvector/pgvector:pg16`) |
| DBeaver không kết nối được dù container đang chạy | Kiểm tra `docker compose ps` xem đúng cổng đang map (`5432:5432` hay đã đổi), và đảm bảo Docker Desktop đang "running" |
