// api/conversation-today.test.js
// PR-4c-green Patrick 5/25 (Day-4 實測 C2) — student endpoint to restore
// today's in-progress conversation. 鐵則 1d: sid from session only.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, { _setSqlClient } from './conversation-today.js';
import { _setStudentSessionReader } from '../lib/auth/student-session.js';

// ── mock SQL — tag-template fn that returns canned rows based on query order ──

function makeMockSql(plan) {
  // plan: { sessionRows: [...], messageRows: [...] }
  const calls = [];
  let queryIdx = 0;
  const fn = (strings, ...values) => {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''),
      '',
    );
    calls.push({ text, values });
    // First query → sessions, Second query → messages (only fires if sessions returned a row)
    const idx = queryIdx++;
    if (idx === 0) return Promise.resolve(plan.sessionRows || []);
    if (idx === 1) return Promise.resolve(plan.messageRows || []);
    return Promise.resolve([]);
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
const NO_SESSION = async () => null;

beforeEach(() => {
  _setStudentSessionReader(null);
  _setSqlClient(null);
  process.env.SESSION_SECRET = 'test-secret-32-bytes-of-entropy-aaaaaaaa';
  process.env.DATABASE_URL = 'postgresql://test:test@test.example.com/test';
});

// ═════════════════════════════════════════════════════════
// 鐵則 1d — auth
// ═════════════════════════════════════════════════════════

test('🛑 no student session → 401', async () => {
  _setStudentSessionReader(NO_SESSION);
  _setSqlClient(makeMockSql({}));
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self' } }), res);
  assert.equal(res.statusCode, 401);
});

test('🛑 student session A001 + ?studentId=A999 → reads A001 (鐵則: query 忽略)', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  const sql = makeMockSql({ sessionRows: [] });   // no in-progress session
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ query: { studentId: 'A999', module: 'self' } }), res);
  assert.equal(res.statusCode, 200);
  // SQL was called with A001 (from session), NEVER A999 (from query).
  const sidsSeen = sql.calls.flatMap(c => c.values).filter(v => typeof v === 'string');
  assert.ok(sidsSeen.includes('A001'), `expected A001 from session. saw: ${JSON.stringify(sidsSeen)}`);
  assert.ok(!sidsSeen.includes('A999'), `must NEVER query A999 from URL. saw: ${JSON.stringify(sidsSeen)}`);
});

// ═════════════════════════════════════════════════════════
// method
// ═════════════════════════════════════════════════════════

test('non-GET → 405', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  const res = mockRes();
  await handler(mockReq({ method: 'POST', query: { module: 'self' } }), res);
  assert.equal(res.statusCode, 405);
});

// ═════════════════════════════════════════════════════════
// shape — hasInProgress branches
// ═════════════════════════════════════════════════════════

test('no in-progress session (新的一天) → hasInProgress=false, messages=[]', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql({ sessionRows: [] }));
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { hasInProgress: false, messages: [], sessionId: null, day: null });
});

test('🛑 in-progress session + user/assistant messages → hasInProgress=true, ordered messages', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql({
    sessionRows: [{ id: 42, day: 3, day_complete: false }],
    messageRows: [
      { role: 'assistant', content: '在你的生命裡、你想要什麼?' },
      { role: 'user',      content: '我想要一種穩' },
      { role: 'assistant', content: '擁有那個穩、對你有什麼重要?' },
    ],
  }));
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self', today: '2026-05-25' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.hasInProgress, true);
  assert.equal(res.body.sessionId, 42);
  assert.equal(res.body.day, 3);
  assert.equal(res.body.messages.length, 3);
  assert.deepEqual(res.body.messages[0], { role: 'assistant', content: '在你的生命裡、你想要什麼?' });
  assert.deepEqual(res.body.messages[1], { role: 'user',      content: '我想要一種穩' });
  assert.deepEqual(res.body.messages[2], { role: 'assistant', content: '擁有那個穩、對你有什麼重要?' });
});

test('in-progress session 存在但完全沒 message → hasInProgress=false (走 kickoff)', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql({
    sessionRows: [{ id: 99, day: 1, day_complete: false }],
    messageRows: [],
  }));
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.hasInProgress, false,
    'empty session row should not block kickoff — frontend would render empty conversation');
  assert.deepEqual(res.body.messages, []);
});

test('🛑 day_complete=TRUE 的 session 不應該被選 (SQL WHERE filter)', async () => {
  // 驗 SQL 查詢字串確實包含 day_complete = FALSE 條件.
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  const sql = makeMockSql({ sessionRows: [] });
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self' } }), res);
  assert.equal(res.statusCode, 200);
  const firstQuery = sql.calls[0].text;
  assert.match(firstQuery, /day_complete\s*=\s*FALSE/i,
    'query must filter on day_complete = FALSE (今天已結束的不還原)');
  assert.match(firstQuery, /role\s*=|FROM sessions/i, 'must query sessions table');
});

test('🛑 messages query 只回 user/assistant role (system / damon_note rows 排除)', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  const sql = makeMockSql({
    sessionRows: [{ id: 7, day: 2, day_complete: false }],
    messageRows: [{ role: 'user', content: 'x' }],
  });
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self' } }), res);
  assert.equal(res.statusCode, 200);
  const msgsQuery = sql.calls[1].text;
  assert.match(msgsQuery, /role\s+IN\s*\(/i, 'messages query must filter role');
  assert.match(msgsQuery, /'user'/);
  assert.match(msgsQuery, /'assistant'/);
});

test('response messages strip db-internal fields (id, session_id, created_at)', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql({
    sessionRows: [{ id: 1, day: 1, day_complete: false }],
    messageRows: [
      { id: 999, session_id: 1, role: 'user', content: 'hi',
        created_at: 'leaky-timestamp', question_number: 1 },
    ],
  }));
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.body.messages[0]).sort(), ['content', 'role'],
    'message objects must only carry {role, content} — no db ids / timestamps');
});
