// lib/haiku-judge/sensory-detail.js
// A1 sensory-detail judge — 4 dimension output（spec 02 §1 + Patrick 5/21 重點 + v5.1 Step 5b dim 4）
//
// Damon 體系判斷標準（不是泛用 sensory 判斷）：
//   Dim 1 — 「具體事件 = 時 / 地 / 人 / 動作」4 個 marker
//   Dim 2 — self-evidence vs others（學員自己經歷 vs「朋友都說我很 X」）
//   Dim 3 — derived from another value（Top 1 evidence 不能套到 Top 2）
//   Dim 4 — is_strategy_not_quality (v5.1 Step 5b Gap #8):
//           學員把行為當 strategy 換取 outcome (true) vs 描述本來就是這樣的人 (false)
//
// 消費端各取所需子集：
//   E1c requires-typing clearance        → 只看 dim 1（score >= 2）
//   E2 aggregator door 4 confirm         → dim 1 + v5.1 Step 5b dim 4 (true → 不 upgrade)
//   E3 cascade_mode_validator            → dim 1 + v5.1 Step 5b dim 4 (Top 2/3 evidence)
//   CP1 Turn 1 P7（evidence quality 把關）→ + dim 2
//   CP1 Turn 2 P20（cross-quality 防混）  → + dim 3
//   完整 strict clearance（spec 02 + v5.1 Step 5b）：
//     dim 1 >= 2 AND dim 2 == "self" AND dim 3 == false AND dim_4 == false

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

# Dimension 4: Is Strategy, Not Quality (v5.1 Step 5b Gap #8)

Damon distinguishes Strategy ("what you do to get X") from Quality ("who you are").
A Landmine value is one the student practices as a STRATEGY to obtain something
external (love, approval, safety), not because it's their inherent quality.

Mark "dim_4": true when the student treats this as a strategy:
  (a) "為了/換取/才能" framing: "我展現幽默是為了讓對方喜歡" (humor to be liked)
  (b) "我做 X 因為它能帶來 Y": "我溫暖待人因為我想要他們回報" (warm for return)
  (c) Implicit "without [other party / outcome], I wouldn't do X":
      "如果沒人感謝、我就不會幫" (wouldn't help without thanks)

Mark "dim_4": false when describing inherent quality:
  (a) Spontaneous, outcome-independent: "不論他感謝不感謝、我都會做"
  (b) "從小就會做的事、不是學來的、就是我"

When uncertain, lean false (avoid false positives that would block legitimate quality).

# Output Format

Output ONLY a JSON object, no markdown, no explanation:

{
  "has_time_marker": boolean,
  "has_location_marker": boolean,
  "has_person_marker": boolean,
  "has_action_marker": boolean,
  "sensory_detail_score": <integer 0-4, sum of true markers>,
  "evidence_attribution": "self" | "others" | "ambiguous",
  "derived_from_another_value": boolean,
  "dim_4": boolean
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
    // v5.1 Step 5b dim 4 — optional in old judge outputs; fail-open if missing.
    // assertShape doesn't support optional keys, so we tolerate via separate check
    // below + default to false when absent.
  ]);
  if (obj.sensory_detail_score < 0 || obj.sensory_detail_score > 4) {
    throw new Error(`sensory_detail_score out of range 0-4: ${obj.sensory_detail_score}`);
  }
  // v5.1 Step 5b — dim 4 fail-open. Missing / non-boolean → treat as false (Strategy
  // not present). This matches existing judge容錯 pattern (Step 5b §A3).
  obj.dim_4 = typeof obj.dim_4 === 'boolean' ? obj.dim_4 : false;
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
 * Strict clearance per spec 02 §1 + v5.1 Step 5b: all 4 dimensions must pass.
 * Convenience for callers that want the full strict gate.
 */
export function isStrictClearance(judgment) {
  return judgment.sensory_detail_score >= 2
    && judgment.evidence_attribution === 'self'
    && judgment.derived_from_another_value === false
    && judgment.dim_4 === false;
}

/**
 * v5.1 Step 5b — R2 strategy-not-quality reframe inject (spec-given, ship-able).
 * Returned when dim_4 = true; replaces the upgrade. Sonnet then re-asks evidence
 * with strategy-vs-quality framing.
 */
export const R2_STRATEGY_REFRAME_INJECT = `[SYSTEM INJECT — A1 dim 4: Strategy vs Quality (R2 過渡)]

Haiku A1 judge 偵測到 evidence 像「策略」(換取 outcome) 而非「本質」(inherent quality).
不寫 owned — inject R2 過渡話術, 讓學員 surface 後重判.

話術 (spec §A3 內含, ship-able 不依賴 Reframe Library):
> 「你做 X 是『策略』還是『因為你是這樣的人』?」
> (X 用學員當下的 evidence 動詞替代)

機制:
- 不寫 quality_status='owned' 這 turn.
- Sonnet 等學員 surface 之後重新跑 A1 judge.
- 若學員 surface 後 dim_4=false → 收 owned.
- 若學員堅持 strategy framing → ambiguous, 引擎 3 handoff_escalation.

TODO(Step 7) — R2 Reframe Library 完整版接管.`;
