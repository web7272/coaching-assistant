-- Migration 039: students.sc_storyboard_history (Vivi 6/26).
-- 每日「我的故事」快照存檔 — 結業 PDF 要能看到 21 天進度 (不只最後一版).
--
-- 動機 (Patrick 6/26): sc_storyboard (038) 每次 finalize 覆寫 = 只留最新一版.
-- Vivi 要 PDF 呈現「故事一天天長出來」的進度, 所以每天 finalize 後把當下整個
-- sc_storyboard 拍一張快照、按 day_N 存進 history (append, 不蓋別天).
--
-- 新增:
--   students.sc_storyboard_history JSONB DEFAULT '{}'::jsonb
--     {
--       "day_1":  { <當天整個 sc_storyboard: step_1..7> },
--       "day_2":  { ... },
--       ...
--       "day_21": { ... }
--     }
--   - 同一天 re-finalize → 覆寫該天 key 為最新 (合理).
--   - 缺 day_N → 那天沒 finalize 過 (讀取端 fail-soft).
--
-- 跑這支前確認序號: 上一支是 038 (sc_storyboard).
--
-- ⚠️ DO NOT RUN AUTOMATICALLY. Vivi 跑 Neon console:
--   psql $DATABASE_URL -f migration/039_sc_storyboard_history.sql

DO $$
BEGIN
  RAISE NOTICE '════ MIGRATION 039: students.sc_storyboard_history ════';
END $$;

-- 1. BEFORE
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students' AND column_name='sc_storyboard_history') AS col_exists;

-- 2. column (idempotent)
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS sc_storyboard_history JSONB DEFAULT '{}'::jsonb;

-- 3. AFTER
SELECT 'AFTER' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students' AND column_name='sc_storyboard_history') AS col_exists,
       COUNT(*) FILTER (WHERE sc_storyboard_history = '{}'::jsonb)  AS empty_count,
       COUNT(*) FILTER (WHERE sc_storyboard_history <> '{}'::jsonb) AS populated_count
FROM students;
