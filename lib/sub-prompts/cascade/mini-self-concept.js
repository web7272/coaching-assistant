// lib/prompt-sections/conditional/checkpoint-1/phase-4/mini-self-concept.js
// CP1 Phase 4 Step 2 variant: mini Self-Concept (對 Top 2/3 子 Phase 3b)
// 對應 design docs v5_checkpoint_1_*_turn_2.md §11.2 step_2_top2_branch

export const prompt_content = `[SYSTEM INJECT — Phase 4 Step 2 Variant: Mini Self-Concept]

若 Top 2 (或 Top 3) E3_cascade_mode_validator 判 failed_need_self_concept:
→ cascade 到子 Self-Concept 模型(對 Top 2 跑 mini Phase 3b)
→ mini Self-Concept 用 **Top 1 owned** 作為 reference quality(節省時間)
→ mini Phase 3b 完成 → 回 step 1 重測 Top 2

**Mini Phase 3b 簡化**:
- Step 1 Mapping Across:reference quality 預設 = Top 1(已 owned)
- Step 2 反例整合:focus 在 Top 2 跟 Top 1 的差異
- Step 3 三向歸類:對 Top 2 反例做 6 種 final_classification
- Step 4 Scope Overlap:expanded definition for Top 2

完成後回 Phase 4 step 1 重測 Top 2 身份測試。

**Mini Phase 3b 重複失敗 2 次 → handoff variant**:
> 「『[Top 2 value]』反覆不通過——
> 我們有兩個選擇:
> (a) 接受 Top 2 是 ambiguous、不強推 owned、繼續看 Top 3
> (b) 暫停 Cascade Down、跟 Vivi 評估排序是否需要調整
> 你選哪個?」

**禁止**:
- 不對 Top 4/5 做 Cascade Down(Damon 體系:Top 1-3 是核心、Top 4-5 是輔助)
- 不對 Top 2 跑 full Phase 3b(浪費時間、用 mini 版本即可)`;

export default {
  id: 'CP1_phase_4_mini_self_concept',
  type: 'conditional_inject',
  dispatch_mode: 'phase_context',
  phase: 'phase_4',
  sub_step: 'step_2_mini_self_concept',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 220,
  parse_state_patch: {
    description: 'Cascade to mini Phase 3b sub-flow; track retry count; after 2 fails → handoff variant',
    affects: [
      'session_state.self_concept_progress',  // 重用、但是 mini version
      'session_state.cascade_down_progress',
      'session_state.handoff_triggered_count',  // on 2nd fail
    ],
  },
  inputs_from_state: [
    'session_state.top1_value',
    'session_state.values_ranking',
    'session_state.cascade_down_progress',
  ],
  damon_source: [
    'CP1 turn 2 §11.2 step_2_top2_branch',
    'Damon: 對 Top 2 / Top 3 失敗 → mini Self-Concept',
  ],
};
