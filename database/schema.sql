-- ============================================================================
-- SCHEMA DATABASE HOÀN CHỈNH
-- Hệ thống hỏi đáp tự động về địa giới hành chính TP.HCM - Done Team
-- PostgreSQL 15+ với extension pgvector
-- ============================================================================
-- Cách chạy:
--   psql -U postgres -d done_team_db -f schema.sql
-- hoặc dùng SQLTools/DBeaver/pgAdmin để chạy toàn bộ file này 1 lần.
-- File này idempotent (chạy lại nhiều lần không lỗi) nhờ IF NOT EXISTS / DROP trước khi tạo.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0. EXTENSIONS
-- ----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS vector;     -- pgvector: lưu & truy vấn embedding cho RAG
CREATE EXTENSION IF NOT EXISTS pg_trgm;    -- fuzzy search cho tên đơn vị hành chính

-- ----------------------------------------------------------------------------
-- 0.1 (TÙY CHỌN) RESET SCHEMA — bỏ comment nếu muốn xóa sạch làm lại từ đầu
-- ----------------------------------------------------------------------------
-- DROP TABLE IF EXISTS qa_logs CASCADE;
-- DROP TABLE IF EXISTS document_chunks CASCADE;
-- DROP TABLE IF EXISTS unit_mapping CASCADE;
-- DROP TABLE IF EXISTS legal_documents CASCADE;
-- DROP TABLE IF EXISTS admin_units_new CASCADE;
-- DROP TABLE IF EXISTS admin_units_old CASCADE;

