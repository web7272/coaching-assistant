// lib/prompt-sections/conditional/checkpoint-1/transitions/phase-3b-to-3a-simplified.js
// CP1 Phase 3b → 3a Simplified 過渡 (Scope Overlap 升級 owned 後的常見路徑)
// 對應 design docs v5_checkpoint_1_*_turn_2.md §10.1

export const prompt_content = `[SYSTEM INJECT — Transition: Phase 3b → Phase 3a Simplified]

**Trigger condition**:
Phase 3b Step 4 Scope Overlap 完成
+ step 4c 重新身份測試通過
+ current_quality_status: "ambiguous" → "owned"

**AI 過渡話術(由主對話 LLM 處理、不另起 inject)**:
> 「『[top1_value]』(這個 expanded 版本)現在是你的。
> 我們把它放進畫面看看——
> 你看到什麼?身體在哪裡感覺到?」

→ 直接接 Phase 3a Step 1 Build Vision(simplified、跳過 Step 2)

**Rationale**:
Phase 3b 已經完整跑過 Self-Concept 模型(Mapping Across + 反例 + 三向歸類 + Scope Overlap)、
學員對 top1_value 的內部認領已很深、不需要 full 4 步驟改變法。

Phase 3a Simplified 只跑:
- Step 1 Build Vision(min step、快速 dissociated → associated)
- Step 3 Let it Work(直接 Future Pacing + takeaway)

跳過 Step 2 Check Resistance:
- Phase 3b 內已多次處理 resistance(反例整合、三向歸類本質都是 resistance 處理)
- 此時再做 Check Resistance 會 over-process、違反 Damon 原則

**Day range for 3a Simplified**: min 1 / max 2`;

export default {
  id: 'CP1_transition_phase_3b_to_3a_simplified',
  type: 'conditional_inject',
  dispatch_mode: 'phase_transition',
  phase: 'transitions',
  sub_step: 'phase_3b_to_3a_simplified',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 200,
  parse_state_patch: {
    description: 'Transition: current_phase=phase_3a, next_action=build_vision_simplified, init build_vision_progress',
    affects: [
      'session_state.current_phase',
      'session_state.next_action',
      'session_state.build_vision_progress',
      'user_profile_evolution.quality_focus_history',  // append top1_value upgrade
    ],
  },
  inputs_from_state: [
    'session_state.top1_value',
    'session_state.current_quality_status',
    'session_state.self_concept_progress',
  ],
  damon_source: ['CP1 turn 2 §10.1 Phase 3b → Phase 3a Simplified'],
};
