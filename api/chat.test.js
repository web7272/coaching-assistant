// api/chat.test.js
// v5.0 chat.js pure orchestration helpers (no DB / no API key needed).
// handler() itself is I/O orchestration — covered by A001 重走 integration verify, not unit tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INITIAL_PHASE_STATE,
  buildCarryOverState,
  buildDynamicContext,
  buildScJourneyBlock,           // v5.2 七步 PR-3
  buildSystemPromptArrayV5,
  collectDetectorOutput,
  CLOSURE_MARKERS,
  detectDayComplete,
  buildClosureHint,
  maybeAutoTransitionRouterPhase,
  KICKOFF_TRIGGER_CONTENT,
  isKickoffRequest,
  buildKickoffMessages,
  normalizeDateString,
  decideSessionAction,
  shouldDispatchDayOpening,
  isPriorDayFinalized,
  buildChatResponsePayload,   // PR-23s4b hotfix (Vivi 6/4)
  buildDamonNoteTemplateV52,   // 6/8 Vivi v5.2 errata PR-b
  buildDamonNoteSystemArray,   // 6/8 Vivi v5.2 errata PR-b
  buildSessionStateSummary,    // 6/8 Vivi v5.2 errata PR-c
  detectScJourneyEvidenceForTurn,  // 6/11 v5.2 七步 PR-4 Path A
  appendScJourneyEvidence,         // 6/11 v5.2 七步 PR-4 Path A
} from './chat.js';
import { PHASE_PROGRESS_NEVER_RESET, RESET_FIELDS } from '../lib/session/day-boundary.js';
import { CACHED_PREFIX_SECTIONS } from '../lib/prompt-sections/cached/index.js';

// ─────────────────────────────────────────────────────────
// INITIAL_PHASE_STATE
// ─────────────────────────────────────────────────────────

test('INITIAL_PHASE_STATE: covers exactly the 7 phase-progress fields', () => {
  assert.deepEqual(
    Object.keys(INITIAL_PHASE_STATE).sort(),
    [...PHASE_PROGRESS_NEVER_RESET].sort(),
  );
});

test('INITIAL_PHASE_STATE: fresh program starts at phase_1', () => {
  assert.equal(INITIAL_PHASE_STATE.current_phase, 'phase_1');
  assert.equal(INITIAL_PHASE_STATE.integration_retention_mode_active, false);
  assert.equal(INITIAL_PHASE_STATE.mid_session_takeaway_count, 0);
  assert.ok(Object.isFrozen(INITIAL_PHASE_STATE));
});

// ─────────────────────────────────────────────────────────
// buildCarryOverState — cross-day reset
// ─────────────────────────────────────────────────────────

test('buildCarryOverState(null): brand-new student → phase_1 + all transient at initial', () => {
  const s = buildCarryOverState(null);
  assert.equal(s.current_phase, 'phase_1');
  // every RESET_FIELD present at its initial value
  for (const [k, v] of Object.entries(RESET_FIELDS)) {
    if (v !== null && typeof v === 'object') continue;  // deep-equal checked below
    assert.equal(s[k], v, `${k} should start at initial value`);
  }
  assert.equal(s.cumulative_ppl_score, 0);
  assert.equal(s.router_phase, 'opening');
  assert.equal(s.elicitation_mode_active, true);
});

test('🛑 buildCarryOverState: carries phase progress, resets transient', () => {
  const prior = {
    // phase progress — must carry over
    current_phase: 'phase_3a',
    build_vision_progress: { step: 'step_3_let_it_work', vision_components: ['x'] },
    self_concept_progress: null,
    counter_examples_list: ['ce1', 'ce2'],
    mid_session_takeaway_count: 2,
    integration_retention_mode_active: false,
    phase_progress: { foo: 1 },
    // transient — must reset
    cumulative_ppl_score: 0.8,
    router_phase: 'identity_test_routing',
    elicitation_mode_active: false,
    handoff_triggered_count: 3,
    turn_count_this_session: 17,
  };
  const s = buildCarryOverState(prior);

  // carried
  assert.equal(s.current_phase, 'phase_3a');
  assert.deepEqual(s.build_vision_progress, { step: 'step_3_let_it_work', vision_components: ['x'] });
  assert.deepEqual(s.counter_examples_list, ['ce1', 'ce2']);
  assert.equal(s.mid_session_takeaway_count, 2, 'mid_session_takeaway_count is phase-scoped — carries cross-day');

  // reset
  assert.equal(s.cumulative_ppl_score, 0);
  assert.equal(s.router_phase, 'opening');
  assert.equal(s.elicitation_mode_active, true);
  assert.equal(s.handoff_triggered_count, 0);
  assert.equal(s.turn_count_this_session, 0);
});

test('🛑 buildCarryOverState: never carries a transient field even if prior had it', () => {
  const prior = { current_phase: 'phase_2', cumulative_ppl_score: 0.95 };
  const s = buildCarryOverState(prior);
  assert.equal(s.cumulative_ppl_score, 0, 'transient PPL must not survive day boundary');
});

// ─────────────────────────────────────────────────────────
// buildDynamicContext
// ─────────────────────────────────────────────────────────

test('buildDynamicContext: includes primary_mode + mode context text (PR-23s4b)', () => {
  // PR-23s4b: current_phase → primary_mode; integration mode 取代 phase_3b Self-Concept.
  const txt = buildDynamicContext({ primary_mode: 'integration' }, {}, 0);
  assert.match(txt, /primary_mode：integration/);
  assert.match(txt, /Self-Concept/);  // from mode-context.js integration block
});

test('buildDynamicContext: surfaces top1_value + gap_days', () => {
  const txt = buildDynamicContext(
    { current_phase: 'phase_2' },
    { top1_value: '勇敢', session_day_count: 4 },
    3,
  );
  assert.match(txt, /top1_value：勇敢/);
  assert.match(txt, /gap_days：3/);
  assert.match(txt, /session_day_count：4/);
});

test('buildDynamicContext: Integration Retention conditional only when active', () => {
  const off = buildDynamicContext({ current_phase: 'phase_4' }, {}, 0);
  assert.doesNotMatch(off, /Integration Retention 階段/);
  const on = buildDynamicContext(
    { current_phase: 'integration_retention', integration_retention_mode_active: true }, {}, 0,
  );
  assert.match(on, /Integration Retention 階段/);
  assert.match(on, /reinforce 而非 explore/);
});

test('🛑 buildDynamicContext: phase_1 router_phase-aware (fixes 開場重複 bug)', () => {
  // Turn 1：router_phase='opening' → 起手式變體
  const turn1 = buildDynamicContext(
    { current_phase: 'phase_1', router_phase: 'opening' }, {}, 0,
  );
  assert.match(turn1, /起手式/);
  assert.match(turn1, /在你的生命裡、你想要什麼\?/);

  // Turn 2+：router_phase='elicitation' → 鏈式追問變體、不重複起手式
  const turn2 = buildDynamicContext(
    { current_phase: 'phase_1', router_phase: 'elicitation' }, {}, 0,
  );
  assert.match(turn2, /擁有這個對你有什麼重要/);
  assert.match(turn2, /不重複起手式/);
  assert.doesNotMatch(turn2, /為什麼/, '紅線 1：elicitation 變體不可含「為什麼」');
});

test('buildDynamicContext: anchors fallback text when none', () => {
  assert.match(buildDynamicContext({}, {}, 0), /owned qualities：（尚無/);
  assert.match(
    buildDynamicContext({}, { anchors: ['踏實的', '善良的', '好奇的', '勇敢的'] }, 0),
    /owned qualities（最近 3 個 anchor）：善良的、好奇的、勇敢的/,
  );
});

// ⭐ PR-4c-green 5/24 (Patrick 真機 A002 root cause) — buildDynamicContext MUST
// surface last_takeaway_term + latest daily_takeaways entry so Sonnet can see
// yesterday's material. Without this, the E4 inject says「引用 last_takeaway_term」
// but the value never reaches the prompt → Sonnet ignores it (A002) or
// fabricates (A001 hallucination).

test('🛑 buildDynamicContext: surfaces last_takeaway_term from last_session_day_summary', () => {
  const txt = buildDynamicContext({}, {
    last_session_day_summary: {
      last_takeaway_term: '我知道我的東西真的對人有幫助',
    },
  }, 0);
  assert.match(txt, /━━━ 昨天的素材/, 'must label the section so the E4 inject can find it');
  assert.match(txt, /last_takeaway_term：「我知道我的東西真的對人有幫助」/);
});

test('🛑 buildDynamicContext: surfaces latest daily_takeaways entry (most recent day)', () => {
  const txt = buildDynamicContext({}, {
    daily_takeaways: [
      { day: 1, term: '可以決定' },
      { day: 3, term: '被看見' },
      { day: 2, term: '是繼承的' },
    ],
  }, 0);
  // Latest by day number = Day 3
  assert.match(txt, /daily_takeaways\[最後一筆\]：Day 3 →「被看見」/);
});

test('🛑 buildDynamicContext: BOTH signals surfaced when both exist', () => {
  const txt = buildDynamicContext({}, {
    last_session_day_summary: { last_takeaway_term: '我可以決定' },
    daily_takeaways: [{ day: 1, term: '可以決定' }],
  }, 0);
  assert.match(txt, /last_takeaway_term：「我可以決定」/);
  assert.match(txt, /daily_takeaways\[最後一筆\]：Day 1 →「可以決定」/);
});

test('🛑 buildDynamicContext: no material → explicit empty signal (forbid fabrication path)', () => {
  // The empty-signal line is what tells Sonnet「mode B safe opener、絕不杜撰」.
  const txt = buildDynamicContext({}, {}, 0);
  assert.match(txt, /昨天的素材：（無真實素材 — 走安全暖開場、絕對不杜撰「你昨天說…」）/);
  // Must NOT print「━━━ 昨天的素材」 header when empty — that header is for
  //「I have stuff for you」 signal only; conflating empty + present is what
  // led Sonnet to fabricate in A001.
  assert.doesNotMatch(txt, /━━━ 昨天的素材/);
});

test('🛑 buildDynamicContext: empty/garbage takeaway entries → no spurious material line', () => {
  // Defensive against bad data (PR-4c-green E4 修法 4 already prefers null
  // over garbled cutoffs, but pre-fix data still in the DB shouldn't poison).
  const txt = buildDynamicContext({}, {
    last_session_day_summary: { last_takeaway_term: '' },     // empty string
    daily_takeaways: [{ day: 1, term: '' }, { day: 2 /* no term */ }],
  }, 0);
  assert.match(txt, /無真實素材/, 'all-empty → empty signal');
});

test('buildDynamicContext: daily_takeaways present but last_takeaway_term missing → still surfaces material', () => {
  const txt = buildDynamicContext({}, {
    daily_takeaways: [{ day: 2, term: '可以決定' }],
  }, 0);
  assert.match(txt, /━━━ 昨天的素材/);
  assert.match(txt, /daily_takeaways\[最後一筆\]：Day 2 →「可以決定」/);
  assert.doesNotMatch(txt, /last_takeaway_term：/);
});

// ─────────────────────────────────────────────────────────
// ⭐ v5.2 第二塊 PR-a — active_context dynamic inject
// ─────────────────────────────────────────────────────────

