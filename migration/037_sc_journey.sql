-- Migration 037: students.sc_journey_step + sc_journey_evidence (Vivi 6/10).
-- v52_seven_steps_errata PR-1 §3.4 — 七步路徑 state schema.
--
-- 動機 (Patrick 6/10): 七步 reframe (前 5 步 self/ + 後 2 步 ego/) 是 v5.2
-- 新增的核心軌跡語意, 但目前 students 表沒地方存「現在走到第幾步」+「每步
-- 的證據」. PR-1 只建表 + 純讀 plumbing, 行為 0 改變; step 偵測 / evidence
-- append / finalize 寫 / Damon wire 全是 PR-2~5.
--
-- 新增:
--   students.sc_journey_step      INT (1..7 或 NULL) — 當前步進.
--   students.sc_journey_evidence  JSONB DEFAULT '[[],[],[],[],[],[],[]]'::jsonb
--                                 — 7 個空陣列, slot 0 = step 1 證據, slot 6 = step 7 證據.
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
  DEFAULT '[[],[],[],[],[],[],[]]'::jsonb;

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
-- 看某學員當前進度:
-- SELECT student_id, sc_journey_step, jsonb_array_length(sc_journey_evidence)
--   FROM students WHERE student_id = 'A006';
--
-- 看每步的學員分布:
-- SELECT sc_journey_step, COUNT(*) FROM students
--  WHERE sc_journey_step IS NOT NULL
--  GROUP BY sc_journey_step ORDER BY sc_journey_step;
