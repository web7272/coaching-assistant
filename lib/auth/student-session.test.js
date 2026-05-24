// lib/auth/student-session.test.js
// PR-4c-green Auth rebuild stage 1d — student session helper tests.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  studentIdFromPayload,
  getStudentIdFromSession,
  guardStudentOr401,
  _setStudentSessionReader,
  STUDENT_COOKIE_NAME,
} from './student-session.js';
import { signSession } from './session.js';

const SECRET = 'test-secret-32-bytes-of-entropy-aaaaaaaa';

beforeEach(() => {
  _setStudentSessionReader(null);
  process.env.SESSION_SECRET = SECRET;
});

// ── studentIdFromPayload (pure) ──

test('studentIdFromPayload: valid {role:student, sid} → sid', () => {
  assert.equal(studentIdFromPayload({ role: 'student', sid: 'A001' }), 'A001');
  assert.equal(studentIdFromPayload({ role: 'student', sid: 'A042', iat: 1, exp: 9e9 }), 'A042');
});

test('🛑 studentIdFromPayload: role !== student → null (defense)', () => {
  assert.equal(studentIdFromPayload({ role: 'coach', sid: 'A001' }), null,
    'a coach session must NOT be readable as a student session');
  assert.equal(studentIdFromPayload({ role: 'admin', sid: 'A001' }), null);
  assert.equal(studentIdFromPayload({ sid: 'A001' }), null, 'missing role → null');
});

test('studentIdFromPayload: missing/empty sid → null', () => {
  assert.equal(studentIdFromPayload({ role: 'student' }), null);
  assert.equal(studentIdFromPayload({ role: 'student', sid: '' }), null);
  assert.equal(studentIdFromPayload({ role: 'student', sid: null }), null);
});

test('studentIdFromPayload: nullish → null', () => {
  assert.equal(studentIdFromPayload(null), null);
  assert.equal(studentIdFromPayload(undefined), null);
  assert.equal(studentIdFromPayload({}), null);
});

// ── getStudentIdFromSession via injected reader ──

test('🛑 getStudentIdFromSession: reader returns valid payload → sid', async () => {
  _setStudentSessionReader(async () => ({ role: 'student', sid: 'A001' }));
  assert.equal(await getStudentIdFromSession({}), 'A001');
});

test('🛑 getStudentIdFromSession: reader returns null → null', async () => {
  _setStudentSessionReader(async () => null);
  assert.equal(await getStudentIdFromSession({}), null);
});

test('🛑 getStudentIdFromSession: reader returns coach payload → null (cross-role defense)', async () => {
  _setStudentSessionReader(async () => ({ role: 'coach' }));
  assert.equal(await getStudentIdFromSession({}), null);
});

test('getStudentIdFromSession: reader throws → null (fail-closed)', async () => {
  _setStudentSessionReader(async () => { throw new Error('boom'); });
  assert.equal(await getStudentIdFromSession({}), null);
});

// ── getStudentIdFromSession real HMAC path ──

test('🛑 getStudentIdFromSession: real HMAC path — valid student cookie → sid', async () => {
  const token = signSession({ role: 'student', sid: 'A042', exp: 9e9 }, SECRET);
  const req = { headers: { cookie: `${STUDENT_COOKIE_NAME}=${token}` } };
  assert.equal(await getStudentIdFromSession(req), 'A042');
});

test('🛑 getStudentIdFromSession: real HMAC path — tampered cookie → null', async () => {
  const token = signSession({ role: 'student', sid: 'A001' }, SECRET);
  const tampered = token.slice(0, -1) + (token.slice(-1) === 'A' ? 'B' : 'A');
  const req = { headers: { cookie: `${STUDENT_COOKIE_NAME}=${tampered}` } };
  assert.equal(await getStudentIdFromSession(req), null);
});

test('🛑 getStudentIdFromSession: real HMAC path — coach cookie won\'t pass as student', async () => {
  // CRITICAL: even with a perfectly-signed coach session, this helper must return null.
  // Otherwise a coach could read student data via student endpoints.
  const coachToken = signSession({ role: 'coach', exp: 9e9 }, SECRET);
  const req = { headers: { cookie: `${STUDENT_COOKIE_NAME}=${coachToken}` } };
  assert.equal(await getStudentIdFromSession(req), null);
});

test('🛑 getStudentIdFromSession: no cookie → null', async () => {
  assert.equal(await getStudentIdFromSession({ headers: {} }), null);
  assert.equal(await getStudentIdFromSession({ headers: { cookie: '' } }), null);
});

test('🛑 getStudentIdFromSession: SESSION_SECRET unset → null (fail-closed)', async () => {
  process.env.SESSION_SECRET = '';
  const token = signSession({ role: 'student', sid: 'A001' }, SECRET);
  const req = { headers: { cookie: `${STUDENT_COOKIE_NAME}=${token}` } };
  assert.equal(await getStudentIdFromSession(req), null);
});

// ── guardStudentOr401 ──

function mockRes() {
  const r = {
    statusCode: 200, body: null,
    status(s) { r.statusCode = s; return r; },
    json(b)   { r.body = b; return r; },
  };
  return r;
}

test('🛑 guardStudentOr401: authorized → returns sid, res untouched', async () => {
  _setStudentSessionReader(async () => ({ role: 'student', sid: 'A001' }));
  const res = mockRes();
  assert.equal(await guardStudentOr401({}, res), 'A001');
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, null);
});

test('🛑 guardStudentOr401: unauthorized → returns null + sends 401', async () => {
  _setStudentSessionReader(async () => null);
  const res = mockRes();
  assert.equal(await guardStudentOr401({}, res), null);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'Unauthorized');
});
