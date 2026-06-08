// api/students.test.js
// PR-4c-green Patrick 5/24 — surgical lock: GET, PATCH, and POST(create student)
// require a coach OAuth session; POST action='login' intentionally stays open
// (it's the v4-compat student login path with its own studentId+email auth).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, { _setSqlClient } from './students.js';
import { _setCoachSessionReader } from '../lib/auth/coach-session.js';
// 6/02 — also need to reset student session reader, since PATCH dual-auth checks it.
import { _setStudentSessionReader } from '../lib/auth/student-session.js';

// ── mock SQL + req/res helpers ──

function makeMockSql(rowsByCall = []) {
  // rowsByCall: either a single array (returned for every call) or an array of
  // arrays (returned in order, one per call).
  const calls = [];
  let callIdx = 0;
  const fn = (strings, ...values) => {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''),
      '',
    );
    calls.push({ strings: Array.from(strings), values, text });
    const rows = Array.isArray(rowsByCall[0])
      ? (rowsByCall[callIdx++] || [])
      : rowsByCall;
    return Promise.resolve(rows);
  };
  fn.calls = calls;
  return fn;
}

function mockReq({ method = 'GET', query = {}, body = {} } = {}) {
  return { method, query, body };
}

function mockRes() {
  const r = {
    statusCode: 200, body: null,
    status(s) { r.statusCode = s; return r; },
    json(b)   { r.body = b; return r; },
  };
  return r;
}

// Auth rebuild stage 1a: HMAC session model. The reader returns a payload like
// {role:'coach'} (authorized) or null (not). Old getToken({email:...}) shape gone.
const COACH_OK = async () => ({ role: 'coach' });
const NO_SESSION = async () => null;

beforeEach(() => {
  _setSqlClient(null);
  _setCoachSessionReader(null);
  _setStudentSessionReader(null);   // 6/02 — clear student session reader between tests (PATCH dual-auth).
  process.env.SESSION_SECRET = 'test-secret-32-bytes-of-entropy-aaaaaaaa';
});

// ═════════════════════════════════════════════════════════
// 🛑 (a) Coach branches all require a coach session → 401 without one
// ═════════════════════════════════════════════════════════

test('🛑 students.js GET (list): no session → 401', async () => {
  _setCoachSessionReader(NO_SESSION);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: {} }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(sql.calls.length, 0, 'GET list must not touch DB without coach session');
});

test('🛑 students.js GET (single by studentId): no session → 401', async () => {
  _setCoachSessionReader(NO_SESSION);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: { studentId: 'A001' } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(sql.calls.length, 0);
});

test('🛑 students.js PATCH (edit student): no session → 401', async () => {
  _setCoachSessionReader(NO_SESSION);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', plan: 'plan_a' },
  }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(sql.calls.length, 0);
});

test('🛑 students.js POST (create student, no action): no session → 401', async () => {
  _setCoachSessionReader(NO_SESSION);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'POST',
    body: { email: 'new@example.com', plan: 'trial' },   // no `action: 'login'`
  }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(sql.calls.length, 0, 'create student must not touch DB without coach session');
});

test('🛑 students.js wrong-role session (e.g. student) → 401', async () => {
  // PR-4c-green Auth rebuild stage 1a: email-allowlist gate replaced by role gate.
  _setCoachSessionReader(async () => ({ role: 'student', sid: 'A001' }));
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: {} }), res);
  assert.equal(res.statusCode, 401);
});

// ═════════════════════════════════════════════════════════
// 🛑 (b) POST action='login' RETIRED — replaced by magic link in stage 1d
// ═════════════════════════════════════════════════════════
// The v4-compat student login path (POST students.js with action=login) was
// removed in 1d. Student login now uses /api/auth/request-link → email →
// /api/auth/verify-link → sets student_session cookie. Any POST to /api/students
// without a coach session → 401 from the coach gate, including a POST that
// claims action=login (the special-casing is gone).

test('🛑 students.js POST action=login: retired — now 401 from coach gate (no special case)', async () => {
  _setCoachSessionReader(NO_SESSION);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'POST',
    body: { action: 'login', studentId: 'A001', email: 'vivi@example.com' },
  }), res);
  assert.equal(res.statusCode, 401, 'action=login no longer accepted; coach gate fires');
  assert.equal(sql.calls.length, 0, 'no DB query — gate fires before any work');
});

