// lib/session/phase-machine.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CURRENT_PHASES,
  ROUTER_PHASES,
  PHASE_TRANSITION_MAP,
  ALLOWED_PHASE_TRANSITIONS,
  isValidCurrentPhase,
  isValidRouterPhase,
  canTransitionPhase,
  canSetRouterPhase,
  advancePhase,
  setRouterPhase,
} from './phase-machine.js';

// ─────────────────────────────────────────────────────────
// enum completeness
// ─────────────────────────────────────────────────────────

test('CURRENT_PHASES: 8 enum values (CP1 spec)', () => {
  const values = Object.values(CURRENT_PHASES);
  assert.equal(values.length, 8);
  for (const expected of [
    'phase_1', 'phase_2', 'phase_3a', 'phase_3b',
    'phase_4', 'phase_5', 'integration_retention', 'program_completed',
  ]) {
    assert.ok(values.includes(expected), `missing ${expected}`);
  }
});

test('ROUTER_PHASES: 7 enum values (E3 spec)', () => {
  const values = Object.values(ROUTER_PHASES);
  assert.equal(values.length, 7);
  for (const expected of [
    'opening', 'elicitation', 'top1_determination',
    'identity_test_routing', 'cascade_down', 'deep_signal_handoff', 'completed',
  ]) {
    assert.ok(values.includes(expected), `missing ${expected}`);
  }
});

test('enums are frozen', () => {
  assert.ok(Object.isFrozen(CURRENT_PHASES));
  assert.ok(Object.isFrozen(ROUTER_PHASES));
  assert.ok(Object.isFrozen(PHASE_TRANSITION_MAP));
  assert.ok(Object.isFrozen(ALLOWED_PHASE_TRANSITIONS));
});

// ─────────────────────────────────────────────────────────
// PHASE_TRANSITION_MAP — every current_phase has an entry
// ─────────────────────────────────────────────────────────

test('PHASE_TRANSITION_MAP: covers all 8 current_phases', () => {
  for (const phase of Object.values(CURRENT_PHASES)) {
    assert.ok(phase in PHASE_TRANSITION_MAP, `${phase} missing from PHASE_TRANSITION_MAP`);
  }
});

test('PHASE_TRANSITION_MAP: phase_1 contains opening/elicitation/top1', () => {
  assert.deepEqual(
    [...PHASE_TRANSITION_MAP.phase_1].sort(),
    ['elicitation', 'opening', 'top1_determination'],
  );
});

test('PHASE_TRANSITION_MAP: phase_4 = cascade_down', () => {
  assert.deepEqual([...PHASE_TRANSITION_MAP.phase_4], ['cascade_down']);
});

test('PHASE_TRANSITION_MAP: program_completed has no router_phases', () => {
  assert.deepEqual([...PHASE_TRANSITION_MAP.program_completed], []);
});

// ─────────────────────────────────────────────────────────
// validators
// ─────────────────────────────────────────────────────────

test('isValidCurrentPhase: true for spec enum, false otherwise', () => {
  assert.equal(isValidCurrentPhase('phase_1'), true);
  assert.equal(isValidCurrentPhase('integration_retention'), true);
  assert.equal(isValidCurrentPhase('phase_99'), false);
  assert.equal(isValidCurrentPhase(null), false);
});

test('isValidRouterPhase: true for spec enum, false otherwise', () => {
  assert.equal(isValidRouterPhase('opening'), true);
  assert.equal(isValidRouterPhase('deep_signal_handoff'), true);
  assert.equal(isValidRouterPhase('made_up'), false);
});

// ─────────────────────────────────────────────────────────
// canTransitionPhase
// ─────────────────────────────────────────────────────────

test('canTransitionPhase: phase_1 → phase_2 (allowed)', () => {
  assert.equal(canTransitionPhase('phase_1', 'phase_2'), true);
});

test('canTransitionPhase: phase_2 → phase_3a (owned) or phase_3b (ambiguous)', () => {
  assert.equal(canTransitionPhase('phase_2', 'phase_3a'), true);
  assert.equal(canTransitionPhase('phase_2', 'phase_3b'), true);
});

test('canTransitionPhase: both phase_3a and phase_3b → phase_4', () => {
  assert.equal(canTransitionPhase('phase_3a', 'phase_4'), true);
  assert.equal(canTransitionPhase('phase_3b', 'phase_4'), true);
});

