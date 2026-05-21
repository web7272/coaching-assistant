// lib/haiku-judge/takeaway-sentiment.js
// A6 takeaway-sentiment judge — session 收尾 takeaway 種下後、判 sentiment
//
// 用途：E4_takeaway_planter 收尾後 / finalize-day.js
//
// Damon dashboard 信號 1（方法論 6.10）：
//   累積 3 場 negative takeaway → user_profile_evolution.negative_takeaway_count >= 3
//   → critical HITL alert（不是 prompt 調整可解、是架構重審訊號）
//
// A001 親測 Day 3 留下「無力」= Damon 視角下「教練做錯了」的明確 indicator。
// 「無力 / 累 / 沒用 / 算了 / 也只能這樣 / 反正」這類詞 = negative、不是 neutral。

import { runJudge } from './_base.js';
import { extractJSON, assertShape } from './_json.js';

export const SYSTEM_PROMPT = `You are a takeaway-sentiment judge in the Damon Cart Identity Coaching system.

At the end of a coaching session, the AI plants a takeaway — an anchor word
the student is supposed to carry forward. Your job is to assess the student's
EMOTIONAL STATE around that takeaway: positive, neutral, or negative.

This is NOT generic sentiment analysis. It's calibrated to Damon's failure-signal
monitoring (方法論 6.10): 3 negative takeaways in a row = the coaching is failing
the student at an architectural level, not a prompt-tuning level.

# Calibration rules

## negative — A001 "無力" 判準

If the student leaves with a worse state than they came in, that's negative.
Signal words / phrases (any one is sufficient):
  - 無力 / 沒力 / 累 / 算了 / 也只能這樣 / 反正
  - 「沒辦法 / 沒救 / 不會變」
  - 沒用 / 白費 / 浪費時間
  - "我不想再講了" / "今天不想了"（when paired with deflated tone, not just tired）

These are NOT neutral fatigue. They're "the coaching made it worse" — explicitly
flagged in A001 Day 3 as the reversal signal Damon would call out.

ALSO negative:
  - Student takes the anchor but contradicts it: "好啦, 我帶走『勇敢』... (sigh) 雖然我覺得我還是不敢"
  - Student deflects with politeness mask: "嗯, 好的, 謝謝" — but ONLY if context (prior 2-3 turns)
    showed visible disengagement / shutdown. Politeness alone is not negative.

## positive

Affective language tied to the takeaway, with energy:
  - "我帶走『[anchor]』" said with anticipation
  - Student spontaneously ELABORATES the anchor ("『發光』... 對, 我今天回去想想這個")
  - "想到明天" / "好期待" — forward-looking energy
  - Light tone, sometimes laughter / "haha" / "誒對"

## neutral

Polite acknowledgment without engagement:
  - "嗯 / 好 / 知道了 / OK"
  - Student took the anchor word but didn't visibly LIGHT UP and didn't visibly SHUT DOWN
  - Most "fine" outcomes — the modal session

# Output Format

Output ONLY a JSON object, no markdown, no explanation:

{
  "takeaway_sentiment": "positive" | "neutral" | "negative"
}`;

export function buildUserPrompt({ takeaway_term, session_end_context }) {
  return `Takeaway anchor planted by the AI: "${takeaway_term}"

Session end context (last 2-3 turns of the conversation, oldest first):
${session_end_context}

Output the JSON now.`;
}

export function parse(rawText) {
  const obj = extractJSON(rawText);
  assertShape(obj, [
    ['takeaway_sentiment', ['positive', 'neutral', 'negative']],
  ]);
  return obj;
}

/**
 * @param {object} inputs
 * @param {string} inputs.takeaway_term
 * @param {string} inputs.session_end_context
 * @param {number} [inputs.timeoutMs]
 * @returns {Promise<object>}
 */
export async function judge(inputs) {
  const { takeaway_term, session_end_context, timeoutMs } = inputs;
  if (!takeaway_term || typeof takeaway_term !== 'string') {
    throw new TypeError('takeaway-sentiment.judge: takeaway_term (non-empty string) required');
  }
  if (!session_end_context || typeof session_end_context !== 'string') {
    throw new TypeError('takeaway-sentiment.judge: session_end_context (non-empty string) required');
  }
  return runJudge({
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt({ takeaway_term, session_end_context }),
    parse,
    ...(timeoutMs != null ? { timeoutMs } : {}),
  });
}

/**
 * Should this contribute to the dashboard signal-1 negative counter?
 * (Caller: finalize-day.js / E4_takeaway_planter post-hook)
 */
export function isNegative(judgment) {
  return judgment.takeaway_sentiment === 'negative';
}
