// api/auth/verify-link.js
// PR-4c-green Auth rebuild stage 1c — magic-link verify + login.
//
// POST /api/auth/verify-link { token }
//   - SHA-256(token) → atomic UPDATE…RETURNING on magic_link_tokens
//     WHERE token_hash matches AND used_at IS NULL AND expires_at > NOW()
//     → row returned = valid + first-use; otherwise → 401.
//   - find-or-create student by email (re-uses email-login's nextStudentId +
//     dedup-by-email path).
//   - signs student_session cookie (role:'student', sid:<studentId>, 30d)
//   - returns { studentId, module, currentDay, preferredName, pace }
//
// Replay attempts (token used twice): the atomic UPDATE…RETURNING returns 0
// rows on the 2nd hit → 401. Expired tokens similarly → 401. No information
// about which condition failed leaks beyond a generic 401.

import { neon } from '@neondatabase/serverless';
import { createHash } from 'node:crypto';
import {
  signSession, setSessionCookie, plusDays, nowSec,
} from '../../lib/auth/session.js';
import { nextStudentId } from '../../lib/auth/student-helpers.js';
// 5/29 Patrick (Vivi access gate) — 即使 magic link 自己 valid, blocked 學員
// 不發 cookie. 防 race: token 已發出後 Vivi block, token 在 60min TTL 內仍可
// claim 但不該登進來.
import { isBlocked, BLOCKED_RESPONSE } from '../../lib/api/access-gate.js';

export const maxDuration = 10;

export const STUDENT_COOKIE_NAME = 'student_session';

let _sql = null;
export function _setSqlClient(client) { _sql = client; }
function getSql() {
  if (_sql) return _sql;
  return neon(process.env.DATABASE_URL);
}

// Accept 64 hex chars (= 32 bytes from randomBytes(32).toString('hex')).
const TOKEN_RE = /^[a-f0-9]{64}$/;

export function isValidTokenShape(token) {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!process.env.SESSION_SECRET) {
    console.warn('[verify-link] SESSION_SECRET unset — denying all attempts');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = String(req.body?.token || '');
  if (!isValidTokenShape(token)) {
    return res.status(401).json({ error: 'Invalid or expired link' });
  }
  const tokenHash = createHash('sha256').update(token).digest('hex');

  try {
    const sql = getSql();

    // Atomic claim: UPDATE sets used_at exactly once iff (token matches AND
    // not yet used AND not expired). Replay / expired / bogus → 0 rows → 401.
    const claimed = await sql`
      UPDATE magic_link_tokens
         SET used_at = NOW()
       WHERE token_hash = ${tokenHash}
         AND used_at IS NULL
         AND expires_at > NOW()
      RETURNING email, preferred_name, pace
    `;
    if (claimed.length === 0) {
      return res.status(401).json({ error: 'Invalid or expired link' });
    }
    const { email, preferred_name: linkName, pace: linkPace } = claimed[0];

    // find-or-create by email
    // 5/29 Patrick — SELECT 加 is_blocked 給下面 access gate 用.
    const found = await sql`
      SELECT student_id, current_module, current_day, preferred_name, pace, is_blocked
        FROM students
       WHERE LOWER(TRIM(email)) = ${email}
       LIMIT 1
    `;
    // 既有學員若 is_blocked=TRUE → 不發 cookie. token 已 claim 沒關係 (一次性、
    // 已被 used_at 標掉、後續 replay 仍 401). 文案統一 BLOCKED_RESPONSE.
    if (found.length > 0 && isBlocked(found[0])) {
      console.info('[verify-link][blocked]', JSON.stringify({
        event: 'verify_link_blocked', student_id: found[0].student_id, email,
      }));
      return res.status(403).json(BLOCKED_RESPONSE);
    }

    let studentId, currentModule, currentDay, finalPreferredName, finalPace;
    if (found.length > 0) {
      const row = found[0];
      studentId           = row.student_id;
      currentModule       = row.current_module || 'self';
      currentDay          = row.current_day || 1;
      finalPreferredName  = linkName ?? row.preferred_name ?? null;
      finalPace           = linkPace ?? row.pace ?? 'daily';
      // Refresh preferred_name / pace from the link if provided.
      if (linkName || linkPace) {
        await sql`
          UPDATE students SET
            preferred_name = COALESCE(${linkName}, preferred_name),
            pace           = COALESCE(${linkPace}, pace),
            updated_at     = NOW()
          WHERE student_id = ${studentId}
        `;
      }
    } else {
      // Allocate the next A### id, then INSERT with race-safe ON CONFLICT
      // resolution (same pattern as email-login.js after migration 019).
      const last = await sql`
        SELECT student_id FROM students
        WHERE student_id ~ '^A[0-9]{3}$'
        ORDER BY student_id DESC LIMIT 1
      `;
      studentId = nextStudentId(last[0]?.student_id ?? null);
      try {
        await sql`
          INSERT INTO students
            (student_id, email, plan, tier, current_module, current_week, current_day,
             self_week_completed, money_unlocked, relationship_unlocked,
             preferred_name, pace)
          VALUES
            (${studentId}, ${email}, 'trial', 0, 'self', 1, 1,
             0, FALSE, FALSE,
             ${linkName}, ${linkPace || 'daily'})
        `;
        currentModule      = 'self';
        currentDay         = 1;
        finalPreferredName = linkName;
        finalPace          = linkPace || 'daily';
      } catch (insertErr) {
        // Race: a concurrent verify-link beat us. Re-SELECT and return that row.
        if (insertErr && (insertErr.code === '23505' || /unique/i.test(insertErr.message || ''))) {
          const raced = await sql`
            SELECT student_id, current_module, current_day, preferred_name, pace
              FROM students WHERE LOWER(TRIM(email)) = ${email}
             LIMIT 1
          `;
          if (raced.length > 0) {
            const row = raced[0];
            studentId           = row.student_id;
            currentModule       = row.current_module || 'self';
            currentDay          = row.current_day || 1;
            finalPreferredName  = linkName ?? row.preferred_name ?? null;
            finalPace           = linkPace ?? row.pace ?? 'daily';
          } else {
            throw insertErr;
          }
        } else {
          throw insertErr;
        }
      }
    }

    // Sign + set student session cookie.
    const iat = nowSec();
    const exp = plusDays(30);
    const sessionToken = signSession(
      { role: 'student', sid: studentId, iat, exp },
      process.env.SESSION_SECRET,
    );
    setSessionCookie(res, STUDENT_COOKIE_NAME, sessionToken);

    return res.status(200).json({
      studentId,
      module: currentModule,
      currentDay,
      preferredName: finalPreferredName ?? null,
      pace: finalPace,
    });
  } catch (e) {
    console.error('[verify-link] error:', e?.message || e);
    return res.status(500).json({ error: 'Server error' });
  }
}
