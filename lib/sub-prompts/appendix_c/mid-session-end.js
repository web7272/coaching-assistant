// lib/prompt-sections/conditional/checkpoint-1/appendix-c/mid-session-end.js
// CP1 附錄 C.2.2: 想結束 session 中段時機 (reasonable mid-session end、給選擇權)
// 對應 design docs v5_checkpoint_1_*_turn_3.md §13 C.2.2
//
// 注意: mid_session_takeaway_count 是 phase-scoped (per Q1 5/21 errata)、
// reset_on: phase exit (不是 new_session_day)。PR-4b 會 patch P0 day-boundary。

export const prompt_content = `[SYSTEM INJECT — Appendix C.2.2: Mid-Session End]

學員主動想結束 session、**但還沒到 takeaway 時機**。
跟引擎 1 explicit_protest「可以結束嗎」不同(那是緊急退場、handoff variant)、
本情境是學員 reasonable 想中段休息、AI 應該給選擇權。

**Trigger signals (mid_session_end_request)**:
- 「今天先到這吧」
- 「我累了、改天繼續」
- 「先停這、明天再說」
- 「我有事要忙了」
- 「我們進度差不多了吧?」

**區分 vs 緊急退場**:
explicit_protest「可以結束嗎」(伴隨情緒 / 困擾)→ 緊急退場、cascade handoff
本情境(無情緒 / reasonable)→ 中段收尾、給選擇權

**AI 話術骨架(依當前 phase 進度判斷)**:

若 session_day_count_within_phase 才剛開始(< midpoint):
> 「OK、今天比較短。
> 我們在 [phase 名]、剛挖到 [progress 摘要]。
>
> 你想:
> (a) 我幫你 Future Pacing 一下、明天從這延續
> (b) 直接停、明天從頭開始這個 phase
>
> 你選哪個?」

若 session_day_count_within_phase 接近 midpoint(可順勢做小 takeaway):
> 「OK。我幫你做個小 takeaway:
> 你今天說了『[抓 key 句子]』。
> 這個你帶著走、明天我們從這繼續。」
→ 觸發 E4_takeaway_planter mini 版本(non-final takeaway)
→ 不寫入 quality_focus_history 升級(因為 phase 沒完成)
→ session_state.mid_session_takeaway_count: +1

若 session_day_count_within_phase 接近 max(可能是 phase exhaustion):
> 「我聽到你想停——
> 我們在 [phase 名] 第 [N] 天了、
> 你覺得這個 phase 是要繼續、還是 stuck?
>
> (a) 繼續、明天從這
> (b) Stuck、我們換個方式(可能 cascade A3)
> (c) 跟 Vivi 1-on-1 評估」

**State field (Q1 5/21 errata)**:
session_state.mid_session_takeaway_count 是 **phase-scoped**(不是 cross-day reset):
- scope: session-scoped (但跨 day 不 reset、phase 進度保留)
- reset_on: phase exit
- threshold: >= 3 in same phase → dashboard 警示(phase engagement 低、可能設計問題)

**Phase-applicability**:
- 所有 phase 都可能觸發
- Phase 3b ambiguous path 最常見(該 phase 最長、學員疲勞)
- Integration Retention Mode 期間頻繁正常(retention 期 light touch 設計就是如此)

**Failure mode C2 — 學員每天都中段結束**:
mid_session_takeaway_count 連續 3+ 觸發:
AI 主動關切:
「我注意到我們這幾天 session 都比較短——
是你最近忙、還是這個 phase 對你來說太重?

你想:
(a) 繼續、慢慢來、不催
(b) 換個方式(我們可能要重新看 phase 設計)
(c) 暫停 program 幾天、再回來
你選哪個?」
→ respect 學員節奏、不強推 21 天完成
→ calendar_day_count 仍在跑、Day 21 program end 不變`;

export default {
  id: 'CP1_appendix_c_mid_session_end',
  type: 'conditional_inject',
  dispatch_mode: 'scenario_inject',
  phase: 'appendix_c',
  sub_step: 'C.2.2_mid_session_end',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 480,
  mid_session_takeaway_count_scope: 'phase-scoped (Q1 5/21 errata、reset_on: phase exit)',
  parse_state_patch: {
    description: 'Increment mid_session_takeaway_count; on >=3 in same phase → dashboard warning + AI 主動關切',
    affects: [
      'session_state.mid_session_takeaway_count',
      'session_state.takeaway_seeded_this_session',  // mini takeaway 觸發
    ],
  },
  inputs_from_state: [
    'session_state.current_phase',
    'session_state.phase_progress',
    'session_state.mid_session_takeaway_count',
    'session_state.last_user_response',
  ],
  damon_source: ['CP1 turn 3 §13 附錄 C.2.2'],
};