test('canTransitionPhase: phase_5 → integration_retention OR program_completed', () => {
  assert.equal(canTransitionPhase('phase_5', 'integration_retention'), true);
  assert.equal(canTransitionPhase('phase_5', 'program_completed'), true);
});

test('canTransitionPhase: integration_retention → program_completed only', () => {
  assert.equal(canTransitionPhase('integration_retention', 'program_completed'), true);
  assert.equal(canTransitionPhase('integration_retention', 'phase_1'), false);
});

test('canTransitionPhase: program_completed is terminal', () => {
  for (const next of Object.values(CURRENT_PHASES)) {
    assert.equal(canTransitionPhase('program_completed', next), false,
      `program_completed → ${next} should be blocked`);
  }
});

test('canTransitionPhase: cannot skip phases', () => {
  assert.equal(canTransitionPhase('phase_1', 'phase_4'), false);
  assert.equal(canTransitionPhase('phase_2', 'phase_4'), false);
});

test('canTransitionPhase: cannot go backwards', () => {
  assert.equal(canTransitionPhase('phase_4', 'phase_2'), false);
  assert.equal(canTransitionPhase('phase_5', 'phase_1'), false);
});

test('canTransitionPhase: rejects unknown phases', () => {
  assert.equal(canTransitionPhase('phase_99', 'phase_2'), false);
  assert.equal(canTransitionPhase('phase_1', 'phase_99'), false);
});

// ─────────────────────────────────────────────────────────
// canSetRouterPhase
// ─────────────────────────────────────────────────────────

test('canSetRouterPhase: phase_1 + opening/elicitation/top1 ok', () => {
  assert.equal(canSetRouterPhase('phase_1', 'opening'), true);
  assert.equal(canSetRouterPhase('phase_1', 'elicitation'), true);
  assert.equal(canSetRouterPhase('phase_1', 'top1_determination'), true);
});

test('canSetRouterPhase: phase_1 + cascade_down not allowed (different phase)', () => {
  assert.equal(canSetRouterPhase('phase_1', 'cascade_down'), false);
});

test('🛑 canSetRouterPhase: deep_signal_handoff is cross-cutting (any phase)', () => {
  for (const phase of Object.values(CURRENT_PHASES)) {
    assert.equal(canSetRouterPhase(phase, 'deep_signal_handoff'), true,
      `deep_signal_handoff must be entry-able from ${phase}`);
  }
});

test('canSetRouterPhase: rejects unknown phase / router_phase', () => {
  assert.equal(canSetRouterPhase('phase_1', 'made_up'), false);
  assert.equal(canSetRouterPhase('made_up', 'opening'), false);
});

// ─────────────────────────────────────────────────────────
// advancePhase
// ─────────────────────────────────────────────────────────

test('advancePhase: returns patch with new current_phase', () => {
  const patch = advancePhase({ current_phase: 'phase_1' }, 'phase_2');
  assert.deepEqual(patch, { current_phase: 'phase_2' });
});

test('advancePhase: throws on invalid transition', () => {
  assert.throws(
    () => advancePhase({ current_phase: 'phase_1' }, 'phase_4'),
    /invalid transition/i,
  );
});

test('advancePhase: throws when current_phase missing', () => {
  assert.throws(
    () => advancePhase({}, 'phase_2'),
    /invalid transition/i,
  );
});

test('advancePhase: throws when terminal', () => {
  assert.throws(
    () => advancePhase({ current_phase: 'program_completed' }, 'phase_1'),
    /invalid transition/i,
  );
});

// ─────────────────────────────────────────────────────────
// setRouterPhase
// ─────────────────────────────────────────────────────────

test('setRouterPhase: returns patch with new router_phase', () => {
  const patch = setRouterPhase({ current_phase: 'phase_1' }, 'elicitation');
  assert.deepEqual(patch, { router_phase: 'elicitation' });
});

test('setRouterPhase: throws when router_phase not in current_phase', () => {
  assert.throws(
    () => setRouterPhase({ current_phase: 'phase_1' }, 'cascade_down'),
    /not valid within/,
  );
});

test('setRouterPhase: deep_signal_handoff works from any phase', () => {
  assert.deepEqual(
    setRouterPhase({ current_phase: 'phase_4' }, 'deep_signal_handoff'),
    { router_phase: 'deep_signal_handoff' },
  );
});
