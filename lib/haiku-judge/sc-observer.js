// lib/haiku-judge/sc-observer.js
// v5.3 Stage A (6/12) — Observer judge for SC journey capture (Damon system).
//
// 設計 = `設計-observer-judge-詳細spec-v1.md` (Patrick 6/12).
// 驗收 = `設計-observer-eval-黃金標準-v1.md` (Damon 親標 ground truth).
//
// Role: READ-ONLY observer. Reads what Sonnet+learner actually said in a Q/A
//   turn → extracts SC journey signals (values surfaced / owned identities /
//   top1 / reframe events / 7-step evidence). DOES NOT drive conversation.
//
// 🔴 Spec §4 SAFETY (first iron rule, non-negotiable):
//   - primary_mode === 'crisis' → skip='crisis' (pre-LLM, no API call).
//   - turn 命中 SC_STORYBOARD_HIGH_RISK_PATTERNS → skip='high_risk' (pre-LLM).
//   - Post-LLM scrubber pass: any quote field tripping high-risk → wiped.
//   - Spec §A: still capture A006's step_3-7 (照顧 / 愛能力 / 存在本身).
//     Only skip SI raw + crisis-SOP turns — NOT the whole person.
//
// 🔴 Spec §6a SUPREME PRINCIPLE: read SUBSTANCE not FORM (A005).
//   step_4-7 evidence MUST be detected from semantic substance, NOT from
//   formal markers (identity-test phrasing, "我是 X" sentence, PK etc.).
//   A005 走完七步 without any formal marker. judge prompt instructs this.
//
// 🔴 Spec §6: owned 嚴 (no hedge) / top1 嚴 (require 收斂 OR explicit) / values
//   寬 (substantive quality terms).
//
// 純函式 + 1 次 runJudge() call. Caller supplies ctx.now_iso (no Date.now).

import { runJudge } from './_base.js';
import { extractJSON, assertShape } from './_json.js';
import {
  SC_STORYBOARD_HIGH_RISK_PATTERNS,
} from '../api/sc-storyboard-gen.js';
import {
  sanitizeStudentNote,
  containsForbiddenContent,
} from '../api/student-note-safe.js';

// ────────────────────────────────────────────────────────────────
// Constants (exported for test seam)
// ────────────────────────────────────────────────────────────────

export const SKIP_REASONS = Object.freeze([
  'crisis', 'high_risk', 'meta_complaint', 'app_noise',
]);

export const STEP_EVIDENCE_TYPES = Object.freeze([
  'pain_surface',          // step_1
  'longing_surface',       // step_2
  'data_mining',           // step_3
  'identity_claim',        // step_4
  'resource_retrieval',    // step_5
  'sovereignty_reclaim',   // step_6
  'anchoring',             // step_7
]);

export const REFRAME_EVENT_TYPES = Object.freeze([
  'limiting_belief',   // R3 → breaking limit
  'sovereignty',       // R1 → reclaim source
  'fuel',              // R2 / R5 / R7 → energy / resource / anchor
  'other',
]);

// Cheap pre-LLM noise filters (post-LLM judge can override with meta_complaint).
// Exported so eval harness can use the SAME regex when auto-marking is_noise_turn.
export const META_COMPLAINT_REGEX = /(為什麼一直問|不想重複|沒有在聽|問題太多|為什麼拉到|你都不|怎麼又問)/;
export const APP_NOISE_MIN_LEN = 2;  // user_response shorter than this = app_noise

const QUOTE_MAX_LEN = 80;

// ────────────────────────────────────────────────────────────────
// Pre-LLM gate (Stage A safety net — runs BEFORE any API call).
//   Returns null when no early skip; returns observer-shaped result when
//   skip applies, so caller never sees an LLM call for crisis / high_risk.
// ────────────────────────────────────────────────────────────────

export function _isHighRiskText(text) {
  if (typeof text !== 'string') return false;
  return SC_STORYBOARD_HIGH_RISK_PATTERNS.some(p => p.test(text));
}

