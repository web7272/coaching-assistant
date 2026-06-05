// lib/prompt-sections/conditional/engine-3/cascade-mode-validator.js
// E3_cascade_mode_validator (Layer 5, conditional_inject) — Top 2/3 驗證
// 前身: cascade-down-validator (PR-23s4b 改名 + 範圍擴).
//
// PR-23s4b 範圍擴 (per task 1 spec):
//   - 既有 derived evidence 防護維持
//   - Haiku A1 dim 4 對齊接點 (TODO(Step 5b) — 引擎 2 errata 補完整 4-dim).
//   - cascade mode orthogonal: 可從任何 mode 觸發 (非線性, 對齊 v5.1 雙向流動).
//     原 cascade-down (phase_4 linear) 被 phase machine 鎖死, 現在 mode-transition-
//     router 接管 transition, 本檔僅做 cascade mode 內 SOP, 不管 mode entry.

export const prompt_content = `[SYSTEM INJECT — Cascade Mode Validator]

Top 1「[top1_value]」已 owned + Self-Concept 整合完成。
執行 Cascade Down:對 Top 2、Top 3 重新做身份測試。

⚠️ PR-23s4b 變更: cascade 不再是 phase_4 linear 階段, 是可從 identity_anchoring
   / integration / future_pacing 任一 primary_mode 觸發的 mode (orthogonal).
   進入 cascade mode 的判定由 mode-transition-router 接管, 本 inject 僅執行
   cascade mode 內的 SOP.

Reference:cached mode_aware_router_reference 內 Mode 4 Cascade section (連帶驗證 Top 2 / Top 3)。

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
→ score < 2 → status = "failed_need_integration"、 mode-transition-router 切回 integration

  [TODO(Step 5b) — Haiku A1 dim 4 對齊接點]
  v5.1 引擎 2 errata 將 A1 sensory_detail judge 擴成 4-dimension scoring
  (sensory / attribution_self / present_tense / independent). 本 inject 改讀
  dim 4 後接 cascade 邏輯; PR-23s4b 留接口、dim 4 補完前用既有 sensory score.

若 status == "passed":
→ 換 Top 3(若有):progress.value = Top 3、status = "testing"、重複
→ 若沒有 Top 3:status = "completed"
  → mode-transition-router 偵測到 cascade.completed → transition primary 到 future_pacing.

若 status == "failed_need_integration":
→ mode-transition-router 切 primary 到 integration (Self-Concept 模型對該 value 新一輪整合)
→ Integration 完成後、 mode-transition-router 切回 cascade、重新測試該 value.

若 status == "completed":
→ mode-transition-router 偵測 → primary_mode transition to future_pacing.
→ 觸發 takeaway 種下 + Future Pacing (引擎 4 範圍).

**特殊處理**:

Top 2 / Top 3 身份測試通過、但學員講「有時是」(ambiguous-like 回應):
- 仍視為 Cascade 成功 (因 Top 1 已 owned、cascade 邏輯傳遞)
- 但寫入 values_ranking[i].quality_status = "owned_via_cascade" (標記、非完整 owned)
- 若學員下次 session 重講「有時是」、回頭做新一輪 Self-Concept (integration mode)

**禁止**:
- 不對 Top 2 / Top 3 做完整 Self-Concept 流程除非身份測試失敗 (浪費時間 + 違反 Damon 原則)
- 不省略 Top 2 / Top 3 測試直接結案 (這是 Cascade Down 的核心驗證、不能跳)
- 不假設 cascade 是 linear phase_4 (orthogonal mode, 可隨時被 crisis 中斷 / resume)`;

export default {
  id: 'E3_cascade_mode_validator',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  priority: 60,  // CASCADE_PRIORITY.E3_cascade_mode_validator (PR-23s4b 維持 60)
  pipeline_role: 'standalone',
  pipeline_parent: null,
  prompt_content,
  token_estimate: 320,  // §3 patch 6/4 PR-23s4b: 250 → 320 (+orthogonal note + dim 4 接口 TODO + Self-Concept 統一改 integration mode)
  cached_reference: 'ROUTER_4_7',
  haiku_judge_used: 'A1_sensory_detail',  // PR-23s4b: dim 4 補完後改 A1_sensory_4dim (Step 5b)
  trigger_conditions: [
    'session_state.primary_mode == "cascade"',  // PR-23s4b: router_phase → primary_mode
    'session_state.top1_value 已升級 owned',
    'Self-Concept 整合完成 (integration mode exit 成功)',
    'values_ranking 內有 Top 2 / Top 3',
  ],
  state_machine_states: ['null', 'testing', 'passed', 'failed_need_integration', 'completed'],
  parse_state_patch: {
    description: 'Drive cascade_down_progress state machine; update values_ranking[i].quality_status; cascade completion triggers mode-transition-router → future_pacing',
    affects: [
      'session_state.cascade_down_progress',
      'session_state.primary_mode',                     // PR-23s4b: 完成時切 future_pacing
      'session_state.values_ranking',
    ],
  },
  inputs_from_state: [
    'session_state.top1_value',
    'session_state.values_ranking',
    'session_state.cascade_down_progress',
    'session_state.quality_focus_history',
    'session_state.primary_mode',                       // PR-23s4b
  ],
  damon_source: [
    '4.7 章節 Cascade Down 驗證',
    'Damon: 對 Top 2 / Top 3 做身份測試、通過 → cascade 成功、失敗 → 新一輪 Self-Concept',
    'PR-23s4b: cascade orthogonal mode (非 linear phase_4)',
  ],
};
