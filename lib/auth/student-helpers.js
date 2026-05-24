// lib/auth/student-helpers.js
// PR-4c-green Auth rebuild stage 1d — pure helpers for student auth flow.
//
// Moved out of api/auth/email-login.js (now retired) so both
// /api/auth/request-link and /api/auth/verify-link can share them.
//
// All functions are pure (no I/O), unit-tested in student-helpers.test.js.

/**
 * Allocate the next student_id of form A### given the highest existing one.
 *
 * @param {string|null|undefined} lastId  highest existing student_id matching /^A\d{3}$/, or null
 * @returns {string}            next id, e.g. 'A001', 'A042'
 */
export function nextStudentId(lastId) {
  if (typeof lastId !== 'string' || !/^A\d{3}$/.test(lastId)) return 'A001';
  const n = parseInt(lastId.slice(1), 10) + 1;
  return 'A' + String(n).padStart(3, '0');
}

/**
 * Normalize/validate an email for lookup. Strict-enough (no full RFC 5322).
 *
 * @param {string} email
 * @returns {string|null}
 */
export function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  if (e.length < 3 || !e.includes('@') || !e.includes('.')) return null;
  return e;
}

/**
 * Normalize/validate the preferred_name field from entry forms.
 * Trim + length-cap (40 chars). Empty / non-string → null (no preferred name set).
 *
 * @param {string} name
 * @returns {string|null}
 */
export function normalizePreferredName(name) {
  if (typeof name !== 'string') return null;
  const t = name.trim();
  if (t.length === 0) return null;
  return t.length > 40 ? t.slice(0, 40) : t;
}

/**
 * Coerce the entry-form pace selection to a valid value.
 * 'daily' is the default. Anything not 'self-paced' falls back to 'daily'.
 *
 * @param {string} pace
 * @returns {'daily'|'self-paced'}
 */
export function normalizePace(pace) {
  if (pace === 'self-paced') return 'self-paced';
  return 'daily';
}
