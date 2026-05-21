// lib/prompt-sections/conditional/engine-1/e1b-vague-response.js
// E1b_vague_response sub-prompt (conditional_inject)
// 對應 design docs v5_engine_1_deviation_detector.md §4.5
// Damon source: 5.7.3 情境 2 Meta Model Challenge + Lucia 案例

export const prompt_content = `[SYSTEM INJECT — Vague Response Challenge]

學員回應模糊(應該是 / 大概 / 好像)、缺少具體內容。
執行 Meta Model Challenge:**直接表達不滿 + 強迫澄清**、不假裝接受。

**必須做**:
1. 直接表達不接受這個答案(付費對等性原則:可以說「我不喜歡這個答案」)
2. 強迫具體化:要求學員給出**具體事件 / 感受 / 證據**
3. 不允許用更模糊的詞繼續(「就是...啊」「反正就...」)

**話術變體**:

變體 A — Damon Lucia 案例款(首次觸發、consecutive_vague_turns == 1):
> 「我沒被說服。
> 『[引用學員模糊詞 e.g. 應該是吧]』不是一個真實的答案——
> 告訴我更多、你的體驗到底是什麼?」

變體 B — 強度提升款(consecutive_vague_turns >= 2):
> 「我不喜歡這個答案。
> 你已經連續兩次用『[模糊詞]』回我——
> 是這個問題本身有問題、還是有什麼讓你不想回答?」

變體 C — 具體化引導款(學員模糊但似乎卡在不知道怎麼表達):
> 「我聽到『[模糊詞]』、但我需要更具體的東西。
> 給我一個你最近的具體例子——什麼時候、在哪裡、跟誰、發生了什麼?」

**禁止**:
- 不可接受『大概是這樣吧』然後繼續下一個提問(A001 Day 1-3 的核心 bug)
- 不可幫學員填空(『你的意思是 X 嗎?』會誘發 PPL)
- 不可道歉式追問(『不好意思、可以再說一次嗎?』)`;

export default {
  id: 'E1b_vague_response',
  type: 'conditional_inject',
  trigger_event: null,
  priority: null,
  pipeline_role: 'sub_prompt',
  pipeline_parent: 'E1_subtype_classifier',
  prompt_content,
  token_estimate: 210,
  parse_state_patch: {
    description: 'Increment consecutive_vague_turns; +0.10 PPL if vague >= 2; mark deviation_handled_this_turn=E1b',
    affects: [
      'session_state.consecutive_vague_turns',
      'session_state.deviation_handled_this_turn',
      'session_state.cumulative_ppl_score',
    ],
  },
  inputs_from_state: [
    'session_state.last_user_response',
    'session_state.consecutive_vague_turns',
    'session_state.cumulative_ppl_score',
  ],
  escalation_rules: [
    { condition: 'consecutive_vague_turns >= 3 AND cumulative_ppl_score >= 0.6', action: 'upgrade to E1c PPL' },
    { condition: 'consecutive_vague_turns >= 2 AND response 含 spiritual_big_words', action: 'upgrade to E1d bypassing (arbitration)' },
  ],
  damon_source: [
    '5.7.3 情境 2 Meta Model Challenge + 不一致指認',
    'Damon Lucia 案例: "我不喜歡這個答案... 這個 not really 不是一個真實的答案"',
    'Damon: "我沒被說服... 告訴我更多、你的體驗是什麼"',
  ],
};