test('🛑 v5.2 buildDynamicContext: activeContext set → [Active Context] block 在最前面', () => {
  const txt = buildDynamicContext({}, {}, 0, {
    activeContext: { category: 2, name: '我跟先生的溝通', definition: '主要是日常溝通' },
  });
  // Block appears BEFORE the 「本場學員狀態」 header.
  const blockIdx = txt.indexOf('[Active Context]');
  const headerIdx = txt.indexOf('本場學員狀態');
  assert.ok(blockIdx >= 0, 'block must appear');
  assert.ok(headerIdx > blockIdx, 'block must precede 本場學員狀態 header');
  // §4.1 verbatim anchors.
  assert.match(txt, /Category: 親密關係 \(伴侶 \/ 戀愛\)/);
  assert.match(txt, /Name: 我跟先生的溝通/);
  assert.match(txt, /Definition: 主要是日常溝通/);
  assert.match(txt, /Today's conversation focuses on this context\./);
  assert.match(txt, /Do not initiate cross-context exploration unless learner naturally surfaces\./);
});

test('🛑 v5.2 buildDynamicContext: activeContext null → block 不出現 (fallback v5.1)', () => {
  const txt = buildDynamicContext({}, {}, 0);   // no opts
  assert.doesNotMatch(txt, /\[Active Context\]/);
  // Existing v5.1 content still present.
  assert.match(txt, /━━━ 本場學員狀態/);
  assert.match(txt, /primary_mode：/);
});

test('🛑 v5.2 buildDynamicContext: activeContext invalid (category 0 / 6) → block 不出現', () => {
  for (const bad of [0, 6, null, undefined, NaN]) {
    const txt = buildDynamicContext({}, {}, 0, { activeContext: { category: bad } });
    assert.doesNotMatch(txt, /\[Active Context\]/,
      `category=${bad} should suppress block (fallback to v5.1)`);
  }
});

test('🛑 v5.2 buildDynamicContext: activeContext name null → block uses 中文 category label fallback', () => {
  // migration 029 default 1 (事業), Vivi 還沒填 name → fallback to 「事業 / 工作 / 金錢」.
  const txt = buildDynamicContext({}, {}, 0, {
    activeContext: { category: 1, name: null, definition: null },
  });
  assert.match(txt, /Category: 事業 \/ 工作 \/ 金錢/);
  assert.match(txt, /Name: 事業 \/ 工作 \/ 金錢/);
  assert.match(txt, /Definition: \(unspecified/);
});

test('🛑 v5.2 buildSystemPromptArrayV5: activeContext threaded into dynamic block only (NOT cached)', () => {
  const arr = buildSystemPromptArrayV5({
    sessionState: {}, userProfile: {}, gapDays: 0,
    conditionalInjects: [], cachingEnabled: true,
    activeContext: { category: 3, name: null, definition: null },
  });
  assert.equal(arr.length, 5, '4 cached + 1 dynamic — count unchanged');
  // [Active Context] appears ONLY in dynamic block (arr[4]).
  for (let i = 0; i < 4; i++) {
    assert.doesNotMatch(arr[i].text, /\[Active Context\]/,
      `cached section ${i + 1} must NOT contain [Active Context] (per-student, breaks全員 cache)`);
  }
  assert.match(arr[4].text, /\[Active Context\]/, 'dynamic block contains [Active Context]');
  assert.match(arr[4].text, /Category: 家庭/);
});

test('🛑 v5.2 cache snapshot lock: breakpoint position unchanged after activeContext addition', () => {
  // Regression guard: v5.2 must NOT shift the cache breakpoint.
  const arr = buildSystemPromptArrayV5({
    sessionState: {}, userProfile: {}, gapDays: 0, conditionalInjects: [],
    cachingEnabled: true,
    activeContext: { category: 2, name: 'X', definition: 'Y' },
  });
  assert.equal(arr[0].cache_control, undefined);
  assert.equal(arr[1].cache_control, undefined);
  assert.equal(arr[2].cache_control, undefined);
  assert.deepEqual(arr[3].cache_control, { type: 'ephemeral' },
    'breakpoint must stay on cached section 4');
  assert.equal(arr[4].cache_control, undefined, 'dynamic (incl. active_context) NOT cached');
});

test('🛑 v5.2 buildSystemPromptArrayV5: cachingEnabled=false also includes active_context (merged)', () => {
  const arr = buildSystemPromptArrayV5({
    sessionState: {}, userProfile: {}, gapDays: 0, conditionalInjects: [],
    cachingEnabled: false,
    activeContext: { category: 5, name: '面對自己的不安', definition: null },
  });
  assert.equal(arr.length, 1, 'caching OFF → single merged block');
  assert.match(arr[0].text, /\[Active Context\]/);
  assert.match(arr[0].text, /Category: 自我/);
  assert.match(arr[0].text, /Name: 面對自己的不安/);
});

// ─────────────────────────────────────────────────────────
// buildSystemPromptArrayV5 — cache breakpoint
// ─────────────────────────────────────────────────────────

test('buildSystemPromptArrayV5: caching ON → 4 cached blocks + 1 dynamic', () => {
  const arr = buildSystemPromptArrayV5({
    sessionState: { current_phase: 'phase_1' }, userProfile: {},
    gapDays: 0, conditionalInjects: [], cachingEnabled: true,
  });
  assert.equal(arr.length, 5, '4 cached prefix sections + 1 dynamic');
  // every block is a text block
  for (const b of arr) assert.equal(b.type, 'text');
});

test('🛑 buildSystemPromptArrayV5: cache_control breakpoint on section 4 (last cached) ONLY', () => {
  const arr = buildSystemPromptArrayV5({
    sessionState: {}, userProfile: {}, gapDays: 0, conditionalInjects: [], cachingEnabled: true,
  });
  assert.equal(arr[0].cache_control, undefined, 'section 1 no breakpoint');
  assert.equal(arr[1].cache_control, undefined, 'section 2 no breakpoint');
  assert.equal(arr[2].cache_control, undefined, 'section 3 no breakpoint');
  assert.deepEqual(arr[3].cache_control, { type: 'ephemeral' }, 'section 4 carries breakpoint');
  assert.equal(arr[4].cache_control, undefined, 'dynamic block (post-breakpoint) NOT cached');
});

test('buildSystemPromptArrayV5: caching OFF → single merged text block', () => {
  const arr = buildSystemPromptArrayV5({
    sessionState: {}, userProfile: {}, gapDays: 0, conditionalInjects: [], cachingEnabled: false,
  });
  assert.equal(arr.length, 1);
  assert.equal(arr[0].cache_control, undefined);
});

test('buildSystemPromptArrayV5: conditional injects land in the dynamic block', () => {
  const arr = buildSystemPromptArrayV5({
    sessionState: {}, userProfile: {}, gapDays: 0,
    conditionalInjects: ['[INJECT A]', '[INJECT B]'], cachingEnabled: true,
  });
  const dynamic = arr[arr.length - 1].text;
  assert.match(dynamic, /\[INJECT A\]/);
  assert.match(dynamic, /\[INJECT B\]/);
});

// ─────────────────────────────────────────────────────────
// 🛑 v5.2 七步 PR-3 — buildScJourneyBlock + dynamic threading
// ─────────────────────────────────────────────────────────

test('🛑 v5.2 七步 PR-3: buildScJourneyBlock null/undefined input → null (skip pattern)', () => {
  assert.equal(buildScJourneyBlock(), null);
  assert.equal(buildScJourneyBlock(undefined), null);
  assert.equal(buildScJourneyBlock({}), null,
    'step null + evidence missing → null (graceful skip)');
  assert.equal(buildScJourneyBlock({ step: null, evidence: {} }), null,
    'step null + all-empty evidence → null');
  assert.equal(buildScJourneyBlock({ step: null,
    evidence: { step_1: [], step_2: [], step_3: [], step_4: [], step_5: [], step_6: [], step_7: [] } }),
    null,
    'step null + all-empty keyed evidence → null');
});

test('🛑 v5.2 七步 PR-3: buildScJourneyBlock invalid step → "not yet started" line', () => {
  // out-of-range / non-integer / NaN → degrade gracefully to not-started.
  const out = buildScJourneyBlock({ step: 99, evidence: { step_1: [{ quote: 'a' }] } });
  assert.ok(out);
  assert.match(out, /sc_journey_step: not yet started/);
  const out2 = buildScJourneyBlock({ step: 'foo', evidence: { step_1: [{ quote: 'a' }] } });
  assert.ok(out2);
  assert.match(out2, /sc_journey_step: not yet started/);
  // 1..7 valid.
  const ok = buildScJourneyBlock({ step: 4, evidence: { step_1: [{ quote: 'a' }] } });
  assert.match(ok, /sc_journey_step: 4/);
});

test('🛑 v5.2 七步 PR-3: buildScJourneyBlock formats step + per-step count + 1 truncated quote', () => {
  const block = buildScJourneyBlock({
    step: 3,
    evidence: {
      step_1: [{ quote: '我覺得我做不到' }, { quote: '我真的好累' }],
      step_2: [],
      step_3: [{ quote: '其實我想成為一個更勇敢的人' }],
      step_4: [],
      step_5: [],
      step_6: [],
      step_7: [],
    },
  });
  assert.ok(block);
  assert.equal(block.startsWith('[SC Journey State]'), true,
    'block must start with English internal label (mirrors [Active Context] register)');
  assert.match(block, /sc_journey_step: 3/);
  // count + latest quote shown per non-empty step.
  assert.match(block, /step_1: 2 entries, latest quote: "我真的好累"/,
    'step_1 should show 2-count + LATEST quote (second one)');
  assert.match(block, /step_3: 1 entries, latest quote: "其實我想成為一個更勇敢的人"/);
  // empty steps skipped (no step_2 / step_4-7 lines).
  assert.equal(/step_2:/.test(block), false, 'empty step_2 must be skipped');
  assert.equal(/step_4:/.test(block), false, 'empty step_4 must be skipped');
});

test('🛑 v5.2 七步 PR-3: buildScJourneyBlock truncates single quotes at ~40 chars', () => {
  // 50+ char quote → must be truncated (cap = 40).
  const longQuote = '我覺得我永遠都做不到那件事，因為過去每一次嘗試都失敗了，我真的累了，但我還是想要試試看一次最後一次';
  assert.ok(longQuote.length > 40, 'test fixture must exceed truncation cap');
  const block = buildScJourneyBlock({
    step: 1,
    evidence: { step_1: [{ quote: longQuote }] },
  });
  assert.ok(block);
  // Truncated form: ~40 char prefix + …
  assert.match(block, /latest quote: "[^"]{20,45}…"/,
    'long quote must be truncated with ellipsis');
  // Anti-regression: full quote must NOT appear verbatim.
  assert.equal(block.includes(longQuote), false,
    'full long quote must not survive verbatim');
});

test('🛑 v5.2 七步 PR-3: buildScJourneyBlock hard cap → drops quotes, keeps counts', () => {
  // 7 steps each with a medium quote → counts-only output if exceeds cap.
  const mediumQuote = '這是一個中等長度的測試 quote 用來把整體 block 撐爆,'.repeat(2);
  const evidence = {};
  for (let s = 1; s <= 7; s++) {
    evidence[`step_${s}`] = Array.from({ length: 5 }, () => ({ quote: mediumQuote }));
  }
  const block = buildScJourneyBlock({ step: 7, evidence });
  assert.ok(block);
  // Hard cap kicks in: every step should show counts, no "latest quote:".
  assert.equal(block.length <= 600, true,
    `block length ${block.length} must be <= 600 (hard cap)`);
  assert.equal(/latest quote:/.test(block), false,
    'over-budget block must DROP quotes entirely (counts-only fallback)');
  // Still shows counts for all 7 steps.
  for (let s = 1; s <= 7; s++) {
    assert.match(block, new RegExp(`step_${s}: 5 entries`));
  }
});

test('🛑 v5.2 七步 PR-3: scJourney null → buildSystemPromptArrayV5 dynamic 段 0 sc_journey lines', () => {
  const arrWith = buildSystemPromptArrayV5({
    sessionState: {}, userProfile: {}, gapDays: 0, conditionalInjects: [],
    cachingEnabled: true,
    activeContext: { category: 2, name: 'X', definition: 'Y' },
    scJourney: null,
  });
  const dynamic = arrWith[arrWith.length - 1].text;
  assert.equal(/\[SC Journey State\]/.test(dynamic), false,
    'scJourney=null → NO block in dynamic');
  // activeContext still works.
  assert.match(dynamic, /\[Active Context\]/);
});

test('🛑 v5.2 七步 PR-3: scJourney with step+evidence → block lands in dynamic, NOT cached', () => {
  const arr = buildSystemPromptArrayV5({
    sessionState: {}, userProfile: {}, gapDays: 0, conditionalInjects: [],
    cachingEnabled: true,
    activeContext: { category: 2, name: 'X', definition: 'Y' },
    scJourney: { step: 4, evidence: { step_4: [{ quote: 'identity claim quote' }] } },
  });
  assert.equal(arr.length, 5, '4 cached prefix + 1 dynamic (unchanged)');
  // Block in dynamic.
  const dynamic = arr[4].text;
  assert.match(dynamic, /\[SC Journey State\]/);
  assert.match(dynamic, /sc_journey_step: 4/);
  assert.match(dynamic, /step_4: 1 entries/);
  // Block NOT in any cached section.
  for (let i = 0; i < 4; i++) {
    assert.equal(/\[SC Journey State\]/.test(arr[i].text), false,
      `cached section ${i + 1} must NOT contain SC Journey block`);
  }
});

test('🛑 v5.2 七步 PR-3 anti-regression: cached prefix byte-identical regardless of scJourney value', () => {
  // Build twice — once with scJourney null, once with rich scJourney. Cached
  // section text must be IDENTICAL byte-for-byte both times (cache invalidation
  // would defeat caching strategy).
  const args = { sessionState: {}, userProfile: {}, gapDays: 0,
    conditionalInjects: [], cachingEnabled: true };
  const arrA = buildSystemPromptArrayV5({ ...args, scJourney: null });
  const arrB = buildSystemPromptArrayV5({ ...args,
    scJourney: { step: 5, evidence: { step_5: [{ quote: '看見資源的瞬間' }] } } });
  // Cached prefix (sections 0..3) byte-identical.
  for (let i = 0; i < 4; i++) {
    assert.equal(arrA[i].text, arrB[i].text,
      `cached section ${i + 1} must be byte-identical regardless of scJourney`);
    // Source-of-truth check: matches CACHED_PREFIX_SECTIONS literal content.
    assert.equal(arrA[i].text, CACHED_PREFIX_SECTIONS[i].content,
      `cached section ${i + 1} must match source-of-truth content`);
  }
});

test('🛑 v5.2 七步 PR-3: SC Journey block placement — after [Active Context], before runtime status line', () => {
  // Order spec: linesActiveContext → linesScJourney → '━━━ 本場學員狀態' line.
  const arr = buildSystemPromptArrayV5({
    sessionState: {}, userProfile: {}, gapDays: 0, conditionalInjects: [],
    cachingEnabled: true,
    activeContext: { category: 3, name: 'Career path', definition: 'job pivot' },
    scJourney: { step: 2, evidence: { step_2: [{ quote: 'a' }] } },
  });
  const dynamic = arr[arr.length - 1].text;
  const ac = dynamic.indexOf('[Active Context]');
  const sc = dynamic.indexOf('[SC Journey State]');
  const rt = dynamic.indexOf('━━━ 本場學員狀態');
  assert.ok(ac >= 0 && sc >= 0 && rt >= 0,
    'all three sentinels must be present in dynamic');
  assert.ok(ac < sc, '[Active Context] must come before [SC Journey State]');
  assert.ok(sc < rt, '[SC Journey State] must come before runtime status line');
});

test('🛑 v5.2 七步 PR-3 safety: block does not include scrubber-禁列 phrasings', () => {
  // 對齊 scrubber 禁列: 高危原話 (suicide / self-harm explicit) must never
  // appear verbatim in the dynamic block. PR-3 trusts upstream (PR-4 writes)
  // to filter, but this test confirms the block FORMAT itself doesn't echo
  // banned phrasings when given clean evidence.
  const block = buildScJourneyBlock({
    step: 1,
    evidence: { step_1: [{ quote: '我覺得我卡住了' }] },
  });
  assert.ok(block);
  // Spot-check: no high-risk explicit phrasings in our format scaffolding.
  assert.equal(/想死|自殺|去死/.test(block), false,
    'block scaffolding must not include high-risk explicit phrasings');
  // The clean test quote IS allowed.
  assert.match(block, /我覺得我卡住了/);
});

// ─────────────────────────────────────────────────────────
// collectDetectorOutput
// ─────────────────────────────────────────────────────────

test('collectDetectorOutput: merges patches, collects injects from handled only', () => {
  const out = collectDetectorOutput([
    { id: 'a', ok: true, result: { handled: false, patch: { x: 1 } } },
    { id: 'b', ok: true, result: { handled: true, inject: '[B]', patch: { y: 2 } } },
    { id: 'c', ok: true, result: { handled: true, inject: '', patch: { z: 3 } } },
  ]);
  assert.deepEqual(out.patch, { x: 1, y: 2, z: 3 });
  assert.deepEqual(out.injects, ['[B]'], 'empty inject string is not collected');
});

test('collectDetectorOutput: skips errored / skipped results', () => {
  const out = collectDetectorOutput([
    { id: 'a', ok: false, error: new Error('boom') },
    { id: 'b', skipped: true },
    { id: 'c', ok: true, result: { handled: true, inject: '[C]' } },
  ]);
  assert.deepEqual(out.injects, ['[C]']);
  assert.deepEqual(out.patch, {});
});

test('collectDetectorOutput: empty / nullish input → empty output', () => {
  // ⭐ §3 patch 6/4 (safety patch #23) — shape extended with user_profile_increments.
  assert.deepEqual(collectDetectorOutput([]), { injects: [], patch: {}, user_profile_increments: {} });
  assert.deepEqual(collectDetectorOutput(null), { injects: [], patch: {}, user_profile_increments: {} });
});

test('collectDetectorOutput: later patch wins on key collision', () => {
  const out = collectDetectorOutput([
    { id: 'a', ok: true, result: { patch: { router_phase: 'opening' } } },
    { id: 'b', ok: true, result: { patch: { router_phase: 'elicitation' } } },
  ]);
  assert.equal(out.patch.router_phase, 'elicitation');
});

// ⭐ §3 patch 6/4 (safety patch #23) — user_profile_increments collection.
test('🛑 collectDetectorOutput: collects + sums user_profile_increments from handlers', () => {
  const out = collectDetectorOutput([
    { id: 'a', ok: true, result: {
      handled: true, inject: '[A]',
      user_profile_increments: { passive_death_wish_count: 1 },
    }},
    // Two handlers in one turn (edge case) — increments should accumulate, not last-wins.
    { id: 'b', ok: true, result: {
      handled: true, inject: '[B]',
      user_profile_increments: { passive_death_wish_count: 1, some_other_counter: 2 },
    }},
  ]);
  assert.deepEqual(out.user_profile_increments, {
    passive_death_wish_count: 2,
    some_other_counter: 2,
  }, 'same key accumulates across handlers; new keys added');
});

test('🛑 collectDetectorOutput: ignores non-numeric / non-finite increments (defensive)', () => {
  const out = collectDetectorOutput([
    { id: 'a', ok: true, result: { user_profile_increments: {
      passive_death_wish_count: 1,
      bogus_string: 'lots',
      bogus_nan: NaN,
      bogus_inf: Infinity,
    }}},
  ]);
  assert.deepEqual(out.user_profile_increments, { passive_death_wish_count: 1 });
});

test('collectDetectorOutput: handler without user_profile_increments → empty default', () => {
  const out = collectDetectorOutput([
    { id: 'a', ok: true, result: { handled: true, inject: '[A]', patch: { x: 1 } } },
  ]);
  assert.deepEqual(out.user_profile_increments, {});
});

// ═════════════════════════════════════════════════════════
// PR-4c: detectDayComplete — v4 marker + hard-limit
// ═════════════════════════════════════════════════════════

test('CLOSURE_MARKERS: includes the 5 v4 closure markers, frozen', () => {
  const expected = ['明天從這裡繼續', '今天先到這裡', '把這句話留下來', '明天我們繼續', '今天就到這裡'];
  assert.deepEqual([...CLOSURE_MARKERS].sort(), expected.sort());
  assert.ok(Object.isFrozen(CLOSURE_MARKERS));
});

test('detectDayComplete: any closure marker in content → true', () => {
  for (const m of CLOSURE_MARKERS) {
    assert.equal(
      detectDayComplete({ content: `這個感覺很真實。${m}🌿`, turnCount: 8 }),
      true,
      `marker ${m} should trigger dayComplete`,
    );
  }
});

test('detectDayComplete: no marker, mid-session → false', () => {
  assert.equal(
    detectDayComplete({ content: '那你想要的是什麼？', turnCount: 10 }),
    false,
  );
});

test('🛑 detectDayComplete: hard-limit (turnCount >= 40) → true even without marker', () => {
  assert.equal(detectDayComplete({ content: '繼續往下挖', turnCount: 40 }), true);
  assert.equal(detectDayComplete({ content: '什麼？', turnCount: 41 }), true);
});

test('detectDayComplete: just-below hard-limit + no marker → false', () => {
  assert.equal(detectDayComplete({ content: '什麼？', turnCount: 39 }), false);
});

test('detectDayComplete: custom hardLimit override', () => {
  assert.equal(detectDayComplete({ content: '', turnCount: 10, hardLimit: 10 }), true);
  assert.equal(detectDayComplete({ content: '', turnCount: 9, hardLimit: 10 }), false);
});

test('detectDayComplete: empty / nullish content + below limit → false', () => {
  assert.equal(detectDayComplete({ content: '', turnCount: 5 }), false);
  assert.equal(detectDayComplete({ content: null, turnCount: 5 }), false);
  assert.equal(detectDayComplete({}), false);
});

// ═════════════════════════════════════════════════════════
// PR-4c: buildClosureHint — soft-limit closure-guidance inject
// ═════════════════════════════════════════════════════════

test('buildClosureHint: below soft limit (24) → null (no inject)', () => {
  assert.equal(buildClosureHint({ turnCount: 24 }), null);
  assert.equal(buildClosureHint({ turnCount: 0 }), null);
});

test('buildClosureHint: at soft limit (25) → returns guidance text', () => {
  const hint = buildClosureHint({ turnCount: 25 });
  assert.ok(typeof hint === 'string' && hint.length > 0);
  assert.match(hint, /Session 收尾接近/);
  assert.match(hint, /turn count = 25/);
  assert.match(hint, /soft limit 25/);
  assert.match(hint, /hard limit 40/);
  assert.match(hint, /距 hard 15/);
});

test('buildClosureHint: between soft and hard → turnsToHard decreases', () => {
  assert.match(buildClosureHint({ turnCount: 35 }), /距 hard 5/);
  assert.match(buildClosureHint({ turnCount: 39 }), /距 hard 1/);
});

test('buildClosureHint: at hard limit → distance 0', () => {
  assert.match(buildClosureHint({ turnCount: 40 }), /距 hard 0/);
});

test('buildClosureHint: custom soft/hard limits', () => {
  assert.equal(buildClosureHint({ turnCount: 9, softLimit: 10 }), null);
  assert.match(buildClosureHint({ turnCount: 10, softLimit: 10, hardLimit: 15 }), /距 hard 5/);
});

test('buildClosureHint: non-number turnCount → null', () => {
  assert.equal(buildClosureHint({}), null);
  assert.equal(buildClosureHint({ turnCount: 'lots' }), null);
});

// ═════════════════════════════════════════════════════════
// PR-4c-1b: maybeAutoTransitionRouterPhase — 開場重複 bug fix
// ═════════════════════════════════════════════════════════

test('🛑 auto-transition: phase_1 + opening + no other touches → elicitation + clears day_opening_inject_active', () => {
  const out = maybeAutoTransitionRouterPhase({
    stateForPrompt: { current_phase: 'phase_1', router_phase: 'opening' },
  });
  // PR-4c-green E4 fix: also clears the day-opening flag so turn 2 uses
  // phase_1.elicitation 鏈式追問 cleanly, never the deferred variant.
  assert.deepEqual(out, { router_phase: 'elicitation', day_opening_inject_active: false });
});

test('🛑 auto-transition: idempotent — already elicitation → null (turn 2+ no re-fire)', () => {
  assert.equal(
    maybeAutoTransitionRouterPhase({
      stateForPrompt: { current_phase: 'phase_1', router_phase: 'elicitation' },
    }),
    null,
  );
});

test('auto-transition: outside phase_1 → null (no opening→elicitation outside Phase 1)', () => {
  for (const phase of ['phase_2', 'phase_3a', 'phase_3b', 'phase_4', 'phase_5',
                       'integration_retention', 'program_completed']) {
    assert.equal(
      maybeAutoTransitionRouterPhase({
        stateForPrompt: { current_phase: phase, router_phase: 'opening' },
      }),
      null,
      `${phase} must NOT auto-transition`,
    );
  }
});

test('🛑 auto-transition: detector already moved router_phase this turn → respect it, no override', () => {
  // E3_opening_branch_router on stuck/flip/worth → sets router_phase=elicitation itself
  assert.equal(
    maybeAutoTransitionRouterPhase({
      stateForPrompt: { current_phase: 'phase_1', router_phase: 'opening' },
      detectorPatch: { router_phase: 'elicitation' },
    }),
    null,
  );
  // E3_deep_signal_detector → sets router_phase=deep_signal_handoff
  assert.equal(
    maybeAutoTransitionRouterPhase({
      stateForPrompt: { current_phase: 'phase_1', router_phase: 'opening' },
      detectorPatch: { router_phase: 'deep_signal_handoff' },
    }),
    null,
  );
});

test('auto-transition: advance patch already moved router_phase → respect it', () => {
  assert.equal(
    maybeAutoTransitionRouterPhase({
      stateForPrompt: { current_phase: 'phase_1', router_phase: 'opening' },
      advancePatch: { router_phase: 'top1_determination' },
    }),
    null,
  );
});

test('auto-transition: nullish input → null (defensive)', () => {
  assert.equal(maybeAutoTransitionRouterPhase(), null);
  assert.equal(maybeAutoTransitionRouterPhase({}), null);
  assert.equal(maybeAutoTransitionRouterPhase({ stateForPrompt: null }), null);
});

test('auto-transition: router_phase already non-opening (e.g. deep_signal_handoff) → null', () => {
  assert.equal(
    maybeAutoTransitionRouterPhase({
      stateForPrompt: { current_phase: 'phase_1', router_phase: 'deep_signal_handoff' },
    }),
    null,
  );
});

// ═════════════════════════════════════════════════════════
// PR-4c-green E4 fix — shouldDispatchDayOpening + inject-active phase context
// 釘死 Patrick 5/24 ping: 「E4 在 isNew=false 但 new-session-day 的情境會 dispatch」
// ═════════════════════════════════════════════════════════

test('🛑 shouldDispatchDayOpening: empty session_state → true (Day 2 kickoff, no flag yet)', () => {
  // This is the bug fix — previously gated on `isNew`; Day 2's session row was
  // already created by the time kickoff fires → isNew=false → E4 skipped.
  // Now gated on a per-session flag instead, so isNew is irrelevant.
  assert.equal(shouldDispatchDayOpening({}), true);
  assert.equal(shouldDispatchDayOpening(null), true);
  assert.equal(shouldDispatchDayOpening(undefined), true);
});

test('🛑 shouldDispatchDayOpening: flag already set → false (turn 2+ within same session, no re-fire)', () => {
  assert.equal(
    shouldDispatchDayOpening({ day_opening_done_this_session: true }),
    false,
  );
});

test('shouldDispatchDayOpening: falsy flag → still dispatch', () => {
  assert.equal(shouldDispatchDayOpening({ day_opening_done_this_session: false }), true);
  assert.equal(shouldDispatchDayOpening({ day_opening_done_this_session: null }),  true);
  assert.equal(shouldDispatchDayOpening({ day_opening_done_this_session: 0 }),     true);
});

test('🛑 buildDynamicContext: elicitation + opening + day_opening_inject_active=true → deferred variant (suppresses 起手式) (PR-23s4b)', () => {
  // PR-23s4b: phase_1 → primary_mode=elicitation. E4 fired, flag set,
  // modeContextFor returns the "defer to inject" variant — not the cold 起手式
  // that competed with the inject and won on A001 Day 2.
  const txt = buildDynamicContext(
    {
      primary_mode: 'elicitation',
      router_phase: 'opening',
      day_opening_inject_active: true,
    },
    {}, 1,
  );
  assert.match(txt, /\[SYSTEM INJECT — Day Opening Active Reference\][\s\S]*?主導開場/);
  assert.match(txt, /不另起 elicitation 冷起手式/);
  assert.doesNotMatch(txt, /在你的生命裡、你想要什麼\?/,
    '冷起手式必須消失（compete with E4 inject 就是這個 bug 的根）');
});

test('buildDynamicContext: elicitation + opening + no flag → cold 起手式 (Day 1 unchanged)', () => {
  const txt = buildDynamicContext(
    { primary_mode: 'elicitation', router_phase: 'opening' },
    {}, 0,
  );
  assert.match(txt, /起手式「在你的生命裡、你想要什麼\?」/);
});

// ═════════════════════════════════════════════════════════
// PR-4c-4c: session-start kickoff handshake
// (frontend → AI 起手式 first; fixes fresh-Day-1 blank-screen bug)
// ═════════════════════════════════════════════════════════

test('🛑 isKickoffRequest: true only when body.kickoff === true (strict)', () => {
  assert.equal(isKickoffRequest({ kickoff: true }), true);
  // strict: anything else is treated as a normal turn
  assert.equal(isKickoffRequest({ kickoff: 'true' }), false, '"true" string is NOT kickoff');
  assert.equal(isKickoffRequest({ kickoff: 1 }), false);
  assert.equal(isKickoffRequest({ kickoff: false }), false);
  assert.equal(isKickoffRequest({}), false);
  assert.equal(isKickoffRequest(null), false);
  assert.equal(isKickoffRequest(undefined), false);
});

test('buildKickoffMessages: single user-role meta-instruction message', () => {
  const msgs = buildKickoffMessages();
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].role, 'user', 'Anthropic requires messages[0]=user');
  assert.equal(msgs[0].content, KICKOFF_TRIGGER_CONTENT);
});

