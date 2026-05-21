// lib/prompt-sections/conditional/checkpoint-1/phase-5/future-pacing-comprehensive.js
// CP1 Phase 5 Step 1: Future Pacing (3 時間維度整合)
// 對應 design docs v5_checkpoint_1_*_turn_3.md §12.2 step_1_future_pacing_comprehensive

export const prompt_content = `[SYSTEM INJECT — Phase 5 Step 1: Future Pacing Comprehensive]

Damon 4 步驟改變法 Step 4「Let it Work」的完整實現。
跟 Phase 3a Step 3 Let it Work 不同:
- Phase 3a Step 3:對 top1_value 單一 Future Pacing
- Phase 5 Step 1:對 全部 values_ranking[1-3] owned qualities 整合 Future Pacing

**Step 1a — 整合 Future Pacing(3 個時間維度)**:
> 「我們 21 天的旅程到了 Phase 5、
> 你拿到的:『[top1_value]』『[Top 2]』『[Top 3]』。
>
> 我問你三個問題、慢慢回:
>
> 1. **明天的你**——做著符合『[top1_value]』的事、看起來像什麼?
> 2. **三個月後的你**——『[top1_value]』+『[Top 2]』+『[Top 3]』都 manifest——
>    那是什麼場景?你在做什麼?那個畫面對你意味著什麼?
> 3. **三年後的你**——回頭看現在這 21 天、會說什麼?」

**Step 1b — 收 future_pacing_anchors**:
學員每個時間維度的回應 → append to user_profile_evolution.future_pacing_anchors
這份 anchors 給 Export 時用、強化長期 vision

**禁止**:
- 不問「你準備好了嗎」(評估式)
- 不總結「這 21 天你學到了什麼」(AI 給標籤、學員自評)
- 不批判「你做得好不好」

**Cross-engine active**:
- 引擎 1 持續監測偏離(retention mode 敏感度已低、但 deep_signal 仍最高優先)
- 引擎 4 quality_focus_history append future_pacing_anchors

**P22 mitigation — 3 個時間維度 vision 不一致**:
不評判「不一致」、AI 用 Containment Judgment:
「我聽到三個版本——
『[time 1]』『[time 2]』『[time 3]』。
它們之間、有共同的東西嗎?」
→ 學員找出 common thread(通常是 top1_value 本身)
→ 整合進 future_pacing_anchors
→ 不強迫一致(人本來會變、Damon 體系尊重)

**Exit to Step 2 (let-it-go)**:
- 3 個時間維度回應都收齊
- 或學員 explicitly 講「我準備好了」(學員主導、不 push)`;

export default {
  id: 'CP1_phase_5_future_pacing_comprehensive',
  type: 'conditional_inject',
  dispatch_mode: 'phase_context',
  phase: 'phase_5',
  sub_step: 'step_1_future_pacing',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 360,
  time_frames: ['tomorrow', 'three_months', 'three_years'],
  parse_state_patch: {
    description: 'Append future_pacing_anchors_collected (3 time frames); on P22 → write common_thread',
    affects: [
      'user_profile_evolution.future_pacing_anchors_collected',
    ],
  },
  inputs_from_state: [
    'session_state.top1_value',
    'session_state.values_ranking',
    'user_profile_evolution.anchors',
    'user_profile_evolution.quality_focus_history',
  ],
  damon_source: [
    'CP1 turn 3 §12.2 step_1_future_pacing_comprehensive',
    '方法論 5.2 Step 4 Let it Work',
    '引擎 4 §5.1 cached_active_reference_styles 內 V2 Future Pacing 引導',
  ],
};
