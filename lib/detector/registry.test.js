// lib/detector/registry.test.js
//
// 重點驗證（Patrick PR-3c 指定）：
//   - Sequential cascade 優先序正確（E1 偏離先於 E2 身份）
//   - deviation_handled_this_turn != null 時 E2 master skip
//   - detector throw 降級不 break session

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DETECTOR_TYPES,
  TRIGGER_EVENTS,
  CASCADE_PRIORITY,
  DetectorRegistry,
  skipIfDeviationHandled,
} from './registry.js';

// helper: silent logger to keep test output clean
function silentLogger() { return () => {}; }

// helper: make a stub detector
function makeStub({ id, type = 'detector_only', trigger_event = 'user_turn', priority, paired_with, skip_if, handler }) {
  return {
    id, type, trigger_event,
    ...(priority != null ? { priority } : {}),
    ...(paired_with ? { paired_with } : {}),
    ...(skip_if ? { skip_if } : {}),
    handler: handler ?? (() => ({ handled: false })),
  };
}

// ─────────────────────────────────────────────────────────
// constants
// ─────────────────────────────────────────────────────────

test('DETECTOR_TYPES: 5 types per spec 03 §2', () => {
  assert.deepEqual([...DETECTOR_TYPES].sort(), [
    'always_on_cached', 'conditional_inject', 'detector_only', 'pipeline', 'tool_call',
  ].sort());
  assert.ok(Object.isFrozen(DETECTOR_TYPES));
});

test('TRIGGER_EVENTS: 5 events', () => {
  assert.deepEqual([...TRIGGER_EVENTS].sort(), [
    'new_session_day', 'paired', 'program_milestone', 'session_end', 'user_turn',
  ].sort());
  assert.ok(Object.isFrozen(TRIGGER_EVENTS));
});

test('CASCADE_PRIORITY: 7-step chain with E1 before E2', () => {
  // Lower = higher priority. E1 deviation must come BEFORE E2 identity.
  assert.ok(CASCADE_PRIORITY.E1_deviation_pipeline < CASCADE_PRIORITY.E2_identity_test_pipeline,
    'E1 (deviation governance) must dispatch BEFORE E2 (identity test)');
  // E3 deep_signal must come before E3 elicitation (deep trauma can't be "elicitation")
  assert.ok(CASCADE_PRIORITY.E3_deep_signal_detector < CASCADE_PRIORITY.E3_elicitation_router);
  // Full order check (PR-23s4b: 4 sub-routers renamed per v51 task 1)
  const order = [
    'E1_deviation_pipeline',
    'E3_deep_signal_detector',
    'E3_elicitation_router',
    'E3_top1_judge',
    'E3_mode_transition_router',
    'E3_cascade_mode_validator',
    'E2_identity_test_pipeline',
  ];
  for (let i = 0; i < order.length - 1; i++) {
    assert.ok(
      CASCADE_PRIORITY[order[i]] < CASCADE_PRIORITY[order[i + 1]],
      `${order[i]} priority must be < ${order[i + 1]} priority`,
    );
  }
});

// ─────────────────────────────────────────────────────────
// register / validation
// ─────────────────────────────────────────────────────────

test('register: rejects missing id', () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  assert.throws(() => r.register({ type: 'detector_only', trigger_event: 'user_turn', priority: 1, handler: () => ({}) }),
    /id/);
});

test('register: rejects bad type', () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  assert.throws(() => r.register(makeStub({ id: 'a', type: 'invalid', priority: 1 })), /type/);
});

test('register: rejects bad trigger_event', () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  assert.throws(() => r.register(makeStub({ id: 'a', trigger_event: 'bogus', priority: 1 })), /trigger_event/);
});

test('register: user_turn requires priority', () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  assert.throws(() => r.register(makeStub({ id: 'a' })), /priority/);
});

test('register: paired requires paired_with', () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  assert.throws(() => r.register(makeStub({ id: 'a', trigger_event: 'paired' })), /paired_with/);
});

