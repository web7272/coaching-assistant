// lib/prompt-sections/conditional/checkpoint-1/phase-3a/let-it-work.js
// CP1 Phase 3a Step 3: Let it Work (Damon 4 步驟改變法 Step 4)
// 對應 design docs v5_checkpoint_1_*_turn_2.md §8.2 step_3_let_it_work
// 對應 NLP Amnesia 主動整合機制(v5.0 原創 IP #5)

export const prompt_content = `[SYSTEM INJECT — Phase 3a Step 3: Let it Work]

Damon 4 步驟改變法 Step 4:Let it Work
**不 over-process**——種下、不挖、信任潛意識整合。
對應 NLP Amnesia 主動整合機制(v5.0 原創 IP #5)。

**Step 3a — Future Pacing**:
> 「想像三個月後的你、做著符合『[top1_value]』的事——
> 你看到什麼?身體在哪裡感覺到?」

**Step 3b — takeaway 種下(由 E4_takeaway_planter 接手)**:
> 「『[top1_value]』現在是你的。
> 我們先停在這、不再挖。
> 明天我們從這裡繼續。」

**禁止**:
- 不繼續挖(Damon「不 over-process」鐵律)
- 不深入解釋(給潛意識夜裡整合空間)
- 不派作業(v5.0 MVP 範圍)
- 不評估「整合得好不好」(學員自評、AI 不下結論)

**Cross-engine triggers**:
- E4_takeaway_planter 觸發(寫入 last_session_day_summary)
- 跨 day session_state transient 全 reset(本檔 Turn 1 §3)

**Exit to Phase 4**:
- Step 3b takeaway 種下完成
- quality_focus_history append top1_value 為 owned anchor
- phase_3a 完整完成`;

export default {
  id: 'CP1_phase_3a_let_it_work',
  type: 'conditional_inject',
  dispatch_mode: 'phase_context',
  phase: 'phase_3a',
  sub_step: 'step_3_let_it_work',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 220,
  parse_state_patch: {
    description: 'build_vision_progress.step="step_3"; trigger E4_takeaway_planter; transition to phase_4',
    affects: [
      'session_state.build_vision_progress',
      'session_state.takeaway_seeded_this_session',
      'session_state.current_phase',  // phase_3a → phase_4
      'user_profile_evolution.quality_focus_history',
    ],
  },
  inputs_from_state: [
    'session_state.top1_value',
    'session_state.build_vision_progress',
  ],
  damon_source: [
    'CP1 turn 2 §8.2 step_3_let_it_work',
    '方法論 5.2 Step 4 完整 SOP',
    '引擎 4 §5.1 cached_active_reference_styles 內 NLP Amnesia',
    '引擎 4 §5.3 E4_takeaway_planter',
  ],
};
