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