test('🛑 KICKOFF_TRIGGER_CONTENT: instructs AI to emit the opening WITHOUT echoing the sentinel', () => {
  assert.match(KICKOFF_TRIGGER_CONTENT, /session-start trigger/,
    'tag the sentinel so a designer/dev grepping production logs can identify it');
  assert.match(KICKOFF_TRIGGER_CONTENT, /不 echo 此訊息/,
    'must explicitly forbid the AI from echoing the sentinel back to the student');
  assert.match(KICKOFF_TRIGGER_CONTENT, /phase_context/,
    'AI should consult the phase-context opening variant (which has 起手式)');
});

test('🛑 KICKOFF_TRIGGER_CONTENT: 紅線 1 — sentinel itself does not contain 為什麼', () => {
  assert.doesNotMatch(KICKOFF_TRIGGER_CONTENT, /為什麼/,
    'sentinel feeds Sonnet directly — must not introduce a 紅線 1 violation by example');
});

// ═════════════════════════════════════════════════════════
// PR-4c-4e: normalizeDateString + decideSessionAction (pace-aware session resolver)
// ═════════════════════════════════════════════════════════

test('normalizeDateString: Date / "YYYY-MM-DD" / longer string → canonical YYYY-MM-DD', () => {
  assert.equal(normalizeDateString(new Date('2026-05-23T12:00:00Z')), '2026-05-23');
  assert.equal(normalizeDateString('2026-05-23'), '2026-05-23');
  assert.equal(normalizeDateString('2026-05-23T08:00:00.000Z'), '2026-05-23');
  assert.equal(normalizeDateString(null), null);
  assert.equal(normalizeDateString(undefined), null);
  assert.equal(normalizeDateString(''), null);
});

test('decideSessionAction: in-progress session → reuse', () => {
  const r = decideSessionAction({
    inProgress: { day: 3 }, prior: null, pace: 'daily',
    sessionDate: '2026-05-23', userSessionDayCount: 3,
  });
  assert.deepEqual(r, { action: 'reuse', sessionDay: 3 });
});

test('decideSessionAction: no prior — brand-new student → create Day 1', () => {
  const r = decideSessionAction({
    inProgress: null, prior: null, pace: 'daily',
    sessionDate: '2026-05-23', userSessionDayCount: 0,
  });
  assert.deepEqual(r, { action: 'create', sessionDay: 1 });
});

test('decideSessionAction: prior session was YESTERDAY (daily) → create next day', () => {
  const r = decideSessionAction({
    inProgress: null,
    prior: { day: 1, session_date: '2026-05-22' },
    pace: 'daily',
    sessionDate: '2026-05-23',
    userSessionDayCount: 1,
  });
  assert.deepEqual(r, { action: 'create', sessionDay: 2 });
});

test('🛑 decideSessionAction: daily mode + prior session is TODAY → locked', () => {
  const r = decideSessionAction({
    inProgress: null,
    prior: { day: 1, session_date: '2026-05-23' },
    pace: 'daily',
    sessionDate: '2026-05-23',
    userSessionDayCount: 1,
  });
  assert.equal(r.action, 'locked');
  assert.equal(r.sessionDay, 1, 'locked sessionDay = prior day (informational)');
});

test('🛑 decideSessionAction: self-paced + prior session is TODAY → CREATE next day (same calendar day unlock)', () => {
  const r = decideSessionAction({
    inProgress: null,
    prior: { day: 1, session_date: '2026-05-23' },
    pace: 'self-paced',
    sessionDate: '2026-05-23',
    userSessionDayCount: 1,
  });
  assert.deepEqual(r, { action: 'create', sessionDay: 2 });
});

test('decideSessionAction: accepts Date OR string for prior.session_date', () => {
  const a = decideSessionAction({
    inProgress: null,
    prior: { day: 1, session_date: new Date('2026-05-23T03:00:00Z') },
    pace: 'daily',
    sessionDate: '2026-05-23',
    userSessionDayCount: 1,
  });
  const b = decideSessionAction({
    inProgress: null,
    prior: { day: 1, session_date: '2026-05-23' },
    pace: 'daily',
    sessionDate: '2026-05-23',
    userSessionDayCount: 1,
  });
  assert.deepEqual(a, b);
  assert.equal(a.action, 'locked');
});

test('🛑 decideSessionAction: nextDay sourced from userSessionDayCount, not prior.day', () => {
  // advance_student_day.sql scenario: session_day_count = 6 (jumped via SQL), but
  // sessions table is empty (no prior rows). Next day MUST be 7, not 1.
  const r = decideSessionAction({
    inProgress: null, prior: null, pace: 'daily',
    sessionDate: '2026-05-23', userSessionDayCount: 6,
  });
  assert.equal(r.sessionDay, 7, 'scripts/advance_student_day.sql must skip-ahead cleanly');
});

test('decideSessionAction: in-progress wins over pace/lock — never lock with active session', () => {
  // edge: daily mode, prior says today's session is in progress (day_complete=false)
  // → reuse, don't lock.
  const r = decideSessionAction({
    inProgress: { day: 1 },
    prior: { day: 1, session_date: '2026-05-23' },
    pace: 'daily',
    sessionDate: '2026-05-23',
    userSessionDayCount: 1,
  });
  assert.equal(r.action, 'reuse');
});

// ═════════════════════════════════════════════════════════
// PR-4c-green E4 修法 1 — finalize race gate (Patrick 5/24 主因)
// 釘死 Patrick's 3 verification cases:
//   (a) E4 在 isNew=false + new-program-day 仍 dispatch  ← covered by shouldDispatchDayOpening tests above
//   (b) self-paced gap_days=0 仍 dispatch                ← decideSessionAction self-paced create path (existing test)
//   (c) prior-day 未 finalize 時 Day N+1 不在空資產下開場 ← awaiting_prior_finalize action below
// ═════════════════════════════════════════════════════════

test('🛑 decideSessionAction: self-paced + prior day not finalized → awaiting_prior_finalize (NOT cold-start create)', () => {
  // Self-paced Day 1 just收尾, daily_takeaways write still in flight.
  // The cold create would seed Day 2 with empty assets → A001 Day 2 災難.
  const r = decideSessionAction({
    inProgress: null,
    prior: { day: 1, session_date: '2026-05-23' },
    pace: 'self-paced',
    sessionDate: '2026-05-23',
    userSessionDayCount: 1,
    priorDayFinalized: false,
  });
  assert.equal(r.action, 'awaiting_prior_finalize');
  assert.equal(r.sessionDay, 2);
  assert.equal(r.priorDay, 1);
});

test('decideSessionAction: priorDayFinalized=true (default) → create (backward-compat)', () => {
  // Existing callers don't pass priorDayFinalized; default true preserves behavior.
  const r = decideSessionAction({
    inProgress: null,
    prior: { day: 1, session_date: '2026-05-23' },
    pace: 'self-paced',
    sessionDate: '2026-05-23',
    userSessionDayCount: 1,
  });
  assert.equal(r.action, 'create');
});

test('decideSessionAction: Day 1 fresh student (no prior) + priorDayFinalized=false → still create', () => {
  // priorDayFinalized=false only blocks when there IS a prior day to race against.
  // Brand-new students reach this branch on first-ever entry and must NOT lock.
  const r = decideSessionAction({
    inProgress: null,
    prior: null,
    pace: 'self-paced',
    sessionDate: '2026-05-23',
    userSessionDayCount: 0,
    priorDayFinalized: false,
  });
  assert.equal(r.action, 'create');
  assert.equal(r.sessionDay, 1);
});

test('decideSessionAction: in-progress beats awaiting_prior_finalize (active session wins)', () => {
  const r = decideSessionAction({
    inProgress: { day: 2 },
    prior: { day: 1, session_date: '2026-05-23' },
    pace: 'self-paced',
    sessionDate: '2026-05-23',
    userSessionDayCount: 1,
    priorDayFinalized: false,
  });
  assert.equal(r.action, 'reuse', 'in-progress means student is already past the race');
});

// ─── isPriorDayFinalized — the caller-side computation ───

test('🛑 isPriorDayFinalized: daily_takeaways has entry for priorDay → true (race done)', () => {
  assert.equal(isPriorDayFinalized({
    priorDay: 1,
    priorUpdatedAt: new Date(),
    dailyTakeaways: [{ day: 1, term: '可以決定' }],
  }), true);
});

test('🛑 isPriorDayFinalized: no entry + recent updated_at → false (race in flight)', () => {
  const now = new Date('2026-05-24T12:00:00Z');
  const justNow = new Date('2026-05-24T11:59:50Z');   // 10 seconds ago
  assert.equal(isPriorDayFinalized({
    priorDay: 1,
    priorUpdatedAt: justNow,
    dailyTakeaways: [],
    now,
  }), false, 'recent finalize, no takeaway yet → race is in flight');
});

test('isPriorDayFinalized: no entry + stale updated_at → true (give up the race-wait)', () => {
  const now = new Date('2026-05-24T12:00:00Z');
  const longAgo = new Date('2026-05-24T11:55:00Z');   // 5 min ago, well past 90s window
  assert.equal(isPriorDayFinalized({
    priorDay: 1,
    priorUpdatedAt: longAgo,
    dailyTakeaways: [],
    now,
  }), true, 'stale → either finalize had no 關鍵句 or it truly failed — don\'t lock forever');
});

test('isPriorDayFinalized: priorDay = 0 (no prior) → true (nothing to race)', () => {
  assert.equal(isPriorDayFinalized({ priorDay: 0 }), true);
  assert.equal(isPriorDayFinalized({ priorDay: null }), true);
  assert.equal(isPriorDayFinalized({}), true);
});

test('isPriorDayFinalized: takeaway entry present + stale timestamp → still true', () => {
  // Entry takes precedence; recency is just the fallback escape valve.
  const now = new Date('2026-05-24T12:00:00Z');
  const longAgo = new Date('2026-05-24T11:00:00Z');
  assert.equal(isPriorDayFinalized({
    priorDay: 1,
    priorUpdatedAt: longAgo,
    dailyTakeaways: [{ day: 1, term: '可以決定' }],
    now,
  }), true);
});

test('isPriorDayFinalized: no priorUpdatedAt (legacy row pre-updated_at column) → true', () => {
  assert.equal(isPriorDayFinalized({
    priorDay: 1, priorUpdatedAt: null, dailyTakeaways: [],
  }), true, 'no timestamp to gate on → don\'t lock');
});

test('isPriorDayFinalized: ISO-string priorUpdatedAt → parsed correctly', () => {
  const now = new Date('2026-05-24T12:00:00Z');
  assert.equal(isPriorDayFinalized({
    priorDay: 1,
    priorUpdatedAt: '2026-05-24T11:59:30Z',   // 30s ago
    dailyTakeaways: [],
    now,
  }), false, 'string timestamp inside recency window');
});

// ═════════════════════════════════════════════════════════
// 🛑 5/29 Patrick (PRODUCT-TRUTH v2.3 §2.5) — depthSignal wiring grep guard.
// pure-helper behavior fully covered in lib/api/depth-signal.test.js;
// here we just lock that chat.js handler imports + ships it on the 200 response.
// ═════════════════════════════════════════════════════════

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

