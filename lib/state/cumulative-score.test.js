// lib/state/cumulative-score.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createCumulativeScore,
  PPL_SCORE,
  PPL_EVENT_DELTAS,
  computePplDeltaForEvents,
} from './cumulative-score.js';

// ─────────────────────────────────────────────────────────
// createCumulativeScore — validation
// ─────────────────────────────────────────────────────────

test('createCumulativeScore: rejects missing fieldName', () => {
  assert.throws(() => createCumulativeScore({}), /fieldName/);
  assert.throws(() => createCumulativeScore({ fieldName: '' }), /fieldName/);
});

test('createCumulativeScore: rejects bad range', () => {
  assert.throws(() => createCumulativeScore({ fieldName: 'x', range: [5, 2] }), /range/);
  assert.throws(() => createCumulativeScore({ fieldName: 'x', range: 'no' }), /range/);
  assert.throws(() => createCumulativeScore({ fieldName: 'x', range: [0] }), /range/);
});

test('createCumulativeScore: rejects initialValue outside range', () => {
  assert.throws(
    () => createCumulativeScore({ fieldName: 'x', initialValue: 5, range: [0, 1] }),
    /initialValue/,
  );
  assert.throws(
    () => createCumulativeScore({ fieldName: 'x', initialValue: -1 }),
    /initialValue/,
  );
});

test('createCumulativeScore: rejects bad decayPerTurn', () => {
  assert.throws(
    () => createCumulativeScore({ fieldName: 'x', decayPerTurn: 'fast' }),
    /decayPerTurn/,
  );
});

test('createCumulativeScore: rejects bad alertThresholds', () => {
  assert.throws(
    () => createCumulativeScore({ fieldName: 'x', alertThresholds: null }),
    /alertThresholds/,
  );
  assert.throws(
    () => createCumulativeScore({ fieldName: 'x', alertThresholds: [0.5, 0.8] }),
    /alertThresholds/,
  );
});

// ─────────────────────────────────────────────────────────
// score behaviour
// ─────────────────────────────────────────────────────────

test('apply: sums + clamps to range', () => {
  const score = createCumulativeScore({
    fieldName: 'x', initialValue: 0, range: [0, 1], decayPerTurn: -0.05,
  });
  assert.equal(score.apply(0.5, 0.3), 0.8);
  // Use approximately equal for the floating-point subtraction
  assert.ok(Math.abs(score.apply(0.5, -0.3) - 0.2) < 1e-10);
  assert.equal(score.apply(0.9, 0.5), 1.0, 'clamps to max');
  assert.equal(score.apply(0.1, -0.5), 0.0, 'clamps to min');
});

test('apply: handles non-number inputs gracefully', () => {
  const score = createCumulativeScore({ fieldName: 'x' });
  // currentValue undefined → use initialValue (0.0)
  assert.equal(score.apply(undefined, 0.5), 0.5);
  // delta undefined → no change from current
  assert.equal(score.apply(0.3), 0.3);
});

test('applyDecay: subtracts decayPerTurn (clamped)', () => {
  const score = createCumulativeScore({
    fieldName: 'x', range: [0, 1], decayPerTurn: -0.05,
  });
  assert.ok(Math.abs(score.applyDecay(0.5) - 0.45) < 1e-10);
  assert.equal(score.applyDecay(0.02), 0.0, 'cannot go below min');
});

// ─────────────────────────────────────────────────────────
// checkAlert
// ─────────────────────────────────────────────────────────

test('checkAlert: returns highest matching threshold label', () => {
  const score = createCumulativeScore({
    fieldName: 'x',
    alertThresholds: { 0.6: 'low', 0.8: 'mid', 1.0: 'high' },
  });
  assert.equal(score.checkAlert(0.5), null);
  assert.equal(score.checkAlert(0.6), 'low');
  assert.equal(score.checkAlert(0.7), 'low');
  assert.equal(score.checkAlert(0.8), 'mid');
  assert.equal(score.checkAlert(0.99), 'mid');
  assert.equal(score.checkAlert(1.0), 'high');
});

test('checkAlert: null when value below all thresholds', () => {
  const score = createCumulativeScore({
    fieldName: 'x', alertThresholds: { 0.5: 'go' },
  });
  assert.equal(score.checkAlert(0.4), null);
});