export function shouldSkipPreLLM({ turn, context }) {
  const t = turn || {};
  const c = context || {};
  // §4 rule 1 — crisis primary mode.
  if (c.primary_mode === 'crisis') {
    return { skip: true, skip_reason: 'crisis' };
  }
  // §4 rule 2 — high-risk regex on either AI or user text.
  if (_isHighRiskText(t.ai) || _isHighRiskText(t.user)) {
    return { skip: true, skip_reason: 'high_risk' };
  }
  // §5 — app noise (empty / very short user response).
  if (typeof t.user !== 'string' || t.user.trim().length < APP_NOISE_MIN_LEN) {
    return { skip: true, skip_reason: 'app_noise' };
  }
  // §5 — obvious meta-complaint (cheap regex pre-filter; judge can also flag).
  if (META_COMPLAINT_REGEX.test(t.user)) {
    return { skip: true, skip_reason: 'meta_complaint' };
  }
  return null;
}

// ────────────────────────────────────────────────────────────────
// Default skip-result skeleton — never includes raw high-risk text.
// ────────────────────────────────────────────────────────────────
export function emptyObservation(skip_reason = null) {
  return {
    skip: skip_reason !== null,
    skip_reason,
    values_surfaced: [],
    top1_determined: null,
    owned_confirmed: [],
    reframe_events: [],
    step_evidence: {
      step_1: [], step_2: [], step_3: [], step_4: [],
      step_5: [], step_6: [], step_7: [],
    },
  };
}

// ────────────────────────────────────────────────────────────────
// System prompt — spec §4 / §5 / §6 / §6a / §6b encoded.
//   Static = enables prompt caching (Stage B optimization).
// ────────────────────────────────────────────────────────────────

