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
  // PR-J3 — sovereign_action
  SOVEREIGN_ACTION_PROTOTYPES,
  SELF_CONTROL_DECLARATION_PATTERNS,
  RIGIDITY_AT_SELF_PATTERNS,
  hasSufficientPersonalization,
  buildSovereignActionSystemPrompt,
  buildSovereignActionUserMessage,
  generateSovereignAction,
  J3_MAX_ATTEMPTS,                          // 6/14 Patrick J3 retry
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
  assert.match(SC_STEP_DEFINITIONS[7], /新的身分 \(Anchoring\)/);
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

test('🛑 PR-J2 pickSafeQuote: when identity_claim + pain_surface both present, identity_claim chosen', () => {
  // 🔴 Patrick safety: pain_surface is NEVER a fall-back. identity_claim wins.
  const out = pickSafeQuote([
    { type: 'pain_surface',       quote: '我覺得很糟' },     // SKIP (痛句)
    { type: 'identity_claim',     quote: '我是勇敢的人' },   // PICK
    { type: 'data_mining',        quote: '我去年做過' },
  ]);
  assert.equal(out, '我是勇敢的人');
});

test('🛑 PR-J2 pickSafeQuote: priority order: anchoring > sovereignty > identity > resource > longing > data (NO pain)', () => {
  const allUpward = [
    { type: 'pain_surface',        quote: 'A' },   // never picked
    { type: 'data_mining',         quote: 'B' },
    { type: 'longing_surface',     quote: 'C' },
    { type: 'resource_retrieval',  quote: 'D' },
    { type: 'identity_claim',      quote: 'E' },
    { type: 'sovereignty_reclaim', quote: 'F' },
    { type: 'anchoring',           quote: 'G' },
  ];
  assert.equal(pickSafeQuote(allUpward), 'G',
    'anchoring wins (top priority)');
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
  // 6/12 Patrick observer spec: + 不想活 / 無所眷念.
  // 6/14 Patrick A006 dryRun 漏網修: + 傷害(.{0,2})自己 (傷害自己 / 傷害我自己 /
  //   傷害了自己) + 自我傷害.
  const testStrings = [
    '自殺', '想死', '去死', '輕生', '自傷', '割腕', '上吊', '跳樓', '燒炭',
    '不想活', '無所眷念',
    '傷害自己', '傷害我自己', '傷害了自己', '自我傷害',
  ];
  for (const s of testStrings) {
    assert.ok(SC_STORYBOARD_HIGH_RISK_PATTERNS.some(p => p.test(s)),
      `denylist must cover "${s}"`);
  }
});

test('🛑 6/14 A006 漏網修: 真實 dryRun leaked quote "你不用擔心我會傷害我自己" must be caught', () => {
  // 真實 quote from A006 step_6 brain_state — 必須被 denylist 抓.
  const leaked = '你不用擔心我會傷害我自己，縱使我是一個人待著';
  assert.ok(SC_STORYBOARD_HIGH_RISK_PATTERNS.some(p => p.test(leaked)),
    'denylist 必須抓「你不用擔心我會傷害我自己」這類 — 即使是康復語氣');
});

test('🛑 PR-J2 ship-gate: QUOTE_TYPE_PRIORITY = 6 upward types, pain_surface EXCLUDED', () => {
  // 🔴 Patrick 6/11 safety: pain_surface NEVER eligible as verbatim quote.
  assert.equal(QUOTE_TYPE_PRIORITY.length, 6);
  assert.equal(QUOTE_TYPE_PRIORITY.includes('pain_surface'), false,
    '🔴 ship-gate: pain_surface MUST NOT appear in QUOTE_TYPE_PRIORITY');
  assert.equal(QUOTE_TYPE_PRIORITY[0], 'anchoring',
    'anchoring stays top priority');
});

