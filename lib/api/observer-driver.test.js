// lib/api/observer-driver.test.js
// Stage B (6/13) — observer-driver unit tests (mock judge, no real LLM).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairMessages, runObserverOverSession } from './observer-driver.js';

// ─── pairMessages ─────────────────────────────────────────

test('🛑 pairMessages: assistant→user pairs', () => {
  const msgs = [
    { role: 'assistant', content: 'q1', question_number: 1 },
    { role: 'user',      content: 'a1', question_number: 1 },
    { role: 'assistant', content: 'q2', question_number: 2 },
    { role: 'user',      content: 'a2', question_number: 2 },
  ];
  const turns = pairMessages(msgs);
  assert.equal(turns.length, 2);
  assert.equal(turns[0].ai, 'q1');
  assert.equal(turns[0].user, 'a1');
  assert.equal(turns[1].ai, 'q2');
  assert.equal(turns[1].user, 'a2');
});

test('🛑 pairMessages: skip leading user (no pair-able question)', () => {
  const msgs = [
    { role: 'user', content: 'a0' },
    { role: 'assistant', content: 'q1' },
    { role: 'user', content: 'a1' },
  ];
  const turns = pairMessages(msgs);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].ai, 'q1');
});

test('🛑 pairMessages: skip trailing assistant (no reply yet)', () => {
  const msgs = [
    { role: 'assistant', content: 'q1' },
    { role: 'user',      content: 'a1' },
    { role: 'assistant', content: 'q2' },
    // no user reply for q2
  ];
  const turns = pairMessages(msgs);
  assert.equal(turns.length, 1);
  assert.equal(turns[0].ai, 'q1');
});

test('🛑 pairMessages: skip empty content', () => {
  const msgs = [
    { role: 'assistant', content: '' },
    { role: 'user', content: 'a' },
    { role: 'assistant', content: 'q2' },
    { role: 'user', content: '' },
  ];
  const turns = pairMessages(msgs);
  assert.equal(turns.length, 0);
});

test('🛡️ pairMessages: malformed inputs → []', () => {
  assert.deepEqual(pairMessages(null), []);
  assert.deepEqual(pairMessages(undefined), []);
  assert.deepEqual(pairMessages('not array'), []);
  assert.deepEqual(pairMessages([]), []);
});

// ─── runObserverOverSession ────────────────────────────────

function fakeObservation({ values=[], owned=[], top1=null, steps={}, reframes=[] } = {}) {
  return {
    skip: false,
    skip_reason: null,
    values_surfaced: values,
    top1_determined: top1,
    owned_confirmed: owned,
    reframe_events: reframes,
    step_evidence: {
      step_1: steps.step_1 || [], step_2: steps.step_2 || [], step_3: steps.step_3 || [],
      step_4: steps.step_4 || [], step_5: steps.step_5 || [], step_6: steps.step_6 || [],
      step_7: steps.step_7 || [],
    },
  };
}

const sampleMessages = [
  { role: 'assistant', content: 'q1', question_number: 1 },
  { role: 'user',      content: 'a1', question_number: 1 },
  { role: 'assistant', content: 'q2', question_number: 2 },
  { role: 'user',      content: 'a2', question_number: 2 },
];

test('🛑 runObserver: accumulates values + owned + top1 over multiple turns', async () => {
  const judgeFn = async ({ turn }) => {
    if (turn.ai === 'q1') {
      return fakeObservation({ values: ['自由'], steps: { step_2: [{ type: 'longing_surface', quote: 'q1' }] } });
    }
    return fakeObservation({
      values: ['平靜'], owned: ['自由'], top1: '自由',
      steps: { step_4: [{ type: 'identity_claim', quote: 'q2' }], step_7: [{ type: 'anchoring', quote: 'a' }] },
    });
  };
  const r = await runObserverOverSession({
    messages: sampleMessages,
    primaryMode: 'elicitation',
    now_iso: '2026-06-13T00:00:00Z',
    judgeFn,
  });
  assert.equal(r.turns_count, 2);
  assert.equal(r.judged_count, 2);
  assert.deepEqual(r.accumulated.values, ['自由', '平靜']);
  assert.deepEqual(r.accumulated.owned, ['自由']);
  assert.equal(r.accumulated.top1, '自由');
  assert.deepEqual(r.accumulated.steps_touched.sort(), [2, 4, 7]);
  assert.equal(r.sc_journey_step, 7);
});

