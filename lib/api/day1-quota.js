// lib/api/day1-quota.js
//
// Day-1 monthly quota gate (Patrick 6/7 funnel-precise spec).
//
// Hook semantics (from Patrick spec — three pitfalls fixed):
//   坑 1 (request-link 雙用途): gate ONLY new emails. Existing students
//       (already in students table) are returning visitors — always pass.
//   坑 2 (request-guide option 1 PDF-only): never gated. Only option 2/3
//       (which send a magic-link) are subject to the new-email quota.
//   坑 3 (chat.js NOT the gate point): cost is incurred there but gating
//       there would lock out users who've already received magic-links.
//       Gate at the magic-link issuance layer (request-link / request-guide).
//
// Counting: `used = COUNT(DISTINCT student_id) WHERE day1_started_at IS NOT
// NULL AND day1_started_at fell within the current Asia/Taipei calendar
// month`. chat.js writes day1_started_at write-if-null at the moment the
// student takes their first chat turn (real cost). This is more accurate
// than counting magic-links sent (some clickthroughs never happen).
//
// Soft cap: magic-links already issued before the quota tipped over will
// still grant Day-1 access on clickthrough. Spec accepts the slight overage
// rather than adding a tight lock that would compromise UX.
//
// Caching: none. Quota reads run on each /api/auth/request-link or
// /api/request-guide call. Volume is funnel-stage (low req/s); SELECT COUNT
// with the day1_started_at index is sub-millisecond. Cross-instance cache
// would also be incorrect anyway (counters live in DB).

/** Default monthly quota when env unset. */
export const DEFAULT_DAY1_QUOTA = 100;

/**
 * @returns {number} integer >= 0
 */
export function getQuota() {
  const raw = process.env.DAY1_QUOTA;
  if (typeof raw !== 'string') return DEFAULT_DAY1_QUOTA;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return DEFAULT_DAY1_QUOTA;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return DEFAULT_DAY1_QUOTA;
  return Math.floor(n);
}

/**
 * Count distinct students whose day1_started_at falls in the current
 * Asia/Taipei calendar month.
 *
 * @param {Function} sql - neon tagged-template
 * @returns {Promise<number>}
 */
export async function countUsedThisMonth(sql) {
  const rows = await sql`
    SELECT COUNT(DISTINCT student_id)::int AS used
      FROM students
     WHERE day1_started_at IS NOT NULL
       AND day1_started_at >= date_trunc(
             'month', (NOW() AT TIME ZONE 'Asia/Taipei')
           ) AT TIME ZONE 'Asia/Taipei'
  `;
  return Number(rows?.[0]?.used) || 0;
}

/**
 * Is this email already a registered student?
 *
 * @param {Function} sql
 * @param {string} email - already normalized (lowercase + trim)
 * @returns {Promise<boolean>}
 */
export async function isExistingStudent(sql, email) {
  if (typeof email !== 'string' || email.length === 0) return false;
  const rows = await sql`
    SELECT 1 FROM students
     WHERE LOWER(TRIM(email)) = ${email}
     LIMIT 1
  `;
  return rows.length > 0;
}

/**
 * Decision function — should we issue a NEW Day-1 magic-link for this email?
 *
 * Returns an action verdict the caller can act on:
 *   - 'pass'        : send the magic-link normally
 *   - 'existing'    : email belongs to a registered student → always pass
 *                     (returning visitor; same as 'pass' but logged
 *                     differently for observability)
 *   - 'waitlist'    : quota exhausted → caller should record the email in
 *                     day1_waitlist and skip sending the magic-link
 *
 * @param {Function} sql
 * @param {string} email - normalized
 * @returns {Promise<{verdict:'pass'|'existing'|'waitlist', quota:number, used:number}>}
 */
export async function decideDay1Gate(sql, email) {
  const quota = getQuota();
  if (await isExistingStudent(sql, email)) {
    return { verdict: 'existing', quota, used: -1 };
  }
  const used = await countUsedThisMonth(sql);
  if (used >= quota) {
    return { verdict: 'waitlist', quota, used };
  }
  return { verdict: 'pass', quota, used };
}

/**
 * Insert an email into the waitlist (idempotent across sources).
 *
 * @param {Function} sql
 * @param {string} email
 * @param {'request_link'|'request_guide'} source
 * @returns {Promise<void>}
 */
export async function addToWaitlist(sql, email, source) {
  if (typeof email !== 'string' || email.length === 0) return;
  const src = (source === 'request_link' || source === 'request_guide')
    ? source
    : 'request_link';
  try {
    await sql`
      INSERT INTO day1_waitlist (email, source)
      VALUES (${email}, ${src})
    `;
  } catch (err) {
    // Fail-soft: a waitlist write failure must NOT cause the caller to leak
    // information ("oops the waitlist table is missing → 500"). The funnel's
    // response envelope (200 ok:true) must stay consistent. Log + swallow.
    console.warn('[day1-quota][waitlist-insert-failed]', JSON.stringify({
      event: 'day1_waitlist_insert_failed',
      source: src,
      err: err?.message || String(err),
      // 鐵律 #2: don't log raw email.
    }));
  }
}
