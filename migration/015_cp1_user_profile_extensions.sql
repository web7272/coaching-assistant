-- Migration 015: v5.0 CP1 user_profile_evolution 擴充
-- 對齊：
--   docs/v5-spec/engineering/v5_errata_patch_phase_3a_3b_scope_overlap_default.md
--   CP1 turn 3 §15.1 Patrick 接手清單（user-scoped 欄位）
--   lib/session/day-boundary.js（detectNewSessionDay gap_days 計算）
-- 內容：user_profile_evolution 補 3 欄位
--   (1) future_pacing_anchors_collected — CP1 §12.5 Phase 5（3 時間維度 future pacing 收集）
--   (2) export_dissatisfaction          — CP1 §12.5 P24（學員不滿意 export、dashboard 監控）
--   (3) last_active_date                — day-boundary.js gap_days 計算
--       （P0 day-boundary 已假設此欄位、migration 014 漏建、PR-4b 補）
-- 前置：v4.0 migration 010-013 + migration 014（user_profile_evolution 表）已 deploy
-- 全程 idempotent（ADD COLUMN IF NOT EXISTS）、重跑不炸

-- 1. 跑前狀態
SELECT 'BEFORE' AS stage,
       COUNT(*) FILTER (WHERE column_name='future_pacing_anchors_collected') AS fpa_col_exists,
       COUNT(*) FILTER (WHERE column_name='export_dissatisfaction')          AS ed_col_exists,
       COUNT(*) FILTER (WHERE column_name='last_active_date')                AS lad_col_exists,
       COUNT(*)                                                              AS total_cols_before
FROM information_schema.columns
WHERE table_name='user_profile_evolution';

-- 2. ADD future_pacing_anchors_collected（CP1 §12.5 Phase 5、Future Pacing 3 時間維度）
ALTER TABLE user_profile_evolution
  ADD COLUMN IF NOT EXISTS future_pacing_anchors_collected JSONB DEFAULT '[]'::jsonb;

-- 3. ADD export_dissatisfaction（CP1 §12.5 P24、export 不滿意 dashboard 信號）
ALTER TABLE user_profile_evolution
  ADD COLUMN IF NOT EXISTS export_dissatisfaction BOOLEAN DEFAULT false;

-- 4. ADD last_active_date（day-boundary.js gap_days、chat.js v5.0 每 turn 更新）
ALTER TABLE user_profile_evolution
  ADD COLUMN IF NOT EXISTS last_active_date TIMESTAMPTZ;

-- 5. 驗證 3 個新 column
SELECT 'AFTER new columns' AS stage, column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name='user_profile_evolution'
  AND column_name IN ('future_pacing_anchors_collected', 'export_dissatisfaction', 'last_active_date')
ORDER BY column_name;

-- 6. 驗證 user_profile_evolution 總欄位數
SELECT 'AFTER total columns' AS stage, COUNT(*) AS total_cols
FROM information_schema.columns
WHERE table_name='user_profile_evolution';

-- 預期：
--   BEFORE：fpa/ed/lad col_exists 都 0、total_cols_before = 19
--   AFTER new columns 3 rows：
--     export_dissatisfaction           | boolean                     | false        | YES
--     future_pacing_anchors_collected  | jsonb                       | '[]'::jsonb  | YES
--     last_active_date                 | timestamp with time zone    | (null)       | YES
--   AFTER total columns：total_cols = 22（19 + 3）
