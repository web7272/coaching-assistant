// lib/api/sc-storyboard-gen.test.js
// v5.3 件3 PR-J2 — 大腦現狀 generation safety + correctness tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SC_STEP_DEFINITIONS,
  QUOTE_TYPE_PRIORITY,
  SC_STORYBOARD_HIGH_RISK_PATTERNS,
  pickSafeQuote,
  buildBrainStateSystemPrompt,
  buildBrainStateUserMessage,
  scrubBrainStateText,
  generateBrainState,
  listStepsWithEvidence,
} from './sc-storyboard-gen.js';

// ═════════════════════════════════════════════════════════
// SC_STEP_DEFINITIONS — verbatim §3.5 cached content
// ═════════════════════════════════════════════════════════

test('🛑 PR-J2: SC_STEP_DEFINITIONS = 7 entries, frozen', () => {
  assert.equal(Object.isFrozen(SC_STEP_DEFINITIONS), true);
  for (let n = 1; n <= 7; n++) {
    assert.ok(SC_STEP_DEFINITIONS[n],
      `step ${n} must have a definition`);
    assert.ok(SC_STEP_DEFINITIONS[n].length > 0);
  }
});

test('🛑 PR-J2: SC_STEP_DEFINITIONS verbatim from §3.5 (not new wording)', () => {
  // Spot-check verbatim:從 §3.5 cached「學員當下在做什麼」 column.
  assert.match(SC_STEP_DEFINITIONS[1], /發現匱乏 \(The Void\)/);
  assert.match(SC_STEP_DEFINITIONS[1], /surface 痛點、卡住、自我懷疑/);
  assert.match(SC_STEP_DEFINITIONS[4], /認領身份 \(Claiming Identity\)/);
  assert.match(SC_STEP_DEFINITIONS[4], /植入新標籤「我是 X 的人」/);
  assert.match(SC_STEP_DEFINITIONS[7], /標籤定錨 \(Anchoring\)/);
  assert.match(SC_STEP_DEFINITIONS[7], /新身份在神經系統固化、自動運行/);
});

// ═════════════════════════════════════════════════════════
// 🔴 pickSafeQuote — Patrick safety 命門 #1
// ═════════════════════════════════════════════════════════

test('🛑 PR-J2 pickSafeQuote: empty / null → null', () => {
  assert.equal(pickSafeQuote([]),          null);
  assert.equal(pickSafeQuote(null),        null);
  assert.equal(pickSafeQuote(undefined),   null);
  assert.equal(pickSafeQuote('not-array'), null);
});

test('🛑 PR-J2 pickSafeQuote: drops entries with high-risk quote (defence-in-depth)', () => {
  // Upstream PR-4 should have filtered, but PR-J2 distrusts transitively.
  const out = pickSafeQuote([
    { type: 'pain_surface',      quote: '我想自殺' },     // dropped
    { type: 'longing_surface',   quote: '我想被看見' },   // safe
  ]);
  assert.equal(out, '我想被看見',
    '🔴 ship-gate: high-risk quote MUST be skipped, safe one picked');
});

test('🛑 PR-J2 pickSafeQuote: prefers upward types over pain (per Patrick priority)', () => {
  const out = pickSafeQuote([
    { type: 'pain_surface',       quote: '我覺得很糟' },
    { type: 'identity_claim',     quote: '我是勇敢的人' },
    { type: 'data_mining',        quote: '我去年做過' },
  ]);
  assert.equal(out, '我是勇敢的人',
    'identity_claim (priority) > pain_surface');
});

test('🛑 PR-J2 pickSafeQuote: anchoring > sovereignty > identity > resource > longing > data > pain', () => {
  const allTypes = [
    { type: 'pain_surface',        quote: 'A' },
    { type: 'data_mining',         quote: 'B' },
    { type: 'longing_surface',     quote: 'C' },
    { type: 'resource_retrieval',  quote: 'D' },
    { type: 'identity_claim',      quote: 'E' },
    { type: 'sovereignty_reclaim', quote: 'F' },
    { type: 'anchoring',           quote: 'G' },
  ];
  assert.equal(pickSafeQuote(allTypes), 'G',
    'with all 7 types present, anchoring wins (priority order)');
});

