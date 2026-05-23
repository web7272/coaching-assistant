// api/note.js
// GET /api/note?studentId=A001&module=self&day=3
// Per docs/v5-spec/engineering/07-pr4c §3-D.
//
// Response shape:
//   { day, noteText, exists }
//
// Reads damon_notes (is_week_summary=false) for that specific day.
// Caller: §4.5 教練筆記頁 — revealed cell click to re-read.

import { neon } from '@neondatabase/serverless';

export const maxDuration = 10;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const studentId = String(req.query?.studentId || '').trim();
  const module    = String(req.query?.module    || 'self').trim();
  const day       = parseInt(req.query?.day);
  if (!studentId) return res.status(400).json({ error: 'Missing required query: studentId' });
  if (!Number.isFinite(day) || day < 1 || day > 21) {
    return res.status(400).json({ error: 'Invalid day (1-21)' });
  }
  const week = Math.ceil(day / 7);

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT note_text FROM damon_notes
      WHERE student_id = ${studentId} AND module = ${module}
        AND week = ${week} AND day = ${day}
        AND is_week_summary = FALSE
      LIMIT 1
    `;
    if (rows.length === 0) {
      return res.status(200).json({ day, noteText: null, exists: false });
    }
    return res.status(200).json({ day, noteText: rows[0].note_text, exists: true });
  } catch (e) {
    console.error('[note] error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
