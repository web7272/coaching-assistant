// lib/api/admin-auth.js
// Patrick 5/30 — admin endpoint dual-auth: 教練後台 cookie OR service Bearer token.
//
// 起因: Daniel (Cowork agent, 無 browser) 要 scheduled task 呼叫 /api/admin/students;
//       既有 cookie auth 仰賴 HMAC coach_session, 對 service-to-service 不適用.
//
// 設計:
//   · cookie 路徑優先 (early return), 教練 browser 用既有 HMAC session.
//   · Bearer 路徑 fallback, header `Authorization: Bearer <ADMIN_API_TOKEN>`,
//     ADMIN_API_TOKEN 由 Vercel env 注入 (絕不在 repo).
//   · timing-safe compare 避免 timing attack.
//   · 範圍只開「唯讀 GET admin endpoint」; POST/PATCH/DELETE 一律維持 cookie only.
//
// 不擴大開放:
//   · 只在 /api/admin/students 用此 helper, 其他 admin endpoint (leads / future writes)
//     仍走 guardCoachOr401 cookie-only.

import { timingSafeEqual } from 'node:crypto';
import { assertCoachSession } from '../auth/coach-session.js';

/**
 * Constant-time string compare. Avoids leaking secret length / byte position
 * via short-circuit comparison timing.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function safeStringEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  // timingSafeEqual requires equal-length Buffers. Compare in fixed-length
  // workspace: hash a/b lengths separately (early-return on length mismatch is
  // safe — it leaks "wrong length" but NOT byte position).
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Check admin auth via either cookie or Bearer header. Returns `{ok, via}`.
 *
 *   ok=true,  via='cookie' → coach_session HMAC cookie passed.
 *   ok=true,  via='bearer' → Authorization: Bearer matched ADMIN_API_TOKEN.
 *   ok=false               → neither path passed (caller sends 401).
 *
 * Does NOT send a 401 response itself — caller decides shape + logging.
 *
 * @param {object} req
 * @returns {Promise<{ok:boolean, via?:'cookie'|'bearer'}>}
 */
export async function checkAdminAuth(req) {
  // 1. Cookie path (early return — keeps browser-coach behavior unchanged).
  try {
    if (await assertCoachSession(req)) {
      return { ok: true, via: 'cookie' };
    }
  } catch (e) {
    // Reader threw — treat as cookie auth failure, fall through to Bearer.
    // (Don't throw out of the dual-auth helper; bearer might still pass.)
  }

  // 2. Bearer path. Header: `Authorization: Bearer <token>`.
  const authHeader = (req && req.headers && req.headers.authorization) || '';
  const m = typeof authHeader === 'string' ? authHeader.match(/^Bearer\s+(.+)$/) : null;
  if (m) {
    const presented = m[1].trim();
    const expected  = process.env.ADMIN_API_TOKEN;
    // Reject if env var is unset / empty (don't auth on undefined === undefined).
    if (expected && typeof expected === 'string' && expected.length > 0
        && safeStringEqual(presented, expected)) {
      return { ok: true, via: 'bearer' };
    }
  }

  return { ok: false };
}

/**
 * Guard wrapper: on failure sends 401 and returns false; on success returns
 * the `{ok, via}` object so caller can log `via`.
 *
 * @param {object} req
 * @param {object} res
 * @returns {Promise<{ok:true, via:'cookie'|'bearer'}|false>}
 */
export async function guardAdminOr401(req, res) {
  const auth = await checkAdminAuth(req);
  if (auth.ok) return auth;
  res.status(401).json({ error: 'Unauthorized' });
  return false;
}
