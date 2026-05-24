// api/admin/transcript.test.js
// PR-4c-green 教練後台逐字對話 — 3 tests per Patrick 5/24:
//   (a) endpoint 回該天 messages、順序正確
//   (b) 無有效 coach session → 401
//   (c) day→session 對應跟 note.js 一致 (同天筆記與逐字對得上)

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, {
  isAuthorizedCoach,
  shapeTranscriptResponse,
  _setGetTokenFn,
  _setSqlClient,
} from './transcript.js';

// ── pure helper tests (cheap, no mock state) ──

test('isAuthorizedCoach: matching email (case-insensitive) → true', () => {
  assert.equal(isAuthorizedCoach({ email: 'patrick@example.com' }, 'patrick@example.com'), true);
  assert.equal(isAuthorizedCoach({ email: 'Patrick@Example.com' }, 'patrick@example.com'), true);
  assert.equal(isAuthorizedCoach({ email: 'patrick@example.com' }, 'PATRICK@example.com'), true);
});

test('isAuthorizedCoach: mismatched email → false', () => {
  assert.equal(isAuthorizedCoach({ email: 'student@example.com' }, 'patrick@example.com'), false);
});

test('isAuthorizedCoach: nullish / malformed token → false', () => {
  assert.equal(isAuthorizedCoach(null, 'patrick@example.com'), false);
  assert.equal(isAuthorizedCoach(undefined, 'patrick@example.com'), false);
  assert.equal(isAuthorizedCoach({}, 'patrick@example.com'), false);
  assert.equal(isAuthorizedCoach({ email: '' }, 'patrick@example.com'), false);
  assert.equal(isAuthorizedCoach({ email: null }, 'patrick@example.com'), false);
});

test('isAuthorizedCoach: missing/empty COACH_EMAIL env → false (fail-closed)', () => {
  // Defense: never authorize when the env var isn't set — otherwise any signed
  // Google account that managed to get a session would slip through.
  assert.equal(isAuthorizedCoach({ email: 'patrick@example.com' }, ''), false);
  assert.equal(isAuthorizedCoach({ email: 'patrick@example.com' }, undefined), false);
});

test('shapeTranscriptResponse: maps rows to {role,content,createdAt} preserving order', () => {
  const rows = [
    { role: 'user',      content: '你好',        created_at: '2026-05-24T10:00:00Z' },
    { role: 'assistant', content: '嗨，我想聽你說', created_at: '2026-05-24T10:00:05Z' },
    { role: 'user',      content: '我最近在想…',  created_at: '2026-05-24T10:00:30Z' },
  ];
  const out = shapeTranscriptResponse(rows, 3);
  assert.equal(out.day, 3);
  assert.equal(out.exists, true);
  assert.equal(out.messages.length, 3);
  assert.deepEqual(out.messages[0], {
    role: 'user', content: '你好', createdAt: '2026-05-24T10:00:00Z',
  });
  assert.equal(out.messages[2].content, '我最近在想…');   // preserved order
});

test('shapeTranscriptResponse: empty rows → exists:false', () => {
  const out = shapeTranscriptResponse([], 7);
  assert.deepEqual(out, { day: 7, messages: [], exists: false });
});

test('shapeTranscriptResponse: non-array → exists:false (defensive)', () => {
  assert.deepEqual(shapeTranscriptResponse(null, 1), { day: 1, messages: [], exists: false });
});

// ── mock SQL + auth injection harness ──

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

function mockReq(query = {}, method = 'GET') {
  return { method, query };
}

function mockRes() {
  const r = {
    statusCode: 200,
    body: null,
    status(s) { r.statusCode = s; return r; },
    json(b)   { r.body = b; return r; },
  };
  return r;
}

beforeEach(() => {
  // Reset injection seams between tests so order doesn't matter.
  _setGetTokenFn(null);
  _setSqlClient(null);
  // Set COACH_EMAIL for the handler path (handler reads it via process.env at call time).
  process.env.COACH_EMAIL = 'patrick@example.com';
});

// ═════════════════════════════════════════════════════════
// 🛑 Test (a) — endpoint returns the day's messages in chronological order
// ═════════════════════════════════════════════════════════

test('🛑 handler: valid coach session + day with messages → returns transcript ordered ASC', async () => {
  _setGetTokenFn(async () => ({ email: 'patrick@example.com' }));
  const dbRows = [
    { role: 'assistant', content: '我想先聽你說——',           created_at: '2026-05-24T10:00:00Z' },
    { role: 'user',      content: '我最近在思考…',             created_at: '2026-05-24T10:00:30Z' },
    { role: 'assistant', content: '這對你來說、會帶來什麼?',   created_at: '2026-05-24T10:01:00Z' },
    { role: 'user',      content: '可以讓我更自由',             created_at: '2026-05-24T10:01:45Z' },
  ];
  const sql = makeMockSql(dbRows);
  _setSqlClient(sql);

  const req = mockReq({ studentId: 'A001', module: 'self', day: '3' });
  const res = mockRes();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.day, 3);
  assert.equal(res.body.exists, true);
  assert.equal(res.body.messages.length, 4);
  // Order preserved (SQL provided ASC; shape doesn't re-sort)
  assert.equal(res.body.messages[0].role,    'assistant');
  assert.equal(res.body.messages[0].content, '我想先聽你說——');
  assert.equal(res.body.messages[3].content, '可以讓我更自由');

  // SQL shape: joins messages ↔ sessions, filters by student/module/day,
  // restricts roles, orders by created_at ASC.
  assert.equal(sql.calls.length, 1);
  const q = sql.calls[0];
  assert.match(q.text, /FROM messages m/i);
  assert.match(q.text, /JOIN sessions s ON s\.id = m\.session_id/i);
  assert.match(q.text, /s\.student_id = \$1/);
  assert.match(q.text, /s\.module\s+= \$2/);
  assert.match(q.text, /s\.day\s+= \$3/);
  assert.match(q.text, /m\.role IN \('user', 'assistant'\)/);
  assert.match(q.text, /ORDER BY m\.created_at ASC/i);
  assert.deepEqual(q.values, ['A001', 'self', 3]);
});

