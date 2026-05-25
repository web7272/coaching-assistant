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

test('buildDynamicContext: includes current_phase + phase context text', () => {
  const txt = buildDynamicContext({ current_phase: 'phase_3b' }, {}, 0);
  assert.match(txt, /current_phase：phase_3b/);
  assert.match(txt, /Self-Concept/);  // from phase-context.js phase_3b
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
  assert.deepEqual(collectDetectorOutput([]), { injects: [], patch: {} });
  assert.deepEqual(collectDetectorOutput(null), { injects: [], patch: {} });
});

test('collectDetectorOutput: later patch wins on key collision', () => {
  const out = collectDetectorOutput([
    { id: 'a', ok: true, result: { patch: { router_phase: 'opening' } } },
    { id: 'b', ok: true, result: { patch: { router_phase: 'elicitation' } } },
  ]);
  assert.equal(out.patch.router_phase, 'elicitation');
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

test('🛑 buildDynamicContext: phase_1 + opening + day_opening_inject_active=true → deferred variant (suppresses 起手式)', () => {
  // The whole reason for this fix: E4 fired, set the flag, contextFor must
  // return the "defer to inject" variant — not the cold 起手式 that competed
  // with the inject and won on A001 Day 2.
  const txt = buildDynamicContext(
    {
      current_phase: 'phase_1',
      router_phase: 'opening',
      day_opening_inject_active: true,
    },
    {}, 1,
  );
  assert.match(txt, /\[SYSTEM INJECT — Day Opening Active Reference\][\s\S]*?主導開場/);
  assert.match(txt, /不另起 phase_1 起手式/);
  assert.doesNotMatch(txt, /在你的生命裡、你想要什麼\?/,
    '冷起手式必須消失（compete with E4 inject 就是這個 bug 的根）');
});

test('buildDynamicContext: phase_1 + opening + no flag → cold 起手式 (Day 1 unchanged)', () => {
  const txt = buildDynamicContext(
    { current_phase: 'phase_1', router_phase: 'opening' },
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
