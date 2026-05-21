// lib/state/handoff-escalation.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HITL_ALERT_THRESHOLD,
  HANDOFF_TRIGGER_SOURCES,
  POST_HANDOFF_BRANCHES,
  incrementHandoffCount,
  shouldAlertHITL,
  isValidTriggerSource,
  isValidPostHandoffBranch,
  patchForHandoff,
  evaluateHandoff,
} from './handoff-escalation.js';

// ─────────────────────────────────────────────────────────
// constants
// ─────────────────────────────────────────────────────────

test('HITL_ALERT_THRESHOLD = 2 (Engine 1 §A3)', () => {
  assert.equal(HITL_ALERT_THRESHOLD, 2);
});

test('HANDOFF_TRIGGER_SOURCES: covers 6 spec sources across engines 1+3+4', () => {
  const keys = Object.keys(HANDOFF_TRIGGER_SOURCES);
  // Engine 1: E1c, E1d, E1a
  assert.ok(keys.some(k => k.startsWith('E1c')));
  assert.ok(keys.some(k => k.startsWith('E1d')));
  assert.ok(keys.some(k => k.startsWith('E1a')));
  // Engine 3: deep_signal, opening_branch, top1
  assert.ok(keys.some(k => k.includes('deep_signal')));
  assert.ok(keys.some(k => k.includes('opening_branch')));
  assert.ok(keys.some(k => k.includes('top1')));
  // Engine 4: day_opening
  assert.ok(keys.some(k => k.includes('day_opening')));
});

test('POST_HANDOFF_BRANCHES: 3 branches', () => {
  assert.equal(POST_HANDOFF_BRANCHES.REDIRECT, 'redirect');
  assert.equal(POST_HANDOFF_BRANCHES.PAUSE, 'pause');
  assert.equal(POST_HANDOFF_BRANCHES.SILENT, 'silent');
});

test('enums are frozen', () => {
  assert.ok(Object.isFrozen(HANDOFF_TRIGGER_SOURCES));
  assert.ok(Object.isFrozen(POST_HANDOFF_BRANCHES));
});

// ─────────────────────────────────────────────────────────
// incrementHandoffCount
// ─────────────────────────────────────────────────────────

test('incrementHandoffCount: increments by 1', () => {
  assert.equal(incrementHandoffCount(0), 1);
  assert.equal(incrementHandoffCount(5), 6);
});

test('incrementHandoffCount: undefined / null → 1', () => {
  assert.equal(incrementHandoffCount(undefined), 1);
  assert.equal(incrementHandoffCount(null), 1);
});

// ─────────────────────────────────────────────────────────
// shouldAlertHITL
// ─────────────────────────────────────────────────────────

test('shouldAlertHITL: false at 0/1, true at 2+', () => {
  assert.equal(shouldAlertHITL(0), false);
  assert.equal(shouldAlertHITL(1), false);
  assert.equal(shouldAlertHITL(2), true);
  assert.equal(shouldAlertHITL(5), true);
});

test('shouldAlertHITL: false on non-number', () => {
  assert.equal(shouldAlertHITL('many'), false);
  assert.equal(shouldAlertHITL(null), false);
});

// ─────────────────────────────────────────────────────────
// validators
// ─────────────────────────────────────────────────────────

test('isValidTriggerSource: accepts known sources by value', () => {
  assert.equal(isValidTriggerSource('E1c_requires_typing_failed'), true);
  assert.equal(isValidTriggerSource('E3_deep_signal'), true);
});

test('isValidTriggerSource: rejects unknown', () => {
  assert.equal(isValidTriggerSource('made_up_source'), false);
  assert.equal(isValidTriggerSource(''), false);
  assert.equal(isValidTriggerSource(null), false);
});

test('isValidPostHandoffBranch: accepts the 3 branches', () => {
  assert.equal(isValidPostHandoffBranch('redirect'), true);
  assert.equal(isValidPostHandoffBranch('pause'), true);
  assert.equal(isValidPostHandoffBranch('silent'), true);
});

test('isValidPostHandoffBranch: rejects unknown', () => {
  assert.equal(isValidPostHandoffBranch('quit'), false);
});

// ─────────────────────────────────────────────────────────
// patchForHandoff
// ─────────────────────────────────────────────────────────

test('patchForHandoff: builds session_state patch', () => {
  assert.deepEqual(patchForHandoff(0), { handoff_triggered_count: 1 });
  assert.deepEqual(patchForHandoff(3), { handoff_triggered_count: 4 });
});

test('patchForHandoff: undefined currentCount → starts at 1', () => {
  assert.deepEqual(patchForHandoff(undefined), { handoff_triggered_count: 1 });
});

// ─────────────────────────────────────────────────────────
// evaluateHandoff (full orchestration)
// ─────────────────────────────────────────────────────────

test('evaluateHandoff: 1st handoff in session → no HITL yet', () => {
  const r = evaluateHandoff({ currentCount: 0, source: 'E1c_requires_typing_failed' });
  assert.deepEqual(r.patch, { handoff_triggered_count: 1 });
  assert.equal(r.hitl_alert, false);
  assert.equal(r.new_count, 1);
});

test('evaluateHandoff: 2nd handoff in session → HITL alert', () => {
  const r = evaluateHandoff({ currentCount: 1, source: 'E3_deep_signal' });
  assert.deepEqual(r.patch, { handoff_triggered_count: 2 });
  assert.equal(r.hitl_alert, true);
  assert.equal(r.new_count, 2);
});

test('evaluateHandoff: 3rd handoff → still HITL alert', () => {
  const r = evaluateHandoff({ currentCount: 2, source: 'E1d_bypassing_layer_maxed' });
  assert.equal(r.hitl_alert, true);
  assert.equal(r.new_count, 3);
});

test('evaluateHandoff: rejects unknown source', () => {
  assert.throws(
    () => evaluateHandoff({ currentCount: 0, source: 'bogus' }),
    /unknown trigger source/,
  );
});

test('evaluateHandoff: undefined currentCount defaults to 0', () => {
  const r = evaluateHandoff({ source: 'E1a_offtopic_persistent' });
  assert.equal(r.new_count, 1);
});
