# Quy tắc làm việc nhóm

## Nhánh (branch)

- `main`: code ổn định, chỉ merge qua Pull Request
- `develop`: nhánh tích hợp chung
- `feature/backend-xxx`, `feature/frontend-xxx`: nhánh làm việc cá nhân

## Commit message (theo Conventional Commits)

- `feat: thêm endpoint /qa/ask`
- `fix: sửa lỗi format response admin-units`
- `docs: cập nhật API_DOC.md`
- `chore: cấu hình eslint`

## Pull Request

- Mỗi PR cần được người còn lại review trước khi merge vào `develop`
- Mô tả rõ: đã làm gì, có ảnh hưởng đến API contract không

## Thay đổi API contract

Mọi thay đổi trong docs/API_DOC.md phải báo trong nhóm chat TRƯỚC khi code.

---

## Quy ước commit

Để lịch sử commit rõ ràng và thống nhất, nhóm sử dụng chuẩn **Conventional Commits**.

### Cú pháp

```text
<type>: <mô tả ngắn gọn>
```

Ví dụ:

```text
feat: thêm API tra cứu địa giới
fix: sửa lỗi kết nối PostgreSQL
docs: cập nhật README
style: định dạng lại mã nguồn
refactor: tách logic xử lý tìm kiếm
test: thêm test cho API tra cứu
chore: cập nhật package và cấu hình
```

### Ý nghĩa các loại commit

| Type     | Ý nghĩa                                           |
| -------- | ------------------------------------------------- |
| feat     | Thêm tính năng mới                                |
| fix      | Sửa lỗi                                           |
| docs     | Thêm hoặc cập nhật tài liệu                       |
| style    | Chỉ thay đổi định dạng code (không đổi logic)     |
| refactor | Cải thiện cấu trúc code, không thêm tính năng     |
| test     | Thêm hoặc chỉnh sửa test                          |
| chore    | Công việc bảo trì (cập nhật package, cấu hình...) |

### Quy định

- Mỗi commit chỉ nên chứa **một nhóm thay đổi liên quan**.
- Viết mô tả bằng **tiếng Việt có dấu** hoặc **tiếng Anh**, nhưng thống nhất trong toàn nhóm.
- Không commit trực tiếp vào `main`.
- Phát triển trên nhánh `develop` hoặc các nhánh `feature/*`.
- Mỗi tính năng nên tạo một branch riêng.
  > **Lưu ý:** Sau khi hoàn thành, tạo Pull Request để merge vào `develop`. Chỉ merge từ `develop` sang `main` sau khi đã kiểm thử và xác nhận hoạt động ổn định.