test('🛑 PR-J2 pickSafeQuote: within same type, picks LATEST entry', () => {
  const out = pickSafeQuote([
    { type: 'identity_claim', quote: '舊版本' },
    { type: 'identity_claim', quote: '中版本' },
    { type: 'identity_claim', quote: '最新版本' },
  ]);
  assert.equal(out, '最新版本');
});

test('🛑 PR-J2 pickSafeQuote: all high-risk → null', () => {
  const out = pickSafeQuote([
    { type: 'pain_surface',    quote: '我想死' },
    { type: 'longing_surface', quote: '想自殺' },
  ]);
  assert.equal(out, null,
    '🔴 ship-gate: all entries high-risk → null (no fallback to dirty quote)');
});

test('🛑 PR-J2 pickSafeQuote: 全量 evidence 倒進去 ANTI-REGRESSION — 一次只回 1 quote', () => {
  // Patrick spec: "絕不把 evidence 全量句倒進去". Function returns single string,
  // never array.
  const out = pickSafeQuote(Array.from({ length: 20 }, (_, i) => ({
    type: 'identity_claim', quote: `entry ${i}` })));
  assert.equal(typeof out, 'string',
    'must return a single string, never an array of quotes');
});

test('🛑 PR-J2 pickSafeQuote: handles whitespace + empty quote → null', () => {
  assert.equal(pickSafeQuote([
    { type: 'identity_claim', quote: '   ' },
    { type: 'pain_surface',   quote: '' },
    { type: 'longing_surface', quote: null },
  ]), null);
});

// ═════════════════════════════════════════════════════════
// 🔴 buildBrainStateSystemPrompt — safety prohibitions in prompt
// ═════════════════════════════════════════════════════════

test('🛑 PR-J2 prompt: contains Vivi 6/11 「不複述黑暗原話 / 不評價 / 不說教」', () => {
  const p = buildBrainStateSystemPrompt(1);
  assert.match(p, /只承接痛、不複述黑暗原話/);
  assert.match(p, /不評價、不說教、不診斷/);
});

test('🛑 PR-J2 prompt: explicitly forbids 自殺/輕生/自傷 + 7 more high-risk terms', () => {
  const p = buildBrainStateSystemPrompt(1);
  assert.match(p, /自殺/);
  assert.match(p, /輕生/);
  assert.match(p, /自傷/);
  assert.match(p, /想死/);
});

test('🛑 PR-J2 prompt: forbids 標步驟編號 (對齊 §3.5 framing)', () => {
  const p = buildBrainStateSystemPrompt(1);
  // 「Step X」/「第 X 步」/「七步」 — should be in the prohibition list.
  assert.match(p, /Step X/);
});

test('🛑 PR-J2 prompt: ≤90 字、第二人稱、溫柔精準 instructions present', () => {
  const p = buildBrainStateSystemPrompt(3);
  assert.match(p, /≤90 字/);
  assert.match(p, /第二人稱/);
  assert.match(p, /溫柔精準/);
});

test('🛑 PR-J2 prompt: step definition reused from §3.5 (verbatim, not 新寫)', () => {
  const p4 = buildBrainStateSystemPrompt(4);
  assert.match(p4, /認領身份/);
  assert.match(p4, /植入新標籤「我是 X 的人」/);
});

// ═════════════════════════════════════════════════════════
// buildBrainStateUserMessage — quote context handling
// ═════════════════════════════════════════════════════════

test('🛑 PR-J2 user msg: includes safe quote when supplied', () => {
  const msg = buildBrainStateUserMessage(2, '我想被看見');
  assert.match(msg, /「我想被看見」/);
  assert.match(msg, /情緒語境參考/);
  assert.match(msg, /不要逐字 paste/);
});

test('🛑 PR-J2 user msg: omits quote section when null', () => {
  const msg = buildBrainStateUserMessage(2, null);
  // 「 chars appear in step definition (e.g. "「不想要」") so don't check those.
  // Verify the quote-context block markers are absent.
  assert.equal(/情緒語境參考/.test(msg), false);
  assert.equal(/不要逐字 paste/.test(msg), false);
});