// ═════════════════════════════════════════════════════════
// (c) Authorized coach → existing branches still work
// ═════════════════════════════════════════════════════════

test('students.js GET (list) authorized → 200 with students array', async () => {
  _setCoachSessionReader(COACH_OK);
  // 5/25 (Vivi: effective_day) — list 現在會多打 2 支 query (UPE + last session)
  // 跑跟 /api/journey 同一套 computeUnlockedCurrentDay. 4-call dance:
  //   1) SELECT * FROM students
  //   2) sessions stats (days_completed / last_active)
  //   3) user_profile_evolution (session_day_count)
  //   4) DISTINCT ON sessions (last day_complete)
  _setSqlClient(makeMockSql([
    [{ student_id: 'A001', email: 'a@b.com', plan: 'trial', pace: 'daily', current_day: 1 }],   // SELECT * FROM students
    [{ student_id: 'A001', days_completed: '3', last_active: '2026-05-23' }],   // sessions stats
    [{ student_id: 'A001', session_day_count: 4 }],   // user_profile_evolution
    [{ student_id: 'A001', day_complete: false }],   // last session (DISTINCT ON)
  ]));
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: {} }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body.students), 'students array shape preserved');
  assert.equal(res.body.students[0].student_id, 'A001');
});

// 🛑 5/25 (Vivi: 清單每個人都顯示 Day 1) — effective_day 用 UPE.session_day_count
// 算、不再讀 students.current_day (那欄只在註冊設 1).
test('🛑 students.js GET list: effective_day = computeUnlockedCurrentDay(UPE + last session)', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([
    // 3 students, all stuck at students.current_day=1 (because nothing updates it)
    [
      { student_id: 'A001', email: 'a@b.com', pace: 'daily',      current_day: 1 },
      { student_id: 'A002', email: 'b@b.com', pace: 'self-paced', current_day: 1 },
      { student_id: 'A003', email: 'c@b.com', pace: 'daily',      current_day: 1 },   // brand new
    ],
    [],   // sessions stats (none)
    // user_profile_evolution: A001 已到 Day 4, A002 已到 Day 7, A003 沒 UPE row
    [
      { student_id: 'A001', session_day_count: 4 },
      { student_id: 'A002', session_day_count: 7 },
    ],
    // last session day_complete: A001 sessions未完成 (今天還在), A002 已完成 → +1
    [
      { student_id: 'A001', day_complete: false },
      { student_id: 'A002', day_complete: true  },
    ],
  ]));
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: {} }), res);
  assert.equal(res.statusCode, 200);
  const byId = Object.fromEntries(res.body.students.map(s => [s.student_id, s]));
  // A001: daily, session_day_count=4 → Day 4
  assert.equal(byId.A001.effective_day, 4,
    `A001 daily UPE=4 should report Day 4, got ${byId.A001.effective_day}`);
  // A002: self-paced, session_day_count=7, last day_complete=true → Day 8 (active-empty next day)
  assert.equal(byId.A002.effective_day, 8,
    `A002 self-paced UPE=7 + lastComplete=true should report Day 8, got ${byId.A002.effective_day}`);
  // A003: no UPE row → fallback to stored current_day=1
  assert.equal(byId.A003.effective_day, 1,
    `A003 brand-new (no UPE) should fall back to stored current_day=1, got ${byId.A003.effective_day}`);
});

