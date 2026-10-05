# HƯỚNG DẪN THIẾT KẾ & SỬ DỤNG CƠ SỞ DỮ LIỆU

## PostgreSQL + pgvector — Hệ thống hỏi đáp địa giới hành chính TP.HCM

---

## 1. Sơ đồ tổng quan (ERD mô tả bằng chữ)

```
admin_units_old  ──┐
                    ├──< unit_mapping >──┐
admin_units_new  ──┘                     │
                                          │
legal_documents  ──< document_chunks     │
      │                    (có cột vector)
      │
      └── unit_mapping.decision_document_id (khóa ngoại tới legal_documents)

qa_logs  (ghi lại lịch sử hỏi đáp — phục vụ đánh giá độ chính xác)
```

**Nguyên tắc thiết kế:** tách rõ 2 nhóm bảng —

- Nhóm **dữ liệu có cấu trúc** (structured): `admin_units_old`, `admin_units_new`, `unit_mapping`, `legal_documents` → dùng cho tra cứu trực tiếp, chính xác 100%, không phụ thuộc LLM.
- Nhóm **dữ liệu vector** (unstructured): `document_chunks` → dùng cho semantic search khi câu hỏi không tra cứu trực tiếp được.

Cả 2 nhóm nằm **chung trong 1 database PostgreSQL** (đã phân tích lý do ở phần trước) để có thể `JOIN` trực tiếp.

---

## 2. Schema chi tiết (SQL PostgreSQL)

