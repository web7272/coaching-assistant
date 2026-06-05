// lib/prompt-sections/conditional/engine-3/integration-router.js
// E3_integration_router (Layer 4.5, conditional_inject) — integration mode toolbox dispatcher
// PR-23s4c task 2 (Vivi 6/4): 收編 7 個 phase-3a/3b prompt sections 為 toolbox.
// AI 動態選 tool (非 linear sequence — 對齊 v5.1 雙向流動).
//
// Toolbox (對應 lib/sub-prompts/integration/ 後 task 5 directory reorg):
//   - mapping-across.js          (phase-3b 起手)
//   - scope-overlap.js           (default 路徑, IP #1 三向 + 雙 channel)
//   - build-vision.js            (phase-3a Build Vision SOP)
//   - check-resistance.js        (phase-3a 5 種 resistance 破解 / + Hero's Welcome TODO)
//   - counter-example-integration.js (phase-3b 反例)
//   - three-way-triangulation.js (phase-3b 三向歸類)
//   - let-it-work.js             (phase-3a 收尾 takeaway)
//
// 規則 (per spec):
//   quality_status = ambiguous → Mapping Across 或 Scope Overlap (Scope Overlap default)
//   quality_status = owned + 需 Build Vision → Build Vision SOP
//   反例 surface → 三向歸類
//   Resistance surface → check-resistance
//     ⚠️ Hero's Welcome 5 步驟 SOP + Positive Intention 前置 = TODO-designer 接點.
//        repo docs 暫無此 SOP 文字、沿用既有 check-resistance 文字、不發明.
//   negative_generalization / frequency_illusion → reframe 接點 TODO (Step 5a/7)
//
// Exit (mode transition 由 mode-transition-router 接管, 不在此 inject):
//   owned + Let it Work 完成 → cascade (or future_pacing 如果無 Top 2/3)
//   多次仍 ambiguous + 學員接受 → owned_via_acceptance → cascade
//      (PR-23s4b 暫住 mode-transition-router, PR-23s4c task 2 整合至此 — 仍由
//       mode-transition-router emit transition; 本 inject 負責 framing 學員選擇)
//   5+ 輪無收斂 → handoff 三選一 (cascade 到 handoff_escalation)

