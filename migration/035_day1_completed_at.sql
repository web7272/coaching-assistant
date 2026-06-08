-- Migration 035: students.day1_completed_at (Vivi 6/7).
--
-- 動機 (Patrick 6/7): 教練後台「編輯資料」要顯示 Day-1 完成日期. 過去只能
-- 從 sessions.day_complete=TRUE 推, 但 sessions.updated_at 會被後續更新
-- 飄移 → 不可靠. 改用穩定 timestamp 鏡像現有 day1_started_at write-if-null
-- 模式 (033).
--
-- 寫入點: api/finalize-day.js — day_complete 設 TRUE 那點, 且 day===1 時:
--   UPDATE students SET day1_completed_at = NOW()
--    WHERE student_id = $1 AND day1_completed_at IS NULL
-- write-if-null → 只記第一次完成, re-finalize 不覆蓋.
--
-- 讀取點:
--   - api/students.js GET single student → SELECT 帶 day1_completed_at
--   - coach.html / coach.js → 表單顯示「Day 1 完成日期: YYYY-MM-DD」(Asia/Taipei)
--                              或「尚未完成」 (NULL).
--
-- 跑這支前確認 migration 序號: 上一支是 034 (app_config).
--
-- ⚠️ DO NOT RUN AUTOMATICALLY. Vivi 跑 Neon console:
--   psql $DATABASE_URL -f migration/035_day1_completed_at.sql

DO $$
BEGIN
  RAISE NOTICE '════ MIGRATION 035: students.day1_completed_at ════';
END $$;

-- ════════════════════════════════════════════════════════════════
-- 1. BEFORE snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students' AND column_name='day1_completed_at') AS col_exists;

-- ════════════════════════════════════════════════════════════════
-- 2. students.day1_completed_at column (idempotent)
-- ════════════════════════════════════════════════════════════════
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS day1_completed_at TIMESTAMPTZ;

-- Partial index — only the populated rows are interesting (the unknown set
-- of NULLs is large by default). Used by coach後台 single-student GET +
-- any future「has-completed-day1」 admin filter.
CREATE INDEX IF NOT EXISTS idx_students_day1_completed_at
  ON students(day1_completed_at)
  WHERE day1_completed_at IS NOT NULL;

-- ════════════════════════════════════════════════════════════════
-- 3. AFTER snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'AFTER' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students' AND column_name='day1_completed_at') AS col_exists;

SELECT 'COLUMN' AS stage, column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'students' AND column_name = 'day1_completed_at';
-- 預期: 1 row (day1_completed_at / timestamptz / YES nullable).

-- ════════════════════════════════════════════════════════════════
-- 4. Optional backfill (Vivi 跑或不跑都可)
-- ════════════════════════════════════════════════════════════════
-- 如果想把現有已完成 Day 1 的學員 backfill 上去 (用 sessions 第一次
-- day_complete=TRUE for day=1 的 created_at), Vivi 可選跑:
--
-- UPDATE students s
--    SET day1_completed_at = sub.first_complete_at
--   FROM (
--     SELECT student_id, MIN(created_at) AS first_complete_at
--       FROM sessions
--      WHERE module = 'self' AND day_complete = TRUE
--        AND (day = 1 OR session_day = 1)
--      GROUP BY student_id
--   ) sub
--  WHERE s.student_id = sub.student_id
--    AND s.day1_completed_at IS NULL;
--
-- 不跑也 OK — 新 finalize 會自動寫, 後台對舊帳號顯示「尚未完成」直到 Vivi
-- backfill or 該學員再完成一次.
