// api/journey.test.js
// PR-4c-green 5/25 fix (Vivi: 教練後台所有學員顯示同一人) —
// audience=coach path uses guardCoachOr401 + ?studentId from query;
// student path keeps the 鐵則 (sid from session, query 完全忽略).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler from './journey.js';
import { _setStudentSessionReader } from '../lib/auth/student-session.js';
import { _setCoachSessionReader }   from '../lib/auth/coach-session.js';
import { _setSqlClient as _setStateManagerSql } from '../lib/state/state-manager.js';

// ── mock SQL tracker that records which student_id state-manager sees ──

function makeMockSql(profileRowsByStudent = {}) {
  const calls = [];
  const fn = (strings, ...values) => {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''),
      '',
    );
    calls.push({ text, values });
    // getUserProfile queries user_profile_evolution by student_id; return per-student fixture
    const sid = values.find(v => typeof v === 'string' && /^A\d{3}$/.test(v));
    const row = sid ? profileRowsByStudent[sid] : null;
    return Promise.resolve(row ? [row] : []);
  };
  fn.calls = calls;
  return fn;
}

function mockReq({ method = 'GET', query = {} } = {}) {
  return { method, query, headers: {}, body: {} };
}
function mockRes() {
  const r = {
    statusCode: 200, body: null,
    status(s) { r.statusCode = s; return r; },
    json(b)   { r.body = b; return r; },
  };
  return r;
}

const STUDENT_SESSION_FOR = (sid) => async () => ({ role: 'student', sid });
const COACH_OK = async () => ({ role: 'coach' });
const NO_SESSION = async () => null;

beforeEach(() => {
  _setStudentSessionReader(null);
  _setCoachSessionReader(null);
  _setStateManagerSql(null);
  process.env.SESSION_SECRET = 'test-secret-32-bytes-of-entropy-aaaaaaaa';
  // Valid-shape stub so neon() doesn't throw at construction; the inner sql
  // calls in journey.js wrap each query in try/catch so they degrade gracefully.
  process.env.DATABASE_URL = 'postgresql://test:test@test.example.com/test';
});

// ═════════════════════════════════════════════════════════
// coach audience — uses ?studentId from query
// ═════════════════════════════════════════════════════════

test('🛑 /api/journey audience=coach + valid coach session + ?studentId=A002 → reads A002', async () => {
  _setCoachSessionReader(COACH_OK);
  // student-session is the WRONG one — Vivi reproduced this by also being
  // logged in as A001/iamvivi in the same browser. Coach branch must IGNORE it.
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  const sql = makeMockSql({
    A002: {
      student_id: 'A002', session_day_count: 5, daily_takeaways: [], export_prompt_generated_at: null,
      last_session_day_summary: null,
    },
  });
  _setStateManagerSql(sql);
  const res = mockRes();
  await handler(mockReq({ query: { audience: 'coach', studentId: 'A002', module: 'self' } }), res);
  assert.equal(res.statusCode, 200);
  // state-manager's getUserProfile was called with A002 — not A001 (the
  // student session) — proving the coach path uses the query, not the cookie.
  const sidsSeen = sql.calls
    .flatMap(c => c.values)
    .filter(v => typeof v === 'string' && /^A\d{3}$/.test(v));
  assert.ok(sidsSeen.includes('A002'), `expected to see A002. saw: ${JSON.stringify(sidsSeen)}`);
  assert.ok(!sidsSeen.includes('A001'),
    `coach path must NOT query A001 (student-session bleed). saw: ${JSON.stringify(sidsSeen)}`);
});

test('🛑 /api/journey audience=coach + NO coach session → 401', async () => {
  _setCoachSessionReader(NO_SESSION);
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));   // student session present, must NOT pass
  _setStateManagerSql(makeMockSql({}));
  const res = mockRes();
  await handler(mockReq({ query: { audience: 'coach', studentId: 'A002', module: 'self' } }), res);
  assert.equal(res.statusCode, 401, 'coach path requires coach session; student session not enough');
});

test('/api/journey audience=coach + valid coach session + missing studentId → 400', async () => {
  _setCoachSessionReader(COACH_OK);
  _setStateManagerSql(makeMockSql({}));
  const res = mockRes();
  await handler(mockReq({ query: { audience: 'coach', module: 'self' } }), res);
  assert.equal(res.statusCode, 400);
});

// ═════════════════════════════════════════════════════════
// student audience (default) — 鐵則: sid from session, query 完全忽略
// ═════════════════════════════════════════════════════════

test('🛑 /api/journey no audience + student session A001 + ?studentId=A999 → reads A001 (鐵則)', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setCoachSessionReader(NO_SESSION);
  const sql = makeMockSql({
    A001: { student_id: 'A001', session_day_count: 3, daily_takeaways: [], export_prompt_generated_at: null, last_session_day_summary: null },
  });
  _setStateManagerSql(sql);
  const res = mockRes();
  await handler(mockReq({ query: { studentId: 'A999', module: 'self' } }), res);
  assert.equal(res.statusCode, 200);
  const sidsSeen = sql.calls
    .flatMap(c => c.values)
    .filter(v => typeof v === 'string' && /^A\d{3}$/.test(v));
  assert.ok(!sidsSeen.includes('A999'),
    `student path must NEVER query A999 from query. saw: ${JSON.stringify(sidsSeen)}`);
  assert.ok(sidsSeen.includes('A001'), `expected A001 from session. saw: ${JSON.stringify(sidsSeen)}`);
});

test('🛑 /api/journey no audience + no student session → 401', async () => {
  _setStudentSessionReader(NO_SESSION);
  _setStateManagerSql(makeMockSql({}));
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self' } }), res);
  assert.equal(res.statusCode, 401);
});

test('🛑 /api/journey audience=anything-else defaults to student gate', async () => {
  // Defense: only the literal string「coach」 (case-insensitive) opens the coach
  // branch. Anything else (typo, blank, malicious) → student gate fires.
  _setStudentSessionReader(NO_SESSION);
  _setCoachSessionReader(COACH_OK);   // coach session present, must NOT be enough
  _setStateManagerSql(makeMockSql({}));
  for (const audience of ['coach2', 'COACHX', '', 'admin', 'student']) {
    const res = mockRes();
    await handler(mockReq({ query: { audience, studentId: 'A002', module: 'self' } }), res);
    assert.equal(res.statusCode, 401,
      `audience='${audience}' must NOT open the coach branch. statusCode=${res.statusCode}`);
  }
});

// ═════════════════════════════════════════════════════════
// method
// ═════════════════════════════════════════════════════════

test('/api/journey: non-GET → 405', async () => {
  const res = mockRes();
  await handler(mockReq({ method: 'POST' }), res);
  assert.equal(res.statusCode, 405);
});
