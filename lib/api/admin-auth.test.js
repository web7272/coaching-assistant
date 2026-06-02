// lib/api/admin-auth.test.js
// Patrick 5/30 — dual-auth helper (cookie OR Bearer) boundary lock.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { checkAdminAuth, guardAdminOr401 } from './admin-auth.js';
import { _setCoachSessionReader } from '../auth/coach-session.js';

const COACH_OK   = async () => ({ role: 'coach' });
const COACH_FAIL = async () => null;
const COACH_THROW = async () => { throw new Error('cookie reader boom'); };

function mockReq({ headers = {} } = {}) {
  return { headers };
}
function mockRes() {
  const r = { statusCode: 200, body: null,
    status(s) { r.statusCode = s; return r; },
    json(b)   { r.body = b; return r; } };
  return r;
}

const FAKE_TOKEN = 'a'.repeat(64);   // realistic shape (64 hex)

beforeEach(() => {
  _setCoachSessionReader(null);
  delete process.env.ADMIN_API_TOKEN;
});

// ─── checkAdminAuth ────────────────────────────────────────

test('🛑 cookie auth ok → {ok:true, via:"cookie"} (early return, no bearer check)', async () => {
  _setCoachSessionReader(COACH_OK);
  process.env.ADMIN_API_TOKEN = FAKE_TOKEN;
  // Pass NO Authorization header — cookie path alone must succeed.
  const r = await checkAdminAuth(mockReq());
  assert.deepEqual(r, { ok: true, via: 'cookie' });
});

test('🛑 valid Bearer + no cookie → {ok:true, via:"bearer"}', async () => {
  _setCoachSessionReader(COACH_FAIL);
  process.env.ADMIN_API_TOKEN = FAKE_TOKEN;
  const r = await checkAdminAuth(mockReq({
    headers: { authorization: `Bearer ${FAKE_TOKEN}` },
  }));
  assert.deepEqual(r, { ok: true, via: 'bearer' });
});

test('🛑 both cookie + Bearer valid → cookie wins (via:"cookie") — early return semantics', async () => {
  _setCoachSessionReader(COACH_OK);
  process.env.ADMIN_API_TOKEN = FAKE_TOKEN;
  const r = await checkAdminAuth(mockReq({
    headers: { authorization: `Bearer ${FAKE_TOKEN}` },
  }));
  assert.equal(r.ok, true);
  assert.equal(r.via, 'cookie', 'cookie must win when both present (early return)');
});

test('🛑 no auth at all → {ok:false}', async () => {
  _setCoachSessionReader(COACH_FAIL);
  process.env.ADMIN_API_TOKEN = FAKE_TOKEN;
  const r = await checkAdminAuth(mockReq());
  assert.equal(r.ok, false);
});

test('🛑 wrong Bearer token → {ok:false}', async () => {
  _setCoachSessionReader(COACH_FAIL);
  process.env.ADMIN_API_TOKEN = FAKE_TOKEN;
  const r = await checkAdminAuth(mockReq({
    headers: { authorization: `Bearer ${'b'.repeat(64)}` },
  }));
  assert.equal(r.ok, false);
});

test('🛑 Bearer wrong length (timing-safe rejects pre-compare) → false', async () => {
  _setCoachSessionReader(COACH_FAIL);
  process.env.ADMIN_API_TOKEN = FAKE_TOKEN;
  const r = await checkAdminAuth(mockReq({
    headers: { authorization: 'Bearer short' },
  }));
  assert.equal(r.ok, false);
});

test('🛑 ADMIN_API_TOKEN unset → Bearer never matches (defensive against missing env)', async () => {
  _setCoachSessionReader(COACH_FAIL);
  // Don't set env. Sending any Bearer must NOT auth.
  const r = await checkAdminAuth(mockReq({
    headers: { authorization: `Bearer ${FAKE_TOKEN}` },
  }));
  assert.equal(r.ok, false,
    '不能因為 attacker 沒送 token 且 env 沒設就誤通過');
});

test('🛑 ADMIN_API_TOKEN = empty string → Bearer never matches', async () => {
  _setCoachSessionReader(COACH_FAIL);
  process.env.ADMIN_API_TOKEN = '';
  const r = await checkAdminAuth(mockReq({
    headers: { authorization: 'Bearer  ' },   // also empty after trim
  }));
  assert.equal(r.ok, false);
});

test('non-Bearer Authorization header (Basic / random) → false', async () => {
  _setCoachSessionReader(COACH_FAIL);
  process.env.ADMIN_API_TOKEN = FAKE_TOKEN;
  for (const v of ['Basic abc', 'Token foo', FAKE_TOKEN, '']) {
    const r = await checkAdminAuth(mockReq({ headers: { authorization: v } }));
    assert.equal(r.ok, false, `header="${v}" must NOT auth as Bearer`);
  }
});

test('cookie reader THROWS → falls through to Bearer (helper does not propagate)', async () => {
  _setCoachSessionReader(COACH_THROW);
  process.env.ADMIN_API_TOKEN = FAKE_TOKEN;
  const r = await checkAdminAuth(mockReq({
    headers: { authorization: `Bearer ${FAKE_TOKEN}` },
  }));
  assert.deepEqual(r, { ok: true, via: 'bearer' },
    'cookie reader 失敗 (throw) 不該擋住 Bearer fallback');
});

test('case sensitivity: "bearer" lowercase prefix → still match (regex is /^Bearer\\s+/, case-sensitive)', async () => {
  // Bearer scheme name is case-INSENSITIVE per RFC 7235; current regex is strict.
  // Document the current behavior so future change is intentional, not stealth.
  _setCoachSessionReader(COACH_FAIL);
  process.env.ADMIN_API_TOKEN = FAKE_TOKEN;
  const r = await checkAdminAuth(mockReq({
    headers: { authorization: `bearer ${FAKE_TOKEN}` },
  }));
  assert.equal(r.ok, false,
    'lowercase "bearer" 目前不通 (strict case-sensitive). 若未來要放寬、改正則明示.');
});

// ─── guardAdminOr401 wrapper ───────────────────────────────

test('guardAdminOr401: cookie ok → returns {ok:true, via:"cookie"} + no 401 sent', async () => {
  _setCoachSessionReader(COACH_OK);
  const res = mockRes();
  const r = await guardAdminOr401(mockReq(), res);
  assert.deepEqual(r, { ok: true, via: 'cookie' });
  assert.equal(res.statusCode, 200, 'success path must not touch res');
});

test('🛑 guardAdminOr401: no auth → sends 401 + returns false', async () => {
  _setCoachSessionReader(COACH_FAIL);
  const res = mockRes();
  const r = await guardAdminOr401(mockReq(), res);
  assert.equal(r, false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Unauthorized');
});

test('guardAdminOr401: bearer ok → returns {ok:true, via:"bearer"} + no 401 sent', async () => {
  _setCoachSessionReader(COACH_FAIL);
  process.env.ADMIN_API_TOKEN = FAKE_TOKEN;
  const res = mockRes();
  const r = await guardAdminOr401(mockReq({
    headers: { authorization: `Bearer ${FAKE_TOKEN}` },
  }), res);
  assert.deepEqual(r, { ok: true, via: 'bearer' });
  assert.equal(res.statusCode, 200);
});