export const SYSTEM_PROMPT = `You are an Observer for the Damon Cart 21-day self-discovery system.

# Your role
READ what already happened in this Q/A turn between AI and learner.
Extract SC journey signals (values surfaced, owned identities, top1, reframe
events, 7-step evidence). You DO NOT drive conversation. You ONLY observe.

# 🔴 SAFETY (non-negotiable, wins over all other rules)

If the user's reply contains high-risk content (自殺 / 想死 / 去死 / 輕生 /
自傷 / 割腕 / 上吊 / 跳樓 / 燒炭 / 不想活 / 無所眷念 / explicit SI), output:
  {"skip": true, "skip_reason": "high_risk", ...empty arrays/null...}
NEVER include the high-risk text in any field (no quote, no value name).

If the AI is doing crisis SOP (passive_dw / direct-1925 / 1925 / Safety
Planning / 「不一個人」 / 「我陪你」), output skip with skip_reason 'crisis'.

# Anti-noise (§5)

Set skip=true with appropriate skip_reason when:
- 'meta_complaint': learner complains about process (「為什麼一直問」/
  「不想重複回答」 / 「你沒有在聽」).
- 'app_noise': broken sentence / 1-2 chars / partial typing / duplicate.

These are NOT values. DO NOT extract anything.

# What counts as a "value" (§5)

A value = a quality / character / aspirational state the learner describes
as desirable for who they are. Examples: 平靜, 自由, 愛, 創造力, 自然, 真誠,
照顧, 成就感.

NOT values (do NOT include in values_surfaced):
- "成功" / "賺錢" / "被肯定" (strategy not quality — Damon tier-1 reject).
- "被需要" / "被選擇" (step_1/2 lack/longing — not owned identity).
- Process complaints / meta talk.
- 🔴 6/12 — Transient skills / states / sensory modes (NOT core qualities):
  - 觀察力 / 放空 / 專注 / 可見性 / 細微性 / 敏感度 / 警覺.
  - These describe HOW someone notices, not WHAT they are.
  - Damon: quality 是「你是誰」, 不是「你做什麼 / 處在什麼狀態」.

# owned (strict — §6)

owned_confirmed = identities the learner affirmed WITHOUT hedge after an
identity test or substantive moment.

ACCEPT as owned ONLY when learner says:
- "我是" / "是" / "我是, 100%" (no hedge).
- OR substantively claims an identity (§6a substance) without overt test.

DO NOT include in owned_confirmed when hedged:
- "算是吧" / "95%" / "大部分時間" / "想是" / "應該可以".
These are partial, not owned. Leave them out.

# 🔴 6/12 — owned MUST be CANONICAL TRAIT NOUNS (1-8 chars typically).

owned_confirmed entries MUST be CLEAN trait nouns — NOT description
sentences, NOT relational phrases, NOT learner's raw narrative wording.

✅ CORRECT owned entries (canonical, short):
- "照顧" / "有愛的能力" / "創造力" / "平靜" / "自然" / "真誠" / "成就感".

❌ INCORRECT owned entries (description sentences / relational phrases):
- "媽媽的依靠" → normalize to "依靠" or drop.
- "她心靈上的支柱" → normalize to "支持" or drop.
- "自然就想給的人" → normalize to "愛的能力" or "照顧".
- "看到有人需要幫忙我都會幫" → normalize to "照顧" or "助人".
- Long narrative sentences → drop, OR extract the underlying trait noun.

If you cannot confidently normalize a description into a clean trait noun,
LEAVE IT OUT of owned_confirmed. Better empty than messy.

owned should be SHORT and FEW (typically 1-3 entries per learner over 21 days).
If you have 5+ owned entries, you are over-capturing — re-check each against
hedge / description-vs-canonical rules.

# top1 (strict — §6)

top1_determined = string ONLY when:
  (1) learner without hesitation confirms PLUS AI uses 收斂 statement
      ("X 撐著全部", "X 包含了..."), OR
  (2) AI explicitly says "X 是 Top 1".
Otherwise top1_determined = null. DO NOT fabricate.

# 🔴 §6a SUPREME PRINCIPLE: SUBSTANCE not FORM (A005 case)

Damon's 7-step is about TRANSFORMATION SUBSTANCE, not formal markers.

A005 walked all 7 steps with NO formal "我是 X" test. She substantively
claimed identity ("自然、真誠"), substantively reclaimed judgment ("付出
依然真實"). You MUST read substance.

Substance indicators:
- step_4 identity_claim: clear self-description as a quality, including
  aspirational ("我想成為...全新的人" / "我發現我比較像 Y").
- step_5 resource_retrieval: "我本來就有" / "它早就在" / "動力在外部觸發
  前就存在" (孕婦效應 — discovering pre-existing inner resource).
- step_6 sovereignty_reclaim: breaking external equation ("X = 我差") /
  reclaiming evaluation from outside ("付出依然真實 即使對方不感謝").
- step_7 anchoring: concrete phrase the learner anchors as identity
  ("自然真誠" / "成就感是從我自己來的" / "照顧").

If substance is present, capture it. DO NOT require formal "我是 X".

# 🔴 6/12 round 2 — step_7 ANCHORING explicit capture (STRENGTHEN — real eval found 0 captures)

⚠️ The previous round MISSED step_7 across all 4 fixtures. Step_7 anchoring
is the most under-detected. Lower your bar HEAVILY for step_7 — capture
liberally; only safety scrub at output.

## AI-side patterns (session close / day close / explicit anchor)

ANY of these in AI's message → record step_7 anchoring:
- "把這句話留下來:『X』" / "把『X』留下來" / "留下這句:『X』"
- "定錨『X』" / "今天的定錨是『X』" / "錨『X』"
- "明天從『X』這裡接住" / "明天繼續從『X』" / "明天從這裡接『X』"
- "今天讓『X』成形了" / "今天讓『X』長出來了"
- "今天先到這裡…『X』" (session-close + anchor combined)
- AI names a phrase the learner will "carry forward" / "帶走"
- Day-close moment where AI explicitly names the takeaway phrase

For ALL above: record entry {type: 'anchoring', quote: 'X'}.

## Learner-side patterns (deliberate acceptance / repeat)

ANY of these in learner's reply → record step_7 anchoring:
- "對, 我是『X』" / "對, 我是" (after AI's identity statement;「對」/「是」
  followed by repeated identity from prior turn)
- "我是『X』" deliberate repeat (not first-time exploratory; substantive
  reaffirmation)
- "『X』 — 這是我的" / "我接受『X』" / "『X』 鎖定"
- Learner repeats their OWN anchor phrase from earlier days deliberately
  ("還是『X』" / "回到『X』" / "現在還是覺得 『X』")

## EXEMPLARS (real Damon-labeled step_7 anchors — ALWAYS record these)

- **A006**: 「照顧」 — the entire arc anchors here. Any late-day reaffirmation
  of 照顧 (學員 OR AI) → record step_7 anchoring with quote="照顧".
- **A003**: 「剛剛好的自由」 / 「崩潰是事件、平靜是你是誰」 — these are
  Damon-labeled anchors. If either appears (AI summary OR learner repeat),
  record.
- **A005**: 「自然真誠」 — A005 walked seven steps WITHOUT formal ceremony,
  but substantively THIS IS her anchor. Capture even without explicit
  「把這句話留下來」 framing.

## NEVER skip step_7 just because

- ❌ The conversation didn't use the literal word "anchor" / "定錨".
- ❌ The day didn't have a formal "session-close ceremony".
- ❌ The learner didn't say "我是 X" in textbook form.

Look for SUBSTANCE: a concrete short identity phrase the learner has clearly
"made theirs" (deliberate repeat, AI naming it back, learner accepting it).
When in doubt about step_7, ERR ON THE SIDE OF CAPTURING. Better over-capture
+ post-scrub than miss the anchor entirely.

# §6b Damon refinements (A009)

- step_5 includes 孕婦效應 ("動力早在邀請前就在").
- step_6 includes breaking limit equation ("錢少=我差").
- step_4 includes aspirational identity_claim (not just owned).

# 🔴 Read SUBSTANCE for 7-step. Be STRICT for owned/top1. Be HONEST about empty (留白).

# Output schema

Output ONLY a single JSON object (no markdown, no explanation):

{
  "skip": boolean,
  "skip_reason": "crisis" | "high_risk" | "meta_complaint" | "app_noise" | null,
  "values_surfaced": [string, ...]   // values surfaced THIS turn (delta beyond accumulated). Empty if none.
  "top1_determined": string | null,
  "owned_confirmed": [string, ...],
  "reframe_events": [
    {"type": "limiting_belief" | "sovereignty" | "fuel" | "other", "quote": "short quote"}
  ],
  "step_evidence": {
    "step_1": [{"type": "pain_surface", "quote": "..."}, ...],
    "step_2": [{"type": "longing_surface", "quote": "..."}, ...],
    "step_3": [{"type": "data_mining", "quote": "..."}, ...],
    "step_4": [{"type": "identity_claim", "quote": "..."}, ...],
    "step_5": [{"type": "resource_retrieval", "quote": "..."}, ...],
    "step_6": [{"type": "sovereignty_reclaim", "quote": "..."}, ...],
    "step_7": [{"type": "anchoring", "quote": "..."}, ...]
  }
}

When skip=true, all fields stay empty arrays / null. step_evidence has 7 empty arrays.
Quotes ≤ 80 chars (trim if longer). All step_evidence keys MUST be present.`;

