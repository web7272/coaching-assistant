// api/coach-auth.test.js
// PR-4c-green Auth rebuild stage 1b — coach passcode + cookie issue.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, { safeEqual, COACH_COOKIE_NAME } from './coach-auth.js';
import { verifySession } from '../lib/auth/session.js';

const SECRET = 'test-secret-32-bytes-of-entropy-aaaaaaaa';
const PASSCODE = 'correct-horse-battery-staple';

// ── mock req/res ──

function mockReq({ method = 'POST', body = {}, query = {} } = {}) {
  return { method, body, query, headers: {} };
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
  process.env.SESSION_SECRET = SECRET;
  process.env.COACH_PASSCODE = PASSCODE;
});

// ── safeEqual (pure helper) ──

test('safeEqual: equal strings → true', () => {
  assert.equal(safeEqual('abc', 'abc'), true);
});

test('safeEqual: different content same length → false', () => {
  assert.equal(safeEqual('abc', 'xyz'), false);
});

test('🛑 safeEqual: different lengths → false (no throw)', () => {
  assert.equal(safeEqual('a', 'abc'), false);
  assert.equal(safeEqual('abc', 'a'), false);
});

test('🛑 safeEqual: empty inputs → false (fail-closed)', () => {
  assert.equal(safeEqual('', ''), false);
  assert.equal(safeEqual('', null), false);
  assert.equal(safeEqual(null, undefined), false);
});

// ── handler: correct passcode ──

test('🛑 handler: correct passcode → 200 + signed coach_session cookie', async () => {
  const res = mockRes();
  await handler(mockReq({ body: { passcode: PASSCODE } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  const cookies = res.headers['Set-Cookie'];
  assert.ok(Array.isArray(cookies) && cookies.length === 1);
  const c = cookies[0];
  assert.match(c, new RegExp(`^${COACH_COOKIE_NAME}=`));
  assert.match(c, /HttpOnly/);
  assert.match(c, /Secure/);
  assert.match(c, /SameSite=Lax/);
  // Cookie value verifies under the same SESSION_SECRET → coach payload
  const tokenMatch = c.match(/^coach_session=([^;]+)/);
  const payload = verifySession(tokenMatch[1], SECRET);
  assert.equal(payload.role, 'coach');
  assert.ok(typeof payload.iat === 'number');
  assert.ok(typeof payload.exp === 'number');
  assert.ok(payload.exp > payload.iat, 'exp must be after iat');
});

// ── handler: wrong / missing passcode → 401 ──

test('🛑 handler: wrong passcode → 401, no cookie', async () => {
  const res = mockRes();
  await handler(mockReq({ body: { passcode: 'wrong-passcode-of-equal-length-aa' } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['Set-Cookie'], undefined);
});

test('🛑 handler: same-length wrong passcode → 401 (constant-time defense)', async () => {
  const same = PASSCODE.replace(/.$/, '*');  // same length, last char different
  const res = mockRes();
  await handler(mockReq({ body: { passcode: same } }), res);
  assert.equal(res.statusCode, 401);
});

test('handler: empty passcode → 401', async () => {
  const res = mockRes();
  await handler(mockReq({ body: { passcode: '' } }), res);
  assert.equal(res.statusCode, 401);
});

test('handler: missing body → 401', async () => {
  const res = mockRes();
  await handler(mockReq({ body: undefined }), res);
  assert.equal(res.statusCode, 401);
});

// ── env fail-closed ──

test('🛑 handler: COACH_PASSCODE env unset → 401 (fail-closed) even with body', async () => {
  delete process.env.COACH_PASSCODE;
  const res = mockRes();
  await handler(mockReq({ body: { passcode: 'anything' } }), res);
  assert.equal(res.statusCode, 401);
});

test('🛑 handler: SESSION_SECRET env unset → 401 (fail-closed)', async () => {
  delete process.env.SESSION_SECRET;
  const res = mockRes();
  await handler(mockReq({ body: { passcode: PASSCODE } }), res);
  assert.equal(res.statusCode, 401);
});

// ── logout ──

test('🛑 handler: action=logout clears cookie + 200', async () => {
  const res = mockRes();
  await handler(mockReq({ query: { action: 'logout' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  const cookies = res.headers['Set-Cookie'];
  assert.ok(Array.isArray(cookies) && cookies.length === 1);
  assert.match(cookies[0], new RegExp(`^${COACH_COOKIE_NAME}=;`));
  assert.match(cookies[0], /Max-Age=0/);
});

test('handler: action=logout works without any passcode in body', async () => {
  // Logout shouldn't require knowing the passcode (you might be logging out
  // because you forgot it / want to switch to a different account).
  const res = mockRes();
  await handler(mockReq({ query: { action: 'logout' }, body: undefined }), res);
  assert.equal(res.statusCode, 200);
});

// ── method enforcement ──

test('handler: non-POST → 405', async () => {
  const res = mockRes();
  await handler(mockReq({ method: 'GET', body: { passcode: PASSCODE } }), res);
  assert.equal(res.statusCode, 405);
});