// 🛑 5/26 Patrick — regression guard: UPE table 沒有 module 欄位 (keyed by
// student_id only). 上一份 spec 寫 `WHERE module = 'self'` 拋「column "module"
// does not exist」、整 try 被 catch → dayInfo={} → 全清單 fallback 到 stale
// students.current_day=1 → 看起來「effective_day 沒接上」. 修：UPE query
// 不能帶 module 過濾.
test('🛑 students.js GET list: UPE query MUST NOT filter by module (no such column)', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([
    [{ student_id: 'A001', pace: 'daily', current_day: 1 }],
    [],
    [{ student_id: 'A001', session_day_count: 5 }],
    [{ student_id: 'A001', day_complete: false }],
  ]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: {} }), res);
  assert.equal(res.statusCode, 200);
  // The 3rd SQL call is the UPE query — must NOT mention `module`
  // (anything matching /module/i in the UPE text would re-introduce the bug).
  const upeCall = sql.calls[2];
  assert.ok(upeCall, 'expected at least 3 SQL calls (students / stats / UPE)');
  assert.ok(/user_profile_evolution/i.test(upeCall.text),
    `3rd call should be UPE query. text was: ${upeCall.text}`);
  assert.ok(!/\bmodule\b/i.test(upeCall.text),
    `UPE query must NOT filter by module (no such column). text was: ${upeCall.text}`);
  // Sanity: effective_day actually 接上 (=5, daily UPE=5).
  assert.equal(res.body.students[0].effective_day, 5);
});

test('students.js GET list: effective_day compute failure (UPE/sessions throw) → falls back to current_day', async () => {
  _setCoachSessionReader(COACH_OK);
  // Simulate UPE query throwing — the catch block must absorb it and fall back.
  let callIdx = 0;
  const sql = (strings, ...values) => {
    callIdx++;
    if (callIdx === 1) return Promise.resolve([{ student_id: 'A001', current_day: 7, pace: 'daily' }]);
    if (callIdx === 2) return Promise.resolve([]);   // sessions stats empty
    if (callIdx === 3) return Promise.reject(new Error('UPE table missing'));   // UPE query fails
    return Promise.resolve([]);
  };
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: {} }), res);
  assert.equal(res.statusCode, 200, 'handler must not 500 on UPE failure');
  assert.equal(res.body.students[0].effective_day, 7,
    'on UPE failure, effective_day falls back to stored s.current_day');
});

test('students.js POST create student authorized → 200 with new studentId', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([
    [],   // email dup check: none
    [{ student_id: 'A042' }],   // last A### query
    [],   // INSERT returns nothing
  ]));
  const res = mockRes();
  await handler(mockReq({
    method: 'POST',
    body: { email: 'new@example.com', plan: 'trial' },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.studentId, 'A043');
});

test('students.js PATCH authorized → 200', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([
    [{ student_id: 'A001' }],   // exists check
    [],                          // UPDATE
  ]));
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', plan: 'plan_a' },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
});

// ═════════════════════════════════════════════════════════
// 5/27 Patrick — PATCH 擴白名單: pace / preferred_name / is_beta
// ═════════════════════════════════════════════════════════

test('🛑 PATCH pace=self-paced → 200 + UPDATE COALESCE 句帶 pace', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([
    [{ student_id: 'A001' }],   // exists
    [],                          // UPDATE main
  ]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', pace: 'self-paced' },
  }), res);
  assert.equal(res.statusCode, 200);
  // 第 2 個 SQL call 是主 UPDATE — 必須帶 pace COALESCE.
  const upd = sql.calls[1];
  assert.match(upd.text, /UPDATE students SET[\s\S]*pace\s*=\s*COALESCE/i);
  // 自己送的 pace 值要在 values 裡.
  assert.ok(upd.values.includes('self-paced'),
    `expected 'self-paced' in UPDATE values. saw: ${JSON.stringify(upd.values)}`);
});

test('🛑 PATCH pace=invalid → 400 INVALID_PACE + 不查 / 不 UPDATE', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', pace: 'whenever' },
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_PACE');
  assert.equal(sql.calls.length, 0,
    'invalid pace 必須在任何 SQL 之前 reject (defense in depth)');
});

test('🛑 PATCH preferred_name=「Vivi 改名」→ 200 + 單獨 UPDATE preferred_name 那條被打', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([
    [{ student_id: 'A001' }],   // exists
    [],                          // UPDATE main
    [],                          // UPDATE preferred_name (separate)
  ]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', preferred_name: 'Vivi 改名' },
  }), res);
  assert.equal(res.statusCode, 200);
  // 3rd SQL call = preferred_name UPDATE.
  const upd = sql.calls[2];
  assert.match(upd.text, /UPDATE students SET\s+preferred_name\s*=/i);
  assert.ok(upd.values.includes('Vivi 改名'),
    `expected 'Vivi 改名' in preferred_name UPDATE values. saw: ${JSON.stringify(upd.values)}`);
});

