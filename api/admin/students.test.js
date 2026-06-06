// api/admin/students.test.js
// Patrick 5/29 — endpoint integration: auth gate + filters + SQL not-leak guard.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, { _setSqlClient } from './students.js';
import { _setCoachSessionReader } from '../../lib/auth/coach-session.js';

// ─── mock SQL ───────────────────────────────────────────────────

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

const COACH_OK = async () => ({ role: 'coach' });
const NO_COACH = async () => null;

// 9-student fixture mirroring封測 (2026-05-29 寫 spec 那天的狀況、Vivi 之前手寫
// 那份 markdown 就會被取代). 各組合都有一個 sample.
function makeFixtureRows() {
  return [
    // A001 — beta, active (今天有動), 9d 後仍在 window
    { student_id: 'A001', email: 'a@x.com', preferred_name: 'A', pace: 'daily',
      is_beta: true, is_blocked: false, created_at: '2026-05-20T12:00:00+08:00',
      days_since_register: 9, last_unlocked_day: 5,
      last_session_at: '2026-05-29T12:00:00+08:00',
      days_since_last_session: 0,
      finished_21: false, finished_at: null },
    // A002 — beta, at_risk (20 天沒動)
    { student_id: 'A002', email: 'b@x.com', preferred_name: 'B', pace: 'daily',
      is_beta: true, is_blocked: false, created_at: '2026-05-09T12:00:00+08:00',
      days_since_register: 20, last_unlocked_day: 3,
      last_session_at: '2026-05-09T12:00:00+08:00',
      days_since_last_session: 20,
      finished_21: false, finished_at: null },
    // A003 — beta, finished_21 ✓ (剛完成)
    { student_id: 'A003', email: 'c@x.com', preferred_name: 'C', pace: 'self-paced',
      is_beta: true, is_blocked: false, created_at: '2026-05-08T12:00:00+08:00',
      days_since_register: 21, last_unlocked_day: 21,
      last_session_at: '2026-05-29T11:00:00+08:00',
      days_since_last_session: 0,
      finished_21: true, finished_at: '2026-05-29T11:00:00+08:00' },
    // A004 — blocked
    { student_id: 'A004', email: 'd@x.com', preferred_name: 'D', pace: 'daily',
      is_beta: true, is_blocked: true, created_at: '2026-04-29T12:00:00+08:00',
      days_since_register: 30, last_unlocked_day: 7,
      last_session_at: '2026-05-15T12:00:00+08:00',
      days_since_last_session: 14,
      finished_21: false, finished_at: null },
    // A005 — !is_beta, active (一般學員、不在 window 範圍)
    { student_id: 'A005', email: 'e@x.com', preferred_name: 'E', pace: 'daily',
      is_beta: false, is_blocked: false, created_at: '2026-02-01T12:00:00+08:00',
      days_since_register: 117, last_unlocked_day: 10,
      last_session_at: '2026-05-28T12:00:00+08:00',
      days_since_last_session: 1,
      finished_21: false, finished_at: null },
    // A006 — beta, 剛註冊 0 天、還沒登入
    { student_id: 'A006', email: 'f@x.com', preferred_name: null, pace: 'daily',
      is_beta: true, is_blocked: false, created_at: '2026-05-29T08:00:00+08:00',
      days_since_register: 0, last_unlocked_day: 0,
      last_session_at: null,
      days_since_last_session: null,
      finished_21: false, finished_at: null },
  ];
}

beforeEach(() => {
  _setSqlClient(null);
  _setCoachSessionReader(null);
  process.env.SESSION_SECRET = 'test-secret-32-bytes-of-entropy-aaaaaaaa';
});

// ─── method + auth ──────────────────────────────────────────────

test('non-GET → 405', async () => {
  _setCoachSessionReader(COACH_OK);
  const res = mockRes();
  await handler(mockReq({ method: 'POST' }), res);
  assert.equal(res.statusCode, 405);
});

test('🛑 no coach session → 401 + 0 SQL', async () => {
  _setCoachSessionReader(NO_COACH);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 401);
  assert.equal(sql.calls.length, 0, 'coach gate must fire before any SQL');
});

// ─── happy path ─────────────────────────────────────────────────