test('register: lifecycle events do not require priority', () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  for (const ev of ['new_session_day', 'session_end', 'program_milestone']) {
    assert.doesNotThrow(() => r.register(makeStub({ id: `lc_${ev}`, trigger_event: ev })));
  }
});

test('register: rejects bad skip_if', () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  assert.throws(
    () => r.register(makeStub({ id: 'a', priority: 1, skip_if: 'not a fn' })),
    /skip_if/,
  );
});

test('register: rejects duplicate id', () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  r.register(makeStub({ id: 'a', priority: 1 }));
  assert.throws(() => r.register(makeStub({ id: 'a', priority: 2 })), /duplicate/);
});

test('register: handler must be function', () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  assert.throws(() => r.register({
    id: 'a', type: 'detector_only', trigger_event: 'user_turn', priority: 1, handler: 'not fn',
  }), /handler/);
});

// ─────────────────────────────────────────────────────────
// listForEvent / has / size / unregister
// ─────────────────────────────────────────────────────────

test('listForEvent: returns in priority order for user_turn', () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  r.register(makeStub({ id: 'low', priority: 100 }));
  r.register(makeStub({ id: 'high', priority: 1 }));
  r.register(makeStub({ id: 'mid', priority: 50 }));
  const list = r.listForEvent('user_turn');
  assert.deepEqual(list.map(x => x.id), ['high', 'mid', 'low']);
});

test('listForEvent: paired event shows primary mapping', () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  r.register(makeStub({ id: 'primary', priority: 1 }));
  r.register(makeStub({ id: 'follower', trigger_event: 'paired', paired_with: 'primary' }));
  const list = r.listForEvent('paired');
  assert.deepEqual(list, [{ id: 'follower', paired_with: 'primary' }]);
});

test('has + size', () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  r.register(makeStub({ id: 'a', priority: 1 }));
  assert.equal(r.size(), 1);
  assert.equal(r.has('a'), true);
  assert.equal(r.has('nope'), false);
});

test('unregister: removes detector', () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  r.register(makeStub({ id: 'a', priority: 1 }));
  assert.equal(r.unregister('a'), true);
  assert.equal(r.has('a'), false);
  assert.equal(r.unregister('nope'), false);
});

test('unregister: removes paired binding too', () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  r.register(makeStub({ id: 'primary', priority: 1 }));
  r.register(makeStub({ id: 'follower', trigger_event: 'paired', paired_with: 'primary' }));
  r.unregister('follower');
  assert.deepEqual(r.listForEvent('paired'), []);
});

// ─────────────────────────────────────────────────────────
// dispatch(user_turn) — ⭐ Sequential cascade
// ─────────────────────────────────────────────────────────

test('🛑 Sequential cascade: iterates by priority ascending, stops at first handled', async () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  const calls = [];
  r.register(makeStub({ id: 'p1', priority: 10, handler: () => { calls.push('p1'); return { handled: false }; } }));
  r.register(makeStub({ id: 'p2', priority: 20, handler: () => { calls.push('p2'); return { handled: true }; } }));
  r.register(makeStub({ id: 'p3', priority: 30, handler: () => { calls.push('p3'); return { handled: false }; } }));
  const results = await r.dispatch('user_turn', {});
  assert.deepEqual(calls, ['p1', 'p2'], 'p3 must not run — p2 already handled');
  assert.equal(results.length, 2);
  assert.equal(results[1].ok, true);
});