test('🛑 chat.js: imports computeDepthSignal from lib/api/depth-signal.js', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  assert.match(src, /import \{ computeDepthSignal \} from '\.\.\/lib\/api\/depth-signal\.js'/,
    'chat.js must import computeDepthSignal');
});

test('🛑 chat.js: response payload includes depthSignal field', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  // The constant must be computed from merged state + turnCount, then passed
  // into buildChatResponsePayload (PR-23s4b extracted the response build) which
  // wires it into the 200 payload.
  assert.match(src, /const depthSignal = computeDepthSignal\(stateForPrompt, turnCount\)/,
    'chat.js must compute depthSignal from merged stateForPrompt + turnCount');
  assert.match(src,
    /res\.status\(200\)\.json\(buildChatResponsePayload\([\s\S]*?depthSignal[\s\S]*?\}\)\)/,
    'chat.js must pass depthSignal into buildChatResponsePayload');
});

// ═════════════════════════════════════════════════════════
// 🛑 6/3 Patrick (Vivi burst protection) — Anthropic retry + 503 overload wiring.
// pure helper behavior fully covered in lib/api/anthropic-retry.test.js;
// here we just grep-lock that chat.js wires it + ships 503 with the right shape.
// ═════════════════════════════════════════════════════════

test('🛑 chat.js: imports callAnthropicWithRetry from lib/api/anthropic-retry.js', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  assert.match(src, /import \{ callAnthropicWithRetry \} from '\.\.\/lib\/api\/anthropic-retry\.js'/,
    'chat.js must import the retry helper');
});

test('🛑 chat.js: Step 9 Anthropic call wrapped by callAnthropicWithRetry', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  // The main /api/chat handler must use the retry helper.
  // (generateDamonNote / generateNotebookPage v4 legacy helpers still call the
  // raw SDK — those run under finalize-day, separate error path. Out of scope.)
  assert.match(src, /const callResult = await callAnthropicWithRetry\(getAnthropic\(\), \{/,
    'chat.js handler Step 9 must call callAnthropicWithRetry, not raw SDK');
  // The retry-wrapped call must come BEFORE any legacy raw .messages.create
  // (handler comes before exported v4 helpers in the file).
  const idxWrapped = src.indexOf('await callAnthropicWithRetry(');
  const idxFirstRaw = src.search(/await getAnthropic\(\)\.messages\.create\(/);
  if (idxFirstRaw >= 0) {
    assert.ok(idxWrapped < idxFirstRaw,
      'wrapped call (handler Step 9) must come before any legacy raw helper call');
  }
});

test('🛑 chat.js: 503 overload path returns Vivi-spec error shape', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  // 503 status + error='overload' + 友善 message (per Vivi 6/3 spec).
  assert.match(src,
    /res\.status\(503\)\.json\(\{[\s\S]*?error:\s*'overload'[\s\S]*?message:\s*'教練此刻太多人在對話、請 30 秒後再送一次。'[\s\S]*?\}\)/,
    'chat.js must return 503 with { error: "overload", message: ...友善訊息 }');
});

test('🛑 chat.js: overload path rolls back the user message INSERT (no double-INSERT on retry)', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  // DELETE the latest user message for this session (ORDER BY id DESC LIMIT 1
  // subquery is the safe pattern — matches what we just inserted, even if
  // question_number is not unique).
  assert.match(src,
    /DELETE FROM messages WHERE id = \(\s*SELECT id FROM messages\s+WHERE session_id = \$\{sessionId\} AND role = 'user'\s+ORDER BY id DESC LIMIT 1\s*\)/,
    'overload cleanup must DELETE the latest user message for this session');
  // Decrement questions_today.
  assert.match(src,
    /UPDATE sessions SET questions_today = questions_today - 1[\s\S]*?WHERE id = \$\{sessionId\}/,
    'overload cleanup must decrement questions_today');
});

// ═════════════════════════════════════════════════════════
// 🛑 6/7 Vivi — generateNotebookPage「我看見的」 sharp / gentle branch.
// Sync-gate: the prompt source must contain BOTH register variants and switch
// on the wasCrisis parameter. (LLM round-trip not mocked; we lock the source.)
// ═════════════════════════════════════════════════════════

const chatJsSrc = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
  'utf8',
);

test('🛑 6/7 chat.js: generateNotebookPage signature accepts wasCrisis param (default false)', () => {
  // PR-d 6/8 added activeContextName + activeContextDefinition AFTER wasCrisis,
  // so wasCrisis is followed by comma (not closing paren) in the new signature.
  assert.match(chatJsSrc,
    /export async function generateNotebookPage\([^)]*wasCrisis\s*=\s*false[,)]/,
    'generateNotebookPage must accept wasCrisis (default false)');
});

test('🛑 6/7 chat.js: generateDamonNote signature accepts wasCrisis + passes through', () => {
  // Signature.
  assert.match(chatJsSrc,
    /export async function generateDamonNote\([^)]*wasCrisis\s*=\s*false\s*\)/,
    'generateDamonNote must accept wasCrisis (default false)');
  // Pass-through to generateNotebookPage. PR-d 6/8 added 2 more args after wasCrisis
  // (activeContextName, activeContextDefinition) — match wasCrisis followed by
  // comma OR closing paren.
  assert.match(chatJsSrc,
    /generateNotebookPage\([\s\S]*?,\s*wasCrisis[,)]/,
    'generateDamonNote must pass wasCrisis through to generateNotebookPage');
});

test('🛑 6/7 chat.js: prompt branches on wasCrisis (ternary or if to pick seeingSection)', () => {
  // The branch must read wasCrisis. Use a flexible match — any reference to
  // wasCrisis in a conditional that yields a seeingSection / similar string.
  assert.match(chatJsSrc,
    /wasCrisis\s*\?[\s\S]*?:[\s\S]*?\)/,
    'prompt construction must branch on wasCrisis');
});

test('🛑 6/7 chat.js: SHARP variant — 點破身份規則 / 反例(太溫、不要) / 不舒服=工具', () => {
  // Spec verbatim landmarks (Patrick 6/7): these must appear literally in the
  // non-crisis prompt fragment. Locking each individually catches drift.
  assert.match(chatJsSrc, /身份規則 \/ 隱性信念/, 'sharp variant must include the spec phrase 「身份規則 / 隱性信念」');
  assert.match(chatJsSrc, /反例\(太溫、不要\)/, 'sharp variant must include the 反例(太溫、不要) lead-in');
  assert.match(chatJsSrc, /正解\(夠利、要這樣\)/, 'sharp variant must include the 正解(夠利、要這樣) lead-in');
  assert.match(chatJsSrc, /不舒服 = 工具/, 'sharp variant must include the 不舒服=工具 reframe');
  assert.match(chatJsSrc, /別急著推開/, 'sharp variant must include the 別急著推開 phrasing');
  assert.match(chatJsSrc, /醍醐灌頂/, 'sharp variant must call for the 醍醐灌頂 effect (寧可短而利)');
  // Length target: 120-160 字.
  assert.match(chatJsSrc, /約 120-160 字/);
});

test('🛑 6/7 chat.js: GENTLE variant (wasCrisis=true) — 原 80 字緩衝版本 retained', () => {
  // Crisis sessions get the original gentle 80字 version verbatim.
  assert.match(chatJsSrc, /緩衝詞必加:可能、可能不是、猜想/);
  assert.match(chatJsSrc, /結尾必加:邀請你 sit with 一句具體的話/);
  // Crisis-context warning note must be present (explains to LLM why register is soft).
  assert.match(chatJsSrc,
    /本場次曾觸發 crisis SOP[\s\S]{0,80}保持溫和緩衝、不要犀利點破身份規則/,
    'gentle variant must explain crisis context to the LLM (避免犀利)');
  // Length target remains 80 字.
  assert.match(chatJsSrc, /約 80 字/);
});

test('🛑 6/7 chat.js: rule 5 length cap is conditional (350 gentle / 430 sharp)', () => {
  // Spec: "350 → 約 430 字 (犀利段變長, 留空間)".
  assert.match(chatJsSrc, /totalLengthCap\s*=\s*wasCrisis\s*\?\s*350\s*:\s*430/,
    'totalLengthCap ternary must be wasCrisis ? 350 : 430');
  // Rule 5 in the prompt must render the cap variable, not a literal 350.
  assert.match(chatJsSrc, /總長度不超過 \$\{totalLengthCap\} 字/);
});

test('🛑 6/7 chat.js: safety wall (rule 10) retained verbatim (scrubber alignment)', () => {
  // Spec rules 6/7/10 must remain. Rule 10 is the section-name + tool + Layer
  // ban that pairs with student-note-safe.js scrubber. Lock the key fragments.
  assert.match(chatJsSrc, /禁止「工具一\/二\/三\/四」/);
  assert.match(chatJsSrc, /禁止「Layer 1-5 \/ L1-L5」/);
  assert.match(chatJsSrc, /禁止「2A SC 池 \/ 2B Reactive 池 \/ 2C Belief 池」/);
  // Rule 6: 不替學員修正信念 (preserved per spec).
  assert.match(chatJsSrc, /不替你「修正」信念、只讓信念被看見/);
  // Rule 7: SC 是假設 不是判斷 (preserved per spec: 犀利 ≠ 下判決).
  assert.match(chatJsSrc, /SC 觀察是假設、不是判斷/);
});

// ═════════════════════════════════════════════════════════
// 🛑 6/8 Vivi v5.2 errata PR-a — generateDamonNote template v5.2 化.
// Anti-regression sync-gates: regex-locked headers preserved, v3.3 廢除詞 gone,
// v5.2 new headers present, active_context anchor + sc_step_when_generated prepended,
// template_version='v5.2' on INSERT, generateNotebookPage 0 diff.
// ═════════════════════════════════════════════════════════

test('🛑 6/8 v5.2 PR-a: 3 regex-locked headers retained verbatim (finalize-day 抓取依賴)', () => {
  // 【關鍵句】 / 【明天的入口】 / 【SC 觀察】 — finalize-day.js + chat.js regex.
  // Without these, publicNote / next-day SC hypothesis 全爆.
  // PR-b refactor: template now extracted to buildDamonNoteTemplateV52. Repoint
  // the source slice from the inline `system:` window to the template function body.
  const templateFnStart = chatJsSrc.indexOf('export function buildDamonNoteTemplateV52');
  const templateFnEnd   = chatJsSrc.indexOf('export function buildDamonNoteSystemArray');
  assert.ok(templateFnStart > 0 && templateFnEnd > templateFnStart,
    'buildDamonNoteTemplateV52 + buildDamonNoteSystemArray functions must be locatable');
  const templateFn = chatJsSrc.slice(templateFnStart, templateFnEnd);
  assert.match(templateFn, /【關鍵句】/, '【關鍵句】 header verbatim');
  assert.match(templateFn, /【明天的入口】/, '【明天的入口】 header verbatim');
  assert.match(templateFn, /【SC 觀察】/, '【SC 觀察】 header verbatim');
});

test('🛑 6/8 v5.2 PR-a: regex extraction in generateDamonNote unchanged (publicNote pipeline)', () => {
  // chat.js extracts via /【關鍵句】\s*\n([\s\S]*?)(?=\n【|$)/ + 【明天的入口】.
  // Lock both regex patterns (and the SC observation extraction).
  assert.match(chatJsSrc, /fullNote\.match\(\/【關鍵句】\\s\*\\n\(\[\\s\\S\]\*\?\)\(\?=\\n【\|\$\)\/\)/);
  assert.match(chatJsSrc, /fullNote\.match\(\/【明天的入口】\\s\*\\n\(\[\\s\\S\]\*\?\)\(\?=\\n【\|\$\)\/\)/);
  assert.match(chatJsSrc, /fullNote\.match\(\/【SC 觀察】\\s\*\\n\(\[\\s\\S\]\*\?\)\(\?=\\n【\|\$\)\/\)/);
});

test('🛑 6/8 v5.2 PR-a: new headers present in template', () => {
  // 【深度層次】 → 【Mode 軌跡】 (Layer 1-5 → Mode 軌跡)
  // + 【應 invoke 但未 invoke 的技術】 (新 §1.4)
  // + 【Day 1-N 採集追蹤】 (取代【Day 1-6 採集追蹤】)
  assert.match(chatJsSrc, /【Mode 軌跡】/);
  assert.match(chatJsSrc, /【應 invoke 但未 invoke 的技術】/);
  assert.match(chatJsSrc, /【Day 1-N 採集追蹤】/);
});

test('🛑 6/8 v5.2 PR-a: 廢除詞 explicit guard in template prompt (Layer / 工具 / 池 / Cathy)', () => {
  // The template must EXPLICITLY instruct the AI to NOT emit these.
  // Locate the「⛔ 廢除詞嚴禁出現」 block.
  const guardBlock = chatJsSrc.match(
    /【⛔ 廢除詞嚴禁出現】[\s\S]{0,2000}/,
  );
  assert.ok(guardBlock, '廢除詞嚴禁出現 explicit guard block must exist');
  // Specific forbidden terms enumerated.
  assert.match(guardBlock[0], /Layer 1-5 \/ L1 \/ L2 \/ L3 \/ L4 \/ L5/);
  assert.match(guardBlock[0], /工具一 \/ 工具二 \/ 工具三 \/ 工具四/);
  assert.match(guardBlock[0], /2A SC 池 \/ 2B Reactive 池 \/ 2C Belief 池/);
  assert.match(guardBlock[0], /Cathy Q5 確認/);
  // Plus 廢「繞過去/沒進去」/「需要X才能Y」.
  assert.match(guardBlock[0], /學員繞過去了/);
  assert.match(guardBlock[0], /學員沒進去/);
  assert.match(guardBlock[0], /需要 X 才能 Y/);
});

// (Old approximate "緩衝詞分流規則" test superseded by §1.5 verbatim test below.)