test('🛑 GET (no query) → 200 + count=6 + shape locked', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql(makeFixtureRows()));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.count, 6);
  assert.equal(res.body.students.length, 6);
  // student object shape (鐵則 #2 — 不洩漏 messages / damon_note / SC 觀察)
  // ⭐ v5.2 第一塊 (Vivi 6/5) — +4 active_context_* fields.
  const allowed = [
    'created_at', 'days_remaining_in_beta_window', 'days_since_last_session',
    'days_since_register', 'email', 'finished_21', 'finished_at',
    'is_at_risk', 'is_beta', 'is_blocked', 'last_session_at',
    'last_unlocked_day', 'pace', 'preferred_name', 'student_id',
    // v5.2 active_context (server-side label + 3 raw fields)
    'active_context_category', 'active_context_label',
    'active_context_name', 'active_context_definition',
  ].sort();
  for (const r of res.body.students) {
    assert.deepEqual(Object.keys(r).sort(), allowed,
      `row shape must be exactly ${JSON.stringify(allowed)}; got ${JSON.stringify(Object.keys(r))}`);
  }
});

// ─── filter — email / student_id ────────────────────────────────

test('?email=b@x.com → 單一學員', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql(makeFixtureRows()));
  const res = mockRes();
  await handler(mockReq({ query: { email: 'b@x.com' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.students[0].student_id, 'A002');
});

test('?email=B@X.COM → 大小寫無視', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql(makeFixtureRows()));
  const res = mockRes();
  await handler(mockReq({ query: { email: 'B@X.COM' } }), res);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.students[0].student_id, 'A002');
});

test('?student_id=a003 → 大小寫無視 (uppercased)', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql(makeFixtureRows()));
  const res = mockRes();
  await handler(mockReq({ query: { student_id: 'a003' } }), res);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.students[0].student_id, 'A003');
});

// ─── filter — status ───────────────────────────────────────────

test('🛑 ?status=needs_30_day_notice → 排除 finished / blocked / !is_beta', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql(makeFixtureRows()));
  const res = mockRes();
  await handler(mockReq({ query: { status: 'needs_30_day_notice' } }), res);
  // A001 (active beta), A002 (at_risk beta), A006 (剛註冊 beta) ✓
  // A003 finished_21 ✗, A004 blocked ✗, A005 !is_beta ✗
  const ids = res.body.students.map(r => r.student_id).sort();
  assert.deepEqual(ids, ['A001', 'A002', 'A006']);
});

test('🛑 ?status=at_risk → 14+ 天沒動的封測者', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql(makeFixtureRows()));
  const res = mockRes();
  await handler(mockReq({ query: { status: 'at_risk' } }), res);
  assert.deepEqual(res.body.students.map(r => r.student_id), ['A002']);
});

test('🛑 ?status=finished → 只 finished_21=TRUE', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql(makeFixtureRows()));
  const res = mockRes();
  await handler(mockReq({ query: { status: 'finished' } }), res);
  assert.deepEqual(res.body.students.map(r => r.student_id), ['A003']);
});

test('🛑 ?status=blocked → 只 is_blocked=TRUE', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql(makeFixtureRows()));
  const res = mockRes();
  await handler(mockReq({ query: { status: 'blocked' } }), res);
  assert.deepEqual(res.body.students.map(r => r.student_id), ['A004']);
});

test('?status=garbage → 視同無 status filter (回全部)', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql(makeFixtureRows()));
  const res = mockRes();
  await handler(mockReq({ query: { status: 'garbage_value' } }), res);
  assert.equal(res.body.count, 6);
});

// ─── filter — is_beta / is_blocked ──────────────────────────────

test('?is_beta=true → 排除一般學員', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql(makeFixtureRows()));
  const res = mockRes();
  await handler(mockReq({ query: { is_beta: 'true' } }), res);
  const ids = res.body.students.map(r => r.student_id).sort();
  assert.deepEqual(ids, ['A001', 'A002', 'A003', 'A004', 'A006']);
});

test('?is_blocked=true → 只 blocked 學員', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql(makeFixtureRows()));
  const res = mockRes();
  await handler(mockReq({ query: { is_blocked: 'true' } }), res);
  assert.deepEqual(res.body.students.map(r => r.student_id), ['A004']);
});

test('?is_beta=false → 排除封測者', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql(makeFixtureRows()));
  const res = mockRes();
  await handler(mockReq({ query: { is_beta: 'false' } }), res);
  assert.deepEqual(res.body.students.map(r => r.student_id), ['A005']);
});

// ─── 鐵則 #2 grep guard — SQL 不取敏感欄位 ──────────────────────

test('🛑 SQL query 不取 messages / damon_note / sc_observation / breakthrough / layer', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  await handler(mockReq(), mockRes());
  const text = sql.calls[0].text;
  for (const banned of ['messages', 'damon_note', 'note_text',
                        'sc_observation', 'breakthrough', 'layer', 'notebook_page']) {
    assert.equal(new RegExp(banned, 'i').test(text), false,
      `SQL must not reference '${banned}' (鐵律 #2). text:\n${text}`);
  }
});

