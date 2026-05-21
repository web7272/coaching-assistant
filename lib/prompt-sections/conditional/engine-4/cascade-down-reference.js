// lib/prompt-sections/conditional/engine-4/cascade-down-reference.js
// E4_cascade_down_reference (conditional_inject)
// 對應 design docs v5_engine_4_active_reference.md §5.4
// trigger: paired (跟 E3_cascade_down_validator pair、in-line 過渡引用)

export const prompt_content = `[SYSTEM INJECT — Cascade Down Transition Reference]

Top 1「[top1_value]」已 owned + Self-Concept 整合完成。
即將測試 Top 2 / Top 3、先做引用過渡。

本 inject 只生成 1-2 句過渡引用、然後 handoff 給 E3_cascade_down_validator 執行身份測試。

**話術變體**(LLM 挑):

變體 A — 首次進入 Cascade Down(測試 Top 2):
> 「『[top1_value]』現在是你的。
> 我們看看『[Top 2 value]』。」

變體 B — Top 2 通過、測試 Top 3:
> 「『[top1_value]』『[Top 2 value]』。
> 還有『[Top 3 value]』。」

變體 C — Cascade 過程跨 day(從 V5 開場後接手):
> 「『[top1_value]』昨天已經是你的。
> 今天我們看『[next value in ranking]』。」

**禁止**:
- 不解釋 Cascade Down 概念(學員不需要知道機制名)
- 不問「你準備好嗎」(評估式)
- 不重複 Top 1 的 evidence(已 owned、不需重新證明)

Inject 結束、E3_cascade_down_validator 接手執行身份測試問句:
> 「你是一個『[next value]』的人嗎?」`;

export default {
  id: 'E4_cascade_down_reference',
  type: 'conditional_inject',
  trigger_event: 'paired',  // ⭐ paired with E3_cascade_down_validator
  priority: null,
  paired_with: 'E3_cascade_down_validator',
  pipeline_role: 'standalone',
  pipeline_parent: null,
  prompt_content,
  token_estimate: 180,
  variants: ['A_first_cascade_top2', 'B_top2_passed_test_top3', 'C_cross_day_v5_handoff'],
  trigger_conditions: [
    'session_state.router_phase == "cascade_down"',
    'cascade_down_progress.status == "testing" (即將測試 Top 2 / Top 3)',
    'E3_cascade_down_validator 同 turn 觸發、本 inject 在 E3 之前 inject',
  ],
  parse_state_patch: {
    description: 'No state write — pure transition reference; E3_cascade_down_validator handles state',
    affects: [],
  },
  inputs_from_state: [
    'session_state.top1_value',
    'session_state.values_ranking',
    'session_state.cascade_down_progress',
    'session_state.quality_focus_history',
  ],
  damon_source: [
    '4.7 Cascade Down 驗證',
    'Damon: 從 Top 1 owned 過渡到測試 Top 2 / Top 3',
  ],
};
