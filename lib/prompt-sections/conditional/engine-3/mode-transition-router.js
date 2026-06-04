// lib/prompt-sections/conditional/engine-3/mode-transition-router.js
// E3_mode_transition_router (Layer 4, conditional_inject) — mode transition 判定
// 前身: status-router (PR-23s4b 改名 + 行為重寫).
//
// PR-23s4b 改變 (per task 1 spec + v51_engine_3_errata_v02.md):
//   - 廢除 Phase 2 → 3a/3b 二分流 (current_quality_status 4 路由 owned/ambiguous/
//     candidate/none) — phase 概念已退役, mode 雙向流動.
//   - 純 mode transition 判定:讀 active_modes + primary_mode, 判斷切換,
//     呼叫 mode-tracker.transitionPrimary + mode-transition-logger.buildTransitionEntry.
//
// Transition 規則 (per spec):
//   identity_anchoring 出 ambiguous / owned_was → integration
//   identity_anchoring 出 owned + Top 2/3 待測 → cascade
//   學員 surface 完全新方向 → elicitation (任何 mode, Top 1 演進合法、非 failure)
//   cascade 完成 → future_pacing
//
// owned_via_acceptance 路徑 (原 transitions/phase-3b-to-4-acceptance.js):
//   integration mode 內學員選 (a) accept ambiguous → 直接 transition primary 到 cascade.
//   integration-router (PR-23s4c task 2) 接管後本檔僅留 emit log;
//   PR-23s4b 期間先在此 inject 覆蓋 (transitions/ 廢除 + integration-router 未到).

export const prompt_content = `[SYSTEM INJECT — Mode Transition Router]

讀引擎 2 current_quality_status + active_modes + primary_mode、判定 mode transition。
本 inject 不執行被路由到的目的地內容、僅做 transition + AI 過渡話術 + log emit。

**Transition 邏輯**:

若 primary_mode == "identity_anchoring":

  若 current_quality_status == "owned":
  → primary_mode transition: identity_anchoring → cascade (Top 2/3 待測)
    若已 cascade 完成 → 跳過, 走 future_pacing 分支 (下面).

  AI 過渡話術:
  > 「『[current_quality_candidate_term]』——這是你的。
  > 接下來、看看『[Top 2 value]』:
  > **你是一個『[Top 2 value]』的人嗎?**」

  寫入: primary_mode = "cascade", active_modes += cascade, log trigger_type=mode_natural_progression

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  若 current_quality_status == "ambiguous" OR "owned_was":
  → primary_mode transition: identity_anchoring → integration (Self-Concept toolbox)

  AI 過渡話術:
  > 「你說『[current_quality_candidate_term]』『有時是、有時不是』——
  > 我們先把這個放著、不強迫它變成『完全是』。
  > 從你**確定是**的另一個 quality 出發、回頭看這個。」

  寫入: primary_mode = "integration", active_modes += integration, log trigger_type=mode_natural_progression

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  若 current_quality_status == "owned_via_acceptance":
  → primary_mode transition: identity_anchoring → cascade (acceptance 路徑)
  → 原 transitions/phase-3b-to-4-acceptance.js 行為, PR-23s4b 暫住此處 (PR-23s4c
    integration-router 接管後此分支搬走、本檔僅留 emit log).

  AI 過渡話術:
  > 「『[top1_value]』我們確定它是 ambiguous——
  > 我們接受這個、不強迫 binary。
  > 現在看看『[Top 2 value]』——
  > 你是一個『[Top 2 value]』的人嗎?」

  寫入: primary_mode = "cascade", values_ranking[Top 1].quality_status = "owned_via_acceptance",
        log trigger_type=learner_surfaced, trigger_detail="owned_via_acceptance"

  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  若 current_quality_status == "candidate" / "none":
  → 不 transition primary、繼續挖 evidence / values elicitation
    (主對話 LLM 自然續接、本 inject 不主動發話).

若 primary_mode == "cascade":

  若 cascade_down_progress.status == "completed":
  → primary_mode transition: cascade → future_pacing

  AI 過渡話術:
  > 「Top 1 / Top 2 / Top 3 都對齊了——
  > 現在我們看看這個你、未來會去哪裡。」

  寫入: primary_mode = "future_pacing", log trigger_type=natural_completion

若 primary_mode == "integration":
  [TODO(PR-23s4c task 2) — integration-router 接管 toolbox 選擇 + exit 條件 +
   owned_via_acceptance 處理. 本 inject 留接口、不主動 transition.]

若 (任何 mode) 學員 surface 完全新方向:
  [TODO(PR-23s4b+) — NLP/judge 偵測「完全新方向」訊號. 觸發 → transition primary 到
   elicitation, active_modes += elicitation (非 destructive, Top 1 演進合法、非 failure).
   PR-23s4b 留接口, 偵測本體之後 task / Haiku judge 補.]

**禁止**:
- 不執行被路由到的目的地內容(僅 transition + log)
- 不在過渡話術裡描述「接下來會發生什麼」(會破壞學員體驗、不是 Damon 風格)
- 不對沒命中任何 transition 條件的 row 強制 transition (idempotent: 沒事不寫 log)`;