-- ============================================================================
-- 1. BẢNG legal_documents — văn bản pháp lý gốc (tạo trước vì các bảng khác tham chiếu tới)
-- ============================================================================
CREATE TABLE IF NOT EXISTS legal_documents (
  id             SERIAL PRIMARY KEY,
  doc_code       VARCHAR(50)  UNIQUE NOT NULL,          -- VD: 'doc_0042'
  title          VARCHAR(300) NOT NULL,                  -- VD: "Nghị quyết 1685/NQ-UBTVQH15"
  issuing_body   VARCHAR(150),                            -- VD: "Ủy ban Thường vụ Quốc hội"
  issue_date     DATE,
  source_url     TEXT NOT NULL,                           -- link vbpl.vn / chinhphu.vn
  full_text      TEXT,                                    -- toàn văn, dùng để chunk cho RAG
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE legal_documents IS 'Văn bản pháp lý gốc (nghị quyết, quyết định) làm căn cứ và nguồn trích dẫn';

-- ============================================================================
-- 2. BẢNG admin_units_old — đơn vị hành chính TRƯỚC sắp xếp
-- ============================================================================
CREATE TABLE IF NOT EXISTS admin_units_old (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(150) NOT NULL,                    -- VD: "Phường Bến Nghé"
  unit_type     VARCHAR(20)  NOT NULL
                 CHECK (unit_type IN ('phuong', 'xa', 'thi_tran')),
  parent_name   VARCHAR(150),                              -- VD: "Quận 1"
  province_old  VARCHAR(100) NOT NULL
                 CHECK (province_old IN ('TP.HCM (cũ)', 'Bình Dương (cũ)', 'Bà Rịa - Vũng Tàu (cũ)')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE admin_units_old IS 'Đơn vị hành chính cấp xã/phường trước ngày sắp xếp 1/7/2025';

CREATE INDEX IF NOT EXISTS idx_old_name_trgm
  ON admin_units_old USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_old_province
  ON admin_units_old (province_old);

-- ============================================================================
-- 3. BẢNG admin_units_new — đơn vị hành chính SAU sắp xếp
-- ============================================================================
CREATE TABLE IF NOT EXISTS admin_units_new (
  id                    SERIAL PRIMARY KEY,
  code                  VARCHAR(20)  UNIQUE NOT NULL,      -- mã dùng trong API, VD: 'unit_0007'
  name                  VARCHAR(150) NOT NULL,              -- VD: "Phường Sài Gòn"
  unit_type             VARCHAR(20)  NOT NULL
                         CHECK (unit_type IN ('phuong', 'xa', 'dac_khu')),
  headquarters_address  TEXT,
  effective_date        DATE NOT NULL DEFAULT '2025-07-01',
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE admin_units_new IS 'Đơn vị hành chính cấp xã/phường sau sắp xếp, hiệu lực từ 1/7/2025 (168 đơn vị)';

CREATE INDEX IF NOT EXISTS idx_new_name_trgm
  ON admin_units_new USING gin (name gin_trgm_ops);

-- ============================================================================
-- 4. BẢNG unit_mapping — bảng ánh xạ cũ–mới (LÕI cho tra cứu trực tiếp)
-- ============================================================================
CREATE TABLE IF NOT EXISTS unit_mapping (
  id                    SERIAL PRIMARY KEY,
  old_unit_id           INTEGER NOT NULL REFERENCES admin_units_old(id) ON DELETE CASCADE,
  new_unit_id           INTEGER NOT NULL REFERENCES admin_units_new(id) ON DELETE CASCADE,
  decision_document_id  INTEGER REFERENCES legal_documents(id) ON DELETE SET NULL,
  notes                 TEXT,
  UNIQUE (old_unit_id, new_unit_id)
);
COMMENT ON TABLE unit_mapping IS 'Bảng ánh xạ nhiều-nhiều: 1 đơn vị mới có thể gộp từ nhiều đơn vị cũ';

CREATE INDEX IF NOT EXISTS idx_mapping_old ON unit_mapping (old_unit_id);
CREATE INDEX IF NOT EXISTS idx_mapping_new ON unit_mapping (new_unit_id);

-- ============================================================================
-- 5. BẢNG document_chunks — dữ liệu vector cho RAG (semantic search)
-- ============================================================================
CREATE TABLE IF NOT EXISTS document_chunks (
  id            SERIAL PRIMARY KEY,
  document_id   INTEGER NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,                          -- thứ tự đoạn trong văn bản
  content       TEXT NOT NULL,                              -- nội dung đoạn (~200-400 từ)
  embedding     vector(1536),                                -- đổi số chiều theo mô hình embedding thực tế nhóm chọn
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);
COMMENT ON TABLE document_chunks IS 'Các đoạn văn bản pháp lý đã chunk + embedding, dùng cho semantic search RAG';

-- Index HNSW cho truy vấn cosine similarity nhanh — nên tạo SAU khi đã nạp dữ liệu số lượng lớn
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON document_chunks USING hnsw (embedding vector_cosine_ops);

-- ============================================================================
-- 6. BẢNG qa_logs — lịch sử hỏi đáp (phục vụ đánh giá độ chính xác & feedback)
-- ============================================================================
CREATE TABLE IF NOT EXISTS qa_logs (
  id                SERIAL PRIMARY KEY,
  session_id        VARCHAR(50),
  question          TEXT NOT NULL,
  answer            TEXT,
  answer_type       VARCHAR(20)
                     CHECK (answer_type IN ('structured_lookup', 'rag_generated', 'no_answer')),
  confidence        NUMERIC(4,3) CHECK (confidence >= 0 AND confidence <= 1),
  is_helpful        BOOLEAN,                                -- người dùng đánh giá (nullable)
  response_time_ms  INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE qa_logs IS 'Lịch sử mọi câu hỏi/trả lời của hệ thống - dùng để tính độ chính xác trong báo cáo';

CREATE INDEX IF NOT EXISTS idx_qa_logs_created_at ON qa_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_qa_logs_answer_type ON qa_logs (answer_type);

-- ============================================================================
-- 7. (TÙY CHỌN) DỮ LIỆU MẪU — để test nhanh sau khi tạo schema
-- ============================================================================
INSERT INTO legal_documents (doc_code, title, issuing_body, issue_date, source_url)
VALUES ('doc_0001', 'Nghị quyết 1685/NQ-UBTVQH15', 'Ủy ban Thường vụ Quốc hội', '2025-06-16',
        'https://vbpl.vn/thanhphohochiminh/')
ON CONFLICT (doc_code) DO NOTHING;

INSERT INTO admin_units_old (name, unit_type, parent_name, province_old)
VALUES ('Phường Bến Nghé', 'phuong', 'Quận 1', 'TP.HCM (cũ)')
ON CONFLICT DO NOTHING;

INSERT INTO admin_units_new (code, name, unit_type, headquarters_address)
VALUES ('unit_0001', 'Phường Sài Gòn', 'phuong', '86 Lê Thánh Tôn, Quận 1 cũ')
ON CONFLICT (code) DO NOTHING;

-- Lưu ý: 3 lệnh INSERT trên chỉ là dữ liệu MẪU để kiểm tra schema chạy đúng.
-- Dữ liệu thật (168 đơn vị) phải nạp từ Phụ lục Nghị quyết 1685/NQ-UBTVQH15
-- theo checklist ở mục 4.3 của THIET_KE_DATABASE.md — KHÔNG dùng số liệu mẫu này làm dữ liệu chính thức.

-- ============================================================================
-- HẾT FILE — kiểm tra nhanh sau khi chạy:
--   SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
--   (phải thấy đủ 6 bảng: admin_units_old, admin_units_new, unit_mapping,
--    legal_documents, document_chunks, qa_logs)
-- ============================================================================
