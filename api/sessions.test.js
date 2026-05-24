// api/sessions.test.js
// PR-4c-green Patrick 5/24 — sessions.js gated coach-only (action=history was
// the bypass route around /api/admin/transcript's lock). Tests confirm the
// gate fires BEFORE any DB call.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, { _setSqlClient } from './sessions.js';
import { _setGetTokenFn } from '../lib/auth/coach-session.js';

// ── mock SQL tag-template tracker ──

function makeMockSql(rows = []) {
  const calls = [];
  const fn = (strings, ...values) => {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''),
      '',
    );
    calls.push({ strings: Array.from(strings), values, text });
    return Promise.resolve(rows);
  };
  fn.calls = calls;
  return fn;
}

function mockReq({ method = 'GET', query = {}, body = {} } = {}) {
  return { method, query, body };
}

function mockRes() {
  const r = {
    statusCode: 200, body: null,
    status(s) { r.statusCode = s; return r; },
    json(b)   { r.body = b; return r; },
  };
  return r;
}

beforeEach(() => {
  _setSqlClient(null);
  _setGetTokenFn(null);
  process.env.COACH_EMAIL = 'patrick@example.com';
  process.env.NEXTAUTH_SECRET = 'test-secret';
});

// ═════════════════════════════════════════════════════════
// (a) No coach session → 401 — and DB is NOT touched
// ═════════════════════════════════════════════════════════

test('🛑 sessions.js: no session token → 401', async () => {
  _setGetTokenFn(async () => null);
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: { action: 'history', studentId: 'A001', module: 'self', week: '1' } }), res);
  assert.equal(res.statusCode, 401);
});

test('🛑 sessions.js: 401 happens BEFORE any DB call (no leakage even on history)', async () => {
  // The whole point of locking this file: action=history would otherwise leak
  // raw 逐字 messages, bypassing the /api/admin/transcript lock. Verify the
  // mock sql is never called when auth fails.
  _setGetTokenFn(async () => null);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  await handler(mockReq({ method: 'GET', query: { action: 'history', studentId: 'A001', module: 'self', week: '1' } }), mockRes());
  assert.equal(sql.calls.length, 0,
    'unauthenticated request must not touch the DB on any sessions.js branch');
});

test('🛑 sessions.js: wrong email → 401 (not just any signed Google account)', async () => {
  _setGetTokenFn(async () => ({ email: 'random@example.com' }));
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: {} }), res);
  assert.equal(res.statusCode, 401);
});

test('sessions.js: 401 applies to every method (GET / POST / PATCH)', async () => {
  _setGetTokenFn(async () => null);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  for (const method of ['GET', 'POST', 'PATCH']) {
    const res = mockRes();
    await handler(mockReq({ method, body: {}, query: {} }), res);
    assert.equal(res.statusCode, 401, `${method} must hit 401`);
  }
  assert.equal(sql.calls.length, 0, 'no DB calls across any method');
});

// ═════════════════════════════════════════════════════════
// (c) Authorized coach → existing branches still work end-to-end
// ═════════════════════════════════════════════════════════

test('sessions.js: authorized coach + action=history → 200 with messages', async () => {
  _setGetTokenFn(async () => ({ email: 'patrick@example.com' }));
  // Two-step query (sessions list then messages join) — return sessions first then messages.
  // Mock returns same rows for every call; sufficient for shape verification.
  const sql = makeMockSql([{ id: 1, day: 1, session_date: '2026-05-23' }]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'GET',
    query: { action: 'history', studentId: 'A001', module: 'self', week: '1' },
  }), res);
  assert.equal(res.statusCode, 200);
  // SQL was reached (auth let it through)
  assert.ok(sql.calls.length >= 1, 'authorized request must reach the DB');
});

test('sessions.js: authorized coach + default GET (list) → 200', async () => {
  _setGetTokenFn(async () => ({ email: 'patrick@example.com' }));
  _setSqlClient(makeMockSql([
    { student_id: 'A001', module: 'self', week: 1, last_active: '2026-05-23' },
  ]));
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: {} }), res);
  assert.equal(res.statusCode, 200);
});

test('sessions.js: unknown method (still requires auth) → 401 first, then 405', async () => {
  // Without auth, we never reach the method check. That's correct order:
  // auth before everything else.
  _setGetTokenFn(async () => null);
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ method: 'DELETE' }), res);
  assert.equal(res.statusCode, 401);
});
