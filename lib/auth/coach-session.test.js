// lib/auth/coach-session.test.js
// PR-4c-green Auth rebuild stage 1a — HMAC-cookie coach gate tests.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  isAuthorizedCoach,
  assertCoachSession,
  guardCoachOr401,
  _setCoachSessionReader,
  COACH_COOKIE_NAME,
} from './coach-session.js';
import { signSession } from './session.js';

const SECRET = 'test-secret-32-bytes-of-entropy-aaaaaaaa';

beforeEach(() => {
  _setCoachSessionReader(null);
  process.env.SESSION_SECRET = SECRET;
});

// ─── isAuthorizedCoach (pure shape check) ───────────────────────────────

test('🛑 isAuthorizedCoach: payload with role="coach" → true', () => {
  assert.equal(isAuthorizedCoach({ role: 'coach' }), true);
  assert.equal(isAuthorizedCoach({ role: 'coach', iat: 1, exp: 9e9 }), true);
});

test('🛑 isAuthorizedCoach: missing/wrong role → false', () => {
  assert.equal(isAuthorizedCoach({}), false);
  assert.equal(isAuthorizedCoach({ role: 'student' }), false);
  assert.equal(isAuthorizedCoach({ role: 'admin' }), false);
});

test('isAuthorizedCoach: nullish payload → false', () => {
  assert.equal(isAuthorizedCoach(null), false);
  assert.equal(isAuthorizedCoach(undefined), false);
});

// ─── assertCoachSession via injected reader (the test seam) ─────────────

test('🛑 assertCoachSession: reader returns coach payload → true', async () => {
  _setCoachSessionReader(async () => ({ role: 'coach' }));
  assert.equal(await assertCoachSession({}), true);
});

test('🛑 assertCoachSession: reader returns null → false', async () => {
  _setCoachSessionReader(async () => null);
  assert.equal(await assertCoachSession({}), false);
});

test('🛑 assertCoachSession: reader returns student payload → false (role gate)', async () => {
  _setCoachSessionReader(async () => ({ role: 'student', sid: 'A001' }));
  assert.equal(await assertCoachSession({}), false);
});

test('assertCoachSession: reader throws → false (fail-closed)', async () => {
  _setCoachSessionReader(async () => { throw new Error('boom'); });
  assert.equal(await assertCoachSession({}), false);
});

// ─── assertCoachSession real cookie path (no reader injected) ───────────

test('🛑 assertCoachSession: real HMAC path — valid coach cookie → true', async () => {
  const token = signSession({ role: 'coach', exp: 9e9 }, SECRET);
  const req = { headers: { cookie: `${COACH_COOKIE_NAME}=${token}` } };
  assert.equal(await assertCoachSession(req), true);
});

test('🛑 assertCoachSession: real HMAC path — tampered cookie → false', async () => {
  const token = signSession({ role: 'coach', exp: 9e9 }, SECRET);
  // flip last char of mac portion
  const tampered = token.slice(0, -1) + (token.slice(-1) === 'A' ? 'B' : 'A');
  const req = { headers: { cookie: `${COACH_COOKIE_NAME}=${tampered}` } };
  assert.equal(await assertCoachSession(req), false);
});

test('🛑 assertCoachSession: real HMAC path — no cookie → false', async () => {
  assert.equal(await assertCoachSession({ headers: {} }), false);
  assert.equal(await assertCoachSession({ headers: { cookie: '' } }), false);
});

test('🛑 assertCoachSession: real HMAC path — wrong role payload → false', async () => {
  // Even with a legitimately-signed cookie, only role='coach' passes
  const token = signSession({ role: 'student', sid: 'A001' }, SECRET);
  const req = { headers: { cookie: `${COACH_COOKIE_NAME}=${token}` } };
  assert.equal(await assertCoachSession(req), false);
});

test('🛑 assertCoachSession: SESSION_SECRET unset → false (fail-closed)', async () => {
  process.env.SESSION_SECRET = '';
  const token = signSession({ role: 'coach' }, SECRET);
  const req = { headers: { cookie: `${COACH_COOKIE_NAME}=${token}` } };
  assert.equal(await assertCoachSession(req), false);
});

// ─── guardCoachOr401 (the one-liner endpoints use) ──────────────────────

function mockRes() {
  const r = {
    statusCode: 200, body: null,
    status(s) { r.statusCode = s; return r; },
    json(b)   { r.body = b; return r; },
  };
  return r;
}

test('🛑 guardCoachOr401: authorized → true, res untouched', async () => {
  _setCoachSessionReader(async () => ({ role: 'coach' }));
  const res = mockRes();
  assert.equal(await guardCoachOr401({}, res), true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, null);
});

test('🛑 guardCoachOr401: unauthorized → false + sends 401', async () => {
  _setCoachSessionReader(async () => null);
  const res = mockRes();
  assert.equal(await guardCoachOr401({}, res), false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Unauthorized');
});
