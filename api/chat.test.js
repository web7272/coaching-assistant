// api/chat.test.js
// v5.0 chat.js pure orchestration helpers (no DB / no API key needed).
// handler() itself is I/O orchestration — covered by A001 重走 integration verify, not unit tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  INITIAL_PHASE_STATE,
  buildCarryOverState,
  buildDynamicContext,
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
} from './chat.js';
import { PHASE_PROGRESS_NEVER_RESET, RESET_FIELDS } from '../lib/session/day-boundary.js';

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
  assert.match(chatJsSrc,
    /export async function generateNotebookPage\([^)]*wasCrisis\s*=\s*false\s*\)/,
    'generateNotebookPage must accept wasCrisis (default false)');
});

test('🛑 6/7 chat.js: generateDamonNote signature accepts wasCrisis + passes through', () => {
  // Signature.
  assert.match(chatJsSrc,
    /export async function generateDamonNote\([^)]*wasCrisis\s*=\s*false\s*\)/,
    'generateDamonNote must accept wasCrisis (default false)');
  // Pass-through to generateNotebookPage.
  assert.match(chatJsSrc,
    /generateNotebookPage\([^)]*,\s*wasCrisis\)/,
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