test('🛑 6/8 v5.2 PR-a §1.3: Damon 體系命名清單 verbatim 對齊 spec', () => {
  // Damon vocabulary block must list spec §1.3 verbatim categories + named items.
  // Spec §1.3 verbatim landmarks:
  assert.match(chatJsSrc, /External Locus of Control \(外部控制點\)/);
  assert.match(chatJsSrc, /Reclaim Source \(收回源頭、R1\)/);
  assert.match(chatJsSrc, /The Bargain \(交易幻覺、紅線 23\)/);
  assert.match(chatJsSrc, /Perfectionism Trap \(完美主義陷阱、紅線 25\)/);
  assert.match(chatJsSrc, /Frequency Illusion \(頻率錯覺、紅線 22\)/);
  assert.match(chatJsSrc, /Self-worth Fiction \(自我價值虛構、紅線 7\)/);
  assert.match(chatJsSrc, /副產品陷阱 \(Byproduct Trap、紅線 24\)/);
  // R-series 11 verbatim Chinese names (spec §1.3 Reframe Names).
  assert.match(chatJsSrc, /R1 Reclaim Source \(收回源頭\)/);
  assert.match(chatJsSrc, /R2 Behavior to Identity \(行為轉特質\)/);
  assert.match(chatJsSrc, /R5 Away From → Toward/);
  assert.match(chatJsSrc, /R7 Slip into Unconscious/);
  assert.match(chatJsSrc, /R10 Memento Mori[\s\S]{0,80}crisis disable/);
  assert.match(chatJsSrc, /R12 Hero's Welcome/);
  // IP #1-#5 verbatim.
  assert.match(chatJsSrc, /IP #1 Scope Overlap/);
  assert.match(chatJsSrc, /IP #5 NLP Amnesia 主動整合/);
  // 6 modes verbatim.
  assert.match(chatJsSrc, /elicitation \/ identity_anchoring \/ integration \/ cascade \/ future_pacing \/ crisis/);
  // Tier 1-3 補充 items.
  assert.match(chatJsSrc, /Diamond Essence/);
  assert.match(chatJsSrc, /Chief Validation Officer/);
  assert.match(chatJsSrc, /Memento Mori 等待即是凋零/);
  // Damon metaphors.
  assert.match(chatJsSrc, /鑽石本質 \(Diamond Essence\)/);
  assert.match(chatJsSrc, /忠誠士兵 \(Loyal Soldier、Hero's Welcome step 2\)/);
});

test('🛑 6/8 v5.2 PR-a §1.2: SC 觀察 段 1 verbatim 例句 (補償邏輯 / Perfectionism)', () => {
  // Spec §1.2 verbatim landmark examples — must appear in the template.
  assert.match(chatJsSrc, /學員今天 surface 補償邏輯 \(去紐約是補償伴侶出差的限制\)/);
  assert.match(chatJsSrc, /對應 The Bargain \(交易幻覺\)/);
  assert.match(chatJsSrc, /紅線 23 觸發場景/);
  assert.match(chatJsSrc, /『追求極致狀態會耗竭致死』/);
  assert.match(chatJsSrc, /對應 Perfectionism Trap \(紅線 25\)/);
});

test('🛑 6/8 v5.2 PR-a §1.2: SC 觀察 段 2 verbatim 例句 (自由是我本質)', () => {
  assert.match(chatJsSrc, /猜想學員可能是一個深度相信『自由是我本質』的人/);
});

test('🛑 6/8 v5.2 PR-a §1.2: Mode 軌跡 verbatim 例句', () => {
  // Spec §1.2: 「elicitation 走完、進 identity_anchoring 觸發、return elicitation」
  assert.match(chatJsSrc, /elicitation 走完、進 identity_anchoring 觸發、return elicitation/);
});

test('🛑 6/8 v5.2 PR-a §1.4: 應 invoke 但未 invoke verbatim 3 例 + 4-step instruction', () => {
  // Spec §1.2 verbatim three examples.
  assert.match(chatJsSrc, /學員 surface 補償邏輯、應 invoke 紅線 23 Bargain 挑戰、未發生/);
  assert.match(chatJsSrc,
    /學員 surface『我就是那個源頭』、R1 Reclaim Source 應強化、僅 echo/);
  assert.match(chatJsSrc,
    /學員 surface 顧小孩 vs 自由內在 part 對立、R12 Hero's Welcome 應觸發、未發生/);
  // Spec §1.4 verbatim 4-step instruction structure.
  assert.match(chatJsSrc, /步驟 1: 識別學員 surface 的 Damon 體系訊號/);
  assert.match(chatJsSrc, /步驟 2: 對應應 invoke 的 v5\.1 spec 元素/);
  assert.match(chatJsSrc, /步驟 3: 對照實際 AI 行為/);
  assert.match(chatJsSrc, /步驟 4: 寫入本 section/);
});

test('🛑 6/8 v5.2 PR-a §1.5: 緩衝詞分流 4 條規則 verbatim', () => {
  // Spec §1.5 verbatim rules.
  assert.match(chatJsSrc,
    /應 invoke 但未 invoke 的技術[\s\S]{0,200}R1 Reclaim Source 應強化、僅 echo[\s\S]{0,100}不寫「可能應該 R1」/);
  // 親密關係 / 家庭結構 / 童年深入推測 — 體系明確 caveat.
  assert.match(chatJsSrc, /親密關係 \/ 家庭結構 \/ 童年深入推測/);
});

test('🛑 6/8 v5.2 PR-a §8.1: active_context anchor SELECT + 前置注入 (--- 分隔)', () => {
  // SELECT 一定要撈 active_context_*.
  assert.match(chatJsSrc,
    /SELECT preferred_name,\s*\n\s*active_context_category, active_context_name, active_context_definition/);
  // Spec §8.1 format uses --- horizontal rules to wrap the anchor block.
  // Template literal opens with `---\n` then 【active_context】 then fields then `---\n`.
  assert.match(chatJsSrc,
    /const activeContextAnchor\s*=\s*\n?\s*`---\\n`[\s\S]{0,80}`【active_context】\\n`/);
  assert.match(chatJsSrc, /category: \$\{activeContextCategory/);
  assert.match(chatJsSrc, /name: \$\{activeContextName/);
  assert.match(chatJsSrc, /definition: \$\{activeContextDefinition/);
  // fullNote = activeContextAnchor + scStepPlaceholder + bodyMinusAnchors
  assert.match(chatJsSrc,
    /const fullNote = `\$\{activeContextAnchor\}\\n\$\{scStepPlaceholder\}\\n\$\{bodyMinusAnchors\}`/);
});

test('🛑 6/8 v5.2 PR-a §9.1: sc_step_when_generated null placeholder (--- 分隔, 含 spec 註解)', () => {
  // Spec §9.1 verbatim shape:
  //   ---
  //   【sc_step_when_generated】
  //   step: null  # placeholder、七步 errata ship 後實作 logic
  //   evidence_focus: null  # placeholder、七步 errata ship 後實作 logic
  //   ---
  assert.match(chatJsSrc,
    /const scStepPlaceholder\s*=\s*\n?\s*`---\\n`[\s\S]{0,80}`【sc_step_when_generated】\\n`/);
  assert.match(chatJsSrc, /step: null  # placeholder、七步 errata ship 後實作 logic/);
  assert.match(chatJsSrc, /evidence_focus: null  # placeholder、七步 errata ship 後實作 logic/);
});

test('🛑 6/8 v5.2 PR-a: INSERT damon_notes 帶 template_version=\'v5.2\'', () => {
  // INSERT shape:
  //   INSERT INTO damon_notes (..., is_week_summary, template_version)
  //   VALUES (..., false, 'v5.2')
  //   ON CONFLICT ... DO UPDATE SET ..., template_version = 'v5.2', updated_at = NOW()
  const insertWindow = chatJsSrc.match(
    /INSERT INTO damon_notes[\s\S]*?ON CONFLICT[\s\S]*?updated_at = NOW\(\)/,
  );
  assert.ok(insertWindow, 'INSERT INTO damon_notes block must be locatable');
  assert.match(insertWindow[0], /template_version/);
  assert.match(insertWindow[0], /'v5\.2'/);
});

test('🛑 6/8 v5.2 PR-a: old v3.3 section headers GONE as instructions (only mentioned in guards / deprecation rules)', () => {
  // The old v3.3 section headers must no longer be present as section headers
  // the AI is told to USE. They may still appear inside the「⛔ 廢除詞嚴禁出現」
  // guard block and inside §1.2's "v5.2 規則 update" rule (as deprecation
  // language: "❌ 不用..."). The protection signal we lock here is the
  // ABSENCE of "section heading" usage:
  //   - No 「【深度層次】」 used as a section heading line (AI would emit one).
  //   - No 「【Day 1-6 採集追蹤】」 used as a section heading line.
  //
  // PR-b refactor: template now lives in buildDamonNoteTemplateV52. Repoint the
  // source slice from the inline function body to the template function body.
  const templateFnStart = chatJsSrc.indexOf('export function buildDamonNoteTemplateV52');
  const templateFnEnd   = chatJsSrc.indexOf('export function buildDamonNoteSystemArray');
  assert.ok(templateFnStart > 0 && templateFnEnd > templateFnStart);
  const templateFn = chatJsSrc.slice(templateFnStart, templateFnEnd);

  // Old v3.3 header lines must NOT appear as the AI-facing section header
  // instruction. Pattern「\n【深度層次】\n」 (header on its own line, body below)
  // would mean we still tell the AI to emit one. New template uses 【Mode 軌跡】.
  assert.ok(!/\n【深度層次】\n/.test(templateFn),
    'old【深度層次】 must not be an AI-facing section instruction (replaced by【Mode 軌跡】)');
  assert.ok(!/\n【Day 1-6 採集追蹤】/.test(templateFn),
    'old【Day 1-6 採集追蹤】 must not be an AI-facing section instruction (replaced by Day 1-N)');
  // Cathy Q5 must not appear as a positive instruction sentence.
  assert.ok(!/Cathy Q5 確認[^。]*?如果整週只挖到 1 個/.test(templateFn),
    'old Cathy Q5 instruction sentence must be gone (廢除)');
  // 工具二 2A SC 池 as positive instruction (not as guard list item).
  assert.ok(!/工具二 2A SC 池[、)]/.test(templateFn),
    'old「工具二 2A SC 池」 instruction must be gone (廢除)');
});

test('🛑 6/8 v5.2 PR-a → PR-d retained: generateNotebookPage sharp variant 框架 (身份規則 + 不舒服=工具)', () => {
  // The "我看見的" sharp card landmarks (ea53d6d). PR-d (§2) added §2.1 Chinese
  // concept naming + dropped blanket 緩衝, but these sharp-variant pillars stay.
  assert.match(chatJsSrc, /async function generateNotebookPage\(/);
  assert.match(chatJsSrc, /身份規則 \/ 隱性信念/);   // sharp variant 核心
  assert.match(chatJsSrc, /不舒服 = 工具/);           // sharp variant 框架
});

test('🛑 chat.js: overload path is BEFORE Step 11b (no day_complete=TRUE WRITE on overload)', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  // Vivi 6/3 spec: 「不要把 chat session row 標 day_complete=TRUE 或 takeaway_seeded」.
  // The 503 return must appear lexically before the `UPDATE sessions SET
  // day_complete = TRUE` WRITE (lines that just READ day_complete in earlier
  // SELECTs are fine; only the WRITE is forbidden in the overload path).
  const idx503 = src.indexOf("res.status(503)");
  const idxDayCompleteWrite = src.search(/UPDATE sessions SET\s+day_complete\s*=\s*TRUE/);
  assert.ok(idx503 > 0, '503 return must exist');
  assert.ok(idxDayCompleteWrite > 0, 'UPDATE day_complete=TRUE must exist (Step 11b)');
  assert.ok(idx503 < idxDayCompleteWrite,
    'overload 503 return must come before the day_complete=TRUE write — 鐵則: turn 沒送出去 → 不寫完成狀態');
});

test('🛑 chat.js: overload path does NOT set _succeeded (lets finally rollback isNew row)', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  // There must be exactly one `_succeeded = true` in the file, and it must be
  // AFTER the 503 return (so the overload path skips it → finally A006 rollback fires).
  const matches = [...src.matchAll(/_succeeded = true/g)];
  assert.equal(matches.length, 1, 'exactly one _succeeded=true (happy path only)');
  const idx503 = src.indexOf("res.status(503)");
  assert.ok(matches[0].index > idx503,
    '_succeeded=true must come AFTER the 503 return — overload path must NOT mark success');
});

// ═════════════════════════════════════════════════════════
// 🛑 6/3 Patrick (Vivi burst protection) — Prompt caching default-ON wiring.
// Architecture: buildSystemPromptArrayV5 already wires cache_control breakpoint
// on the last cached prefix section (lib/prompt-sections/cached/*, ~5000 tokens
// total). cachingEnabled flag flips between merged-single-block (off) vs
// 4-cached-sections-+-1-dynamic (on). The only thing this push changes is the
// DEFAULT: missing feature_flags row OR unset env → ON (was OFF).
//
// Pure helper behavior (cache_control shape, breakpoint placement) covered
// in the existing 'buildSystemPromptArrayV5' tests above; here we lock the
// default flag semantic in the handler.
// ═════════════════════════════════════════════════════════

test('🛑 chat.js: cachingEnabled defaults to ON (flags.PROMPT_CACHING !== false, not === true)', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  // The handler must use `!== false` (default-ON) not `=== true` (default-OFF).
  // This is the single character flip that ships 5-10× TPM headroom for the
  // Day 1 burst (Vivi 6/3 spec).
  assert.match(src,
    /const cachingEnabled = flags\.PROMPT_CACHING !== false/,
    'chat.js handler must default cachingEnabled to ON (use !== false, NOT === true)');
  // Belt-and-suspenders: there must NOT be a `=== true` reading of PROMPT_CACHING
  // anywhere (would silently default-OFF).
  assert.doesNotMatch(src,
    /flags\.PROMPT_CACHING === true/,
    'chat.js must NOT default-OFF (no `flags.PROMPT_CACHING === true` pattern)');
});

test('🛑 chat.js: env fallback also default-ON (FEATURE_PROMPT_CACHING !== "false")', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  // When the feature_flags SQL query fails, the in-memory fallback must also
  // default ON. Otherwise a transient Neon hiccup silently turns off caching
  // (worst case: during the actual burst).
  assert.match(src,
    /PROMPT_CACHING: process\.env\.FEATURE_PROMPT_CACHING !== 'false'/,
    'env fallback must default-ON (use !== "false", NOT === "true")');
});

// ═════════════════════════════════════════════════════════
// 🛑 v5.1 PR-23s4b hotfix (Vivi 6/4) — response assembly path MUST have test
// coverage. PR-23s4b shipped a ReferenceError (isPhaseEntry undefined in 200
// response payload) with 1222 tests green because the handler's response build
// path had no unit tests. Vivi demand: add regression coverage so this gap
// can't recur. buildChatResponsePayload extracted as pure helper for that.
// ═════════════════════════════════════════════════════════

test('🛑 buildChatResponsePayload: happy path — full shape, no missing fields', () => {
  const r = buildChatResponsePayload({
    content: 'AI reply',
    turnCount: 5,
    sessionId: 42,
    stateForPrompt: { primary_mode: 'elicitation' },
    fullPatch: { router_phase: 'elicitation' },
    priorSessionState: { mode_transition_log: [] },
    detectorPatch: {},
    isNew: false,
    dayComplete: false,
    hardLimitTurns: 40,
    depthSignal: 2,
  });
  // Field-by-field — frontend contract / response shape stays stable.
  assert.equal(r.content, 'AI reply');
  assert.equal(r.turnCount, 5);
  assert.equal(r.sessionId, 42);
  assert.equal(r.phase, 'elicitation', 'PR-23s4b: phase field carries primary_mode');
  assert.equal(r.routerPhase, 'elicitation');
  assert.equal(r.phaseAdvanced, false, 'no isNew + no mode transition → false');
  assert.equal(r.dayComplete, false);
  assert.equal(r.notesGenerating, false);
  assert.equal(r.turnsLeft, 35);
  assert.equal(r.depthSignal, 2);
});

test('🛑 buildChatResponsePayload: NEVER references undefined symbols (PR-23s4b regression)', () => {
  // This test would have caught the isPhaseEntry ReferenceError if it had
  // existed in PR-23s4b. Minimal happy-path call must NOT throw.
  assert.doesNotThrow(() => buildChatResponsePayload({
    content: '',
    turnCount: 0,
    sessionId: null,
    stateForPrompt: {},
    fullPatch: {},
    priorSessionState: {},
    detectorPatch: {},
    isNew: false,
    dayComplete: false,
    hardLimitTurns: 40,
    depthSignal: 0,
  }));
});

test('🛑 buildChatResponsePayload: phaseAdvanced=true when isNew (cross-day boundary)', () => {
  // Semantic preservation: v5.0 phaseAdvanced=true at cross-day boundary turn
  // (Day 5 enters phase_2). v5.1 equivalent: isNew=true (first turn of new
  // session day). loadOrCreateSession exposes this signal already.
  const r = buildChatResponsePayload({
    content: 'reply',
    turnCount: 1,
    sessionId: 99,
    stateForPrompt: { primary_mode: 'elicitation' },
    fullPatch: {},
    priorSessionState: {},
    detectorPatch: {},
    isNew: true,
    dayComplete: false,
    hardLimitTurns: 40,
    depthSignal: 0,
  });
  assert.equal(r.phaseAdvanced, true, 'isNew=true → phaseAdvanced=true');
});

test('🛑 buildChatResponsePayload: phaseAdvanced=true when mode transition emit log this turn', () => {
  // v5.1 semantic addition: mid-session mode transition (e.g. identity_anchoring
  // → cascade via mode-transition-router) also flips phaseAdvanced.
  const r = buildChatResponsePayload({
    content: 'reply',
    turnCount: 8,
    sessionId: 99,
    stateForPrompt: { primary_mode: 'cascade' },
    fullPatch: {},
    // PR-23s4b: detector handler emitted a new log entry this turn.
    priorSessionState: { mode_transition_log: [{ timestamp: 'old' }] },
    detectorPatch: { mode_transition_log: [{ timestamp: 'old' }, { timestamp: 'new' }] },
    isNew: false,
    dayComplete: false,
    hardLimitTurns: 40,
    depthSignal: 0,
  });
  assert.equal(r.phaseAdvanced, true, 'mode_transition_log grew this turn → phaseAdvanced=true');
});

test('🛑 buildChatResponsePayload: phaseAdvanced=false when isNew=false AND log unchanged', () => {
  const r = buildChatResponsePayload({
    content: 'reply',
    turnCount: 8,
    sessionId: 99,
    stateForPrompt: { primary_mode: 'integration' },
    fullPatch: {},
    priorSessionState: { mode_transition_log: [{ a: 1 }, { b: 2 }] },
    detectorPatch: { mode_transition_log: [{ a: 1 }, { b: 2 }] },   // unchanged
    isNew: false,
    dayComplete: false,
    hardLimitTurns: 40,
    depthSignal: 0,
  });
  assert.equal(r.phaseAdvanced, false);
});

test('buildChatResponsePayload: dayComplete=true → notesGenerating=true', () => {
  const r = buildChatResponsePayload({
    content: '今天先到這裡',
    turnCount: 18,
    sessionId: 99,
    stateForPrompt: { primary_mode: 'elicitation' },
    fullPatch: {},
    priorSessionState: {},
    detectorPatch: {},
    isNew: false,
    dayComplete: true,
    hardLimitTurns: 40,
    depthSignal: 3,
  });
  assert.equal(r.dayComplete, true);
  assert.equal(r.notesGenerating, true,
    'notesGenerating mirrors dayComplete (frontend reads it for §5.2 transition)');
});

test('buildChatResponsePayload: turnsLeft never goes negative', () => {
  // Past hard limit edge case.
  const r = buildChatResponsePayload({
    content: 'reply', turnCount: 50, sessionId: 1,
    stateForPrompt: {}, fullPatch: {}, priorSessionState: {}, detectorPatch: {},
    isNew: false, dayComplete: true, hardLimitTurns: 40, depthSignal: 0,
  });
  assert.equal(r.turnsLeft, 0);
});

test('buildChatResponsePayload: defensive defaults — empty args object → safe shape', () => {
  // Even with no inputs, response shape must be complete (caller would still
  // 200 it). content must be string-coerced or thrown — see next test for the throw path.
  const r = buildChatResponsePayload({ content: '' });
  assert.equal(r.content, '');
  assert.equal(r.turnCount, 0);
  assert.equal(r.sessionId, null);
  assert.equal(r.phase, null, 'no primary_mode → phase=null');
  assert.equal(r.routerPhase, null);
  assert.equal(r.phaseAdvanced, false);
  assert.equal(r.dayComplete, false);
  assert.equal(r.notesGenerating, false);
  assert.equal(r.depthSignal, 0);
});

test('🛑 buildChatResponsePayload: throws TypeError on non-string content (fail-fast)', () => {
  // Non-string content should fail loudly, NOT silently 200 with bogus data.
  assert.throws(() => buildChatResponsePayload({ content: null }), TypeError);
  assert.throws(() => buildChatResponsePayload({ content: undefined }), TypeError);
  assert.throws(() => buildChatResponsePayload({}), TypeError);
});

test('buildChatResponsePayload: routerPhase fallback chain (fullPatch → priorState → null)', () => {
  const r1 = buildChatResponsePayload({
    content: '', stateForPrompt: {},
    fullPatch: { router_phase: 'cascade_down' },
    priorSessionState: { router_phase: 'elicitation' },
    detectorPatch: {},
  });
  assert.equal(r1.routerPhase, 'cascade_down', 'fullPatch wins');

  const r2 = buildChatResponsePayload({
    content: '', stateForPrompt: {},
    fullPatch: {},
    priorSessionState: { router_phase: 'elicitation' },
    detectorPatch: {},
  });
  assert.equal(r2.routerPhase, 'elicitation', 'priorState fallback');

  const r3 = buildChatResponsePayload({
    content: '', stateForPrompt: {}, fullPatch: {}, priorSessionState: {}, detectorPatch: {},
  });
  assert.equal(r3.routerPhase, null, 'null when both empty');
});

test('🛑 grep guard: chat.js handler body uses buildChatResponsePayload (no inline json)', () => {
  // Belt-and-suspenders. The previous inline body had isPhaseEntry leftover;
  // ensure the handler routes through the tested helper, not an inline object.
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  // Handler returns via buildChatResponsePayload call.
  assert.match(src,
    /return res\.status\(200\)\.json\(buildChatResponsePayload\(/,
    'handler 200 path must call buildChatResponsePayload (Vivi 6/4 regression防線)');
});

test('🛑 grep guard: chat.js has no CODE-USE of retired phase-* symbols (PR-23s4b)', () => {
  // Defends against the exact bug class that shipped in PR-23s4b (isPhaseEntry
  // undefined in 200 payload).
  //
  // Strategy: scan non-comment lines only. A stale comment is informational
  // (e.g., "原 phaseForDay 路徑廢除") and benign; a stale code-use is fatal.
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  const codeOnly = src
    .split('\n')
    .filter(line => !/^\s*\/\//.test(line)          // // comment line
                 && !/^\s*\*/.test(line))            // jsdoc continuation line
    .join('\n');
  assert.doesNotMatch(codeOnly, /\bisPhaseEntry\b/,
    'isPhaseEntry retired with phase-machine (PR-23s4b); never re-introduce');
  assert.doesNotMatch(codeOnly, /\bphaseForDay\b/,
    'phaseForDay retired with phase-advance (PR-23s4b); never re-introduce');
  assert.doesNotMatch(codeOnly, /\bphaseEntryPatch\b/,
    'phaseEntryPatch retired with phase-advance (PR-23s4b); never re-introduce');
  // contextFor (without leading "mode") was the phase-context import.
  assert.doesNotMatch(codeOnly, /(?<![a-zA-Z])contextFor(?![a-zA-Z])/,
    'contextFor retired with phase-context (PR-23s4b); modeContextFor is the replacement');
});

// ═════════════════════════════════════════════════════════
// 🛑 6/8 Vivi v5.2 errata PR-b — generateDamonNote 吃主對話 cached prefix.
// buildDamonNoteSystemArray output structure + cache-share byte-identity guard.
// ═════════════════════════════════════════════════════════

test('🛑 6/8 PR-b: buildDamonNoteTemplateV52 returns a string (week/day deterministic)', () => {
  const t = buildDamonNoteTemplateV52(1, 1);
  assert.equal(typeof t, 'string');
  assert.ok(t.length > 1000, 'template must be substantial (4-step instruction + Damon vocab + guards)');
  // Same week/day → byte-identical output (no Date.now / random).
  const t2 = buildDamonNoteTemplateV52(1, 1);
  assert.equal(t, t2, 'template builder must be deterministic per (week, day)');
});

test('🛑 6/8 PR-b: caching ON → 5 blocks (4 cached + 1 template), breakpoint @ index 3', () => {
  const arr = buildDamonNoteSystemArray({ cachingEnabled: true, week: 1, day: 1 });
  assert.equal(Array.isArray(arr), true);
  assert.equal(arr.length, 5,
    `expected 5 blocks (4 cached + 1 template), got ${arr.length}`);
  // First 4 blocks = cached prefix, with cache_control only on the last (index 3).
  for (let i = 0; i < 4; i++) {
    assert.equal(arr[i].type, 'text', `block[${i}].type must be "text"`);
    if (i < 3) {
      assert.equal(arr[i].cache_control, undefined,
        `block[${i}] must NOT carry cache_control (only breakpoint @ index 3)`);
    } else {
      assert.deepEqual(arr[i].cache_control, { type: 'ephemeral' },
        'block[3] (last cached) must carry cache_control: { type: "ephemeral" } breakpoint');
    }
  }
  // Last block = template (no cache_control).
  assert.equal(arr[4].type, 'text');
  assert.equal(arr[4].cache_control, undefined,
    'template block must NOT carry cache_control (dynamic, post-breakpoint)');
  assert.equal(arr[4].text, buildDamonNoteTemplateV52(1, 1),
    'last block.text === buildDamonNoteTemplateV52(week, day)');
});

test('🛑 6/8 PR-b: caching OFF → 1 block (4 cached merged + template)', () => {
  const arr = buildDamonNoteSystemArray({ cachingEnabled: false, week: 1, day: 1 });
  assert.equal(arr.length, 1, 'OFF path must collapse to 1 block');
  assert.equal(arr[0].type, 'text');
  assert.equal(arr[0].cache_control, undefined,
    'OFF path block must NOT carry cache_control (single merged block, no break)');
  // The merged block must contain all 4 cached contents + template.
  for (const s of CACHED_PREFIX_SECTIONS) {
    assert.ok(arr[0].text.includes(s.content),
      `OFF merged block must contain CACHED_PREFIX_SECTIONS content (length=${s.content.length})`);
  }
  assert.ok(arr[0].text.includes(buildDamonNoteTemplateV52(1, 1)),
    'OFF merged block must contain the template');
});

test('🛑 6/8 PR-b: caching OFF default (no arg) → safe', () => {
  // Missing cachingEnabled defaults to false (no cache structure).
  const arr = buildDamonNoteSystemArray({ week: 1, day: 1 });
  assert.equal(arr.length, 1);
});

test('🛑 6/8 PR-b cache-share guard: 4 cached.text 逐一 === buildSystemPromptArrayV5 前 4 段 (byte-identical → cache 共享)', () => {
  // CORE INVARIANT — if these strings ever diverge, Damon Note's cache won't
  // share with the main chat handler's cache. That would (1) waste tokens,
  // (2) cause cache thrash. Lock byte-identity by direct string compare.
  const damonArr = buildDamonNoteSystemArray({ cachingEnabled: true, week: 1, day: 1 });
  const mainArr  = buildSystemPromptArrayV5({
    sessionState: {}, userProfile: {}, gapDays: 0,
    conditionalInjects: [], cachingEnabled: true,
    activeContext: null,
  });
  // Main chat handler also emits 4 cached + 1 dynamic; first 4 are the cached prefix.
  assert.ok(mainArr.length >= 5,
    `main chat array must be ≥ 5 blocks (4 cached + dynamic); got ${mainArr.length}`);
  for (let i = 0; i < 4; i++) {
    assert.equal(damonArr[i].text, mainArr[i].text,
      `cached block[${i}].text must be byte-identical between Damon Note + main chat (cache share)`);
    // cache_control shape must match too — same breakpoint position.
    assert.deepEqual(damonArr[i].cache_control, mainArr[i].cache_control,
      `cached block[${i}].cache_control must match between Damon Note + main chat`);
  }
});

test('🛑 6/8 PR-b: cached prefix 4 段 = CACHED_PREFIX_SECTIONS map(content) (consume only, no modify)', () => {
  // Sanity: builder consumes the same CACHED_PREFIX_SECTIONS export; never
  // mutates content. Prevents accidental wrapping / re-formatting that would
  // break cache share.
  const arr = buildDamonNoteSystemArray({ cachingEnabled: true, week: 1, day: 1 });
  for (let i = 0; i < 4; i++) {
    assert.equal(arr[i].text, CACHED_PREFIX_SECTIONS[i].content,
      `block[${i}].text must === CACHED_PREFIX_SECTIONS[${i}].content (no wrapping)`);
  }
});

test('🛑 6/8 PR-b: main chat buildSystemPromptArrayV5 behavior unchanged (cached prefix len + breakpoint)', () => {
  // Anti-regression for the main chat handler. The Damon Note PR-b refactor
  // must NOT alter buildSystemPromptArrayV5. Lock 5-block ON path + 1-block OFF.
  const on  = buildSystemPromptArrayV5({
    sessionState: {}, userProfile: {}, gapDays: 0,
    conditionalInjects: [], cachingEnabled: true,
    activeContext: null,
  });
  const off = buildSystemPromptArrayV5({
    sessionState: {}, userProfile: {}, gapDays: 0,
    conditionalInjects: [], cachingEnabled: false,
    activeContext: null,
  });
  assert.equal(on.length, 5, 'ON path: 4 cached + dynamic');
  assert.deepEqual(on[3].cache_control, { type: 'ephemeral' },
    'ON path: breakpoint at index 3 (last cached)');
  assert.equal(off.length, 1, 'OFF path: collapsed single block');
});

// ═════════════════════════════════════════════════════════
// 🛑 6/8 Vivi v5.2 errata PR-c — buildSessionStateSummary + user message inject.
// session_state derived signals summary for Damon Note user message review context.
// ═════════════════════════════════════════════════════════

test('🛑 6/8 PR-c: full session_state → summary 含 mode / transitions / signal counts / R-series / takeaway', () => {
  const sessionState = {
    primary_mode: 'identity_anchoring',
    active_modes: ['identity_anchoring', 'reframe_invitation'],
    paused_modes: ['containment'],
    mode_transition_log: [
      { from_primary: 'elicitation', to_primary: 'identity_anchoring',
        trigger_type: 'learner_surfaced', timestamp: '2026-06-08T...' },
      { from_primary: 'identity_anchoring', to_primary: 'reframe_invitation',
        trigger_type: 'mode_natural_progression', timestamp: '2026-06-08T...' },
    ],
    external_locus_count_this_session: 4,
    passive_hope_count_this_session: 1,
    modal_operator_count_this_session: 7,
    takeaway_term: '可以決定',
  };
  const reframeHistory = [
    { reframe_id: 'R1', session_id: 'sess-1', invoked_at_turn: 3, outcome: 'success' },
    { reframe_id: 'R7', session_id: 'sess-1', invoked_at_turn: 8, outcome: 'partial' },
  ];
  const summary = buildSessionStateSummary(sessionState, reframeHistory);
  // primary / active / paused.
  assert.match(summary, /primary_mode: identity_anchoring/);
  assert.match(summary, /active_modes: \[identity_anchoring, reframe_invitation\]/);
  assert.match(summary, /paused_modes: \[containment\]/);
  // transitions in order.
  assert.match(summary, /mode_transition_log \(2 次轉移\):/);
  assert.match(summary, /elicitation → identity_anchoring \(trigger: learner_surfaced\)/);
  assert.match(summary, /identity_anchoring → reframe_invitation \(trigger: mode_natural_progression\)/);
  // signal counts (only non-zero shown).
  assert.match(summary, /signal_counts_this_session:[^\n]*external_locus: 4/);
  assert.match(summary, /signal_counts_this_session:[^\n]*passive_hope: 1/);
  assert.match(summary, /signal_counts_this_session:[^\n]*modal_operator: 7/);
  // R-series.
  assert.match(summary, /reframe_invocations_this_session: \[R1, R7\]/);
  // takeaway.
  assert.match(summary, /takeaway_term: 「可以決定」/);
  // crisis: 此 fixture 沒 crisis → (無)
  assert.match(summary, /crisis: \(無\)/);
});

test('🛑 6/8 PR-c: empty session_state → summary graceful「(無)」, never throws', () => {
  // Day 1 brand-new session: session_state = {} (no signals yet, no transitions, no R-series).
  const summary = buildSessionStateSummary({}, []);
  assert.match(summary, /primary_mode: \(無\)/);
  assert.match(summary, /active_modes: \(無\)/);
  assert.match(summary, /mode_transition_log: \(無\)/);
  assert.match(summary, /signal_counts_this_session: \(無\)/);
  assert.match(summary, /reframe_invocations_this_session: \(無\)/);
  // takeaway absent → line omitted (not "takeaway_term: (無)").
  assert.doesNotMatch(summary, /takeaway_term:/);
  assert.match(summary, /crisis: \(無\)/);
});

test('🛑 6/8 PR-c: null / undefined / non-object session_state → fail-safe, no throw', () => {
  // Defensive — caller passed bad shape; helper must not crash.
  for (const bad of [null, undefined, 'foo', 42, true, ['array']]) {
    const s = buildSessionStateSummary(bad, null);
    assert.equal(typeof s, 'string', `${String(bad)} input → string output`);
    assert.match(s, /primary_mode: \(無\)/, `${String(bad)} input → safe fallback`);
  }
});

test('🛑 6/8 PR-c: malformed transitions / non-array signal keys → skip silently (fail-open)', () => {
  const summary = buildSessionStateSummary({
    primary_mode: 'elicitation',
    active_modes: 'not-an-array',                       // wrong shape
    mode_transition_log: [
      { from_primary: 'a', to_primary: 'b', trigger_type: 'learner_surfaced' },
      null,                                              // bad entry
      'string-entry',                                    // bad entry
      { /* missing keys */ },
      { from_primary: 'c', to_primary: 'd', trigger_type: 'ai_initiated' },
    ],
    external_locus_count_this_session: 'not-a-number',  // junk
    passive_hope_count_this_session: 2,
  }, 'not-an-array-rh');
  // active_modes wrong shape → "(無)"
  assert.match(summary, /active_modes: \(無\)/);
  // 5 transitions logged but bad ones rendered as "? → ?" or skipped null/strings.
  assert.match(summary, /mode_transition_log \(5 次轉移\):/);
  assert.match(summary, /a → b \(trigger: learner_surfaced\)/);
  assert.match(summary, /c → d \(trigger: ai_initiated\)/);
  // bad numeric key → not in summary (Number('not-a-number') = NaN, falsy).
  assert.doesNotMatch(summary, /external_locus/);
  assert.match(summary, /passive_hope: 2/);
  // reframe history non-array → "(無)"
  assert.match(summary, /reframe_invocations_this_session: \(無\)/);
});

test('🛑 6/8 PR-c: crisis_in_progress + sop_state + carry_forward → 全部 surface', () => {
  const summary = buildSessionStateSummary({
    crisis_in_progress: true,
    crisis_sop_state: { current_step: 4, awaiting: 'handoff_ack' },
    crisis_state_carry_forward_pending_write: { reason: 'passive_dw' },
  }, []);
  assert.match(summary, /crisis: in_progress, sop_step=4, carry_forward_pending/);
});

test('🛑 6/8 PR-c: crisis closure (sop_complete=true) → marked as complete', () => {
  const summary = buildSessionStateSummary({
    crisis_sop_state: { current_step: 8, awaiting: null, closure_explicit: true },
    crisis_sop_complete: true,
    crisis_in_progress: false,    // released by closure
    primary_mode: null,
  }, []);
  assert.match(summary, /crisis:.*sop_step=8 \(complete\)/);
});

test('🛑 6/8 PR-c: reframe_invocation_history entries with missing reframe_id → skip silently', () => {
  const summary = buildSessionStateSummary({}, [
    { reframe_id: 'R3', session_id: 's' },
    null,
    { /* no reframe_id */ session_id: 's' },
    { reframe_id: 'R10', session_id: 's' },
  ]);
  assert.match(summary, /reframe_invocations_this_session: \[R3, R10\]/);
});

test('🛑 6/8 PR-c: signal counts of 0 NOT shown (only positive counts surface)', () => {
  const summary = buildSessionStateSummary({
    external_locus_count_this_session: 0,
    passive_hope_count_this_session: 0,
    modal_operator_count_this_session: 3,
  }, []);
  // Only modal_operator: 3 should appear.
  assert.match(summary, /signal_counts_this_session: modal_operator: 3/);
  assert.doesNotMatch(summary, /external_locus/);
  assert.doesNotMatch(summary, /passive_hope/);
});

// ─── Source-grep: summary inject wired into user message ───────────

test('🛑 6/8 PR-c source-grep: generateDamonNote SELECTs session_state BEFORE the AI call', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  // Locate generateDamonNote body, ensure the new SELECT is before messages.create.
  const fnStart = src.indexOf('export async function generateDamonNote');
  const fnEnd   = src.indexOf('export async function generateNotebookPage');
  assert.ok(fnStart > 0 && fnEnd > fnStart);
  const fn = src.slice(fnStart, fnEnd);
  const selectIdx = fn.indexOf('SELECT session_state, student_id FROM sessions WHERE id =');
  const aiCallIdx = fn.indexOf('await getAnthropic().messages.create(');
  assert.ok(selectIdx > 0, 'session_state SELECT must be present in generateDamonNote');
  assert.ok(aiCallIdx > selectIdx,
    'session_state SELECT must come BEFORE the AI messages.create call');
});

test('🛑 6/8 PR-c source-grep: generateDamonNote SELECTs reframe_invocation_history (filtered to this session)', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  assert.match(src, /SELECT reframe_invocation_history FROM user_profile_evolution/);
  // Filter by session_id === current sessionId — "本場" semantic.
  assert.match(src, /history\.filter\([\s\S]{0,200}e\.session_id === sessionId/);
});

test('🛑 6/8 PR-c source-grep: user message content carries the summary block with derived signals header', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  // The summary block uses a clear header marking it as derived signals,
  // distinct from the conversation transcript.
  assert.match(src, /【session 訊號摘要 \(derived signals、給教練 review、非學員逐字語料\)】/);
  // Summary inserted in user message content.
  assert.match(src, /content: `模組：\$\{moduleLabel\}，Day \$\{day\}（共 21 天）。\s*\n\s*\n【session 訊號摘要/);
  // Summary inserted BEFORE conversationText (review context first, then 逐字).
  const contentBlockMatch = src.match(
    /content: `模組：[\s\S]*?請寫下今天的教練筆記。`/,
  );
  assert.ok(contentBlockMatch, 'user message content block must be locatable');
  const idxSummary = contentBlockMatch[0].indexOf('【session 訊號摘要');
  const idxConvo   = contentBlockMatch[0].indexOf('${conversationText}');
  assert.ok(idxSummary > 0 && idxConvo > idxSummary,
    'summary block must come BEFORE conversationText interpolation');
});

test('🛑 6/8 PR-c source-grep: fail-open on session_state + reframe history read failures (never throws)', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  // session_state SELECT wrapped in try/catch with structured warn.
  // (Generous regex limits because Windows CRLF + multi-line SQL templates.)
  assert.match(src,
    /try \{[\s\S]{0,600}SELECT session_state, student_id[\s\S]{0,600}\} catch \([\s\S]{0,200}\) \{[\s\S]{0,400}session_state fetch failed \(fail-open\)/);
  // reframe history SELECT wrapped in try/catch with structured warn.
  assert.match(src,
    /try \{[\s\S]{0,800}SELECT reframe_invocation_history[\s\S]{0,800}\} catch \([\s\S]{0,200}\) \{[\s\S]{0,400}reframe_invocation_history fetch failed \(fail-open\)/);
});

// ─── Don't-touch confirmations ───────────────────────────────────

test('🛑 6/8 PR-c: system prompt 結構 untouched (PR-a template + PR-b cache structure 0 regression)', () => {
  // template still in buildDamonNoteTemplateV52.
  const t = buildDamonNoteTemplateV52(1, 1);
  // PR-a verbatim landmarks all still present (sanity).
  assert.match(t, /【關鍵句】/);
  assert.match(t, /【應 invoke 但未 invoke 的技術】/);
  assert.match(t, /R1 Reclaim Source/);
  // PR-b cache structure: ON 5 / OFF 1.
  const on  = buildDamonNoteSystemArray({ cachingEnabled: true, week: 1, day: 1 });
  const off = buildDamonNoteSystemArray({ cachingEnabled: false, week: 1, day: 1 });
  assert.equal(on.length, 5);
  assert.equal(off.length, 1);
});

test('🛑 6/8 PR-c → PR-d retained: generateNotebookPage sharp variant 框架 (sharp/gentle 安全牆)', () => {
  // PR-c PR retained generateNotebookPage 0-diff. PR-d 動了 prompt 內容 (§2 對齊)
  // 但 sharp variant 兩個核心 landmark + 函式仍在.
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  assert.match(src, /async function generateNotebookPage\(/);
  assert.match(src, /身份規則 \/ 隱性信念/);      // sharp variant 核心
  assert.match(src, /不舒服 = 工具/);              // sharp variant 框架
});

test('🛑 6/8 PR-c: 鐵律#2 — buildSessionStateSummary never logs (pure function, no console.*)', () => {
  // Helper is pure — no DB I/O, no console.* call. Test by source-greping the function body.
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  const fnStart = src.indexOf('export function buildSessionStateSummary');
  const fnEnd   = src.indexOf('export async function generateDamonNote');
  assert.ok(fnStart > 0 && fnEnd > fnStart);
  const fn = src.slice(fnStart, fnEnd);
  assert.ok(!/console\./.test(fn),
    'buildSessionStateSummary must not log (鐵律#2: derived signals are summary-only, never side-channel-logged)');
});

// ═════════════════════════════════════════════════════════
// 🛑 6/8 Vivi v5.2 errata PR-d (§2 + §7 + §8) — generateNotebookPage v5.2 對齊.
// 學員直接讀的「✦ 我看見的」教練卡 prompt → 對齊 spec §2.1 / §2.2 + §7 決策 A 合併
// (保留犀利 + crisis gate, 織入概念中文化命名, 丟兩層緩衝) + §8 anchor 當 AI context.
// ═════════════════════════════════════════════════════════

// Source slice helper — locate the generateNotebookPage function body.
function _notebookFnBody() {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  const start = src.indexOf('export async function generateNotebookPage');
  assert.ok(start > 0, 'generateNotebookPage must be present');
  // Ends at the closing `}` before next export (none after); use a generous slice.
  return src.slice(start);
}

// ─── A1. Signature: accept activeContextName / activeContextDefinition ─────

test('🛑 6/8 PR-d signature: generateNotebookPage accepts activeContextName + activeContextDefinition', () => {
  const fn = _notebookFnBody();
  // Signature now: (sql, sessionId, module, fullNote, yesterdaySCHypothesis,
  //                 preferredName = null, wasCrisis = false,
  //                 activeContextName = null, activeContextDefinition = null)
  assert.match(fn, /async function generateNotebookPage\([^)]*activeContextName\s*=\s*null\s*,\s*activeContextDefinition\s*=\s*null/);
});

test('🛑 6/8 PR-d caller: generateDamonNote passes activeContextName + activeContextDefinition through', () => {
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  // The call site must pass the 2 anchor fields (already fetched in PR-a §8.1).
  assert.match(src, /generateNotebookPage\([\s\S]{0,400}activeContextName, activeContextDefinition/);
});

// ─── A2. Crisis gate non-regression (最重要) ──────────────────────

test('🛑 6/8 PR-d: crisis gate 不回歸 — wasCrisis=true → gentle seeingSection + cap 350', () => {
  const fn = _notebookFnBody();
  // Gentle variant 必加緩衝詞 + 80 字 + crisis warning.
  assert.match(fn, /緩衝詞必加:可能、可能不是、猜想/);
  assert.match(fn, /約 80 字/);
  assert.match(fn, /本場次曾觸發 crisis SOP[\s\S]{0,80}保持溫和緩衝、不要犀利點破身份規則/);
  // ⭐ PR-d added: crisis branch 保守不動 (不命名 Damon 概念).
  assert.match(fn,
    /crisis 場保守不動 — 不深入 Damon 概念命名 \(中文化或英文都不要\)/);
  // Length cap ternary: wasCrisis ? 350 : 430.
  assert.match(fn, /totalLengthCap\s*=\s*wasCrisis\s*\?\s*350\s*:\s*430/);
});

test('🛑 6/8 PR-d: crisis gate 不回歸 — wasCrisis=false → sharp + cap 430', () => {
  const fn = _notebookFnBody();
  // Sharp landmarks must all survive (verbatim from ea53d6d).
  assert.match(fn, /身份規則 \/ 隱性信念/);
  assert.match(fn, /反例\(太溫、不要\)/);
  assert.match(fn, /正解\(夠利、要這樣\)/);
  assert.match(fn, /不舒服 = 工具/);
  assert.match(fn, /別急著推開/);
  assert.match(fn, /醍醐灌頂/);
  assert.match(fn, /約 120-160 字/);
});

test('🛑 6/8 PR-d: default wasCrisis (no arg) treated as sharp (non-crisis)', () => {
  const fn = _notebookFnBody();
  // Default false in signature.
  assert.match(fn, /async function generateNotebookPage\([^)]*wasCrisis\s*=\s*false/);
});

// ─── A3. §2.1 Chinese concept naming present (woven into sharp variant) ─────

test('🛑 6/8 PR-d §2.1: 中文化對照表 verbatim in sharp seeingSection', () => {
  const fn = _notebookFnBody();
  // 5 pairs from spec §2.1, verbatim per Patrick's source-of-truth table.
  assert.match(fn, /交換邏輯 \/ 補償邏輯[\s\S]{0,80}The Bargain/);
  assert.match(fn, /完美主義陷阱 \/ 追求極致狀態[\s\S]{0,80}Perfectionism Trap/);
  assert.match(fn, /策略 vs 你是誰 \/ 做什麼 vs 是什麼[\s\S]{0,80}Strategy vs Quality/);
  assert.match(fn, /源頭在外面 \/ 等別人 \/ 等條件給你[\s\S]{0,80}External Locus/);
  assert.match(fn, /你就是源頭 \/ 你內在的資源[\s\S]{0,80}Reclaim Source/);
});

test('🛑 6/8 PR-d §2.1: 不准寫英文體系名 — 每對配對都帶 explicit「不准寫 X」 禁令', () => {
  const fn = _notebookFnBody();
  // Each English brand name must be explicitly forbidden inline with its
  // Chinese translation (so AI sees the rule next to the mapping).
  assert.match(fn, /不准寫 Bargain/);
  assert.match(fn, /不准寫 Perfectionism Trap/);
  assert.match(fn, /不准寫 Strategy vs Quality/);
  assert.match(fn, /不准寫 External Locus/);
  assert.match(fn, /不准寫 Reclaim Source/);
});

// ─── A4. Rule 3 blanket buffer dropped + replaced with distinction ─────────

test('🛑 6/8 PR-d: Rule 3 blanket「緩衝詞必加」全域 已廢 (改成命名不緩衝 / 推測緩衝)', () => {
  const fn = _notebookFnBody();
  // Rule 3 must NOT still read「SC 觀察用『可能』『猜想』緩衝、不斷定」 as an
  // unqualified blanket. New Rule 3 is the §2.1 distinction.
  assert.doesNotMatch(fn,
    /3\.\s*SC 觀察用「可能」「猜想」緩衝、不斷定\s*\(本規則僅 wasCrisis=溫和場適用/,
    'old blanket buffer Rule 3 must be gone (replaced by §2.1 distinction)');
  // New Rule 3 verbiage present.
  assert.match(fn, /3\.\s*緩衝詞分流 \(§2\.1[\s\S]{0,200}取代舊 blanket/);
  // The 4 sub-rules: 不緩衝 (事實 + Damon 命名) / 緩衝 (SC 推測 + 心理結構).
  assert.match(fn, /❌ 不緩衝: 學員 surface 的事實/);
  assert.match(fn, /❌ 不緩衝: Damon 體系明確命名 \(中文化/);
  assert.match(fn, /✅ 緩衝: SC 推測/);
  assert.match(fn, /✅ 緩衝且極少用: 心理結構 \/ 家庭關係/);
  // Crisis carve-out 明確留: crisis 溫和緩衝仍在.
  assert.match(fn,
    /crisis 場 \(wasCrisis=true\)[\s\S]{0,200}整個「我看見的」段保持溫和緩衝/);
});

// ─── A5. Main narrative psych-analysis language gone ───────────────────────

test('🛑 6/8 PR-d §2.2: 主敘事 framing 不再寫「但你繞過去了」「你沒進去」(心理分析 framing 廢)', () => {
  const fn = _notebookFnBody();
  // The OLD bullet「含『還沒碰到的』(用『但你繞過去了』『你沒進去』...」 must be gone.
  // We allow these phrases to appear ONLY in a 「⛔ 廢」 negative-example context.
  // Strategy: locate main-narrative spec lines and check none POSITIVELY instruct
  // those phrases.
  assert.doesNotMatch(fn,
    /含「還沒碰到的」\(用「但你繞過去了」「你沒進去」/,
    'old positive instruction「(用『但你繞過去了』『你沒進去』...)」 must be gone');
  // Sober replacement present.
  assert.match(fn,
    /含「還沒碰到的」\(用「今天還有 X 沒展開」「明天我們從這裡繼續」這種 sober 敘事帶出/);
  // Explicit ⛔ 廢 negative example present (so AI sees the bad framing as forbidden).
  assert.match(fn, /⛔ 廢「但你繞過去了」「你沒進去」/);
});

test('🛑 6/8 PR-d §2.2: 主敘事 不再寫「你碰到了一個層次的邊」Layer framing', () => {
  const fn = _notebookFnBody();
  // OLD bullet「含『層次』描述(『你碰到了一個層次的邊』...」 must be gone as positive instruction.
  assert.doesNotMatch(fn,
    /含「層次」描述\(「你碰到了一個層次的邊」/,
    'old「層次的邊」 Layer framing instruction must be gone');
  // Sober replacement.
  assert.match(fn,
    /含「今天到了哪裡」sober 描述\(別暗示「碰到層次的邊」這種 Layer framing/);
});

// ─── A6. §8 active_context anchor: AI context, NEVER printed ───────────────

test('🛑 6/8 PR-d §8: activeContextHint built only when name is non-empty string', () => {
  const fn = _notebookFnBody();
  // const activeContextHint = (typeof activeContextName === 'string' && length > 0) ? ... : ''
  assert.match(fn,
    /const activeContextHint = \(typeof activeContextName === ['"]string['"] && activeContextName\.length > 0\)\s*\n?\s*\?\s*`[\s\S]{0,200}AI context \(不要印給學員看\)[\s\S]{0,200}\$\{activeContextName\}/);
  // Empty / missing → '' empty string (no line added).
  assert.match(fn,
    /const activeContextHint = \(typeof activeContextName[\s\S]{0,400}:\s*['"]['"]/);
});

test('🛑 6/8 PR-d §8: anchor 「絕不印 --- 聚焦 --- 區塊」 explicit ban (兩處 — hint 內 + Rule 10)', () => {
  const fn = _notebookFnBody();
  // Inside the hint itself: 「絕不在卡片頂部 / 任何位置印『--- 聚焦 ---』或『--- 範圍 ---』區塊」
  assert.match(fn,
    /絕不在卡片頂部 \/ 任何位置印「--- 聚焦 ---」或「--- 範圍 ---」區塊/);
  // Rule 10 double-safety: 禁止印「--- 聚焦 ---」「--- 範圍 ---」 anchor 區塊.
  assert.match(fn,
    /禁止印「--- 聚焦 ---」「--- 範圍 ---」 anchor 區塊 \(active_context 只當 AI context、不印\)/);
});

// ─── A7. Student-facing leak guards (Rule 10 expanded) ─────────────────────

test('🛑 6/8 PR-d Rule 10: 5 v3.3 + 5 v5.2 Damon Note section markers 全擋 + 工具/Layer/池 全擋', () => {
  const fn = _notebookFnBody();
  // Rule 10 enumeration must cover EVERY section name the AI might know about.
  // v3.3 section markers from the historical FORBIDDEN_SECTION_MARKERS.
  for (const m of ['【SC 觀察】', '【深度層次】', '【還沒碰到的】',
                    '【明天的入口】', '【關鍵句】']) {
    assert.ok(fn.includes(m), `Rule 10 must enumerate「${m}」 (v3.3 section)`);
  }
  // v5.2 PR-a section markers — newly added to Rule 10 by PR-d.
  for (const m of ['【Mode 軌跡】', '【應 invoke 但未 invoke 的技術】',
                    '【Day 1-N 採集追蹤】', '【active_context】',
                    '【sc_step_when_generated】']) {
    assert.ok(fn.includes(m), `Rule 10 must enumerate「${m}」 (v5.2 PR-a section)`);
  }
  // Tools / Layer / pool ban retained.
  assert.match(fn, /禁止「工具一\/二\/三\/四」/);
  assert.match(fn, /禁止「Layer 1-5 \/ L1-L5」/);
  assert.match(fn, /禁止「2A SC 池 \/ 2B Reactive 池 \/ 2C Belief 池」/);
});

test('🛑 6/8 PR-d Rule 10: 英文體系名 5 個 (Bargain / Perfectionism Trap / Strategy vs Quality / External Locus / Reclaim Source) 全擋', () => {
  const fn = _notebookFnBody();
  // Rule 10 must explicitly ban these English brand names (student-facing card).
  assert.match(fn,
    /禁止英文體系名:\s*Bargain \/ Perfectionism Trap \/ Strategy vs Quality \/ External Locus \/[\s\S]{0,40}Reclaim Source/);
});

// ─── A8. Don't-touch confirmations ─────────────────────────────────────────

test('🛑 6/8 PR-d: PR-a Damon Note template 0-byte content drift (verbatim §1.1-§1.5 / §8.1 / §9.1 全綠)', () => {
  // PR-a template content lives in buildDamonNoteTemplateV52 — must remain verbatim.
  const t = buildDamonNoteTemplateV52(1, 1);
  // Sample of §1.3 verbatim landmarks (full set covered by PR-a sync-gates).
  assert.match(t, /External Locus of Control \(外部控制點\)/);
  assert.match(t, /The Bargain \(交易幻覺、紅線 23\)/);
  assert.match(t, /R12 Hero's Welcome \(英雄式歡迎 5 步驟 SOP/);
});

test('🛑 6/8 PR-d: PR-b cache structure 0 regression (ON 5 / OFF 1 / cache-share guard)', () => {
  const on  = buildDamonNoteSystemArray({ cachingEnabled: true, week: 1, day: 1 });
  const off = buildDamonNoteSystemArray({ cachingEnabled: false, week: 1, day: 1 });
  assert.equal(on.length, 5);
  assert.equal(off.length, 1);
  assert.deepEqual(on[3].cache_control, { type: 'ephemeral' });
});

test('🛑 6/8 PR-d: PR-c session_state summary helper 0 regression', () => {
  // Helper still works, fail-safe still in place.
  assert.equal(typeof buildSessionStateSummary({}, []), 'string');
  assert.match(buildSessionStateSummary({}, []), /primary_mode: \(無\)/);
});

test('🛑 6/8 PR-d: §8.1 Damon Note anchor 前置注入 邏輯 0 改變 (PR-a active_context anchor)', () => {
  // The activeContextAnchor / scStepPlaceholder / fullNote assembly INSIDE
  // generateDamonNote is the Damon Note anchor, not the card anchor. PR-d
  // must NOT touch it. Locate + verify shape unchanged.
  const src = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), 'chat.js'),
    'utf8',
  );
  assert.match(src, /const activeContextAnchor\s*=\s*\n?\s*`---\\n`[\s\S]{0,80}`【active_context】\\n`/);
  assert.match(src, /const scStepPlaceholder\s*=\s*\n?\s*`---\\n`[\s\S]{0,80}`【sc_step_when_generated】\\n`/);
  assert.match(src,
    /const fullNote = `\$\{activeContextAnchor\}\\n\$\{scStepPlaceholder\}\\n\$\{bodyMinusAnchors\}`/);
});

test('🛑 6/8 PR-d: 禁用詞 + 簽名 V + 第二人稱「你」 + 不寫「她/他」 全保留', () => {
  const fn = _notebookFnBody();
  // Forbidden words list still complete (5 items).
  assert.match(fn,
    /不寫禁用詞\(加油、你已經很努力了、擁抱自己、成為更好的自己、跟著做就會、立刻改變人生\)/);
  // Sign V (not Damon).
  assert.match(fn, /— V\s/);
  assert.match(fn, /不簽 Damon 名字、不寫「Damon Cart」/);
  // Second-person 「你」 + no gender.
  assert.match(fn, /整篇用「你」、不寫「她」「他」「她\/他」雙視角/);
  assert.match(fn, /不假設學員的性別/);
  // preferredName 0-1 次 nameHint.
  assert.match(fn, /整篇 0-1 次自然帶過/);
});

// ═════════════════════════════════════════════════════════════════
// 🛑 v5.2 七步 PR-4 Path A — sc_journey evidence detector + DB helper
// Patrick 6/11 grounded mapping (signal-only, NO raw text match).
// ═════════════════════════════════════════════════════════════════

// ─── Empty / null inputs → empty result ─────────────────────────

test('🛑 PR-4 detect: empty inputs → no entries', () => {
  assert.deepEqual(detectScJourneyEvidenceForTurn(), []);
  assert.deepEqual(detectScJourneyEvidenceForTurn({}), []);
  assert.deepEqual(detectScJourneyEvidenceForTurn({
    primaryMode: 'elicitation',
    prevSessionState: {},
    detectorPatch: {},
    conditionalInjects: [],
  }), []);
});

// ─── step_2 longing_surface ─────────────────────────────────────

test('🛑 PR-4 detect step_2 longing: new current_quality_candidate_term this turn → entry', () => {
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'elicitation',
    prevSessionState: { current_quality_candidate_term: null },
    detectorPatch:    { current_quality_candidate_term: '勇敢' },
    conditionalInjects: [],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].step, 2);
  assert.equal(out[0].type, 'longing_surface');
  assert.equal(out[0].quote, '勇敢',
    'quote = structured candidate term (NOT raw user text)');
});

test('🛑 PR-4 detect step_2: same candidate as prev turn → NO entry (delta only)', () => {
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'elicitation',
    prevSessionState: { current_quality_candidate_term: '勇敢' },
    detectorPatch:    { current_quality_candidate_term: '勇敢' },
    conditionalInjects: [],
  });
  assert.equal(out.length, 0);
});

// ─── step_3 data_mining ─────────────────────────────────────────

test('🛑 PR-4 detect step_3 data_mining: R3 fired in elicitation mode → entry', () => {
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'elicitation',
    prevSessionState: { reframe_invocation_history_in_session: [], top1_value: '勇敢' },
    detectorPatch: {
      reframe_invocation_history_in_session: [{ reframe_id: 'R3', invoked_at_turn: 1 }],
    },
    conditionalInjects: [],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].step, 3);
  assert.equal(out[0].type, 'data_mining');
  assert.equal(out[0].ai_internal_note, 'AI 觀察');
});

test('🛑 PR-4 detect step_3: R3 fired but mode=integration → NO entry (mode gate)', () => {
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'integration',
    prevSessionState: {},
    detectorPatch: { reframe_invocation_history_in_session: [{ reframe_id: 'R3' }] },
    conditionalInjects: [],
  });
  assert.equal(out.length, 0, 'R3 outside elicitation/identity_anchoring mode does not trigger step_3');
});

