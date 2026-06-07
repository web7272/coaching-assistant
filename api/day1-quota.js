// api/day1-quota.js
// GET /api/day1-quota — public quota readout for landing.html Hero 右卡.
// Patrick 6/7 spec §3.
//
// Response shape (no PII, no auth):
//   { quota: number, used: number, remaining: number, month: 'YYYY-MM' }
//   where:
//     - quota     = current monthly quota (SQL app_config → env → default 1000)
//     - used      = COUNT DISTINCT students with day1_started_at this month (Asia/Taipei)
//     - remaining = Math.max(0, quota - used)   ← never negative (soft cap)
//     - month     = Asia/Taipei current calendar month, e.g. '2026-06'
//
// Caching:
//   30s in-memory cache of the FULL response. Landing page sees stale data
//   for up to 30s after Vivi flips quota / a new student starts Day-1; that's
//   acceptable for the稀缺感 display use case.
//
// Security:
//   - GET only (405 otherwise).
//   - No auth — landing page can call without cookies / token.
//   - Numbers only — no email lists, no student IDs, no PII.
//   - Fail-open: any error → return DEFAULT response (quota=1000, used=0,
//     remaining=1000) so the landing card displays normally. Real gating
//     happens server-side at /api/auth/request-link + /api/request-guide.

import { neon } from '@neondatabase/serverless';
import {
  getQuota, countUsedThisMonth, DEFAULT_DAY1_QUOTA,
} from '../lib/api/day1-quota.js';

export const maxDuration = 5;

// ────────────────────────────────────────────────────────────────
// Test seam — inject sql client.
// ────────────────────────────────────────────────────────────────
let _sql = null;
export function _setSqlClient(client) { _sql = client; }
function getSql() {
  if (_sql) return _sql;
  return neon(process.env.DATABASE_URL);
}

// ────────────────────────────────────────────────────────────────
// Response cache (per-process).
// ────────────────────────────────────────────────────────────────
export const RESPONSE_TTL_MS = 30_000;
let _cachedResp = null;
let _cachedAt   = 0;

export function _resetResponseCache() {
  _cachedResp = null;
  _cachedAt   = 0;
}

/**
 * Build the 'YYYY-MM' string for the current calendar month in Asia/Taipei.
 * Uses Intl.DateTimeFormat for correctness across DST / leap edges (台北本身
 * 沒 DST, 但 portable 仍走 Intl 比較安全).
 *
 * Exported for tests.
 */
export function taipeiMonthString(now = new Date()) {
  // sv-SE locale gives ISO-ish formatting; we just want YYYY-MM.
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year:  'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const y = parts.find(p => p.type === 'year')?.value  || '';
  const m = parts.find(p => p.type === 'month')?.value || '';
  return `${y}-${m}`;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Cache hit — return immediately without DB.
  const now = Date.now();
  if (_cachedResp && (now - _cachedAt) < RESPONSE_TTL_MS) {
    return res.status(200).json(_cachedResp);
  }

  try {
    const sql = getSql();
    const [quota, used] = await Promise.all([
      getQuota(sql),
      countUsedThisMonth(sql),
    ]);
    const body = {
      quota,
      used,
      remaining: Math.max(0, quota - used),
      month:     taipeiMonthString(),
    };
    _cachedResp = body;
    _cachedAt   = now;
    return res.status(200).json(body);
  } catch (err) {
    // Fail-open: return defaults so the landing card still renders normally.
    // The real gate at /api/auth/request-link + /api/request-guide remains
    // authoritative; this endpoint's job is purely display.
    console.warn('[day1-quota-endpoint][fail-open]', err?.message || err);
    const fallback = {
      quota:     DEFAULT_DAY1_QUOTA,
      used:      0,
      remaining: DEFAULT_DAY1_QUOTA,
      month:     taipeiMonthString(),
    };
    // Don't cache the fallback — next call retries DB.
    return res.status(200).json(fallback);
  }
}
