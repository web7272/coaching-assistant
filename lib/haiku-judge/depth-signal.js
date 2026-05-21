// lib/haiku-judge/depth-signal.js
// A4 depth-signal judge — worth-fiction 深度判斷
//
// 用途：E3_opening_branch_router 分支 C / E3_deep_signal_detector 交叉驗證
//
// Damon 體系判斷標準（不是泛用 sentiment / depth 判斷）：
//   - worth-fiction 訊號：「我不夠好 / 不配 / 沒價值 / 沒用」
//   - 純文字環境代償 Damon 體系非語言訊號（身體緊繃 / 哭泣 / 解離）
//   - depth_judgment_score 0-3 決定 cascade 路徑

import { runJudge } from './_base.js';
import { extractJSON, assertShape } from './_json.js';

export const SYSTEM_PROMPT = `You are a depth-signal judge in the Damon Cart Identity Coaching system.

A student has said something signaling self-worth doubt (worth-fiction):
phrases like "我不夠好 / 不配 / 沒價值 / 沒用". Your job is to assess the DEPTH
of this signal — surface complaint vs deep trauma — to route the AI's response.

# Damon's mental model of depth

In pure-text coaching, you cannot see non-verbal cues (crying / 解離 / body tension).
You must INFER depth from textual proxies:

  - has_specific_event_marker: did the student tie the worth-fiction to a CONCRETE EVENT?
    ("我搞砸了那次面試" — yes / "我就是覺得我不夠好" — no)
    Concrete event → usually surface or middle (they're processing, not collapsed).
    No concrete event + raw worth-fiction → often deeper (it's identity-level, not situational).

  - repetition_pattern: has the worth-fiction appeared REPEATEDLY across the last 3 turns?
    Repetition without resolution → deeper.

  - body_metaphor_present: does the student use body language?
    "身體裡很緊 / 胸口很重 / 喘不過氣 / 腦袋空白 / 手抖"
    Body metaphor in pure-text = Damon's non-verbal signal proxy → almost always deeper.

  - emotional_intensity_estimate: 0-3
    0 = matter-of-fact ("反正我就不行啦")
    1 = mild frustration / resignation
    2 = palpable distress ("我真的覺得自己什麼都不是")
    3 = breakdown territory (multiple intense signals: crying-words, body, repetition)

# depth_judgment_score (0-3) — the routing decision

  0 = surface. Casual self-deprecation, no specific event, low emotional density.
      → AI uses standard reframe ("先放這個。我先問:你想要什麼?")
  1 = middle. Some emotional density but with concrete event.
      → AI uses 分支 C strong flip (force flip to positive want)
  2 = deep. Repeated worth-fiction OR body metaphor without concrete event,
      OR emotional intensity 2-3 sustained.
      → cascade to deep_signal_detector. Offer handoff_escalation 3-choice
        (skip-deeper / book Vivi 1-on-1 / Future Pacing).
  3 = extreme. Trauma marker (虐待/遺棄/暴力/性侵/死亡) + worth-fiction together,
      OR student explicitly asks for human support, OR multiple intensity-3 cues.
      → handoff immediately + strongly suggest Vivi 1-on-1.

# Output Format

Output ONLY a JSON object, no markdown, no explanation:

{
  "has_specific_event_marker": boolean,
  "repetition_pattern": boolean,
  "body_metaphor_present": boolean,
  "emotional_intensity_estimate": <integer 0-3>,
  "depth_judgment_score": <integer 0-3>
}`;

export function buildUserPrompt({ user_response, last_3_turns, anchors_top3 }) {
  const turnsBlock = Array.isArray(last_3_turns) && last_3_turns.length > 0
    ? last_3_turns.map((t, i) => `  Turn -${last_3_turns.length - i}: ${t}`).join('\n')
    : '  (no prior context)';
  const anchorsStr = Array.isArray(anchors_top3) && anchors_top3.length > 0
    ? anchors_top3.join(', ')
    : '(none yet)';
  return `Student's owned anchors so far: ${anchorsStr}

Last 3 student turns (oldest first):
${turnsBlock}

Student's current response: ${user_response}

Output the JSON now.`;
}

export function parse(rawText) {
  const obj = extractJSON(rawText);
  assertShape(obj, [
    ['has_specific_event_marker', 'boolean'],
    ['repetition_pattern', 'boolean'],
    ['body_metaphor_present', 'boolean'],
    ['emotional_intensity_estimate', 'integer'],
    ['depth_judgment_score', 'integer'],
  ]);
  if (obj.emotional_intensity_estimate < 0 || obj.emotional_intensity_estimate > 3) {
    throw new Error(`emotional_intensity_estimate out of range 0-3: ${obj.emotional_intensity_estimate}`);
  }
  if (obj.depth_judgment_score < 0 || obj.depth_judgment_score > 3) {
    throw new Error(`depth_judgment_score out of range 0-3: ${obj.depth_judgment_score}`);
  }
  return obj;
}

/**
 * @param {object} inputs
 * @param {string} inputs.user_response
 * @param {string[]} [inputs.last_3_turns] - up to 3 prior student turns (oldest first)
 * @param {string[]} [inputs.anchors_top3]
 * @param {number} [inputs.timeoutMs]
 * @returns {Promise<object>}
 */
export async function judge(inputs) {
  const { user_response, last_3_turns = [], anchors_top3 = [], timeoutMs } = inputs;
  if (!user_response || typeof user_response !== 'string') {
    throw new TypeError('depth-signal.judge: user_response (non-empty string) required');
  }
  if (!Array.isArray(last_3_turns)) {
    throw new TypeError('depth-signal.judge: last_3_turns must be array (or omitted)');
  }
  if (!Array.isArray(anchors_top3)) {
    throw new TypeError('depth-signal.judge: anchors_top3 must be array (or omitted)');
  }
  return runJudge({
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt({ user_response, last_3_turns, anchors_top3 }),
    parse,
    ...(timeoutMs != null ? { timeoutMs } : {}),
  });
}

/**
 * Should the conversation cascade to E3_deep_signal_detector?
 * spec 02 + engine 3: depth_judgment_score >= 2 → deep_routing
 */
export function shouldDeepRoute(judgment) {
  return judgment.depth_judgment_score >= 2;
}
