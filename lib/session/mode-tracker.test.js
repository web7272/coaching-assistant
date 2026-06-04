// lib/session/mode-tracker.test.js
// Patrick 6/4 (v5.1 Step 4 PR-23s4a) — Lock mode lifecycle semantics.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTIVE_MODES,
  MODE_LIST,
  MAX_ACTIVE_MODES,
  deriveModeFromRouterPhase,
  readModeState,
  buildModeStatePatch,
  addMode,
  removeMode,
  transitionPrimary,
  triggerCrisis,
  resolveCrisis,
  checkActiveModesLimit,
} from './mode-tracker.js';

// ─── constants ───────────────────────────────────────────

test('🛑 ACTIVE_MODES: frozen, 6 values per spec', () => {
  assert.ok(Object.isFrozen(ACTIVE_MODES));
  assert.deepEqual([...MODE_LIST].sort(), [
    'cascade', 'crisis', 'elicitation', 'future_pacing',
    'identity_anchoring', 'integration',
  ]);
});

test('🛑 MAX_ACTIVE_MODES = 3 (per spec: >3 = HITL alert)', () => {
  assert.equal(MAX_ACTIVE_MODES, 3);
});

// ─── deriveModeFromRouterPhase (read-time fallback) ─────

test('🛑 deriveModeFromRouterPhase: mirror migration 025 §5 對映表 (7 mappings)', () => {
  assert.equal(deriveModeFromRouterPhase('opening'),               ACTIVE_MODES.ELICITATION);
  assert.equal(deriveModeFromRouterPhase('elicitation'),           ACTIVE_MODES.ELICITATION);
  assert.equal(deriveModeFromRouterPhase('top1_determination'),    ACTIVE_MODES.ELICITATION);
  assert.equal(deriveModeFromRouterPhase('identity_test_routing'), ACTIVE_MODES.IDENTITY_ANCHORING);
  assert.equal(deriveModeFromRouterPhase('cascade_down'),          ACTIVE_MODES.CASCADE);
  assert.equal(deriveModeFromRouterPhase('deep_signal_handoff'),   ACTIVE_MODES.CRISIS);
  assert.equal(deriveModeFromRouterPhase('completed'),             ACTIVE_MODES.FUTURE_PACING);
});

test('deriveModeFromRouterPhase: unknown / null → null (caller defaults)', () => {
  assert.equal(deriveModeFromRouterPhase('whatever'), null);
  assert.equal(deriveModeFromRouterPhase(null), null);
  assert.equal(deriveModeFromRouterPhase(undefined), null);
  assert.equal(deriveModeFromRouterPhase(123), null);
});

// ─── readModeState ───────────────────────────────────────

test('🛑 readModeState: happy path — keys present + valid', () => {
  const r = readModeState({
    active_modes: ['elicitation', 'integration'],
    primary_mode: 'integration',
    paused_modes: [],
  });
  assert.deepEqual(r.active_modes, ['elicitation', 'integration']);
  assert.equal(r.primary_mode, 'integration');
  assert.deepEqual(r.paused_modes, []);
  assert.equal(r.was_fallback, false);
});

test('🛑 readModeState: missing primary_mode + has router_phase → fallback derive', () => {
  const r = readModeState({ router_phase: 'cascade_down' });
  assert.equal(r.primary_mode, 'cascade');
  assert.deepEqual(r.active_modes, ['cascade']);
  assert.deepEqual(r.paused_modes, []);
  assert.equal(r.was_fallback, true);
});

test('🛑 readModeState: missing primary + missing router_phase → fallback elicitation', () => {
  const r = readModeState({});
  assert.equal(r.primary_mode, 'elicitation');
  assert.equal(r.was_fallback, true);
});

test('🛑 readModeState: null / undefined / non-object → defensive elicitation', () => {
  for (const bad of [null, undefined, 'string', 42, []]) {
    const r = readModeState(bad);
    assert.equal(r.primary_mode, 'elicitation', `bad input ${typeof bad} → elicitation`);
    assert.equal(r.was_fallback, true);
  }
});

