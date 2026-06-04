-- migration/025_v51_mode_schema.sql
-- v5.1 Step 3 (Vivi 6/4) — mode schema + in-progress session 映射
--
-- 對齊:
--   Checkpoint 1 v2 §16.1 (mode_history / crisis_state_carry_forward / crisis_history)
--   v51 engine 3 errata Patch 5 §5.2 (router_phase → primary_mode 對映表)
--   Patrick ack 設計師 6/4: session-scoped 全走 session_state JSONB key,
--     user-scoped 才加 user_profile_evolution 欄. 設計師已接受工程端調整.
--
-- 動機:
--   v5.1 廢 phase 改 mode. 既有 in-progress session 跑在 v5.0 (router_phase /
--   current_phase / phase_progress), 換 runtime (Step 4) 之前要先把 schema 開出
--   來 + in-progress session_state 對映過去, 避免換 runtime 時學員「斷掉感」
--   (失敗訊號 2). 部署順序: 本 migration 先跑 → runtime 仍 v5.0 → 空窗期內
--   新產生的 session 沒 mode keys 但被 read-time fallback 補上 → Step 4 換
--   runtime 後 mode-tracker 主寫 + fallback 處理空窗 row.
--
-- 變動範圍:
--   user_profile_evolution: +3 cols (mode_history / crisis_state_carry_forward
--                                   / crisis_history)
--   sessions.session_state: +5 JSONB keys (active_modes / primary_mode /
--                                   paused_modes / mode_transition_log /
--                                   crisis_in_progress)
--   sessions: +1 index (primary_mode)
--
-- 不動 (deprecated 保留, rollback 安全, Step 4 穩定後另開 cleanup migration):
--   user_profile_evolution.phase_history
--   sessions.session_state.current_phase / router_phase / phase_progress
--   既有 idx_sessions_state_phase
--   migrations 014-024
--
-- 安全:
--   全部 ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS (防重跑).
--   session_state mapping 用「NOT session_state ? 'primary_mode'」 guard (idempotent).
--   mode_history backfill 用「mode_history = '[]'」 guard (idempotent, 不覆蓋已寫資料).
--   NOT NULL 配 DEFAULT 保證既有 row 不會留 NULL.
--
-- ⚠️ DO NOT RUN AUTOMATICALLY. Vivi 跑 Neon console:
--   psql $DATABASE_URL -f migration/025_v51_mode_schema.sql
--   或 Neon SQL Editor 貼上整段.
--
-- ⚠️ Vivi 跑 025 之前, 建議先跑「跑前盤點 SQL」(本檔 1. 段) 看 router_phase /
--   current_phase 分布. 如果有 router_phase 缺失但 current_phase 有值的 row,
--   Patrick 評估是否需要次選映射 (見本檔 6. 段 commented alternative).
--
-- 部署順序:
--   1. 本 migration 025 跑 (本 step)
--   2. Runtime 仍是 v5.0 (phase-machine.js 還在寫 router_phase).
--      空窗期內新產生的 session 不會有 mode keys → Step 4 的 mode-tracker
--      必須有 read-time fallback (讀不到 primary_mode → 即時用 5. 段對映表
--      derive). 這條已 ack Patrick 寫進 Step 4 任務.
--   3. Step 4 換 runtime (mode-tracker.js + 引擎 3 重構).
--   4. Step N (穩定後) cleanup migration: drop phase_history / current_phase /
--      router_phase / phase_progress / idx_sessions_state_phase.

-- ════════════════════════════════════════════════════════════════
-- 1. 跑前盤點 — Vivi 跑 025 之前先跑這段, 報結果給 Patrick
-- ════════════════════════════════════════════════════════════════
-- 1a. user_profile_evolution: phase_history 分布
-- SELECT
--   COUNT(*) AS total_rows,
--   COUNT(*) FILTER (WHERE phase_history IS NOT NULL)         AS with_phase_history,
--   COUNT(*) FILTER (WHERE phase_history IS NULL)             AS without_phase_history,
--   COUNT(*) FILTER (WHERE jsonb_typeof(phase_history) = 'array'
--                    AND jsonb_array_length(phase_history) > 0) AS nonempty_phase_history
-- FROM user_profile_evolution;
--
-- 1b. sessions.session_state: router_phase / current_phase 兩欄分布
-- SELECT
--   CASE
--     WHEN session_state ? 'router_phase' AND session_state ? 'current_phase' THEN 'both'
--     WHEN session_state ? 'router_phase'                                      THEN 'router_only'
--     WHEN session_state ? 'current_phase'                                     THEN 'current_only'
--     ELSE 'neither'
--   END AS state_shape,
--   day_complete,
--   COUNT(*) AS n
-- FROM sessions
-- GROUP BY 1, 2
-- ORDER BY day_complete, n DESC;
--
-- 1c. In-progress (day_complete=FALSE) router_phase 值分布 (確認對映表覆蓋率)
-- SELECT
--   session_state->>'router_phase' AS router_phase,
--   COUNT(*) AS n
-- FROM sessions
-- WHERE day_complete = FALSE
--   AND session_state ? 'router_phase'
-- GROUP BY 1
-- ORDER BY n DESC;
-- 預期值: opening / elicitation / top1_determination / identity_test_routing /
--        cascade_down / deep_signal_handoff / completed
-- 如果出現本檔 5. 段 ELSE 接到的「其他值」, 評估是否需要擴對映表.