// ─── step_4 identity_claim (3 paths) ────────────────────────────

test('🛑 PR-4 detect step_4: R2 命中 → entry', () => {
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'identity_anchoring',
    prevSessionState: { reframe_invocation_history_in_session: [] },
    detectorPatch: { reframe_invocation_history_in_session: [{ reframe_id: 'R2' }] },
    conditionalInjects: [],
  });
  const e = out.find(x => x.step === 4);
  assert.ok(e);
  assert.equal(e.type, 'identity_claim');
});

test('🛑 PR-4 detect step_4: new top1_value → entry (quote=top1_value)', () => {
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'identity_anchoring',
    prevSessionState: { top1_value: null },
    detectorPatch:    { top1_value: '勇敢' },
    conditionalInjects: [],
  });
  const e = out.find(x => x.step === 4);
  assert.ok(e);
  assert.equal(e.quote, '勇敢',
    'quote source preference = newly-set top1_value');
});

test('🛑 PR-4 detect step_4: quality_status flipped to owned → entry', () => {
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'identity_anchoring',
    prevSessionState: { current_quality_status: 'candidate', top1_value: '勇敢' },
    detectorPatch:    { current_quality_status: 'owned' },
    conditionalInjects: [],
  });
  const e = out.find(x => x.step === 4);
  assert.ok(e);
});

