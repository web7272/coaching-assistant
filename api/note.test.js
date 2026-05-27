// api/note.test.js
// Patrick 5/26 — coach 路徑同時回 studentCard (= sessions.notebook_page) 給後台
// 顯示「學員前端那張卡」+「完整筆記」 兩塊.
//
// 鐵律 #2 諮商保密方向：教練看 student 安全版 OK (本來就看得到一切);
// student 看 note_text → 漏洞. 這份 test 同時鎖住兩個方向.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, { _setSqlClient } from './note.js';
import { _setCoachSessionReader }   from '../lib/auth/coach-session.js';
import { _setStudentSessionReader } from '../lib/auth/student-session.js';

// ─── mock sql: rowsByCall = [damonNotesRows, sessionsRows] ──

function makeMockSql(plan) {
  const calls = [];
  let idx = 0;
  const fn = (strings, ...values) => {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''),
      '',
    );
    calls.push({ strings: Array.from(strings), values, text });
    if (typeof plan === 'function') return Promise.resolve(plan({ text, idx: idx++ }));
    const rows = Array.isArray(plan?.[idx]) ? plan[idx++] : [];
    return Promise.resolve(rows);
  };
  fn.calls = calls;
  return fn;
}

function mockReq({ method = 'GET', query = {} } = {}) {
  return { method, query, headers: {} };
}
function mockRes() {
  const r = {
    statusCode: 200, body: null,
    status(s) { r.statusCode = s; return r; },
    json(b)   { r.body = b; return r; },
  };
  return r;
}

const COACH_OK = async () => ({ role: 'coach' });
const NO_COACH = async () => null;
const STUDENT_SESSION_FOR = (sid) => async () => ({ role: 'student', sid });

beforeEach(() => {
  _setSqlClient(null);
  _setCoachSessionReader(null);
  _setStudentSessionReader(null);
  process.env.SESSION_SECRET = 'test-secret-32-bytes-of-entropy-aaaaaaaa';
  process.env.DATABASE_URL = 'postgresql://test:test@test.example.com/test';
});

// ═════════════════════════════════════════════════════════
// method + day validation
// ═════════════════════════════════════════════════════════

test('non-GET → 405', async () => {
  const res = mockRes();
  await handler(mockReq({ method: 'POST', query: { day: '1' } }), res);
  assert.equal(res.statusCode, 405);
});

test('invalid day → 400', async () => {
  const res = mockRes();
  await handler(mockReq({ query: { day: '99' } }), res);
  assert.equal(res.statusCode, 400);
});

// ═════════════════════════════════════════════════════════
// 🛑 coach path — adds studentCard to response (5/26 Patrick)
// ═════════════════════════════════════════════════════════

test('🛑 audience=coach + valid session + both notes exist → returns noteText + studentCard', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([
    // 1st query: damon_notes
    [{ note_text: '【今天的模式】\n【深度層次】Layer 3\n【SC 觀察】coach internal full' }],
    // 2nd query: sessions notebook_page (the warm Vivi version student saw)
    [{ notebook_page: '今天你說的那句話、我接住了' }],
  ]));
  const res = mockRes();
  await handler(mockReq({
    query: { studentId: 'A001', module: 'self', day: '3', audience: 'coach' },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.audience, 'coach');
  assert.equal(res.body.exists, true);
  assert.match(res.body.noteText, /SC 觀察/, 'coach gets the un-sanitized fullNote');
  assert.equal(res.body.studentCard, '今天你說的那句話、我接住了',
    'coach response must include the student-side warm card');
});

test('🛑 audience=coach + no damon_notes row → still returns studentCard if sessions has notebook_page', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([
    [],   // no damon_notes
    [{ notebook_page: 'warm card was generated but full note write failed' }],
  ]));
  const res = mockRes();
  await handler(mockReq({
    query: { studentId: 'A001', module: 'self', day: '3', audience: 'coach' },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.exists, false);
  assert.equal(res.body.noteText, null);
  assert.equal(res.body.studentCard, 'warm card was generated but full note write failed');
});

test('🛑 audience=coach + no notebook_page at all → studentCard:null (no crash)', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([
    [{ note_text: 'full note exists' }],
    [],   // no sessions row with notebook_page at that OFFSET
  ]));
  const res = mockRes();
  await handler(mockReq({
    query: { studentId: 'A001', module: 'self', day: '1', audience: 'coach' },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.studentCard, null);
  assert.equal(res.body.noteText, 'full note exists');
});

test('🛑 audience=coach: studentCard SQL uses OFFSET=day-1 (same as student path)', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([
    [{ note_text: 'x' }],
    [{ notebook_page: 'y' }],
  ]);
  _setSqlClient(sql);
  await handler(mockReq({
    query: { studentId: 'A007', module: 'self', day: '5', audience: 'coach' },
  }), mockRes());
  // Find the sessions query (the one mentioning notebook_page + ORDER BY session_date)
  const sessQuery = sql.calls.find(c => /notebook_page/i.test(c.text) && /ORDER BY session_date/i.test(c.text));
  assert.ok(sessQuery, 'must issue a sessions notebook_page query for the coach path');
  // OFFSET value = day-1 = 4
  assert.ok(sessQuery.values.includes(4),
    `OFFSET should be day-1=4. saw values: ${JSON.stringify(sessQuery.values)}`);
});

test('🛑 audience=coach: no coach session → 401 + NO SQL', async () => {
  _setCoachSessionReader(NO_COACH);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    query: { studentId: 'A001', module: 'self', day: '1', audience: 'coach' },
  }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(sql.calls.length, 0, 'coach gate must fire before any SQL');
});

test('audience=coach: missing studentId → 400', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self', day: '1', audience: 'coach' } }), res);
  assert.equal(res.statusCode, 400);
});

// ═════════════════════════════════════════════════════════
// 🛑 STUDENT path — must NEVER return note_text or studentCard field
//                   (鐵律 #2 諮商保密 — student-facing 不可洩漏 coach internals)
// ═════════════════════════════════════════════════════════

test('🛑 student path: returns only sanitized notebook_page as noteText, NO note_text + NO studentCard field', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql([
    [{ notebook_page: '今天你說的那句話、我接住了' }],
  ]));
  const res = mockRes();
  await handler(mockReq({
    query: { module: 'self', day: '1' },     // no audience param → student default
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.exists, true);
  assert.equal(res.body.noteText, '今天你說的那句話、我接住了');
  // Defense — these keys must NEVER appear on the student response.
  assert.equal('studentCard' in res.body, false,
    'student response must NOT carry studentCard field (鐵律 #2)');
  assert.equal('audience' in res.body, false,
    'student response must not echo audience=coach metadata');
});

test('🛑 student path: forbidden coach-internal content in notebook_page → safeNoteForStudent fallback (does NOT leak fullNote)', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql([
    [{ notebook_page: '【深度層次】Layer 3\n【SC 觀察】internal' }],
  ]));
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self', day: '1' } }), res);
  assert.equal(res.statusCode, 200);
  // safeNoteForStudent must scrub or replace — the raw 【深度層次】 marker must NOT
  // survive to a student response. (sanitizer behavior tested in detail in
  // lib/api/student-note-safe.test.js; here we just lock the boundary.)
  assert.equal(/SC 觀察/.test(res.body.noteText || ''), false,
    'student response must not carry 【SC 觀察】 coach-internal marker');
});

test('🛑 student path: no student session → 401', async () => {
  _setStudentSessionReader(async () => null);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self', day: '1' } }), res);
  assert.equal(res.statusCode, 401);
});