### 2.1 Bật extension pgvector

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm; -- hỗ trợ tìm kiếm gần đúng (fuzzy search) cho tên đơn vị
```

### 2.2 Bảng `admin_units_old` — đơn vị hành chính TRƯỚC sắp xếp

```sql
CREATE TABLE admin_units_old (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(150) NOT NULL,          -- VD: "Phường Bến Nghé"
  unit_type     VARCHAR(20)  NOT NULL,           -- 'phuong' | 'xa' | 'thi_tran'
  parent_name   VARCHAR(150),                    -- VD: "Quận 1"
  province_old  VARCHAR(100) NOT NULL,           -- 'TP.HCM (cũ)' | 'Bình Dương (cũ)' | 'Bà Rịa - Vũng Tàu (cũ)'
  created_at    TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_old_name_trgm ON admin_units_old USING gin (name gin_trgm_ops);
```

### 2.3 Bảng `admin_units_new` — đơn vị hành chính SAU sắp xếp

```sql
CREATE TABLE admin_units_new (
  id                    SERIAL PRIMARY KEY,
  code                  VARCHAR(20) UNIQUE NOT NULL,   -- mã dùng trong API, VD: 'unit_0007'
  name                  VARCHAR(150) NOT NULL,          -- VD: "Phường Sài Gòn"
  unit_type             VARCHAR(20)  NOT NULL,          -- 'phuong' | 'xa' | 'dac_khu'
  headquarters_address  TEXT,
  effective_date        DATE NOT NULL DEFAULT '2025-07-01',
  created_at            TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_new_name_trgm ON admin_units_new USING gin (name gin_trgm_ops);
```

### 2.4 Bảng `legal_documents` — văn bản pháp lý gốc

```sql
CREATE TABLE legal_documents (
  id             SERIAL PRIMARY KEY,
  doc_code       VARCHAR(50) UNIQUE NOT NULL,   -- 'doc_0042'
  title          VARCHAR(300) NOT NULL,          -- "Nghị quyết 1685/NQ-UBTVQH15"
  issuing_body   VARCHAR(150),                   -- "Ủy ban Thường vụ Quốc hội"
  issue_date     DATE,
  source_url     TEXT NOT NULL,                  -- link vbpl.vn / chinhphu.vn
  full_text      TEXT,                           -- toàn văn (nếu lưu được), dùng để chunk
  created_at     TIMESTAMPTZ DEFAULT now()
);
```

### 2.5 Bảng `unit_mapping` — bảng ánh xạ cũ–mới (bảng lõi cho tra cứu trực tiếp)

```sql
CREATE TABLE unit_mapping (
  id                    SERIAL PRIMARY KEY,
  old_unit_id           INTEGER NOT NULL REFERENCES admin_units_old(id),
  new_unit_id           INTEGER NOT NULL REFERENCES admin_units_new(id),
  decision_document_id  INTEGER REFERENCES legal_documents(id),
  merge_type                VARCHAR(10) NOT NULL DEFAULT 'toan_bo',  -- 'toan_bo' | 'mot_phan' (mới thêm v1.2)
  notes                 TEXT,
  UNIQUE (old_unit_id, new_unit_id),
  CONSTRAINT chk_merge_type CHECK (merge_type IN ('toan_bo', 'mot_phan'))
);
CREATE INDEX idx_mapping_old     ON unit_mapping(old_unit_id);
CREATE INDEX idx_mapping_new     ON unit_mapping(new_unit_id);
CREATE INDEX idx_mapping_merge_type  ON unit_mapping(merge_type);
```

> 1 đơn vị mới có thể gộp từ **nhiều** đơn vị cũ → quan hệ nhiều-nhiều được thể hiện qua bảng trung gian này (1 `new_unit_id` xuất hiện nhiều dòng, mỗi dòng ứng với 1 `old_unit_id`).
>
> **Cột `merge_type` (mới, bắt buộc — v1.2):** phân biệt đơn vị cũ được sáp nhập **toàn bộ** hay chỉ **một phần** diện tích/dân số vào đơn vị mới. Đây là trường hợp thực tế xảy ra khá nhiều trong Nghị quyết 1685 (VD: phường Đa Kao (cũ) bị chia — một phần vào phường Sài Gòn, một phần vào phường Tân Định). Nếu bỏ qua cột này, hệ thống hỏi-đáp sẽ trả lời sai kiểu "X (cũ) nay là Y" trong khi thực tế X bị chia làm nhiều nơi.
> Không lưu tỉ lệ % chính xác (VD "60% diện tích") vì cần dữ liệu bản đồ GIS chi tiết — nằm ngoài phạm vi đồ án theo đúng nguyên tắc "đúng thực lực sinh viên năm 4".

### 2.6 Bảng `document_chunks` — dữ liệu vector cho RAG

```sql
CREATE TABLE document_chunks (
  id            SERIAL PRIMARY KEY,
  document_id   INTEGER NOT NULL REFERENCES legal_documents(id),
  chunk_index   INTEGER NOT NULL,          -- thứ tự đoạn trong văn bản
  content       TEXT NOT NULL,              -- nội dung đoạn văn bản (~200-400 từ/chunk)
  embedding     vector(1536),               -- số chiều tùy mô hình embedding đang dùng
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- Index HNSW cho truy vấn semantic search nhanh (dùng cosine distance)
CREATE INDEX idx_chunks_embedding ON document_chunks
  USING hnsw (embedding vector_cosine_ops);
```

> Số chiều `vector(1536)` là ví dụ tương ứng một số mô hình embedding phổ biến — **phải khớp chính xác** với số chiều đầu ra của mô hình embedding nhóm bạn chọn, nếu không sẽ lỗi khi insert.

### 2.7 Bảng `qa_logs` — lịch sử hỏi đáp (phục vụ đánh giá độ chính xác & feedback)

```sql
CREATE TABLE qa_logs (
  id            SERIAL PRIMARY KEY,
  session_id    VARCHAR(50),
  question      TEXT NOT NULL,
  answer        TEXT,
  answer_type   VARCHAR(20),               -- 'structured_lookup' | 'rag_generated' | 'no_answer'
  confidence    NUMERIC(4,3),
  is_helpful    BOOLEAN,                   -- người dùng đánh giá (nullable)
  response_time_ms INTEGER,
  created_at    TIMESTAMPTZ DEFAULT now()
);
```

> Bảng này **rất quan trọng cho chương "Kiểm thử & đánh giá"** trong báo cáo — chạy 100–150 câu test rồi truy vấn thống kê trực tiếp từ bảng này để tính % chính xác, độ trễ trung bình theo từng `answer_type`.

---

## 3. Các truy vấn mẫu quan trọng

### 3.1 Tra cứu trực tiếp: tên cũ → tên mới (LƯU Ý: 1 đơn vị cũ có thể trả về NHIỀU dòng nếu bị chia)

```sql
SELECT n.code, n.name AS new_name, m.merge_type, d.title AS decision, d.source_url
FROM admin_units_old o
JOIN unit_mapping m       ON m.old_unit_id = o.id
JOIN admin_units_new n    ON n.id = m.new_unit_id
LEFT JOIN legal_documents d ON d.id = m.decision_document_id
WHERE o.name ILIKE '%Bến Nghé%';
```

> **Quan trọng khi code phía backend:** đây là truy vấn có thể trả về **nhiều hơn 1 dòng** (VD tra "Đa Kao" sẽ ra 2 dòng: phường Sài Gòn + phường Tân Định, cả hai đều `merge_type = 'mot_phan'`). Code sinh câu trả lời **bắt buộc kiểm tra `COUNT(*) > 1`** để dùng đúng mẫu câu "được chia làm X phần...", không được mặc định lấy dòng đầu tiên rồi trả lời như nhập trọn vào 1 nơi — đây là lỗi dễ gặp nhất nếu code ẩu.

### 3.2 Liệt kê tất cả đơn vị cũ đã gộp vào 1 đơn vị mới (kèm mức độ)

```sql
SELECT o.name AS old_name, o.parent_name, o.province_old, m.merge_type
FROM unit_mapping m
JOIN admin_units_old o ON o.id = m.old_unit_id
WHERE m.new_unit_id = (SELECT id FROM admin_units_new WHERE code = 'unit_0007');
```

> Dùng để sinh câu trả lời kiểu "Phường X được hình thành từ toàn bộ phường A, cộng một phần phường B và phường C" — phân loại theo `merge_type` ngay trong vòng lặp code, không gộp chung tất cả thành "được sáp nhập từ A, B, C" (nói vậy là sai với thực tế pháp lý nếu B, C chỉ góp một phần).

### 3.3 Semantic search (RAG retrieval) — top-5 đoạn liên quan nhất

```sql
SELECT c.id, c.content, d.title, d.source_url,
       1 - (c.embedding <=> $1) AS similarity   -- $1 = vector embedding của câu hỏi
FROM document_chunks c
JOIN legal_documents d ON d.id = c.document_id
ORDER BY c.embedding <=> $1
LIMIT 5;
```

> Toán tử `<=>` của pgvector tính cosine distance; giá trị càng nhỏ càng giống nhau. Nên đặt ngưỡng, VD chỉ nhận kết quả có `similarity > 0.75`, còn lại trả `NO_ANSWER_FOUND` (đúng như thiết kế trong `API_DOC.md`).

### 3.4 Fuzzy search tên đơn vị (khi người dùng gõ sai/thiếu dấu)

```sql
SELECT name, similarity(name, 'ben nghe') AS score
FROM admin_units_old
WHERE name % 'ben nghe'   -- toán tử của pg_trgm
ORDER BY score DESC
LIMIT 5;
```

---

## 4. Hướng dẫn sử dụng với Node.js

### 4.1 Kết nối & migration

- Dùng **node-postgres (`pg`)** làm driver nền tảng vì pgvector cần kiểu dữ liệu đặc thù mà một số ORM (Prisma) chưa hỗ trợ trực tiếp kiểu `vector` (phải dùng raw SQL/extension riêng).
- Khuyến nghị: **Knex.js** để quản lý migration + query builder (linh hoạt viết raw SQL khi cần vector), hoặc nếu quen Prisma thì dùng Prisma cho các bảng structured + `$queryRaw`/`$executeRaw` riêng cho phần vector.

```js
// db.js
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
module.exports = pool;
```

```js
// ví dụ insert 1 chunk kèm embedding
async function insertChunk(documentId, chunkIndex, content, embedding) {
  const vectorLiteral = `[${embedding.join(",")}]`; // pgvector nhận literal dạng '[0.1,0.2,...]'
  await pool.query(
    `INSERT INTO document_chunks (document_id, chunk_index, content, embedding)
     VALUES ($1, $2, $3, $4)`,
    [documentId, chunkIndex, content, vectorLiteral],
  );
}
```

```js
// ví dụ truy vấn semantic search
async function searchChunks(queryEmbedding, topK = 5) {
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;
  const { rows } = await pool.query(
    `SELECT c.id, c.content, d.title, d.source_url,
            1 - (c.embedding <=> $1) AS similarity
     FROM document_chunks c
     JOIN legal_documents d ON d.id = c.document_id
     ORDER BY c.embedding <=> $1
     LIMIT $2`,
    [vectorLiteral, topK],
  );
  return rows;
}
```

### 4.2 Migration files (Knex ví dụ)

```
migrations/
  20260801_create_admin_units_old.js
  20260801_create_admin_units_new.js
  20260802_create_legal_documents.js
  20260802_create_unit_mapping.js
  20260803_create_document_chunks.js
  20260803_create_qa_logs.js
seeds/
  01_seed_admin_units.js
  02_seed_documents_and_chunks.js
```

→ Chạy `npx knex migrate:latest` để dựng schema, `npx knex seed:run` để nạp dữ liệu mẫu — giúp A và B đều dựng được CSDL local giống hệt nhau chỉ bằng 2 lệnh, tránh lệch schema giữa 2 máy.

### 4.3 Checklist khi nạp dữ liệu thật

1. Nạp `legal_documents` trước (cần `id` để tham chiếu).
2. Nạp `admin_units_old`, `admin_units_new`.
3. Nạp `unit_mapping` (đối chiếu kỹ theo Phụ lục Nghị quyết 1685/NQ-UBTVQH15).
4. Chunk `full_text` của từng văn bản (khuyến nghị 200–400 từ/chunk, overlap ~50 từ để không cắt đứt ý), gọi API embedding, insert vào `document_chunks`.
5. Chạy lại `CREATE INDEX ... USING hnsw` **sau khi** đã nạp xong dữ liệu số lượng lớn (tạo index trước khi có dữ liệu vẫn được nhưng build lại sau khi insert hàng loạt sẽ tối ưu hơn).

### 4.4 Sao lưu (backup)

```bash
pg_dump -Fc done_team_db > backup_$(date +%Y%m%d).dump
```

Nên backup định kỳ trước mỗi lần nạp dữ liệu hàng loạt, để lỡ nạp sai có thể phục hồi nhanh — quan trọng khi gần deadline.

---

## 6. Bổ sung v1.3: cột phục vụ Model 3 — Advanced RAG

### 6.1 Vì sao cần các cột này

Model 3 có 2 bước kỹ thuật mới không tồn tại ở Model 1/2: **query rewriting** (LLM viết lại câu hỏi trước khi embed) và **rerank** (chấm điểm lại top-N sau vector search). Cần lưu lại cả 2 để:

- Đối chiếu thủ công xem rewriting có làm lệch ý câu hỏi gốc không (rủi ro đã nêu trong đề xuất mục 2.3)
- Tách riêng đóng góp của rerank khỏi đóng góp của rewriting khi phân tích kết quả (mục 3.3 đề xuất)

### 6.2 Cột mới trong `qa_logs`

```sql
ALTER TABLE qa_logs ADD COLUMN IF NOT EXISTS rewritten_question TEXT;
ALTER TABLE qa_logs ADD COLUMN IF NOT EXISTS rerank_top_score NUMERIC(5,4);
```

| Cột                  | Ý nghĩa                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rewritten_question` | Câu hỏi sau khi LLM viết lại — chỉ có giá trị khi `model_used = 'advanced_rag'`. Để trống (NULL) với các model khác                                                       |
| `rerank_top_score`   | Điểm rerank cao nhất trong top-N sau khi chấm lại — dùng để đối chiếu với ngưỡng similarity, và để phân tích tương quan giữa điểm rerank và độ chính xác câu trả lời cuối |

### 6.3 Mở rộng `model_used`

```sql
ALTER TABLE qa_logs DROP CONSTRAINT IF EXISTS qa_logs_model_used_check;
ALTER TABLE qa_logs ADD CONSTRAINT qa_logs_model_used_check
  CHECK (model_used IN ('rule_based', 'naive_rag', 'advanced_rag', 'modular_rag'));
```

> **Lưu ý khi chạy migration:** Postgres không cho `ALTER` trực tiếp nội dung 1 `CHECK constraint` — phải `DROP` rồi `ADD` lại như trên. Chạy migration này **trên cả 2 máy (A và B)** cùng lúc, giống nguyên tắc đã áp dụng ở migration `muc_do`/`merge_type` trước đây — tránh lệch schema.

---

## 7. Bổ sung v1.3: tích hợp Rerank model cho Model 3

### 7.1 Chọn công cụ rerank

Khuyến nghị dùng **BGE-reranker** (cùng họ với BGE-M3 embedding đang dùng — giảm rủi ro tích hợp, không phải học thêm 1 hệ sinh thái mới). Chạy qua cùng FastAPI embedding service hiện có, thêm 1 endpoint mới, ví dụ `/rerank`.

### 7.2 Luồng gọi (ví dụ Node.js)

```js
// 1. Vector search lấy top-N rộng (thay vì top-k hẹp như Model 2)
async function retrieveTopN(queryEmbedding, topN = 20) {
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;
  const { rows } = await pool.query(
    `SELECT c.id, c.content, d.title, d.source_url,
            1 - (c.embedding <=> $1) AS similarity
     FROM document_chunks c
     JOIN legal_documents d ON d.id = c.document_id
     ORDER BY c.embedding <=> $1
     LIMIT $2`,
    [vectorLiteral, topN],
  );
  return rows;
}

// 2. Gọi rerank service, lấy top-k nhỏ hơn
async function rerankChunks(question, chunks, topK = 5) {
  const res = await fetch("http://localhost:8001/rerank", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      query: question,
      documents: chunks.map((c) => c.content),
    }),
  });
  const { scores } = await res.json(); // mảng điểm rerank, cùng thứ tự với chunks
  return chunks
    .map((c, i) => ({ ...c, rerank_score: scores[i] }))
    .sort((a, b) => b.rerank_score - a.rerank_score)
    .slice(0, topK);
}
```

### 7.3 Ngưỡng chống bịa áp dụng SAU rerank, không phải trên similarity thô

```js
const topN = await retrieveTopN(queryEmbedding, 20);
const reranked = await rerankChunks(question, topN, 5);

if (reranked[0].rerank_score < RERANK_THRESHOLD) {
  // trả NO_ANSWER_FOUND — không đưa vào LLM
}
```

> Đây là điểm khác biệt quan trọng so với Model 2: Model 2 dùng `similarity` (cosine) làm ngưỡng; Model 3 dùng `rerank_score` (thang điểm khác, do cross-encoder trả về, KHÔNG cùng thang với cosine similarity) — cần tự đo và chốt ngưỡng riêng qua pilot test 10-20 câu, không dùng lại ngưỡng 0.75 của Model 2.

---

## 8. Bổ sung v1.3: Hybrid search cho Model 4 — `content_tsv`

### 8.1 Cột mới trong `document_chunks`

```sql
ALTER TABLE document_chunks ADD COLUMN IF NOT EXISTS content_tsv tsvector
  GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED;

CREATE INDEX IF NOT EXISTS idx_chunks_content_tsv
  ON document_chunks USING gin (content_tsv);
```

> Dùng dictionary `'simple'` thay vì `'english'` — PostgreSQL không có dictionary tiếng Việt built-in sẵn, `'simple'` chỉ tách từ theo khoảng trắng/dấu câu mà không "stem" (biến đổi từ), an toàn hơn cho văn bản tiếng Việt có dấu. Đây là cột **generated column** (tự động tính lại mỗi khi `content` đổi), không cần code insert/update thủ công.

### 8.2 Truy vấn keyword search

```sql
SELECT id, content, ts_rank(content_tsv, plainto_tsquery('simple', $1)) AS rank
FROM document_chunks
WHERE content_tsv @@ plainto_tsquery('simple', $1)
ORDER BY rank DESC
LIMIT 20;
```

### 8.3 Hợp nhất với vector search bằng RRF (Node.js, ví dụ đơn giản)

```js
function reciprocalRankFusion(vectorResults, keywordResults, k = 60) {
  const scores = new Map();
  vectorResults.forEach((r, i) => {
    scores.set(r.id, (scores.get(r.id) || 0) + 1 / (k + i + 1));
  });
  keywordResults.forEach((r, i) => {
    scores.set(r.id, (scores.get(r.id) || 0) + 1 / (k + i + 1));
  });
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id, score]) => ({ id, rrf_score: score }));
}
```

---

## 9. Checklist migration v1.3 (chạy trên cả 2 máy A và B)

1. Backup trước khi chạy: `pg_dump -Fc done_team_db > backup_$(date +%Y%m%d)_before_v3.dump`
2. Chạy `schema_v3.sql` (chỉ phần "MIGRATION v3" nếu DB đã có từ trước)
3. Kiểm tra lại:
   ```sql
   SELECT column_name FROM information_schema.columns WHERE table_name = 'qa_logs';
   SELECT column_name FROM information_schema.columns WHERE table_name = 'document_chunks';
   ```
4. Test nhanh hybrid search: `SELECT id FROM document_chunks WHERE content_tsv @@ plainto_tsquery('simple', 'Bến Nghé') LIMIT 5;`

---

## 10. Lưu ý khi 2 bạn cùng làm việc trên cùng 1 database

- Mỗi người nên có **database local riêng** (chạy PostgreSQL qua Docker) để không đụng dữ liệu của nhau khi đang thử nghiệm; chỉ dùng 1 database "staging" chung khi tích hợp thật (Tuần 11–12 theo kế hoạch).
- File `docker-compose.yml` mẫu để cả 2 dựng CSDL local giống hệt nhau:

```yaml
services:
  db:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_DB: done_team_db
      POSTGRES_PASSWORD: postgres
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data
volumes:
  pgdata:
```

- Luôn commit file migration (không commit dữ liệu thật nếu chứa thông tin nhạy cảm — dữ liệu địa giới hành chính là công khai nên có thể commit seed mẫu thoải mái).
