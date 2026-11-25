-- Migration an toan cho database dang co du lieu.
-- Them khoa tinh moi vao document_chunks de loc RAG theo tab tinh.

BEGIN;

ALTER TABLE document_chunks
  ADD COLUMN IF NOT EXISTS province_new_id INTEGER
  REFERENCES provinces_new(id);

CREATE INDEX IF NOT EXISTS idx_chunks_province_new_id
  ON document_chunks (province_new_id);

COMMIT;

-- Kiem tra sau khi chay:
-- SELECT column_name
-- FROM information_schema.columns
-- WHERE table_schema = 'public'
--   AND table_name = 'document_chunks'
--   AND column_name = 'province_new_id';
--
-- SELECT indexname
-- FROM pg_indexes
-- WHERE schemaname = 'public'
--   AND tablename = 'document_chunks'
--   AND indexname = 'idx_chunks_province_new_id';