test('🛑 PR-4 detect step_4: quality_status owned but ALREADY owned previously → NO entry (delta only)', () => {
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'identity_anchoring',
    prevSessionState: { current_quality_status: 'owned', top1_value: '勇敢' },
    detectorPatch:    { current_quality_status: 'owned' },
    conditionalInjects: [],
  });
  assert.equal(out.length, 0);
});

// ─── step_5 resource_retrieval ──────────────────────────────────

test('🛑 PR-4 detect step_5: Hero\'s Welcome SYSTEM INJECT header in conditionalInjects → entry', () => {
  const HW = `[SYSTEM INJECT — R12 Hero's Welcome 4 步驟 SOP (Vivi 在地化版)]\nmode: integration.\n...`;
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'integration',
    prevSessionState: {},
    detectorPatch: {},
    conditionalInjects: [HW],
  });
  const e = out.find(x => x.step === 5);
  assert.ok(e);
  assert.equal(e.type, 'resource_retrieval');
  assert.equal(e.ai_internal_note, 'submodality shift detected');
});

test('🛑 PR-4 detect step_5: R5 OR R6 reframe → entry', () => {
  for (const id of ['R5', 'R6']) {
    const out = detectScJourneyEvidenceForTurn({
      primaryMode: 'integration',
      prevSessionState: { reframe_invocation_history_in_session: [] },
      detectorPatch: { reframe_invocation_history_in_session: [{ reframe_id: id }] },
      conditionalInjects: [],
    });
    const e = out.find(x => x.step === 5);
    assert.ok(e, `${id} should fire step_5`);
  }
});