test('🛑 PR-J2 ship-gate: 🔴 pain_surface-only step → quote null (痛句絕不逐字顯示)', () => {
  // §1.5 rule 1 / §2.2 / §2.3 / 原則「轉標籤、不是記錄痛苦」.
  // Patrick walk-through example: step_1 pain-only → quote null,
  // 不是 '我不夠好' (verbatim 痛句回放).
  assert.equal(pickSafeQuote([{ type: 'pain_surface', quote: '我不夠好' }]), null,
    '🔴 ship-gate: pain_surface-only → null (description still承接 via LLM rewrite)');
  assert.equal(pickSafeQuote([
    { type: 'pain_surface', quote: '我不夠好' },
    { type: 'pain_surface', quote: '我做不到' },
    { type: 'pain_surface', quote: '我糟透了' },
  ]), null, 'multi-pain entries → still null');
});

test('🛑 PR-J2 ship-gate: 🔴 NO unknown-type fall-through (Patrick removed in safety fix)', () => {
  // Previous behavior fell back to "latest safe entry" when type unknown.
  // That path is removed — only listed types are selectable.
  assert.equal(pickSafeQuote([{ type: 'mystery_type', quote: 'whatever' }]), null,
    '🔴 unknown type MUST return null, NOT the latest safe entry');
  assert.equal(pickSafeQuote([
    { type: 'pain_surface',   quote: '痛句' },
    { type: 'mystery_type',   quote: '未列舉 type' },
  ]), null, 'mixed pain + unknown → still null');
});

// ═════════════════════════════════════════════════════════════════
// 🛑 v5.3 件3 PR-J3 — sovereign_action generation (個人化紅線)
// ═════════════════════════════════════════════════════════════════

test('🛑 PR-J3: SOVEREIGN_ACTION_PROTOTYPES = 7 entries, frozen, §2.4 verbatim', () => {
  assert.equal(Object.isFrozen(SOVEREIGN_ACTION_PROTOTYPES), true);
  for (let n = 1; n <= 7; n++) {
    assert.ok(SOVEREIGN_ACTION_PROTOTYPES[n], `step ${n} prototype must exist`);
  }
  // Spot-check verbatim phrasing.
  assert.match(SOVEREIGN_ACTION_PROTOTYPES[1], /我存不存在.*開關交給外在/);
  assert.match(SOVEREIGN_ACTION_PROTOTYPES[1], /內控宣告/);
  assert.match(SOVEREIGN_ACTION_PROTOTYPES[6], /撕開「對方的選擇」.*你的價值/);
  assert.match(SOVEREIGN_ACTION_PROTOTYPES[6], /愛轉回自己/);
  assert.match(SOVEREIGN_ACTION_PROTOTYPES[7], /每天掃描微證據/);
  assert.match(SOVEREIGN_ACTION_PROTOTYPES[7], /我說了算/);
});

test('🛑 PR-J3: SELF_CONTROL_DECLARATION_PATTERNS covers Patrick spec examples', () => {
  // Spec lists「我自己說了算」/「不需要任何人批准」 as examples; we also accept
  // semantic equivalents (我才是裁判 / 主導權在我 等).
  const tail = '結尾我自己說了算。';
  assert.ok(SELF_CONTROL_DECLARATION_PATTERNS.some(p => p.test(tail)));
  assert.ok(SELF_CONTROL_DECLARATION_PATTERNS.some(p => p.test('不需要任何人批准。')));
  assert.ok(SELF_CONTROL_DECLARATION_PATTERNS.some(p => p.test('主導權在我。')));
});

// ─── hasSufficientPersonalization — 個人化紅線 floor ────────────

test('🛑 PR-J3 personalization: all 3 sources empty → false', () => {
  assert.equal(hasSufficientPersonalization({}), false);
  assert.equal(hasSufficientPersonalization({
    activeContext: {},
    surfacedValues: [],
    stepEvidence: [],
  }), false);
});

test('🛑 PR-J3 personalization: only active_context (≥2 needed) → false', () => {
  assert.equal(hasSufficientPersonalization({
    activeContext: { name: '工作', definition: '我的當前角色' },
  }), false, 'active_context alone is not enough (need 2/3 sources)');
});

test('🛑 PR-J3 personalization: active_context + surfacedValues → true', () => {
  assert.equal(hasSufficientPersonalization({
    activeContext: { name: '工作', definition: '我當前角色' },
    surfacedValues: ['勇敢的'],
    stepEvidence: [],
  }), true);
});

