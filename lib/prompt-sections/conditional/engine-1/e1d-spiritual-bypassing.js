// lib/prompt-sections/conditional/engine-1/e1d-spiritual-bypassing.js
// E1d_spiritual_bypassing sub-prompt (conditional_inject)
// 對應 design docs v5_engine_1_deviation_detector.md §4.7
// Damon source: 5.7.3 情境 4 MTA 案例 + 5.7.5 v5.0 原創 IP #4 5 層撥開
// 引用 cached prefix: TECHNIQUE_5_LAYER_UNWRAP (cached/five-layer-unwrap.js)

export const prompt_content = `[SYSTEM INJECT — Spiritual Bypassing / Abstract Loop]

學員陷入抽象詞 / 靈性化詞迴圈、無法落回具體經驗。

執行 5 層撥開技術(完整定義見 cached reference: TECHNIQUE_5_LAYER_UNWRAP)。

**動作選擇邏輯**:

讀取 session_state.bypassing_layer_progress(當前撥開層次、initial = 0):

- progress == 0:執行【動作 1:指認大詞高度】
  → 觸發後 progress = 1

- progress == 1:檢查上輪回應
  - 學員給出時間性區分(過去/現在/未來)→ 跳【動作 3:Mirror 結構】、progress = 3
  - 學員仍以「現在的我已經...」框架抽象 → 執行【動作 2:時間區分】、progress = 2
  - 學員給 sensory detail → **撥開成功、清空 progress、回主流程**

- progress == 2:執行【動作 3:Mirror 結構】、progress = 3

- progress == 3:檢查上輪回應
  - 學員口頭認同身體層次 + 下句又抽象 → 執行【動作 4:連結言行不一】、progress = 4
  - 學員給 sensory detail → 撥開成功
  - 學員直接迴避 → 跳【動作 5:現場 Mirror】、progress = 5

- progress == 4:執行【動作 4】、progress = 5

- progress == 5:執行【動作 5:現場 Mirror】、progress = 6

- progress >= 6:**5 層全跑完、學員仍抽象化**
  → cascade 到附錄 A3.handoff_escalation
  → 觸發 failure_signal_alert
  → 提案降頻、跨 day 再試

**填空指引**:

動作話術骨架在 cached reference、本次 inject 只需把骨架的 [變數] 替換:
- [大詞] → 從 session_state.last_user_response 抓出最抽象的名詞
- [學員原句、抽象版] → 從 last_user_response 抓主要句子
- [同樣句式、但抽象詞替換為身體 / 感官 / 動作詞] → LLM 替換、保留句式不變
- 動作 5 的 3 句話列表 → 從 last 3 user turns 抓

**F4 精準防護(values elicitation 階段 safe path)**:

若 session_state.elicitation_mode_active == true
AND session_state.recent_specific_examples_count >= 2:
→ 不該觸發 E1d(classifier 應已判 false_positive)
→ 若仍走到 E1d:downgrade 到動作 1 only、不深入後續層級、保留 values 提取主軸

**禁止**:
- 不可跳層(progress 必須遞增、否則撥開失去 grounding 邏輯)
- 不可同一輪同時執行多動作(每 turn 推進 1 層)
- 不可用 spiritual 語言回應 spiritual 偏離(會強化迴圈)`;

export default {
  id: 'E1d_spiritual_bypassing',
  type: 'conditional_inject',
  trigger_event: null,
  priority: null,
  pipeline_role: 'sub_prompt',
  pipeline_parent: 'E1_subtype_classifier',
  prompt_content,
  token_estimate: 270,
  cached_reference: 'TECHNIQUE_5_LAYER_UNWRAP',
  parse_state_patch: {
    description: 'Advance bypassing_layer_progress (0→6) or reset on sensory_detail; -0.10 PPL on撥開成功',
    affects: [
      'session_state.bypassing_layer_progress',
      'session_state.deviation_handled_this_turn',
      'session_state.cumulative_ppl_score',
    ],
  },
  inputs_from_state: [
    'session_state.last_user_response',
    'session_state.bypassing_layer_progress',
    'session_state.recent_specific_examples_count',
    'session_state.elicitation_mode_active',
    'anchors_top3',
  ],
  cross_engine_interaction: [
    'E1d progress >= 3 但學員配合度高 → 可能共病 PPL、檢查 cumulative_ppl_score',
    'ppl_score >= 0.6 且 bypassing_progress >= 3 → cascade 到 E1c + 附錄 A1.requires_typing',
  ],
  damon_source: [
    '5.7.3 情境 4 Damon MTA 案例 "你跳到了諸如整合、完整、目標、實現這些詞"',
    '5.7.5 v5.0 原創 IP #4: 5 層撥開技術(已驗證原創)',
    'cached_5_layer_unwrap_reference (lib/prompt-sections/cached/five-layer-unwrap.js)',
  ],
};
