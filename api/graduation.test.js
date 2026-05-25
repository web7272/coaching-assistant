// api/graduation.test.js — projectPoem21 pure helper + audience routing tests.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import handler, { projectPoem21 } from './graduation.js';
import { _setStudentSessionReader } from '../lib/auth/student-session.js';
import { _setCoachSessionReader }   from '../lib/auth/coach-session.js';
import { _setSqlClient as _setStateManagerSql } from '../lib/state/state-manager.js';

test('projectPoem21: always returns length-21 array (per UI 21-cell rendering)', () => {
  assert.equal(projectPoem21([]).length, 21);
  assert.equal(projectPoem21([{ day: 1, term: 'x' }]).length, 21);
  assert.equal(projectPoem21(null).length, 21);
  assert.equal(projectPoem21(undefined).length, 21);
});

test('projectPoem21: sorted by day ASC, missing days as empty string', () => {
  const out = projectPoem21([
    { day: 3, term: '我不能停' },
    { day: 1, term: '可以決定' },
    { day: 21, term: '是我' },
  ]);
  assert.equal(out[0], '可以決定');   // day 1
  assert.equal(out[1], '');          // day 2 missing
  assert.equal(out[2], '我不能停');   // day 3
  assert.equal(out[20], '是我');     // day 21
});

test('projectPoem21: defensively skips malformed entries', () => {
  const out = projectPoem21([
    { day: 1, term: 'ok' },
    { day: '2', term: 'string day, dropped' },     // type mismatch
    { day: 3 },                                    // no term
    { term: 'no day' },                            // no day
    null, undefined, 'string',
  ]);
  assert.equal(out[0], 'ok');
  assert.equal(out[1], '');
  assert.equal(out[2], '');
});

test('projectPoem21: full 21-day rendering (Day 21 complete journey)', () => {
  const full = Array.from({ length: 21 }, (_, i) => ({ day: i + 1, term: `T${i + 1}` }));
  const out = projectPoem21(full);
  for (let i = 0; i < 21; i++) {
    assert.equal(out[i], `T${i + 1}`, `day ${i + 1}`);
  }
});

// ═════════════════════════════════════════════════════════
// PR-4c-green 5/25 — audience routing (Vivi: 教練後台所有學員顯示同一人)
// Switched from auto-detect (assertCoachSession-first) → explicit audience param
// for consistency with note.js / phase-report.js / journey.js.
// ═════════════════════════════════════════════════════════

function makeMockSql(profileRowsByStudent = {}) {
  const calls = [];
  const fn = (strings, ...values) => {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''),
      '',
    );
    calls.push({ text, values });
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
  process.env.DATABASE_URL = 'postgresql://test:test@test.example.com/test';
});

test('🛑 /api/graduation audience=coach + valid coach session + ?studentId=A002 → reads A002', async () => {
  _setCoachSessionReader(COACH_OK);
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  const sql = makeMockSql({
    A002: {
      student_id: 'A002',
      last_session_day_summary: { graduation: { coach_letter: 'A002 letter', declaration: '我是 A002' } },
      daily_takeaways: [],
      export_prompt_generated_at: '2026-05-23T00:00:00Z',
    },
  });
  _setStateManagerSql(sql);
  const res = mockRes();
  await handler(mockReq({ query: { audience: 'coach', studentId: 'A002', module: 'self' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.coachLetter, 'A002 letter');
  assert.equal(res.body.declaration, '我是 A002');
  // Confirm SQL was queried for A002, never A001 (student session sid).
  const sidsSeen = sql.calls
    .flatMap(c => c.values)
    .filter(v => typeof v === 'string' && /^A\d{3}$/.test(v));
  assert.ok(sidsSeen.includes('A002'), `expected A002. saw: ${JSON.stringify(sidsSeen)}`);
  assert.ok(!sidsSeen.includes('A001'),
    `coach path must NOT query A001 (student-session bleed). saw: ${JSON.stringify(sidsSeen)}`);
});

test('🛑 /api/graduation audience=coach + NO coach session → 401', async () => {
  _setCoachSessionReader(NO_SESSION);
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setStateManagerSql(makeMockSql({}));
  const res = mockRes();
  await handler(mockReq({ query: { audience: 'coach', studentId: 'A002', module: 'self' } }), res);
  assert.equal(res.statusCode, 401);
});

test('/api/graduation audience=coach + missing studentId → 400', async () => {
  _setCoachSessionReader(COACH_OK);
  _setStateManagerSql(makeMockSql({}));
  const res = mockRes();
  await handler(mockReq({ query: { audience: 'coach', module: 'self' } }), res);
  assert.equal(res.statusCode, 400);
});

test('🛑 /api/graduation no audience + student A001 + ?studentId=A999 → still reads A001 (鐵則)', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setCoachSessionReader(NO_SESSION);
  const sql = makeMockSql({
    A001: { last_session_day_summary: null, daily_takeaways: [], export_prompt_generated_at: null },
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
  assert.ok(sidsSeen.includes('A001'));
});

test('🛑 /api/graduation no audience + no student session → 401', async () => {
  _setStudentSessionReader(NO_SESSION);
  _setStateManagerSql(makeMockSql({}));
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self' } }), res);
  assert.equal(res.statusCode, 401);
});

test('/api/graduation: non-GET → 405', async () => {
  const res = mockRes();
  await handler(mockReq({ method: 'POST' }), res);
  assert.equal(res.statusCode, 405);
});
