// lib/prompt-sections/conditional/engine-2/continue-elicitation.js
// E2_continue_elicitation sub-prompt (conditional_inject)
// 對應 design docs v5_engine_2_identity_test_adjudicator.md §4.5
// 0 重過、繼續 values elicitation、不執行身份測試動作

export const prompt_content = `[SYSTEM INJECT — Continue Values Elicitation]

本 turn 未偵測到有效 Quality 候選 / 身份句。
回主流程的 Damon 鏈式追問引擎、不執行身份測試動作。

**必須做**:
- 不指認「沒有偵測到 quality」(會 break flow)
- 自然接續上一個提問、用 Damon 核心鏈式追問:
  - 「What will that do for you?」/「這對你來說、會帶來什麼?」
  - 「What's important to you about that?」/「這個對你來說、為什麼重要?」
- 維持 elicitation_mode_active == true 狀態

**禁止**:
- 不可直接問「Are you a X person?」(身份測試格式)、本 turn 沒到那個時機
- 不可主動引入 Quality 詞表的詞、讓學員自己浮現`;

export default {
  id: 'E2_continue_elicitation',
  type: 'conditional_inject',
  trigger_event: null,
  priority: null,
  pipeline_role: 'sub_prompt',
  pipeline_parent: 'E2_aggregator',
  prompt_content,
  token_estimate: 180,
  parse_state_patch: {
    description: 'No status change; reset identity_signal_suspected_this_turn=false',
    affects: [
      'session_state.identity_signal_suspected_this_turn',
    ],
  },
  inputs_from_state: [
    'session_state.last_ai_question',
    'session_state.last_user_response',
    'session_state.current_quality_status',
  ],
  damon_source: [
    '6.2 0 重過 = 繼續 values elicitation',
    'Damon chain question 引擎: What will that do for you? / What\'s important?',
  ],
};
