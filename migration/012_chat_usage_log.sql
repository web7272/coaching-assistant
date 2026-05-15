-- Migration 012: chat_usage_log 表（v4.0 observability）
-- 對齊：v4.0 Advisor Phase 1 + Patrick refine
-- 用途：每輪 chat call 完寫 1 row、追蹤 caching hit rate / token usage / latency / damon context size
-- 關聯：admin/v4-metrics endpoint Query 1/5 都讀這張表

-- 1. 跑前狀態
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name='chat_usage_log') AS table_exists;

-- 2. CREATE TABLE
CREATE TABLE IF NOT EXISTS chat_usage_log (
  id                   BIGSERIAL PRIMARY KEY,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  student_id           TEXT NOT NULL,
  module               TEXT NOT NULL,
  week                 INT NOT NULL,
  day                  INT NOT NULL,
  turn_count           INT NOT NULL,
  caching_enabled      BOOLEAN NOT NULL,
  cache_creation       INT NOT NULL DEFAULT 0,
  cache_read           INT NOT NULL DEFAULT 0,
  uncached_input       INT NOT NULL,
  output_tokens        INT NOT NULL,
  duration_ms          INT,
  damon_context_chars  INT,
  dynamic_block_chars  INT
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_chat_usage_created_at
  ON chat_usage_log (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_chat_usage_caching
  ON chat_usage_log (caching_enabled, created_at DESC);

-- 4. 驗證
SELECT 'AFTER columns' AS stage, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name='chat_usage_log'
ORDER BY ordinal_position;

SELECT 'AFTER indexes' AS stage, indexname
FROM pg_indexes
WHERE tablename='chat_usage_log';

-- 預期：columns 15 row、indexes 3 row（PK + 2 explicit）