export const prompt_content = `[SYSTEM INJECT — Integration Router]

primary_mode == integration. Self-Concept 收編 toolbox (非 linear sequence)、AI 動態選工具.

Reference:
- lib/sub-prompts/integration/ 7 個 sub-prompts (task 5 directory reorg).
- cached_4_7_router_reference 內【Self-Concept 模型 SOP】.

**Toolbox 動態選工具**:

若 current_quality_status == "ambiguous":
→ Scope Overlap (default 路徑, IP #1):
  問生活場景 — 跟誰見面 / 做哪幾件事 / 選哪個方向 — 不主動問身體 (紅線 14).
→ 若 Scope Overlap 多輪無進展 → Mapping Across (回頭從另一個 owned quality 出發).

若 current_quality_status == "owned" + 需 Build Vision (top1_value 已升級):
→ Build Vision SOP (phase-3a 4 步驟改變法 Step 2):
  Step 1: 場景化 vision
  Step 2: Check Resistance (5 種破解)
  Step 3: Let it Work (沉入潛意識 + takeaway 種下).

若學員 surface 反例 (e.g.「但有時候我做不到」):
→ 三向歸類 (phase-3b, 反例整合 40-90% 時間, 亞洲學員主動引出).

若學員 surface resistance 訊號 (5 種:害怕失敗 / 成功代價 / 生態破壞 / parts / 認同):
→ check-resistance (phase-3a 5 種破解).
  [TODO-designer (PR-23s4c+) — Hero's Welcome 5 步驟 SOP + Positive Intention
   前置. patch 原檔暫無此 SOP 文字、沿用既有 check-resistance 文字、不發明.]

若 negative_generalization 訊號 surface:
→ R11 Negative Generalization Reframe (Damon Reframe Library 接管, Step 7 PR-7a):
  body = engine-1-signals S5_INTEGRATION_INJECT 既有 ship-able phrasing
  (「這個『又』、我想停下來。這個感覺、最早是什麼時候開始的?」).
  R11 multi-turn — 學員 surface「最早什麼時候開始」後可能 cascade Parts Integration.

若 frequency_illusion 訊號 surface in integration mode:
→ R7 Slip into Unconscious Reframe (Damon Reframe Library 接管, Step 7 PR-7a):
  完整 5 step library §8.4 verbatim、由 engine-1-signals S3_LIGHT_INJECT
  invoke (R7_A standard; perfectionism marker → R7_B 變體).

**Exit 條件** (mode transition 由 mode-transition-router 接管):

退出至 cascade mode:
- current_quality_status == "owned" + Let it Work 完成 + 有 Top 2/3 待測 → cascade.
- 多次仍 ambiguous + 學員選 (a) 接受 → owned_via_acceptance → cascade.
  (學員確認句問法: 「『[top1_value]』 你願意接受它是 ambiguous、不強迫 binary?」)

退出至 future_pacing mode:
- current_quality_status == "owned" + Let it Work 完成 + 沒有 Top 2/3 → future_pacing.

退出至 handoff_escalation:
- 5+ 輪 integration mode 無收斂 + 未進入 cascade → 三選一 (a)/(b)/(c).

**禁止**:
- 不依 linear 順序執行 toolbox (這是 v5.0 phase-3a/3b 二分流的回歸, 紅線).
- 不強迫學員一定要走完所有工具 (Damon 鏈式追問是引擎、工具是響應).
- 不在 ambiguous 第一次就直接接受 owned_via_acceptance (給 3 輪以上 Scope Overlap 機會).
- 不主動問身體 (Scope Overlap default 不問 sub-modality, 紅線 14).
- 不對 5 種 resistance 用敵意標籤 (對應紅線 11、用「還在執行舊命令的部分」).`;

export default {
  id: 'E3_integration_router',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  priority: 45,  // 新優先級 (在 top1_judge 40 與 mode_transition_router 50 之間).
  pipeline_role: 'standalone',
  pipeline_parent: null,
  prompt_content,
  token_estimate: 480,  // PR-23s4c task 2 新建; toolbox + exit + Hero's Welcome TODO + reframe TODO.
  cached_reference: 'ROUTER_4_7',
  trigger_conditions: [
    'session_state.primary_mode == "integration"',
    'E3_deep_signal_detector / E3_elicitation_router / E3_top1_judge 未觸發',
  ],
  toolbox: [
    'mapping_across',
    'scope_overlap',          // IP #1 default
    'build_vision',
    'check_resistance',       // + Hero's Welcome TODO
    'counter_example_integration',
    'three_way_triangulation',
    'let_it_work',
  ],
  exit_conditions: {
    to_cascade:        'owned + Let it Work done + Top 2/3 待測 / owned_via_acceptance',
    to_future_pacing:  'owned + Let it Work done + 無 Top 2/3',
    to_handoff:        '5+ 輪 integration 無收斂',
  },
  parse_state_patch: {
    description: 'Integration mode tools update session_state.self_concept_progress; transition exits handled by mode-transition-router (separate inject).',
    affects: [
      'session_state.self_concept_progress',
      'session_state.current_quality_status',
      'session_state.counter_examples_list',
    ],
  },
  inputs_from_state: [
    'session_state.primary_mode',
    'session_state.current_quality_status',
    'session_state.current_quality_candidate_term',
    'session_state.self_concept_progress',
    'session_state.top1_value',
  ],
  damon_source: [
    '4.7 中央路由器 integration mode (v5.1: phase-3a + phase-3b 統一成 toolbox)',
    'Damon Self-Concept 模型: Mapping Across / Scope Overlap / 反例整合 / 三向歸類',
    'IP #1 Scope Overlap default 路徑 (紅線 14: 不主動問身體)',
    'Hero\'s Welcome / Positive Intention: TODO-designer 接點',
  ],
};
