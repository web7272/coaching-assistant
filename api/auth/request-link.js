// api/auth/request-link.js
// PR-4c-green Auth rebuild stage 1c — magic-link request endpoint.
//
// POST /api/auth/request-link { email, preferredName?, pace? }
//   - Normalize email (lowercase + trim)
//   - Random 32-byte hex token → SHA-256 hashed → INSERT into magic_link_tokens
//     with expires_at = now + 60min  (5/28 Vivi+Patrick: 20→60, real-data fix)
//   - sendMagicLink(email, `${APP_BASE_URL}/auth?token=${token}`)
//   - Returns { ok: true } ALWAYS (even on DB error / invalid email shape)
//     so an attacker probing addresses can't learn which exist as students.
//   - (Invalid input still returns 200 ok:true — the "always same" envelope
//     is the security property. Server-side log captures actual errors.)
//
// stage 1d retires the old POST /api/auth/email-login (direct-email-as-identity)
// once student endpoints all read sid from session. This endpoint is the
// replacement student-login path.

import { neon } from '@neondatabase/serverless';
import { randomBytes, createHash } from 'node:crypto';
import { sendMagicLink } from '../../lib/email/brevo.js';
import {
  normalizeEmail, normalizePreferredName, normalizePace,
} from '../../lib/auth/student-helpers.js';

export const maxDuration = 10;

// 5/28 Vivi+Patrick — 20→60. 封測 real data: A006 收信+點之間最多 18 分鐘、
// Vivi 自己 3 筆過期裡 2 筆是來不及點. 20 分鐘太緊. token 仍一次性、256-bit
// 隨機、安全性影響可忽略 (window 從 20→60 不改變漏洞模型).
const TTL_MINUTES = 60;

// Test seam (injectable SQL client) — matches the established pattern.
let _sql = null;
export function _setSqlClient(client) { _sql = client; }
function getSql() {
  if (_sql) return _sql;
  return neon(process.env.DATABASE_URL);
}

// Test seam — inject a mock sendMagicLink (e.g. to verify the link was attempted
// without printing to stdout). When unset, uses the real lib/email/brevo stub.
let _sendMagicLinkFn = null;
export function _setSendMagicLinkFn(fn) { _sendMagicLinkFn = fn; }
function sender() { return _sendMagicLinkFn || sendMagicLink; }

/**
 * PR-4c-green Auth rebuild 1g — resolve the base URL for the magic-link, with
 * a defensive fallback chain so a missing/typoed APP_BASE_URL doesn't blow up
 * the auth flow.
 *
 *   1. APP_BASE_URL if it looks like a real URL (starts with http:// or https://)
 *   2. https://${VERCEL_URL}   — Vercel auto-sets this to the deployment host
 *                                (without the scheme) for every preview + prod
 *      build. Means a fresh preview branch「just works」 without needing the
 *      env var to be re-pointed every time.
 *   3. http://localhost:3000   — last-resort dev fallback. If we reach this in
 *      production something is mis-configured, but the link will still be in
 *      the email + the Vercel log so it's recoverable.
 *
 * Pure helper (exported for testing).
 *
 * @returns {string} base URL without trailing slash
 */
export function resolveBaseUrl() {
  const app = process.env.APP_BASE_URL;
  if (typeof app === 'string' && /^https?:\/\//i.test(app.trim())) {
    return app.trim().replace(/\/+$/, '');
  }
  const vercel = process.env.VERCEL_URL;
  if (typeof vercel === 'string' && vercel.trim().length > 0) {
    // VERCEL_URL is scheme-less ("my-preview.vercel.app"); always https in prod.
    return `https://${vercel.trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`;
  }
  return 'http://localhost:3000';
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email          = normalizeEmail(req.body?.email);
  const preferredName  = normalizePreferredName(req.body?.preferredName);
  const pace           = normalizePace(req.body?.pace);

  // Bad-shape input: still 200 ok:true to keep the envelope identical for
  // probing attackers. Server-side warn surfaces the gap in ops.
  if (!email) {
    console.warn('[request-link] invalid email payload — returning ok:true anyway');
    return res.status(200).json({ ok: true });
  }

  try {
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000).toISOString();

    const sql = getSql();
    await sql`
      INSERT INTO magic_link_tokens (token_hash, email, preferred_name, pace, expires_at)
      VALUES (${tokenHash}, ${email}, ${preferredName}, ${pace}, ${expiresAt})
    `;

    const base = resolveBaseUrl();
    const link = `${base}/auth?token=${token}`;
    try {
      await sender()(email, link);
    } catch (sendErr) {
      // Same response envelope on send failure — don't leak.
      console.error('[request-link] sendMagicLink failed:', sendErr?.message || sendErr);
    }
  } catch (e) {
    console.error('[request-link] error:', e?.message || e);
    // STILL return ok:true. The security property「永遠回一樣」 is the point.
  }

  return res.status(200).json({ ok: true });
}
