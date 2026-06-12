// lib/damon-reframe-library/invocation-tracker.test.js
// v5.3 (6/12) — buildInvocationPatch helper unit tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildInvocationEntry,
  appendToSessionHistoryPatch,
  buildInvocationPatch,
} from './invocation-tracker.js';

// ═════════════════════════════════════════════════════════
// buildInvocationPatch — convenience wrapper
// ═════════════════════════════════════════════════════════

test('🛑 buildInvocationPatch: returns patch slice with single entry appended', () => {
  const state = {
    reframe_invocation_history_in_session: [],
    turn_count_this_session: 7,
    primary_mode: 'elicitation',
  };
  const ctx = { session_id: 42, now_iso: '2026-06-12T10:00:00Z' };
  const patch = buildInvocationPatch({ reframe_id: 'R1', state, ctx });
  assert.ok(Array.isArray(patch.reframe_invocation_history_in_session));
  assert.equal(patch.reframe_invocation_history_in_session.length, 1);
  const entry = patch.reframe_invocation_history_in_session[0];
  assert.equal(entry.reframe_id, 'R1');
  assert.equal(entry.invoked_at_turn, 7);
  assert.equal(entry.session_id, 42);
  assert.equal(entry.outcome, 'pending');
  assert.equal(entry.mode, 'elicitation');
  assert.equal(entry.invoked_at, '2026-06-12T10:00:00Z');
});

test('🛑 buildInvocationPatch: preserves prior history (append on top of state)', () => {
  const prior = [{ reframe_id: 'R1', invoked_at_turn: 1 }];
  const state = {
    reframe_invocation_history_in_session: prior,
    turn_count_this_session: 5,
    primary_mode: 'integration',
  };
  const ctx = { session_id: 99, now_iso: '2026-06-12T11:00:00Z' };
  const patch = buildInvocationPatch({ reframe_id: 'R5', state, ctx });
  assert.equal(patch.reframe_invocation_history_in_session.length, 2);
  assert.equal(patch.reframe_invocation_history_in_session[0].reframe_id, 'R1');
  assert.equal(patch.reframe_invocation_history_in_session[1].reframe_id, 'R5');
});

test('🛑 buildInvocationPatch: missing turn_count_this_session → 0 fallback', () => {
  const state = { reframe_invocation_history_in_session: [] };
  const ctx = { session_id: 1, now_iso: '2026-06-12T12:00:00Z' };
  const patch = buildInvocationPatch({ reframe_id: 'R7', state, ctx });
  assert.equal(patch.reframe_invocation_history_in_session[0].invoked_at_turn, 0);
});

test('🛑 buildInvocationPatch: variant carried through', () => {
  const state = { reframe_invocation_history_in_session: [] };
  const ctx = { session_id: 1, now_iso: '2026-06-12T12:00:00Z' };
  const patch = buildInvocationPatch({ reframe_id: 'R7', state, ctx, variant: 'R7_C' });
  assert.equal(patch.reframe_invocation_history_in_session[0].variant, 'R7_C');
});

test('🔴 buildInvocationPatch: unknown reframe_id → throws (defensive, REFRAME_REGISTRY 鎖)', () => {
  const state = { reframe_invocation_history_in_session: [] };
  const ctx = { session_id: 1, now_iso: '2026-06-12T12:00:00Z' };
  assert.throws(
    () => buildInvocationPatch({ reframe_id: 'R_FAKE', state, ctx }),
    /unknown reframe_id/);
});

test('🛑 buildInvocationPatch: missing session_id / mode → null (not crash)', () => {
  const state = { reframe_invocation_history_in_session: [] };
  const ctx = { now_iso: '2026-06-12T12:00:00Z' };  // no session_id
  const patch = buildInvocationPatch({ reframe_id: 'R1', state, ctx });
  assert.equal(patch.reframe_invocation_history_in_session[0].session_id, null);
  assert.equal(patch.reframe_invocation_history_in_session[0].mode, null);
});

// ═════════════════════════════════════════════════════════
// Sanity: helper consistent with manual entry build + append
// ═════════════════════════════════════════════════════════

test('🛑 buildInvocationPatch == buildInvocationEntry + appendToSessionHistoryPatch (semantic equivalence)', () => {
  const state = {
    reframe_invocation_history_in_session: [{ reframe_id: 'R2', invoked_at_turn: 3 }],
    turn_count_this_session: 4,
    primary_mode: 'cascade',
  };
  const ctx = { session_id: 7, now_iso: '2026-06-12T13:00:00Z' };

  const manual = appendToSessionHistoryPatch(state, buildInvocationEntry({
    reframe_id: 'R1',
    invoked_at_turn: 4,
    session_id: 7,
    outcome: 'pending',
    variant: null,
    mode: 'cascade',
    invoked_at: '2026-06-12T13:00:00Z',
  }));
  const helper = buildInvocationPatch({ reframe_id: 'R1', state, ctx });
  assert.deepEqual(helper, manual);
});
