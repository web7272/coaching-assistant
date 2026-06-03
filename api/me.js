// api/me.js
// PR-4c-green Auth rebuild 1h — lightweight「who am I」 endpoint.
//
// GET /api/me
//   - guardStudentOr401: reads sid from the HMAC student_session cookie
//   - Returns { studentId, module, currentDay, preferredName, pace }
//     (same shape as POST /api/auth/verify-link's response — so the SPA can
//     hydrate localStorage from either path with the same code)
//
// Used by student.js boot to hydrate state when localStorage is empty but the
// student_session cookie is still valid (e.g. fresh tab after the 30-day cookie
// was set, or the user clicked a magic link in another browser session).
// Without this, the SPA's old「state.studentId 為空就丟去 entry」 gate would
// bounce the student even though the server cookie is good.

import { neon } from '@neondatabase/serverless';
import { guardStudentOr401 } from '../lib/auth/student-session.js';
// 5/29 Patrick (Vivi access gate) — blocked student → 403 (前端用此 signal 跳 /#/blocked).
import { isBlocked, BLOCKED_RESPONSE } from '../lib/api/access-gate.js';

export const maxDuration = 5;

// Test seam — inject a mock tag-template sql client.
let _sql = null;
export function _setSqlClient(client) { _sql = client; }
function getSql() {
  if (_sql) return _sql;
  return neon(process.env.DATABASE_URL);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // 401 → SPA boot treats this as「not logged in」 and routes to entry.
  const sid = await guardStudentOr401(req, res);
  if (!sid) return;

  try {
    const sql = getSql();
    // 5/29 Patrick — SELECT 加 is_blocked, 給 access gate 用 (回 200 之前判).
    // 6/02 Patrick — SELECT 加 email, 給 entry skip-email-if-authenticated 用
    //   (Landing → magic-link → 進 App 後, 精簡 entry 顯「歡迎,{email}」).
    const rows = await sql`
      SELECT student_id, email, current_module, current_day, preferred_name, pace, is_blocked
        FROM students
       WHERE student_id = ${sid}
       LIMIT 1
    `;
    // The session cookie verified but the student row is gone (e.g. admin
    // deleted them mid-session). Treat as 401 — force re-login.
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    const s = rows[0];
    // 5/29 Patrick — blocked → 403 BLOCKED_RESPONSE (SPA boot 看到這個 status
    // 跳 /#/blocked, 不誤把學員導去 /entry 重新 magic-link).
    if (isBlocked(s)) {
      return res.status(403).json(BLOCKED_RESPONSE);
    }
    return res.status(200).json({
      studentId:     s.student_id,
      email:         s.email ?? null,           // 6/02 — Landing funnel skip-email
      module:        s.current_module || 'self',
      currentDay:    s.current_day || 1,
      preferredName: s.preferred_name ?? null,
      pace:          s.pace || 'daily',
    });
  } catch (e) {
    console.error('[me] error:', e?.message || e);
    return res.status(500).json({ error: 'Server error' });
  }
}