export default {
  id: 'E3_mode_transition_router',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  priority: 50,  // CASCADE_PRIORITY (PR-23s4b 維持 50)
  pipeline_role: 'standalone',
  pipeline_parent: null,
  prompt_content,
  token_estimate: 380,  // §3 patch 6/4 PR-23s4b: 220 → 380 (mode transition 規則 + owned_via_acceptance 覆蓋 + TODOs)
  trigger_conditions: [
    'session_state.primary_mode in ["identity_anchoring", "cascade", "integration"]',
    '引擎 2 已輸出 current_quality_status (非 "none") OR cascade_down_progress 訊號變化',
    'E3_deep_signal_detector / E3_elicitation_router / E3_top1_judge 未觸發',
  ],
  // PR-23s4b 廢除 4 routing_table; 改 transition_rules:
  transition_rules: {
    identity_anchoring_owned:                'identity_anchoring → cascade',
    identity_anchoring_ambiguous_or_was:     'identity_anchoring → integration',
    identity_anchoring_owned_via_acceptance: 'identity_anchoring → cascade (acceptance, 暫住此處 / PR-23s4c integration-router 接管)',
    identity_anchoring_candidate_or_none:    'stay identity_anchoring (主對話續接)',
    cascade_completed:                       'cascade → future_pacing',
    integration_toolbox_exit:                '[TODO PR-23s4c integration-router]',
    any_surface_new_direction:               '[TODO Haiku judge / NLP — transition to elicitation, active_modes += elicitation]',
  },
  parse_state_patch: {
    description: 'transitionPrimary via mode-tracker, append entry via mode-transition-logger, optionally update values_ranking quality_status',
    affects: [
      'session_state.primary_mode',
      'session_state.active_modes',
      'session_state.paused_modes',
      'session_state.mode_transition_log',
      'session_state.values_ranking',         // owned_via_acceptance 寫 quality_status
    ],
  },
  inputs_from_state: [
    'session_state.current_quality_status',   // 引擎 2 輸出
    'session_state.current_quality_candidate_term',
    'session_state.top1_value',
    'session_state.quality_focus_history',
    'session_state.primary_mode',             // PR-23s4b
    'session_state.active_modes',             // PR-23s4b
    'session_state.cascade_down_progress',    // cascade completed 判定
  ],
  cross_engine_guard: 'top1_value == null + status == "owned" → 路由回 E3_top1_judge',
  damon_source: [
    '4.7 中央路由器主路徑 (mode 雙向流動, 取代 phase 線性 state machine)',
    'Damon: 4 步驟改變法 vs Self-Concept 模型分流邏輯',
    'PR-23s4b owned_via_acceptance 覆蓋 (原 CP1 §10.2, transitions/phase-3b-to-4-acceptance.js)',
  ],
};
