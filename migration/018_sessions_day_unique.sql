-- Migration 018: sessions UNIQUE 改 (student_id, module, day) 支援 self-paced 同日多 session row
-- 來源：PR-4c-4e self-paced 步調 — Day N finalize → Day N+1 同日解鎖、每個 day 仍 fresh session row
--
-- 變動：
--   舊 UNIQUE(student_id, module, week, session_date) — v4 的「一個學員每個日曆天一個 session」
--   新 UNIQUE(student_id, module, day)               — v5 的「一個學員每個 v5 day (1-21) 一個 session row」
--
-- chat.js loadOrCreateSession 同 PR 改寫：寫 sessions.day = v5 sessionDay（1-21）、不再 hard-code 1。
-- 影響：self-paced 模式 Day N finalize 後同日 Day N+1 可建新 row（不同 day → 不撞 UNIQUE）。
-- v4 backward compat：v4 index.html 仍寫 day=parseInt(day)||1、現在會撞 UNIQUE 撞重；過渡期 OK（v4 預期不再用）。

-- 1. 跑前檢查：列出現有 sessions UNIQUE 約束
SELECT 'BEFORE' AS stage, conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'sessions'::regclass AND contype = 'u'
ORDER BY conname;

-- 2. DROP 舊 UNIQUE（IF EXISTS 防呆）
ALTER TABLE sessions
  DROP CONSTRAINT IF EXISTS sessions_student_id_module_week_session_date_key;

-- 3. ADD 新 UNIQUE
ALTER TABLE sessions
  ADD CONSTRAINT sessions_student_id_module_day_key
  UNIQUE (student_id, module, day);

-- 4. 跑後驗證
SELECT 'AFTER' AS stage, conname, pg_get_constraintdef(oid) AS def
FROM pg_constraint
WHERE conrelid = 'sessions'::regclass AND contype = 'u'
ORDER BY conname;
-- 預期：只剩 sessions_student_id_module_day_key UNIQUE (student_id, module, day)