test('🛑 PR-J3 personalization: active_context + stepEvidence → true', () => {
  assert.equal(hasSufficientPersonalization({
    activeContext: { name: '伴侶', definition: '與 A 的關係' },
    surfacedValues: [],
    stepEvidence: [{ type: 'identity_claim', quote: '我是這樣的人' }],
  }), true);
});

test('🛑 PR-J3 personalization: empty/whitespace context name → not counted', () => {
  assert.equal(hasSufficientPersonalization({
    activeContext: { name: '   ', definition: '我當前角色' },
    surfacedValues: ['勇敢的'],
  }), false);
});

// ─── buildSovereignActionSystemPrompt — 紅線 prompt ─────────────

test('🛑 PR-J3 prompt: contains 個人化紅線 (Patrick 6/11)', () => {
  const p = buildSovereignActionSystemPrompt(1);
  assert.match(p, /必須用學員自己的材料/);
  assert.match(p, /不能寫成可以套在任何人身上的通用句/);
});

test('🛑 PR-J3 prompt: 結尾必落內控宣告 + 剛性對準舊信念', () => {
  const p = buildSovereignActionSystemPrompt(3);
  assert.match(p, /結尾必落內控宣告/);
  assert.match(p, /我自己說了算|我才是裁判|主導權在我|不需要外在批准/);
  assert.match(p, /剛性對準舊信念.*外在裁判/);
  assert.match(p, /絕不剛性對準學員自己/);
});

test('🛑 PR-J3 prompt: 高危 + Step X 標號禁止', () => {
  const p = buildSovereignActionSystemPrompt(1);
  assert.match(p, /自殺/);
  assert.match(p, /輕生/);
  assert.match(p, /Step X/);
});

test('🛑 PR-J3 prompt: 80-140 字 + 第二人稱 + 要有力量', () => {
  const p = buildSovereignActionSystemPrompt(4);
  assert.match(p, /80-140 字/);
  assert.match(p, /第二人稱/);
  assert.match(p, /要有力量/);
});

test('🛑 PR-J3 prompt: 嵌入 §2.4 verbatim 原型骨架 for THIS step', () => {
  const p2 = buildSovereignActionSystemPrompt(2);
  assert.match(p2, /對舊標籤英雄式歡迎/);
  assert.match(p2, /翻譯成中性能力/);
  const p7 = buildSovereignActionSystemPrompt(7);
  assert.match(p7, /用學員定錨句/);
  assert.match(p7, /釘進神經系統/);
});

// ─── buildSovereignActionUserMessage — personalization payload ──

test('🛑 PR-J3 user msg: includes active_context name + definition', () => {
  const msg = buildSovereignActionUserMessage(4, {
    activeContext: { name: '伴侶關係', definition: '與 B 的婚姻' },
    surfacedValues: ['誠實的'],
    stepEvidence: [],
  });
  assert.match(msg, /伴侶關係/);
  assert.match(msg, /與 B 的婚姻/);
});

test('🛑 PR-J3 user msg: includes surfacedValues (up to 5)', () => {
  const msg = buildSovereignActionUserMessage(4, {
    activeContext: { name: 'X', definition: 'Y' },
    surfacedValues: ['勇敢的', '誠實的', '專注的', '溫柔的', '清晰的', 'should-NOT-appear'],
    stepEvidence: [],
  });
  assert.match(msg, /勇敢的/);
  assert.match(msg, /誠實的/);
  assert.equal(msg.includes('should-NOT-appear'), false, 'cap at 5');
});

test('🛑 PR-J3 user msg: includes stepEvidence (excludes pain_surface, no high-risk)', () => {
  const msg = buildSovereignActionUserMessage(4, {
    activeContext: { name: 'X', definition: 'Y' },
    surfacedValues: [],
    stepEvidence: [
      { type: 'identity_claim', quote: '我是這樣的人' },
      { type: 'pain_surface',   quote: '我不夠好' },     // excluded
      { type: 'longing_surface', quote: '我想被看見' },
    ],
  });
  assert.match(msg, /identity_claim/);
  assert.match(msg, /我是這樣的人/);
  assert.match(msg, /longing_surface/);
  assert.equal(msg.includes('我不夠好'), false, 'pain_surface excluded');
});

