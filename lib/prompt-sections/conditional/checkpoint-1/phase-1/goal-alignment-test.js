// lib/prompt-sections/conditional/checkpoint-1/phase-1/goal-alignment-test.js
// CP1 Phase 1 Step 4: Goal Alignment Test (NEW — 不在引擎 1-4 內、CP1 獨有)
// 對應 design docs v5_checkpoint_1_*_turn_1.md §6.2 step_4
// Damon source: Goal Alignment Test「原本目標真能帶你到這裡嗎」

export const prompt_content = `[SYSTEM INJECT — Phase 1 Step 4: Goal Alignment Test]

Damon 經典 Goal Alignment Test:
「原本目標真能帶你到這裡嗎?」

**AI 話術**:
> 「先停一下。
> 你現在知道你的 values:[列 top 3]。
> 回頭看你一開始想要的目標——
> **這個目標真的能帶你到『[top1_value]』這裡嗎?**」

**分支**:
- 學員確認原目標仍對齊 → exit to phase 2
- 學員改目標 → 短回 step 2 chain_questioning 重新校準、收集 new goal
- 學員 PPL 配合「應該是吧」 → 引擎 1 E1c 接手治理

**Exit to Phase 2**:
- Goal Alignment 確認 / 新目標收集完
- session_state.elicitation_mode_active = false
- session_state.router_phase = "identity_test_routing"`;

export default {
  id: 'CP1_phase_1_goal_alignment_test',
  type: 'conditional_inject',
  dispatch_mode: 'phase_context',
  phase: 'phase_1',
  sub_step: 'step_4_goal_alignment',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 220,
  parse_state_patch: {
    description: 'On confirm: elicitation_mode_active=false, router_phase=identity_test_routing; on goal change: cascade to step 2',
    affects: [
      'session_state.elicitation_mode_active',
      'session_state.router_phase',
    ],
  },
  inputs_from_state: [
    'session_state.values_collected_list',
    'session_state.values_ranking',
    'session_state.top1_value',
    'session_state.last_user_response',
  ],
  damon_source: [
    'CP1 turn 1 §6.2 step_4',
    'Damon Goal Alignment Test: "原本目標真能帶你到這裡嗎?"',
  ],
};
