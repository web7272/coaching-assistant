-- Migration 023: students.is_blocked
-- 來源：Patrick 5/29 (Vivi 5/29 拍板「不適合 TA 立刻停 / 封測 30 天 window」).
--
-- 兩個機制共用同一欄位:
--   (a) 手動 block: Vivi 跑 SQL UPDATE students SET is_blocked=TRUE WHERE student_id=…
--   (b) 自動 block: is_beta=TRUE 註冊滿 30 天還沒 Day 21 takeaway seeded
--       → lazy check 在 chat.js / conversation-today.js 入口設 is_blocked=TRUE.
--
-- is_blocked=TRUE 表示帳號停用、不可登入、不可聊;資料保留 (不 cascade delete
-- sessions / messages / session_state / damon_notes / takeaways).
--
-- 跑這支前確認 migration 序號：上一支是 022 (students_is_beta).

DO $$
BEGIN
  RAISE NOTICE '════ MIGRATION 023: students.is_blocked (Vivi 封測 access gate) ════';
END $$;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS is_blocked BOOLEAN NOT NULL DEFAULT FALSE;

-- partial index — 平時 90%+ 的學員 is_blocked=FALSE, 部分索引讓 active 查詢更快.
CREATE INDEX IF NOT EXISTS idx_students_is_blocked
  ON students(is_blocked) WHERE is_blocked = FALSE;

COMMENT ON COLUMN students.is_blocked IS
  'true=帳號停用、不可登入不可聊;資料保留. 來源:Vivi 手動 / 30 天封測 window 過期 lazy check.';

-- ═══ VERIFY ═══
SELECT 'AFTER' AS stage, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'students' AND column_name = 'is_blocked';
-- 預期：1 row — is_blocked boolean NO false (NOT NULL DEFAULT FALSE).

SELECT 'INDEX' AS stage, indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public'
   AND tablename = 'students'
   AND indexname = 'idx_students_is_blocked';
-- 預期：1 row — partial index WHERE is_blocked = false.