test('checkAlert: no thresholds defined → always null', () => {
  const score = createCumulativeScore({ fieldName: 'x' });
  assert.equal(score.checkAlert(0.9), null);
  assert.equal(score.checkAlert(1.0), null);
});

test('checkAlert: returns null for non-number input', () => {
  const score = createCumulativeScore({
    fieldName: 'x', alertThresholds: { 0.5: 'go' },
  });
  assert.equal(score.checkAlert(undefined), null);
  assert.equal(score.checkAlert('high'), null);
});

// ─────────────────────────────────────────────────────────
// immutability
// ─────────────────────────────────────────────────────────

test('returned score object is frozen', () => {
  const score = createCumulativeScore({ fieldName: 'x' });
  assert.ok(Object.isFrozen(score));
  assert.ok(Object.isFrozen(score.range));
  assert.ok(Object.isFrozen(score.alertThresholds));
});

// ─────────────────────────────────────────────────────────
// PPL_SCORE first instance
// ─────────────────────────────────────────────────────────

test('PPL_SCORE: matches Engine 1 §3.1 spec', () => {
  assert.equal(PPL_SCORE.fieldName, 'cumulative_ppl_score');
  assert.equal(PPL_SCORE.initialValue, 0.0);
  assert.deepEqual(PPL_SCORE.range, [0.0, 1.0]);
  assert.equal(PPL_SCORE.decayPerTurn, -0.05);
  assert.equal(PPL_SCORE.alertThresholds[0.6], 'classifier_trigger');
  assert.equal(PPL_SCORE.alertThresholds[0.8], 'force_inject');
  assert.equal(PPL_SCORE.alertThresholds[1.0], 'hitl_alert');
});

test('PPL_SCORE.checkAlert: 0.8 → force_inject (E1c bypass classifier)', () => {
  assert.equal(PPL_SCORE.checkAlert(0.5), null);
  assert.equal(PPL_SCORE.checkAlert(0.6), 'classifier_trigger');
  assert.equal(PPL_SCORE.checkAlert(0.85), 'force_inject');
  assert.equal(PPL_SCORE.checkAlert(1.0), 'hitl_alert');
});

// ─────────────────────────────────────────────────────────
// PPL_EVENT_DELTAS + computePplDeltaForEvents (Engine 1 §3.1 update_rule)
// ─────────────────────────────────────────────────────────

test('PPL_EVENT_DELTAS: 6 events match Engine 1 §3.1', () => {
  assert.equal(PPL_EVENT_DELTAS.classifier_ppl_high, 0.20);
  assert.equal(PPL_EVENT_DELTAS.classifier_ppl_medium, 0.10);
  assert.equal(PPL_EVENT_DELTAS.explicit_protest_hit, 0.30);
  assert.equal(PPL_EVENT_DELTAS.consecutive_short_runs_3plus, 0.15);
  assert.equal(PPL_EVENT_DELTAS.echo_overlap_high, 0.10);
  assert.equal(PPL_EVENT_DELTAS.level_exit_door3_fail, 0.15);
});

test('computePplDeltaForEvents: sums known events', () => {
  // Use approx assertion for floating point sum
  assert.ok(Math.abs(
    computePplDeltaForEvents(['classifier_ppl_high', 'explicit_protest_hit']) - 0.50
  ) < 1e-10);
  assert.equal(computePplDeltaForEvents([]), 0);
});

test('computePplDeltaForEvents: unknown events contribute 0', () => {
  assert.equal(computePplDeltaForEvents(['unknown_event']), 0);
  assert.equal(computePplDeltaForEvents(['classifier_ppl_high', 'fake']), 0.20);
});

test('computePplDeltaForEvents: non-array input returns 0', () => {
  assert.equal(computePplDeltaForEvents(null), 0);
  assert.equal(computePplDeltaForEvents('classifier_ppl_high'), 0);
});

test('PPL apply + computePplDeltaForEvents end-to-end', () => {
  // A turn with explicit protest + classifier high
  const delta = computePplDeltaForEvents(['explicit_protest_hit', 'classifier_ppl_high']);
  // 0.30 + 0.20 = 0.50
  const newScore = PPL_SCORE.apply(0.4, delta);
  // 0.4 + 0.5 = 0.9 (clamped not needed)
  assert.ok(Math.abs(newScore - 0.9) < 1e-10);
  assert.equal(PPL_SCORE.checkAlert(newScore), 'force_inject');
});