test('🛑 readModeState: primary set but garbage value → treat as missing (fallback)', () => {
  const r = readModeState({
    primary_mode: 'whatever_not_a_mode',
    router_phase: 'identity_test_routing',
  });
  assert.equal(r.primary_mode, 'identity_anchoring',
    'invalid primary_mode triggers fallback via router_phase');
  assert.equal(r.was_fallback, true);
});

test('readModeState: active_modes filtered to known modes only (defensive)', () => {
  const r = readModeState({
    active_modes: ['elicitation', 'bogus_mode', 'cascade'],
    primary_mode: 'elicitation',
    paused_modes: [],
  });
  assert.deepEqual(r.active_modes, ['elicitation', 'cascade'],
    'unknown modes silently dropped');
});

test('readModeState: empty active_modes after filtering → falls back to [primary_mode]', () => {
  const r = readModeState({
    active_modes: ['bogus', 'also_bogus'],
    primary_mode: 'cascade',
    paused_modes: [],
  });
  assert.deepEqual(r.active_modes, ['cascade']);
  assert.equal(r.primary_mode, 'cascade');
  assert.equal(r.was_fallback, false, 'primary is valid → not fallback');
});

test('readModeState: crisis fallback from router_phase=deep_signal_handoff', () => {
  const r = readModeState({ router_phase: 'deep_signal_handoff' });
  assert.equal(r.primary_mode, 'crisis');
  assert.deepEqual(r.active_modes, ['crisis']);
  assert.equal(r.was_fallback, true);
});

// ─── buildModeStatePatch ─────────────────────────────────

test('buildModeStatePatch: copies arrays + carries primary_mode', () => {
  const state = {
    active_modes: ['elicitation', 'cascade'],
    primary_mode: 'elicitation',
    paused_modes: ['integration'],
  };
  const patch = buildModeStatePatch(state);
  assert.deepEqual(patch, state);
  assert.notEqual(patch.active_modes, state.active_modes, 'arrays must be copies');
  assert.notEqual(patch.paused_modes, state.paused_modes);
});

test('buildModeStatePatch: rejects non-object', () => {
  assert.throws(() => buildModeStatePatch(null), TypeError);
  assert.throws(() => buildModeStatePatch('string'), TypeError);
});

// ─── addMode ─────────────────────────────────────────────

test('🛑 addMode: append to active, primary unchanged', () => {
  const state = { active_modes: ['elicitation'], primary_mode: 'elicitation', paused_modes: [] };
  const out = addMode(state, 'cascade');
  assert.deepEqual(out.active_modes, ['elicitation', 'cascade']);
  assert.equal(out.primary_mode, 'elicitation');
});

test('addMode: idempotent (mode already active → no-op)', () => {
  const state = { active_modes: ['elicitation', 'cascade'], primary_mode: 'elicitation', paused_modes: [] };
  const out = addMode(state, 'cascade');
  assert.equal(out, state, 'same reference returned on no-op');
});

test('addMode: throws on unknown mode', () => {
  assert.throws(() =>
    addMode({ active_modes: [], primary_mode: 'elicitation', paused_modes: [] }, 'bogus'),
    /unknown mode "bogus"/);
});

// ─── removeMode ──────────────────────────────────────────

test('🛑 removeMode: removes non-primary mode, primary unchanged', () => {
  const state = { active_modes: ['elicitation', 'cascade'], primary_mode: 'elicitation', paused_modes: [] };
  const out = removeMode(state, 'cascade');
  assert.deepEqual(out.active_modes, ['elicitation']);
  assert.equal(out.primary_mode, 'elicitation');
});