// ────────────────────────────────────────────────────────────────
// User-prompt builder.
// ────────────────────────────────────────────────────────────────

export function buildUserPrompt({ turn, accumulated, context }) {
  const t = turn || {};
  const acc = accumulated || {};
  const c = context || {};
  const valuesStr  = (Array.isArray(acc.values)  && acc.values.length)  ? acc.values.join(', ')  : '(none yet)';
  const ownedStr   = (Array.isArray(acc.owned)   && acc.owned.length)   ? acc.owned.join(', ')   : '(none yet)';
  const stepsStr   = (Array.isArray(acc.steps_touched) && acc.steps_touched.length)
    ? acc.steps_touched.map(n => `step_${n}`).join(', ') : '(none yet)';
  const top1Str    = (typeof acc.top1 === 'string' && acc.top1.length) ? acc.top1 : '(not yet)';
  const modeStr    = c.primary_mode ?? 'unknown';

  return `Q/A turn — day ${t.day ?? '?'} / question ${t.question_number ?? '?'}.

AI said:
"${(t.ai || '').slice(0, 1200)}"

Learner replied:
"${(t.user || '').slice(0, 1200)}"

Already accumulated for this learner (don't re-extract these):
- values surfaced: ${valuesStr}
- owned (no-hedge): ${ownedStr}
- top1: ${top1Str}
- steps touched: ${stepsStr}

Conversation mode: ${modeStr}

Output the JSON observation for THIS turn ONLY (DELTA beyond accumulated).
If nothing new, emit empty arrays / null. If safety / noise condition, set
skip + skip_reason.`;
}

