-- Migration 029: students.active_context_* — v5.2 第一塊資料層.
-- 來源: Vivi 6/5 直接需求「後端做一個我可以改的、做在 is_beta 同一個地方;
--                       先 default 所有人事業、我一一聯繫確認後再到前端改」.
-- 對應: v52_context_anchored_spec.md §7.1 舊學員處理 + §2 schema 的 student-level
--       落地變體 (engineering decision: 放 students 表而非 session_state JSONB).
--
-- 工程決策:
--   context 是 21 天 program 級 + 教練後台逐一改 → student-level, 同 is_beta 表.
--   runtime 之後從 students 表讀 (本 PR 不做 runtime inject).
--
-- 為什麼 DEFAULT 1 = 事業:
--   Vivi 要的初始狀態 = 所有 beta 學員先 default 事業, 之後 Vivi 聯繫一一確認再
--   改成正確 category. 跑這支後所有現有 row 自動填 1.
--
-- Category enum (spec §1.3 + 後台下拉用):
--   1 = 事業 / 工作 / 金錢       (career_work_money)
--   2 = 親密關係 (伴侶 / 戀愛)   (intimate_relationship)
--   3 = 家庭 (原生家庭 / 子女)   (family)
--   4 = 健康 / 身體              (health)
--   5 = 自我 / 內在狀態 / 心理   (self_internal)
--
-- 跑這支前確認 migration 序號: 上一支是 028 (s6 modal operator count).
--
-- ⚠️ DO NOT RUN AUTOMATICALLY. Vivi 跑 Neon console:
--   psql $DATABASE_URL -f migration/029_students_active_context.sql

DO $$
BEGIN
  RAISE NOTICE '════ MIGRATION 029: students.active_context_* (v5.2 第一塊) ════';
END $$;

-- ════════════════════════════════════════════════════════════════
-- 1. BEFORE snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students'
          AND column_name='active_context_category') AS cat_col_exists,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students'
          AND column_name='active_context_name') AS name_col_exists,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students'
          AND column_name='active_context_definition') AS def_col_exists,
       (SELECT COUNT(*) FROM students) AS total_students;

-- ════════════════════════════════════════════════════════════════
-- 2. ALTER TABLE (idempotent IF NOT EXISTS)
-- ════════════════════════════════════════════════════════════════
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS active_context_category   INT  NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS active_context_name       TEXT,
  ADD COLUMN IF NOT EXISTS active_context_definition TEXT;

-- Idempotent CHECK constraint (catch via DO block — duplicate add throws else).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'students'::regclass
      AND conname = 'students_active_context_category_check'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_active_context_category_check
      CHECK (active_context_category IN (1, 2, 3, 4, 5));
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 3. AFTER snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'AFTER' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students'
          AND column_name='active_context_category') AS cat_col_exists,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students'
          AND column_name='active_context_name') AS name_col_exists,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='students'
          AND column_name='active_context_definition') AS def_col_exists,
       (SELECT COUNT(*) FROM students
        WHERE active_context_category = 1) AS students_default_career;
-- 預期: 3 個 col_exists = 1, students_default_career = total_students (all default 1).

-- ════════════════════════════════════════════════════════════════
-- 4. Verify CHECK constraint blocks invalid values (manual smoke, not run)
-- ════════════════════════════════════════════════════════════════
-- Vivi 跑這支後可以手動驗 CHECK 擋 0/6:
--   UPDATE students SET active_context_category = 0 WHERE student_id = '<test_id>';
--   → ERROR: violates check constraint
--   UPDATE students SET active_context_category = 6 WHERE student_id = '<test_id>';
--   → ERROR: violates check constraint
--   UPDATE students SET active_context_category = 3 WHERE student_id = '<test_id>';
--   → OK (家庭)