-- ════════════════════════════════════════════════════════════════
-- 2. BEFORE state snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='user_profile_evolution'
          AND column_name='mode_history') AS upe_mode_history_col_exists,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='user_profile_evolution'
          AND column_name='crisis_state_carry_forward') AS upe_crisis_carry_col_exists,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='user_profile_evolution'
          AND column_name='crisis_history') AS upe_crisis_history_col_exists,
       (SELECT COUNT(*) FROM pg_indexes
        WHERE indexname='idx_sessions_state_primary_mode') AS primary_mode_idx_exists;

-- ════════════════════════════════════════════════════════════════
-- 3. user_profile_evolution: 加 3 個新欄位
-- ════════════════════════════════════════════════════════════════
-- mode_history: 跨 session 累積 mode 進入/離開 / 完成記錄 (取代 phase_history).
--   Element schema (Step 6 runtime 寫): { mode, entered_at, completed_at, ... }
--   先開欄, 從 phase_history backfill 後讓 Step 4 mode-tracker 接管寫入.
ALTER TABLE user_profile_evolution
  ADD COLUMN IF NOT EXISTS mode_history JSONB NOT NULL DEFAULT '[]'::jsonb;

-- crisis_state_carry_forward: 跨 session crisis 未解狀態. nullable (null = 無未解).
--   Schema (Step 6 runtime 寫, 對齊 Checkpoint 1 v2 §10.5):
--     { crisis_triggered_at, crisis_category, handoff_choice,
--       protective_factor_surfaced, si_risk_level, safety_plan,
--       next_session_focus, resolved_at, resolution_type }
ALTER TABLE user_profile_evolution
  ADD COLUMN IF NOT EXISTS crisis_state_carry_forward JSONB;

-- crisis_history: 跨 session crisis events 歷史 append 記錄. §10.5 reset_on 段.
ALTER TABLE user_profile_evolution
  ADD COLUMN IF NOT EXISTS crisis_history JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ════════════════════════════════════════════════════════════════
-- 4. user_profile_evolution: backfill mode_history ← phase_history
-- ════════════════════════════════════════════════════════════════
-- Idempotent guard: 只更新 mode_history 還是 default '[]' 的 row.
-- phase_history 不動 (保留 deprecated, rollback 安全).
UPDATE user_profile_evolution
   SET mode_history = phase_history,
       updated_at   = now()
 WHERE phase_history IS NOT NULL
   AND jsonb_typeof(phase_history) = 'array'
   AND mode_history = '[]'::jsonb;

-- ════════════════════════════════════════════════════════════════
-- 5. sessions.session_state: in-progress session 映射 router_phase → mode keys
-- ════════════════════════════════════════════════════════════════
-- 對映表 (v51 engine 3 errata Patch 5 §5.2):
--   router_phase             → primary_mode            active_modes              crisis_in_progress
--   ─────────────────────────────────────────────────────────────────────────────────────────────
--   opening                  → elicitation             ["elicitation"]           false
--   elicitation              → elicitation             ["elicitation"]           false
--   top1_determination       → elicitation             ["elicitation"]           false
--   identity_test_routing    → identity_anchoring      ["identity_anchoring"]    false
--   cascade_down             → cascade                 ["cascade"]               false
--   deep_signal_handoff      → crisis                  ["crisis"]                true
--   completed                → future_pacing           ["future_pacing"]         false
--   (其他 / ELSE)            → elicitation             ["elicitation"]           false
--
-- Idempotent guard: 跳過已映射 row (primary_mode 已存在). 重跑無變化.
-- 不動: current_phase / router_phase / phase_progress (deprecated 保留).
UPDATE sessions
   SET session_state = session_state || jsonb_build_object(
         'active_modes', CASE session_state->>'router_phase'
             WHEN 'opening'               THEN '["elicitation"]'::jsonb
             WHEN 'elicitation'           THEN '["elicitation"]'::jsonb
             WHEN 'top1_determination'    THEN '["elicitation"]'::jsonb
             WHEN 'identity_test_routing' THEN '["identity_anchoring"]'::jsonb
             WHEN 'cascade_down'          THEN '["cascade"]'::jsonb
             WHEN 'deep_signal_handoff'   THEN '["crisis"]'::jsonb
             WHEN 'completed'             THEN '["future_pacing"]'::jsonb
             ELSE '["elicitation"]'::jsonb
           END,
         'primary_mode', CASE session_state->>'router_phase'
             WHEN 'identity_test_routing' THEN 'identity_anchoring'
             WHEN 'cascade_down'          THEN 'cascade'
             WHEN 'deep_signal_handoff'   THEN 'crisis'
             WHEN 'completed'             THEN 'future_pacing'
             ELSE 'elicitation'
           END,
         'paused_modes',         '[]'::jsonb,
         'mode_transition_log',  '[]'::jsonb,
         'crisis_in_progress',   to_jsonb(session_state->>'router_phase' = 'deep_signal_handoff')
       ),
       updated_at = now()
 WHERE session_state ? 'router_phase'
   AND NOT session_state ? 'primary_mode';

