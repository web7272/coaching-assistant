// api/students.test.js
// PR-4c-green Patrick 5/24 — surgical lock: GET, PATCH, and POST(create student)
// require a coach OAuth session; POST action='login' intentionally stays open
// (it's the v4-compat student login path with its own studentId+email auth).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, { _setSqlClient } from './students.js';
import { _setCoachSessionReader } from '../lib/auth/coach-session.js';

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

// Auth rebuild stage 1a: HMAC session model. The reader returns a payload like
// {role:'coach'} (authorized) or null (not). Old getToken({email:...}) shape gone.
const COACH_OK = async () => ({ role: 'coach' });
const NO_SESSION = async () => null;

beforeEach(() => {
  _setSqlClient(null);
  _setCoachSessionReader(null);
  process.env.SESSION_SECRET = 'test-secret-32-bytes-of-entropy-aaaaaaaa';
});

// ═════════════════════════════════════════════════════════
// 🛑 (a) Coach branches all require a coach session → 401 without one
// ═════════════════════════════════════════════════════════

test('🛑 students.js GET (list): no session → 401', async () => {
  _setCoachSessionReader(NO_SESSION);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: {} }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(sql.calls.length, 0, 'GET list must not touch DB without coach session');
});

test('🛑 students.js GET (single by studentId): no session → 401', async () => {
  _setCoachSessionReader(NO_SESSION);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: { studentId: 'A001' } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(sql.calls.length, 0);
});

test('🛑 students.js PATCH (edit student): no session → 401', async () => {
  _setCoachSessionReader(NO_SESSION);
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
  _setCoachSessionReader(NO_SESSION);
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

test('🛑 students.js wrong-role session (e.g. student) → 401', async () => {
  // PR-4c-green Auth rebuild stage 1a: email-allowlist gate replaced by role gate.
  _setCoachSessionReader(async () => ({ role: 'student', sid: 'A001' }));
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: {} }), res);
  assert.equal(res.statusCode, 401);
});

// ═════════════════════════════════════════════════════════
// 🛑 (b) POST action='login' RETIRED — replaced by magic link in stage 1d
// ═════════════════════════════════════════════════════════
// The v4-compat student login path (POST students.js with action=login) was
// removed in 1d. Student login now uses /api/auth/request-link → email →
// /api/auth/verify-link → sets student_session cookie. Any POST to /api/students
// without a coach session → 401 from the coach gate, including a POST that
// claims action=login (the special-casing is gone).

test('🛑 students.js POST action=login: retired — now 401 from coach gate (no special case)', async () => {
  _setCoachSessionReader(NO_SESSION);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'POST',
    body: { action: 'login', studentId: 'A001', email: 'vivi@example.com' },
  }), res);
  assert.equal(res.statusCode, 401, 'action=login no longer accepted; coach gate fires');
  assert.equal(sql.calls.length, 0, 'no DB query — gate fires before any work');
});

// ═════════════════════════════════════════════════════════
// (c) Authorized coach → existing branches still work
// ═════════════════════════════════════════════════════════

test('students.js GET (list) authorized → 200 with students array', async () => {
  _setCoachSessionReader(COACH_OK);
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
  _setCoachSessionReader(COACH_OK);
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
  _setCoachSessionReader(COACH_OK);
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
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ method: 'DELETE' }), res);
  assert.equal(res.statusCode, 405);
});
