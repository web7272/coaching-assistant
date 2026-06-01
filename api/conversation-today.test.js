// api/conversation-today.test.js
// PR-4c-green Patrick 5/25 (Day-4 實測 C2) — student endpoint to restore
// today's in-progress conversation. 鐵則 1d: sid from session only.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, { _setSqlClient } from './conversation-today.js';
import { _setStudentSessionReader } from '../lib/auth/student-session.js';

// ── mock SQL — tag-template fn that returns canned rows based on query order ──

function makeMockSql(plan) {
  // plan: { sessionRows, messageRows, studentRows?, day21Rows? }
  // 5/29 Patrick — text-match dispatch (order-independent, future-proof against
  // new access-gate / lazy-block queries inserted before the original 2-call path).
  // Default studentRows=[] → unblocked / not-beta → gate falls through cleanly.
  const calls = [];
  const fn = (strings, ...values) => {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''),
      '',
    );
    calls.push({ text, values });
    // is_blocked / is_beta access-gate SELECT
    if (/SELECT is_blocked, is_beta, created_at\s+FROM students/i.test(text)) {
      return Promise.resolve(plan.studentRows || []);
    }
    // 30-day window Day 21 completion lookup (only fires if is_beta=TRUE)
    if (/FROM sessions[\s\S]*day\s*=\s*21/i.test(text)) {
      return Promise.resolve(plan.day21Rows || []);
    }
    // UPDATE students SET is_blocked=TRUE (lazy block path)
    if (/UPDATE students SET is_blocked\s*=\s*TRUE/i.test(text)) {
      return Promise.resolve([]);
    }
    // sessions in-progress query (the A008 path: WHERE day_complete=FALSE, no session_date filter)
    if (/FROM sessions[\s\S]*day_complete\s*=\s*FALSE/i.test(text)) {
      return Promise.resolve(plan.sessionRows || []);
    }
    // messages query (role IN user/assistant)
    if (/FROM messages[\s\S]*role\s+IN/i.test(text)) {
      return Promise.resolve(plan.messageRows || []);
    }
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
  // 5/29 Patrick — find sessions in-progress query by text-match (access-gate
  // SELECT students 也跑、不能再用 index 0).
  const sessionsQuery = sql.calls.find(c =>
    /FROM sessions/i.test(c.text) && /day_complete\s*=\s*FALSE/i.test(c.text)).text;
  assert.match(sessionsQuery, /day_complete\s*=\s*FALSE/i,
    'query must filter on day_complete = FALSE (今天已結束的不還原)');
  assert.match(sessionsQuery, /FROM sessions/i, 'must query sessions table');
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
  const sessionsQuery = sql.calls.find(c =>
    /FROM sessions/i.test(c.text) && /day_complete\s*=\s*FALSE/i.test(c.text)).text;
  assert.equal(/session_date\s*=/i.test(sessionsQuery), false,
    `query 必須 NOT 帶 session_date = … (A008 fix). 看到的 query:\n${sessionsQuery}`);
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
  // 5/29 Patrick — messages query 找法用 text-match (前面 access-gate SELECTs 不確定數量).
  const msgsQuery = sql.calls.find(c => /FROM messages/i.test(c.text)).text;
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

// ═════════════════════════════════════════════════════════
// 🛑 5/29 Patrick (Vivi access gate) — is_blocked + 30 天 window lazy expiry
// ═════════════════════════════════════════════════════════

test('🛑 conversation-today: is_blocked=true → 403 beta_access_ended, no sessions query', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  const sql = makeMockSql({
    studentRows: [{ is_blocked: true, is_beta: false, created_at: '2026-05-01' }],
    sessionRows: [{ id: 1, day: 1, day_complete: false }],
    messageRows: [{ role: 'user', content: 'x' }],
  });
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self' } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'beta_access_ended');
  // Sessions / messages 不該被查 (gate 在 sessions query 之前).
  assert.equal(sql.calls.some(c => /day_complete\s*=\s*FALSE/i.test(c.text)), false,
    'blocked 學員的 sessions in-progress query 不該執行 (避免無意義的 DB 查詢)');
});