test('🛑 removeMode: removing primary demotes to first remaining', () => {
  const state = { active_modes: ['cascade', 'elicitation'], primary_mode: 'cascade', paused_modes: [] };
  const out = removeMode(state, 'cascade');
  assert.deepEqual(out.active_modes, ['elicitation']);
  assert.equal(out.primary_mode, 'elicitation', 'demoted to first remaining');
});

test('🛑 removeMode: removing last mode falls back to elicitation (no empty active)', () => {
  const state = { active_modes: ['cascade'], primary_mode: 'cascade', paused_modes: [] };
  const out = removeMode(state, 'cascade');
  assert.deepEqual(out.active_modes, ['elicitation'],
    'invariant: active_modes never empty (fall back to elicitation)');
  assert.equal(out.primary_mode, 'elicitation');
});

test('removeMode: mode not in active → no-op', () => {
  const state = { active_modes: ['elicitation'], primary_mode: 'elicitation', paused_modes: [] };
  const out = removeMode(state, 'cascade');
  assert.equal(out, state);
});

// ─── transitionPrimary ───────────────────────────────────

test('🛑 transitionPrimary: switches primary, keeps both in active', () => {
  const state = { active_modes: ['elicitation'], primary_mode: 'elicitation', paused_modes: [] };
  const out = transitionPrimary(state, 'identity_anchoring');
  assert.equal(out.primary_mode, 'identity_anchoring');
  assert.ok(out.active_modes.includes('identity_anchoring'));
  assert.ok(out.active_modes.includes('elicitation'),
    'previous primary stays in active (mode-transition is non-destructive)');
});

test('transitionPrimary: target already primary → no-op (same reference)', () => {
  const state = { active_modes: ['cascade'], primary_mode: 'cascade', paused_modes: [] };
  const out = transitionPrimary(state, 'cascade');
  assert.equal(out, state);
});

test('transitionPrimary: target already in active → updates primary only', () => {
  const state = { active_modes: ['elicitation', 'cascade'], primary_mode: 'elicitation', paused_modes: [] };
  const out = transitionPrimary(state, 'cascade');
  assert.equal(out.primary_mode, 'cascade');
  assert.deepEqual(out.active_modes, ['elicitation', 'cascade']);
});

// ─── triggerCrisis / resolveCrisis ───────────────────────

test('🛑 triggerCrisis: all non-crisis active → paused, primary = crisis', () => {
  const state = {
    active_modes: ['elicitation', 'integration'],
    primary_mode: 'integration',
    paused_modes: [],
  };
  const out = triggerCrisis(state);
  assert.deepEqual(out.active_modes, ['crisis']);
  assert.equal(out.primary_mode, 'crisis');
  assert.deepEqual(out.paused_modes.sort(), ['elicitation', 'integration']);
});

test('🛑 triggerCrisis: preserves previously paused (dedupe)', () => {
  const state = {
    active_modes: ['cascade'],
    primary_mode: 'cascade',
    paused_modes: ['elicitation'],
  };
  const out = triggerCrisis(state);
  assert.deepEqual(out.active_modes, ['crisis']);
  assert.equal(out.primary_mode, 'crisis');
  assert.deepEqual(out.paused_modes.sort(), ['cascade', 'elicitation']);
});

test('triggerCrisis: idempotent when already in crisis', () => {
  const state = { active_modes: ['crisis'], primary_mode: 'crisis', paused_modes: ['elicitation'] };
  const out = triggerCrisis(state);
  assert.deepEqual(out.active_modes, ['crisis']);
  assert.equal(out.primary_mode, 'crisis');
  assert.deepEqual(out.paused_modes, ['elicitation'],
    'no duplicates introduced');
});

test('🛑 resolveCrisis: removes crisis, resumes paused, primary = first resumed', () => {
  const state = {
    active_modes: ['crisis'],
    primary_mode: 'crisis',
    paused_modes: ['integration', 'elicitation'],
  };
  const out = resolveCrisis(state);
  assert.equal(out.primary_mode, 'integration',
    'first paused mode becomes new primary (best represents pre-crisis context)');
  assert.deepEqual(out.active_modes.sort(), ['elicitation', 'integration']);
  assert.deepEqual(out.paused_modes, []);
});