test('handler: valid coach session + day with no messages → exists:false', async () => {
  _setGetTokenFn(async () => ({ email: 'patrick@example.com' }));
  _setSqlClient(makeMockSql([]));
  const req = mockReq({ studentId: 'A001', module: 'self', day: '5' });
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { day: 5, messages: [], exists: false });
});

// ═════════════════════════════════════════════════════════
// 🛑 Test (b) — no valid coach session → 401
// ═════════════════════════════════════════════════════════

test('🛑 handler: no session token → 401', async () => {
  _setGetTokenFn(async () => null);
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ studentId: 'A001', module: 'self', day: '1' }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Unauthorized');
});

test('🛑 handler: wrong email in token → 401 (not just any signed-in Google user)', async () => {
  _setGetTokenFn(async () => ({ email: 'someone-else@example.com' }));
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ studentId: 'A001', module: 'self', day: '1' }), res);
  assert.equal(res.statusCode, 401);
});

test('🛑 handler: 401 happens BEFORE any SQL is issued (no DB leakage)', async () => {
  _setGetTokenFn(async () => null);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  await handler(mockReq({ studentId: 'A001', module: 'self', day: '1' }), mockRes());
  assert.equal(sql.calls.length, 0, 'unauthenticated requests must not touch the DB');
});

test('handler: getToken throws → 401 (fail-closed)', async () => {
  _setGetTokenFn(async () => { throw new Error('boom'); });
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ studentId: 'A001', module: 'self', day: '1' }), res);
  assert.equal(res.statusCode, 401);
});

test('handler: COACH_EMAIL env unset → 401 even with valid-looking token', async () => {
  process.env.COACH_EMAIL = '';   // simulate missing env
  _setGetTokenFn(async () => ({ email: 'patrick@example.com' }));
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ studentId: 'A001', module: 'self', day: '1' }), res);
  assert.equal(res.statusCode, 401);
});

// ═════════════════════════════════════════════════════════
// 🛑 Test (c) — day→session mapping consistent with api/note.js
// ═════════════════════════════════════════════════════════
//
// Patrick: "確保同一顆 day 按鈕的『筆記』跟『逐字』是同一天的".
// Mechanism (verified by inspection): both endpoints filter by `day = $N` as a
// direct integer column match on their respective tables — never the
// position-based OFFSET trick (which would be ambiguous on self-paced
// same-calendar-date rows).
//
//   api/note.js coach path:    SELECT note_text FROM damon_notes WHERE … day = $N
//   api/admin/transcript:      JOIN sessions s ON … WHERE s.day = $N
//
// Test enforces: the day value the client passes in the query string ends up
// in the SQL parameter slot as an integer, identical to how note.js does it.

test('🛑 handler: day query param flows to SQL as integer (same shape as note.js coach path)', async () => {
  _setGetTokenFn(async () => ({ email: 'patrick@example.com' }));
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  await handler(mockReq({ studentId: 'A001', module: 'self', day: '7' }), mockRes());
  assert.equal(sql.calls.length, 1);
  const dayParam = sql.calls[0].values.find(v => v === 7);
  assert.equal(dayParam, 7,
    'day must be parsed to integer and bound to the day SQL parameter — matches api/note.js coach path key');
  // Defensive: no string '7' in values (would indicate parseInt was skipped).
  assert.equal(sql.calls[0].values.includes('7'), false);
});

test('🛑 handler: same studentId+module+day produces single deterministic SQL (no OFFSET trick)', async () => {
  // The student notebook_page path uses ORDER BY session_date ASC LIMIT 1 OFFSET day-1
  // which is fragile on self-paced ties. Transcript MUST use direct day-column
  // match (same as note.js coach path) for deterministic mapping.
  _setGetTokenFn(async () => ({ email: 'patrick@example.com' }));
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  await handler(mockReq({ studentId: 'A001', module: 'self', day: '7' }), mockRes());
  const text = sql.calls[0].text;
  assert.doesNotMatch(text, /OFFSET/i,
    'transcript must NOT use OFFSET-by-position — that\'s the fragile student path');
  assert.match(text, /s\.day\s+= \$3/,
    'transcript must use direct sessions.day filter — consistent with damon_notes.day in note.js coach');
});

// ── extra: input validation (fast feedback, no DB) ──

test('handler: missing studentId → 400 (auth-clear)', async () => {
  _setGetTokenFn(async () => ({ email: 'patrick@example.com' }));
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ module: 'self', day: '1' }), res);
  assert.equal(res.statusCode, 400);
});

test('handler: day out of 1-21 range → 400', async () => {
  _setGetTokenFn(async () => ({ email: 'patrick@example.com' }));
  _setSqlClient(makeMockSql([]));
  for (const bad of ['0', '22', 'abc', '']) {
    const res = mockRes();
    await handler(mockReq({ studentId: 'A001', module: 'self', day: bad }), res);
    assert.equal(res.statusCode, 400, `day=${JSON.stringify(bad)} must be rejected`);
  }
});

test('handler: non-GET method → 405', async () => {
  _setGetTokenFn(async () => ({ email: 'patrick@example.com' }));
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ studentId: 'A001', module: 'self', day: '1' }, 'POST'), res);
  assert.equal(res.statusCode, 405);
});
