// api/coach-auth.js
// PR-4c-green Auth rebuild stage 1b — coach passcode endpoint.
//
// POST /api/coach-auth { passcode }
//   - timingSafeEqual against process.env.COACH_PASSCODE
//   - match → set coach_session cookie (HMAC-signed, 30d) → { ok: true }
//   - mismatch / missing env / missing body → 401
//
// POST /api/coach-auth?action=logout
//   - clear coach_session cookie → { ok: true }
//
// Vivi chose the「shared passcode」 model (option B) for封測. No user accounts
// on the coach side; the gate is simply「do you know the passcode」. Successful
// auth issues a role='coach' session cookie that guardCoachOr401 verifies.

import { timingSafeEqual } from 'node:crypto';
import {
  signSession, setSessionCookie, clearSessionCookie, plusDays, nowSec,
} from '../lib/auth/session.js';

export const maxDuration = 5;

export const COACH_COOKIE_NAME = 'coach_session';

/**
 * Constant-time string compare. Pre-checks length (same length → timingSafeEqual)
 * to avoid throwing on different-length input. The length disparity itself is
 * a tiny information leak but acceptable for a passcode (length is not secret).
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a ?? ''), 'utf8');
  const bBuf = Buffer.from(String(b ?? ''), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  if (aBuf.length === 0) return false;            // empty == empty would be true; fail-closed
  return timingSafeEqual(aBuf, bBuf);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── logout branch: clear cookie regardless of current session ──
  if (req.query?.action === 'logout') {
    clearSessionCookie(res, COACH_COOKIE_NAME);
    return res.status(200).json({ ok: true });
  }

  // ── login branch: passcode check ──
  const provided = String((req.body && req.body.passcode) || '');
  const expected = process.env.COACH_PASSCODE || '';
  const secret   = process.env.SESSION_SECRET || '';

  // Fail-closed on missing config. Same 401 shape as a wrong passcode so we
  // don't leak which knob is broken.
  if (!expected || !secret) {
    console.warn('[coach-auth] missing COACH_PASSCODE or SESSION_SECRET env — denying all attempts');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (!safeEqual(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── valid passcode → issue HMAC-signed coach_session cookie ──
  const iat = nowSec();
  const exp = plusDays(30);
  const token = signSession({ role: 'coach', iat, exp }, secret);
  setSessionCookie(res, COACH_COOKIE_NAME, token);
  return res.status(200).json({ ok: true });
}
