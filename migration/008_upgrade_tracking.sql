-- Migration 008: students 表加升級追蹤欄位
-- 對齊：PRODUCT-TRUTH v1.3 雙方案、trial → plan_a/plan_b 升級流程預埋
-- 日期：2026-05-10
--
-- 三個欄位：
--   upgrade_deadline  TIMESTAMP NULL  — trial 到期日（NULL = 還沒設）
--   upgraded_at       TIMESTAMP NULL  — 真正付費升級時間（NULL = 還沒升）
--   upgrade_amount    INT NULL        — 付費金額（3000 / 4500 / NULL）
--
-- 本次只建欄位、不寫業務邏輯（chat.js / students.js 都不讀這三欄、為未來 Mike Landing Page 預埋）

-- 1. 跑前狀態（驗證三欄都還沒在）
SELECT 'BEFORE' AS stage, column_name
FROM information_schema.columns
WHERE table_name = 'students'
  AND column_name IN ('upgrade_deadline', 'upgraded_at', 'upgrade_amount')
ORDER BY column_name;

-- 2. 加欄位（IF NOT EXISTS、整段 idempotent）
ALTER TABLE students ADD COLUMN IF NOT EXISTS upgrade_deadline TIMESTAMP NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS upgraded_at      TIMESTAMP NULL;
ALTER TABLE students ADD COLUMN IF NOT EXISTS upgrade_amount   INT       NULL;

-- 3. 跑後驗證
SELECT 'AFTER' AS stage, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'students'
  AND column_name IN ('upgrade_deadline', 'upgraded_at', 'upgrade_amount')
ORDER BY column_name;

-- 預期 AFTER 3 row：
-- upgrade_amount   | integer                       | YES
-- upgrade_deadline | timestamp without time zone   | YES
-- upgraded_at      | timestamp without time zone   | YES
