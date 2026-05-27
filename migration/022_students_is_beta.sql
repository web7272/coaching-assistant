-- Migration 022: students.is_beta — 區分封測者 vs 真實付費客戶.
-- 來源：Patrick 5/26「Daniel建置藍圖-客服+Lead經營.md §3」
--
-- 為什麼需要：
--   /api/admin/leads 分群 (Daniel 客服 / lead 經營 agent 查) 會把 plan_a/plan_b
--   一律當「purchased」. 封測者 (Vivi 手動改 plan_a) 應排除在「催購 / 滿意度回饋」
--   名單外、否則會被當真實付費客戶催購、體感很糟.
--
-- Vivi 跑這支之後一併把封測者標起來：
--   UPDATE students SET is_beta = TRUE WHERE student_id IN ('A001','A002',...);
--
-- 跑這支前確認 migration 序號：上一支是 021 (leads).

DO $$
BEGIN
  RAISE NOTICE '════ MIGRATION 022: students.is_beta (Daniel 客服分群用) ════';
END $$;

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS is_beta BOOLEAN NOT NULL DEFAULT FALSE;

-- ═══ VERIFY ═══
SELECT 'AFTER' AS stage, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'students' AND column_name = 'is_beta';
-- 預期：1 row — is_beta boolean NO false (NOT NULL DEFAULT FALSE).

-- 提醒 — 標封測者範例 (跑完上面 ALTER 後手動執行):
-- UPDATE students SET is_beta = TRUE WHERE student_id IN ('A001','A002','A003');
