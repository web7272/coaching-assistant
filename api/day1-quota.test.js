// api/day1-quota.test.js — Patrick 6/7 §3 public quota readout endpoint.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, {
  _setSqlClient, _resetResponseCache, RESPONSE_TTL_MS, taipeiMonthString,
} from './day1-quota.js';
import { _resetQuotaCache, DEFAULT_DAY1_QUOTA } from '../lib/api/day1-quota.js';

// ─── Mock helpers ──────────────────────────────────────────────────

function mkSqlByTopic(planFn) {
  const calls = [];
  const fn = (strings, ..._values) => {
    const text = strings.join('?');
    calls.push({ text, values: _values });
    return Promise.resolve(planFn(text, _values));
  };
  fn.calls = calls;
  return fn;
}

function mkReqRes(method = 'GET') {
  let statusCode = 0;
  let payload = null;
  const res = {
    status(c) { statusCode = c; return res; },
    json(b)   { payload = b;     return res; },
    get statusCode() { return statusCode; },
    get payload()    { return payload; },
  };
  return { req: { method }, res };
}

beforeEach(() => {
  _setSqlClient(null);
  _resetResponseCache();
  _resetQuotaCache();
  delete process.env.DAY1_QUOTA;
});

// ─── taipeiMonthString ────────────────────────────────────────────

test('🛑 6/7 taipeiMonthString: returns YYYY-MM format', () => {
  const out = taipeiMonthString();
  assert.match(out, /^\d{4}-\d{2}$/);
});

test('🛑 6/7 taipeiMonthString: respects Asia/Taipei offset', () => {
  // 2026-06-01T00:00:00 UTC = 2026-06-01T08:00:00 Asia/Taipei → same month.
  assert.equal(taipeiMonthString(new Date('2026-06-01T00:00:00Z')), '2026-06');
  // 2026-05-31T18:00:00 UTC = 2026-06-01T02:00:00 Asia/Taipei → month rolls forward.
  assert.equal(taipeiMonthString(new Date('2026-05-31T18:00:00Z')), '2026-06');
  // 2026-05-31T15:00:00 UTC = 2026-05-31T23:00:00 Asia/Taipei → still May.
  assert.equal(taipeiMonthString(new Date('2026-05-31T15:00:00Z')), '2026-05');
});

// ─── method guard ────────────────────────────────────────────────

