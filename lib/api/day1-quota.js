// lib/api/day1-quota.js
//
// Day-1 monthly quota gate (Patrick 6/7 funnel-precise spec; Vivi 6/7 quota
// source → SQL-tunable).
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
// Quota source (Vivi 6/7 decision — SQL 即時可改):
//   1. SELECT app_config.value WHERE key='monthly_day1_quota'   ← primary
//      (帶 30s TTL in-memory cache; 過 TTL 自動失效, Vivi 一句 SQL 即時生效)
//   2. process.env.DAY1_QUOTA                                    ← env fallback
//   3. DEFAULT_DAY1_QUOTA = 1000                                 ← hard fallback
//
// Cache scope: per-process. Multiple Vercel instances each hold their own
// cache; worst case Vivi's SQL change takes one TTL window to roll out.
// Acceptable for non-critical config like quota size.

/** Default monthly quota when no override is found. (Vivi 6/7: was 100 → 1000.) */
export const DEFAULT_DAY1_QUOTA = 1000;

/**
 * Default scarcity threshold (Patrick 6/8 設計師方案 3 止血).
 * remaining > threshold  → 質性文案 (1000 席 framing).
 * 0 < remaining ≤ threshold → 「只剩 N 個名額」 推力最大.
 * remaining ≤ 0          → 「名額已滿」.
 *
 * Code default 50; Vivi 之後可用 SQL 即時調 (UPDATE app_config
 * key='day1_quota_scarcity_threshold') 不重部署.
 */
export const DEFAULT_SCARCITY_THRESHOLD = 50;

/** TTL for quota cache in milliseconds. ~30s = quick rollout, low DB hit. */
export const QUOTA_TTL_MS = 30_000;

// ────────────────────────────────────────────────────────────────
// In-memory cache (per-process).
// ────────────────────────────────────────────────────────────────
let _cachedQuota = null;      // last resolved integer, or null
let _cachedAt    = 0;          // Date.now() when cached

let _cachedThreshold = null;
let _cachedThresholdAt = 0;

/**
 * Test seam — reset the cache. Tests should call this in beforeEach to avoid
 * cross-test bleed.
 */
export function _resetQuotaCache() {
  _cachedQuota = null;
  _cachedAt    = 0;
}

/**
 * Test seam — reset the scarcity-threshold cache.
 */
export function _resetScarcityCache() {
  _cachedThreshold = null;
  _cachedThresholdAt = 0;
}

/**
 * Parse a string into a non-negative integer quota, or return null if invalid.
 * Shared by both SQL-row parsing and env-var parsing so the rules are identical.
 */
function _parseQuotaString(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * Read quota from env (DAY1_QUOTA), or return null if unset/malformed.
 * Pure helper; no SQL.
 */
function _quotaFromEnv() {
  return _parseQuotaString(process.env.DAY1_QUOTA);
}

/**
 * Resolve the current monthly quota.
 *
 * Order:
 *   1. SQL `app_config WHERE key='monthly_day1_quota'` (cached 30s)
 *   2. env DAY1_QUOTA
 *   3. DEFAULT_DAY1_QUOTA (1000)
 *
 * Cache: if sql is provided AND the cache is fresh, return the cached value
 * without hitting the DB. A nullish/throwing SQL read falls through to
 * env/default (does NOT populate the cache so the next call retries).
 *
 * Tests can call `_resetQuotaCache()` between cases to avoid bleed; if sql is
 * omitted (e.g. legacy callers), the function still works but skips step 1.
 *
 * @param {Function|null} sql - neon tagged-template, optional
 * @returns {Promise<number>} integer >= 0
 */
export async function getQuota(sql = null) {
  const now = Date.now();
  // Cache hit — return without touching SQL/env.
  if (_cachedQuota !== null && (now - _cachedAt) < QUOTA_TTL_MS) {
    return _cachedQuota;
  }

  // Track whether the SQL path threw — if so, we MUST NOT cache the fallback
  // value (env/default), because we want the next call to retry SQL. Caching
  // the fallback would freeze the quota at the wrong value until TTL expires
  // even after the DB recovers.
  let sqlThrew = false;

  // 1. SQL config table.
  if (typeof sql === 'function') {
    try {
      const rows = await sql`
        SELECT value FROM app_config
         WHERE key = 'monthly_day1_quota'
         LIMIT 1
      `;
      const sqlVal = _parseQuotaString(rows?.[0]?.value);
      if (sqlVal !== null) {
        _cachedQuota = sqlVal;
        _cachedAt    = now;
        return sqlVal;
      }
      // SQL succeeded but row missing/malformed — fall through to env. Safe
      // to cache the fallback (env/default) because SQL is healthy and the
      // result won't change until Vivi explicitly INSERTs a row.
    } catch (err) {
      // app_config table missing / read failed → fall through, but flag so
      // we DON'T cache (we want to retry SQL on the next call).
      sqlThrew = true;
      console.warn('[day1-quota][app-config-read-failed]', err?.message || err);
    }
  }

  // 2. env DAY1_QUOTA.
  const envVal = _quotaFromEnv();
  if (envVal !== null) {
    if (!sqlThrew) {
      _cachedQuota = envVal;
      _cachedAt    = now;
    }
    return envVal;
  }

  // 3. default 1000.
  if (!sqlThrew) {
    _cachedQuota = DEFAULT_DAY1_QUOTA;
    _cachedAt    = now;
  }
  return DEFAULT_DAY1_QUOTA;
}

/**
 * Resolve the scarcity threshold (Patrick 6/8 設計師方案 3 止血).
 *
 * Order:
 *   1. SQL `app_config WHERE key='day1_quota_scarcity_threshold'` (cached 30s)
 *   2. DEFAULT_SCARCITY_THRESHOLD (50)
 *
 * NO env fallback by spec — Patrick wants code default 50; Vivi 用 SQL 調.
 * SQL throw / row missing → fall through to default. Same don't-cache-on-throw
 * posture as getQuota so SQL recovery surfaces next call.
 *
 * @param {Function|null} sql - neon tagged-template, optional
 * @returns {Promise<number>} integer >= 0
 */
export async function getScarcityThreshold(sql = null) {
  const now = Date.now();
  if (_cachedThreshold !== null && (now - _cachedThresholdAt) < QUOTA_TTL_MS) {
    return _cachedThreshold;
  }

  let sqlThrew = false;
  if (typeof sql === 'function') {
    try {
      const rows = await sql`
        SELECT value FROM app_config
         WHERE key = 'day1_quota_scarcity_threshold'
         LIMIT 1
      `;
      const sqlVal = _parseQuotaString(rows?.[0]?.value);
      if (sqlVal !== null) {
        _cachedThreshold   = sqlVal;
        _cachedThresholdAt = now;
        return sqlVal;
      }
      // SQL succeeded but row missing/malformed — safe to cache the default.
    } catch (err) {
      sqlThrew = true;
      console.warn('[day1-quota-scarcity][app-config-read-failed]', err?.message || err);
    }
  }

  if (!sqlThrew) {
    _cachedThreshold   = DEFAULT_SCARCITY_THRESHOLD;
    _cachedThresholdAt = now;
  }
  return DEFAULT_SCARCITY_THRESHOLD;
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
  const quota = await getQuota(sql);
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