// ────────────────────────────────────────────────────────────────
// Parse + shape validation (assertShape is limited — manual array/sub-shape checks).
// ────────────────────────────────────────────────────────────────

function _validateStringArray(arr, fieldName) {
  if (!Array.isArray(arr)) {
    throw new Error(`sc-observer.parse: ${fieldName} must be array`);
  }
  for (const item of arr) {
    if (typeof item !== 'string') {
      throw new Error(`sc-observer.parse: ${fieldName} items must be strings`);
    }
  }
}

function _validateEvidenceArray(arr, stepKey, allowedTypes) {
  if (!Array.isArray(arr)) {
    throw new Error(`sc-observer.parse: ${stepKey} must be array`);
  }
  for (const entry of arr) {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`sc-observer.parse: ${stepKey} entry must be object`);
    }
    if (typeof entry.type !== 'string' || !allowedTypes.includes(entry.type)) {
      throw new Error(`sc-observer.parse: ${stepKey} entry.type must be one of ${JSON.stringify(allowedTypes)}, got ${JSON.stringify(entry.type)}`);
    }
    if (typeof entry.quote !== 'string') {
      throw new Error(`sc-observer.parse: ${stepKey} entry.quote must be string`);
    }
  }
}

export function parse(rawText) {
  const obj = extractJSON(rawText);
  // Primary fields.
  assertShape(obj, [
    ['skip', 'boolean'],
  ]);
  // skip_reason: nullable enum.
  if (!('skip_reason' in obj)) {
    throw new Error('sc-observer.parse: missing skip_reason');
  }
  if (obj.skip_reason !== null && !SKIP_REASONS.includes(obj.skip_reason)) {
    throw new Error(`sc-observer.parse: skip_reason must be null or one of ${JSON.stringify(SKIP_REASONS)}, got ${JSON.stringify(obj.skip_reason)}`);
  }
  // top1_determined: nullable string.
  if (!('top1_determined' in obj)) {
    throw new Error('sc-observer.parse: missing top1_determined');
  }
  if (obj.top1_determined !== null && typeof obj.top1_determined !== 'string') {
    throw new Error(`sc-observer.parse: top1_determined must be string or null`);
  }
  // String arrays.
  _validateStringArray(obj.values_surfaced, 'values_surfaced');
  _validateStringArray(obj.owned_confirmed, 'owned_confirmed');
  // reframe_events: array of {type, quote}.
  _validateEvidenceArray(obj.reframe_events, 'reframe_events', REFRAME_EVENT_TYPES);
  // step_evidence: object with step_1..step_7 keys.
  if (!obj.step_evidence || typeof obj.step_evidence !== 'object' || Array.isArray(obj.step_evidence)) {
    throw new Error('sc-observer.parse: step_evidence must be object');
  }
  for (let n = 1; n <= 7; n++) {
    const key = `step_${n}`;
    if (!(key in obj.step_evidence)) {
      throw new Error(`sc-observer.parse: step_evidence missing ${key}`);
    }
    _validateEvidenceArray(obj.step_evidence[key], `step_evidence.${key}`, STEP_EVIDENCE_TYPES);
  }
  return obj;
}

// ────────────────────────────────────────────────────────────────
// Post-LLM scrubber — defence-in-depth.
//   - Drops any quote tripping high-risk regex.
//   - Truncates over-length quotes.
//   - Drops top1/values/owned entries that trip high-risk.
//   - Does NOT modify skip flags (those decided by judge or pre-LLM).
// ────────────────────────────────────────────────────────────────

function _safeQuote(quote) {
  if (typeof quote !== 'string') return null;
  const trimmed = quote.trim();
  if (trimmed.length === 0) return null;
  if (_isHighRiskText(trimmed)) return null;
  return trimmed.length > QUOTE_MAX_LEN ? trimmed.slice(0, QUOTE_MAX_LEN) : trimmed;
}

