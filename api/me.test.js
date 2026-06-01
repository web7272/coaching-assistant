// api/me.test.js
// PR-4c-green Auth rebuild 1h — /api/me endpoint tests.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, { _setSqlClient } from './me.js';
import { _setStudentSessionReader } from '../lib/auth/student-session.js';

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

function mockReq({ method = 'GET' } = {}) {
  return { method, query: {}, body: {}, headers: {} };
}
function mockRes() {
  const r = {
    statusCode: 200, body: null,
    status(s) { r.statusCode = s; return r; },
    json(b)   { r.body = b; return r; },
  };
  return r;
}

const SESSION_FOR = (sid) => async () => ({ role: 'student', sid });
const NO_SESSION  = async () => null;

beforeEach(() => {
  _setSqlClient(null);
  _setStudentSessionReader(null);
  process.env.SESSION_SECRET = 'test-secret-32-bytes-of-entropy-aaaaaaaa';
});

// ── auth ──

test('🛑 /api/me: no session → 401 (boot treats as not logged in)', async () => {
  _setStudentSessionReader(NO_SESSION);
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 401);
});

test('🛑 /api/me: 401 happens BEFORE DB query (no leak)', async () => {
  _setStudentSessionReader(NO_SESSION);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  await handler(mockReq(), mockRes());
  assert.equal(sql.calls.length, 0);
});

test('🛑 /api/me: coach session → 401 (cross-role defense)', async () => {
  _setStudentSessionReader(async () => ({ role: 'coach' }));
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 401);
  assert.equal(sql.calls.length, 0);
});

// ── happy path ──

test('🛑 /api/me: valid session → 200 with {studentId, module, currentDay, preferredName, pace}', async () => {
  _setStudentSessionReader(SESSION_FOR('A001'));
  _setSqlClient(makeMockSql([{
    student_id:     'A001',
    current_module: 'self',
    current_day:    3,
    preferred_name: 'Vivi',
    pace:           'self-paced',
  }]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    studentId:     'A001',
    module:        'self',
    currentDay:    3,
    preferredName: 'Vivi',
    pace:          'self-paced',
  });
});

test('/api/me: minimal student row → defaults filled in (currentDay=1, pace=daily)', async () => {
  _setStudentSessionReader(SESSION_FOR('A042'));
  _setSqlClient(makeMockSql([{
    student_id:     'A042',
    current_module: null,
    current_day:    null,
    preferred_name: null,
    pace:           null,
  }]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    studentId: 'A042', module: 'self', currentDay: 1,
    preferredName: null, pace: 'daily',
  });
});

// ── edge: session valid but student row deleted ──

test('🛑 /api/me: session valid but student row gone → 401 (force re-login)', async () => {
  // Admin could delete a student row while their cookie is still valid;
  // treat as 401 so the SPA boot routes to entry (clean state).
  _setStudentSessionReader(SESSION_FOR('A999'));
  _setSqlClient(makeMockSql([]));   // SELECT returns 0 rows
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 401);
});

// ── SQL shape ──

test('/api/me: SQL queries by sid from session, not by anything client-supplied', async () => {
  _setStudentSessionReader(SESSION_FOR('A007'));
  const sql = makeMockSql([{
    student_id: 'A007', current_module: 'self', current_day: 1,
    preferred_name: null, pace: 'daily',
  }]);
  _setSqlClient(sql);
  await handler(mockReq(), mockRes());
  // Single SELECT bound to sid
  assert.equal(sql.calls.length, 1);
  assert.deepEqual(sql.calls[0].values, ['A007']);
  assert.match(sql.calls[0].text, /WHERE student_id = \$1/);
});

// ── method ──

test('/api/me: non-GET → 405', async () => {
  _setStudentSessionReader(SESSION_FOR('A001'));
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ method: 'POST' }), res);
  assert.equal(res.statusCode, 405);
});

// ═════════════════════════════════════════════════════════
// 🛑 5/29 Patrick (Vivi access gate) — is_blocked → 403 beta_access_ended
// ═════════════════════════════════════════════════════════

test('🛑 /api/me: is_blocked=true → 403 beta_access_ended', async () => {
  _setStudentSessionReader(SESSION_FOR('A001'));
  _setSqlClient(makeMockSql([
    { student_id: 'A001', current_module: 'self', current_day: 5,
      preferred_name: 'Vivi', pace: 'daily', is_blocked: true },
  ]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'beta_access_ended');
  assert.match(res.body.message, /封測權限已結束/);
});

test('🛑 /api/me: is_blocked=false → 200 (normal flow, blocked field never leaks to response)', async () => {
  _setStudentSessionReader(SESSION_FOR('A001'));
  _setSqlClient(makeMockSql([
    { student_id: 'A001', current_module: 'self', current_day: 5,
      preferred_name: 'Vivi', pace: 'daily', is_blocked: false },
  ]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.studentId, 'A001');
  // Response shape stays minimal — is_blocked is never echoed back to client.
  assert.equal('is_blocked' in res.body, false,
    'response must not echo is_blocked (避免洩漏 access 狀態給 attacker probing)');
});
