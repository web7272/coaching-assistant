// lib/api/anthropic-retry.test.js
// Patrick 6/3 — Lock 429 / 5xx retry behavior. 純函式、不打真實 Anthropic、sleep 注入.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  callAnthropicWithRetry,
  ANTHROPIC_RETRY_MAX,
  ANTHROPIC_BACKOFF_CAP,
  ANTHROPIC_5XX_RETRY_MS,
} from './anthropic-retry.js';

// ─── helpers ─────────────────────────────────────────────

/** Mock client that returns scripts[i] on the i-th call.
 *  Each script entry is either an Error to throw or a value to resolve. */
function makeClient(scripts) {
  let i = 0;
  return {
    callCount: () => i,
    messages: {
      create: async () => {
        if (i >= scripts.length) {
          const e = new Error('script exhausted');
          throw e;
        }
        const s = scripts[i++];
        if (s instanceof Error) throw s;
        return s;
      },
    },
  };
}

/** Build an HTTP-like error with status + optional retry-after header. */
function httpErr(status, { retryAfter, axiosStyle = false } = {}) {
  const e = new Error(`status_${status}`);
  if (axiosStyle) {
    e.response = { status };
  } else {
    e.status = status;
  }
  if (retryAfter !== undefined) e.headers = { 'retry-after': String(retryAfter) };
  return e;
}

/** Capture sleep() calls + return zero-delay impl. */
function captureSleeps() {
  const waits = [];
  return { waits, sleep: async (ms) => { waits.push(ms); } };
}

// ─── constants ───────────────────────────────────────────

test('🛑 ANTHROPIC_RETRY_MAX === 3 (Vivi 6/3 spec)', () => {
  assert.equal(ANTHROPIC_RETRY_MAX, 3);
});

test('🛑 ANTHROPIC_BACKOFF_CAP === 8000 (避免燒掉 60s timeout)', () => {
  assert.equal(ANTHROPIC_BACKOFF_CAP, 8000);
});

test('ANTHROPIC_5XX_RETRY_MS === 1000', () => {
  assert.equal(ANTHROPIC_5XX_RETRY_MS, 1000);
});

// ─── happy path ──────────────────────────────────────────

test('🛑 first try success → no retry, no sleep', async () => {
  const { waits, sleep } = captureSleeps();
  const client = makeClient([{ content: [{ text: 'ok' }] }]);
  const r = await callAnthropicWithRetry(client, {}, { sleep, log: () => {} });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 1);
  assert.deepEqual(r.data, { content: [{ text: 'ok' }] });
  assert.deepEqual(waits, []);
  assert.equal(client.callCount(), 1);
});

// ─── 429 retry ───────────────────────────────────────────

test('🛑 429 → backoff retry → eventual success on 3rd attempt', async () => {
  const { waits, sleep } = captureSleeps();
  const client = makeClient([
    httpErr(429),
    httpErr(429),
    { content: [{ text: 'finally' }] },
  ]);
  const r = await callAnthropicWithRetry(client, {}, { sleep, log: () => {} });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 3);
  assert.deepEqual(waits, [1000, 2000]);   // 2^0 * 1000, 2^1 * 1000
});

test('🛑 429 × 3 (exhausted) → return overload signal, no throw', async () => {
  const { waits, sleep } = captureSleeps();
  const client = makeClient([httpErr(429), httpErr(429), httpErr(429)]);
  const r = await callAnthropicWithRetry(client, {}, { sleep, log: () => {} });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'overload');
  assert.equal(r.attempts, 3);
  // exponential backoff: 1s, 2s, 4s (all under cap)
  assert.deepEqual(waits, [1000, 2000, 4000]);
});

test('🛑 429 with retry-after header → use it (in seconds)', async () => {
  const { waits, sleep } = captureSleeps();
  const client = makeClient([httpErr(429, { retryAfter: '3' }), { content: [{ text: 'ok' }] }]);
  const r = await callAnthropicWithRetry(client, {}, { sleep, log: () => {} });
  assert.equal(r.ok, true);
  assert.deepEqual(waits, [3000], 'retry-after 3 → 3000ms');
});

