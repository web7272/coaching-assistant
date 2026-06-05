-- migration/028_v51_s6_modal_operator_count.sql
-- v5.1 Step 7 PR-7b — S6 modal_operator_signals cumulative count.
--
-- 對齊 v51_errata_v02_damon_supplementary_tier1_tier2.md §5.3 (Patch 5.3):
--   S6 Modal Operators (應該/必須/一定要) = External Locus 弱訊號 marker.
--   cross-session 累積 >= 5 → 引擎 3 評估 External Locus pattern 確立.
--
-- 欄位語意:
--   modal_operator_signals_count_cumulative — int, 跨 session 累積 S6 命中次數.
--   引擎 3 pattern detection threshold = 5 (per spec).
--   永不 reset (跨 program 累積). dashboard 監控用.
--
-- 安全:
--   IF NOT EXISTS 防重跑.
--   DEFAULT 0 確保既有 row 不會 NULL.
--   NOT NULL 由 default 推導.
--
-- ⚠️ DO NOT RUN AUTOMATICALLY. Vivi 跑 Neon console:
--   psql $DATABASE_URL -f migration/028_v51_s6_modal_operator_count.sql

-- ════════════════════════════════════════════════════════════════
-- 1. BEFORE snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='user_profile_evolution'
          AND column_name='modal_operator_signals_count_cumulative') AS s6_count_col_exists;

-- ════════════════════════════════════════════════════════════════
-- 2. ALTER TABLE
-- ════════════════════════════════════════════════════════════════
ALTER TABLE user_profile_evolution
  ADD COLUMN IF NOT EXISTS modal_operator_signals_count_cumulative INT NOT NULL DEFAULT 0;

-- ════════════════════════════════════════════════════════════════
-- 3. AFTER snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'AFTER' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='user_profile_evolution'
          AND column_name='modal_operator_signals_count_cumulative') AS s6_count_col_exists;
-- 預期: s6_count_col_exists = 1.