test('🛑 resolveCrisis: no paused → primary falls back to remaining active or elicitation', () => {
  const state = { active_modes: ['crisis'], primary_mode: 'crisis', paused_modes: [] };
  const out = resolveCrisis(state);
  assert.equal(out.primary_mode, 'elicitation');
  assert.deepEqual(out.active_modes, ['elicitation']);
});

test('resolveCrisis: crisis with parallel non-crisis active (defensive)', () => {
  // Shouldn't normally happen (triggerCrisis enforces invariant), but handle it.
  const state = {
    active_modes: ['crisis', 'elicitation'],   // weird but defensible
    primary_mode: 'crisis',
    paused_modes: ['integration'],
  };
  const out = resolveCrisis(state);
  assert.ok(!out.active_modes.includes('crisis'));
  assert.equal(out.primary_mode, 'integration');
  assert.deepEqual(out.active_modes.sort(), ['elicitation', 'integration']);
});

// ─── checkActiveModesLimit ───────────────────────────────

test('🛑 checkActiveModesLimit: 1-3 → ok, >3 → exceeds_max', () => {
  assert.deepEqual(checkActiveModesLimit({ active_modes: ['elicitation'] }), { ok: true });
  assert.deepEqual(checkActiveModesLimit({ active_modes: ['e', 'i', 'c'] }), { ok: true });
  const overflow = checkActiveModesLimit({ active_modes: ['e', 'i', 'c', 'f'] });
  assert.equal(overflow.ok, false);
  assert.equal(overflow.reason, 'exceeds_max_active_modes');
  assert.equal(overflow.count, 4);
});

test('🛑 checkActiveModesLimit: empty → invariant violation (caller should never see this)', () => {
  const r = checkActiveModesLimit({ active_modes: [] });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty_active_modes');
});

test('checkActiveModesLimit: defensive against missing field', () => {
  const r = checkActiveModesLimit({});
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'empty_active_modes');
});

// ─── end-to-end scenarios ────────────────────────────────

test('🛑 e2e: A006-like passive DW → triggerCrisis → resolve back to elicitation', () => {
  // Simulate: student starts in elicitation, surfaces passive DW, crisis triggered,
  // student → SI confirm denies → crisis resolves, returns to elicitation.
  let state = {
    active_modes: ['elicitation'],
    primary_mode: 'elicitation',
    paused_modes: [],
  };
  // Crisis cascade
  state = triggerCrisis(state);
  assert.equal(state.primary_mode, 'crisis');
  assert.deepEqual(state.paused_modes, ['elicitation']);
  // Crisis resolved (SI deny path)
  state = resolveCrisis(state);
  assert.equal(state.primary_mode, 'elicitation');
  assert.deepEqual(state.active_modes, ['elicitation']);
  assert.deepEqual(state.paused_modes, []);
});

test('🛑 e2e: elicitation → identity_anchoring → cascade (mode progression)', () => {
  let state = { active_modes: ['elicitation'], primary_mode: 'elicitation', paused_modes: [] };
  // Top 1 confirmed → switch to identity_anchoring
  state = transitionPrimary(state, 'identity_anchoring');
  assert.equal(state.primary_mode, 'identity_anchoring');
  // owned → cascade (orthogonal)
  state = addMode(state, 'cascade');
  state = transitionPrimary(state, 'cascade');
  assert.equal(state.primary_mode, 'cascade');
  assert.ok(state.active_modes.includes('cascade'));
  assert.ok(state.active_modes.includes('identity_anchoring'));
  assert.ok(state.active_modes.includes('elicitation'));
  // 3 modes active — at the limit but ok
  assert.deepEqual(checkActiveModesLimit(state), { ok: true });
});
