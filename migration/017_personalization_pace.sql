-- Migration 017: PR-4c-4e personalization (preferred_name) + pace selection
-- 來源：A001 親測批次 — Vivi 拍板 wording / 入口同頁 / daily 預設
--
-- preferred_name TEXT     —「我可以怎麼稱呼你？」、用在「{preferredName} 的旅程」+
--                          generateNotebookPage 第二人稱「你」內偶用增暖
-- pace TEXT NOT NULL DEFAULT 'daily'
--   'daily'      預設、推薦 —「一天一次：每天留十分鐘，讓今天的看見沉澱一晚」
--   'self-paced' —「依自己的步調：想連著多走幾天也可以」
--
-- ⚠️ 覆寫 UI §六「不顯示名字」紅線：Vivi 刻意拍板（擁有感）。
--    只用 preferredName、不做「歡迎回來」SaaS 問候。

-- 1. 跑前檢查
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name = 'students'
          AND column_name IN ('preferred_name', 'pace')) AS existing_count;

-- 2. 新增欄位
ALTER TABLE students
  ADD COLUMN IF NOT EXISTS preferred_name TEXT,
  ADD COLUMN IF NOT EXISTS pace TEXT NOT NULL DEFAULT 'daily';

-- 3. CHECK 約束（合法值：daily / self-paced）
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_pace_check;
ALTER TABLE students ADD CONSTRAINT students_pace_check
  CHECK (pace IN ('daily', 'self-paced'));

-- 4. 跑後驗證
SELECT 'AFTER' AS stage, column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'students'
  AND column_name IN ('preferred_name', 'pace')
ORDER BY column_name;
-- 預期：2 row：preferred_name (text, null, YES), pace (text, 'daily'::text, NO)

SELECT 'CHECK' AS stage, conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'students'::regclass AND conname = 'students_pace_check';
-- 預期：CHECK (pace IN ('daily', 'self-paced'))