test('🛑 PATCH preferred_name="" (清空) → 200 + 寫 null', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([
    [{ student_id: 'A001' }],
    [], [],
  ]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', preferred_name: '   ' },   // whitespace → trim → '' → null
  }), res);
  assert.equal(res.statusCode, 200);
  const upd = sql.calls[2];
  assert.match(upd.text, /UPDATE students SET\s+preferred_name\s*=/i);
  assert.ok(upd.values.includes(null),
    `expected null in preferred_name UPDATE values (清空). saw: ${JSON.stringify(upd.values)}`);
});

test('🛑 PATCH preferred_name 長度 51 → 400 PREFERRED_NAME_TOO_LONG', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', preferred_name: 'x'.repeat(51) },
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'PREFERRED_NAME_TOO_LONG');
  assert.equal(sql.calls.length, 0, '長度驗證必須在 SQL 之前');
});

test('🛑 PATCH is_beta=true → 200 + UPDATE COALESCE 帶 is_beta=true', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([
    [{ student_id: 'A001' }],
    [],
  ]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', is_beta: true },
  }), res);
  assert.equal(res.statusCode, 200);
  const upd = sql.calls[1];
  assert.match(upd.text, /is_beta\s*=\s*COALESCE/i);
  assert.ok(upd.values.includes(true),
    `expected true (boolean) in is_beta UPDATE values. saw: ${JSON.stringify(upd.values)}`);
});

test('PATCH partial (只送 pace): 其他欄位 COALESCE 用 null → DB 端保留原值', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([
    [{ student_id: 'A001' }],
    [],
  ]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', pace: 'self-paced' },
  }), res);
  assert.equal(res.statusCode, 200);
  const upd = sql.calls[1];
  // pace 有送 → 'self-paced'; 其他 (plan/tier/current_module/current_week/current_day/is_beta/is_blocked) → null.
  assert.ok(upd.values.includes('self-paced'));
  // 至少 6 個 null (plan/tier/cm/cw/cd + is_beta + is_blocked) — COALESCE(null, 原值) 保留原值.
  // 6/7 Vivi: is_blocked 加入 main UPDATE COALESCE → null arm 上限從 5 → 6.
  const nullCount = upd.values.filter(v => v === null).length;
  assert.ok(nullCount >= 6,
    `expected at least 6 null COALESCE arms (plan/tier/cm/cw/cd/is_beta/is_blocked unset). saw values: ${JSON.stringify(upd.values)}`);
});

// ═════════════════════════════════════════════════════════
// 5/27 Patrick — GET single-student 回填欄位
// ═════════════════════════════════════════════════════════

test('🛑 GET ?studentId=A001 → 含 pace / preferred_name / is_beta (編輯表單回填)', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([
    [{
      student_id: 'A001', current_module: 'self', current_week: 1, current_day: 3,
      plan: 'trial', tier: 0, pace: 'self-paced',
      preferred_name: 'Vivi', is_beta: true,
    }],
  ]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ method: 'GET', query: { studentId: 'A001' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.student.pace, 'self-paced');
  assert.equal(res.body.student.preferred_name, 'Vivi');
  assert.equal(res.body.student.is_beta, true);
  // 🛑 email / notes 仍刻意不回 (v3 安全設計).
  assert.equal('email' in res.body.student, false,
    'single-student GET response must NOT carry email (v3 安全設計)');
  assert.equal('notes' in res.body.student, false,
    'single-student GET response must NOT carry notes');
});

test('students.js: unknown method (coach authorized) → 405', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ method: 'DELETE' }), res);
  assert.equal(res.statusCode, 405);
});

// ═════════════════════════════════════════════════════════
// 🛑 6/02 Patrick — PATCH student-self path (Landing skip-email funnel).
// 學員本人 ONLY 改自己的 preferred_name + pace; 鐵則 1d 守.
// (_setStudentSessionReader imported at top of file alongside coach reader.)
// ═════════════════════════════════════════════════════════

const STUDENT_SESSION_FOR = (sid) => async () => ({ role: 'student', sid });

