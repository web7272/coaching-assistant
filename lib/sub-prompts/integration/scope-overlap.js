// lib/prompt-sections/conditional/checkpoint-1/phase-3b/scope-overlap.js
// CP1 Phase 3b Step 4: Scope Overlap (⭐⭐ v5.0 原創 IP #1 ⭐⭐)
// 對應 design docs v5_checkpoint_1_*_turn_2.md §9.6 step_4_scope_overlap
//
// ⭐⭐ v5.0 原創 IP #1 (errata 5/21 intent 修正):
// Self-Concept 整合的 **default 主路徑(亞洲 cohort)**、
// 不是「純文字環境 fallback」、是 channel 選擇。
// Damon 原版 submodality 路徑保留為「學員自發 surface 視覺-身體 channel 時的順著走方案」、
// 不是 fallback、是學員自選 channel(對應紅線 14)。
//
// errata 來源: docs/v5-spec/engineering/v5_errata_patch_phase_3a_3b_scope_overlap_default.md Patch 5
//
// Phase 3b Step 1 (Mapping Across) 也已 errata 5/21 修正為場景挖 default、跟 Step 4 連貫:
//   Step 1 場景挖 → Step 2 反例 → Step 3 三向 → Step 4 Scope Overlap 核心/邊緣/灰色
//   (errata 前: Step 1 用 submodality、Step 4 才 Scope Overlap、設計斷裂)
//   (errata 後: 同一 Scope Overlap 邏輯貫穿 4 sub-step、設計連貫)

export const prompt_content = `[SYSTEM INJECT — Phase 3b Step 4: Scope Overlap (v5.0 原創 IP #1)]

v5.0 原創 IP #1:純文字環境 / 亞洲適配的 Self-Concept 整合替代
Damon 體系 Mapping Across 依賴非語言訊號(submodality 觸感 / 視覺)、
在純文字環境難完整還原。
Scope Overlap 用「概念重疊範圍」替代「身體 submodality」。

**Step 4a — 列出 quality 的「核心」「邊緣」「灰色地帶」**:
> 「我們花了時間挖『[top1_value]』+ 反例三向歸類——
> 我幫你整理:
> - 核心(你 100% 是的場景):[從 quality_focus_history 抓]
> - 邊緣(有時是的場景):[從 counter_examples_list classified as boundary]
> - 灰色(你還在思考的):[從 counter_examples_list classified as cost/trigger]
>
> 看著這個 list、你覺得『[top1_value]』的 scope 是什麼?」

**Step 4b — 確認 expanded quality definition**:
→ 學員給定義 / 邊界
→ AI 反問驗證:「你說『[expanded definition]』——
             這個定義包不包含這個邊緣場景?」
→ 學員確認 → quality definition 寫入 anchors

**Step 4c — 重新做身份測試(關鍵)**:
> 「現在用這個 expanded definition——
> **你是一個『[top1_value]』(這個 expanded 版本)的人嗎?**」
→ A1.sensory_detail Haiku judge 評估回應
→ 通過(score >= 2 + answer addresses)→ top1_value 升級 owned
→ 不通過 → 反例還沒處理完、回 step 2

**Step 4d — owned 升級確認**:
學員快速答 Yes + evidence 自然舉得出 → top1_value 升級 owned
session_state.current_quality_status: "owned"
進 §10 Phase 3a Simplified 銜接

**東方文化適配**:
- 亞洲學員傾向「絕對 / 二元」框架(「我是 vs 我不是」)
- Scope Overlap 強迫學員接受「灰色地帶 = 真實的 quality 範圍」
- 對應 v5.0 原創 IP #2 東方文化柔軟拆解節奏

**Cross-engine active**:
- A1.sensory_detail Haiku judge(step 4c 重新身份測試)
- 引擎 2 E2_aggregator 4 重組合最後一次判決

**State updates during step**:
session_state.self_concept_progress.scope_overlap_applied: true
user_profile_evolution.anchors: append expanded definition
session_state.current_quality_status: "owned"(if step 4c passes)

**Exit to Phase 3a Simplified or Phase 4**:
- top1_value 升級 owned → 進 Phase 3a Simplified、跑完 Build Vision + Let it Work
- top1_value 仍 ambiguous → cascade A3 handoff:
    「『[top1_value]』我們花了 [N] 天、還是 ambiguous——
    我想跟你確認:
    (a) 我們接受它本來就是 ambiguous quality、進 Cascade Down 看 Top 2
    (b) 跟 Vivi 1-on-1 評估
    你選哪個?」

**P18 mitigation — Binary 框架不接受 Scope Overlap**:
若學員「我就是是、就是不是、灰色地帶我不接受」:
→ 不強推 Scope Overlap、cascade A3:
「我聽到你不接受灰色地帶——
那我們可能要 accept top1_value 對你來說就是 ambiguous(有時是、有時不是)、
不需要強迫 owned。
你 ok 我們繼續往下走嗎?(進 Phase 4 Cascade Down)」
→ Top 1 標 owned_via_acceptance、繼續
→ 對應 forward note:有些學員的 self-concept 結構本來就是 binary、
  Scope Overlap 對他們無效、要 respect。`;

export const SCOPE_LAYERS = Object.freeze({
  core:    '核心 (100% 是的場景、從 quality_focus_history 抓)',
  edge:    '邊緣 (有時是的場景、從 counter_examples_list classified as boundary)',
  gray:    '灰色 (還在思考的、從 counter_examples_list classified as cost/trigger)',
});

export default {
  id: 'CP1_phase_3b_scope_overlap',
  type: 'conditional_inject',
  dispatch_mode: 'phase_context',
  phase: 'phase_3b',
  sub_step: 'step_4_scope_overlap',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 550,
  original_ip: '#1 Scope Overlap',  // ⭐⭐ v5.0 原創 IP
  scope_layers: SCOPE_LAYERS,
  haiku_judge_used: 'A1_sensory_detail',  // step 4c 重新身份測試
  parse_state_patch: {
    description: 'Set scope_overlap_applied=true; append expanded definition to anchors; on 4c pass → current_quality_status=owned + cascade to Phase 3a simplified',
    affects: [
      'session_state.self_concept_progress',
      'session_state.current_quality_status',
      'user_profile_evolution.anchors',
      'session_state.current_phase',  // → phase_3a simplified or stay phase_3b
    ],
  },
  inputs_from_state: [
    'session_state.top1_value',
    'session_state.quality_focus_history',
    'session_state.counter_examples_list',
    'session_state.self_concept_progress',
    'session_state.last_user_response',
  ],
  binary_framework_fallback: 'owned_via_acceptance (P18 mitigation、不強推 Scope Overlap)',
  damon_source: [
    'CP1 turn 2 §9.6 step_4_scope_overlap',
    '方法論 5.5 Scope Overlap 完整 SOP',
    'v5.0 原創 IP #1 Scope Overlap spec',
    '對應 v5.0 原創 IP #2 東方文化柔軟拆解',
  ],
};
