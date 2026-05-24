// lib/auth/coach-session.js
// Shared coach-session gate — getToken (next-auth/jwt) + COACH_EMAIL allowlist.
//
// Used by every endpoint that returns coach-internal content (audience=coach
// branches + /api/admin/* endpoints). Replaces ad-hoc inline auth in each
// endpoint so the rule is single-sourced and easy to grep for security review.
//
// Why not lib/auth/require-admin.js? That uses an x-admin-token header — fine
// for server-to-server but unsafe to ship to a browser SPA. The coach UI runs
// in the browser and signs in via Google OAuth (api/auth/[...nextauth].js with
// COACH_EMAIL allowlist); getToken reads that session cookie server-side.
//
// next-auth/jwt is provided at runtime on Vercel (via the existing
// [...nextauth].js wiring) but is NOT in this repo's local package.json deps.
// Dynamic import keeps node:test from blowing up at module-load time; tests
// inject a mock via _setGetTokenFn().

let _getTokenFn = null;

/**
 * Test seam — inject a mock `getToken(req)` function. Pass `null` to reset.
 * @param {((req:any)=>Promise<{email?:string}|null>)|null} fn
 */
export function _setGetTokenFn(fn) { _getTokenFn = fn; }

/**
 * Pure: does this token's email match the configured coach allowlist?
 * Case-insensitive. Defends against missing/empty COACH_EMAIL (fail-closed —
 * never authorize when the env var isn't set; otherwise any signed-in Google
 * account would slip through).
 *
 * @param {{email?:string}|null|undefined} token
 * @param {string|undefined} expectedEmail
 * @returns {boolean}
 */
export function isAuthorizedCoach(token, expectedEmail) {
  if (!token || typeof token !== 'object') return false;
  if (typeof expectedEmail !== 'string' || expectedEmail.length === 0) return false;
  if (typeof token.email !== 'string' || token.email.length === 0) return false;
  return token.email.toLowerCase() === expectedEmail.toLowerCase();
}

/**
 * Verify the request carries a valid coach OAuth session.
 *
 * Returns true iff getToken({req, secret}) returns a token whose email matches
 * process.env.COACH_EMAIL. Any failure path (no token / wrong email / getToken
 * throws / env unset) → false. The caller wraps this in `if (!ok) 401`.
 *
 * @param {object} req
 * @returns {Promise<boolean>}
 */
export async function assertCoachSession(req) {
  try {
    let token;
    if (_getTokenFn) {
      token = await _getTokenFn(req);
    } else {
      const mod = await import('next-auth/jwt');
      token = await mod.getToken({ req, secret: process.env.NEXTAUTH_SECRET });
    }
    return isAuthorizedCoach(token, process.env.COACH_EMAIL);
  } catch (e) {
    console.warn('[coach-session] auth check failed:', e?.message || e);
    return false;
  }
}

/**
 * Convenience: send 401 and return false; return true if authorized.
 * Lets the caller write `if (!await guardCoachOr401(req, res)) return;`.
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
