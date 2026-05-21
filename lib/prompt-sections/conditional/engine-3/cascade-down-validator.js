// lib/prompt-sections/conditional/engine-3/cascade-down-validator.js
// E3_cascade_down_validator (Layer 5, conditional_inject) — Top 2/3 驗證
// 對應 design docs v5_engine_3_central_router.md §4.6

export const prompt_content = `[SYSTEM INJECT — Cascade Down Validator]

Top 1「[top1_value]」已 owned + Self-Concept 整合完成。
執行 Cascade Down:對 Top 2、Top 3 重新做身份測試。

Reference:cached_4_7_router_reference 內【Cascade Down 驗證 SOP】完整流程。

**執行邏輯**(state machine):

讀 cascade_down_progress.status:

若 status == null(首次進入):
→ 設 progress.value = values_ranking[1].value(Top 2)
→ progress.status = "testing"
→ AI 主動發起身份測試:
> 「現在『[top1_value]』是你了。
> 我們看看『[Top 2 value]』:
> **你是一個[Top 2 value]的人嗎?**」

若 status == "testing":
→ 學員回應後、呼叫 A1.sensory_detail judgment 評估
→ score >= 2 → status = "passed",更新 values_ranking[Top 2].quality_status = "owned"
→ score < 2 → status = "failed_need_self_concept"、cascade 到 Checkpoint 1 Phase 2-3

若 status == "passed":
→ 換 Top 3(若有):progress.value = Top 3、status = "testing"、重複
→ 若沒有 Top 3:status = "completed"、router_phase = "completed"

若 status == "failed_need_self_concept":
→ handoff 到 Checkpoint 1 Phase 2-3 Self-Concept 模型(對該 value 新一輪整合)
→ Self-Concept 完成後回到本 inject、重新測試該 value

若 status == "completed":
→ router_phase = "completed"
→ 觸發 takeaway 種下 + Future Pacing(引擎 4 範圍)

**特殊處理**:

Top 2 / Top 3 身份測試通過、但學員講「有時是」(ambiguous-like 回應):
- 仍視為 Cascade 成功(因 Top 1 已 owned、cascade 邏輯傳遞)
- 但寫入 values_ranking[i].quality_status = "owned_via_cascade"(標記、非完整 owned)
- 若學員下次 session 重講「有時是」、回頭做新一輪 Self-Concept

**禁止**:
- 不對 Top 2 / Top 3 做完整 Self-Concept 流程除非身份測試失敗(浪費時間 + 違反 Damon 原則)
- 不省略 Top 2 / Top 3 測試直接結案(這是 Cascade Down 的核心驗證、不能跳)`;

export default {
  id: 'E3_cascade_down_validator',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  priority: 60,  // CASCADE_PRIORITY.E3_cascade_down_validator
  pipeline_role: 'standalone',
  pipeline_parent: null,
  prompt_content,
  token_estimate: 250,
  cached_reference: 'ROUTER_4_7',  // Cascade Down 驗證 SOP
  haiku_judge_used: 'A1_sensory_detail',  // Top 2/3 evidence 判斷
  trigger_conditions: [
    'session_state.router_phase == "cascade_down"',
    'session_state.top1_value 已升級 owned',
    'Self-Concept 整合完成 (self_concept_integration_completed = true)',
    'values_ranking 內有 Top 2 / Top 3',
  ],
  state_machine_states: ['null', 'testing', 'passed', 'failed_need_self_concept', 'completed'],
  parse_state_patch: {
    description: 'Drive cascade_down_progress state machine; update values_ranking[i].quality_status',
    affects: [
      'session_state.cascade_down_progress',
      'session_state.router_phase',
      'session_state.values_ranking',  // [i].quality_status updates
    ],
  },
  inputs_from_state: [
    'session_state.top1_value',
    'session_state.values_ranking',
    'session_state.cascade_down_progress',
    'session_state.quality_focus_history',
  ],
  damon_source: [
    '4.7 章節 Cascade Down 驗證',
    'Damon: 對 Top 2 / Top 3 做身份測試、通過 → cascade 成功、失敗 → 新一輪 Self-Concept',
  ],
};