test('🛑 PATCH self: student session + 自己的 studentId + preferred_name + pace → 200', async () => {
  _setCoachSessionReader(NO_SESSION);
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql([
    [{ student_id: 'A001' }],   // exists
    [],                          // UPDATE main
    [],                          // UPDATE preferred_name
  ]));
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', preferred_name: 'Vivi', pace: 'self-paced' },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
});

test('🛑 PATCH self: 學員改別人 (studentId 跟 sid 不對) → 403 FORBIDDEN (鐵則 1d)', async () => {
  _setCoachSessionReader(NO_SESSION);
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A999', preferred_name: 'Hacker', pace: 'daily' },
  }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'FORBIDDEN');
  assert.equal(sql.calls.length, 0, '不能 touch DB 在 cross-student PATCH');
});

test('🛑 PATCH self: 學員想送 plan / tier / is_beta → 403 FORBIDDEN_FIELD (allowlist)', async () => {
  for (const escalation of ['plan', 'tier', 'current_module', 'current_week',
                             'current_day', 'notes', 'is_beta']) {
    _setCoachSessionReader(NO_SESSION);
    _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
    _setSqlClient(makeMockSql([]));
    const res = mockRes();
    const body = { studentId: 'A001', preferred_name: 'Vivi' };
    body[escalation] = (escalation === 'is_beta') ? true
                       : (escalation === 'plan') ? 'plan_a'
                       : (escalation === 'notes') ? 'self-promote'
                       : 99;
    await handler(mockReq({ method: 'PATCH', body }), res);
    assert.equal(res.statusCode, 403,
      `field "${escalation}" 必須擋 (學員不可自我提權), 看到: ${res.statusCode}`);
    assert.equal(res.body.error, 'FORBIDDEN_FIELD');
    assert.equal(res.body.field, escalation);
  }
});

test('🛑 PATCH self: 無任何 session → 401 (既有 coach 401 行為不變)', async () => {
  _setCoachSessionReader(NO_SESSION);
  _setStudentSessionReader(async () => null);
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', preferred_name: 'Vivi' },
  }), res);
  assert.equal(res.statusCode, 401);
});

// ═════════════════════════════════════════════════════════
// ⭐ v5.2 第一塊 (Vivi 6/5) — PATCH active_context_category / name / definition
// ═════════════════════════════════════════════════════════

test('🛑 v5.2 PATCH active_context_category=3 → 200 + UPDATE COALESCE 帶 active_context_category=3', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([
    [{ student_id: 'A001' }],
    [],
  ]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', active_context_category: 3 },
  }), res);
  assert.equal(res.statusCode, 200);
  const upd = sql.calls[1];
  assert.match(upd.text, /active_context_category\s*=\s*COALESCE/i);
  assert.ok(upd.values.includes(3),
    `expected 3 in active_context_category UPDATE values. saw: ${JSON.stringify(upd.values)}`);
});

test('🛑 v5.2 PATCH active_context_category=6 → 400 INVALID_ACTIVE_CONTEXT_CATEGORY + no SQL', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', active_context_category: 6 },
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_ACTIVE_CONTEXT_CATEGORY');
  assert.equal(sql.calls.length, 0, 'invalid category 在任何 SQL 之前 reject');
});

test('🛑 v5.2 PATCH active_context_category=0 → 400 (boundary low)', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', active_context_category: 0 },
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'INVALID_ACTIVE_CONTEXT_CATEGORY');
});

test('🛑 v5.2 PATCH active_context_name (≤ 30) → 200 + 單獨 UPDATE active_context_name', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([
    [{ student_id: 'A001' }],
    [],   // main UPDATE
    [],   // active_context_name UPDATE
  ]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', active_context_name: '我跟先生的溝通' },
  }), res);
  assert.equal(res.statusCode, 200);
  // 3rd call (or later) — find the active_context_name UPDATE.
  const nameUpd = sql.calls.find(c => /UPDATE students SET\s+active_context_name\s*=/i.test(c.text));
  assert.ok(nameUpd, 'active_context_name UPDATE not found');
  assert.ok(nameUpd.values.includes('我跟先生的溝通'),
    `expected 我跟先生的溝通 in values. saw: ${JSON.stringify(nameUpd.values)}`);
});

