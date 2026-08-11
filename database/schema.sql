-- ============================================================================
-- SCHEMA DATABASE HOÀN CHỈNH (v2 — gộp thành 1 file duy nhất)
-- Hệ thống hỏi đáp tự động về địa giới hành chính TP.HCM - Done Team
-- PostgreSQL 15+ với extension pgvector
-- ============================================================================
-- Cách chạy:
--   psql -U postgres -d done_team_db -f schema.sql
-- File này idempotent (chạy lại nhiều lần không lỗi) nhờ IF NOT EXISTS.
-- KHÔNG chứa dữ liệu mẫu — dữ liệu thật nạp riêng từ file Excel qua
-- script import_excel_to_db.js SAU khi chạy file này.
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
-- DROP TABLE IF EXISTS province_mapping CASCADE;
-- DROP TABLE IF EXISTS admin_units_new CASCADE;
-- DROP TABLE IF EXISTS admin_units_old CASCADE;
-- DROP TABLE IF EXISTS provinces_new CASCADE;
-- DROP TABLE IF EXISTS provinces_old CASCADE;
-- DROP TABLE IF EXISTS legal_documents CASCADE;

-- ============================================================================
-- 1. BẢNG legal_documents — văn bản pháp lý gốc (tạo trước, các bảng khác tham chiếu tới)
-- ============================================================================
CREATE TABLE IF NOT EXISTS legal_documents (
  id             SERIAL PRIMARY KEY,
  doc_code       VARCHAR(50)  UNIQUE NOT NULL,          -- VD: 'doc_0042', hoặc dùng số quyết định VD '1685/NQ-UBTVQH15'
  title          VARCHAR(300) NOT NULL,                  -- VD: "Nghị quyết 1685/NQ-UBTVQH15"
  issuing_body   VARCHAR(150),                            -- VD: "Ủy ban Thường vụ Quốc hội"
  issue_date     DATE,
  source_url     TEXT NOT NULL,                           -- link vbpl.vn / chinhphu.vn
  full_text      TEXT,                                    -- toàn văn, dùng để chunk cho RAG
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE legal_documents IS 'Văn bản pháp lý gốc (nghị quyết, quyết định) làm căn cứ và nguồn trích dẫn';

-- ============================================================================
-- 2. BẢNG CẤP TỈNH — provinces_old / provinces_new / province_mapping
-- ============================================================================
CREATE TABLE IF NOT EXISTS provinces_old (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,   -- 'TP. Hồ Chí Minh', 'Tỉnh Bình Dương', 'Tỉnh Bà Rịa - Vũng Tàu'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE provinces_old IS 'Tỉnh/thành trước sáp nhập cấp tỉnh';

CREATE TABLE IF NOT EXISTS provinces_new (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(100) NOT NULL UNIQUE,   -- 'TP. Hồ Chí Minh'
  effective_date  DATE NOT NULL DEFAULT '2025-07-01',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE provinces_new IS 'Tỉnh/thành sau sáp nhập cấp tỉnh';

CREATE TABLE IF NOT EXISTS province_mapping (
  id                    SERIAL PRIMARY KEY,
  old_province_id       INTEGER NOT NULL REFERENCES provinces_old(id) ON DELETE CASCADE,
  new_province_id       INTEGER NOT NULL REFERENCES provinces_new(id) ON DELETE CASCADE,
  decision_document_id  INTEGER REFERENCES legal_documents(id) ON DELETE SET NULL,
  notes                 TEXT,
  UNIQUE (old_province_id, new_province_id)
);
COMMENT ON TABLE province_mapping IS 'Ánh xạ cấp tỉnh: TP.HCM cũ + Bình Dương cũ + Bà Rịa-Vũng Tàu cũ -> TP.HCM mới';

-- ============================================================================
-- 3. BẢNG admin_units_old — đơn vị hành chính TRƯỚC sắp xếp (cấp xã/phường)
--    (Đã gồm sẵn province_old_id, không cần ALTER TABLE thêm sau)
-- ============================================================================
CREATE TABLE IF NOT EXISTS admin_units_old (
  id               SERIAL PRIMARY KEY,
  name             VARCHAR(150) NOT NULL,                 -- VD: "Phường Bến Nghé"
  unit_type        VARCHAR(20)  NOT NULL
                    CHECK (unit_type IN ('phuong', 'xa', 'thi_tran', 'huyen')),
                    -- 'huyen' chỉ dùng cho case đặc biệt: huyện Côn Đảo -> đặc khu thẳng, không qua cấp xã
  parent_name      VARCHAR(150),                           -- VD: "Quận 1" (tên quận/huyện cũ, dạng text tự do)
  province_old     VARCHAR(100) NOT NULL
                    CHECK (province_old IN ('TP.HCM (cũ)', 'Bình Dương (cũ)', 'Bà Rịa - Vũng Tàu (cũ)')),
  province_old_id  INTEGER REFERENCES provinces_old(id),   -- khóa ngoại chuẩn, dùng để JOIN
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (name, parent_name, province_old)
);
COMMENT ON TABLE admin_units_old IS 'Đơn vị hành chính cấp xã/phường trước ngày sắp xếp 1/7/2025';

CREATE INDEX IF NOT EXISTS idx_old_name_trgm ON admin_units_old USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_old_province ON admin_units_old (province_old);
CREATE INDEX IF NOT EXISTS idx_units_old_province_id ON admin_units_old (province_old_id);

-- ============================================================================
-- 4. BẢNG admin_units_new — đơn vị hành chính SAU sắp xếp (cấp xã/phường)
--    (Đã gồm sẵn province_new_id, không cần ALTER TABLE thêm sau)
-- ============================================================================
CREATE TABLE IF NOT EXISTS admin_units_new (
  id                    SERIAL PRIMARY KEY,
  code                  VARCHAR(20)  UNIQUE NOT NULL,      -- mã ngắn dùng trong API, VD: 'u0007'
  name                  VARCHAR(150) NOT NULL,              -- VD: "Phường Sài Gòn"
  unit_type             VARCHAR(20)  NOT NULL
                         CHECK (unit_type IN ('phuong', 'xa', 'dac_khu')),
  headquarters_address  TEXT,
  effective_date        DATE NOT NULL DEFAULT '2025-07-01',
  province_new_id       INTEGER REFERENCES provinces_new(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE admin_units_new IS 'Đơn vị hành chính cấp xã/phường sau sắp xếp, hiệu lực từ 1/7/2025 (168 đơn vị)';

CREATE INDEX IF NOT EXISTS idx_new_name_trgm ON admin_units_new USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_units_new_province_id ON admin_units_new (province_new_id);

-- ============================================================================
-- 5. BẢNG unit_mapping — bảng ánh xạ cũ–mới cấp xã/phường (LÕI cho tra cứu trực tiếp)
--    (Đã gồm sẵn merge_type, không cần ALTER TABLE thêm sau)
-- ============================================================================
CREATE TABLE IF NOT EXISTS unit_mapping (
  id                    SERIAL PRIMARY KEY,
  old_unit_id           INTEGER NOT NULL REFERENCES admin_units_old(id) ON DELETE CASCADE,
  new_unit_id           INTEGER NOT NULL REFERENCES admin_units_new(id) ON DELETE CASCADE,
  decision_document_id  INTEGER REFERENCES legal_documents(id) ON DELETE SET NULL,
  merge_type            VARCHAR(10) NOT NULL DEFAULT 'toan_bo'
                         CHECK (merge_type IN ('toan_bo', 'mot_phan')),
  notes                 TEXT,
  UNIQUE (old_unit_id, new_unit_id)
);
COMMENT ON TABLE unit_mapping IS 'Bảng ánh xạ nhiều-nhiều: 1 đơn vị mới có thể gộp từ nhiều đơn vị cũ';

CREATE INDEX IF NOT EXISTS idx_mapping_old ON unit_mapping (old_unit_id);
CREATE INDEX IF NOT EXISTS idx_mapping_new ON unit_mapping (new_unit_id);
CREATE INDEX IF NOT EXISTS idx_mapping_merge_type ON unit_mapping (merge_type);

-- ============================================================================
-- 6. BẢNG document_chunks — dữ liệu vector cho RAG (semantic search)
-- ============================================================================
CREATE TABLE IF NOT EXISTS document_chunks (
  id            SERIAL PRIMARY KEY,
  document_id   INTEGER NOT NULL REFERENCES legal_documents(id) ON DELETE CASCADE,
  chunk_index   INTEGER NOT NULL,
  content       TEXT NOT NULL,
  embedding     vector(1536),                              -- đổi số chiều theo mô hình embedding thực tế nhóm chọn
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (document_id, chunk_index)
);
COMMENT ON TABLE document_chunks IS 'Các đoạn văn bản pháp lý đã chunk + embedding, dùng cho semantic search RAG';

-- Index HNSW cho truy vấn cosine similarity — nên tạo SAU khi đã nạp dữ liệu số lượng lớn
CREATE INDEX IF NOT EXISTS idx_chunks_embedding
  ON document_chunks USING hnsw (embedding vector_cosine_ops);

-- ============================================================================
-- 7. BẢNG qa_logs — lịch sử hỏi đáp (phục vụ đánh giá độ chính xác & feedback)
-- ============================================================================
CREATE TABLE IF NOT EXISTS qa_logs (
  id                SERIAL PRIMARY KEY,
  session_id        VARCHAR(50),
  question          TEXT NOT NULL,
  answer            TEXT,
  answer_type       VARCHAR(20)
                     CHECK (answer_type IN ('structured_lookup', 'rag_generated', 'no_answer')),
  confidence        NUMERIC(4,3) CHECK (confidence >= 0 AND confidence <= 1),
  is_helpful        BOOLEAN,
  response_time_ms  INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE qa_logs IS 'Lịch sử mọi câu hỏi/trả lời của hệ thống - dùng để tính độ chính xác trong báo cáo';

CREATE INDEX IF NOT EXISTS idx_qa_logs_created_at ON qa_logs (created_at);
CREATE INDEX IF NOT EXISTS idx_qa_logs_answer_type ON qa_logs (answer_type);

-- ============================================================================
-- 8. MIGRATION v1.1 — bổ sung embedding_model, đổi chiều vector cho 3 embedding
-- ============================================================================
ALTER TABLE document_chunks DROP COLUMN IF EXISTS embedding;
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS embedding_model VARCHAR(50);
ALTER TABLE document_chunks ADD COLUMN embedding vector(1024);

DROP INDEX IF EXISTS idx_chunks_embedding;
CREATE INDEX idx_chunks_embedding ON document_chunks
  USING hnsw (embedding vector_cosine_ops);
  
ALTER TABLE qa_logs ADD COLUMN IF NOT EXISTS model_used VARCHAR(20)
  CHECK (model_used IN ('rule_based', 'naive_rag', 'modular_rag'));
ALTER TABLE qa_logs ADD COLUMN IF NOT EXISTS feedback_note TEXT;
ALTER TABLE qa_logs ADD COLUMN IF NOT EXISTS llm_provider VARCHAR(20);

ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;

CREATE INDEX IF NOT EXISTS idx_chunks_content_tsv ON document_chunks USING gin (content_tsv);

ALTER TABLE qa_logs ADD COLUMN IF NOT EXISTS routing_decision VARCHAR(20);
-- ============================================================================
-- HẾT FILE — kiểm tra nhanh sau khi chạy:
--   SELECT table_name FROM information_schema.tables WHERE table_schema = 'public';
--   (phải thấy đủ 8 bảng: legal_documents, provinces_old, provinces_new,
--    province_mapping, admin_units_old, admin_units_new, unit_mapping,
--    document_chunks, qa_logs)
-- ============================================================================
