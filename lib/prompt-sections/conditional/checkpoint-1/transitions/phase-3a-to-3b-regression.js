// lib/prompt-sections/conditional/checkpoint-1/transitions/phase-3a-to-3b-regression.js
// CP1 Phase 3a → 3b regression (罕見、P10 dissociated → associated 過渡失敗)
// 對應 design docs v5_checkpoint_1_*_turn_2.md §10.3

export const prompt_content = `[SYSTEM INJECT — Transition: Phase 3a → Phase 3b (P10 Regression)]

**Trigger condition**:
Phase 3a Step 1 P10 觸發
(dissociated → associated 過渡失敗、學員「我看到那個畫面但不覺得是我」)

**Rationale**:
Phase 3a Step 1 Build Vision 假設學員已 owned top1_value、
但 dissociated → associated 過渡失敗 = 學員實際上對 top1_value 還是 ambiguous
(雖然 Phase 2 身份測試判定 owned、可能是 P6 過去式 evidence / P7 外部驗證殘留)

**AI 過渡話術**:
> 「OK、那個畫面裡的他不是『現在的你』——
> 我想換個方式:
> 我們先不 vision、先看看『[top1_value]』在你身上是什麼樣子。
> **有沒有另一個你 100% 確定『是』的 quality?**」

→ 直接接 Phase 3b Step 1 Mapping Across

**State updates**:
- session_state.current_phase: "phase_3b"
- session_state.current_quality_status: "ambiguous"  # 回退
- session_state.self_concept_progress: { init }
- session_state.next_action: "self_concept_model"

**Dashboard monitoring note**:
這個路徑是 phase 倒退、必須寫進 phase_history、
給 Patrick dashboard 監控:
- phase_3a_to_3b_regression_count(per session)
- 若全體 Beta 學員 > 20% 發生此 regression、
  可能是 Phase 2 身份測試判決過寬、需 tune Haiku A1 threshold`;

export default {
  id: 'CP1_transition_phase_3a_to_3b_regression',
  type: 'conditional_inject',
  dispatch_mode: 'phase_transition',
  phase: 'transitions',
  sub_step: 'phase_3a_to_3b_regression',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 230,
  is_regression_transition: true,
  parse_state_patch: {
    description: 'Regression: current_phase=phase_3b, quality_status=ambiguous, init self_concept_progress',
    affects: [
      'session_state.current_phase',
      'session_state.current_quality_status',
      'session_state.self_concept_progress',
      'session_state.next_action',
      'user_profile_evolution.phase_history',  // record regression
    ],
  },
  inputs_from_state: [
    'session_state.top1_value',
    'session_state.build_vision_progress',
  ],
  damon_source: ['CP1 turn 2 §10.3 Phase 3a → Phase 3b regression (P10)'],
};
