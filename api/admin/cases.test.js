// api/admin/cases.test.js
// Daniel 6/5 客服 ticketing handler tests — POST / GET / PATCH + auth + validation.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, { _setSqlClient } from './cases.js';

// ─── Mock helpers ────────────────────────────────────────

function mkSql(planFn) {
  const calls = [];
  let i = 0;
  const fn = (strings, ..._values) => {
    const text = strings.join('?');
    calls.push({ text, values: _values });
    if (typeof planFn === 'function') return Promise.resolve(planFn(text, i++));
    return Promise.resolve([]);
  };
  fn.calls = calls;
  return fn;
}

function mockReq({ method = 'GET', body = {}, query = {}, headers = {} } = {}) {
  return { method, body, query, headers };
}

function mockRes() {
  const r = {
    statusCode: 200, body: null,
    status(s) { r.statusCode = s; return r; },
    json(b)   { r.body = b; return r; },
  };
  return r;
}

const ADMIN_TOKEN_OK = { 'x-admin-token': 'test-token-32-bytes-of-entropy-aaaaaaaa' };

beforeEach(() => {
  _setSqlClient(null);
  process.env.ADMIN_TOKEN = 'test-token-32-bytes-of-entropy-aaaaaaaa';
  // ⚠️ getSqlFn() is now deferred past pre-DB validation in the handler, so
  // pure 4xx tests don't instantiate neon(). DATABASE_URL only needs setting
  // for tests that exercise the SQL path (those mock via _setSqlClient anyway).
});

// ─── Auth ────────────────────────────────────────────────

test('🛑 cases: no token → 401', async () => {
  const res = mockRes();
  await handler(mockReq({ method: 'POST', body: { email: 'a@b.c' } }), res);
  assert.equal(res.statusCode, 401);
});

test('🛑 cases: wrong token → 401', async () => {
  const res = mockRes();
  await handler(
    mockReq({ method: 'POST', body: { email: 'a@b.c' }, headers: { 'x-admin-token': 'WRONG' } }),
    res,
  );
  assert.equal(res.statusCode, 401);
});

test('🛑 cases: ADMIN_TOKEN env unset → 401 (fail-closed)', async () => {
  delete process.env.ADMIN_TOKEN;
  const res = mockRes();
  await handler(mockReq({ method: 'POST', headers: ADMIN_TOKEN_OK }), res);
  assert.equal(res.statusCode, 401);
});

test('🛑 cases: DELETE method → 405', async () => {
  const res = mockRes();
  await handler(mockReq({ method: 'DELETE', headers: ADMIN_TOKEN_OK }), res);
  assert.equal(res.statusCode, 405);
});

// ─── POST — create case ──────────────────────────────────

test('🛑 POST: valid email → 201 + case_id SY-YYYYMMDD-001', async () => {
  const sql = mkSql((text) => {
    if (/SELECT COUNT/.test(text)) return [{ cnt: 0 }];
    if (/INSERT INTO cases/.test(text)) {
      return [{ case_id: 'SY-20260606-001', created_at: '2026-06-06T08:00:00Z' }];
    }
    return [];
  });
  _setSqlClient(sql);
  const res = mockRes();
  await handler(
    mockReq({
      method: 'POST',
      headers: ADMIN_TOKEN_OK,
      body: { email: 'jessie@example.com', category: 'login', subject: 'cant log in', student_id: 'a011' },
    }),
    res,
  );
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.case_id, 'SY-20260606-001');
  // student_id upper-cased.
  const insertCall = sql.calls.find(c => /INSERT INTO cases/.test(c.text));
  assert.ok(insertCall, 'must have INSERT');
  assert.ok(insertCall.values.includes('A011'), 'student_id should be uppercased');
});