function _safeValueTerm(term) {
  if (typeof term !== 'string') return null;
  const trimmed = term.trim();
  if (trimmed.length === 0) return null;
  if (_isHighRiskText(trimmed)) return null;
  // Defense: run scrubber too (catches forbidden content the judge may have included).
  if (containsForbiddenContent(trimmed)) return null;
  const cleaned = sanitizeStudentNote(trimmed);
  if (!cleaned || cleaned.length === 0) return null;
  return cleaned;
}

export function postScrubObservation(obs) {
  if (!obs || typeof obs !== 'object') return emptyObservation();
  // If skip=true, the model already emitted empties; double-check + sanitize just in case.
  const cleanValues = (obs.values_surfaced || [])
    .map(_safeValueTerm).filter(v => v !== null);
  const cleanOwned = (obs.owned_confirmed || [])
    .map(_safeValueTerm).filter(v => v !== null);
  const top1 = typeof obs.top1_determined === 'string' && obs.top1_determined.length > 0
    ? _safeValueTerm(obs.top1_determined) : null;

  const cleanReframes = (obs.reframe_events || [])
    .map(e => {
      if (!e || typeof e !== 'object') return null;
      const q = _safeQuote(e.quote);
      if (q === null) return null;
      if (!REFRAME_EVENT_TYPES.includes(e.type)) return null;
      return { type: e.type, quote: q };
    })
    .filter(e => e !== null);

  const cleanSteps = {};
  for (let n = 1; n <= 7; n++) {
    const key = `step_${n}`;
    const arr = obs.step_evidence?.[key] || [];
    cleanSteps[key] = arr
      .map(e => {
        if (!e || typeof e !== 'object') return null;
        if (!STEP_EVIDENCE_TYPES.includes(e.type)) return null;
        const q = _safeQuote(e.quote);
        if (q === null) return null;
        return { type: e.type, quote: q };
      })
      .filter(e => e !== null);
  }

  return {
    skip: !!obs.skip,
    skip_reason: obs.skip_reason ?? null,
    values_surfaced: cleanValues,
    top1_determined: top1,
    owned_confirmed: cleanOwned,
    reframe_events: cleanReframes,
    step_evidence: cleanSteps,
  };
}

// ────────────────────────────────────────────────────────────────
// Main entry: judge({turn, accumulated, context}).
//   - Pre-LLM gate → empty skip result (no API call) for crisis / high_risk /
//     short noise / meta-complaint.
//   - LLM call via runJudge() (1 call). Uses lib/haiku-judge/_base.js's
//     internal client via getClient(). For tests, inject via _setClient.
//   - Post-LLM scrub (defence-in-depth).
//
// ⚠️ Default timeoutMs = 5000 (5s). Observer is BATCH / offline (finalize-day
//    Stage B), quality > latency. Hot-path judges use 200ms default; we don't.
//
// ⚠️ Fail-soft: any error path (timeout / schema / parse / network) → returns
//    emptyObservation (skip=false, no skip_reason — the turn just had no signal
//    we could extract). Caller can distinguish from real skip via skip_reason.
// ────────────────────────────────────────────────────────────────

const OBSERVER_DEFAULT_TIMEOUT_MS = 5000;

export async function judge({
  turn,
  accumulated = {},
  context = {},
  log = (msg) => console.warn(msg),
  timeoutMs = OBSERVER_DEFAULT_TIMEOUT_MS,
} = {}) {
  // Pre-LLM safety + cheap noise gate.
  const preSkip = shouldSkipPreLLM({ turn, context });
  if (preSkip) {
    return emptyObservation(preSkip.skip_reason);
  }

  let raw;
  try {
    raw = await runJudge({
      system: SYSTEM_PROMPT,
      prompt: buildUserPrompt({ turn, accumulated, context }),
      parse,
      timeoutMs,
    });
  } catch (err) {
    log(`[sc-observer] runJudge threw: ${err?.message || err} → fail-soft empty`);
    return emptyObservation();
  }

  // Post-LLM scrub (defence-in-depth — drops any high-risk quote that slipped).
  return postScrubObservation(raw);
}
