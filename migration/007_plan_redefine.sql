-- Migration 007: 重新定義 students.plan 列舉（PRODUCT-TRUTH v1.3 雙方案）
-- 對齊：v3.0 雙方案、trial / plan_a (NT$3,000 自我關係版) / plan_b (NT$4,500 完整版)
-- 日期：2026-05-10
--
-- mapping（Vivi 給的）：
--   trial             → trial
--   self_only         → plan_a
--   self_money        → plan_b
--   self_relationship → plan_b
--   all               → plan_b
--
-- 既有 schema：plan VARCHAR、無 CHECK constraint（information_schema 已驗過）

-- 1. 跑前狀態
SELECT 'BEFORE' AS stage, plan, COUNT(*) AS n
FROM students GROUP BY plan ORDER BY plan;

-- 2. 把舊值 remap 成新值（idempotent、可重跑）
UPDATE students SET plan = 'plan_a' WHERE plan = 'self_only';
UPDATE students SET plan = 'plan_b' WHERE plan IN ('all', 'self_money', 'self_relationship');

-- 3. 加 CHECK constraint（先 DROP IF EXISTS、再 ADD、整段 idempotent）
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_plan_check;
ALTER TABLE students ADD CONSTRAINT students_plan_check CHECK (plan IN ('trial', 'plan_a', 'plan_b'));

-- 4. 跑後驗證
SELECT 'AFTER plans' AS stage, plan, COUNT(*) AS n
FROM students GROUP BY plan ORDER BY plan;

SELECT 'AFTER constraint' AS stage, conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'students'::regclass AND contype = 'c';

-- 預期：
-- AFTER plans      → 只剩 trial / plan_a / plan_b 之一
-- AFTER constraint → students_plan_check 出現、CHECK ((plan IN ('trial','plan_a','plan_b')))
