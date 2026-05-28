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

// 🛑 5/29 Patrick (A008 case) — sessions query 不再用 session_date strict equality 過濾.
// iphwang214 5/27 17:04 對話的 session 在 DB 存 session_date='2026-05-28' (client TZ
// 漂或寫入時段邊界 race), 舊邏輯 ?today=2026-05-29 對不上 → 17 句對話「消失」.
// 改後 query 只用 student_id + module + day_complete=FALSE, 跨日仍能 restore.
test('🛑 sessions query 不再帶 session_date filter (A008 regression guard)', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  const sql = makeMockSql({ sessionRows: [] });
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self', today: '2026-05-29' } }), res);
  assert.equal(res.statusCode, 200);
  const firstQuery = sql.calls[0].text;
  assert.equal(/session_date\s*=/i.test(firstQuery), false,
    `query 必須 NOT 帶 session_date = … (A008 fix). 看到的 query:\n${firstQuery}`);
});

test('🛑 A008 case: session_date 跟 client today 對不上仍能 restore (real-data 個案)', async () => {
  // 還原 A008 的真實狀況: session 存 session_date='2026-05-28' (DB), client
  // 卻送 today='2026-05-29'. 舊邏輯這條會被 strict equality 擋掉、回 hasInProgress=false.
  // 新邏輯不看 session_date、單看 day_complete=FALSE → restore 17 句對話.
  _setStudentSessionReader(STUDENT_SESSION_FOR('A008'));
  _setSqlClient(makeMockSql({
    sessionRows: [{ id: 19, day: 1, day_complete: false }],   // session_date='2026-05-28' 不影響
    messageRows: [
      { role: 'user',      content: '我想要開心' },
      { role: 'assistant', content: '擁有開心、對你有什麼重要?' },
      { role: 'user',      content: '對未來有信心' },
    ],
  }));
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self', today: '2026-05-29' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.hasInProgress, true, 'A008 對話必須能 restore (跨日仍 restore)');
  assert.equal(res.body.sessionId, 19);
  assert.equal(res.body.messages.length, 3);
});

test('🛑 in-progress session 是 3 天前建的、今天請 conversation-today 仍 restore', async () => {
  // 廣義 cross-day restore: 學員昨晚開始對話沒收尾, 隔天回來仍能續上.
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql({
    sessionRows: [{ id: 7, day: 2, day_complete: false }],
    messageRows: [{ role: 'assistant', content: '昨晚那句、我接住了' }],
  }));
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self', today: '2026-05-29' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.hasInProgress, true);
  assert.equal(res.body.sessionId, 7);
});

test('today query 仍被前端送、server-side 必須容忍接收 (deprecated 但不報錯)', async () => {
  // 5/29 Patrick — `today` query 為 deprecated 兼容、server 不能因為它存在就 reject.
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql({ sessionRows: [] }));
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self', today: 'whatever-junk-2026-13-99' } }), res);
  assert.equal(res.statusCode, 200,
    'today query (即使垃圾值) 都不能讓 endpoint 500/400 — 純兼容接收');
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
