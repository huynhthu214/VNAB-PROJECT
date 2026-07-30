# Hệ thống hỏi đáp tự động về địa giới hành chính mới ở khu vực miền Nam Việt Nam

## Giới thiệu

Ứng dụng RAG giúp tra cứu đơn vị hành chính TP.HCM sau sắp xếp (168 xã/phường/đặc khu),
kèm trích dẫn nguồn văn bản pháp lý.

## Nhóm thực hiện — Done Team

- Huỳnh Minh Thư(52300068) — Backend & Dữ liệu/RAG
- Phan Thúy Vi(52300084) — Frontend & Testing

## Công nghệ sử dụng

Backend: Node.js, Express, PostgreSQL + pgvector
Frontend: React (Vite)

## Cách chạy dự án

1. `cd database && docker compose up -d` (khởi động PostgreSQL + Adminer)
2. `cd ../backend && npm install && npm run dev`
3. `cd ../frontend && npm install && npm run dev`

## Tài liệu liên quan

- [Kế hoạch dự án](docs/KE_HOACH.md)
- [API Documentation](docs/API_DOC.md)
- [Thiết kế Database](docs/DATABASE.md)
