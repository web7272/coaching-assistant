// lib/api/crisis-session-flag.test.js — Vivi 6/7
// sessionTouchedCrisis: signal-fusion helper for the notebook-page register switch.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sessionTouchedCrisis } from './crisis-session-flag.js';

// ─── No session_state / malformed → cautious gentle (fail-safe per spec) ────

test('🛑 6/7 sessionTouchedCrisis: null → false (no signal = sharp)', () => {
  // Spec: "non-crisis 場才走犀利版"; absent session_state means no SOP fired,
  // so this learner did NOT touch crisis. Sharp.
  assert.equal(sessionTouchedCrisis(null), false);
});

test('🛑 6/7 sessionTouchedCrisis: undefined → false', () => {
  assert.equal(sessionTouchedCrisis(undefined), false);
});

test('🛑 6/7 sessionTouchedCrisis: string ("garbage") → true (fail-safe to gentle)', () => {
  // Unknown shape → bias to gentle. "偵測不確定時偏向溫和".
  assert.equal(sessionTouchedCrisis('garbage'), true);
});

test('🛑 6/7 sessionTouchedCrisis: number → true (fail-safe)', () => {
  assert.equal(sessionTouchedCrisis(42), true);
});

test('🛑 6/7 sessionTouchedCrisis: array → true (fail-safe — schema unknown)', () => {
  assert.equal(sessionTouchedCrisis(['not', 'a', 'session_state']), true);
});

// ─── Empty / non-crisis session_state → false (no signal = sharp) ──────────

test('🛑 6/7 sessionTouchedCrisis: empty object → false', () => {
  // Well-formed session_state, no crisis signals → real non-crisis case → sharp.
  assert.equal(sessionTouchedCrisis({}), false);
});

test('🛑 6/7 sessionTouchedCrisis: typical non-crisis session_state → false', () => {
  // Real-world shape: onboarding flow ran, mode tracker present, no crisis bits.
  const state = {
    onboarding_step: null,
    mode_tracker: { current_mode: 'elicitation', mode_history: ['elicitation'] },
    active_context: { category: 2 },
    requires_typing: false,
  };
  assert.equal(sessionTouchedCrisis(state), false);
});

// ─── Signal 1: crisis_sop_state present → true (strongest signal) ──────────

test('🛑 6/7 signal 1: crisis_sop_state = { current_step: 1, ... } → true (SOP instantiated)', () => {
  assert.equal(sessionTouchedCrisis({
    crisis_sop_state: { current_step: 1, awaiting: 'safety_q1' },
  }), true);
});

test('🛑 6/7 signal 1: crisis_sop_state present + crisis_sop_complete=true (post-closure) → STILL true', () => {
  // Vivi 6/6 Fix 1: closure does NOT clear crisis_sop_state — it just adds
  // crisis_sop_complete=true. We want finalize-day to STILL detect crisis here
  // (cleanly-closed crisis session is still crisis-touched).
  assert.equal(sessionTouchedCrisis({
    crisis_sop_state: { current_step: 8, awaiting: null, closure_explicit: true },
    crisis_sop_complete: true,
    crisis_in_progress: false,     // released by closure
    primary_mode: null,            // released by closure
  }), true);
});

test('🛑 6/7 signal 1: crisis_sop_state mid-SOP (incomplete) → true', () => {
  assert.equal(sessionTouchedCrisis({
    crisis_sop_state: { current_step: 4, awaiting: 'handoff_ack', handoff_variant_used: 'high_risk' },
    crisis_in_progress: true,
  }), true);
});

test('🛑 6/7 signal 1: crisis_sop_state = null → does NOT trigger by itself', () => {
  // Null is the explicit "no SOP" value (not "SOP touched"). Verify it doesn't
  // accidentally match. With no other crisis signals, → false.
  assert.equal(sessionTouchedCrisis({
    crisis_sop_state: null,
  }), false);
});

// ─── Signal 2: crisis_state_carry_forward_pending_write present → true ─────

test('🛑 6/7 signal 2: crisis_state_carry_forward_pending_write present → true', () => {
  // e4TakeawayHandler emits this at session close when SOP reached a state
  // worth carrying forward. Persistent signal of "session touched crisis".
  assert.equal(sessionTouchedCrisis({
    crisis_state_carry_forward_pending_write: {
      type: 'passive_dw',
      detected_at: '2026-06-07T...',
    },
  }), true);
});

// ─── Signal 3: deep_signal_flags.passive_dw_detected → true ───────────────

test('🛑 6/7 signal 3: deep_signal_flags.passive_dw_detected=true → true', () => {
  assert.equal(sessionTouchedCrisis({
    deep_signal_flags: { passive_dw_detected: true },
  }), true);
});

test('🛑 6/7 signal 3: deep_signal_flags.passive_dw_detected=false → no trigger by itself', () => {
  assert.equal(sessionTouchedCrisis({
    deep_signal_flags: { passive_dw_detected: false },
  }), false);
});

test('🛑 6/7 signal 3: deep_signal_flags exists but no passive_dw_detected key → no trigger', () => {
  assert.equal(sessionTouchedCrisis({
    deep_signal_flags: { other_flag: true },
  }), false);
});

// ─── A015 brick scenario: stale lock flags WITHOUT sopState → false ────────
//
// Per crisis-sop.js: closure clears the 3 lock flags. But a learner whose
// session_state has stale flags (from a pre-hotfix session) should NOT be
// classified as crisis-touched if no actual SOP / carry-forward / signal
// fired this session. Otherwise EVERY future Day 1 finalize for that learner
// would render gentle even though no crisis happened.
test('🛑 6/7 A015: stale lock flags alone (no sopState / no carry_forward / no signal) → false (sharp)', () => {
  const state = {
    crisis_in_progress: true,    // stale from prior session
    primary_mode: 'crisis',       // stale
    active_modes: ['crisis'],     // stale
    // ⚠️ none of the persistent signals present
  };
  assert.equal(sessionTouchedCrisis(state), false,
    'stale lock flags must NOT trigger gentle (A015 brick fix preserved)');
});

// ─── Defensive: object with weird shape → does not throw, biases to gentle ──

test('🛑 6/7 sessionTouchedCrisis: object with prototype tricks → does not throw', () => {
  // No crash on unusual shapes; returns sensibly (false here — none of the
  // documented signals match).
  const weirdState = Object.create(null);
  assert.equal(sessionTouchedCrisis(weirdState), false);
});

test('🛑 6/7 sessionTouchedCrisis: crisis_sop_state is a string (corrupted) → false (no crisis-shape signal)', () => {
  // We require typeof === 'object' for sopState to count. A string in that
  // slot is not the documented contract — treat as non-signal (fall through
  // to the other checks).
  assert.equal(sessionTouchedCrisis({
    crisis_sop_state: 'corrupted',
  }), false);
});
