// lib/api/case-id.js
// Case ID generation for /api/admin/cases (Daniel 6/5 客服 ticketing).
//
// Format: SY-YYYYMMDD-NNN
//   YYYYMMDD: Asia/Taipei calendar date
//   NNN     : 1-based daily sequence (zero-padded 3 digits)
//
// Race safety:
//   Caller computes case_id from COUNT + 1, then INSERTs with UNIQUE constraint
//   on case_id. On UNIQUE conflict → retry (recompute COUNT, gets next value).
//   Helper `tryGenerateAndInsert` encapsulates the retry loop.
//   客服量小 (數筆/day) → 1-2 retries 夠.

const TAIPEI_TZ = 'Asia/Taipei';
const MAX_RETRIES = 5;

/**
 * Format a Date as 'YYYYMMDD' in Asia/Taipei.
 *
 * @param {Date} [now=new Date()]
 * @returns {string}
 */
export function formatTaipeiDate(now = new Date()) {
  // en-CA locale yields 'YYYY-MM-DD' — strip dashes.
  const ymd = now.toLocaleDateString('en-CA', { timeZone: TAIPEI_TZ });
  return ymd.replace(/-/g, '');
}

/**
 * Build case_id string from date + sequence.
 *
 * @param {string} dateStr — YYYYMMDD
 * @param {number} sequence — 1-based positive integer
 * @returns {string}
 */
export function buildCaseId(dateStr, sequence) {
  const n = Math.max(1, Math.floor(Number(sequence) || 1));
  const padded = String(n).padStart(3, '0');
  return `SY-${dateStr}-${padded}`;
}

/**
 * Query the cases table to determine next sequence number for today (Taipei TZ).
 *
 * @param {Function} sql — neon-tagged-template sql function
 * @returns {Promise<number>} 1-based sequence
 */
export async function getNextSequenceForToday(sql) {
  const rows = await sql`
    SELECT COUNT(*)::int AS cnt
      FROM cases
     WHERE (created_at AT TIME ZONE 'Asia/Taipei')::date
         = (NOW() AT TIME ZONE 'Asia/Taipei')::date
  `;
  return (rows[0]?.cnt || 0) + 1;
}

/**
 * Generate a new case_id (without inserting). Useful for tests + retry logic.
 *
 * @param {Function} sql
 * @param {object} [opts]
 * @param {Date}   [opts.now=new Date()]
 * @returns {Promise<string>} case_id e.g. 'SY-20260606-001'
 */
export async function generateCaseId(sql, { now = new Date() } = {}) {
  const dateStr = formatTaipeiDate(now);
  const sequence = await getNextSequenceForToday(sql);
  return buildCaseId(dateStr, sequence);
}

/**
 * Detect if a thrown DB error is a UNIQUE constraint violation on cases.case_id.
 * pg error code 23505 (unique_violation).
 *
 * @param {unknown} err
 * @returns {boolean}
 */
export function isCaseIdUniqueConflict(err) {
  if (!err || typeof err !== 'object') return false;
  const code = err.code || err?.cause?.code;
  if (code === '23505') return true;
  // neon may wrap the message — defensive fallback.
  const msg = String(err.message || '');
  return /duplicate key value.*cases_case_id_key/i.test(msg)
      || /unique constraint.*cases.*case_id/i.test(msg);
}

/**
 * Generate-and-insert a new case with retry-on-UNIQUE-conflict.
 *
 * @param {Function} sql
 * @param {object} row — { email, gmail_thread_id?, subject?, student_id?, category? }
 * @param {object} [opts]
 * @param {Date}   [opts.now=new Date()] — injectable clock for tests
 * @param {number} [opts.maxRetries=MAX_RETRIES]
 * @returns {Promise<{case_id:string, created_at:string, attempts:number}>}
 */
export async function tryGenerateAndInsert(sql, row, { now = new Date(), maxRetries = MAX_RETRIES } = {}) {
  const {
    email, gmail_thread_id = null, subject = null,
    student_id = null, category = 'other',
  } = row || {};
  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const case_id = await generateCaseId(sql, { now });
    try {
      const inserted = await sql`
        INSERT INTO cases (case_id, email, gmail_thread_id, subject, student_id, category)
        VALUES (${case_id}, ${email}, ${gmail_thread_id}, ${subject}, ${student_id}, ${category})
        RETURNING case_id, created_at
      `;
      return {
        case_id: inserted[0].case_id,
        created_at: inserted[0].created_at,
        attempts: attempt,
      };
    } catch (e) {
      lastErr = e;
      if (isCaseIdUniqueConflict(e)) {
        // Recompute sequence on next iteration. Log retry for observability
        // (rare — 客服量小); 鐵律 #2: no raw email logged.
        console.warn('[case-id][retry]', JSON.stringify({
          event: 'case_id_unique_conflict_retry',
          attempt, case_id,
        }));
        continue;
      }
      throw e;
    }
  }
  // Exhausted retries — surface the last error.
  const err = new Error('case_id generation: exhausted retries on UNIQUE conflict');
  err.cause = lastErr;
  err.code = 'CASE_ID_RETRY_EXHAUSTED';
  throw err;
}

// Enum exports for app-layer validation (mirror migration 032 CHECK constraints).
export const CASE_CATEGORIES = Object.freeze([
  'bug', 'login', 'progress', 'feedback', 'refund', 'other',
]);

export const CASE_STATUSES = Object.freeze([
  'open', 'awaiting_vivi', 'resolved',
]);
