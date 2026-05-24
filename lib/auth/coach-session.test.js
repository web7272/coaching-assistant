// lib/auth/coach-session.test.js
// PR-4c-green Patrick 5/24 — gate shared across audience=coach + /api/admin/*.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  isAuthorizedCoach,
  assertCoachSession,
  guardCoachOr401,
  _setGetTokenFn,
} from './coach-session.js';

beforeEach(() => {
  _setGetTokenFn(null);
  process.env.COACH_EMAIL = 'patrick@example.com';
  process.env.NEXTAUTH_SECRET = 'test-secret';
});

// ── isAuthorizedCoach (pure) ──

test('isAuthorizedCoach: matching email (case-insensitive) → true', () => {
  assert.equal(isAuthorizedCoach({ email: 'patrick@example.com' }, 'patrick@example.com'), true);
  assert.equal(isAuthorizedCoach({ email: 'Patrick@Example.com' }, 'patrick@example.com'), true);
});

test('isAuthorizedCoach: mismatched email → false', () => {
  assert.equal(isAuthorizedCoach({ email: 'student@example.com' }, 'patrick@example.com'), false);
});

test('🛑 isAuthorizedCoach: missing COACH_EMAIL env → false (fail-closed)', () => {
  // Never authorize when expectedEmail is empty — otherwise any signed Google
  // account that managed to get a session would slip through.
  assert.equal(isAuthorizedCoach({ email: 'patrick@example.com' }, ''), false);
  assert.equal(isAuthorizedCoach({ email: 'patrick@example.com' }, undefined), false);
});

test('isAuthorizedCoach: nullish / malformed token → false', () => {
  assert.equal(isAuthorizedCoach(null, 'patrick@example.com'), false);
  assert.equal(isAuthorizedCoach(undefined, 'patrick@example.com'), false);
  assert.equal(isAuthorizedCoach({}, 'patrick@example.com'), false);
  assert.equal(isAuthorizedCoach({ email: '' }, 'patrick@example.com'), false);
  assert.equal(isAuthorizedCoach({ email: null }, 'patrick@example.com'), false);
});

// ── assertCoachSession (auth flow with injected getToken) ──

test('🛑 assertCoachSession: valid token + matching email → true', async () => {
  _setGetTokenFn(async () => ({ email: 'patrick@example.com' }));
  assert.equal(await assertCoachSession({}), true);
});

test('🛑 assertCoachSession: null token → false', async () => {
  _setGetTokenFn(async () => null);
  assert.equal(await assertCoachSession({}), false);
});

test('🛑 assertCoachSession: wrong email → false', async () => {
  _setGetTokenFn(async () => ({ email: 'random@example.com' }));
  assert.equal(await assertCoachSession({}), false);
});

test('assertCoachSession: getToken throws → false (fail-closed)', async () => {
  _setGetTokenFn(async () => { throw new Error('boom'); });
  assert.equal(await assertCoachSession({}), false);
});

test('assertCoachSession: COACH_EMAIL env unset → false', async () => {
  process.env.COACH_EMAIL = '';
  _setGetTokenFn(async () => ({ email: 'patrick@example.com' }));
  assert.equal(await assertCoachSession({}), false);
});

// ── guardCoachOr401 (sends 401 on failure) ──

function mockRes() {
  const r = {
    statusCode: 200, body: null,
    status(s) { r.statusCode = s; return r; },
    json(b)   { r.body = b; return r; },
  };
  return r;
}

test('🛑 guardCoachOr401: authorized → returns true, does NOT touch res', async () => {
  _setGetTokenFn(async () => ({ email: 'patrick@example.com' }));
  const res = mockRes();
  assert.equal(await guardCoachOr401({}, res), true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, null);
});

test('🛑 guardCoachOr401: unauthorized → returns false + sends 401', async () => {
  _setGetTokenFn(async () => null);
  const res = mockRes();
  assert.equal(await guardCoachOr401({}, res), false);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Unauthorized');
});
