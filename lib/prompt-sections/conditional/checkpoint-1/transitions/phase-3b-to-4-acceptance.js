// lib/prompt-sections/conditional/checkpoint-1/transitions/phase-3b-to-4-acceptance.js
// CP1 Phase 3b → 4 acceptance (學員接受 ambiguous、直接進 Cascade Down)
// 對應 design docs v5_checkpoint_1_*_turn_2.md §10.2

export const prompt_content = `[SYSTEM INJECT — Transition: Phase 3b → Phase 4 (Acceptance Path)]

**Trigger condition**:
Phase 3b Step 4 完成但 quality 仍 ambiguous
+ 學員選擇接受 ambiguous(handoff 變體 (a))

**AI 過渡話術**:
> 「『[top1_value]』我們確定它是 ambiguous——
> 我們接受這個、不強迫 binary。
> 現在看看『[Top 2 value]』——
> 你是一個『[Top 2 value]』的人嗎?」

→ 直接接 Phase 4 Cascade Down

**Side effects**:
- Top 1 在 export 中標示「ambiguous quality (accepted)」、不是完全 owned
- Phase 5 Future Pacing 時、用 ambiguous-aware 變體話術
  (「想像三個月後的你、有時是『[top1_value]』、有時不是——
   那個『有時是』的場景、會發生什麼?」)

**State updates**:
- session_state.current_phase: "phase_4"
- session_state.current_quality_status: "owned_via_acceptance"
- values_ranking[Top 1].quality_status: "owned_via_acceptance"
- session_state.router_phase: "cascade_down"`;

export default {
  id: 'CP1_transition_phase_3b_to_4_acceptance',
  type: 'conditional_inject',
  dispatch_mode: 'phase_transition',
  phase: 'transitions',
  sub_step: 'phase_3b_to_4_acceptance',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 180,
  special_quality_status: 'owned_via_acceptance',
  parse_state_patch: {
    description: 'Accept ambiguous: current_phase=phase_4, quality_status=owned_via_acceptance, router_phase=cascade_down',
    affects: [
      'session_state.current_phase',
      'session_state.current_quality_status',
      'session_state.values_ranking',  // [Top 1].quality_status
      'session_state.router_phase',
    ],
  },
  inputs_from_state: [
    'session_state.top1_value',
    'session_state.values_ranking',
  ],
  damon_source: ['CP1 turn 2 §10.2 Phase 3b → Phase 4 (acceptance 路徑)'],
};