// ─── step_6 sovereignty_reclaim ─────────────────────────────────

test('🛑 PR-4 detect step_6: R1 命中 (R1_VARIANTS 含 R1_E) → entry', () => {
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'integration',
    prevSessionState: { reframe_invocation_history_in_session: [] },
    detectorPatch: { reframe_invocation_history_in_session: [{ reframe_id: 'R1' }] },
    conditionalInjects: [],
  });
  const e = out.find(x => x.step === 6);
  assert.ok(e);
  assert.equal(e.type, 'sovereignty_reclaim');
  assert.equal(e.ai_internal_note, 'external→internal shift detected');
});

test('🛑 PR-4 anti-regression: step_6 走 reframe_id=R1, 不誤抓 R1_E inject header', () => {
  // Patrick 地雷②: 沒有 R1_E sub-prompt inject. Detector 必須只看 reframe_id.
  const fakeR1EHeader = `[SYSTEM INJECT — R1_E 重要的人延伸層]\n...`;
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'integration',
    prevSessionState: {},
    detectorPatch: {},
    conditionalInjects: [fakeR1EHeader],
  });
  assert.equal(out.length, 0,
    'R1_E header substring must NOT trigger step_6 (we route via reframe_id only)');
});

// ─── step_7 anchoring ───────────────────────────────────────────

test('🛑 PR-4 detect step_7: Let it Go inject header → entry', () => {
  const letItGo = `[SYSTEM INJECT — Phase 5 Step 2: Let it Go]\nDamon 體系內...`;
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'future_pacing',
    prevSessionState: {},
    detectorPatch: {},
    conditionalInjects: [letItGo],
  });
  const e = out.find(x => x.step === 7);
  assert.ok(e);
  assert.equal(e.type, 'anchoring');
});

test('🛑 PR-4 detect step_7: Care Less List inject header → entry', () => {
  const careLess = `[SYSTEM INJECT — Care Less List Optional Exercise (Vivi 終審版逐字、Mode 5 step 4)]`;
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'future_pacing',
    prevSessionState: {},
    detectorPatch: {},
    conditionalInjects: [careLess],
  });
  const e = out.find(x => x.step === 7);
  assert.ok(e);
});

test('🛑 PR-4 detect step_7: R7 reframe → entry', () => {
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'future_pacing',
    prevSessionState: { reframe_invocation_history_in_session: [] },
    detectorPatch: { reframe_invocation_history_in_session: [{ reframe_id: 'R7' }] },
    conditionalInjects: [],
  });
  const e = out.find(x => x.step === 7);
  assert.ok(e);
});

// ─── step_1 intentional gap ─────────────────────────────────────

test('🛑 PR-4 detect step_1 INTENTIONAL gap: elicitation mode + no candidate → NO entry', () => {
  // Patrick: "step_1 pain_surface — 無乾淨結構化 signal, 容許不 append.
  //  品質 > 覆蓋率, 16 場 sim coverage 再補."
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'elicitation',
    prevSessionState: {},
    detectorPatch: {},
    conditionalInjects: [],
  });
  assert.equal(out.length, 0,
    'PR-4 intentionally has no step_1 detection; 16 場 sim coverage will inform whether to backfill');
});

// ─── Reframe history DELTA detection ────────────────────────────

test('🛑 PR-4 detect: only NEW reframe entries this turn fire (not historic)', () => {
  // Historic R1 (already in prev) + new R2 this turn → only R2 fires.
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'identity_anchoring',
    prevSessionState: {
      reframe_invocation_history_in_session: [{ reframe_id: 'R1', invoked_at_turn: 1 }],
    },
    detectorPatch: {
      reframe_invocation_history_in_session: [
        { reframe_id: 'R1', invoked_at_turn: 1 },  // unchanged prefix
        { reframe_id: 'R2', invoked_at_turn: 2 },  // new this turn
      ],
    },
    conditionalInjects: [],
  });
  // R2 → step_4 entry; R1 should NOT trigger step_6 again (already counted last turn).
  assert.ok(out.find(x => x.step === 4), 'new R2 fires step_4');
  assert.equal(out.find(x => x.step === 6), undefined, 'historic R1 must NOT re-fire step_6');
});

// ─── Quote source = structured (NEVER raw user text) ────────────

test('🛑 PR-4 safety: ALL quote sources are structured terms, NEVER raw user text', () => {
  // Build a "rich" turn where ALL 6 detectable steps fire (skip step_1 by design).
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'identity_anchoring',
    prevSessionState: {
      current_quality_candidate_term: null,
      top1_value: null,
      current_quality_status: 'candidate',
      reframe_invocation_history_in_session: [],
    },
    detectorPatch: {
      current_quality_candidate_term: '勇敢',
      top1_value: '勇敢',
      current_quality_status: 'owned',
      reframe_invocation_history_in_session: [
        { reframe_id: 'R2' }, { reframe_id: 'R3' },
        { reframe_id: 'R5' }, { reframe_id: 'R1' }, { reframe_id: 'R7' },
      ],
    },
    conditionalInjects: [],
  });
  // Every entry's quote must be one of:
  //   - null
  //   - structured candidate term / top1_value
  //   - deriveTakeawayTerm output (which is itself structured)
  for (const e of out) {
    if (e.quote !== null && typeof e.quote === 'string') {
      // Quote must NOT contain raw conversational markers / pronouns etc.
      // It must be a concise term (≤ 30 chars typically).
      assert.ok(e.quote.length <= 50,
        `step ${e.step} quote should be a short structured term, got: "${e.quote}"`);
      // No conversational verbose patterns (rough heuristic).
      assert.equal(/我覺得我|不知道為什麼|想說|其實/.test(e.quote), false,
        `step ${e.step} quote looks like raw user phrasing: "${e.quote}"`);
    }
  }
});

// ─── Defence-in-depth high-risk denylist ────────────────────────

test('🛑 PR-4 safety: high-risk quote → entry DROPPED (defence-in-depth)', () => {
  // Hypothetical bad upstream: candidate term somehow contains 自殺 phrasing.
  // Detector must filter to prevent accidental DB write.
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'elicitation',
    prevSessionState: { current_quality_candidate_term: null },
    detectorPatch:    { current_quality_candidate_term: '想自殺' },
    conditionalInjects: [],
  });
  assert.equal(out.length, 0,
    'high-risk phrasing must trigger drop, even if structured upstream');
});

test('🛑 PR-4 safety: high-risk only drops the offending entry when quote source is independent', () => {
  // Mixed batch: tainted candidate (high-risk) WITH an independent clean
  // top1_value already set (step_4 pulls top1 first, NOT the tainted candidate).
  // ⚠️ Note: if a high-risk term enters effectiveState as the ONLY quote source,
  //   ALL derived entries get dropped (defence-in-depth POLLUTION model — see
  //   companion test above). That's intentional safe behavior.
  const out = detectScJourneyEvidenceForTurn({
    primaryMode: 'identity_anchoring',
    prevSessionState: {
      current_quality_candidate_term: null,
      top1_value: '勇敢',                        // already-set clean top1
      current_quality_status: 'candidate',
      reframe_invocation_history_in_session: [],
    },
    detectorPatch: {
      current_quality_candidate_term: '想去死',   // high-risk new candidate this turn
      current_quality_status: 'owned',           // triggers step_4 (independent of candidate)
      reframe_invocation_history_in_session: [],
    },
    conditionalInjects: [],
  });
  // step_4 uses top1_value='勇敢' (clean, from prev state) → survives.
  // step_2 uses the tainted candidate term as its own quote → dropped.
  const e4 = out.find(x => x.step === 4);
  assert.ok(e4, 'clean step_4 (top1=勇敢) survives');
  assert.equal(e4.quote, '勇敢',
    'step_4 quote = clean top1_value, NOT the tainted candidate');
  assert.equal(out.find(x => x.step === 2), undefined, 'tainted step_2 dropped');
});

// ─── appendScJourneyEvidence SQL shape ──────────────────────────

test('🛑 PR-4 append: SQL uses jsonb_set on keyed object, COALESCE for legacy NULL', async () => {
  const calls = [];
  const sql = (strings, ...values) => {
    calls.push({ text: strings.join('?'), values });
    return Promise.resolve([]);
  };
  await appendScJourneyEvidence(sql, 'A001', 4, {
    type: 'identity_claim',
    quote: '勇敢',
  });
  assert.equal(calls.length, 1);
  const text = calls[0].text;
  assert.match(text, /UPDATE students/);
  assert.match(text, /sc_journey_evidence\s*=\s*jsonb_set/);
  // Migration 037 default skeleton present (defence-in-depth on legacy NULL).
  assert.match(text, /COALESCE\(sc_journey_evidence,/);
  assert.match(text, /\{"step_1":\[\]/);
  // Step key + entry JSON go via $params, not raw text — verify count.
  assert.ok(calls[0].values.length >= 3, 'expects step key + entry JSON + studentId params');
});

test('🛑 PR-4 append: invalid stepNo → no-op (no SQL)', async () => {
  const calls = [];
  const sql = (strings) => { calls.push(strings.join('?')); return Promise.resolve([]); };
  await appendScJourneyEvidence(sql, 'A001', 0, { type: 'x', quote: 'y' });
  await appendScJourneyEvidence(sql, 'A001', 8, { type: 'x', quote: 'y' });
  await appendScJourneyEvidence(sql, 'A001', 'not-int', { type: 'x', quote: 'y' });
  assert.equal(calls.length, 0, 'out-of-range / non-integer step → no SQL fired');
});

test('🛑 PR-4 append: missing entry / non-object → no-op', async () => {
  const calls = [];
  const sql = (strings) => { calls.push(strings.join('?')); return Promise.resolve([]); };
  await appendScJourneyEvidence(sql, 'A001', 3, null);
  await appendScJourneyEvidence(sql, 'A001', 3, undefined);
  await appendScJourneyEvidence(sql, 'A001', 3, 'a-string');
  assert.equal(calls.length, 0);
});

test('🛑 PR-4 append: ai_internal_note included when present, omitted when absent', async () => {
  const calls = [];
  const sql = (strings, ...values) => { calls.push({ values }); return Promise.resolve([]); };
  await appendScJourneyEvidence(sql, 'A001', 5, {
    type: 'resource_retrieval', quote: '某 term',
    ai_internal_note: 'submodality shift detected',
  });
  await appendScJourneyEvidence(sql, 'A001', 4, {
    type: 'identity_claim', quote: '勇敢',
  });
  // First call: entry JSON should contain ai_internal_note.
  const entryJsonWith = calls[0].values.find(v => typeof v === 'string' && v.startsWith('{'));
  assert.ok(entryJsonWith);
  assert.match(entryJsonWith, /ai_internal_note/);
  // Second call: no ai_internal_note in JSON.
  const entryJsonWithout = calls[1].values.find(v => typeof v === 'string' && v.startsWith('{'));
  assert.ok(entryJsonWithout);
  assert.equal(/ai_internal_note/.test(entryJsonWithout), false);
});
