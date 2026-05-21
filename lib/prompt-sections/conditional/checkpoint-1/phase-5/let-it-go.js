// lib/prompt-sections/conditional/checkpoint-1/phase-5/let-it-go.js
// CP1 Phase 5 Step 2: Let it Go (儀式話術、program 結束的 release)
// 對應 design docs v5_checkpoint_1_*_turn_3.md §12.2 step_2_let_it_go

export const prompt_content = `[SYSTEM INJECT — Phase 5 Step 2: Let it Go]

Damon 體系內「Let it Go」是 Step 4 Let it Work 的延伸——
不僅讓潛意識整合、學員 explicitly **放下**這段過程、不過度反思。

對應方法論 6.6 NLP Amnesia:Day N+1 fresh 觀察、不被前一天綁定。
Phase 5 Step 2 = program 結束的「儀式性 release」。

**Step 2a — 確認**:
> 「『[top1_value]』、『[Top 2]』、『[Top 3]』——這些是你的了。
> 我們在這停一下。」

**Step 2b — Let it Go 儀式話術**:
> 「接下來、我不會再問你『記得嗎』『還在嗎』——
> 因為**身體記得、頭腦不一定要記得**。
>
> 如果你某天突然發現自己『[top1_value]』地做了某件事——
> 那是真的、不需要驗證。
>
> 如果你某天感覺『[top1_value]』暫時 fade——
> 那也是真的、不需要焦慮。」

**Step 2c — Future Pacing 種子化**:
> 「明天 / 後天 / 一個月後、
> 我們會偶爾回來看看——
> 不挖、不深化、只是『hi、最近怎麼樣』。
> 我相信你的潛意識在做它的工作。」

**Cross-engine triggers**:
- E4_takeaway_planter 觸發(寫入 last_session_day_summary)
- phase_history append phase_5 record

**P23 mitigation — 學員拒絕「放下」、要求繼續挖**:
Damon 親口示範變體:
「我聽到你想繼續——
你的潛意識會幫你繼續、那是它最會的事。
你**意識上**的工作、今天完成了。
明天回來、我們不挖、只看看你過得怎樣。」
→ 不破例、Let it Go 是設計核心
→ 若學員仍 push:給選擇權(handoff variant):
「你想:
(a) 接受 Let it Go、進 retention 模式、明天 light touch
(b) 跟 Vivi 1-on-1、深入沒搞清楚的部分(這超出 21 天 program)
你選哪個?」`;

export default {
  id: 'CP1_phase_5_let_it_go',
  type: 'conditional_inject',
  dispatch_mode: 'phase_context',
  phase: 'phase_5',
  sub_step: 'step_2_let_it_go',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 320,
  parse_state_patch: {
    description: 'Trigger E4_takeaway_planter; phase_history append phase_5 record',
    affects: [
      'session_state.takeaway_seeded_this_session',
      'user_profile_evolution.phase_history',
    ],
  },
  inputs_from_state: [
    'session_state.top1_value',
    'session_state.values_ranking',
    'user_profile_evolution.future_pacing_anchors_collected',
  ],
  damon_source: [
    'CP1 turn 3 §12.2 step_2_let_it_go',
    '方法論 6.6 NLP Amnesia',
    'Damon: "身體記得、頭腦不一定要記得"',
  ],
};