test('🛑 Sequential cascade: E1 deviation handled blocks E2 identity (via skipIfDeviationHandled)', async () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  const calls = [];
  // E1 sets deviation_handled_this_turn
  r.register(makeStub({
    id: 'E1',
    priority: CASCADE_PRIORITY.E1_deviation_pipeline,
    handler: (ctx) => {
      ctx.session_state.deviation_handled_this_turn = 'E1c';
      calls.push('E1');
      return { handled: false };  // mutates state but doesn't claim "handled" — cascade continues
    },
  }));
  // E2 has skip_if = skipIfDeviationHandled
  r.register(makeStub({
    id: 'E2',
    priority: CASCADE_PRIORITY.E2_identity_test_pipeline,
    skip_if: skipIfDeviationHandled,
    handler: () => { calls.push('E2'); return { handled: true }; },
  }));
  const ctx = { session_state: {} };
  const results = await r.dispatch('user_turn', ctx);
  assert.deepEqual(calls, ['E1'], 'E2 must skip because E1 set deviation_handled_this_turn');
  assert.equal(results.find(x => x.id === 'E2').skipped, true);
});

test('🛑 Sequential cascade: detector throw is caught, cascade continues (no session break)', async () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  const calls = [];
  r.register(makeStub({
    id: 'crashy',
    priority: 10,
    handler: () => { calls.push('crashy'); throw new Error('boom'); },
  }));
  r.register(makeStub({
    id: 'next',
    priority: 20,
    handler: () => { calls.push('next'); return { handled: true }; },
  }));
  const results = await r.dispatch('user_turn', {});
  assert.deepEqual(calls, ['crashy', 'next'], 'cascade must continue past the throw');
  assert.equal(results[0].ok, false);
  assert.ok(results[0].error instanceof Error);
  assert.equal(results[1].ok, true);
});

test('Sequential cascade: skip_if throw is treated as "do not skip" + logged', async () => {
  const log = [];
  const r = new DetectorRegistry({ logger: (event, payload) => log.push({ event, id: payload.detector_id }) });
  r.register(makeStub({
    id: 'd',
    priority: 1,
    skip_if: () => { throw new Error('skip-if-boom'); },
    handler: () => ({ handled: true }),
  }));
  const results = await r.dispatch('user_turn', {});
  assert.equal(results[0].ok, true, 'handler should still run');
  assert.ok(log.some(l => l.event === 'detector_skip_if_error' && l.id === 'd'));
});

test('Sequential cascade: handled triggers paired detectors in-line', async () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  const calls = [];
  r.register(makeStub({
    id: 'primary', priority: 1,
    handler: () => { calls.push('primary'); return { handled: true }; },
  }));
  r.register(makeStub({
    id: 'paired1', trigger_event: 'paired', paired_with: 'primary',
    handler: () => { calls.push('paired1'); return { handled: false }; },
  }));
  r.register(makeStub({
    id: 'paired2', trigger_event: 'paired', paired_with: 'primary',
    handler: () => { calls.push('paired2'); return { handled: false }; },
  }));
  // unrelated detector at higher priority number
  r.register(makeStub({
    id: 'after', priority: 100,
    handler: () => { calls.push('after'); return { handled: false }; },
  }));
  const results = await r.dispatch('user_turn', {});
  assert.deepEqual(calls, ['primary', 'paired1', 'paired2'], 'paired fire after primary, before cascade break');
  assert.ok(results.find(r => r.id === 'paired1').paired === true);
  assert.ok(results.find(r => r.id === 'paired2').paired === true);
  // after never runs (primary already handled)
  assert.equal(results.find(r => r.id === 'after'), undefined);
});

test('Sequential cascade: paired detector throw does not break primary success', async () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  r.register(makeStub({
    id: 'primary', priority: 1,
    handler: () => ({ handled: true }),
  }));
  r.register(makeStub({
    id: 'paired1', trigger_event: 'paired', paired_with: 'primary',
    handler: () => { throw new Error('paired-boom'); },
  }));
  const results = await r.dispatch('user_turn', {});
  assert.equal(results.find(r => r.id === 'primary').ok, true);
  assert.equal(results.find(r => r.id === 'paired1').ok, false);
});

test('Sequential cascade: no detectors → empty results', async () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  const results = await r.dispatch('user_turn', {});
  assert.deepEqual(results, []);
});

