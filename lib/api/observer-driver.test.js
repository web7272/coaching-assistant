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

// ═════════════════════════════════════════════════════════
// 🔴 6/13 Stage B 修 — parallelization (avoid finalize 60s timeout)
// ═════════════════════════════════════════════════════════

// Build a many-turn session (30 Q/A pairs). Used for concurrency + budget tests.
function makeManyTurnMessages(n) {
  const msgs = [];
  for (let i = 0; i < n; i++) {
    msgs.push({ role: 'assistant', content: `q${i}`, question_number: i });
    msgs.push({ role: 'user',      content: `a${i}`, question_number: i });
  }
  return msgs;
}

test('🔴 parallel vs sequential same input → SAME accumulated/step_evidence (order-preserving fold)', async () => {
  // Mock that varies per-turn output (values + step + reframe + top1 on turn 3).
  const judgeFn = async ({ turn }) => {
    const i = turn.question_number;
    const out = fakeObservation();
    out.values_surfaced = [`v_${i % 3}`];           // some overlap → dedup test
    out.owned_confirmed = i % 5 === 0 ? [`o_${i}`] : [];
    out.top1_determined = i === 3 ? 'TOP_AT_3' : (i === 7 ? 'TOP_LATER' : null);
    out.step_evidence[`step_${(i % 7) + 1}`] = [{ type: 'pain_surface', quote: `q${i}` }];
    out.reframe_events = i % 4 === 0
      ? [{ type: 'sovereignty', quote: `r${i}` }] : [];
    return out;
  };
  const messages = makeManyTurnMessages(20);

  // Sequential = concurrency 1.
  const seq = await runObserverOverSession({
    messages, now_iso: 't', judgeFn, concurrency: 1, softBudgetMs: 60_000,
  });
  // Parallel = concurrency 6.
  const par = await runObserverOverSession({
    messages, now_iso: 't', judgeFn, concurrency: 6, softBudgetMs: 60_000,
  });
  assert.deepEqual(par.accumulated.values, seq.accumulated.values,
    'accumulated.values must match sequential');
  assert.deepEqual(par.accumulated.owned, seq.accumulated.owned);
  assert.equal(par.accumulated.top1, seq.accumulated.top1, 'first top1 wins same');
  assert.deepEqual(par.accumulated.steps_touched.sort(), seq.accumulated.steps_touched.sort());
  // step_evidence per step entries in same order (fold-by-original-index).
  for (let n = 1; n <= 7; n++) {
    assert.deepEqual(par.step_evidence[`step_${n}`], seq.step_evidence[`step_${n}`],
      `step_${n} entries identical order`);
  }
  assert.equal(par.sc_journey_step, seq.sc_journey_step);
  assert.equal(par.judged_count, seq.judged_count);
});

test('🔴 concurrency cap respected — at most N inflight at once', async () => {
  let inflight = 0;
  let peakInflight = 0;
  const judgeFn = async () => {
    inflight++;
    if (inflight > peakInflight) peakInflight = inflight;
    // small async tick so multiple promises actually overlap.
    await new Promise(r => setImmediate(r));
    inflight--;
    return fakeObservation();
  };
  await runObserverOverSession({
    messages: makeManyTurnMessages(30),
    now_iso: 't',
    judgeFn,
    concurrency: 4,
    softBudgetMs: 60_000,
  });
  assert.ok(peakInflight <= 4, `peak inflight should be ≤ 4, got ${peakInflight}`);
  assert.ok(peakInflight >= 2, `should actually use concurrency (got peak ${peakInflight} — too sequential)`);
});

