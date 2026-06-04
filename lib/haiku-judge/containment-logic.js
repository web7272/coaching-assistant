// lib/haiku-judge/containment-logic.js
// A5 containment-logic judge — 存在依賴測試判斷 + Linear Thinking Error 偵測
//
// 用途：E3_top1_judge Step 5（Containment Judgment）/
//      E3_cascade_mode_validator 備用
//
// Damon 體系判斷標準（不是泛用 logical reasoning judge）：
//   - Hierarchy of Values 鐵律：找「最大涵蓋類別」、不是「先後順序」
//   - 存在依賴測試：「沒有 [輸的 value]、[贏的 value] 還能存在嗎?」
//   - Linear Thinking Error：「必須先 X 才能 Y」/「沒有 X 就不可能 Y」=
//     把順序當依賴、必須切換 AI 解釋到 Containment 邏輯

import { runJudge } from './_base.js';
import { extractJSON, assertShape } from './_json.js';

export const SYSTEM_PROMPT = `You are a Containment Judgment logic judge in the Damon Cart system.

# Damon's distinction: containment vs sequence

Damon's Hierarchy of Values has 2 iron rules:
  1. Never leave the specific context.
  2. It is NOT linear ordering — it is finding the MAXIMUM CONTAINING category.

When the AI asks "沒有 A,B 還能存在嗎?" (without A, can B still exist?),
the AI is testing CONTAINMENT — is one value's territory contained inside the other's?

# Linear Thinking Error — what to detect

Students often confuse containment with TEMPORAL or CAUSAL sequence:
  - "我必須先有自由,才能勇敢" → linear (sequence)
  - "沒有錢就不可能自由" → linear (causal)
  - "穩定要先有,自由才能談" → linear (precondition)

These are NOT containment answers. The AI must DETECT and switch to a Containment
explanation ("先後順序跟包含性不一樣. 我問的是: A 裡面有沒有可能包含 B?").

# Containment direction (the actual answer)

If the student does answer about containment, classify the direction:
  - "A_contains_B"   : value A is the bigger category; B lives inside A's territory.
                       (e.g. 自由 包含 勇敢 — 自由 needs space, 勇敢 fills part of that space)
  - "B_contains_A"   : opposite direction.
  - "interdependent" : both contain each other (rare; often student confusion or
                       genuine equal-tier values; AI usually treats as "ask again differently")
  - "unclear"        : student gave a containment-shaped answer but direction can't be determined.

# Confidence

  - high   : student's answer is unambiguous and directly addresses containment
  - medium : student answer needs interpretation but a direction is clear
  - low    : student answer is partial / vague / mixed with linear thinking

# Output Format

Output ONLY a JSON object, no markdown, no explanation:

{
  "answer_addresses_containment": boolean,
  "linear_thinking_error_detected": boolean,
  "containment_direction": "A_contains_B" | "B_contains_A" | "interdependent" | "unclear",
  "confidence": "high" | "medium" | "low"
}`;

export function buildUserPrompt({ user_response, prior_containment_question, values_being_compared }) {
  const [valueA, valueB] = values_being_compared;
  return `Values being compared:
  A = ${valueA}
  B = ${valueB}

AI's containment question: ${prior_containment_question}

Student's response: ${user_response}

Output the JSON now.`;
}

export function parse(rawText) {
  const obj = extractJSON(rawText);
  assertShape(obj, [
    ['answer_addresses_containment', 'boolean'],
    ['linear_thinking_error_detected', 'boolean'],
    ['containment_direction', ['A_contains_B', 'B_contains_A', 'interdependent', 'unclear']],
    ['confidence', ['high', 'medium', 'low']],
  ]);
  return obj;
}

/**
 * @param {object} inputs
 * @param {string} inputs.user_response
 * @param {string} inputs.prior_containment_question
 * @param {string[]} inputs.values_being_compared - [valueA, valueB]
 * @param {number} [inputs.timeoutMs]
 * @returns {Promise<object>}
 */
export async function judge(inputs) {
  const { user_response, prior_containment_question, values_being_compared, timeoutMs } = inputs;
  if (!user_response || typeof user_response !== 'string') {
    throw new TypeError('containment-logic.judge: user_response (non-empty string) required');
  }
  if (!prior_containment_question || typeof prior_containment_question !== 'string') {
    throw new TypeError('containment-logic.judge: prior_containment_question (non-empty string) required');
  }
  if (!Array.isArray(values_being_compared) || values_being_compared.length !== 2) {
    throw new TypeError('containment-logic.judge: values_being_compared must be 2-element array [valueA, valueB]');
  }
  if (!values_being_compared[0] || !values_being_compared[1]) {
    throw new TypeError('containment-logic.judge: both values in values_being_compared must be non-empty strings');
  }
  return runJudge({
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt({ user_response, prior_containment_question, values_being_compared }),
    parse,
    ...(timeoutMs != null ? { timeoutMs } : {}),
  });
}

/**
 * Did A pass the containment test (= A is the bigger / containing value)?
 * Used by E3_top1_judge Step 6.
 */
export function aPassesContainment(judgment) {
  return judgment.answer_addresses_containment
    && !judgment.linear_thinking_error_detected
    && judgment.containment_direction === 'A_contains_B'
    && (judgment.confidence === 'high' || judgment.confidence === 'medium');
}