test('Sequential cascade: no handler returns "handled" → all detectors run', async () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  const calls = [];
  for (const p of [1, 2, 3]) {
    r.register(makeStub({
      id: `d${p}`, priority: p,
      handler: () => { calls.push(p); return { handled: false }; },
    }));
  }
  await r.dispatch('user_turn', {});
  assert.deepEqual(calls, [1, 2, 3]);
});

// ─────────────────────────────────────────────────────────
// dispatch(lifecycle) — parallel (all fire)
// ─────────────────────────────────────────────────────────

test('Lifecycle dispatch: all matching detectors fire (not stop-at-first)', async () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  const calls = [];
  r.register(makeStub({
    id: 'lc1', trigger_event: 'new_session_day',
    handler: () => { calls.push('lc1'); return { handled: true }; },
  }));
  r.register(makeStub({
    id: 'lc2', trigger_event: 'new_session_day',
    handler: () => { calls.push('lc2'); return { handled: true }; },
  }));
  await r.dispatch('new_session_day', {});
  assert.deepEqual(calls, ['lc1', 'lc2'], 'both lifecycle detectors must fire even when first claims handled');
});

test('Lifecycle dispatch: throw degrades, others continue', async () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  r.register(makeStub({
    id: 'lc1', trigger_event: 'session_end',
    handler: () => { throw new Error('boom'); },
  }));
  r.register(makeStub({
    id: 'lc2', trigger_event: 'session_end',
    handler: () => ({ handled: true }),
  }));
  const results = await r.dispatch('session_end', {});
  assert.equal(results.find(r => r.id === 'lc1').ok, false);
  assert.equal(results.find(r => r.id === 'lc2').ok, true);
});

test('Lifecycle dispatch: skip_if works', async () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  r.register(makeStub({
    id: 'lc1', trigger_event: 'new_session_day',
    skip_if: (ctx) => ctx.skip === true,
    handler: () => ({ handled: true }),
  }));
  const results = await r.dispatch('new_session_day', { skip: true });
  assert.equal(results[0].skipped, true);
});

// ─────────────────────────────────────────────────────────
// dispatch errors
// ─────────────────────────────────────────────────────────

test('dispatch: rejects unknown event', async () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  await assert.rejects(() => r.dispatch('bogus', {}), /unknown event/);
});

test('dispatch: rejects "paired" event (not directly dispatched)', async () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  await assert.rejects(() => r.dispatch('paired', {}), /not dispatched directly/);
});

// ─────────────────────────────────────────────────────────
// skipIfDeviationHandled (exported helper)
// ─────────────────────────────────────────────────────────

test('skipIfDeviationHandled: true when deviation_handled_this_turn is set', () => {
  assert.equal(skipIfDeviationHandled({ session_state: { deviation_handled_this_turn: 'E1c' } }), true);
});

test('skipIfDeviationHandled: false when null / undefined / missing', () => {
  assert.equal(skipIfDeviationHandled({ session_state: { deviation_handled_this_turn: null } }), false);
  assert.equal(skipIfDeviationHandled({ session_state: {} }), false);
  assert.equal(skipIfDeviationHandled({}), false);
  assert.equal(skipIfDeviationHandled(null), false);
});

// ─────────────────────────────────────────────────────────
// async handlers + ctx passing
// ─────────────────────────────────────────────────────────

test('handler can be async', async () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  r.register(makeStub({
    id: 'a', priority: 1,
    handler: async (ctx) => {
      await new Promise(resolve => setTimeout(resolve, 5));
      return { handled: true, echo: ctx.x };
    },
  }));
  const results = await r.dispatch('user_turn', { x: 'hello' });
  assert.equal(results[0].result.echo, 'hello');
});

test('handler receives the ctx passed to dispatch', async () => {
  const r = new DetectorRegistry({ logger: silentLogger() });
  let captured;
  r.register(makeStub({
    id: 'a', priority: 1,
    handler: (ctx) => { captured = ctx; return { handled: true }; },
  }));
  const ctx = { session_state: { foo: 1 }, custom: 'bar' };
  await r.dispatch('user_turn', ctx);
  assert.equal(captured, ctx);
});
