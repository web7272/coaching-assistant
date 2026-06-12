-- Migration 038: students.sc_storyboard (Vivi 6/11).
-- v5.3 件3 PR-J2 — 頁 Y「我的人生旅途」 per-step generated content.
--
-- 動機 (Patrick 6/11): 頁 Y 七步故事頁需要 per-step「大腦現狀 (brain_state)」 +
-- 「主權建議 (sovereign_action)」 生成。即時 GET 生成 = 7 LLM calls/page-open →
-- 爆 maxDuration。改 precompute @ finalize-day + 純讀 endpoint。本 PR (J2) 只
-- 寫 brain_state; sovereign_action 留 PR-J3。
--
-- 新增:
--   students.sc_storyboard JSONB DEFAULT '{}'::jsonb
--     — keyed object 結構 (per-step lazy populate):
--       {
--         "step_1": {
--           "brain_state":      { "description": "...", "quote": "..." | null },
--           "sovereign_action": null   // PR-J3 fills
--         },
--         "step_2": {...}, …, "step_7": {...}
--       }
--     — 缺 step_N key / 缺 brain_state key 一律當 null (endpoint fail-soft).
--
-- 跑這支前確認 migration 序號: 上一支是 037 (sc_journey, 七步 errata).
--
-- ⚠️ DO NOT RUN AUTOMATICALLY. Vivi 跑 Neon console:
--   psql $DATABASE_URL -f migration/038_sc_storyboard.sql

DO $$
BEGIN
  RAISE NOTICE '════ MIGRATION 038: students.sc_storyboard ════';
END $$;

-- ════════════════════════════════════════════════════════════════
-- 1. BEFORE snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students' AND column_name='sc_storyboard') AS col_exists;

-- ════════════════════════════════════════════════════════════════
-- 2. students.sc_storyboard column (idempotent)
-- ════════════════════════════════════════════════════════════════
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS sc_storyboard JSONB DEFAULT '{}'::jsonb;

-- ════════════════════════════════════════════════════════════════
-- 3. AFTER snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'AFTER' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students' AND column_name='sc_storyboard') AS col_exists;

SELECT 'SC_STORYBOARD POPULATION' AS stage,
       COUNT(*) FILTER (WHERE sc_storyboard = '{}'::jsonb)        AS empty_count,
       COUNT(*) FILTER (WHERE sc_storyboard <> '{}'::jsonb)       AS populated_count
  FROM students;
-- 預期 (剛跑完): 全部 empty (新欄, 還沒 populate).
-- 上線後逐漸出現 populated rows (finalize-day 在學員觸發 step 變動時寫入).

-- ════════════════════════════════════════════════════════════════
-- 4. Operational queries (commented; Vivi / 後台分析可用)
-- ════════════════════════════════════════════════════════════════
-- 看某學員當前已生成的 brain_state:
-- SELECT student_id,
--        jsonb_object_keys(sc_storyboard) AS step_key,
--        sc_storyboard -> jsonb_object_keys(sc_storyboard) -> 'brain_state' AS brain_state
--   FROM students WHERE student_id = 'A006';
--
-- 看每步的學員生成覆蓋率:
-- SELECT key AS step_key,
--        COUNT(*) FILTER (WHERE sc_storyboard -> key -> 'brain_state' IS NOT NULL) AS brain_state_count,
--        COUNT(*) FILTER (WHERE sc_storyboard -> key -> 'sovereign_action' IS NOT NULL) AS sovereign_action_count
--   FROM students, jsonb_object_keys(sc_storyboard) AS key
--  GROUP BY key ORDER BY key;
