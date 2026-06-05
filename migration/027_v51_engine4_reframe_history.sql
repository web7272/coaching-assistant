-- migration/027_v51_engine4_reframe_history.sql
-- v5.1 Step 5c errata Patch 4 (Vivi 6/4) — cross-session reframe invocation history.
--
-- 對齊 v51_engine_4_errata.md §A4 + repo 慣例 (session-scoped 走 session_state
-- JSONB, cross-session 才加 user_profile_evolution 欄).
--
-- 動機:
--   Reframe Library (Step 7) 將實作 R1-R7 reframe invocation. 每次 invoke 都
--   寫進當 session 的 last_session_day_summary.reframe_invocation_history_in_session
--   (per-session JSONB), session close 時 append 到 user_profile_evolution.
--   reframe_invocation_history (cross-session) — 追蹤學員整個 program 的
--   reframe 使用 pattern + dashboard analytics.
--
-- 欄位語意:
--   reframe_invocation_history — array of:
--     { reframe_id: 'R1'..'R7', invoked_at_turn: int, session_id: int,
--       outcome: 'success'|'partial'|'no_change', anchor_phrase_if_success: string|null,
--       invoked_at: ISO timestamp }
--   永不 reset (跨 program 累積). dashboard ingest @ Step 8.
--
-- 安全:
--   IF NOT EXISTS 防重跑.
--   DEFAULT '[]' 確保既有 row 不會 NULL.
--   NOT NULL 由 default 推導.
--
-- ⚠️ DO NOT RUN AUTOMATICALLY. Vivi 跑 Neon console:
--   psql $DATABASE_URL -f migration/027_v51_engine4_reframe_history.sql

-- ════════════════════════════════════════════════════════════════
-- 1. BEFORE snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='user_profile_evolution'
          AND column_name='reframe_invocation_history') AS reframe_hist_col_exists;

-- ════════════════════════════════════════════════════════════════
-- 2. ALTER TABLE
-- ════════════════════════════════════════════════════════════════
ALTER TABLE user_profile_evolution
  ADD COLUMN IF NOT EXISTS reframe_invocation_history JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ════════════════════════════════════════════════════════════════
-- 3. AFTER snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'AFTER' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='user_profile_evolution'
          AND column_name='reframe_invocation_history') AS reframe_hist_col_exists;
-- 預期: reframe_hist_col_exists = 1.
