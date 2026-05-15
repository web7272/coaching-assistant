-- Migration 011: prompt_engineering_misses 表（v4.0 observability）
-- 對齊：v4.0 Advisor Phase 1 + Patrick refine
-- 用途：detector 抓到 AI 沒走主路徑（reverse_example_miss / chain_interrupted / closure_miss）時記錄
--   Patrick / Vivi 後台 review、確認 true_miss 才升級 regex trigger
-- 關聯：admin/v4-metrics endpoint Query 2/3/4 都讀這張表

-- 1. 跑前狀態
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name='prompt_engineering_misses') AS table_exists;

-- 2. CREATE TABLE
CREATE TABLE IF NOT EXISTS prompt_engineering_misses (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  student_id      TEXT NOT NULL,
  module          TEXT NOT NULL,
  week            INT NOT NULL,
  day             INT NOT NULL,
  turn_count      INT NOT NULL,
  miss_type       TEXT NOT NULL,
  detector        TEXT NOT NULL,
  user_message    TEXT,
  ai_response     TEXT,
  triggers_hit    TEXT[],
  triggers_missed TEXT[],
  caching_enabled BOOLEAN,
  active_features JSONB,
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  review_verdict  TEXT,
  review_note     TEXT,
  promoted_to_regex BOOLEAN DEFAULT false
);

-- 3. Indexes
CREATE INDEX IF NOT EXISTS idx_misses_unreviewed
  ON prompt_engineering_misses (created_at DESC)
  WHERE reviewed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_misses_student_week
  ON prompt_engineering_misses (student_id, module, week, day);

CREATE INDEX IF NOT EXISTS idx_misses_type_detector
  ON prompt_engineering_misses (miss_type, detector, created_at DESC);

-- 4. 驗證
SELECT 'AFTER columns' AS stage, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name='prompt_engineering_misses'
ORDER BY ordinal_position;

SELECT 'AFTER indexes' AS stage, indexname
FROM pg_indexes
WHERE tablename='prompt_engineering_misses';

-- 預期：columns 19 row、indexes 4 row（PK + 3 個 explicit）
