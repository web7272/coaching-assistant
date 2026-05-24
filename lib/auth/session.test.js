// lib/auth/session.test.js
// PR-4c-green Auth rebuild stage 1a — HMAC session primitives.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';

import {
  signSession,
  verifySession,
  setSessionCookie,
  clearSessionCookie,
  parseCookies,
  nowSec,
  plusDays,
  plusMinutes,
} from './session.js';

const SECRET = 'test-secret-32-bytes-of-entropy-aaaaaaaa';

// ─── signSession / verifySession roundtrip ──────────────────────────────

test('🛑 signSession → verifySession roundtrip recovers payload', () => {
  const payload = { role: 'coach', iat: 1000, exp: 9999999999 };
  const tok = signSession(payload, SECRET);
  const got = verifySession(tok, SECRET);
  assert.deepEqual(got, payload);
});

test('signSession output is "body.mac" shape (two base64url segments)', () => {
  const tok = signSession({ role: 'coach' }, SECRET);
  const parts = tok.split('.');
  assert.equal(parts.length, 2);
  // base64url alphabet: A-Z a-z 0-9 - _
  for (const p of parts) assert.match(p, /^[A-Za-z0-9_-]+$/);
});

test('signSession: missing secret → throws', () => {
  assert.throws(() => signSession({ role: 'coach' }, ''));
  assert.throws(() => signSession({ role: 'coach' }, undefined));
});

test('signSession: non-object payload → throws', () => {
  assert.throws(() => signSession(null, SECRET));
  assert.throws(() => signSession('string', SECRET));
});

// ─── verifySession failure modes (the security-critical paths) ──────────

test('🛑 verifySession: tampered MAC → null', () => {
  const tok = signSession({ role: 'coach', sid: 'A001' }, SECRET);
  const [body, mac] = tok.split('.');
  // flip the last char of the mac
  const flipped = mac.slice(0, -1) + (mac.slice(-1) === 'A' ? 'B' : 'A');
  assert.equal(verifySession(`${body}.${flipped}`, SECRET), null);
});

test('🛑 verifySession: tampered payload (re-encoded body, original mac) → null', () => {
  const tok = signSession({ role: 'coach', sid: 'A001' }, SECRET);
  const [, mac] = tok.split('.');
  // forge a different payload, keep original mac → MAC mismatch
  const forgedBody = Buffer.from(JSON.stringify({ role: 'coach', sid: 'A999' }), 'utf8')
    .toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  assert.equal(verifySession(`${forgedBody}.${mac}`, SECRET), null);
});

test('🛑 verifySession: signed with different secret → null', () => {
  const tok = signSession({ role: 'coach' }, SECRET);
  assert.equal(verifySession(tok, 'different-secret-of-equal-aaaa-length'), null);
});

test('🛑 verifySession: expired token (exp < now) → null', () => {
  const tok = signSession({ role: 'coach', exp: 100 }, SECRET);
  assert.equal(verifySession(tok, SECRET, { now: 200 }), null);
});

test('verifySession: token with exp >= now → payload', () => {
  const tok = signSession({ role: 'coach', exp: 200 }, SECRET);
  assert.deepEqual(verifySession(tok, SECRET, { now: 200 }), { role: 'coach', exp: 200 });
  assert.deepEqual(verifySession(tok, SECRET, { now: 199 }), { role: 'coach', exp: 200 });
});

test('verifySession: no exp field → never expires (verified payload returned)', () => {
  const tok = signSession({ role: 'coach' }, SECRET);
  assert.deepEqual(verifySession(tok, SECRET, { now: 9e9 }), { role: 'coach' });
});

test('verifySession: malformed input → null (no crash)', () => {
  assert.equal(verifySession('', SECRET), null);
  assert.equal(verifySession(null, SECRET), null);
  assert.equal(verifySession(undefined, SECRET), null);
  assert.equal(verifySession(42, SECRET), null);
  assert.equal(verifySession('no-dot-in-this-string', SECRET), null);
  assert.equal(verifySession('.', SECRET), null);
  assert.equal(verifySession('body.', SECRET), null);
  assert.equal(verifySession('.mac', SECRET), null);
});

test('verifySession: missing secret → null', () => {
  const tok = signSession({ role: 'coach' }, SECRET);
  assert.equal(verifySession(tok, ''), null);
  assert.equal(verifySession(tok, undefined), null);
});

