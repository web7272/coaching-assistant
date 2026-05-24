// api/admin/transcript.js
// GET /api/admin/transcript?studentId=A001&module=self&day=N
// PR-4c-green 教練後台逐字對話 review (Patrick 5/24).
//
// Returns the FULL message-by-message transcript of Day N for the coach side
// only. The student SPA never gets a path to this — methodology forbids it:
// synthesis > re-reading 聊天紀錄 (NLP Amnesia, 鐵律). Coach review only.
//
// Response shape:
//   {
//     day,
//     messages: [{ role: 'user'|'assistant', content: string, createdAt: string }],
//     exists: boolean,
//   }
//
// ⚠️ Auth (鐵律 #2 諮商保密 — most sensitive data we hold):
//   - getToken from next-auth/jwt reads the OAuth session cookie set by the
//     existing GoogleProvider in api/auth/[...nextauth].js.
//   - token.email must equal process.env.COACH_EMAIL (the same Vivi-authorized
//     email the [...nextauth].js signIn callback already gates on).
//   - Anything else → 401. No x-admin-token header here; tokens can't be safely
//     handed to a browser SPA. This is the gate every audience=coach endpoint
//     should eventually wear (PR-4c-5 debt).
//
// ⚠️ day→session mapping consistency:
//   This endpoint joins messages → sessions ON sessions.day = N — the same
//   integer the journey grid + api/note.js coach path use. Migration 018 ensures
//   sessions.day is UNIQUE per (student_id, module). So the same day-N button
//   in the coach UI now resolves to:
//     - api/note?day=N&audience=coach        → damon_notes.day = N
//     - api/admin/transcript?day=N           → sessions.day  = N
//   Both written from the same chat.js execution context → consistent by
//   construction. (We do not use the student-path notebook_page OFFSET trick,
//   which would be ambiguous when self-paced students close two days on the
//   same calendar date.)

import { neon } from '@neondatabase/serverless';
// PR-4c-green Patrick 5/24 — shared coach gate (was inline; extracted to lib so
// the same rule guards note.js / phase-report.js audience=coach branches too).
import { guardCoachOr401 } from '../../lib/auth/coach-session.js';

export const maxDuration = 10;

// SQL client injection seam (matches lib/state/state-manager.js's _setSqlClient).
let _sql = null;
/** @param {Function} client - neon-style tag-template SQL function */
export function _setSqlClient(client) { _sql = client; }
function getSql() {
  if (_sql) return _sql;
  return neon(process.env.DATABASE_URL);
}

// Backwards-compat re-export — transcript.test.js's existing test seam.
// guardCoachOr401 reads its mock getToken from lib/auth/coach-session's seam.
export { _setGetTokenFn, isAuthorizedCoach } from '../../lib/auth/coach-session.js';

// ─────────────────────────────────────────────────────────
// Pure helpers (exported for tests)
// ─────────────────────────────────────────────────────────

/**
 * Shape the API response from raw message rows. Pure (no I/O).
 * @param {Array<{role:string, content:string, created_at:any}>} rows
 * @param {number} day
 */
export function shapeTranscriptResponse(rows, day) {
  const messages = (Array.isArray(rows) ? rows : []).map(r => ({
    role: r.role,
    content: r.content,
    createdAt: r.created_at,
  }));
  return { day, messages, exists: messages.length > 0 };
}

// ─────────────────────────────────────────────────────────
// Handler
// ─────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Auth — getToken + COACH_EMAIL via shared gate. 401 sent if not authorized.
  if (!(await guardCoachOr401(req, res))) return;

  // Inputs
  const studentId = String(req.query?.studentId || '').trim();
  const module    = String(req.query?.module    || 'self').trim();
  const day       = parseInt(req.query?.day);
  if (!studentId) return res.status(400).json({ error: 'Missing required query: studentId' });
  if (!Number.isFinite(day) || day < 1 || day > 21) {
    return res.status(400).json({ error: 'Invalid day (1-21)' });
  }

  try {
    const sql = getSql();
    // sessions.day = N is the canonical program-day key (set by loadOrCreateSession,
    // UNIQUE per (student_id, module, day) since migration 018). Same key the
    // coach api/note.js path uses on damon_notes.day, so the same day button in
    // the coach UI returns the same day's note + transcript.
    const rows = await sql`
      SELECT m.role, m.content, m.created_at
      FROM messages m
      JOIN sessions s ON s.id = m.session_id
      WHERE s.student_id = ${studentId}
        AND s.module     = ${module}
        AND s.day        = ${day}
        AND m.role IN ('user', 'assistant')
      ORDER BY m.created_at ASC
    `;
    return res.status(200).json(shapeTranscriptResponse(rows, day));
  } catch (e) {
    console.error('[admin/transcript] error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
