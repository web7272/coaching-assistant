-- Migration 033: Day-1 monthly quota gate (Vivi 6/7 商業模型).
-- 來源: Patrick 6/7 funnel-precise spec — gate only NEW emails at magic-link
--        layer; PDF-only + existing students always pass; chat.js writes
--        day1_started_at at "cost actually incurred" moment (write-if-null).
--
-- 新增 / 修改:
--   1. students.day1_started_at TIMESTAMPTZ — 設於學員第一次走進 Day-1 對話
--      時 (api/chat.js loadOrCreateSession 'create' path, write-if-null).
--      用途: 跨月名額計數 (COUNT DISTINCT student_id WHERE day1_started_at
--      落在當月 Asia/Taipei).
--   2. day1_waitlist (NEW TABLE) — 名額額滿時、新 email 進候補名單. 軟上限
--      設計: 已發出但未點的 magic-link 仍會生效 (可接受小幅超額).
--
-- 沒動:
--   - leads 表 (option 1 PDF-only 仍進這, 不擋, 無變更).
--   - students 其他欄位.
--   - magic_link_tokens.
--   - 任何 v5.2 active_context / context_onboarded 欄位.
--
-- 跑這支前確認 migration 序號: 上一支是 032 (cases).
--
-- ⚠️ DO NOT RUN AUTOMATICALLY. Vivi 跑 Neon console:
--   psql $DATABASE_URL -f migration/033_day1_quota.sql

DO $$
BEGIN
  RAISE NOTICE '════ MIGRATION 033: Day-1 monthly quota gate ════';
END $$;

-- ════════════════════════════════════════════════════════════════
-- 1. BEFORE snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students' AND column_name='day1_started_at') AS day1_col_exists,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_name='day1_waitlist') AS waitlist_table_exists;

-- ════════════════════════════════════════════════════════════════
-- 2. students.day1_started_at column (idempotent)
-- ════════════════════════════════════════════════════════════════
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS day1_started_at TIMESTAMPTZ;

-- Index for monthly COUNT DISTINCT — used by gate's quota read.
CREATE INDEX IF NOT EXISTS idx_students_day1_started_at
  ON students(day1_started_at)
  WHERE day1_started_at IS NOT NULL;

-- ════════════════════════════════════════════════════════════════
-- 3. day1_waitlist table (idempotent)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS day1_waitlist (
  id          SERIAL PRIMARY KEY,
  email       TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'request_link',  -- request_link | request_guide
  reason      TEXT NOT NULL DEFAULT 'quota_full',    -- room for future reasons
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotent CHECK on source enum.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'day1_waitlist'::regclass
      AND conname = 'day1_waitlist_source_check'
  ) THEN
    ALTER TABLE day1_waitlist
      ADD CONSTRAINT day1_waitlist_source_check
      CHECK (source IN ('request_link', 'request_guide'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_day1_waitlist_email      ON day1_waitlist(email);
CREATE INDEX IF NOT EXISTS idx_day1_waitlist_created_at ON day1_waitlist(created_at);

-- ════════════════════════════════════════════════════════════════
-- 4. AFTER snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'AFTER' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students' AND column_name='day1_started_at') AS day1_col_exists,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_name='day1_waitlist') AS waitlist_table_exists;

SELECT 'WAITLIST COLUMNS' AS stage, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'day1_waitlist'
 ORDER BY ordinal_position;
-- 預期: 5 row (id / email / source / reason / created_at).

SELECT 'INDEXES' AS stage, indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND (tablename = 'students' AND indexname = 'idx_students_day1_started_at'
        OR tablename = 'day1_waitlist')
 ORDER BY tablename, indexname;
-- 預期: 4 row (students idx + waitlist PK + email + created_at).

-- ════════════════════════════════════════════════════════════════
-- 5. Operational queries (commented; Vivi 可手動驗)
-- ════════════════════════════════════════════════════════════════
-- 當月已用名額 (Asia/Taipei):
-- SELECT COUNT(DISTINCT student_id) AS used_this_month
--   FROM students
--  WHERE day1_started_at >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Taipei')
--                            AT TIME ZONE 'Asia/Taipei';
--
-- 當月候補名單:
-- SELECT email, source, created_at FROM day1_waitlist
--  WHERE created_at >= date_trunc('month', NOW() AT TIME ZONE 'Asia/Taipei')
--                       AT TIME ZONE 'Asia/Taipei'
--  ORDER BY created_at DESC;
