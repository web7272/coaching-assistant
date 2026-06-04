-- migration/026_v51_engine1_signal_counts.sql
-- v5.1 Step 5a (Vivi 6/4) — 引擎 1 五個訊號類型 cross-session 累積 counters.
--
-- 對齊: v51_engine_1_errata.md §A4 + repo 慣例 (session-scoped 走 session_state
--   JSONB, cross-session 才加 user_profile_evolution 欄).
--
-- 動機 (26 gap 訊號層延伸 + A006/A003 Beta 觀察):
--   引擎 1 加 5 個訊號類型 S1-S5, 對應 26 gap 訊號層. 偵測 + flags 走 session_state
--   JSONB (per-turn / per-session 重置). 但跨 session 累積分析需要持久化:
--     - external_locus 累積 >= 20 → HITL alert
--     - passive_hope 累積 >= 15 → 引擎 3 評估 flag
--     - conditional_worth 累積 >= 10 → Bargain pattern flag, HITL note
--     - negative_generalization 累積 >= 12 → HITL alert
--     - frequency_illusion: session 內 R7 強制 priority, 不需 cumulative (但保欄位
--       備 dashboard analytics 用).
--
-- 欄位語意:
--   {signal}_signals_count_cumulative — 跨 session 累積學員命中該 signal 的次數.
--   永不 reset (跨 program 累積). 用途 per signal threshold 觸發 (見 lib/detector-
--   handlers/engine-1-signals/_base.js THRESHOLDS).
--
-- 安全:
--   IF NOT EXISTS 防重跑.
--   DEFAULT 0 確保既有 row 不會 NULL.
--   NOT NULL 由 default 推導、保證 handler 讀到都是 number.
--
-- ⚠️ DO NOT RUN AUTOMATICALLY. Vivi 跑 Neon console:
--   psql $DATABASE_URL -f migration/026_v51_engine1_signal_counts.sql
--   或 Neon SQL Editor 貼上下面整段.

-- ════════════════════════════════════════════════════════════════
-- 1. BEFORE state snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='user_profile_evolution'
          AND column_name LIKE '%_signals_count_cumulative') AS signal_count_cols_existing;

-- ════════════════════════════════════════════════════════════════
-- 2. ALTER TABLE user_profile_evolution — 加 5 欄
-- ════════════════════════════════════════════════════════════════
ALTER TABLE user_profile_evolution
  ADD COLUMN IF NOT EXISTS external_locus_signals_count_cumulative          INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS passive_hope_signals_count_cumulative             INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS frequency_illusion_signals_count_cumulative       INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conditional_worth_signals_count_cumulative        INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS negative_generalization_signals_count_cumulative  INT NOT NULL DEFAULT 0;

-- ════════════════════════════════════════════════════════════════
-- 3. AFTER state — 確認 5 欄都加好
-- ════════════════════════════════════════════════════════════════
SELECT 'AFTER' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='user_profile_evolution'
          AND column_name LIKE '%_signals_count_cumulative') AS signal_count_cols;
-- 預期: signal_count_cols = 5.

-- 3a. 分布 sanity (預期既有 row 全部 = 0):
-- SELECT
--   AVG(external_locus_signals_count_cumulative)         AS avg_external_locus,
--   AVG(passive_hope_signals_count_cumulative)            AS avg_passive_hope,
--   AVG(frequency_illusion_signals_count_cumulative)      AS avg_frequency_illusion,
--   AVG(conditional_worth_signals_count_cumulative)       AS avg_conditional_worth,
--   AVG(negative_generalization_signals_count_cumulative) AS avg_negative_gen,
--   COUNT(*) AS total_rows
-- FROM user_profile_evolution;
