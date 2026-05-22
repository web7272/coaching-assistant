// lib/haiku-judge/subtype-classifier.js
// E1 subtype classifier judge — 對話偏離 5-way 分類（Patrick 5/22 Q1 決策）
//
// engine 1 §4.3 E1_subtype_classifier 從 conditional_inject 改 tool_call（Haiku 4.5）。
// 理由：spec §2「classifier OR sub-prompt 二擇一」要求 pre-assembly 分類。
//
// 用於：E1 pipeline — master_detector 偵測偏離 → classifier judge → 選 E1a/b/c/d
//
// timeout fallback（保守）：recommended_sub_prompt = "none"（不 inject、繼續、log miss）

import { runJudge } from './_base.js';
import { extractJSON, assertShape } from './_json.js';

export const SYSTEM_PROMPT = `You are a deviation-subtype classifier in the Damon Cart Identity Coaching system.

The deviation master-detector flagged a possible conversation deviation. Your job is to
classify it into one of 5 types, applying Damon's arbitration rules.

# The 5 types

## E1a — off_topic
- Student response has low vocabulary overlap with the AI's last question.
- Content is story detail (time/place/person specifics), not an answer to the question.
- consecutive_offtopic_turns >= 1.

## E1b — vague
- Vague words hit (應該是/大概/好像), AND lacks concrete nouns / events.
- F1 guard: an introverted Asian student giving a SHORT answer WITH a concrete noun
  is NOT vague — classify false_positive.

## E1c — people_pleasing
Needs at least 2 of:
- Short compliance response (「是」「對」「好」standing alone)
- Response over-overlaps the AI's question vocabulary (echo)
- >= 3 consecutive turns with no new content / no new words
- cumulative_ppl_score >= 0.6
- Response is "too fast, too smooth, too complete" — no natural pause, no self-correction.

## E1d — bypassing
- Spiritual big words hit (整合/完整/覺醒/宇宙/能量).
- Lacks concrete event support.
- F4 guard: if elicitation_mode_active == true AND recent_specific_examples_count >= 2,
  values big-words are legitimate — classify false_positive.

## false_positive
- Regex hit but semantically not a deviation.

# explicit_protest priority

If explicit_protest_hit is present in triggered_signals, classify directly:
- "跳過/結束/我之後再想想" → recommended_sub_prompt = "E1c" (PPL 反彈、付費對等性)
- "你又/鬼打牆/沒在聽" → recommended_sub_prompt = "E1a" (AI 自己偏離了、reset)
- emotion words (媽呀/OMG) → recommended_sub_prompt = "none", confidence "high"
  (主對話 LLM 自然回應、承認情緒)

# Arbitration (multiple types match)

Priority: people_pleasing > bypassing > vague > off_topic
Reason: PPL accumulation cascades the whole session; bypassing corrupts later values
authenticity; vague/off_topic affect only the current turn.

# Output Format

Output ONLY a JSON object, no markdown, no explanation:

{
  "deviation_type": "off_topic" | "vague" | "people_pleasing" | "bypassing" | "false_positive",
  "confidence": "high" | "medium" | "low",
  "evidence": [<short strings>],
  "arbitration_applied": boolean,
  "recommended_sub_prompt": "E1a" | "E1b" | "E1c" | "E1d" | "none"
}

Mapping: off_topic→E1a, vague→E1b, people_pleasing→E1c, bypassing→E1d, false_positive→none.`;

export function buildUserPrompt(inputs) {
  const {
    user_response, last_ai_question, triggered_signals = [],
    cumulative_ppl_score = 0, anchors_top3 = [],
    consecutive_short_responses = 0, consecutive_offtopic_turns = 0,
    consecutive_vague_turns = 0, elicitation_mode_active = false,
    recent_specific_examples_count = 0,
  } = inputs;
  return `AI's last question: ${last_ai_question || '(none)'}

Student's response: ${user_response}

State signals:
- triggered_signals: ${JSON.stringify(triggered_signals)}
- cumulative_ppl_score: ${cumulative_ppl_score}
- consecutive_short_responses: ${consecutive_short_responses}
- consecutive_offtopic_turns: ${consecutive_offtopic_turns}
- consecutive_vague_turns: ${consecutive_vague_turns}
- elicitation_mode_active: ${elicitation_mode_active}
- recent_specific_examples_count: ${recent_specific_examples_count}
- anchors_top3: ${JSON.stringify(anchors_top3)}

Output the JSON now.`;
}

const SUB_PROMPTS = ['E1a', 'E1b', 'E1c', 'E1d', 'none'];

export function parse(rawText) {
  const obj = extractJSON(rawText);
  assertShape(obj, [
    ['deviation_type', ['off_topic', 'vague', 'people_pleasing', 'bypassing', 'false_positive']],
    ['confidence', ['high', 'medium', 'low']],
    ['arbitration_applied', 'boolean'],
    ['recommended_sub_prompt', SUB_PROMPTS],
  ]);
  if (!Array.isArray(obj.evidence)) {
    throw new Error('evidence must be an array');
  }
  return obj;
}

/**
 * @param {object} inputs
 * @param {string} inputs.user_response
 * @param {string} [inputs.last_ai_question]
 * @param {string[]} [inputs.triggered_signals]
 * @param {number} [inputs.cumulative_ppl_score]
 * @param {string[]} [inputs.anchors_top3]
 * @param {number} [inputs.consecutive_short_responses]
 * @param {number} [inputs.consecutive_offtopic_turns]
 * @param {number} [inputs.consecutive_vague_turns]
 * @param {boolean} [inputs.elicitation_mode_active]
 * @param {number} [inputs.recent_specific_examples_count]
 * @param {number} [inputs.timeoutMs]
 * @returns {Promise<object>}
 */
export async function judge(inputs) {
  if (!inputs || !inputs.user_response || typeof inputs.user_response !== 'string') {
    throw new TypeError('subtype-classifier.judge: user_response (non-empty string) required');
  }
  return runJudge({
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt(inputs),
    parse,
    ...(inputs.timeoutMs != null ? { timeoutMs: inputs.timeoutMs } : {}),
  });
}

/**
 * Conservative fallback on timeout / failure: do not inject, continue, log miss.
 */
export const TIMEOUT_FALLBACK = Object.freeze({
  deviation_type: 'false_positive',
  confidence: 'low',
  evidence: ['classifier_timeout_fallback'],
  arbitration_applied: false,
  recommended_sub_prompt: 'none',
});
