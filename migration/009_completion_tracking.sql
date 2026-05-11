-- Migration 009: 加 plan_b 跨模組推進需要的欄位
-- 目的：追蹤每個模組是否完成、解鎖下個模組
-- 對齊：docs/v3.4/07-chat_v34_spec.md Part 2.3 + Part 4

-- 1. 跑前檢查
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name = 'students' 
          AND column_name IN ('self_week_completed', 'money_week_completed', 'relationship_week_completed', 'money_unlocked', 'relationship_unlocked')) AS existing_count;

-- 2. 新增欄位（IF NOT EXISTS 防呆）
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS self_week_completed INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS money_week_completed INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS relationship_week_completed INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS money_unlocked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS relationship_unlocked BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. 跑後驗證
SELECT 'AFTER' AS stage,
       column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'students' 
  AND column_name IN ('self_week_completed', 'money_week_completed', 'relationship_week_completed', 'money_unlocked', 'relationship_unlocked')
ORDER BY column_name;

-- 預期：5 row、全 NOT NULL、有 default 0/FALSE
