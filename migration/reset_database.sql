-- ===================================================================
-- Reset 工具：清空資料庫所有測試資料（保留 schema）
-- 用途：dev 階段隨時重置測試環境
-- ⚠️ 不可還原（除非 Neon PITR），跑之前確認真的要清
-- ===================================================================

-- 跑之前先看現在有多少資料（先了解狀況再決定要不要清）
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM students) AS students,
       (SELECT COUNT(*) FROM sessions) AS sessions,
       (SELECT COUNT(*) FROM messages) AS messages;

-- 清空三個表，重置 id 自增，自動處理 foreign key
TRUNCATE TABLE messages, sessions, students RESTART IDENTITY CASCADE;

-- 跑完之後驗證：三個表都應該是 0 筆
SELECT 'AFTER' AS stage,
       (SELECT COUNT(*) FROM students) AS students,
       (SELECT COUNT(*) FROM sessions) AS sessions,
       (SELECT COUNT(*) FROM messages) AS messages;