test('🛑 429 retry-after capped at 8s (避免燒掉 60s timeout)', async () => {
  const { waits, sleep } = captureSleeps();
  const client = makeClient([
    httpErr(429, { retryAfter: '30' }),        // 30s → cap to 8s
    { content: [{ text: 'ok' }] },
  ]);
  await callAnthropicWithRetry(client, {}, { sleep, log: () => {} });
  assert.deepEqual(waits, [8000]);
});

test('429 retry-after invalid / 0 → fall back to exponential backoff', async () => {
  const { waits, sleep } = captureSleeps();
  const client = makeClient([
    httpErr(429, { retryAfter: 'nope' }),      // garbage → fallback
    { content: [{ text: 'ok' }] },
  ]);
  await callAnthropicWithRetry(client, {}, { sleep, log: () => {} });
  assert.deepEqual(waits, [1000]);             // 2^0 * 1000
});

test('429 retry-after = "0" → fall back to backoff (treat as missing)', async () => {
  const { waits, sleep } = captureSleeps();
  const client = makeClient([
    httpErr(429, { retryAfter: '0' }),
    { content: [{ text: 'ok' }] },
  ]);
  await callAnthropicWithRetry(client, {}, { sleep, log: () => {} });
  assert.deepEqual(waits, [1000]);
});

// ─── 5xx retry ───────────────────────────────────────────

test('🛑 5xx (503) on attempt 0 → 1 retry → success', async () => {
  const { waits, sleep } = captureSleeps();
  const client = makeClient([httpErr(503), { content: [{ text: 'ok' }] }]);
  const r = await callAnthropicWithRetry(client, {}, { sleep, log: () => {} });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 2);
  assert.deepEqual(waits, [1000]);
});

test('🛑 5xx (500) → 5xx (502) (after retry) → throw (no 2nd retry for 5xx)', async () => {
  const { waits, sleep } = captureSleeps();
  const client = makeClient([httpErr(500), httpErr(502)]);
  await assert.rejects(
    () => callAnthropicWithRetry(client, {}, { sleep, log: () => {} }),
    (e) => e.status === 502,
  );
  assert.deepEqual(waits, [1000], '5xx fires retry wait once');
});

test('5xx (504 Gateway Timeout) → retry once → success', async () => {
  const { waits, sleep } = captureSleeps();
  const client = makeClient([httpErr(504), { content: [{ text: 'ok' }] }]);
  const r = await callAnthropicWithRetry(client, {}, { sleep, log: () => {} });
  assert.equal(r.ok, true);
  assert.deepEqual(waits, [1000]);
});

// ─── mixed: 429 then 5xx ────────────────────────────────

test('🛑 429 (attempt 0) → 5xx (attempt 1) → throw (5xx 在 attempt!=0 不 retry)', async () => {
  // attempt 0: 429 → wait 1s, continue
  // attempt 1: 503 → 5xx check, attempt!==0 → falls through → throw
  const { waits, sleep } = captureSleeps();
  const client = makeClient([httpErr(429), httpErr(503)]);
  await assert.rejects(
    () => callAnthropicWithRetry(client, {}, { sleep, log: () => {} }),
    (e) => e.status === 503,
  );
  assert.deepEqual(waits, [1000], 'only 429 backoff fired; 5xx-on-attempt-1 throws cleanly');
});

test('5xx (attempt 0) → 429 (attempt 1) → continues retry', async () => {
  // attempt 0: 503 → wait 1s, continue (5xx-on-0 retry)
  // attempt 1: 429 → backoff (2^1 * 1000 = 2000), continue
  // attempt 2: success
  const { waits, sleep } = captureSleeps();
  const client = makeClient([httpErr(503), httpErr(429), { content: [{ text: 'ok' }] }]);
  const r = await callAnthropicWithRetry(client, {}, { sleep, log: () => {} });
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 3);
  assert.deepEqual(waits, [1000, 2000]);
});