test('🛑 SQL query 用 Asia/Taipei TZ (跟 chat.js / journey.js 日界一致)', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  await handler(mockReq(), mockRes());
  const text = sql.calls[0].text;
  assert.match(text, /AT TIME ZONE 'Asia\/Taipei'/i,
    'SQL must compute days_since_* in Asia/Taipei (台北日界、與 lib/session/day-boundary 一致)');
});

// ─── edge cases ────────────────────────────────────────────────

test('剛註冊 0 天 → days_remaining_in_beta_window = 30', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql(makeFixtureRows()));
  const res = mockRes();
  await handler(mockReq({ query: { student_id: 'A006' } }), res);
  assert.equal(res.body.students[0].days_remaining_in_beta_window, 30);
  assert.equal(res.body.students[0].last_session_at, null);
  assert.equal(res.body.students[0].days_since_last_session, null);
  assert.equal(res.body.students[0].is_at_risk, false);
});

test('blocked + 還沒過 30 天 → 仍計算 days_remaining', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql(makeFixtureRows()));
  const res = mockRes();
  await handler(mockReq({ query: { student_id: 'A004' } }), res);
  // A004: days_since_register=30 → days_remaining = max(0, 30-30) = 0
  assert.equal(res.body.students[0].days_remaining_in_beta_window, 0);
  assert.equal(res.body.students[0].is_blocked, true);
});

test('剛完成 Day 21 → finished_21=TRUE + finished_at 填上 + is_at_risk=false', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql(makeFixtureRows()));
  const res = mockRes();
  await handler(mockReq({ query: { student_id: 'A003' } }), res);
  const a = res.body.students[0];
  assert.equal(a.finished_21, true);
  assert.equal(a.finished_at, '2026-05-29T11:00:00+08:00');
  assert.equal(a.is_at_risk, false);
});

test('SQL throws → 500 admin_students_failed', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(() => Promise.reject(new Error('DB down')));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'admin_students_failed');
});

test('empty DB → 200 + count=0', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true, count: 0, students: [] });
});

// ═════════════════════════════════════════════════════════
// 🛑 5/30 Patrick — dual-auth: cookie OR ADMIN_API_TOKEN Bearer (Daniel Cowork).
// ═════════════════════════════════════════════════════════

const FAKE_TOKEN = 'a'.repeat(64);

test('🛑 cookie ok → 200 (既有 browser 教練後台路徑不變)', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

test('🛑 Bearer ok → 200 + students[]', async () => {
  _setCoachSessionReader(NO_COACH);
  process.env.ADMIN_API_TOKEN = FAKE_TOKEN;
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  const req = mockReq();
  req.headers.authorization = `Bearer ${FAKE_TOKEN}`;
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.ok(Array.isArray(res.body.students));
  delete process.env.ADMIN_API_TOKEN;
});

test('🛑 no auth → 401', async () => {
  _setCoachSessionReader(NO_COACH);
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 401);
});

test('🛑 wrong Bearer → 401 (timing-safe rejects)', async () => {
  _setCoachSessionReader(NO_COACH);
  process.env.ADMIN_API_TOKEN = FAKE_TOKEN;
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  const req = mockReq();
  req.headers.authorization = `Bearer ${'b'.repeat(64)}`;
  await handler(req, res);
  assert.equal(res.statusCode, 401);
  delete process.env.ADMIN_API_TOKEN;
});

test('🛑 cookie + bearer 同時帶 → cookie 早 return (via=cookie 不誤觸發 bearer log)', async () => {
  _setCoachSessionReader(COACH_OK);
  process.env.ADMIN_API_TOKEN = FAKE_TOKEN;
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  const req = mockReq();
  req.headers.authorization = `Bearer ${FAKE_TOKEN}`;
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  delete process.env.ADMIN_API_TOKEN;
});

test('🛑 POST / PATCH / DELETE 即使帶有效 Bearer 仍 405 (寫入動作不開 service token)', async () => {
  _setCoachSessionReader(NO_COACH);
  process.env.ADMIN_API_TOKEN = FAKE_TOKEN;
  _setSqlClient(makeMockSql([]));
  for (const method of ['POST', 'PATCH', 'DELETE', 'PUT']) {
    const res = mockRes();
    const req = mockReq({ method });
    req.headers.authorization = `Bearer ${FAKE_TOKEN}`;
    await handler(req, res);
    assert.equal(res.statusCode, 405,
      `${method} with valid Bearer must still 405 (only GET opens dual-auth)`);
  }
  delete process.env.ADMIN_API_TOKEN;
});