test('🛑 PR-J3 user msg: drops high-risk quotes from evidence', () => {
  const msg = buildSovereignActionUserMessage(4, {
    activeContext: { name: 'X', definition: 'Y' },
    surfacedValues: [],
    stepEvidence: [{ type: 'identity_claim', quote: '想自殺' }],
  });
  assert.equal(msg.includes('想自殺'), false);
});

// ─── generateSovereignAction — orchestration + safety ───────────

function mockCallAnthropicReturning(text) {
  return async () => ({ ok: true, data: { content: [{ text }] } });
}

const ANTHROPIC_STUB = { messages: { create: async () => ({}) } };

const SUFFICIENT_CTX = {
  activeContext: { name: '伴侶關係', definition: '我與 A 的婚姻' },
  surfacedValues: ['誠實的'],
  stepEvidence: [{ type: 'identity_claim', quote: '我是誠實的人' }],
};

test('🛑 PR-J3 generate: empty ctx → null (個人化不夠絕不掉 generic)', async () => {
  const out = await generateSovereignAction({
    stepNo: 1, ctx: {},
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: mockCallAnthropicReturning('something。我自己說了算'),
    log: () => {},
  });
  assert.equal(out, null,
    '🔴 ship-gate: 素材不夠 → null (NEVER fallback to generic)');
});

test('🛑 PR-J3 generate: invalid stepNo → null', async () => {
  const out = await generateSovereignAction({
    stepNo: 8, ctx: SUFFICIENT_CTX,
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: mockCallAnthropicReturning('x'),
    log: () => {},
  });
  assert.equal(out, null);
});

test('🛑 PR-J3 generate: happy → cleaned text', async () => {
  const goodText = `這一段是給你的具體指令,80-140 字之間,結尾我自己說了算。`;
  const out = await generateSovereignAction({
    stepNo: 4, ctx: SUFFICIENT_CTX,
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: mockCallAnthropicReturning(goodText),
    log: () => {},
  });
  assert.equal(out, goodText);
});

test('🛑 PR-J3 generate: 🔴 LLM output without self-control declaration → null', async () => {
  const noDeclaration = '這段話完全沒有任何內控宣告或主導權聲明的尾巴。';
  const out = await generateSovereignAction({
    stepNo: 4, ctx: SUFFICIENT_CTX,
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: mockCallAnthropicReturning(noDeclaration),
    log: () => {},
  });
  assert.equal(out, null,
    '🔴 ship-gate: no self-control declaration → null (no leak of weak ending)');
});

test('🛑 PR-J3 generate: 🔴 rigidity-at-self → null', async () => {
  // LLM出 「你錯了」 — points at learner, must reject.
  const text = '舊標籤過時了。你錯了。要拿回主導權。我自己說了算。';
  const out = await generateSovereignAction({
    stepNo: 4, ctx: SUFFICIENT_CTX,
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: mockCallAnthropicReturning(text),
    log: () => {},
  });
  assert.equal(out, null,
    '🔴 ship-gate: rigidity-at-self → null (force vector must point AT old beliefs, not learner)');
});

test('🛑 PR-J3 generate: 🔴 LLM 高危 output → scrubbed → null', async () => {
  const dirty = '你想自殺。我自己說了算。';
  const out = await generateSovereignAction({
    stepNo: 1, ctx: SUFFICIENT_CTX,
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: mockCallAnthropicReturning(dirty),
    log: () => {},
  });
  assert.equal(out, null);
});

test('🛑 PR-J3 generate: LLM throws → null fail-soft', async () => {
  const out = await generateSovereignAction({
    stepNo: 1, ctx: SUFFICIENT_CTX,
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: async () => { throw new Error('timeout'); },
    log: () => {},
  });
  assert.equal(out, null);
});

