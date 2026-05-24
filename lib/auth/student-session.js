// lib/auth/student-session.js
// PR-4c-green Auth rebuild stage 1d — the security-critical helper.
//
// Every student-facing endpoint reads its studentId from the HMAC-signed
// `student_session` cookie, NOT from query / body. The cookie was set by
// POST /api/auth/verify-link on a valid magic link. This module is the
// single source of truth for「what is THIS request's studentId」, so an
// attacker putting `?studentId=A999` on a URL or `body: {studentId:'A999'}`
// in a request body cannot read someone else's data.
//
// 鐵則 (Patrick 5/24): 學員 endpoint 不可再信任 client 傳來的 studentId.
//
// API:
//   getStudentIdFromSession(req) → string | null   (sid extracted from cookie, or null)
//   guardStudentOr401(req, res) → Promise<string | null>
//                                  Returns sid string on success.
//                                  On failure: sends 401 and returns null.
//                                  Pattern at call site:
//                                    const sid = await guardStudentOr401(req, res);
//                                    if (!sid) return;

import { verifySession, parseCookies } from './session.js';

export const STUDENT_COOKIE_NAME = 'student_session';

// ─── Test seam (matches coach-session's _setCoachSessionReader pattern) ──
let _readerFn = null;
/** @param {((req:any)=>Promise<object|null>)|null} fn */
export function _setStudentSessionReader(fn) { _readerFn = fn; }

/**
 * Pure: extract & validate the sid from a student-session payload.
 * Must have role='student' and a non-empty sid string. Otherwise null.
 *
 * @param {object|null|undefined} payload
 * @returns {string|null}
 */
export function studentIdFromPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.role !== 'student') return null;
  if (typeof payload.sid !== 'string' || payload.sid.length === 0) return null;
  return payload.sid;
}

/**
 * Read the student session cookie (or invoke the injected reader for tests),
 * verify HMAC + expiry, return the sid string or null.
 *
 * @param {object} req
 * @returns {Promise<string|null>}
 */
export async function getStudentIdFromSession(req) {
  try {
    let payload;
    if (_readerFn) {
      payload = await _readerFn(req);
    } else {
      const cookies = parseCookies(req);
      const token = cookies[STUDENT_COOKIE_NAME];
      if (!token) return null;
      payload = verifySession(token, process.env.SESSION_SECRET);
    }
    return studentIdFromPayload(payload);
  } catch (e) {
    console.warn('[student-session] read failed:', e?.message || e);
    return null;
  }
}

/**
 * Guard wrapper for endpoint handlers. Returns the verified sid (string) on
 * success; sends 401 and returns null on failure.
 *
 * @param {object} req
 * @param {object} res
 * @returns {Promise<string|null>}
 */
export async function guardStudentOr401(req, res) {
  const sid = await getStudentIdFromSession(req);
  if (sid) return sid;
  res.status(401).json({ error: 'Unauthorized' });
  return null;
}
