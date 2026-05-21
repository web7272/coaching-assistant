// lib/prompt-sections/conditional/engine-3/status-router.js
// E3_status_router (Layer 4, conditional_inject) — 主路由 4 條路徑
// 對應 design docs v5_engine_3_central_router.md §4.5
// 讀引擎 2 current_quality_status、執行 4 條路由

export const prompt_content = `[SYSTEM INJECT — Quality Status Router]

讀取引擎 2 輸出 current_quality_status、執行 4 條路由。
本 inject 不執行被路由到的目的地內容、僅做 handoff + AI 過渡話術。

**路由邏輯**:

若 current_quality_status == "owned":
→ **路由到 Build Vision**(4 步驟改變法 Step 2)

AI 過渡話術:
> 「『[current_quality_candidate_term]』——這是你的。
> 接下來、想像你面前有一個空白的畫布、
> 把『[current_quality_candidate_term]』放進去:它看起來像什麼?」

寫入 next_action = "build_vision"
handoff_target_module = "Checkpoint_1_Phase_2_BuildVision"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

若 current_quality_status == "ambiguous":
→ **路由到 Self-Concept 模型**(Mapping Across / Scope Overlap)

AI 過渡話術:
> 「你說『[current_quality_candidate_term]』『有時是、有時不是』——
> 我們先把這個放著、不強迫它變成『完全是』。
> 從你**確定是**的另一個 quality 出發、回頭看這個。
> [準備引擎 4 主動引用 + Checkpoint 1 Phase 2-3 啟動]」

寫入 next_action = "self_concept_model"
handoff_target_module = "Checkpoint_1_Phase_2_3_ScopeOverlap"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

若 current_quality_status == "candidate":
→ **繼續挖 evidence**(引擎 2 stay 路徑、不離開引擎 3 範圍)

AI 過渡話術:不需要——引擎 2 E2_stay_candidate 已處理。
本 inject 僅確認 router_phase 維持、不主動發話。

寫入 next_action = "continue_evidence"

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

若 current_quality_status == "none":
→ **繼續 values elicitation**(回 Damon 鏈式追問)

AI 過渡話術:不主動發話——讓主對話 LLM 自然續接鏈式追問。

寫入 next_action = "values_elicitation"
router_phase 退回 "elicitation"

**禁止**:
- 不執行被路由到的目的地內容(僅 handoff)
- 不在過渡話術裡描述「接下來會發生什麼」(會破壞學員體驗、不是 Damon 風格)`;

export default {
  id: 'E3_status_router',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  priority: 50,  // CASCADE_PRIORITY.E3_status_router
  pipeline_role: 'standalone',
  pipeline_parent: null,
  prompt_content,
  token_estimate: 220,
  trigger_conditions: [
    'session_state.router_phase == "identity_test_routing"',
    '引擎 2 已輸出 current_quality_status (非 "none")',
    'E3_deep_signal_detector / E3_opening_branch_router / E3_top1_determination 未觸發',
  ],
  routing_table: {
    owned:     'build_vision (Checkpoint_1_Phase_2_BuildVision)',
    ambiguous: 'self_concept_model (Checkpoint_1_Phase_2_3_ScopeOverlap)',
    candidate: 'continue_evidence (E2_stay 已處理)',
    none:      'values_elicitation (router_phase 退回 elicitation)',
  },
  parse_state_patch: {
    description: 'Set router_phase + next_action + handoff_target_module per status',
    affects: [
      'session_state.router_phase',
      'session_state.next_action',
    ],
  },
  inputs_from_state: [
    'session_state.current_quality_status',  // ⭐ 引擎 2 輸出
    'session_state.current_quality_candidate_term',
    'session_state.top1_value',
    'session_state.quality_focus_history',
    'session_state.router_phase',
  ],
  cross_engine_guard: 'top1_value == null + status == "owned" → 路由回 E3_top1_determination',
  damon_source: [
    '4.7 中央路由器主路徑(身份測試後分流)',
    'Damon: 4 步驟改變法 vs Self-Concept 模型分流邏輯',
  ],
};
