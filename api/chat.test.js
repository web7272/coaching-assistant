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

test('🛑 auto-transition: phase_1 + opening + no other touches → { router_phase: elicitation }', () => {
  const out = maybeAutoTransitionRouterPhase({
    stateForPrompt: { current_phase: 'phase_1', router_phase: 'opening' },
  });
  assert.deepEqual(out, { router_phase: 'elicitation' });
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