// ═════════════════════════════════════════════════════════
// 🔴 scrubBrainStateText — Defense 2 (Patrick safety 命門 #2)
// ═════════════════════════════════════════════════════════

test('🛑 PR-J2 scrub: high-risk text pre-sanitize → null (fail-closed)', () => {
  assert.equal(scrubBrainStateText('你現在想自殺'), null);
  assert.equal(scrubBrainStateText('學員提到想死'), null);
  assert.equal(scrubBrainStateText('那段日子你想去死'), null);
});

test('🛑 PR-J2 scrub: clean text passes through (cleaned)', () => {
  const out = scrubBrainStateText('那段日子,你心裡空了一塊。');
  assert.ok(out);
  assert.match(out, /那段日子/);
});

test('🛑 PR-J2 scrub: text with FORBIDDEN section markers → null', () => {
  // sanitizeStudentNote strips FORBIDDEN section markers; if result lacks
  // anything else, returns empty → scrubBrainStateText returns null.
  const out = scrubBrainStateText('【關鍵句】\n敏感內容\n【深度層次】');
  // The whole input is FORBIDDEN section header content; sanitize strips it.
  // Result either empty or still contains markers — either way our wrapper
  // returns null fail-closed.
  assert.equal(out === null || !/【關鍵句】|【深度層次】/.test(out), true,
    '🔴 ship-gate: FORBIDDEN markers must NOT survive in returned text');
});

test('🛑 PR-J2 scrub: empty / null / non-string → null', () => {
  assert.equal(scrubBrainStateText(''),      null);
  assert.equal(scrubBrainStateText(null),    null);
  assert.equal(scrubBrainStateText(42),      null);
});

// ═════════════════════════════════════════════════════════
// 🔴 generateBrainState — orchestration + safety integration
// ═════════════════════════════════════════════════════════

function mockAnthropic(returnText) {
  return {
    messages: {
      create: async () => ({
        content: [{ text: returnText }],
      }),
    },
  };
}

function mockCallAnthropic(returnText) {
  return async () => ({ ok: true, data: { content: [{ text: returnText }] } });
}

test('🛑 PR-J2 generateBrainState: happy path → {description, quote}', async () => {
  const out = await generateBrainState({
    stepNo: 4,
    evidenceEntries: [
      { type: 'identity_claim', quote: '我是勇敢的人' },
    ],
    anthropic: mockAnthropic('那段日子,你開始說「我是這樣的人」。'),
    callAnthropicWithRetry: mockCallAnthropic('那段日子,你開始說「我是這樣的人」。'),
  });
  assert.ok(out);
  assert.match(out.description, /那段日子/);
  assert.equal(out.quote, '我是勇敢的人',
    'quote uses pickSafeQuote output (structured term, defence-in-depth filtered)');
});

test('🛑 PR-J2 generateBrainState: empty evidence → null', async () => {
  const out = await generateBrainState({
    stepNo: 1,
    evidenceEntries: [],
    anthropic: mockAnthropic('x'),
    callAnthropicWithRetry: mockCallAnthropic('x'),
  });
  assert.equal(out, null);
});

test('🛑 PR-J2 generateBrainState: invalid stepNo → null', async () => {
  const out = await generateBrainState({
    stepNo: 8,
    evidenceEntries: [{ type: 'anchoring', quote: 'x' }],
    anthropic: mockAnthropic('x'),
    callAnthropicWithRetry: mockCallAnthropic('x'),
  });
  assert.equal(out, null);
});

test('🛑 PR-J2 generateBrainState: ALL high-risk evidence → quote = null, description still gens', async () => {
  // High-risk quotes get filtered → quote = null. description generation
  // still proceeds (no representativeQuote context).
  const out = await generateBrainState({
    stepNo: 1,
    evidenceEntries: [
      { type: 'pain_surface', quote: '想自殺' },
      { type: 'pain_surface', quote: '想死' },
    ],
    anthropic: mockAnthropic('那段日子,你心裡空了一塊。'),
    callAnthropicWithRetry: mockCallAnthropic('那段日子,你心裡空了一塊。'),
  });
  assert.ok(out);
  assert.equal(out.quote, null,
    '🔴 ship-gate: when no safe quote exists, quote=null (no high-risk leak)');
  assert.match(out.description, /那段日子/);
});