test('🔴 pre-LLM skip BEFORE dispatch — crisis/noise turns don\'t hit judgeFn', async () => {
  // Build a session where one turn has high-risk content + one has meta-complaint.
  // observer.shouldSkipPreLLM (called by driver) must filter these out BEFORE
  // judgeFn ever runs.
  const msgs = [
    { role: 'assistant', content: 'q1', question_number: 1 },
    { role: 'user',      content: '我想自殺', question_number: 1 },     // high_risk
    { role: 'assistant', content: 'q2', question_number: 2 },
    { role: 'user',      content: '為什麼一直問同樣的問題', question_number: 2 }, // meta
    { role: 'assistant', content: 'q3', question_number: 3 },
    { role: 'user',      content: '我發現我其實很在意自由', question_number: 3 }, // normal
  ];
  const dispatched = [];
  const judgeFn = async ({ turn }) => {
    dispatched.push(turn.user);
    return fakeObservation({ values: ['自由'] });
  };
  const r = await runObserverOverSession({
    messages: msgs,
    now_iso: 't',
    judgeFn,
    concurrency: 4,
    softBudgetMs: 60_000,
  });
  // 🔴 LLM optimization: only the NORMAL turn actually hit judgeFn (1 LLM call).
  // The other 2 turns short-circuited via observer.shouldSkipPreLLM (0 LLM call).
  // This is the cost saving the parallelization brings — pre-filter saves Haiku $.
  assert.equal(dispatched.length, 1, '🔴 pre-LLM filter must short-circuit BEFORE judgeFn dispatch');
  assert.equal(dispatched[0], '我發現我其實很在意自由');
  // skip_counts reflects pre-LLM skips (driver replicates observer.shouldSkipPreLLM).
  assert.equal(r.skip_counts.high_risk, 1);
  assert.equal(r.skip_counts.meta_complaint, 1);
  // judged_count counts ALL turns that produced an observation (matches sequential
  // semantic where judgeFn() returns synthetic skip-obs for pre-LLM skip turns).
  // dispatched.length above is what tracks actual LLM API calls.
  assert.equal(r.judged_count, 3, 'all 3 turns produced observation (1 dispatched + 2 pre-skip synthetic)');
  assert.deepEqual(r.accumulated.values, ['自由']);
});

test('🔴 soft budget hit → remaining turns deferred, budget_hit=true, fail-soft (no error)', async () => {
  // Inject a clock that advances 5 seconds per call to simulate slow judges.
  // softBudgetMs = 10s → after 2-3 batches, budget hit.
  let now = 1000;
  const clockNowMs = () => { now += 5000; return now; };
  const judgeFn = async () => fakeObservation();
  const logs = [];
  const r = await runObserverOverSession({
    messages: makeManyTurnMessages(30),
    now_iso: 't',
    judgeFn,
    concurrency: 6,
    softBudgetMs: 10_000,    // tight budget
    clockNowMs,
    log: (m) => logs.push(m),
  });
  assert.equal(r.budget_hit, true);
  assert.ok(r.budget_deferred_count > 0,
    `budget_deferred_count should be > 0, got ${r.budget_deferred_count}`);
  // Some turns DID get judged (early batches).
  assert.ok(r.judged_count > 0, `judged_count should be > 0, got ${r.judged_count}`);
  // judged + deferred = total (no over/undercounting).
  assert.equal(r.judged_count + r.budget_deferred_count, r.turns_count);
  // Log line recorded.
  assert.ok(logs.some(m => /soft budget.+hit/.test(m)),
    'must log budget hit notice');
});

test('🔴 judge throws → that turn flagged null, OTHERS continue (parallel fail-soft)', async () => {
  const judgeFn = async ({ turn }) => {
    if (turn.question_number === 1) throw new Error('boom on q1');
    return fakeObservation({ values: ['平靜'] });
  };
  const logs = [];
  const r = await runObserverOverSession({
    messages: sampleMessages,    // q1 + q2
    now_iso: 't',
    judgeFn,
    concurrency: 4,
    log: (m) => logs.push(m),
  });
  // q1 threw, q2 succeeded.
  assert.equal(r.judged_count, 1);
  assert.deepEqual(r.accumulated.values, ['平靜']);
  assert.ok(logs.some(m => /judge threw/.test(m)));
});

test('🔴 elapsed_ms reported (for finalize-day cost visibility)', async () => {
  let now = 1000;
  const clockNowMs = () => { now += 100; return now; };
  const judgeFn = async () => fakeObservation();
  const r = await runObserverOverSession({
    messages: sampleMessages,
    now_iso: 't',
    judgeFn,
    clockNowMs,
  });
  // 5 clock advances minimum (start + dispatch pass + per-batch budget check + fold start + fold end)
  // Just assert it's a positive number, exact value depends on impl detail.
  assert.ok(typeof r.elapsed_ms === 'number');
  assert.ok(r.elapsed_ms >= 0);
});

test('🛑 DEFAULT_CONCURRENCY = 6 + DEFAULT_SOFT_BUDGET_MS = 25_000 (Patrick 拍板)', async () => {
  const mod = await import('./observer-driver.js');
  assert.equal(mod.DEFAULT_CONCURRENCY, 6);
  assert.equal(mod.DEFAULT_SOFT_BUDGET_MS, 25_000);
});