test('🛑 PR-J3 generate: LLM returns empty → null', async () => {
  const out = await generateSovereignAction({
    stepNo: 1, ctx: SUFFICIENT_CTX,
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: async () => ({ ok: true, data: { content: [] } }),
    log: () => {},
  });
  assert.equal(out, null);
});

test('🛑 PR-J3 generate: missing anthropic → null', async () => {
  const out = await generateSovereignAction({
    stepNo: 1, ctx: SUFFICIENT_CTX,
    anthropic: null,
    callAnthropicWithRetry: null,
    log: () => {},
  });
  assert.equal(out, null);
});

// ═════════════════════════════════════════════════════════
// 🔴 6/14 Patrick — J3 retry (不合格自動重生最多 3 次)
//
// 線上實證:dryRun 主權行動修材料後, 仍多數 null, reason 多為 missing
// self-control declaration / rigidity-at-self — LLM 單次生成變異大. 加 retry
// 每次過完整安全, 多給機會拿到合格輸出. 0 降標 / 0 安全弱化.
// ═════════════════════════════════════════════════════════

// Mock that returns N different responses in sequence then loops on last.
function mockCallAnthropicSequence(...texts) {
  let callIdx = 0;
  const fn = async () => {
    const text = texts[Math.min(callIdx, texts.length - 1)];
    callIdx++;
    return { ok: true, data: { content: [{ text }] } };
  };
  fn.getCallCount = () => callIdx;
  return fn;
}

test('🛑 J3_MAX_ATTEMPTS = 3 (Patrick 6/14: 原 1 + retry 2, J3 是 Haiku 便宜)', () => {
  assert.equal(J3_MAX_ATTEMPTS, 3);
});

test('🔴 6/14 J3 retry: 第 1 次 missing self-control + 第 2 次合格 → 回第 2 次合格結果', async () => {
  const badText  = '這段話完全沒有任何內控宣告或主導權聲明的尾巴。';
  const goodText = `這一段是給你的具體指令,80-140 字之間,結尾我自己說了算。`;
  const mockFn = mockCallAnthropicSequence(badText, goodText);
  const out = await generateSovereignAction({
    stepNo: 4, ctx: SUFFICIENT_CTX,
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: mockFn,
    log: () => {},
  });
  assert.equal(out, goodText, '🟢 第 2 次合格 → 應回該結果');
  assert.equal(mockFn.getCallCount(), 2, 'LLM 應只被叫 2 次 (第 2 次合格立刻 return)');
});

test('🔴 6/14 J3 retry: 第 1+2 次不合格 + 第 3 次合格 → 回第 3 次合格結果', async () => {
  const noDecl   = '沒有結尾宣告的句子。';
  const rigidity = '舊標籤過時了。你錯了。要拿回主導權。我自己說了算。';  // rigidity-at-self
  const goodText = `這一段給你的具體指令,結尾我說了算。`;
  const mockFn = mockCallAnthropicSequence(noDecl, rigidity, goodText);
  const out = await generateSovereignAction({
    stepNo: 4, ctx: SUFFICIENT_CTX,
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: mockFn,
    log: () => {},
  });
  assert.equal(out, goodText);
  assert.equal(mockFn.getCallCount(), 3);
});

test('🔴 6/14 J3 retry: 3 次全不合格 → null (用完上限不擴)', async () => {
  const noDecl = '沒有結尾宣告的句子,每次都這樣。';
  const mockFn = mockCallAnthropicSequence(noDecl, noDecl, noDecl, noDecl);
  const out = await generateSovereignAction({
    stepNo: 4, ctx: SUFFICIENT_CTX,
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: mockFn,
    log: () => {},
  });
  assert.equal(out, null, '🔴 ship-gate: 3 次全不合格 → null (不降標)');
  assert.equal(mockFn.getCallCount(), 3, 'LLM call 應 exactly 3 次 (不超過 J3_MAX_ATTEMPTS)');
});