test('verifySession: body decodes to non-object JSON → null', () => {
  // Sign a body whose JSON is a string (not an object)
  const body = Buffer.from(JSON.stringify('not-an-object'), 'utf8')
    .toString('base64').replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  // We need a matching MAC for the forged body, otherwise we'd 401 on MAC mismatch
  // before reaching the shape check. So compute MAC manually with the same secret:
  const mac = createHmac('sha256', SECRET).update(body).digest('base64')
    .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  assert.equal(verifySession(`${body}.${mac}`, SECRET), null);
});

// ─── cookie helpers ─────────────────────────────────────────────────────

function mockRes() {
  const headers = {};
  return {
    headers,
    setHeader(name, value) { headers[name] = value; },
    getHeader(name) { return headers[name]; },
  };
}

test('🛑 setSessionCookie: HttpOnly + Secure + SameSite=Lax + Path=/ + Max-Age', () => {
  const res = mockRes();
  setSessionCookie(res, 'coach_session', 'TOKEN', { maxAgeSeconds: 600 });
  const cookies = res.headers['Set-Cookie'];
  assert.ok(Array.isArray(cookies));
  assert.equal(cookies.length, 1);
  const c = cookies[0];
  assert.match(c, /^coach_session=TOKEN/);
  assert.match(c, /HttpOnly/);
  assert.match(c, /Secure/);
  assert.match(c, /SameSite=Lax/);
  assert.match(c, /Path=\//);
  assert.match(c, /Max-Age=600/);
});

test('setSessionCookie: default Max-Age ≈ 30 days', () => {
  const res = mockRes();
  setSessionCookie(res, 'coach_session', 'TOKEN');
  const c = res.headers['Set-Cookie'][0];
  assert.match(c, /Max-Age=2592000/);  // 30 * 86400
});

test('setSessionCookie: appends to existing Set-Cookie array (multi-cookie support)', () => {
  const res = mockRes();
  setSessionCookie(res, 'coach_session', 'A');
  setSessionCookie(res, 'student_session', 'B');
  const cookies = res.headers['Set-Cookie'];
  assert.equal(cookies.length, 2);
  assert.match(cookies[0], /^coach_session=A/);
  assert.match(cookies[1], /^student_session=B/);
});

test('🛑 clearSessionCookie: Max-Age=0 (expires immediately)', () => {
  const res = mockRes();
  clearSessionCookie(res, 'coach_session');
  const c = res.headers['Set-Cookie'][0];
  assert.match(c, /^coach_session=;/);
  assert.match(c, /Max-Age=0/);
  assert.match(c, /HttpOnly/);
});

test('setSessionCookie: missing res.setHeader → no crash (defensive)', () => {
  // Some callers may pass a non-standard res shape
  assert.doesNotThrow(() => setSessionCookie({}, 'x', 'y'));
  assert.doesNotThrow(() => setSessionCookie(null, 'x', 'y'));
});

// ─── parseCookies ───────────────────────────────────────────────────────

test('parseCookies: single cookie', () => {
  assert.deepEqual(
    parseCookies({ headers: { cookie: 'coach_session=ABC123' } }),
    { coach_session: 'ABC123' },
  );
});

test('parseCookies: multiple cookies', () => {
  assert.deepEqual(
    parseCookies({ headers: { cookie: 'a=1; b=2; coach_session=XYZ' } }),
    { a: '1', b: '2', coach_session: 'XYZ' },
  );
});

test('parseCookies: missing header → {}', () => {
  assert.deepEqual(parseCookies({ headers: {} }), {});
  assert.deepEqual(parseCookies({}), {});
  assert.deepEqual(parseCookies(null), {});
});

test('parseCookies: tolerates value containing =', () => {
  // base64url doesn't contain =, but session token format is "body.mac" so this is defensive
  assert.deepEqual(
    parseCookies({ headers: { cookie: 'x=a=b=c' } }),
    { x: 'a=b=c' },
  );
});

// ─── time helpers ───────────────────────────────────────────────────────

test('nowSec returns current Unix seconds', () => {
  const t = nowSec();
  assert.ok(Number.isInteger(t));
  assert.ok(t > 1700000000);  // sanity: after 2023
});

test('plusDays / plusMinutes add seconds to now', () => {
  const base = nowSec();
  const d = plusDays(1);
  const m = plusMinutes(20);
  assert.ok(d - base >= 86400 - 2 && d - base <= 86400 + 2);
  assert.ok(m - base >= 1200 - 2 && m - base <= 1200 + 2);
});
