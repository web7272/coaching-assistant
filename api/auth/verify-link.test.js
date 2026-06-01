// api/auth/verify-link.test.js
// PR-4c-green Auth rebuild stage 1c — verify-link endpoint.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, {
  _setSqlClient,
  isValidTokenShape,
  STUDENT_COOKIE_NAME,
} from './verify-link.js';
import { verifySession } from '../../lib/auth/session.js';

const SECRET = 'test-secret-32-bytes-of-entropy-aaaaaaaa';
const VALID_TOKEN = 'a'.repeat(64);                              // 64 hex chars
const VALID_TOKEN_2 = '0123456789abcdef'.repeat(4);              // also 64 hex chars

// ── mock SQL: per-call rows ──

function makeMockSql(rowsByCall = []) {
  const calls = [];
  let i = 0;
  const fn = (strings, ...values) => {
    const text = strings.reduce(
      (acc, s, j) => acc + s + (j < values.length ? `$${j + 1}` : ''),
      '',
    );
    calls.push({ strings: Array.from(strings), values, text });
    const rows = Array.isArray(rowsByCall[0])
      ? (rowsByCall[i++] || [])
      : rowsByCall;
    return Promise.resolve(rows);
  };
  fn.calls = calls;
  return fn;
}

function mockReq({ method = 'POST', body = {} } = {}) {
  return { method, body, headers: {} };
}
function mockRes() {
  const headers = {};
  const r = {
    statusCode: 200, body: null, headers,
    status(s) { r.statusCode = s; return r; },
    json(b)   { r.body = b; return r; },
    setHeader(k, v) { headers[k] = v; },
    getHeader(k) { return headers[k]; },
  };
  return r;
}

beforeEach(() => {
  _setSqlClient(null);
  process.env.SESSION_SECRET = SECRET;
});

// ── shape helper ──

test('isValidTokenShape: 64 hex chars → true; anything else → false', () => {
  assert.equal(isValidTokenShape('a'.repeat(64)), true);
  assert.equal(isValidTokenShape('A'.repeat(64)), false);  // uppercase not allowed
  assert.equal(isValidTokenShape('a'.repeat(63)), false);
  assert.equal(isValidTokenShape('a'.repeat(65)), false);
  assert.equal(isValidTokenShape('xyz' + 'a'.repeat(61)), false);
  assert.equal(isValidTokenShape(''), false);
  assert.equal(isValidTokenShape(null), false);
  assert.equal(isValidTokenShape(42), false);
});

// ── happy path: existing student ──

test('🛑 handler: valid token + existing student → 200 + student_session cookie', async () => {
  _setSqlClient(makeMockSql([
    // 1) UPDATE…RETURNING: token claim succeeds
    [{ email: 'vivi@example.com', preferred_name: null, pace: null }],
    // 2) SELECT student by email → found
    [{ student_id: 'A001', current_module: 'self', current_day: 3, preferred_name: 'Vivi', pace: 'daily' }],
  ]));
  const res = mockRes();
  await handler(mockReq({ body: { token: VALID_TOKEN } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.studentId, 'A001');
  assert.equal(res.body.module, 'self');
  assert.equal(res.body.currentDay, 3);
  assert.equal(res.body.preferredName, 'Vivi');
  assert.equal(res.body.pace, 'daily');
  // Cookie
  const cookies = res.headers['Set-Cookie'];
  assert.ok(Array.isArray(cookies) && cookies.length === 1);
  assert.match(cookies[0], new RegExp(`^${STUDENT_COOKIE_NAME}=`));
  assert.match(cookies[0], /HttpOnly/);
  assert.match(cookies[0], /Secure/);
  assert.match(cookies[0], /SameSite=Lax/);
  // Payload
  const tokenVal = cookies[0].match(/^student_session=([^;]+)/)[1];
  const payload = verifySession(tokenVal, SECRET);
  assert.equal(payload.role, 'student');
  assert.equal(payload.sid, 'A001');
  assert.ok(payload.exp > payload.iat);
});

// ── happy path: new student (find-or-create allocates A###) ──

test('🛑 handler: valid token + new student → INSERT + 200 + cookie for new sid', async () => {
  _setSqlClient(makeMockSql([
    // 1) UPDATE…RETURNING token claim
    [{ email: 'new@example.com', preferred_name: '小明', pace: 'self-paced' }],
    // 2) SELECT student by email → none
    [],
    // 3) SELECT last A### → A042
    [{ student_id: 'A042' }],
    // 4) INSERT student → no rows
    [],
  ]));
  const res = mockRes();
  await handler(mockReq({ body: { token: VALID_TOKEN } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.studentId, 'A043');
  assert.equal(res.body.module, 'self');
  assert.equal(res.body.currentDay, 1);
  assert.equal(res.body.preferredName, '小明');
  assert.equal(res.body.pace, 'self-paced');
  const cookies = res.headers['Set-Cookie'];
  assert.ok(cookies[0].includes('student_session='));
  const tokenVal = cookies[0].match(/^student_session=([^;]+)/)[1];
  const payload = verifySession(tokenVal, SECRET);
  assert.equal(payload.sid, 'A043');
});

// ── token failure modes ──

test('🛑 handler: token not found (or replayed) → 401', async () => {
  _setSqlClient(makeMockSql([
    [],   // UPDATE…RETURNING returned 0 rows (token already used / expired / bogus)
  ]));
  const res = mockRes();
  await handler(mockReq({ body: { token: VALID_TOKEN } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['Set-Cookie'], undefined);
});

test('🛑 handler: bad-shape token → 401 (never even queries DB)', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ body: { token: 'not-hex' } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(sql.calls.length, 0);
});

test('🛑 handler: missing token → 401', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ body: {} }), res);
  assert.equal(res.statusCode, 401);
});

// ── env fail-closed ──

test('🛑 handler: SESSION_SECRET unset → 401 (no cookie issued)', async () => {
  delete process.env.SESSION_SECRET;
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ body: { token: VALID_TOKEN } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['Set-Cookie'], undefined);
});