test('🔴 6/14 J3 retry safety: 高危內容 3 次 → null (每次都過 denylist, retry 不洩漏)', async () => {
  const dirty = '你想自殺。我自己說了算。';   // 高危, 每次過 scrubber/denylist 都擋
  const mockFn = mockCallAnthropicSequence(dirty, dirty, dirty);
  const out = await generateSovereignAction({
    stepNo: 1, ctx: SUFFICIENT_CTX,
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: mockFn,
    log: () => {},
  });
  assert.equal(out, null,
    '🔴 ship-gate: 高危內容 retry 後仍 null — retry 不弱化 denylist');
  assert.equal(mockFn.getCallCount(), 3, '高危每次重試也走完整 J3_MAX_ATTEMPTS');
});

test('🔴 6/14 J3 retry safety: 1 次高危 + 2 次合格但 6/14 denylist 新詞 → null (新詞家族每次都擋)', async () => {
  // 6/14 denylist 補強的「傷害自己」 family 也每次擋住 retry 不洩漏.
  const harm1 = '你想傷害自己嗎。我說了算。';
  const harm2 = '別傷害我自己。我說了算。';
  const harm3 = '不要自我傷害。我說了算。';
  const mockFn = mockCallAnthropicSequence(harm1, harm2, harm3);
  const out = await generateSovereignAction({
    stepNo: 1, ctx: SUFFICIENT_CTX,
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: mockFn,
    log: () => {},
  });
  assert.equal(out, null,
    '🔴 6/14 denylist 補強的「傷害自己」 family retry 也擋');
});

test('🔴 6/14 J3 retry: LLM throws 第 1 次 + 合格 第 2 次 → 回合格 (transient throw retry)', async () => {
  let n = 0;
  const goodText = `結尾我說了算。`;
  const mockFn = async () => {
    n++;
    if (n === 1) throw new Error('transient timeout');
    return { ok: true, data: { content: [{ text: goodText }] } };
  };
  const out = await generateSovereignAction({
    stepNo: 4, ctx: SUFFICIENT_CTX,
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: mockFn,
    log: () => {},
  });
  assert.equal(out, goodText);
  assert.equal(n, 2);
});

test('🔴 6/14 J3 retry: 1 次合格立刻 return → LLM 不被多叫 (0 額外成本/延遲)', async () => {
  const goodText = `結尾我自己說了算。`;
  const mockFn = mockCallAnthropicSequence(goodText);
  const out = await generateSovereignAction({
    stepNo: 4, ctx: SUFFICIENT_CTX,
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: mockFn,
    log: () => {},
  });
  assert.equal(out, goodText);
  assert.equal(mockFn.getCallCount(), 1,
    '1 次合格立刻 return, LLM 不被多叫 (健康路徑 0 額外成本)');
});

test('🔴 6/14 J3 retry: pre-LLM check 失敗不進 retry 迴圈 (insufficient ctx → LLM 0 call)', async () => {
  // personalization 不足 → 直接 null, 不浪費 retry quota.
  const mockFn = mockCallAnthropicSequence('any');
  const out = await generateSovereignAction({
    stepNo: 4, ctx: {},                    // ← empty ctx → insufficient
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: mockFn,
    log: () => {},
  });
  assert.equal(out, null);
  assert.equal(mockFn.getCallCount(), 0,
    'pre-LLM check 失敗時 LLM 應 0 call (不浪費 retry quota)');
});

test('🔴 6/14 J3 retry: 各 attempt log 行含 attempt 編號 + reason (診斷用)', async () => {
  const logs = [];
  const noDecl = '沒有結尾宣告的句子。';
  const mockFn = mockCallAnthropicSequence(noDecl, noDecl, noDecl);
  await generateSovereignAction({
    stepNo: 4, ctx: SUFFICIENT_CTX,
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: mockFn,
    log: (m) => logs.push(m),
  });
  // 3 次 attempt 各一行 (含 attempt N/3 + reason) + 結尾「all 3 failed」 行.
  const attemptLines = logs.filter(l => /attempt \d+\/3/.test(l));
  assert.equal(attemptLines.length, 3, '應 emit 3 個 attempt N/3 log 行');
  const finalLine = logs.find(l => /all 3 attempts failed/.test(l));
  assert.ok(finalLine, '應 emit 「all 3 attempts failed」 結尾行');
  assert.match(finalLine, /missing self-control declaration/,
    '結尾行應含 last reason');
});

