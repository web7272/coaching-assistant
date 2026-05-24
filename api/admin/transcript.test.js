// api/admin/transcript.test.js
// PR-4c-green 教練後台逐字對話 — 3 tests per Patrick 5/24:
//   (a) endpoint 回該天 messages、順序正確
//   (b) 無有效 coach session → 401
//   (c) day→session 對應跟 note.js 一致 (同天筆記與逐字對得上)
//
// Auth rebuild stage 1a: seam migrated from _setGetTokenFn (NextAuth era) to
// _setCoachSessionReader (HMAC cookie). Email-shaped tests retired — passcode
// auth doesn't track who logged in, only that they have a valid coach session.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, {
  isAuthorizedCoach,
  shapeTranscriptResponse,
  _setCoachSessionReader,
  _setSqlClient,
} from './transcript.js';

// ── pure helper tests (cheap, no mock state) ──

test('isAuthorizedCoach: payload with role=coach → true', () => {
  assert.equal(isAuthorizedCoach({ role: 'coach' }), true);
  assert.equal(isAuthorizedCoach({ role: 'coach', iat: 1, exp: 9e9 }), true);
});

test('isAuthorizedCoach: wrong role → false', () => {
  assert.equal(isAuthorizedCoach({ role: 'student' }), false);
  assert.equal(isAuthorizedCoach({}), false);
});

test('isAuthorizedCoach: nullish payload → false', () => {
  assert.equal(isAuthorizedCoach(null), false);
  assert.equal(isAuthorizedCoach(undefined), false);
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
  assert.equal(out.messages[2].content, '我最近在想…');
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
  return { method, query, headers: {} };
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

const COACH_OK = async () => ({ role: 'coach' });
const NO_SESSION = async () => null;

beforeEach(() => {
  _setCoachSessionReader(null);
  _setSqlClient(null);
});

// ═════════════════════════════════════════════════════════
// 🛑 Test (a) — endpoint returns the day's messages in chronological order
// ═════════════════════════════════════════════════════════

test('🛑 handler: valid coach session + day with messages → returns transcript ordered ASC', async () => {
  _setCoachSessionReader(COACH_OK);
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
  assert.equal(res.body.messages[0].role,    'assistant');
  assert.equal(res.body.messages[0].content, '我想先聽你說——');
  assert.equal(res.body.messages[3].content, '可以讓我更自由');

  // SQL shape sanity check
  assert.equal(sql.calls.length, 1);
  const q = sql.calls[0];
  assert.match(q.text, /FROM messages m/i);
  assert.match(q.text, /JOIN sessions s ON s\.id = m\.session_id/i);
  assert.match(q.text, /s\.day\s+= \$3/);
  assert.match(q.text, /m\.role IN \('user', 'assistant'\)/);
  assert.match(q.text, /ORDER BY m\.created_at ASC/i);
  assert.deepEqual(q.values, ['A001', 'self', 3]);
});

test('handler: valid coach session + day with no messages → exists:false', async () => {
  _setCoachSessionReader(COACH_OK);
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

test('🛑 handler: no session → 401', async () => {
  _setCoachSessionReader(NO_SESSION);
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ studentId: 'A001', module: 'self', day: '1' }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Unauthorized');
});

test('🛑 handler: wrong-role session → 401', async () => {
  _setCoachSessionReader(async () => ({ role: 'student', sid: 'A001' }));
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ studentId: 'A001', module: 'self', day: '1' }), res);
  assert.equal(res.statusCode, 401);
});

test('🛑 handler: 401 happens BEFORE any SQL is issued (no DB leakage)', async () => {
  _setCoachSessionReader(NO_SESSION);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  await handler(mockReq({ studentId: 'A001', module: 'self', day: '1' }), mockRes());
  assert.equal(sql.calls.length, 0, 'unauthenticated requests must not touch the DB');
});

test('handler: session reader throws → 401 (fail-closed)', async () => {
  _setCoachSessionReader(async () => { throw new Error('boom'); });
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ studentId: 'A001', module: 'self', day: '1' }), res);
  assert.equal(res.statusCode, 401);
});

// ═════════════════════════════════════════════════════════
// 🛑 Test (c) — day→session mapping consistent with api/note.js
// ═════════════════════════════════════════════════════════

test('🛑 handler: day query param flows to SQL as integer (same shape as note.js coach path)', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  await handler(mockReq({ studentId: 'A001', module: 'self', day: '7' }), mockRes());
  assert.equal(sql.calls.length, 1);
  const dayParam = sql.calls[0].values.find(v => v === 7);
  assert.equal(dayParam, 7);
  assert.equal(sql.calls[0].values.includes('7'), false);
});

test('🛑 handler: same studentId+module+day produces single deterministic SQL (no OFFSET trick)', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  await handler(mockReq({ studentId: 'A001', module: 'self', day: '7' }), mockRes());
  const text = sql.calls[0].text;
  assert.doesNotMatch(text, /OFFSET/i);
  assert.match(text, /s\.day\s+= \$3/);
});

// ── input validation (fast feedback, no DB) ──

test('handler: missing studentId → 400 (after auth)', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ module: 'self', day: '1' }), res);
  assert.equal(res.statusCode, 400);
});

test('handler: day out of 1-21 range → 400', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([]));
  for (const bad of ['0', '22', 'abc', '']) {
    const res = mockRes();
    await handler(mockReq({ studentId: 'A001', module: 'self', day: bad }), res);
    assert.equal(res.statusCode, 400, `day=${JSON.stringify(bad)} must be rejected`);
  }
});

test('handler: non-GET method → 405', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ studentId: 'A001', module: 'self', day: '1' }, 'POST'), res);
  assert.equal(res.statusCode, 405);
});
