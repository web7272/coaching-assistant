// lib/haiku-judge/sensory-detail.js
// A1 sensory-detail judge — 3 dimension output（spec 02 §1 + Patrick 5/21 重點）
//
// Damon 體系判斷標準（不是泛用 sensory 判斷）：
//   Dim 1 — 「具體事件 = 時 / 地 / 人 / 動作」4 個 marker
//   Dim 2 — self-evidence vs others（學員自己經歷 vs「朋友都說我很 X」）
//   Dim 3 — derived from another value（Top 1 evidence 不能套到 Top 2）
//
// 消費端各取所需子集：
//   E1c requires-typing clearance        → 只看 dim 1（score >= 2）
//   E2 aggregator door 4 confirm         → 只看 dim 1
//   E3 cascade_down_validator            → 只看 dim 1
//   CP1 Turn 1 P7（evidence quality 把關）→ + dim 2
//   CP1 Turn 2 P20（cross-quality 防混）  → + dim 3
//   完整 strict clearance（spec 02）：dim 1 >= 2 AND dim 2 == "self" AND dim 3 == false

import { runJudge } from './_base.js';
import { extractJSON, assertShape } from './_json.js';

export const SYSTEM_PROMPT = `You are an evidence-quality judge in the Damon Cart Identity Coaching system.

A student is asked to give EVIDENCE for a quality or value they claim to embody.
Your job is to assess the evidence quality across three dimensions.

# Dimension 1: 具體事件 (Concrete Event Markers)

Damon rejects vague generalities ("我一直都很 X" / "通常我都會"). Real evidence has:
  - 時 (time):    a specific moment ("昨天下午", "上週三", "去年生日"). NOT "often / usually / 通常".
  - 地 (location): a place, even mundane ("在咖啡店", "我家樓下", "辦公室")
  - 人 (person):   who was involved ("跟我媽", "我同事 Sarah", "客戶")
  - 動作 (action): what was actually done ("我說了 No", "我寫了一封信", "我提早離開")

Each marker = independent boolean. sensory_detail_score = count of true markers (0-4).

# Dimension 2: Evidence Attribution

Did the evidence come from the STUDENT'S OWN EXPERIENCE, or quoted from others?
  - "self"      : student describes their own action / decision / experience
  - "others"    : student quotes external validation ("我朋友都說我很 X", "我老闆覺得我...")
                  → Damon REJECTS this. Evidence cannot live only in someone else's mouth.
  - "ambiguous" : can't tell from this single response

# Dimension 3: Derived from Another Value

Is the student reusing evidence from ANOTHER quality / value to claim THIS one?
Example: Top 1 = 自由. Student gave evidence about quitting their job (自由 evidence).
Now asked about Top 2 = 勇敢, student says "嗯, 我辭職就是勇敢的表現" — DERIVED.
Each quality needs its OWN self-evidence; derived evidence is rejected.

# Output Format

Output ONLY a JSON object, no markdown, no explanation:

{
  "has_time_marker": boolean,
  "has_location_marker": boolean,
  "has_person_marker": boolean,
  "has_action_marker": boolean,
  "sensory_detail_score": <integer 0-4, sum of true markers>,
  "evidence_attribution": "self" | "others" | "ambiguous",
  "derived_from_another_value": boolean
}`;

export function buildUserPrompt({ user_response, prior_question, value_being_tested }) {
  return `Quality / value being tested: ${value_being_tested}

AI's evidence-eliciting question: ${prior_question}

Student's response: ${user_response}

Output the JSON now.`;
}

export function parse(rawText) {
  const obj = extractJSON(rawText);
  assertShape(obj, [
    ['has_time_marker', 'boolean'],
    ['has_location_marker', 'boolean'],
    ['has_person_marker', 'boolean'],
    ['has_action_marker', 'boolean'],
    ['sensory_detail_score', 'integer'],
    ['evidence_attribution', ['self', 'others', 'ambiguous']],
    ['derived_from_another_value', 'boolean'],
  ]);
  if (obj.sensory_detail_score < 0 || obj.sensory_detail_score > 4) {
    throw new Error(`sensory_detail_score out of range 0-4: ${obj.sensory_detail_score}`);
  }
  return obj;
}

/**
 * @param {object} inputs
 * @param {string} inputs.user_response
 * @param {string} inputs.prior_question
 * @param {string} inputs.value_being_tested
 * @param {number} [inputs.timeoutMs]
 * @returns {Promise<object>} structured judgment
 */
export async function judge(inputs) {
  const { user_response, prior_question, value_being_tested, timeoutMs } = inputs;
  if (!user_response || typeof user_response !== 'string') {
    throw new TypeError('sensory-detail.judge: user_response (non-empty string) required');
  }
  if (!prior_question || typeof prior_question !== 'string') {
    throw new TypeError('sensory-detail.judge: prior_question (non-empty string) required');
  }
  if (!value_being_tested || typeof value_being_tested !== 'string') {
    throw new TypeError('sensory-detail.judge: value_being_tested (non-empty string) required');
  }
  return runJudge({
    system: SYSTEM_PROMPT,
    prompt: buildUserPrompt({ user_response, prior_question, value_being_tested }),
    parse,
    ...(timeoutMs != null ? { timeoutMs } : {}),
  });
}

/**
 * Strict clearance per spec 02 §1: all 3 dimensions must pass.
 * Convenience for callers that want the full strict gate.
 */
export function isStrictClearance(judgment) {
  return judgment.sensory_detail_score >= 2
    && judgment.evidence_attribution === 'self'
    && judgment.derived_from_another_value === false;
}
