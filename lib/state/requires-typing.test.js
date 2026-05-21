// lib/state/requires-typing.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_FAILED_ATTEMPTS,
  PPL_FORCE_TRIGGER_THRESHOLD,
  CLEARANCE_SENSORY_DETAIL_MIN,
  shouldTrigger,
  clearsRequirement,
  shouldHandoff,
  patchOnActivate,
  patchOnClear,
  evaluateUserTurn,
} from './requires-typing.js';

// ─────────────────────────────────────────────────────────
// constants
// ─────────────────────────────────────────────────────────

test('constants match Engine 1 §A1 spec', () => {
  assert.equal(MAX_FAILED_ATTEMPTS, 2, 'Engine 1 §A1: 2 fail → cascade A3');
  assert.equal(PPL_FORCE_TRIGGER_THRESHOLD, 0.8);
  assert.equal(CLEARANCE_SENSORY_DETAIL_MIN, 2, 'A1 dim 1 only: score >= 2');
});

// ─────────────────────────────────────────────────────────
// shouldTrigger
// ─────────────────────────────────────────────────────────

test('shouldTrigger: false when already active (no double-activate)', () => {
  assert.equal(shouldTrigger({ current_active: true, short_compliance_after_e1c: true }), false);
  assert.equal(shouldTrigger({ current_active: true, cumulative_ppl_score: 0.95 }), false);
});

test('shouldTrigger: true on E1c + short_compliance follow-up', () => {
  assert.equal(shouldTrigger({ short_compliance_after_e1c: true }), true);
});

test('shouldTrigger: true on cumulative_ppl_score >= 0.8', () => {
  assert.equal(shouldTrigger({ cumulative_ppl_score: 0.8 }), true);
  assert.equal(shouldTrigger({ cumulative_ppl_score: 1.0 }), true);
});

test('shouldTrigger: false below ppl threshold and no E1c follow-up', () => {
  assert.equal(shouldTrigger({ cumulative_ppl_score: 0.79 }), false);
  assert.equal(shouldTrigger({}), false);
});

// ─────────────────────────────────────────────────────────
// clearsRequirement
// ─────────────────────────────────────────────────────────

test('clearsRequirement: passes at sensory_detail_score >= 2 (A1 dim 1 only)', () => {
  assert.equal(clearsRequirement({ sensory_detail_score: 2 }), true);
  assert.equal(clearsRequirement({ sensory_detail_score: 4 }), true);
});

test('clearsRequirement: fails at sensory_detail_score < 2', () => {
  assert.equal(clearsRequirement({ sensory_detail_score: 0 }), false);
  assert.equal(clearsRequirement({ sensory_detail_score: 1 }), false);
});

test('clearsRequirement: returns false on malformed input', () => {
  assert.equal(clearsRequirement(null), false);
  assert.equal(clearsRequirement(undefined), false);
  assert.equal(clearsRequirement({}), false);
  assert.equal(clearsRequirement({ sensory_detail_score: 'high' }), false);
});

test('clearsRequirement: ignores attribution + derived (different from spec 02 strict)', () => {
  // A1 uses dim 1 only — even "others" attribution clears A1 (other consumers check it)
  assert.equal(clearsRequirement({
    sensory_detail_score: 3,
    evidence_attribution: 'others',
    derived_from_another_value: true,
  }), true);
});

// ─────────────────────────────────────────────────────────
// shouldHandoff
// ─────────────────────────────────────────────────────────

test('shouldHandoff: cascade at 2 failed attempts', () => {
  assert.equal(shouldHandoff(0), false);
  assert.equal(shouldHandoff(1), false);
  assert.equal(shouldHandoff(2), true);
  assert.equal(shouldHandoff(3), true);
});

// ─────────────────────────────────────────────────────────
// patch builders
// ─────────────────────────────────────────────────────────

test('patchOnActivate: sets requires_typing_active true', () => {
  assert.deepEqual(patchOnActivate(), { requires_typing_active: true });
});

test('patchOnClear: sets requires_typing_active false', () => {
  assert.deepEqual(patchOnClear(), { requires_typing_active: false });
});

// ─────────────────────────────────────────────────────────
// evaluateUserTurn (orchestration helper)
// ─────────────────────────────────────────────────────────

test('evaluateUserTurn: clears on passing judgment', () => {
  const r = evaluateUserTurn({
    judgment: { sensory_detail_score: 3, evidence_attribution: 'self', derived_from_another_value: false },
    failedAttempts: 0,
  });
  assert.equal(r.cleared, true);
  assert.deepEqual(r.patch, { requires_typing_active: false });
  assert.equal(r.handoff, false);
});

test('evaluateUserTurn: 1st fail → stay blocked, no handoff yet', () => {
  const r = evaluateUserTurn({
    judgment: { sensory_detail_score: 1 },
    failedAttempts: 0,
  });
  assert.equal(r.cleared, false);
  assert.deepEqual(r.patch, {});
  assert.equal(r.handoff, false);
});

test('evaluateUserTurn: 2nd fail → cascade handoff + clear gate', () => {
  const r = evaluateUserTurn({
    judgment: { sensory_detail_score: 1 },
    failedAttempts: 1,
  });
  assert.equal(r.cleared, false);
  assert.deepEqual(r.patch, { requires_typing_active: false });
  assert.equal(r.handoff, true);
});

test('evaluateUserTurn: undefined failedAttempts defaults to 0', () => {
  const r = evaluateUserTurn({ judgment: { sensory_detail_score: 1 } });
  assert.equal(r.handoff, false);
});
