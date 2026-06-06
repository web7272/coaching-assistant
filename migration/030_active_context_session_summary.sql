-- Migration 030: user_profile_evolution.active_context_session_summary —
-- v5.2 第三塊 PR-a (Vivi 6/5) — per-category cross-session memory bucket.
--
-- 來源: v52_context_anchored_spec §5.2 + Beta feedback #7 (跨天重問同 value/example).
--
-- 為什麼: bug #7 root cause = buildDynamicContext 只 inject「昨天素材」 (last_takeaway
--   _term + daily_takeaways 最後一筆), 沒給 AI「當前 context 內 surface 過的 values +
--   examples 完整清單」 → AI 重問.
-- Fix: per-category JSONB bucket 跨 session 累積, 換領域時自然只讀新 category 的 → 乾淨切換.
--
-- 結構 (per category key, runtime 維護, migration 只開欄):
--   {
--     "3": {                          // active_context_category (1-5)
--       "surfaced_values": ["自由", "被愛"],
--       "surfaced_examples": [ {"day": 1, "value": "自由", "example": "..."}, ... ],
--       "last_updated_day": 5
--     },
--     "1": { ... }
--   }
--
-- 工程鐵則 (Vivi 6/5):
-- - 重用既有 source (values_collected_list / daily_takeaways), NOT Haiku call (成本 0).
-- - 舊 user-level 欄位 (daily_takeaways / values_ranking) 不動 — graduation / journey 仍依賴.
-- - 平滑過渡: 舊累積不遷移進 per-context, fallback 處理 (空 summary → 不 inject).
--
-- 跑這支前確認 migration 序號: 上一支是 029 (students.active_context_*).
--
-- ⚠️ DO NOT RUN AUTOMATICALLY. Vivi 跑 Neon console:
--   psql $DATABASE_URL -f migration/030_active_context_session_summary.sql

DO $$
BEGIN
  RAISE NOTICE '════ MIGRATION 030: UPE.active_context_session_summary (v5.2 第三塊) ════';
END $$;

-- ════════════════════════════════════════════════════════════════
-- 1. BEFORE snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='user_profile_evolution'
          AND column_name='active_context_session_summary') AS summary_col_exists,
       (SELECT COUNT(*) FROM user_profile_evolution) AS total_upe_rows;

-- ════════════════════════════════════════════════════════════════
-- 2. ALTER TABLE (idempotent IF NOT EXISTS, DEFAULT '{}')
-- ════════════════════════════════════════════════════════════════
ALTER TABLE user_profile_evolution
  ADD COLUMN IF NOT EXISTS active_context_session_summary JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ════════════════════════════════════════════════════════════════
-- 3. AFTER snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'AFTER' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='user_profile_evolution'
          AND column_name='active_context_session_summary') AS summary_col_exists,
       (SELECT COUNT(*) FROM user_profile_evolution
        WHERE active_context_session_summary = '{}'::jsonb) AS rows_with_empty_summary;
-- 預期: summary_col_exists=1, rows_with_empty_summary = total_upe_rows
-- (all rows default to empty object — runtime 開始 append 進 per-category).