// ─── 🔴 個人化驗證:兩學員同步輸出實質不同 ────────────────────

test('🛑 PR-J3 🔴 個人化紅線:兩學員同 step → user msg substantively different', async () => {
  // We can't test LLM creativity directly, but we CAN verify that the LLM
  // INPUT (the user message it receives) differs substantially per learner
  // — that's the lever that produces different outputs. If user msgs are
  // identical, no LLM can produce personalized output.
  const studentA = buildSovereignActionUserMessage(4, {
    activeContext: { name: '工作', definition: '我目前的職位轉換' },
    surfacedValues: ['勇敢的', '清晰的'],
    stepEvidence: [{ type: 'identity_claim', quote: '我是有膽量做決定的人' }],
  });
  const studentB = buildSovereignActionUserMessage(4, {
    activeContext: { name: '與母親的關係', definition: '長期界線議題' },
    surfacedValues: ['溫柔的', '有界線的'],
    stepEvidence: [{ type: 'longing_surface', quote: '我想被看見' }],
  });
  assert.notEqual(studentA, studentB,
    '🔴 ship-gate: two learners same step MUST get substantively different LLM inputs');
  // Each has its own materials.
  assert.match(studentA, /職位轉換/);  assert.match(studentA, /勇敢的/);
  assert.match(studentA, /我是有膽量做決定的人/);
  assert.match(studentB, /與母親的關係/);  assert.match(studentB, /溫柔的/);
  assert.match(studentB, /我想被看見/);
  // Cross-contamination check: A's materials must not appear in B and vice versa.
  assert.equal(studentB.includes('職位轉換'), false);
  assert.equal(studentB.includes('我是有膽量做決定的人'), false);
  assert.equal(studentA.includes('與母親的關係'), false);
  assert.equal(studentA.includes('我想被看見'), false);
});

test('🛑 PR-J3 🔴 個人化:helper output for two different learners is NOT identical (end-to-end smoke)', async () => {
  // LLM mock that echoes the personalization tail of the user-message (proves
  // output reflects per-learner input). Real LLM produces creative content;
  // this deterministic echo verifies the wiring carries learner-specific
  // content through to output, validating the personalization gradient.
  const mkEcho = (suffix) => async (_client, payload) => {
    const userMsg = payload?.messages?.[0]?.content || '';
    // Slice the personalization tail (after the「他現在的領域」 marker).
    const tailIdx = userMsg.indexOf('他現在的領域');
    const tail = tailIdx >= 0 ? userMsg.slice(tailIdx, tailIdx + 100) : userMsg.slice(0, 100);
    const text = '針對你的領域,守住你的主權。' + tail + suffix;
    return { ok: true, data: { content: [{ text }] } };
  };
  const studentA_out = await generateSovereignAction({
    stepNo: 4,
    ctx: {
      activeContext: { name: '事業轉型', definition: '我準備離開職場做獨立工作' },
      surfacedValues: ['獨立的'],
      stepEvidence: [{ type: 'identity_claim', quote: '我是有承擔的人' }],
    },
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: mkEcho('。我自己說了算。'),
    log: () => {},
  });
  const studentB_out = await generateSovereignAction({
    stepNo: 4,
    ctx: {
      activeContext: { name: '與父親的和解', definition: '修復長期疏離' },
      surfacedValues: ['溫柔的'],
      stepEvidence: [{ type: 'identity_claim', quote: '我願意先伸手' }],
    },
    anthropic: ANTHROPIC_STUB,
    callAnthropicWithRetry: mkEcho('。我自己說了算。'),
    log: () => {},
  });
  assert.ok(studentA_out, 'A generates');
  assert.ok(studentB_out, 'B generates');
  assert.notEqual(studentA_out, studentB_out,
    '🔴 ship-gate: per-learner output MUST be substantively different');
  // No cross-contamination.
  assert.equal(studentB_out.includes('事業轉型'), false);
  assert.equal(studentA_out.includes('與父親的和解'), false);
});
