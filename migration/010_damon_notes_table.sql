-- Migration 010: 新建 damon_notes 獨立表（v4.0）
-- 對齊：Patrick blocker 1 decision (a)
-- 設計：
--   - id BIGSERIAL PRIMARY KEY
--   - 唯一性：(student_id, module, week, day, is_week_summary)
--     允許同一 (student_id, module, week, day) 同時有 daily note (is_week_summary=false) +
--     week summary (is_week_summary=true)、Week summary 通常掛在 day=6 上
--   - is_week_summary 區分 daily note vs per-week 濃縮 summary
--   - 既有 sessions.damon_note column **不動**、保留 backward compat
--   - v4.0 起 chat.js generateDamonNote + finalize-day per-week summary 寫入這張表

-- 1. 跑前狀態
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name='damon_notes') AS table_exists;

-- 2. CREATE TABLE
CREATE TABLE IF NOT EXISTS damon_notes (
  id              BIGSERIAL PRIMARY KEY,
  student_id      TEXT NOT NULL,
  module          TEXT NOT NULL,
  week            INT NOT NULL,
  day             INT NOT NULL,
  note_text       TEXT NOT NULL,
  is_week_summary BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. UNIQUE constraint（先 DROP IF EXISTS 再 ADD、整段 idempotent）
ALTER TABLE damon_notes DROP CONSTRAINT IF EXISTS damon_notes_unique_per_day_kind;
ALTER TABLE damon_notes ADD CONSTRAINT damon_notes_unique_per_day_kind
  UNIQUE (student_id, module, week, day, is_week_summary);

-- 4. Indexes
CREATE INDEX IF NOT EXISTS idx_damon_notes_student_module_week_kind
  ON damon_notes (student_id, module, week, is_week_summary);

CREATE INDEX IF NOT EXISTS idx_damon_notes_updated_at
  ON damon_notes (updated_at DESC);

-- 5. 驗證 columns
SELECT 'AFTER columns' AS stage, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name='damon_notes'
ORDER BY ordinal_position;

-- 6. 驗證 constraints
SELECT 'AFTER constraints' AS stage, conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid='damon_notes'::regclass;

-- 7. 驗證 indexes
SELECT 'AFTER indexes' AS stage, indexname
FROM pg_indexes
WHERE tablename='damon_notes';

-- 預期 AFTER：
--   columns 9 row（id / student_id / module / week / day / note_text / is_week_summary / created_at / updated_at）
--   constraints 至少 2 row（PRIMARY KEY + UNIQUE）
--   indexes 至少 3 row（PRIMARY KEY 自動 index + 2 個 CREATE INDEX）
