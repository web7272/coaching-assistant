-- Migration 037: students.sc_journey_step + sc_journey_evidence (Vivi 6/10).
-- v52_seven_steps_errata PR-1 §3.4 — 七步路徑 state schema.
--
-- 動機 (Patrick 6/10): v5.2 七步路徑 (詳見 spec) 需要 state schema 存
-- 「現在走到第幾步」+「每步的證據」. PR-1 只建表 + 純讀 plumbing, 行為
-- 0 改變; step 偵測 / evidence append / finalize 寫 / Damon wire 全是 PR-2~5.
--
-- 新增:
--   students.sc_journey_step      INT (1..7 或 NULL) — 當前步進.
--   students.sc_journey_evidence  JSONB DEFAULT keyed object {step_1..step_7: []}
--                                 — 按 key 寫入 (-> 'step_N'), 對齊 spec §3.4
--                                   寫入語意 + PR-3 inject / PR-4 append 用同
--                                   一組 step_N key, 避免 positional off-by-one.
--
-- 跑這支前確認 migration 序號: 上一支是 036 (damon_notes_template_version).
--
-- ⚠️ DO NOT RUN AUTOMATICALLY. Vivi 跑 Neon console:
--   psql $DATABASE_URL -f migration/037_sc_journey.sql

DO $$
BEGIN
  RAISE NOTICE '════ MIGRATION 037: students.sc_journey_step + sc_journey_evidence ════';
END $$;

-- ════════════════════════════════════════════════════════════════
-- 1. BEFORE snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students' AND column_name='sc_journey_step') AS step_col_exists,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students' AND column_name='sc_journey_evidence') AS evidence_col_exists;

-- ════════════════════════════════════════════════════════════════
-- 2. students.sc_journey_step + sc_journey_evidence (idempotent)
-- ════════════════════════════════════════════════════════════════
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS sc_journey_step INT;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS sc_journey_evidence JSONB
  DEFAULT '{"step_1":[],"step_2":[],"step_3":[],"step_4":[],"step_5":[],"step_6":[],"step_7":[]}'::jsonb;

-- CHECK constraint — step 必須在 1..7 或 NULL. Idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'students'::regclass
      AND conname = 'students_sc_journey_step_check'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_sc_journey_step_check
      CHECK (sc_journey_step IS NULL OR sc_journey_step BETWEEN 1 AND 7);
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 3. AFTER snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'AFTER' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students' AND column_name='sc_journey_step') AS step_col_exists,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students' AND column_name='sc_journey_evidence') AS evidence_col_exists;

SELECT 'SC_JOURNEY STEP DISTRIBUTION' AS stage,
       sc_journey_step, COUNT(*) AS students_count
  FROM students
 GROUP BY sc_journey_step
 ORDER BY sc_journey_step NULLS FIRST;
-- 預期 (剛跑完): 全部 NULL (新欄, 還沒 populate).

-- ════════════════════════════════════════════════════════════════
-- 4. Operational queries (commented; Vivi / 後台分析可用)
-- ════════════════════════════════════════════════════════════════
-- 看某學員當前進度 + 每步證據數:
-- SELECT student_id, sc_journey_step,
--        jsonb_object_keys(sc_journey_evidence) AS step_key,
--        jsonb_array_length(sc_journey_evidence -> jsonb_object_keys(sc_journey_evidence)) AS evidence_count
--   FROM students WHERE student_id = 'A006';
--
-- 看單一 step 的證據 (e.g. step 4):
-- SELECT student_id, jsonb_array_length(sc_journey_evidence -> 'step_4') AS step_4_evidence_count
--   FROM students WHERE student_id = 'A006';
--
-- 看每步的學員分布:
-- SELECT sc_journey_step, COUNT(*) FROM students
--  WHERE sc_journey_step IS NOT NULL
--  GROUP BY sc_journey_step ORDER BY sc_journey_step;
