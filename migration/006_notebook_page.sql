-- Migration 006: 新增 sessions.notebook_page 欄位
-- 目的：D2 設計落地、儲存 Vivi 教練筆記本（second-pass 改寫的 fullNote 改寫成學員看的敘事版）
-- 日期：2026-05-10
-- 對齊：docs/v3.0/05-D2_design_spec.md / docs/v3.0/06-chat_v30_spec.md Part 3

-- 1. 跑前檢查當前狀態
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name = 'sessions' AND column_name = 'notebook_page') AS notebook_page_exists,
       (SELECT COUNT(*) FROM sessions) AS sessions_count;

-- 2. 新增欄位
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS notebook_page TEXT NULL;

-- 3. 既有欄位保留向後相容
-- damon_note 不動（後台 fullNote、教練看）
-- damon_note_public 不 drop（v2.6 minimal、向後相容、新版前端不讀）
-- notebook_page 新欄位（v3.0、Vivi 教練筆記本、學員看）

-- 4. 跑後驗證
SELECT 'AFTER' AS stage,
       column_name,
       data_type,
       is_nullable
FROM information_schema.columns
WHERE table_name = 'sessions'
  AND column_name IN ('damon_note', 'damon_note_public', 'notebook_page')
ORDER BY column_name;

-- 預期：3 row
-- damon_note         | text | YES
-- damon_note_public  | text | YES
-- notebook_page      | text | YES