// ── SQL shape: atomic UPDATE…RETURNING with the right gates ──

test('🛑 handler: UPDATE atomic-claim shape (used_at IS NULL + expires_at > NOW)', async () => {
  const sql = makeMockSql([
    [{ email: 'a@b.com', preferred_name: null, pace: null }],
    [{ student_id: 'A001', current_module: 'self', current_day: 1, preferred_name: null, pace: null }],
  ]);
  _setSqlClient(sql);
  await handler(mockReq({ body: { token: VALID_TOKEN } }), mockRes());
  const updateQuery = sql.calls[0].text;
  assert.match(updateQuery, /UPDATE magic_link_tokens/i);
  assert.match(updateQuery, /SET used_at = NOW\(\)/i);
  assert.match(updateQuery, /WHERE token_hash = \$1/);
  assert.match(updateQuery, /AND used_at IS NULL/);
  assert.match(updateQuery, /AND expires_at > NOW\(\)/);
  assert.match(updateQuery, /RETURNING email, preferred_name, pace/);
  // tokenHash is sha256 of the raw token
  const { createHash } = await import('node:crypto');
  const expectedHash = createHash('sha256').update(VALID_TOKEN).digest('hex');
  assert.equal(sql.calls[0].values[0], expectedHash);
});

// ── method enforcement ──

test('handler: non-POST → 405', async () => {
  _setSqlClient(makeMockSql([]));
  const res = mockRes();
  await handler(mockReq({ method: 'GET', body: { token: VALID_TOKEN } }), res);
  assert.equal(res.statusCode, 405);
});

// ═════════════════════════════════════════════════════════
// 🛑 5/29 Patrick (Vivi access gate) — verify-link blocks blocked students
//    even when the magic-link itself is valid (token issued before block / race).
// ═════════════════════════════════════════════════════════

test('🛑 verify-link: token valid + student is_blocked=true → 403 beta_access_ended, no cookie', async () => {
  process.env.SESSION_SECRET = SECRET;
  _setSqlClient(makeMockSql([
    [{ email: 'blocked@example.com', preferred_name: null, pace: null }],  // token claim succeeds
    [{ student_id: 'A001', current_module: 'self', current_day: 5,
       preferred_name: 'Blocked Vivi', pace: 'daily', is_blocked: true }],  // student is blocked
  ]));
  const res = mockRes();
  await handler(mockReq({ body: { token: VALID_TOKEN } }), res);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error, 'beta_access_ended');
  assert.match(res.body.message, /封測權限已結束/);
  // No cookie set — blocked students don't get an authenticated session.
  assert.equal(res.headers['Set-Cookie'], undefined,
    'blocked verify-link must NOT set student_session cookie');
});

test('🛑 verify-link: existing student is_blocked=false → 200 + cookie set (normal path unaffected)', async () => {
  process.env.SESSION_SECRET = SECRET;
  _setSqlClient(makeMockSql([
    [{ email: 'ok@example.com', preferred_name: null, pace: null }],
    [{ student_id: 'A002', current_module: 'self', current_day: 3,
       preferred_name: 'Vivi', pace: 'daily', is_blocked: false }],
  ]));
  const res = mockRes();
  await handler(mockReq({ body: { token: VALID_TOKEN } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.studentId, 'A002');
  assert.match(res.headers['Set-Cookie'][0], /^student_session=/);
});
