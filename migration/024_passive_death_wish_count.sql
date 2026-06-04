-- migration/024_passive_death_wish_count.sql
-- Patch #23 (Vivi 6/4) — passive death wish cross-session counter
--
-- 動機 (A006 Beta 觀察):
--   Day 1 漏接 passive death wish 訊號 (「上天既然讓我活著、應該是有什麼事
--   等待我去完成」) → AI 繼續挖 values 挖到 Landmine value「被需要」;
--   Day 2 學員直白「我是真的不想活下去」才 handoff. 跨 session 累積訊號需要
--   被持久化追蹤、單純 session_state JSONB 不夠 (per-session 重置).
--
-- 欄位語意:
--   passive_death_wish_count — 跨 session 累積學員命中 passive DW 訊號的次數.
--   永不 reset (跨 program 累積). 用途:
--     - count >= 3 → E3 deep signal handler 切到變體 C-3 (移除三選一中的 (c))
--     - count >= 5 → freeze AI 推進 + HITL alert Vivi (lib/state/handoff-
--                    escalation.js PASSIVE_DW_FREEZE_THRESHOLD)
--     - dashboard cross_session_accumulation histogram
--
-- 安全:
--   IF NOT EXISTS 防重跑.
--   DEFAULT 0 確保既有 row 不會 NULL.
--   NOT NULL 由 default 推導、保證 handler 讀到都是 number.
--
-- ⚠️ DO NOT RUN AUTOMATICALLY. Vivi 跑 Neon console:
--   psql $DATABASE_URL -f migration/024_passive_death_wish_count.sql
--   或 Neon SQL Editor 貼上下面整段.

ALTER TABLE user_profile_evolution
  ADD COLUMN IF NOT EXISTS passive_death_wish_count INT NOT NULL DEFAULT 0;

-- Verify (跑完用、看看現有 row 都拿到 0):
-- SELECT student_id, passive_death_wish_count
--   FROM user_profile_evolution
--   ORDER BY student_id;