test('🛑 PR-J2 generateBrainState: LLM throws → null fail-soft (does NOT throw)', async () => {
  const throwingCallAnthropic = async () => { throw new Error('timeout'); };
  const out = await generateBrainState({
    stepNo: 1,
    evidenceEntries: [{ type: 'pain_surface', quote: 'x' }],
    anthropic: mockAnthropic('x'),
    callAnthropicWithRetry: throwingCallAnthropic,
    log: () => {},
  });
  assert.equal(out, null);
});

test('🛑 PR-J2 generateBrainState: LLM returns no text → null', async () => {
  const callAnthropic = async () => ({ ok: true, data: { content: [] } });
  const out = await generateBrainState({
    stepNo: 1,
    evidenceEntries: [{ type: 'longing_surface', quote: 'x' }],
    anthropic: mockAnthropic('whatever'),
    callAnthropicWithRetry: callAnthropic,
    log: () => {},
  });
  assert.equal(out, null);
});

test('🛑 PR-J2 generateBrainState: LLM returns FORBIDDEN/dirty text → scrubbed → null', async () => {
  // Even if LLM somehow ignores prompt and outputs 自殺, Defense 2 kills it.
  const out = await generateBrainState({
    stepNo: 1,
    evidenceEntries: [{ type: 'longing_surface', quote: 'x' }],
    anthropic: mockAnthropic('你想自殺'),
    callAnthropicWithRetry: mockCallAnthropic('你想自殺'),
    log: () => {},
  });
  assert.equal(out, null,
    '🔴 ship-gate: dirty LLM output MUST be killed by scrubber (Defense 2)');
});

test('🛑 PR-J2 generateBrainState: missing anthropic → null fail-soft', async () => {
  const out = await generateBrainState({
    stepNo: 1,
    evidenceEntries: [{ type: 'longing_surface', quote: 'x' }],
    anthropic: null,
    callAnthropicWithRetry: null,
    log: () => {},
  });
  assert.equal(out, null);
});

// ═════════════════════════════════════════════════════════
// listStepsWithEvidence — finalize incremental gen helper
// ═════════════════════════════════════════════════════════

test('🛑 PR-J2 listStepsWithEvidence: returns ascending step numbers for non-empty entries', () => {
  const evidence = {
    step_1: [], step_2: [{ type: 'longing_surface' }],
    step_3: [], step_4: [{ type: 'identity_claim' }],
    step_5: [], step_6: [], step_7: [{ type: 'anchoring' }],
  };
  assert.deepEqual(listStepsWithEvidence(evidence), [2, 4, 7]);
});

test('🛑 PR-J2 listStepsWithEvidence: empty / null / wrong shape → []', () => {
  assert.deepEqual(listStepsWithEvidence(null),     []);
  assert.deepEqual(listStepsWithEvidence({}),       []);
  assert.deepEqual(listStepsWithEvidence([]),       []);
  assert.deepEqual(listStepsWithEvidence('string'), []);
});

// ═════════════════════════════════════════════════════════
// 🔴 sim ship-gate sanity (cross-helper)
// ═════════════════════════════════════════════════════════

test('🛑 PR-J2 ship-gate: SC_STORYBOARD_HIGH_RISK_PATTERNS covers Patrick spec list', () => {
  // Patrick spec: 自殺/輕生/自傷/想死/去死/割腕/上吊/跳樓/燒炭.
  const testStrings = ['自殺', '想死', '去死', '輕生', '自傷', '割腕', '上吊', '跳樓', '燒炭'];
  for (const s of testStrings) {
    assert.ok(SC_STORYBOARD_HIGH_RISK_PATTERNS.some(p => p.test(s)),
      `denylist must cover "${s}"`);
  }
});

test('🛑 PR-J2 ship-gate: QUOTE_TYPE_PRIORITY = 7 types, pain_surface LAST', () => {
  assert.equal(QUOTE_TYPE_PRIORITY.length, 7);
  assert.equal(QUOTE_TYPE_PRIORITY[QUOTE_TYPE_PRIORITY.length - 1], 'pain_surface',
    'pain_surface MUST be last (pickSafeQuote prefers upward)');
});