-- ════════════════════════════════════════════════════════════════
-- 6. (Commented alternative — 次選映射 from current_phase)
-- ════════════════════════════════════════════════════════════════
-- ⚠️ 1c 段盤點若顯示有 current_only row 需要映射, 跑 Patrick 評估後再 uncomment.
-- 對映表 (current_phase → mode, 推測, 待 Vivi 確認):
--   phase_1   → elicitation
--   phase_2   → elicitation
--   phase_3a  → identity_anchoring
--   phase_3b  → cascade
--   phase_4   → identity_anchoring
--   phase_5   → future_pacing
--   integration_retention → future_pacing
--   program_completed     → future_pacing
--
-- UPDATE sessions
--    SET session_state = session_state || jsonb_build_object(
--          'active_modes', CASE session_state->>'current_phase'
--              WHEN 'phase_1'                THEN '["elicitation"]'::jsonb
--              WHEN 'phase_2'                THEN '["elicitation"]'::jsonb
--              WHEN 'phase_3a'               THEN '["identity_anchoring"]'::jsonb
--              WHEN 'phase_3b'               THEN '["cascade"]'::jsonb
--              WHEN 'phase_4'                THEN '["identity_anchoring"]'::jsonb
--              WHEN 'phase_5'                THEN '["future_pacing"]'::jsonb
--              WHEN 'integration_retention'  THEN '["future_pacing"]'::jsonb
--              WHEN 'program_completed'      THEN '["future_pacing"]'::jsonb
--              ELSE '["elicitation"]'::jsonb
--            END,
--          'primary_mode', CASE session_state->>'current_phase'
--              WHEN 'phase_3a'               THEN 'identity_anchoring'
--              WHEN 'phase_3b'               THEN 'cascade'
--              WHEN 'phase_4'                THEN 'identity_anchoring'
--              WHEN 'phase_5'                THEN 'future_pacing'
--              WHEN 'integration_retention'  THEN 'future_pacing'
--              WHEN 'program_completed'      THEN 'future_pacing'
--              ELSE 'elicitation'
--            END,
--          'paused_modes',         '[]'::jsonb,
--          'mode_transition_log',  '[]'::jsonb,
--          'crisis_in_progress',   false
--        ),
--        updated_at = now()
--  WHERE session_state ? 'current_phase'
--    AND NOT session_state ? 'router_phase'
--    AND NOT session_state ? 'primary_mode';

-- ════════════════════════════════════════════════════════════════
-- 7. Index: primary_mode (新, 不刪舊 phase index)
-- ════════════════════════════════════════════════════════════════
CREATE INDEX IF NOT EXISTS idx_sessions_state_primary_mode
  ON sessions ((session_state->>'primary_mode'));

-- idx_sessions_state_phase 保留 — v5.0 程式碼還在跑、Step 4 完成後 cleanup 一起 drop.

-- ════════════════════════════════════════════════════════════════
-- 8. AFTER state snapshot — 確認 migration 套用成功
-- ════════════════════════════════════════════════════════════════
SELECT 'AFTER' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='user_profile_evolution'
          AND column_name='mode_history') AS upe_mode_history_col_exists,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='user_profile_evolution'
          AND column_name='crisis_state_carry_forward') AS upe_crisis_carry_col_exists,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='user_profile_evolution'
          AND column_name='crisis_history') AS upe_crisis_history_col_exists,
       (SELECT COUNT(*) FROM pg_indexes
        WHERE indexname='idx_sessions_state_primary_mode') AS primary_mode_idx_exists;
-- 全部欄位應該 = 1, index = 1.

-- 8a. session_state 映射 spot check (in-progress only):
SELECT
  session_state->>'router_phase'  AS router_phase,
  session_state->>'primary_mode'  AS primary_mode,
  session_state->>'crisis_in_progress' AS crisis_in_progress,
  COUNT(*) AS n
FROM sessions
WHERE day_complete = FALSE
  AND session_state ? 'router_phase'
GROUP BY 1, 2, 3
ORDER BY n DESC;
-- 預期: 每一 row 的 (router_phase, primary_mode) pair 都對齊 5. 段對映表.
--      crisis_in_progress = true 只在 router_phase = 'deep_signal_handoff' 出現.

-- 8b. mode_history backfill spot check:
SELECT
  COUNT(*)                                                    AS upe_total,
  COUNT(*) FILTER (WHERE mode_history != '[]'::jsonb)         AS with_mode_history,
  COUNT(*) FILTER (WHERE mode_history = '[]'::jsonb
                   AND phase_history IS NOT NULL
                   AND phase_history != '[]'::jsonb)          AS backfill_missed
FROM user_profile_evolution;
-- backfill_missed 應該 = 0.