test('🛑 v5.2 PATCH active_context_name 31 chars → 400 ACTIVE_CONTEXT_NAME_TOO_LONG', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', active_context_name: '我'.repeat(31) },
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'ACTIVE_CONTEXT_NAME_TOO_LONG');
});

test('🛑 v5.2 PATCH active_context_definition 201 chars → 400 ACTIVE_CONTEXT_DEFINITION_TOO_LONG', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', active_context_definition: '說明'.repeat(101) },
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'ACTIVE_CONTEXT_DEFINITION_TOO_LONG');
});

test('🛑 v5.2 PATCH active_context_name="" (whitespace 清空) → null UPDATE', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([
    [{ student_id: 'A001' }],
    [], [],
  ]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', active_context_name: '   ' },
  }), res);
  assert.equal(res.statusCode, 200);
  const nameUpd = sql.calls.find(c => /UPDATE students SET\s+active_context_name\s*=/i.test(c.text));
  assert.ok(nameUpd);
  assert.ok(nameUpd.values.includes(null),
    `expected null in active_context_name UPDATE. saw: ${JSON.stringify(nameUpd.values)}`);
});

test('🛑 v5.2 PATCH self (student session): 學員想送 active_context_* → 403 FORBIDDEN_FIELD', async () => {
  for (const escalation of ['active_context_category', 'active_context_name', 'active_context_definition']) {
    _setCoachSessionReader(NO_SESSION);
    _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
    _setSqlClient(makeMockSql([]));
    const res = mockRes();
    const body = { studentId: 'A001' };
    body[escalation] = (escalation === 'active_context_category') ? 2 : '我跟先生的溝通';
    await handler(mockReq({ method: 'PATCH', body }), res);
    assert.equal(res.statusCode, 403,
      `field "${escalation}" 必須擋 (學員不可改 program-level context). 看到: ${res.statusCode}`);
    assert.equal(res.body.error, 'FORBIDDEN_FIELD');
    assert.equal(res.body.field, escalation);
  }
});

test('🛑 v5.2 GET ?studentId=A001 → 含 active_context_category / name / definition', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([
    [{
      student_id: 'A001', current_module: 'self',
      current_week: 1, current_day: 1, plan: 'plan_a', tier: 1,
      pace: 'daily', preferred_name: 'V', is_beta: true,
      active_context_category: 3,
      active_context_name: '我跟先生的溝通',
      active_context_definition: '主要是日常溝通',
    }],
  ]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'GET',
    query: { studentId: 'A001' },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.student.active_context_category, 3);
  assert.equal(res.body.student.active_context_name, '我跟先生的溝通');
  assert.equal(res.body.student.active_context_definition, '主要是日常溝通');
  // SELECT 必須含 active_context_* (snapshot lock for future GET shape regression).
  assert.match(sql.calls[0].text, /active_context_category/);
  assert.match(sql.calls[0].text, /active_context_name/);
  assert.match(sql.calls[0].text, /active_context_definition/);
});

// ═════════════════════════════════════════════════════════

test('🛑 PATCH coach 路徑不受影響: coach session 仍可改 plan / is_beta (allowlist 只 apply 到 student-self)', async () => {
  _setCoachSessionReader(COACH_OK);
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));   // 兩個都有, coach 優先
  _setSqlClient(makeMockSql([
    [{ student_id: 'A001' }],
    [],
  ]));
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', plan: 'plan_a', is_beta: true },
  }), res);
  assert.equal(res.statusCode, 200, 'coach 仍可改 plan/is_beta (既有後台編輯功能不破)');
});

// ═════════════════════════════════════════════════════════
// ⭐ 6/7 Vivi — PATCH is_blocked (教練後台「封鎖」勾選, 取代手動下 SQL)
// ═════════════════════════════════════════════════════════

test('🛑 6/7 PATCH coach is_blocked=true → 200 + UPDATE COALESCE 帶 is_blocked=true', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([
    [{ student_id: 'A001' }],
    [],
  ]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', is_blocked: true },
  }), res);
  assert.equal(res.statusCode, 200);
  const upd = sql.calls[1];
  assert.match(upd.text, /is_blocked\s*=\s*COALESCE/i,
    'main UPDATE must reference is_blocked COALESCE');
  assert.ok(upd.values.includes(true),
    `expected true in is_blocked UPDATE values. saw: ${JSON.stringify(upd.values)}`);
});

