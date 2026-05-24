// lib/auth/session.js
// PR-4c-green Auth rebuild stage 1a — HMAC-signed session cookies (replaces
// the broken NextAuth path: `next-auth` was never in package.json, so the
// catch-all /api/auth/[...nextauth].js handler 404'd in production and
// indirectly 401'd every coach endpoint that depended on `getToken`).
//
// Design:
//   - Cookie value = base64url(payload-json).base64url(hmac-sha256(payload))
//   - HMAC verified with timingSafeEqual to prevent leaking secret via timing
//   - Payload includes `exp` (Unix seconds); verifySession returns null if expired
//   - Two cookies live side-by-side:
//       coach_session   — payload {role: 'coach', iat, exp}     (set in 1b by /api/coach-auth)
//       student_session — payload {sid, iat, exp}               (set in 1c by /api/auth/verify-link)
//   - HttpOnly + Secure + SameSite=Lax keeps the cookie out of JS / CSRF reach
//
// Env: SESSION_SECRET (32+ random bytes; Vivi sets in Vercel, see infra checklist)

import { createHmac, timingSafeEqual } from 'node:crypto';

const DEFAULT_TTL_DAYS = 30;

// ─── base64url helpers (RFC 4648 §5, padding stripped) ───────────────────

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function fromB64url(s) {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

// ─── sign / verify ───────────────────────────────────────────────────────

/**
 * Sign a session payload. Returns `"<b64url-body>.<b64url-mac>"`.
 *
 * @param {object} payload  JSON-serialisable; recommended keys: role/sid, iat, exp
 * @param {string} secret   process.env.SESSION_SECRET
 * @returns {string}
 */
export function signSession(payload, secret) {
  if (!secret || typeof secret !== 'string') {
    throw new Error('signSession: SESSION_SECRET required');
  }
  if (!payload || typeof payload !== 'object') {
    throw new TypeError('signSession: payload must be a plain object');
  }
  const body = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const mac  = b64url(createHmac('sha256', secret).update(body).digest());
  return `${body}.${mac}`;
}

/**
 * Verify a session token. Returns the parsed payload or null on any failure
 * (bad shape / MAC mismatch / expired / unparseable JSON).
 *
 * @param {string|undefined|null} token
 * @param {string|undefined} secret
 * @param {{now?: number}} [opts] - injectable clock for tests (Unix seconds)
 * @returns {object|null}
 */
export function verifySession(token, secret, { now = Math.floor(Date.now() / 1000) } = {}) {
  if (typeof token !== 'string' || !token) return null;
  if (typeof secret !== 'string' || !secret) return null;
  const dot = token.lastIndexOf('.');
  if (dot < 0) return null;
  const body = token.slice(0, dot);
  const mac  = token.slice(dot + 1);
  if (!body || !mac) return null;

  const expected = b64url(createHmac('sha256', secret).update(body).digest());
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(mac, 'utf8');
  if (a.length !== b.length) return null;       // timingSafeEqual requires equal length; pre-check is fine,
                                                // the body→expected map is deterministic in length anyway
  if (!timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(fromB64url(body).toString('utf8'));
  } catch { return null; }
  if (!payload || typeof payload !== 'object') return null;

  if (typeof payload.exp === 'number' && payload.exp < now) return null;
  return payload;
}

// ─── cookie helpers ──────────────────────────────────────────────────────

/**
 * Set a signed-session cookie. HttpOnly + Secure + SameSite=Lax + Path=/.
 *
 * @param {object} res                 Vercel/Node http.ServerResponse-shaped
 * @param {string} name                e.g. 'coach_session' or 'student_session'
 * @param {string} value               output of signSession()
 * @param {{maxAgeSeconds?: number}} [opts]
 */
export function setSessionCookie(res, name, value, { maxAgeSeconds = DEFAULT_TTL_DAYS * 86400 } = {}) {
  const cookie = [
    `${name}=${value}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
  appendSetCookie(res, cookie);
}

/** Expire the cookie (browser will drop it). */
export function clearSessionCookie(res, name) {
  appendSetCookie(res, `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
}

function appendSetCookie(res, cookie) {
  if (!res || typeof res.setHeader !== 'function') return;   // tolerate test-shaped res
  const prev = typeof res.getHeader === 'function' ? res.getHeader('Set-Cookie') : null;
  const arr = prev == null ? [] : (Array.isArray(prev) ? prev.slice() : [prev]);
  arr.push(cookie);
  res.setHeader('Set-Cookie', arr);
}

/**
 * Read all cookies from a request's `cookie` header.
 *
 * @param {object} req
 * @returns {Record<string, string>}
 */
export function parseCookies(req) {
  const header = req?.headers?.cookie;
  if (typeof header !== 'string' || header.length === 0) return {};
  const out = {};
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1);
    if (k) out[k] = v;
  }
  return out;
}

// ─── clock helpers ───────────────────────────────────────────────────────

export function nowSec() { return Math.floor(Date.now() / 1000); }
export function plusDays(days) { return nowSec() + days * 86400; }
export function plusMinutes(minutes) { return nowSec() + minutes * 60; }