// ─── non-retry errors ────────────────────────────────────

test('🛑 4xx (not 429) → throw immediately, no retry, no sleep', async () => {
  const { waits, sleep } = captureSleeps();
  const client = makeClient([httpErr(400)]);
  await assert.rejects(
    () => callAnthropicWithRetry(client, {}, { sleep, log: () => {} }),
    (e) => e.status === 400,
  );
  assert.deepEqual(waits, []);
  assert.equal(client.callCount(), 1, 'no retry on 4xx');
});

test('401 → throw immediately', async () => {
  const { sleep } = captureSleeps();
  const client = makeClient([httpErr(401)]);
  await assert.rejects(() => callAnthropicWithRetry(client, {}, { sleep, log: () => {} }),
    (e) => e.status === 401);
});

test('403 → throw immediately', async () => {
  const { sleep } = captureSleeps();
  const client = makeClient([httpErr(403)]);
  await assert.rejects(() => callAnthropicWithRetry(client, {}, { sleep, log: () => {} }),
    (e) => e.status === 403);
});

test('non-HTTP error (no status) → throw immediately', async () => {
  const { sleep } = captureSleeps();
  const client = makeClient([new TypeError('network died')]);
  await assert.rejects(() => callAnthropicWithRetry(client, {}, { sleep, log: () => {} }),
    (e) => e instanceof TypeError);
});

// ─── status surfacing forms ──────────────────────────────

test('🛑 status from err.status (Anthropic SDK style)', async () => {
  const { waits, sleep } = captureSleeps();
  const client = makeClient([httpErr(429, { axiosStyle: false }), { content: [{ text: 'ok' }] }]);
  const r = await callAnthropicWithRetry(client, {}, { sleep, log: () => {} });
  assert.equal(r.ok, true);
  assert.equal(waits.length, 1);
});

test('🛑 status from err.response.status (axios style)', async () => {
  const { waits, sleep } = captureSleeps();
  const client = makeClient([httpErr(429, { axiosStyle: true }), { content: [{ text: 'ok' }] }]);
  const r = await callAnthropicWithRetry(client, {}, { sleep, log: () => {} });
  assert.equal(r.ok, true);
  assert.equal(waits.length, 1);
});

// ─── opts ────────────────────────────────────────────────

test('custom maxRetries=2 → 2 attempts, then overload', async () => {
  const { waits, sleep } = captureSleeps();
  const client = makeClient([httpErr(429), httpErr(429)]);
  const r = await callAnthropicWithRetry(client, {}, { sleep, log: () => {}, maxRetries: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'overload');
  assert.equal(r.attempts, 2);
  assert.deepEqual(waits, [1000, 2000]);
});

test('default sleep is real setTimeout (smoke: maxRetries=1 + success skips it)', async () => {
  // Without injected sleep, default path uses setTimeout. We don't want to time
  // real waits in tests, so just verify the default path is reachable on a
  // first-try success (zero sleeps).
  const client = makeClient([{ content: [{ text: 'ok' }] }]);
  const r = await callAnthropicWithRetry(client, {});
  assert.equal(r.ok, true);
  assert.equal(r.attempts, 1);
});

test('logger called with diagnostic on 429 retry', async () => {
  const logs = [];
  const { sleep } = captureSleeps();
  const client = makeClient([httpErr(429), { content: [{ text: 'ok' }] }]);
  await callAnthropicWithRetry(client, {}, { sleep, log: (m) => logs.push(m) });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /\[chat:429\].*attempt 1\/3.*wait 1000ms/);
});

test('logger called with diagnostic on 5xx retry', async () => {
  const logs = [];
  const { sleep } = captureSleeps();
  const client = makeClient([httpErr(502), { content: [{ text: 'ok' }] }]);
  await callAnthropicWithRetry(client, {}, { sleep, log: (m) => logs.push(m) });
  assert.equal(logs.length, 1);
  assert.match(logs[0], /\[chat:5xx\].*status=502.*wait 1000ms/);
});
