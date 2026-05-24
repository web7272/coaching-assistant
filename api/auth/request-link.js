// api/auth/request-link.js
// PR-4c-green Auth rebuild stage 1c — magic-link request endpoint.
//
// POST /api/auth/request-link { email, preferredName?, pace? }
//   - Normalize email (lowercase + trim)
//   - Random 32-byte hex token → SHA-256 hashed → INSERT into magic_link_tokens
//     with expires_at = now + 20min
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
} from './email-login.js';

export const maxDuration = 10;

const TTL_MINUTES = 20;

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

    const base = process.env.APP_BASE_URL || 'http://localhost:3000';
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