test('🛑 conversation-today: is_beta=true + created_at > 30 天前 + 未完 Day 21 → lazy block + 403', async () => {
  const now = Date.now();
  const created31d = new Date(now - 31 * 24 * 60 * 60 * 1000).toISOString();
  _setStudentSessionReader(STUDENT_SESSION_FOR('A005'));
  const sql = makeMockSql({
    studentRows: [{ is_blocked: false, is_beta: true, created_at: created31d }],
    day21Rows: [],   // 未完成 Day 21
  });
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self' } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'beta_access_ended');
  // Lazy block: UPDATE students SET is_blocked=TRUE 被打.
  assert.equal(
    sql.calls.some(c => /UPDATE students SET is_blocked\s*=\s*TRUE/i.test(c.text)),
    true,
    'beta-window 過期應該 lazy 設 is_blocked=TRUE',
  );
});

test('🛑 conversation-today: is_beta=true + 已完成 Day 21 → 不 lazy block (走完不該關 access)', async () => {
  const now = Date.now();
  const created60d = new Date(now - 60 * 24 * 60 * 60 * 1000).toISOString();
  _setStudentSessionReader(STUDENT_SESSION_FOR('A005'));
  const sql = makeMockSql({
    studentRows: [{ is_blocked: false, is_beta: true, created_at: created60d }],
    day21Rows: [{ exists: 1 }],   // 已完成 Day 21
    sessionRows: [],
  });
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self' } }), res);
  assert.equal(res.statusCode, 200,
    '走完 Day 21 的封測者即使已過 30 天也不該被自動關 access');
  assert.equal(
    sql.calls.some(c => /UPDATE students SET is_blocked\s*=\s*TRUE/i.test(c.text)),
    false,
    'Day 21 完成者絕對不該被 lazy block',
  );
});

test('🛑 conversation-today: is_beta=true + 29 天前 (window 內) → 不 block, 正常 restore 流程', async () => {
  const now = Date.now();
  const created29d = new Date(now - 29 * 24 * 60 * 60 * 1000).toISOString();
  _setStudentSessionReader(STUDENT_SESSION_FOR('A005'));
  const sql = makeMockSql({
    studentRows: [{ is_blocked: false, is_beta: true, created_at: created29d }],
    sessionRows: [{ id: 7, day: 3, day_complete: false }],
    messageRows: [{ role: 'user', content: 'hi' }],
  });
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.hasInProgress, true);
  assert.equal(
    sql.calls.some(c => /UPDATE students SET is_blocked\s*=\s*TRUE/i.test(c.text)),
    false,
    'window 內 (29d) 不該觸發 lazy block',
  );
});

test('🛑 conversation-today: is_beta=false + 90 天前 → 不 block (一般學員 window 不適用)', async () => {
  const now = Date.now();
  const created90d = new Date(now - 90 * 24 * 60 * 60 * 1000).toISOString();
  _setStudentSessionReader(STUDENT_SESSION_FOR('A005'));
  const sql = makeMockSql({
    studentRows: [{ is_blocked: false, is_beta: false, created_at: created90d }],
    sessionRows: [],
  });
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self' } }), res);
  assert.equal(res.statusCode, 200,
    '一般學員 (非 is_beta) 即使過 90 天也絕不該被 window 機制鎖');
  assert.equal(
    sql.calls.some(c => /UPDATE students SET is_blocked\s*=\s*TRUE/i.test(c.text)),
    false,
    'is_beta=false 學員不適用 30 天 window',
  );
});

test('conversation-today: access-gate SQL 失敗 → fail-open (寧可放行 restore 也不誤鎖)', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  // students SELECT 失敗, 但其他 query 正常 — gate try/catch 應 fail-open 繼續流程.
  let calls = 0;
  _setSqlClient((strings, ...values) => {
    calls++;
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''),
      '',
    );
    if (/SELECT is_blocked, is_beta, created_at\s+FROM students/i.test(text)) {
      return Promise.reject(new Error('students lookup down'));
    }
    if (/day_complete\s*=\s*FALSE/i.test(text)) return Promise.resolve([]);   // no in-progress
    return Promise.resolve([]);
  });
  const res = mockRes();
  await handler(mockReq({ query: { module: 'self' } }), res);
  assert.equal(res.statusCode, 200,
    'access-gate SQL 失敗時 fail-open, 不誤鎖 (寧可放行 restore)');
});