test('🛑 runObserver: skip turn → does not accumulate', async () => {
  const judgeFn = async ({ turn }) => {
    if (turn.ai === 'q1') {
      return { ...fakeObservation(), skip: true, skip_reason: 'crisis' };
    }
    return fakeObservation({ values: ['平靜'] });
  };
  const r = await runObserverOverSession({
    messages: sampleMessages,
    now_iso: 't',
    judgeFn,
  });
  assert.equal(r.skip_counts.crisis, 1);
  assert.deepEqual(r.accumulated.values, ['平靜']);
});

test('🛑 runObserver: judge throws → continues, logs miss', async () => {
  const misses = [];
  const judgeFn = async ({ turn }) => {
    if (turn.ai === 'q1') throw new Error('boom');
    return fakeObservation({ values: ['平靜'] });
  };
  const r = await runObserverOverSession({
    messages: sampleMessages,
    now_iso: 't',
    judgeFn,
    log: (m) => misses.push(m),
  });
  assert.equal(r.judged_count, 1);  // q2 only
  assert.deepEqual(r.accumulated.values, ['平靜']);
  assert.equal(misses.length, 1);
  assert.match(misses[0], /judge threw/);
});

test('🛑 runObserver: dedup values / owned across turns', async () => {
  const judgeFn = async () => fakeObservation({ values: ['自由', '平靜'], owned: ['自由'] });
  const r = await runObserverOverSession({
    messages: sampleMessages,
    now_iso: 't',
    judgeFn,
  });
  // Both turns surface same values — dedup'd.
  assert.deepEqual(r.accumulated.values, ['自由', '平靜']);
  assert.deepEqual(r.accumulated.owned, ['自由']);
});

test('🛑 runObserver: first top1 wins (avoid late LLM noise overwriting)', async () => {
  let i = 0;
  const judgeFn = async () => {
    i++;
    return fakeObservation({ top1: i === 1 ? '平靜' : '自由' });
  };
  const r = await runObserverOverSession({
    messages: sampleMessages,
    now_iso: 't',
    judgeFn,
  });
  assert.equal(r.accumulated.top1, '平靜');
});

test('🛑 runObserver: sc_journey_step = max non-empty', async () => {
  const judgeFn = async ({ turn }) => {
    if (turn.ai === 'q1') {
      return fakeObservation({ steps: { step_5: [{ type: 'resource_retrieval', quote: 'x' }] } });
    }
    return fakeObservation({ steps: { step_2: [{ type: 'longing_surface', quote: 'y' }] } });
  };
  const r = await runObserverOverSession({
    messages: sampleMessages,
    now_iso: 't',
    judgeFn,
  });
  assert.equal(r.sc_journey_step, 5);
});

test('🛑 runObserver: empty messages → empty accumulated, step=null', async () => {
  const judgeFn = async () => fakeObservation();
  const r = await runObserverOverSession({
    messages: [],
    now_iso: 't',
    judgeFn,
  });
  assert.equal(r.turns_count, 0);
  assert.equal(r.sc_journey_step, null);
  for (let n = 1; n <= 7; n++) {
    assert.equal(r.step_evidence[`step_${n}`].length, 0);
  }
});

test('🛑 runObserver: aggregate per-step entries across turns', async () => {
  const judgeFn = async ({ turn }) => fakeObservation({
    steps: { step_3: [{ type: 'data_mining', quote: turn.ai }] },
  });
  const r = await runObserverOverSession({
    messages: sampleMessages,
    now_iso: 't',
    judgeFn,
  });
  assert.equal(r.step_evidence.step_3.length, 2);
  assert.equal(r.step_evidence.step_3[0].quote, 'q1');
  assert.equal(r.step_evidence.step_3[1].quote, 'q2');
});