test('🛑 6/7 PATCH coach is_blocked=false → 200 + UPDATE COALESCE 帶 is_blocked=false (解封)', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([
    [{ student_id: 'A001' }],
    [],
  ]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', is_blocked: false },
  }), res);
  assert.equal(res.statusCode, 200);
  const upd = sql.calls[1];
  assert.ok(upd.values.includes(false),
    `expected false in is_blocked UPDATE values (unblock). saw: ${JSON.stringify(upd.values)}`);
});

test('🛑 6/7 PATCH coach is_blocked undefined → COALESCE 用 null (不動原值)', async () => {
  // 教練只勾 is_beta 沒勾 is_blocked → is_blocked 不應被覆寫.
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([
    [{ student_id: 'A001' }],
    [],
  ]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'PATCH',
    body: { studentId: 'A001', is_beta: true },   // 沒送 is_blocked
  }), res);
  assert.equal(res.statusCode, 200);
  const upd = sql.calls[1];
  // 至少 6 個 null (plan/tier/cm/cw/cd + is_blocked 未送) — COALESCE 保留原值.
  const nullCount = upd.values.filter(v => v === null).length;
  assert.ok(nullCount >= 6,
    `expected ≥ 6 null COALESCE arms (incl. is_blocked unset). saw values: ${JSON.stringify(upd.values)}`);
});

// 🛑 P0 security: 學員絕不可自我解封 (allowlist must block is_blocked).
test('🛑 6/7 PATCH self: 學員送 is_blocked → 403 FORBIDDEN_FIELD (鐵則: 學員不能自己解封)', async () => {
  for (const val of [true, false]) {
    _setCoachSessionReader(NO_SESSION);
    _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
    const sql = makeMockSql([]);
    _setSqlClient(sql);
    const res = mockRes();
    await handler(mockReq({
      method: 'PATCH',
      body: { studentId: 'A001', is_blocked: val },
    }), res);
    assert.equal(res.statusCode, 403,
      `is_blocked=${val} 必須擋 (學員不可自我解封 / 自我封鎖)`);
    assert.equal(res.body.error, 'FORBIDDEN_FIELD');
    assert.equal(res.body.field, 'is_blocked');
    assert.equal(sql.calls.length, 0, 'forbidden 在 DB touch 之前');
  }
});

// ═════════════════════════════════════════════════════════
// ⭐ 6/7 Vivi — GET single student SELECT 帶 is_blocked + day1_completed_at
// ═════════════════════════════════════════════════════════

test('🛑 6/7 GET ?studentId=A001 → 含 is_blocked + day1_completed_at (教練後台表單回填)', async () => {
  _setCoachSessionReader(COACH_OK);
  const completedAt = '2026-06-08T03:15:00.000Z';   // arbitrary ISO
  const sql = makeMockSql([
    [{
      student_id: 'A001', current_module: 'self',
      current_week: 1, current_day: 2, plan: 'trial', tier: 0,
      pace: 'daily', preferred_name: 'V', is_beta: true,
      is_blocked: true,
      day1_completed_at: completedAt,
      active_context_category: 5,
      active_context_name: '我的焦慮',
      active_context_definition: '工作時段最明顯',
    }],
  ]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'GET', query: { studentId: 'A001' },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.student.is_blocked, true);
  assert.equal(res.body.student.day1_completed_at, completedAt);
  // SELECT 必須含 is_blocked + day1_completed_at (lock for regression).
  assert.match(sql.calls[0].text, /is_blocked/);
  assert.match(sql.calls[0].text, /day1_completed_at/);
});

test('🛑 6/7 GET ?studentId=A001 → day1_completed_at=null (未完成 Day 1)', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([
    [{
      student_id: 'A001', current_module: 'self',
      current_week: 1, current_day: 1, plan: 'trial', tier: 0,
      pace: 'daily', preferred_name: null, is_beta: false,
      is_blocked: false, day1_completed_at: null,
      active_context_category: 1,
      active_context_name: null, active_context_definition: null,
    }],
  ]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({
    method: 'GET', query: { studentId: 'A001' },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.student.day1_completed_at, null);
  assert.equal(res.body.student.is_blocked, false);
});