test('🛑 POST: missing email → 400 EMAIL_REQUIRED', async () => {
  const res = mockRes();
  await handler(
    mockReq({ method: 'POST', headers: ADMIN_TOKEN_OK, body: { category: 'bug' } }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'EMAIL_REQUIRED');
});

test('🛑 POST: malformed email → 400 EMAIL_INVALID', async () => {
  const res = mockRes();
  await handler(
    mockReq({ method: 'POST', headers: ADMIN_TOKEN_OK, body: { email: 'not-an-email' } }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'EMAIL_INVALID');
});

test('🛑 POST: invalid category → 400 CATEGORY_INVALID with allowed list', async () => {
  const res = mockRes();
  await handler(
    mockReq({
      method: 'POST',
      headers: ADMIN_TOKEN_OK,
      body: { email: 'a@b.c', category: 'spam' },
    }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'CATEGORY_INVALID');
  assert.ok(Array.isArray(res.body.allowed));
  assert.ok(res.body.allowed.includes('bug'));
});

test('🛑 POST: category default = other when missing', async () => {
  const sql = mkSql((text) => {
    if (/SELECT COUNT/.test(text)) return [{ cnt: 0 }];
    if (/INSERT INTO cases/.test(text)) {
      return [{ case_id: 'SY-20260606-001', created_at: '2026-06-06T08:00:00Z' }];
    }
    return [];
  });
  _setSqlClient(sql);
  const res = mockRes();
  await handler(
    mockReq({ method: 'POST', headers: ADMIN_TOKEN_OK, body: { email: 'a@b.c' } }),
    res,
  );
  assert.equal(res.statusCode, 201);
  const insertCall = sql.calls.find(c => /INSERT INTO cases/.test(c.text));
  assert.ok(insertCall.values.includes('other'), 'default category must be "other"');
});

test('🛑 POST: race retry — 1st INSERT 23505 conflict, 2nd succeeds at -002', async () => {
  let countCalls = 0;
  let insertCalls = 0;
  const sql = (strings) => {
    const text = strings.join('?');
    if (/SELECT COUNT/.test(text)) {
      countCalls += 1;
      return Promise.resolve([{ cnt: countCalls === 1 ? 0 : 1 }]);
    }
    if (/INSERT INTO cases/.test(text)) {
      insertCalls += 1;
      if (insertCalls === 1) {
        const err = new Error('duplicate key value violates unique constraint "cases_case_id_key"');
        err.code = '23505';
        return Promise.reject(err);
      }
      return Promise.resolve([{ case_id: 'SY-20260606-002', created_at: '2026-06-06T08:00:00Z' }]);
    }
    return Promise.resolve([]);
  };
  _setSqlClient(sql);
  const res = mockRes();
  await handler(
    mockReq({ method: 'POST', headers: ADMIN_TOKEN_OK, body: { email: 'a@b.c' } }),
    res,
  );
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.case_id, 'SY-20260606-002');
});

// ─── GET — list / filter ─────────────────────────────────

const SAMPLE_CASES = [
  {
    case_id: 'SY-20260606-003', email: 'a011@example.com', student_id: 'A011',
    status: 'open', category: 'login', subject: 'Day 1 stuck', notes: null,
    gmail_thread_id: 'thread-1', created_at: '2026-06-06T10:00:00Z', resolved_at: null,
  },
  {
    case_id: 'SY-20260606-002', email: 'a005@example.com', student_id: 'A005',
    status: 'awaiting_vivi', category: 'progress', subject: 'where is takeaway', notes: 'replied',
    gmail_thread_id: null, created_at: '2026-06-06T09:00:00Z', resolved_at: null,
  },
  {
    case_id: 'SY-20260606-001', email: 'lapsed@example.com', student_id: null,
    status: 'resolved', category: 'refund', subject: 'cancel trial', notes: 'refunded',
    gmail_thread_id: null, created_at: '2026-06-06T08:00:00Z',
    resolved_at: '2026-06-06T08:30:00Z',
  },
];

test('🛑 GET: no filter → all cases returned (DESC by created_at)', async () => {
  _setSqlClient(mkSql(() => SAMPLE_CASES));
  const res = mockRes();
  await handler(mockReq({ method: 'GET', headers: ADMIN_TOKEN_OK }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 3);
});

test('🛑 GET: ?student_id=A011 (uppercased) → 1 result', async () => {
  _setSqlClient(mkSql(() => SAMPLE_CASES));
  const res = mockRes();
  await handler(
    mockReq({ method: 'GET', headers: ADMIN_TOKEN_OK, query: { student_id: 'a011' } }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.count, 1);
  assert.equal(res.body.cases[0].case_id, 'SY-20260606-003');
});

test('🛑 GET: ?status=open → 1 result', async () => {
  _setSqlClient(mkSql(() => SAMPLE_CASES));
  const res = mockRes();
  await handler(
    mockReq({ method: 'GET', headers: ADMIN_TOKEN_OK, query: { status: 'open' } }),
    res,
  );
  assert.equal(res.body.count, 1);
  assert.equal(res.body.cases[0].status, 'open');
});

test('🛑 GET: ?email (case-insensitive) → matches', async () => {
  _setSqlClient(mkSql(() => SAMPLE_CASES));
  const res = mockRes();
  await handler(
    mockReq({ method: 'GET', headers: ADMIN_TOKEN_OK, query: { email: 'A005@EXAMPLE.COM' } }),
    res,
  );
  assert.equal(res.body.count, 1);
  assert.equal(res.body.cases[0].student_id, 'A005');
});

test('🛑 GET: ?case_id=SY-... → exact match', async () => {
  _setSqlClient(mkSql(() => SAMPLE_CASES));
  const res = mockRes();
  await handler(
    mockReq({ method: 'GET', headers: ADMIN_TOKEN_OK, query: { case_id: 'SY-20260606-002' } }),
    res,
  );
  assert.equal(res.body.count, 1);
  assert.equal(res.body.cases[0].case_id, 'SY-20260606-002');
});

test('🛑 GET: invalid status → 400 STATUS_INVALID', async () => {
  const res = mockRes();
  await handler(
    mockReq({ method: 'GET', headers: ADMIN_TOKEN_OK, query: { status: 'pending' } }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'STATUS_INVALID');
});

// ─── PATCH — update ──────────────────────────────────────

test('🛑 PATCH: missing case_id query → 400 CASE_ID_REQUIRED', async () => {
  const res = mockRes();
  await handler(
    mockReq({ method: 'PATCH', headers: ADMIN_TOKEN_OK, body: { status: 'resolved' } }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'CASE_ID_REQUIRED');
});

test('🛑 PATCH: malformed case_id → 400 CASE_ID_INVALID', async () => {
  const res = mockRes();
  await handler(
    mockReq({
      method: 'PATCH', headers: ADMIN_TOKEN_OK,
      query: { case_id: 'garbage' }, body: { status: 'resolved' },
    }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'CASE_ID_INVALID');
});

test('🛑 PATCH: no fields → 400 NO_FIELDS_TO_UPDATE', async () => {
  const res = mockRes();
  await handler(
    mockReq({
      method: 'PATCH', headers: ADMIN_TOKEN_OK,
      query: { case_id: 'SY-20260606-001' }, body: {},
    }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'NO_FIELDS_TO_UPDATE');
});

test('🛑 PATCH: invalid status enum → 400 STATUS_INVALID', async () => {
  const res = mockRes();
  await handler(
    mockReq({
      method: 'PATCH', headers: ADMIN_TOKEN_OK,
      query: { case_id: 'SY-20260606-001' }, body: { status: 'closed' },
    }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'STATUS_INVALID');
});

test('🛑 PATCH: case_id not found → 404 CASE_NOT_FOUND', async () => {
  _setSqlClient(mkSql(() => []));
  const res = mockRes();
  await handler(
    mockReq({
      method: 'PATCH', headers: ADMIN_TOKEN_OK,
      query: { case_id: 'SY-20260606-099' }, body: { status: 'resolved' },
    }),
    res,
  );
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, 'CASE_NOT_FOUND');
});

test('🛑 PATCH: status=resolved auto-fills resolved_at', async () => {
  // SQL plan: first UPDATE returns the row with status=resolved; auto-resolved
  // UPDATE returns the row with resolved_at populated.
  const sql = (strings, ..._values) => {
    const text = strings.join('?');
    if (/UPDATE cases\s+SET status = /.test(text)) {
      return Promise.resolve([{
        case_id: 'SY-20260606-001', email: 'x@y.z', status: 'resolved',
        notes: null, resolved_at: null, created_at: '2026-06-06T08:00:00Z',
        gmail_thread_id: null, subject: null, student_id: null, category: 'other',
      }]);
    }
    if (/UPDATE cases SET resolved_at = NOW\(\)/.test(text)) {
      return Promise.resolve([{
        case_id: 'SY-20260606-001', email: 'x@y.z', status: 'resolved',
        notes: null, resolved_at: '2026-06-06T08:30:00Z',
        created_at: '2026-06-06T08:00:00Z',
        gmail_thread_id: null, subject: null, student_id: null, category: 'other',
      }]);
    }
    return Promise.resolve([]);
  };
  _setSqlClient(sql);
  const res = mockRes();
  await handler(
    mockReq({
      method: 'PATCH', headers: ADMIN_TOKEN_OK,
      query: { case_id: 'SY-20260606-001' }, body: { status: 'resolved' },
    }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.case.status, 'resolved');
  assert.equal(res.body.case.resolved_at, '2026-06-06T08:30:00Z');
});

test('🛑 PATCH: notes only update', async () => {
  const sql = (strings) => {
    const text = strings.join('?');
    if (/UPDATE cases SET notes = /.test(text)) {
      return Promise.resolve([{
        case_id: 'SY-20260606-001', email: 'x@y.z', status: 'open',
        notes: 'Daniel replied via ack', resolved_at: null,
        created_at: '2026-06-06T08:00:00Z',
        gmail_thread_id: null, subject: null, student_id: null, category: 'other',
      }]);
    }
    return Promise.resolve([]);
  };
  _setSqlClient(sql);
  const res = mockRes();
  await handler(
    mockReq({
      method: 'PATCH', headers: ADMIN_TOKEN_OK,
      query: { case_id: 'SY-20260606-001' }, body: { notes: 'Daniel replied via ack' },
    }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.case.notes, 'Daniel replied via ack');
});

test('🛑 PATCH: explicit resolved_at honored (no auto-fill)', async () => {
  const sql = (strings) => {
    const text = strings.join('?');
    if (/UPDATE cases\s+SET status = /.test(text)) {
      return Promise.resolve([{
        case_id: 'SY-20260606-001', email: 'x@y.z', status: 'resolved',
        notes: null, resolved_at: '2026-06-05T15:00:00.000Z',
        created_at: '2026-06-06T08:00:00Z',
        gmail_thread_id: null, subject: null, student_id: null, category: 'other',
      }]);
    }
    if (/UPDATE cases SET resolved_at = /.test(text)) {
      return Promise.resolve([{
        case_id: 'SY-20260606-001', email: 'x@y.z', status: 'resolved',
        notes: null, resolved_at: '2026-06-05T15:00:00.000Z',
        created_at: '2026-06-06T08:00:00Z',
        gmail_thread_id: null, subject: null, student_id: null, category: 'other',
      }]);
    }
    return Promise.resolve([]);
  };
  _setSqlClient(sql);
  const res = mockRes();
  await handler(
    mockReq({
      method: 'PATCH', headers: ADMIN_TOKEN_OK,
      query: { case_id: 'SY-20260606-001' },
      body: { status: 'resolved', resolved_at: '2026-06-05T15:00:00.000Z' },
    }),
    res,
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.case.resolved_at, '2026-06-05T15:00:00.000Z');
});

test('🛑 PATCH: invalid resolved_at → 400 RESOLVED_AT_INVALID', async () => {
  const res = mockRes();
  await handler(
    mockReq({
      method: 'PATCH', headers: ADMIN_TOKEN_OK,
      query: { case_id: 'SY-20260606-001' }, body: { resolved_at: 'not-a-date' },
    }),
    res,
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'RESOLVED_AT_INVALID');
});
