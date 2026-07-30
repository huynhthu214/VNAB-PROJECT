-- ============================================================================
-- BỔ SUNG CẤP TỈNH — chạy SAU khi đã chạy schema.sql gốc
-- Gộp mô hình: tinh_cu/tinh_moi (Phần 1) + admin_units_old/new (Phần 2)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. provinces_old — tỉnh/thành TRƯỚC sáp nhập (tương ứng "tinh_cu")
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provinces_old (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(100) NOT NULL UNIQUE,   -- 'TP. Hồ Chí Minh', 'Tỉnh Bình Dương', 'Tỉnh Bà Rịa - Vũng Tàu'
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE provinces_old IS 'Tỉnh/thành trước sáp nhập cấp tỉnh (tương đương tinh_cu)';

-- ----------------------------------------------------------------------------
-- 2. provinces_new — tỉnh/thành SAU sáp nhập (tương ứng "tinh_moi")
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS provinces_new (
  id              SERIAL PRIMARY KEY,
  name            VARCHAR(100) NOT NULL UNIQUE,   -- 'TP. Hồ Chí Minh'
  effective_date  DATE NOT NULL DEFAULT '2025-07-01',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE provinces_new IS 'Tỉnh/thành sau sáp nhập cấp tỉnh (tương đương tinh_moi)';

-- ----------------------------------------------------------------------------
-- 3. province_mapping — ánh xạ nhiều-một: 3 tỉnh cũ -> 1 tỉnh mới
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS province_mapping (
  id                    SERIAL PRIMARY KEY,
  old_province_id       INTEGER NOT NULL REFERENCES provinces_old(id) ON DELETE CASCADE,
  new_province_id       INTEGER NOT NULL REFERENCES provinces_new(id) ON DELETE CASCADE,
  decision_document_id  INTEGER REFERENCES legal_documents(id) ON DELETE SET NULL,
  notes                 TEXT,
  UNIQUE (old_province_id, new_province_id)
);
COMMENT ON TABLE province_mapping IS 'Ánh xạ cấp tỉnh: TP.HCM cũ + Bình Dương cũ + Bà Rịa-Vũng Tàu cũ -> TP.HCM mới';

-- ----------------------------------------------------------------------------
-- 4. Chuẩn hóa admin_units_old: đổi cột "province_old" (text tự do) -> khóa ngoại
-- ----------------------------------------------------------------------------
-- Thêm cột khóa ngoại mới
ALTER TABLE admin_units_old
  ADD COLUMN IF NOT EXISTS province_old_id INTEGER REFERENCES provinces_old(id);

-- Thêm cột liên kết tỉnh mới cho admin_units_new (mỗi phường/xã mới thuộc 1 tỉnh mới)
ALTER TABLE admin_units_new
  ADD COLUMN IF NOT EXISTS province_new_id INTEGER REFERENCES provinces_new(id);

CREATE INDEX IF NOT EXISTS idx_units_old_province ON admin_units_old (province_old_id);
CREATE INDEX IF NOT EXISTS idx_units_new_province ON admin_units_new (province_new_id);

-- Lưu ý: sau khi nạp dữ liệu vào provinces_old/provinces_new, chạy UPDATE để gán
-- province_old_id / province_new_id cho từng dòng trong admin_units_old/new, rồi mới
-- cân nhắc bỏ cột "province_old" (VARCHAR) cũ nếu không còn dùng đến, tránh trùng lặp dữ liệu.

-- ----------------------------------------------------------------------------
-- 5. Dữ liệu mẫu cấp tỉnh (để test, KHÔNG dùng làm dữ liệu chính thức)
-- ----------------------------------------------------------------------------
INSERT INTO provinces_old (name) VALUES
  ('TP. Hồ Chí Minh'),
  ('Tỉnh Bình Dương'),
  ('Tỉnh Bà Rịa - Vũng Tàu')
ON CONFLICT (name) DO NOTHING;

INSERT INTO provinces_new (name) VALUES ('TP. Hồ Chí Minh')
ON CONFLICT (name) DO NOTHING;

INSERT INTO province_mapping (old_province_id, new_province_id, decision_document_id)
SELECT o.id, n.id, (SELECT id FROM legal_documents WHERE doc_code = 'doc_0001')
FROM provinces_old o, provinces_new n
WHERE n.name = 'TP. Hồ Chí Minh'
ON CONFLICT DO NOTHING;

-- ============================================================================
-- TRUY VẤN MẪU: tra cứu tỉnh cũ -> tỉnh mới
-- ============================================================================
-- SELECT po.name AS tinh_cu, pn.name AS tinh_moi, ld.title AS quyet_dinh
-- FROM province_mapping pm
-- JOIN provinces_old po ON po.id = pm.old_province_id
-- JOIN provinces_new pn ON pn.id = pm.new_province_id
-- LEFT JOIN legal_documents ld ON ld.id = pm.decision_document_id;
