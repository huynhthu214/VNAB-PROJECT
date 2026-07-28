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