test('🛑 6/7 endpoint: non-GET → 405', async () => {
  const { req, res } = mkReqRes('POST');
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

// ─── response shape ──────────────────────────────────────────────

test('🛑 6/7 endpoint: shape = {quota, used, remaining, month}', async () => {
  _setSqlClient(mkSqlByTopic((text) => {
    if (/app_config/.test(text))      return [{ value: '300' }];
    if (/COUNT\(DISTINCT/.test(text)) return [{ used: 42 }];
    return [];
  }));

  const { req, res } = mkReqRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  const b = res.payload;
  assert.equal(typeof b.quota,     'number');
  assert.equal(typeof b.used,      'number');
  assert.equal(typeof b.remaining, 'number');
  assert.match (b.month, /^\d{4}-\d{2}$/);
  assert.equal(b.quota,     300);
  assert.equal(b.used,      42);
  assert.equal(b.remaining, 258);
});

// ─── remaining clamping ──────────────────────────────────────────

test('🛑 6/7 endpoint: remaining clamped to >= 0 even with overage', async () => {
  // Soft cap behaviour: used can exceed quota briefly. Public response
  // must never expose a negative number — landing UI would render bad.
  _setSqlClient(mkSqlByTopic((text) => {
    if (/app_config/.test(text))      return [{ value: '100' }];
    if (/COUNT\(DISTINCT/.test(text)) return [{ used: 117 }];   // 17 over
    return [];
  }));
  const { req, res } = mkReqRes();
  await handler(req, res);
  assert.equal(res.payload.quota,     100);
  assert.equal(res.payload.used,      117);
  assert.equal(res.payload.remaining, 0);
});

// ─── quota source order: SQL > env > default ──────────────────────

test('🛑 6/7 endpoint: SQL app_config beats env beats default', async () => {
  process.env.DAY1_QUOTA = '999';   // env should LOSE to SQL.
  _setSqlClient(mkSqlByTopic((text) => {
    if (/app_config/.test(text))      return [{ value: '250' }];   // SQL wins
    if (/COUNT\(DISTINCT/.test(text)) return [{ used: 10 }];
    return [];
  }));
  const { req, res } = mkReqRes();
  await handler(req, res);
  assert.equal(res.payload.quota, 250);
});

test('🛑 6/7 endpoint: no SQL row → env fallback', async () => {
  process.env.DAY1_QUOTA = '777';
  _setSqlClient(mkSqlByTopic((text) => {
    if (/app_config/.test(text))      return [];                   // missing
    if (/COUNT\(DISTINCT/.test(text)) return [{ used: 0 }];
    return [];
  }));
  const { req, res } = mkReqRes();
  await handler(req, res);
  assert.equal(res.payload.quota, 777);
});

test('🛑 6/7 endpoint: no SQL + no env → default 1000', async () => {
  _setSqlClient(mkSqlByTopic((text) => {
    if (/app_config/.test(text))      return [];
    if (/COUNT\(DISTINCT/.test(text)) return [{ used: 0 }];
    return [];
  }));
  const { req, res } = mkReqRes();
  await handler(req, res);
  assert.equal(res.payload.quota, DEFAULT_DAY1_QUOTA);
  assert.equal(res.payload.quota, 1000);
});

// ─── response-level cache ────────────────────────────────────────

test('🛑 6/7 endpoint: response cached within TTL (no DB hit on 2nd call)', async () => {
  let countCalls = 0;
  _setSqlClient(mkSqlByTopic((text) => {
    if (/app_config/.test(text)) return [{ value: '200' }];
    if (/COUNT\(DISTINCT/.test(text)) { countCalls++; return [{ used: 5 }]; }
    return [];
  }));

  const r1 = mkReqRes(); await handler(r1.req, r1.res);
  const r2 = mkReqRes(); await handler(r2.req, r2.res);

  assert.equal(r1.res.payload.quota, 200);
  assert.equal(r2.res.payload.quota, 200);
  assert.equal(countCalls, 1, '2nd call hits cache, not DB');
});

test('🛑 6/7 endpoint: cache TTL is documented 30s', () => {
  assert.equal(RESPONSE_TTL_MS, 30_000);
});

// ─── fail-open ──────────────────────────────────────────────────

test('🛑 6/7 endpoint: SQL throws → fail-open with defaults (still 200)', async () => {
  _setSqlClient(() => Promise.reject(new Error('db down')));
  const { req, res } = mkReqRes();
  await handler(req, res);

  // Status 200 — landing card must always render.
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.quota,     DEFAULT_DAY1_QUOTA);
  assert.equal(res.payload.used,      0);
  assert.equal(res.payload.remaining, DEFAULT_DAY1_QUOTA);
  assert.match (res.payload.month, /^\d{4}-\d{2}$/);
});

test('🛑 6/7 endpoint: fail-open response is NOT cached (next call retries DB)', async () => {
  let phase = 'fail';
  _setSqlClient(mkSqlByTopic((text) => {
    if (phase === 'fail') throw new Error('db down');
    if (/app_config/.test(text))      return [{ value: '50' }];
    if (/COUNT\(DISTINCT/.test(text)) return [{ used: 3 }];
    return [];
  }));

  const r1 = mkReqRes(); await handler(r1.req, r1.res);
  assert.equal(r1.res.payload.quota, DEFAULT_DAY1_QUOTA);   // fail-open default

  phase = 'ok';
  const r2 = mkReqRes(); await handler(r2.req, r2.res);
  assert.equal(r2.res.payload.quota, 50);                   // retries DB, gets real value
});

// ─── no PII leaked ───────────────────────────────────────────────

test('🛑 6/7 endpoint: response keys are only {quota, used, remaining, month} — no PII', async () => {
  _setSqlClient(mkSqlByTopic((text) => {
    if (/app_config/.test(text))      return [{ value: '100' }];
    if (/COUNT\(DISTINCT/.test(text)) return [{ used: 1 }];
    return [];
  }));
  const { req, res } = mkReqRes();
  await handler(req, res);
  const keys = Object.keys(res.payload).sort();
  assert.deepEqual(keys, ['month', 'quota', 'remaining', 'used']);
});
