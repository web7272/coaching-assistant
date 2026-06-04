// lib/prompt-sections/conditional/checkpoint-1/phase-2/initiate-identity-test.js
// CP1 Phase 2 Step 1: Initiate Identity Test (NEW — AI 主動發起問句)
// 對應 design docs v5_checkpoint_1_*_turn_1.md §7.2 step_1

export const prompt_content = `[SYSTEM INJECT — Phase 2 Step 1: Initiate Identity Test]

AI 主動發起 Damon 身份測試、不等學員自己講身份句。
這是 Phase 2 跟 Phase 1 的核心差別——
Phase 1 是 elicitation(被動接學員 quality)、
Phase 2 是 active test(AI 主動發問)。

**Step 1a — confirm**:
> 「我們花了時間挖到『[top1_value]』。
> 我想直接問你:
> **你是一個『[top1_value]』的人嗎?**」

(等學員回應、約 3-5 turn 內)

**Step 1b — evidence**:
> 「好。你說你是一個『[top1_value]』的人——
> 把過去你做過、最能證明這點的一兩件具體的事情、說給我聽。」

**Cross-engine active**:
- 引擎 2 E2_aggregator 對學員回應做 4 重組合判決
- A1.sensory_detail Haiku judge 評估 evidence 回應(>= 2 markers)

**Exit to Step 2 (Phase 2 step_2_classification)**:
- 引擎 2 aggregation_result 輸出
- current_quality_status 寫入(owned / ambiguous / candidate)`;

export default {
  id: 'CP1_phase_2_initiate_identity_test',
  type: 'conditional_inject',
  dispatch_mode: 'phase_context',
  phase: 'phase_2',
  sub_step: 'step_1_initiate',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 200,
  haiku_judge_used: 'A1_sensory_detail',
  parse_state_patch: {
    description: 'Trigger E2 aggregator on user evidence response; cascade to E2 sub-prompt',
    affects: [
      'session_state.current_quality_status',
      'session_state.identity_test_evidence_count',
    ],
  },
  inputs_from_state: [
    'session_state.top1_value',
    'session_state.last_user_response',
  ],
  damon_source: [
    'CP1 turn 1 §7.2 step_1',
    'Damon 身份測試格式 "Are you a X person?" 中文落地',
    'v4.0 工具二 2A confirm_script / evidence_script',
  ],
};
