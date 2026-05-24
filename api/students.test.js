// api/students.test.js
// PR-4c-green Patrick 5/24 — surgical lock: GET, PATCH, and POST(create student)
// require a coach OAuth session; POST action='login' intentionally stays open
// (it's the v4-compat student login path with its own studentId+email auth).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, { _setSqlClient } from './students.js';
import { _setGetTokenFn } from '../lib/auth/coach-session.js';

// ── mock SQL + req/res helpers ──

function makeMockSql(rowsByCall = []) {
  // rowsByCall: either a single array (returned for every call) or an array of
  // arrays (returned in order, one per call).
  const calls = [];
  let callIdx = 0;
  const fn = (strings, ...values) => {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''),
      '',
    );
    calls.push({ strings: Array.from(strings), values, text });
    const rows = Array.isArray(rowsByCall[0])
      ? (rowsByCall[callIdx++] || [])
      : rowsByCall;
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
// 🛑 (a) Coach branches all require a coach session → 401 without one
// ═════════════════════════════════════════════════════════

test('🛑 students.js GET (list): no session → 401', async () => {
  _setGetTokenFn(async () => null);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: {} }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(sql.calls.length, 0, 'GET list must not touch DB without coach session');
});

test('🛑 students.js GET (single by studentId): no session → 401', async () => {
  _setGetTokenFn(async () => null);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: { studentId: 'A001' } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(sql.calls.length, 0);
});

test('🛑 students.js PATCH (edit student): no session → 401', async () => {
  _setGetTokenFn(async () => null);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', plan: 'plan_a' },
  }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(sql.calls.length, 0);
});

test('🛑 students.js POST (create student, no action): no session → 401', async () => {
  _setGetTokenFn(async () => null);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'POST',
    body: { email: 'new@example.com', plan: 'trial' },   // no `action: 'login'`
  }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(sql.calls.length, 0, 'create student must not touch DB without coach session');
});

test('🛑 students.js wrong email in token → 401 (not any signed Google account)', async () => {
  _setGetTokenFn(async () => ({ email: 'random@example.com' }));
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: {} }), res);
  assert.equal(res.statusCode, 401);
});

// ═════════════════════════════════════════════════════════
// 🛑 (b) POST action='login' stays OPEN (no coach session needed)
// ═════════════════════════════════════════════════════════

test('🛑 students.js POST action=login: no coach session + valid creds → 200 (login still works)', async () => {
  // Critical regression-prevention: locking this file must NOT break student
  // login. The login branch authenticates with student_id + email match.
  _setGetTokenFn(async () => null);   // explicitly NO coach session
  _setSqlClient(makeMockSql([{
    student_id: 'A001',
    email: 'vivi@example.com',
    current_module: 'self',
    current_week: 1,
    current_day: 3,
    plan: 'plan_a',
    tier: 1,
  }]));
  const res = mockRes();
  await handler(mockReq({
    method: 'POST',
    body: { action: 'login', studentId: 'A001', email: 'vivi@example.com' },
  }), res);
  assert.equal(res.statusCode, 200, 'student login must pass even without coach session');
  assert.equal(res.body.student.student_id, 'A001');
  assert.equal(res.body.student.current_day, 3);
  // Login intentionally doesn't return email to the client
  assert.equal(res.body.student.email, undefined);
});

test('🛑 students.js POST action=login: bad credentials → 401 (own auth, not the coach gate)', async () => {
  // The 401 here is from the login auth (mismatched email), not the coach gate.
  // Both yield 401 but the login branch returns AUTH_FAILED.
  _setGetTokenFn(async () => null);
  _setSqlClient(makeMockSql([{
    student_id: 'A001',
    email: 'stored@example.com',
    current_module: 'self', current_week: 1, current_day: 1,
    plan: 'trial', tier: 0,
  }]));
  const res = mockRes();
  await handler(mockReq({
    method: 'POST',
    body: { action: 'login', studentId: 'A001', email: 'wrong@example.com' },
  }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'AUTH_FAILED',
    'login bad-creds error code preserved (not the coach gate\'s "Unauthorized")');
});

test('🛑 students.js POST action=login: malformed input → 400 (own validation, not the gate)', async () => {
  _setGetTokenFn(async () => null);
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({
    method: 'POST',
    body: { action: 'login', studentId: 'not-a-format', email: 'x@example.com' },
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_INPUT');
});

// ═════════════════════════════════════════════════════════
// (c) Authorized coach → existing branches still work
// ═════════════════════════════════════════════════════════

test('students.js GET (list) authorized → 200 with students array', async () => {
  _setGetTokenFn(async () => ({ email: 'patrick@example.com' }));
  // Two-call dance: students list, then sessions stats (or fallback)
  _setSqlClient(makeMockSql([
    [{ student_id: 'A001', email: 'a@b.com', plan: 'trial' }],   // SELECT * FROM students
    [{ student_id: 'A001', days_completed: '3', last_active: '2026-05-23' }],   // sessions stats
  ]));
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: {} }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.students), 'students array shape preserved');
  assert.equal(res.body.students[0].student_id, 'A001');
});

test('students.js POST create student authorized → 200 with new studentId', async () => {
  _setGetTokenFn(async () => ({ email: 'patrick@example.com' }));
  _setSqlClient(makeMockSql([
    [],   // email dup check: none
    [{ student_id: 'A042' }],   // last A### query
    [],   // INSERT returns nothing
  ]));
  const res = mockRes();
  await handler(mockReq({
    method: 'POST',
    body: { email: 'new@example.com', plan: 'trial' },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.studentId, 'A043');
});

test('students.js PATCH authorized → 200', async () => {
  _setGetTokenFn(async () => ({ email: 'patrick@example.com' }));
  _setSqlClient(makeMockSql([
    [{ student_id: 'A001' }],   // exists check
    [],                          // UPDATE
  ]));
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', plan: 'plan_a' },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
});

test('students.js: unknown method (coach authorized) → 405', async () => {
  _setGetTokenFn(async () => ({ email: 'patrick@example.com' }));
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ method: 'DELETE' }), res);
  assert.equal(res.statusCode, 405);
});
