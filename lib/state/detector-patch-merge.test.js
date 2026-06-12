// lib/state/detector-patch-merge.test.js
// v5.3 (6/12) — makeDetectorPatchMerger concurrency tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDetectorPatchMerger } from './detector-patch-merge.js';
import {
  buildInvocationPatch,
} from '../damon-reframe-library/invocation-tracker.js';

// ═════════════════════════════════════════════════════════
// Baseline behavior — non-history keys merge shallow (per chat.js pattern)
// ═════════════════════════════════════════════════════════

test('🛑 merger: non-history keys shallow-merge (later wins, like spread)', () => {
  const merge = makeDetectorPatchMerger({});
  const a = { foo: 1, bar: 2 };
  const b = { bar: 3, baz: 4 };
  assert.deepEqual(merge(a, b), { foo: 1, bar: 3, baz: 4 });
});

test('🛑 merger: empty / null inputs → empty result, no crash', () => {
  const merge = makeDetectorPatchMerger(null);
  assert.deepEqual(merge(null, null), {});
  assert.deepEqual(merge({}, {}), {});
  assert.deepEqual(merge({ x: 1 }, null), { x: 1 });
});

// ═════════════════════════════════════════════════════════
// 🔴 Concurrent reframe history — concat tails (NOT overwrite)
// ═════════════════════════════════════════════════════════

test('🔴 merger: two handler patches with reframe history → tails concat on baseline (no dupe of prevList)', () => {
  // Baseline: 1 prior reframe in session_state.
  const prevList = [{ reframe_id: 'R2', invoked_at_turn: 2 }];
  const sessionState = { reframe_invocation_history_in_session: prevList };

  // Each handler reads state (same baseline) and appends its own entry.
  const patchA = buildInvocationPatch({
    reframe_id: 'R1',
    state: sessionState,
    ctx: { session_id: 1, now_iso: '2026-06-12T10:00:00Z' },
  });
  const patchB = buildInvocationPatch({
    reframe_id: 'R5',
    state: sessionState,
    ctx: { session_id: 1, now_iso: '2026-06-12T10:00:00Z' },
  });
  // Each patch has [prevList, newEntry] = length 2.
  assert.equal(patchA.reframe_invocation_history_in_session.length, 2);
  assert.equal(patchB.reframe_invocation_history_in_session.length, 2);

  // The merger should produce [prevList, R1, R5] = length 3 — NOT 4 (with dupe prev).
  const merge = makeDetectorPatchMerger(sessionState);
  const merged = merge({}, patchA);
  const final = merge(merged, patchB);
  assert.equal(final.reframe_invocation_history_in_session.length, 3,
    'concat tails: prevList(1) + R1 + R5 = 3 (NOT 4 with duplicated prev)');
  assert.equal(final.reframe_invocation_history_in_session[0].reframe_id, 'R2');
  assert.equal(final.reframe_invocation_history_in_session[1].reframe_id, 'R1');
  assert.equal(final.reframe_invocation_history_in_session[2].reframe_id, 'R5');
});

test('🔴 merger: prefix sliced from prevList.length → 偵測器 chat.js:510-515 delta 仍正確', () => {
  // chat.js:515: `newHistory.slice(prevHistory.length)` to get delta.
  // After concat, prefix MUST equal prevList so slice(prevList.length) gives ONLY new entries.
  const prevList = [
    { reframe_id: 'R2', invoked_at_turn: 1 },
    { reframe_id: 'R7', invoked_at_turn: 2 },
  ];
  const sessionState = { reframe_invocation_history_in_session: prevList };

  const patchA = buildInvocationPatch({
    reframe_id: 'R1',
    state: sessionState,
    ctx: { session_id: 1, now_iso: 't' },
  });
  const patchB = buildInvocationPatch({
    reframe_id: 'R5',
    state: sessionState,
    ctx: { session_id: 1, now_iso: 't' },
  });
  const merge = makeDetectorPatchMerger(sessionState);
  const final = merge(merge({}, patchA), patchB);

  // Slice delta — must yield exactly [R1, R5], NOT include any prevList entry.
  const newHistory = final.reframe_invocation_history_in_session;
  const delta = newHistory.slice(prevList.length);
  assert.equal(delta.length, 2);
  assert.equal(delta[0].reframe_id, 'R1');
  assert.equal(delta[1].reframe_id, 'R5');
});

test('🛑 merger: only one handler emits history → still works (single tail)', () => {
  const prevList = [{ reframe_id: 'R7' }];
  const sessionState = { reframe_invocation_history_in_session: prevList };
  const merge = makeDetectorPatchMerger(sessionState);
  const patch = buildInvocationPatch({
    reframe_id: 'R1',
    state: sessionState,
    ctx: { session_id: 1, now_iso: 't' },
  });
  const final = merge({}, patch);
  assert.equal(final.reframe_invocation_history_in_session.length, 2);
  assert.equal(final.reframe_invocation_history_in_session[1].reframe_id, 'R1');
});

test('🛑 merger: empty prevList + 2 new patches → [A, B] (no prefix to preserve)', () => {
  const sessionState = {};  // no prior history
  const merge = makeDetectorPatchMerger(sessionState);
  const patchA = buildInvocationPatch({
    reframe_id: 'R1',
    state: sessionState,
    ctx: { session_id: 1, now_iso: 't' },
  });
  const patchB = buildInvocationPatch({
    reframe_id: 'R5',
    state: sessionState,
    ctx: { session_id: 1, now_iso: 't' },
  });
  const final = merge(merge({}, patchA), patchB);
  assert.equal(final.reframe_invocation_history_in_session.length, 2);
  assert.deepEqual(
    final.reframe_invocation_history_in_session.map(e => e.reframe_id),
    ['R1', 'R5']);
});

test('🛑 merger: 3 patches in same turn → all 3 tails concat (prevList + 3 new)', () => {
  const prevList = [{ reframe_id: 'R2' }];
  const sessionState = { reframe_invocation_history_in_session: prevList };
  const merge = makeDetectorPatchMerger(sessionState);
  const p1 = buildInvocationPatch({ reframe_id: 'R1', state: sessionState, ctx: { session_id: 1, now_iso: 't' } });
  const p2 = buildInvocationPatch({ reframe_id: 'R5', state: sessionState, ctx: { session_id: 1, now_iso: 't' } });
  const p3 = buildInvocationPatch({ reframe_id: 'R7', state: sessionState, ctx: { session_id: 1, now_iso: 't' } });
  const final = merge(merge(merge({}, p1), p2), p3);
  assert.equal(final.reframe_invocation_history_in_session.length, 4);
  assert.deepEqual(
    final.reframe_invocation_history_in_session.map(e => e.reframe_id),
    ['R2', 'R1', 'R5', 'R7']);
});
