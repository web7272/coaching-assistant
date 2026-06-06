-- Migration 031: students.context_onboarded — v5.2 第四塊 PR-a (Vivi 6/5).
-- 新學員 onboarding 3 步驟設 active_context 用的 gate flag.
--
-- 來源: v52_context_anchored_spec §1 + §7.2 新學員強制走.
--
-- 設計區分:
--   - 既有封測學員: Vivi 後台手動設 active_context_* (migration 029 default 1=事業)
--     → context_onboarded = TRUE (跳過 onboarding flow).
--   - 新學員 INSERT (verify-link.js / students.js POST): default FALSE
--     → 第一次對話走 onboarding 3 步 → 完成設 TRUE.
--
-- 跑這支前確認 migration 序號: 上一支是 030 (active_context_session_summary).
--
-- ⚠️ DO NOT RUN AUTOMATICALLY. Vivi 跑 Neon console:
--   psql $DATABASE_URL -f migration/031_students_context_onboarded.sql

DO $$
BEGIN
  RAISE NOTICE '════ MIGRATION 031: students.context_onboarded (v5.2 第四塊) ════';
END $$;

-- ════════════════════════════════════════════════════════════════
-- 1. BEFORE snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students'
          AND column_name='context_onboarded') AS flag_col_exists,
       (SELECT COUNT(*) FROM students) AS total_students,
       (SELECT COUNT(*) FROM students WHERE is_beta = TRUE) AS beta_students;

-- ════════════════════════════════════════════════════════════════
-- 2. ALTER TABLE + backfill existing beta students
-- ════════════════════════════════════════════════════════════════
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS context_onboarded BOOLEAN NOT NULL DEFAULT FALSE;

-- ⭐ 既有封測學員 context 由 Vivi 後台設 (migration 029 default 事業), 不走 onboarding.
--   This UPDATE is idempotent — re-running just confirms existing TRUE values stay TRUE.
UPDATE students SET context_onboarded = TRUE WHERE is_beta = TRUE;

-- ════════════════════════════════════════════════════════════════
-- 3. AFTER snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'AFTER' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students'
          AND column_name='context_onboarded') AS flag_col_exists,
       (SELECT COUNT(*) FROM students
        WHERE context_onboarded = TRUE AND is_beta = TRUE) AS beta_onboarded_true,
       (SELECT COUNT(*) FROM students
        WHERE context_onboarded = FALSE) AS non_onboarded_students;
-- 預期:
--   flag_col_exists = 1
--   beta_onboarded_true = beta_students (from BEFORE)
--   non_onboarded_students = 0 OR small number (new students who haven't done onboarding)
