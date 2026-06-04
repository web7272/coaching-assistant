// lib/prompt-sections/conditional/checkpoint-1/phase-3b/three-way-triangulation.js
// CP1 Phase 3b Step 3: 三向歸類 (⭐⭐ v5.0 原創 IP #3 ⭐⭐)
// 對應 design docs v5_checkpoint_1_*_turn_2.md §9.5 step_3_three_way_triangulation
//
// ⭐⭐ v5.0 原創 IP #3: 反例處理的決策樹
// 不是 binary「是 / 不是」、是三向歸類:
//   (a) Consistent — 反例是 quality 的另一種樣子 (integration)
//   (b) Related — 反例是 quality 的 boundary (coexistence)
//   (c) Contradictory — 反例違反 quality (boundary clarification)
//
// 細化為 6 種 final_classification:
//   consistent / boundary / cost / trigger / rejected / definition_expanded

export const prompt_content = `[SYSTEM INJECT — Phase 3b Step 3: 三向歸類 (v5.0 原創 IP #3)]

v5.0 原創 IP #3:反例處理的決策樹
不是 binary「是 / 不是」、是三向歸類:
(a) Consistent — 反例是 quality 的另一種樣子(integration)
(b) Related — 反例是 quality 的 boundary(coexistence)
(c) Contradictory — 反例違反 quality(boundary clarification)

每個反例都跑一遍三向歸類、output 決定 quality 的 expanded definition。

從 step 2d 學員初步分類(a/b/c)、進入細化:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**路徑 (a) Consistent — 學員初步認為一致**:

AI 話術:
> 「你說這個反例是『[top1_value]』的另一面——
> 那它具體怎麼是?
> 給我一句話:『這個反例其實是我在 X、X 也是「[top1_value]」』。」

→ 強迫學員用一句話 reframe、AI 不替學員想
→ Haiku A5.containment_logic_judge 評估這個 reframe 是否合理
→ 通過 → 反例 integrated、繼續下個反例
→ 不通過 → 退回問:「再想想、這真的是『[top1_value]』嗎、還是是其他?」
         → 可能 cascade 到路徑 (b) 或 (c)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**路徑 (b) Related — 學員初步認為相關但不一致**:

AI 話術:
> 「你說這個反例不是『[top1_value]』、但相關——
> 我想釐清:它是『[top1_value]』的什麼?
> (1) 它的 boundary(我『[top1_value]』、但不到這個程度)
> (2) 它的 cost(我『[top1_value]』、所以承擔這個代價)
> (3) 它的 trigger(當 X 發生、我不『[top1_value]』、那是觸發、不是真我)」

→ 學員選一個、AI 寫進 self_concept_progress
→ 反例 contextualized、不需要 integrated 也不需要 reject
→ 繼續下個反例

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**路徑 (c) Contradictory — 學員初步認為矛盾**:

AI 話術:
> 「你說這個反例違反『[top1_value]』——
> 我想停一下、確認:
> 是這個反例**真的違反**『[top1_value]』、
> 還是『[top1_value]』的定義不夠大?
>
> 例:你的 top1_value 是『踏實』、反例是『去年我衝動辭職』——
> 是『衝動辭職』違反『踏實』、
> 還是『踏實』的定義太窄、應該包含『該行動時的決斷』?
>
> 你覺得是哪個?」

→ 學員回應分支:
  - 「定義太窄」→ expand quality definition、寫進 anchors
  - 「真的違反」→ 反例 rejected、寫進 negative_examples
    → 注意:rejected 多次(>= 3)= quality 認領可能有問題、cascade 回 Phase 1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Cross-engine active**:
- A5.containment_logic_judge(路徑 (a) reframe 合理性評估)
- 引擎 1 E1c PPL 治理(學員過度配合三向歸類、隨便選類別)

**State updates during step**:
session_state.self_concept_progress.triangulation_results: append {
  counter_example: str,
  learner_initial_classification: enum,
  final_classification: enum["consistent", "boundary", "cost", "trigger", "rejected", "definition_expanded"],
  expanded_definition: str | null  // 若觸發 expand
}
session_state.counter_examples_list[i].learner_initial_classification: updated

**Exit to Step 4**:
- 所有 counter_examples_list 都跑完三向歸類
- 學員確認無新反例
- 或 session_day_count_within_phase 已接近 max(自然收尾)

**Edge cases**:
- 反例 rejected >= 3:
    quality 認領有問題、cascade A3 handoff:
    「我們已經 3 個反例都違反『[top1_value]』——
    這可能是我們選錯了 top value、想跟你確認:
    (a) 換另一個 value 試(回 Phase 1 step 3)
    (b) 我們繼續、可能它本來就是個 ambiguous quality
    你選哪個?」
- 整 step 全部走路徑 (a):
    可能是 PPL 過度配合、引擎 1 E1c 警示、HITL alert
    話術:
    「我注意到你所有反例都說『是 [top1_value] 的另一面』——
    我想 push back:有沒有真的是『不是』的時刻?
    我們需要一個 contradiction 才能定義邊界。」`;

export const FINAL_CLASSIFICATIONS = Object.freeze([
  'consistent',           // 路徑 (a) 通過
  'boundary',             // 路徑 (b) (1)
  'cost',                 // 路徑 (b) (2)
  'trigger',              // 路徑 (b) (3)
  'rejected',             // 路徑 (c) 真的違反
  'definition_expanded',  // 路徑 (c) 定義太窄
]);

export default {
  id: 'CP1_phase_3b_three_way_triangulation',
  type: 'conditional_inject',
  dispatch_mode: 'phase_context',
  phase: 'phase_3b',
  sub_step: 'step_3_three_way_triangulation',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 620,
  original_ip: '#3 三向歸類',  // ⭐⭐ v5.0 原創 IP
  haiku_judge_used: 'A5_containment_logic',  // 路徑 (a) reframe 評估
  final_classifications: FINAL_CLASSIFICATIONS,
  parse_state_patch: {
    description: 'Append self_concept_progress.triangulation_results; update counter_examples_list[i].final_classification; expand quality definition on 路徑 (c) 定義太窄',
    affects: [
      'session_state.self_concept_progress',
      'session_state.counter_examples_list',
      'user_profile_evolution.anchors',  // on definition_expanded
    ],
  },
  inputs_from_state: [
    'session_state.top1_value',
    'session_state.counter_examples_list',
    'session_state.self_concept_progress',
    'session_state.last_user_response',
  ],
  damon_source: [
    'CP1 turn 2 §9.5 step_3_three_way_triangulation',
    'v5.0 原創 IP #3 三向歸類完整 spec',
    'Damon: 反例不是錯誤、是 quality 的 boundary 延伸',
  ],
};
