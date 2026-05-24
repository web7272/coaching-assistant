// lib/auth/coach-session.js
// PR-4c-green Auth rebuild stage 1a — HMAC-cookie coach gate.
//
// Replaces the broken NextAuth getToken path. `next-auth` was never in
// package.json, so the old api/auth/[...nextauth].js 404'd in production and
// every audience=coach / admin endpoint guarded by this module returned 401.
//
// Cookie: `coach_session` = signSession({ role: 'coach', iat, exp }, SESSION_SECRET)
//   - Set by POST /api/coach-auth on correct passcode (stage 1b)
//   - Cleared by POST /api/coach-auth?action=logout
//
// Public API unchanged (per Patrick 1a spec): all callers of guardCoachOr401
// (note.js / phase-report.js / transcript.js / sessions.js / students.js)
// keep their existing one-liner integration and zero churn.

import { verifySession, parseCookies } from './session.js';

export const COACH_COOKIE_NAME = 'coach_session';

// ─── Test seam ──────────────────────────────────────────────────────────
// Inject a mock that returns the coach-session payload (or null). Used by
// every coach-side endpoint test to bypass the real cookie/HMAC path.
//
// Note: this is the SUCCESSOR to the old `_setGetTokenFn` seam from the
// NextAuth era. Tests that imported `_setGetTokenFn` (transcript / sessions /
// students) are migrated to `_setCoachSessionReader` in stage 1a.

let _readerFn = null;
/** @param {((req:any)=>Promise<object|null>)|null} fn */
export function _setCoachSessionReader(fn) { _readerFn = fn; }

// ─── Pure helper (exported for testing) ─────────────────────────────────

/**
 * Is this a coach-shaped session payload? The HMAC + expiry checks are done
 * by verifySession; this is the final shape gate: must have role='coach'.
 *
 * @param {object|null|undefined} payload
 * @returns {boolean}
 */
export function isAuthorizedCoach(payload) {
  if (!payload || typeof payload !== 'object') return false;
  return payload.role === 'coach';
}

// ─── Core gate ──────────────────────────────────────────────────────────

/**
 * Read + verify the coach session cookie. Returns true iff the cookie is
 * present, HMAC-valid, not expired, and carries role='coach'. Any failure
 * path (no cookie / bad MAC / wrong role / expired / SESSION_SECRET unset)
 * → false. The caller wraps this in `if (!ok) 401`.
 *
 * @param {object} req
 * @returns {Promise<boolean>}
 */
export async function assertCoachSession(req) {
  try {
    if (_readerFn) {
      const payload = await _readerFn(req);
      return isAuthorizedCoach(payload);
    }
    const cookies = parseCookies(req);
    const token = cookies[COACH_COOKIE_NAME];
    if (!token) return false;
    const payload = verifySession(token, process.env.SESSION_SECRET);
    return isAuthorizedCoach(payload);
  } catch (e) {
    console.warn('[coach-session] auth check failed:', e?.message || e);
    return false;
  }
}

/**
 * One-liner the endpoints use:
 *   if (!(await guardCoachOr401(req, res))) return;
 *
 * @param {object} req
 * @param {object} res
 * @returns {Promise<boolean>}
 */
export async function guardCoachOr401(req, res) {
  if (await assertCoachSession(req)) return true;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}
