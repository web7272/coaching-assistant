// lib/haiku-judge/sc-observer.test.js
// v5.3 Stage A (6/12) — sc-observer unit tests (pre-LLM gate / parse / scrub /
// judge integration via mock client). Real-fixture eval lives in
// scripts/observer-eval.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SKIP_REASONS,
  STEP_EVIDENCE_TYPES,
  REFRAME_EVENT_TYPES,
  SYSTEM_PROMPT,
  _isHighRiskText,
  shouldSkipPreLLM,
  emptyObservation,
  buildUserPrompt,
  parse,
  postScrubObservation,
  judge,
} from './sc-observer.js';
import { _setClient } from './_base.js';

// ─── Mock client helper ────────────────────────────────────

function mockClient(responseText) {
  return {
    messages: {
      create: async () => ({
        content: [{ type: 'text', text: responseText }],
      }),
    },
  };
}

function mockClientThrow(err) {
  return {
    messages: { create: async () => { throw err; } },
  };
}

function validObservation(overrides = {}) {
  return {
    skip: false,
    skip_reason: null,
    values_surfaced: [],
    top1_determined: null,
    owned_confirmed: [],
    reframe_events: [],
    step_evidence: {
      step_1: [], step_2: [], step_3: [], step_4: [],
      step_5: [], step_6: [], step_7: [],
    },
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════
// _isHighRiskText — extended pattern coverage (spec §4)
// ═════════════════════════════════════════════════════════

test('🔴 _isHighRiskText: all 11 spec patterns hit (含 6/12 extension 不想活/無所眷念)', () => {
  const hits = ['自殺', '想死', '去死', '輕生', '自傷', '割腕', '上吊', '跳樓',
                '燒炭', '不想活', '無所眷念'];
  for (const h of hits) {
    assert.equal(_isHighRiskText(`學員講: ${h}`), true, `pattern ${h} must hit`);
  }
});

test('🔴 _isHighRiskText: safe text passes', () => {
  assert.equal(_isHighRiskText('我覺得平靜很重要'), false);
  assert.equal(_isHighRiskText('喜悅, 創造力, 自由'), false);
});

test('🛑 _isHighRiskText: non-string defensive', () => {
  assert.equal(_isHighRiskText(null), false);
  assert.equal(_isHighRiskText(undefined), false);
  assert.equal(_isHighRiskText(42), false);
});

// ═════════════════════════════════════════════════════════
// shouldSkipPreLLM — §4 + §5 gates (no API call needed)
// ═════════════════════════════════════════════════════════

test('🔴 shouldSkipPreLLM §4: primary_mode === "crisis" → skip="crisis"', () => {
  const r = shouldSkipPreLLM({
    turn: { user: '我今天還好啊', ai: '謝謝你說' },
    context: { primary_mode: 'crisis' },
  });
  assert.deepEqual(r, { skip: true, skip_reason: 'crisis' });
});

test('🔴 shouldSkipPreLLM §4: high-risk in user → skip="high_risk" (no API call)', () => {
  const r = shouldSkipPreLLM({
    turn: { user: '有時候我想死', ai: '謝謝' },
    context: { primary_mode: 'elicitation' },
  });
  assert.equal(r.skip_reason, 'high_risk');
});

test('🔴 shouldSkipPreLLM §4: high-risk in AI message → skip="high_risk"', () => {
  // Defensive: even if AI accidentally echoes high-risk, observer must skip.
  const r = shouldSkipPreLLM({
    turn: { user: '謝謝', ai: '聽到你說自殺,我想停下來' },
    context: { primary_mode: 'elicitation' },
  });
  assert.equal(r.skip_reason, 'high_risk');
});

test('🛑 shouldSkipPreLLM §5: user response < 2 chars → skip="app_noise"', () => {
  const r = shouldSkipPreLLM({
    turn: { user: '嗯', ai: '想聽你說' },
    context: { primary_mode: 'elicitation' },
  });
  assert.equal(r.skip_reason, 'app_noise');
});

test('🛑 shouldSkipPreLLM §5: meta-complaint regex → skip="meta_complaint"', () => {
  const r = shouldSkipPreLLM({
    turn: { user: '為什麼一直問同樣的問題', ai: '我想多了解' },
    context: { primary_mode: 'elicitation' },
  });
  assert.equal(r.skip_reason, 'meta_complaint');
});

test('🛑 shouldSkipPreLLM: normal substantive turn → null (proceed to LLM)', () => {
  const r = shouldSkipPreLLM({
    turn: { user: '我發現我其實很在意內心的平靜', ai: '聽到你說平靜很重要' },
    context: { primary_mode: 'elicitation' },
  });
  assert.equal(r, null);
});

// ═════════════════════════════════════════════════════════
// parse — strict shape validation
// ═════════════════════════════════════════════════════════

test('🛑 parse: valid observation passes', () => {
  const obj = validObservation({
    values_surfaced: ['平靜', '自由'],
    step_evidence: {
      ...validObservation().step_evidence,
      step_2: [{ type: 'longing_surface', quote: '我想要平靜' }],
    },
  });
  const parsed = parse(JSON.stringify(obj));
  assert.deepEqual(parsed.values_surfaced, ['平靜', '自由']);
  assert.equal(parsed.step_evidence.step_2[0].type, 'longing_surface');
});

test('🛑 parse: missing skip_reason → throws', () => {
  const obj = validObservation();
  delete obj.skip_reason;
  assert.throws(() => parse(JSON.stringify(obj)), /missing skip_reason/);
});

test('🛑 parse: invalid skip_reason enum → throws', () => {
  const obj = validObservation({ skip_reason: 'invalid_reason' });
  assert.throws(() => parse(JSON.stringify(obj)), /skip_reason must be null or one of/);
});

test('🛑 parse: top1_determined non-string non-null → throws', () => {
  const obj = validObservation({ top1_determined: 42 });
  assert.throws(() => parse(JSON.stringify(obj)), /top1_determined must be string or null/);
});

test('🛑 parse: values_surfaced not array → throws', () => {
  const obj = validObservation();
  obj.values_surfaced = 'not an array';
  assert.throws(() => parse(JSON.stringify(obj)), /values_surfaced must be array/);
});

test('🛑 parse: reframe_events wrong type enum → throws', () => {
  const obj = validObservation({
    reframe_events: [{ type: 'invalid_reframe_type', quote: 'q' }],
  });
  assert.throws(() => parse(JSON.stringify(obj)), /entry\.type must be one of/);
});

test('🛑 parse: step_evidence missing step_N → throws', () => {
  const obj = validObservation();
  delete obj.step_evidence.step_4;
  assert.throws(() => parse(JSON.stringify(obj)), /step_evidence missing step_4/);
});

test('🛑 parse: step_evidence entry wrong type for step → throws', () => {
  const obj = validObservation({
    step_evidence: {
      ...validObservation().step_evidence,
      step_4: [{ type: 'pain_surface', quote: '不對' }],  // wrong: pain_surface in step_4
    },
  });
  // Both pain_surface and identity_claim are in STEP_EVIDENCE_TYPES, so this
  // actually passes shape-check (validator allows any step_type for any slot).
  // The semantic check (right type per slot) is judge's job, not parse's.
  const parsed = parse(JSON.stringify(obj));
  assert.equal(parsed.step_evidence.step_4[0].type, 'pain_surface');
});

test('🛑 parse: handles markdown-fenced JSON from Haiku', () => {
  const obj = validObservation();
  const fenced = '```json\n' + JSON.stringify(obj) + '\n```';
  const parsed = parse(fenced);
  assert.equal(parsed.skip, false);
});

// ═════════════════════════════════════════════════════════
// postScrubObservation — defence-in-depth
// ═════════════════════════════════════════════════════════

test('🔴 postScrub: high-risk quote in step_1 → dropped (defence-in-depth)', () => {
  const obs = validObservation({
    step_evidence: {
      ...validObservation().step_evidence,
      step_1: [
        { type: 'pain_surface', quote: '想死了' },
        { type: 'pain_surface', quote: '我感到空' },
      ],
    },
  });
  const scrubbed = postScrubObservation(obs);
  assert.equal(scrubbed.step_evidence.step_1.length, 1,
    'high-risk entry must be dropped, safe one kept');
  assert.equal(scrubbed.step_evidence.step_1[0].quote, '我感到空');
});

test('🔴 postScrub: high-risk in top1 → null', () => {
  const obs = validObservation({ top1_determined: '想死' });
  const scrubbed = postScrubObservation(obs);
  assert.equal(scrubbed.top1_determined, null);
});

test('🔴 postScrub: high-risk in values_surfaced → dropped', () => {
  const obs = validObservation({
    values_surfaced: ['平靜', '不想活', '自由'],
  });
  const scrubbed = postScrubObservation(obs);
  assert.deepEqual(scrubbed.values_surfaced, ['平靜', '自由']);
});

test('🔴 postScrub: high-risk in reframe quote → entry dropped', () => {
  const obs = validObservation({
    reframe_events: [
      { type: 'limiting_belief', quote: '輕生想法' },
      { type: 'sovereignty', quote: '我自己說了算' },
    ],
  });
  const scrubbed = postScrubObservation(obs);
  assert.equal(scrubbed.reframe_events.length, 1);
  assert.equal(scrubbed.reframe_events[0].quote, '我自己說了算');
});

test('🛑 postScrub: long quote truncated to 80 chars', () => {
  const long = '我' + 'A'.repeat(120);
  const obs = validObservation({
    step_evidence: {
      ...validObservation().step_evidence,
      step_3: [{ type: 'data_mining', quote: long }],
    },
  });
  const scrubbed = postScrubObservation(obs);
  assert.equal(scrubbed.step_evidence.step_3[0].quote.length, 80);
});

test('🛑 postScrub: invalid entry types filtered out', () => {
  const obs = validObservation({
    reframe_events: [
      null,
      { type: 'unknown_type', quote: 'q' },
      'not an object',
      { type: 'fuel', quote: '能量句' },
    ],
  });
  const scrubbed = postScrubObservation(obs);
  assert.equal(scrubbed.reframe_events.length, 1);
  assert.equal(scrubbed.reframe_events[0].type, 'fuel');
});

test('🛑 postScrub: bad input → safe empty default', () => {
  const e = postScrubObservation(null);
  assert.equal(e.skip, false);
  for (let n = 1; n <= 7; n++) {
    assert.equal(e.step_evidence[`step_${n}`].length, 0);
  }
});

// ═════════════════════════════════════════════════════════
// emptyObservation
// ═════════════════════════════════════════════════════════

test('🛑 emptyObservation: skip flag follows reason', () => {
  const e1 = emptyObservation();
  assert.equal(e1.skip, false);
  assert.equal(e1.skip_reason, null);
  const e2 = emptyObservation('crisis');
  assert.equal(e2.skip, true);
  assert.equal(e2.skip_reason, 'crisis');
  // All 7 step keys present.
  for (let n = 1; n <= 7; n++) {
    assert.ok(Array.isArray(e2.step_evidence[`step_${n}`]));
  }
});

// ═════════════════════════════════════════════════════════
// 🔴 judge() — full path including mock LLM + pre-skip safety nets
// ═════════════════════════════════════════════════════════

test('🔴 judge: crisis primary_mode → no LLM call, returns crisis empty', async () => {
  let llmCalled = false;
  _setClient({
    messages: { create: async () => { llmCalled = true; return {content:[]}; } },
  });
  const out = await judge({
    turn: { user: '我今天還好啊', ai: '謝謝' },
    context: { primary_mode: 'crisis' },
  });
  assert.equal(llmCalled, false, '🔴 crisis: NEVER call LLM');
  assert.equal(out.skip, true);
  assert.equal(out.skip_reason, 'crisis');
  _setClient(null);
});

test('🔴 judge: high-risk in user → no LLM call, no raw text in output', async () => {
  let llmCalled = false;
  _setClient({
    messages: { create: async () => { llmCalled = true; return {content:[]}; } },
  });
  const out = await judge({
    turn: { user: '有時候我想自殺', ai: '聽到你說' },
    context: { primary_mode: 'elicitation' },
  });
  assert.equal(llmCalled, false, '🔴 high-risk: NEVER call LLM');
  assert.equal(out.skip_reason, 'high_risk');
  // No raw high-risk text anywhere in output.
  const serialized = JSON.stringify(out);
  assert.equal(/自殺|想死|想活/.test(serialized), false,
    'output MUST NOT contain raw high-risk substrings');
  _setClient(null);
});

test('🛑 judge: app noise (1 char) → no LLM call', async () => {
  let llmCalled = false;
  _setClient({
    messages: { create: async () => { llmCalled = true; return {content:[]}; } },
  });
  const out = await judge({
    turn: { user: '嗯', ai: '想聽' },
    context: { primary_mode: 'elicitation' },
  });
  assert.equal(llmCalled, false);
  assert.equal(out.skip_reason, 'app_noise');
  _setClient(null);
});

test('🛑 judge: meta-complaint → no LLM call', async () => {
  let llmCalled = false;
  _setClient({
    messages: { create: async () => { llmCalled = true; return {content:[]}; } },
  });
  const out = await judge({
    turn: { user: '你怎麼又問同樣的問題', ai: '我想多了解' },
    context: { primary_mode: 'elicitation' },
  });
  assert.equal(llmCalled, false);
  assert.equal(out.skip_reason, 'meta_complaint');
  _setClient(null);
});

test('🛑 judge: mock LLM happy path — returns parsed observation', async () => {
  const mockResp = JSON.stringify(validObservation({
    values_surfaced: ['平靜', '自由'],
    step_evidence: {
      ...validObservation().step_evidence,
      step_2: [{ type: 'longing_surface', quote: '我想要內心平靜' }],
    },
  }));
  _setClient(mockClient(mockResp));
  const out = await judge({
    turn: { user: '我很想要內心平靜跟一點自由', ai: '聽到了' },
    accumulated: { values: [], owned: [], top1: null, steps_touched: [] },
    context: { primary_mode: 'elicitation' },
    timeoutMs: 1000,
  });
  assert.equal(out.skip, false);
  assert.deepEqual(out.values_surfaced, ['平靜', '自由']);
  assert.equal(out.step_evidence.step_2[0].type, 'longing_surface');
  _setClient(null);
});

test('🔴 judge: LLM hallucinates high-risk quote → post-scrub drops it', async () => {
  const mockResp = JSON.stringify(validObservation({
    step_evidence: {
      ...validObservation().step_evidence,
      step_1: [
        { type: 'pain_surface', quote: '我有時候想死' },   // model leaked SI
        { type: 'pain_surface', quote: '我感到很空' },     // safe
      ],
    },
  }));
  _setClient(mockClient(mockResp));
  const out = await judge({
    turn: { user: '我感到很空、什麼都沒意義', ai: '想多了解' },
    context: { primary_mode: 'elicitation' },
    timeoutMs: 1000,
  });
  // 🔴 raw "想死" stripped by post-scrub.
  assert.equal(out.step_evidence.step_1.length, 1);
  assert.equal(out.step_evidence.step_1[0].quote, '我感到很空');
  _setClient(null);
});

test('🛑 judge: LLM timeout → fail-soft empty (skip=false)', async () => {
  // Mock with a slow create call to force the runJudge timeout to fire.
  _setClient({
    messages: { create: () => new Promise(r => setTimeout(() => r({ content: [] }), 200)) },
  });
  const out = await judge({
    turn: { user: '我發現很多東西', ai: '聽到了' },
    context: { primary_mode: 'elicitation' },
    timeoutMs: 50,  // very short — forces timeout
  });
  assert.equal(out.skip, false);
  assert.equal(out.skip_reason, null);  // empty not skip
  assert.equal(out.values_surfaced.length, 0);
  _setClient(null);
});

test('🛑 judge: LLM returns malformed JSON → fail-soft empty', async () => {
  _setClient(mockClient('not json at all'));
  const out = await judge({
    turn: { user: '我發現平靜很重要', ai: '聽到了' },
    context: { primary_mode: 'elicitation' },
    timeoutMs: 1000,
  });
  assert.equal(out.skip, false);
  assert.equal(out.values_surfaced.length, 0);
  _setClient(null);
});

test('🛑 judge: LLM JSON missing field → fail-soft empty', async () => {
  const bad = JSON.stringify({ skip: false, skip_reason: null });  // missing other fields
  _setClient(mockClient(bad));
  const out = await judge({
    turn: { user: '我發現平靜很重要', ai: '聽到了' },
    context: { primary_mode: 'elicitation' },
    timeoutMs: 1000,
  });
  assert.equal(out.skip, false);
  assert.equal(out.values_surfaced.length, 0);
  _setClient(null);
});

// ═════════════════════════════════════════════════════════
// buildUserPrompt + SYSTEM_PROMPT sanity
// ═════════════════════════════════════════════════════════

test('🛑 buildUserPrompt: includes turn / accumulated / mode', () => {
  const p = buildUserPrompt({
    turn: { day: 5, question_number: 3, ai: '想多聽你說', user: '我發現平靜' },
    accumulated: { values: ['自由'], owned: [], top1: null, steps_touched: [1, 2] },
    context: { primary_mode: 'elicitation' },
  });
  assert.match(p, /day 5/);
  assert.match(p, /question 3/);
  assert.match(p, /我發現平靜/);
  assert.match(p, /想多聽你說/);
  assert.match(p, /自由/);
  assert.match(p, /step_1, step_2/);
  assert.match(p, /elicitation/);
  assert.match(p, /DELTA beyond accumulated/);
});

test('🛑 buildUserPrompt: empty accumulated → "(none yet)" placeholders', () => {
  const p = buildUserPrompt({
    turn: { day: 1, question_number: 1, ai: 'q', user: 'a' },
    accumulated: {},
    context: { primary_mode: 'elicitation' },
  });
  assert.match(p, /values surfaced: \(none yet\)/);
  assert.match(p, /owned \(no-hedge\): \(none yet\)/);
  assert.match(p, /top1: \(not yet\)/);
});

test('🔴 SYSTEM_PROMPT: contains spec §4 safety + §6a substance + skip schema', () => {
  // Anchor checks — these are the load-bearing parts of the prompt for safety + correctness.
  assert.match(SYSTEM_PROMPT, /SAFETY/, '§4 safety section header');
  assert.match(SYSTEM_PROMPT, /自殺.+想死.+去死.+輕生.+自傷.+割腕.+上吊.+跳樓.+燒炭.+不想活.+無所眷念/s,
    'all 11 high-risk patterns must be listed in prompt');
  assert.match(SYSTEM_PROMPT, /SUBSTANCE not FORM/, '§6a supreme principle header');
  assert.match(SYSTEM_PROMPT, /A005/, '§6a A005 case explanation');
  assert.match(SYSTEM_PROMPT, /skip_reason/, 'output schema includes skip_reason');
  assert.match(SYSTEM_PROMPT, /values_surfaced/);
  assert.match(SYSTEM_PROMPT, /top1_determined/);
  assert.match(SYSTEM_PROMPT, /owned_confirmed/);
  assert.match(SYSTEM_PROMPT, /step_evidence/);
  assert.match(SYSTEM_PROMPT, /reframe_events/);
});

test('🛑 constants exported + frozen for test-safe enumeration', () => {
  assert.deepEqual([...SKIP_REASONS],
    ['crisis', 'high_risk', 'meta_complaint', 'app_noise']);
  assert.equal(STEP_EVIDENCE_TYPES.length, 7);
  assert.equal(REFRAME_EVENT_TYPES.length, 4);
  // Frozen.
  assert.throws(() => SKIP_REASONS.push('new'), TypeError);
});

// ═════════════════════════════════════════════════════════
// 🔴 6/12 Round-1 calibration — SYSTEM_PROMPT tightening per Patrick spec
// ═════════════════════════════════════════════════════════

test('🔴 SYSTEM_PROMPT: 6/12 values exclusion list (transient states/skills)', () => {
  // After 1st eval, observer over-captured 觀察力 / 放空 as values.
  assert.match(SYSTEM_PROMPT, /觀察力.+放空.+專注.+可見性.+細微性/s,
    'Prompt must list 5 transient terms as NOT values');
  assert.match(SYSTEM_PROMPT, /HOW someone notices, not WHAT they are/i,
    'Prompt must explain transient-vs-quality distinction');
});

test('🔴 SYSTEM_PROMPT: 6/12 owned canonicalization (clean trait nouns only)', () => {
  // After 1st eval, observer captured description sentences as owned.
  assert.match(SYSTEM_PROMPT, /CANONICAL TRAIT NOUNS/);
  // Use multiline match — actual prompt has line break between "description" and "sentences".
  assert.match(SYSTEM_PROMPT, /NOT description[\s\S]{0,40}sentences/,
    'Prompt must explicitly forbid description sentences as owned entries');
  assert.match(SYSTEM_PROMPT, /媽媽的依靠|心靈上的支柱|自然就想給的人/,
    'Prompt must include the actual mis-capture examples as ❌ counter-examples');
  assert.match(SYSTEM_PROMPT, /1-3 entries per learner/,
    'Prompt must cap owned size guidance (few + clean)');
});

test('🔴 SYSTEM_PROMPT: 6/12 step_7 anchor capture explicit', () => {
  // After 1st eval, observer missed step_7 anchoring (A006 「照顧」 not recorded).
  assert.match(SYSTEM_PROMPT, /step_7 ANCHORING/i);
  assert.match(SYSTEM_PROMPT, /把這句話留下來|定錨/,
    'Prompt must give the AI-side anchor patterns');
  assert.match(SYSTEM_PROMPT, /A006.+照顧/,
    'Prompt must cite A006 「照顧」 case as the exemplar');
});

test('🛑 SYSTEM_PROMPT: stable invariants (safety + §6a substance) still present after tightening', () => {
  assert.match(SYSTEM_PROMPT, /SAFETY/);
  assert.match(SYSTEM_PROMPT, /SUBSTANCE not FORM/);
  assert.match(SYSTEM_PROMPT, /A005/);
});
