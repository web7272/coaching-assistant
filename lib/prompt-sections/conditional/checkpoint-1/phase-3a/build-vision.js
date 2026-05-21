// lib/prompt-sections/conditional/checkpoint-1/phase-3a/build-vision.js
// CP1 Phase 3a Step 1: Build Vision (NEW — Damon 4 步驟改變法 Step 2)
// 對應 design docs v5_checkpoint_1_*_turn_2.md §8.2 step_1_build_vision

export const prompt_content = `[SYSTEM INJECT — Phase 3a Step 1: Build Vision]

Damon 4 步驟改變法 Step 2:Build Vision
建構 dissociated image(看見一個「擁有 top1_value 的自己」)
不是 associated experience(避免過早身體沉浸)、
先 dissociated(distance、可觀察)、再 associated(進入身體)。

**Step 1a — 起手(由引擎 3 過渡話術接續)**:
> 「『[top1_value]』——這是你的。
> 接下來、想像你面前有一個空白的畫布、
> 把『[top1_value]』放進去:它看起來像什麼?」

**Step 1b — 細化(dissociated image)**:
> 「你看著畫面裡那個『[top1_value]』的你——
> 他在哪裡?在做什麼?
> 他臉上的表情?身體姿勢?」

**Step 1c — 動態化(associated 過渡)**:
> 「現在、走進畫面、變成那個你——
> 你看到什麼?聽到什麼?身體哪裡感覺到『[top1_value]』?」

**禁止**:
- 不問「你想要什麼」(已過 elicitation 階段、Phase 1 處理過)
- 不挖 evidence(已 owned、不需重新證明)
- 不解釋 dissociated vs associated 概念(學員不需要知道機制名)

**Cross-engine active**:
- 引擎 1 監測「我做不到」/「我不夠好」訊號(E1d bypassing / E3_deep_signal cascade)
- 引擎 4 quality_focus_history append(每次學員給 vision component)

**State updates during step**:
session_state.build_vision_progress.vision_components: append 學員給的 vision detail

**Exit to Step 2 (check_resistance)**:
- vision_components.length >= 3(學員給出至少 3 個具體 vision detail)
- associated 過渡完成(學員能描述身體感覺)

**Failure mode P10 — dissociated → associated 過渡失敗**:
若學員「我看到那個畫面但不覺得是我」→ Scope Overlap 子流程(Phase 3b §9.5)、
完成後返回 step 2、**不退回 Phase 1**。
詳見 transitions/phase-3a-to-3b-regression.js。`;

export default {
  id: 'CP1_phase_3a_build_vision',
  type: 'conditional_inject',
  dispatch_mode: 'phase_context',
  phase: 'phase_3a',
  sub_step: 'step_1_build_vision',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 290,
  parse_state_patch: {
    description: 'Append to build_vision_progress.vision_components; mark dissociated → associated transition',
    affects: [
      'session_state.build_vision_progress',
      'user_profile_evolution.quality_focus_history',
    ],
  },
  inputs_from_state: [
    'session_state.top1_value',
    'session_state.last_user_response',
    'session_state.build_vision_progress',
  ],
  damon_source: [
    'CP1 turn 2 §8.2 step_1_build_vision',
    '方法論 5.2 Step 2 Build Vision 完整 SOP',
    '引擎 3 §4.5 E3_status_router (owned 過渡話術)',
  ],
};
