// lib/prompt-sections/conditional/checkpoint-1/phase-1/opening-and-elicitation.js
// CP1 Phase 1 Step 1-2: Opening + Chain Questioning
// 對應 design docs v5_checkpoint_1_*_turn_1.md §6.2 step_1 / step_2

export const prompt_content = `[SYSTEM INJECT — Phase 1: Opening + Chain Questioning]

Phase 1 起手式:Values Elicitation。
若觸發特殊開場(「我卡住了」/「我老是搞砸」/「我不夠好」)、
由引擎 3 E3_elicitation_router 處理 reframe、然後接 step 2。

**Step 1 — AI 起手式話術骨架(若無特殊開場)**:
> 「我想先聽你說——
> 你現在想要什麼?
> 不是『不要什麼』、是你**真正想要**的東西。」

**Step 2 — Damon 鏈式追問引擎**:
What will that do for you? / What's important?
目標:從初步 want 鏈式追問到 3-5 個 values

AI 話術(主對話 LLM 即興、有引擎 1 偏離治理 guard rail):
- 「[學員 want]——這對你來說、會帶來什麼?」
- 「『[學員回應]』、這個對你來說、為什麼重要?」
- 「沒有『[學員回應]』、會發生什麼?」

**禁止**:
- 不問 Why(Damon 禁區)
- 不引導學員到特定 value(讓學員自己浮現)
- 不接受模糊回答(引擎 1 E1b 處理)

**Cross-engine active**:
- 引擎 1 持續監測偏離(E1a-E1d)
- 引擎 2 E2_master_detector 監聽 Quality 詞 / 身份句出現(本 step 通常不觸發、但 ready)

**Exit to Step 3**:
session_state.values_collected_list.length >= 3 → 進 top1_determination`;

export default {
  id: 'CP1_phase_1_opening_and_elicitation',
  type: 'conditional_inject',
  dispatch_mode: 'phase_context',
  phase: 'phase_1',
  sub_step: 'step_1_2',  // opening + chain_questioning
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 280,
  parse_state_patch: {
    description: 'Append values_collected_list as values emerge; advance phase_progress within phase_1',
    affects: [
      'session_state.values_collected_list',
      'session_state.phase_progress',
    ],
  },
  inputs_from_state: [
    'session_state.last_user_response',
    'session_state.values_collected_list',
    'session_state.opening_branch_handled',
  ],
  damon_source: [
    'CP1 turn 1 §6.2 step_1 / step_2',
    'Damon 鏈式追問引擎: What will that do for you? / What\'s important?',
  ],
};
