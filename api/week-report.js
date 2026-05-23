// api/week-report.js
// GET /api/week-report?studentId=A001&module=self&week=1
// Per docs/v5-spec/engineering/07-pr4c §3-E.
//
// Response shape:
//   { week, title, body, exists }
//
// title = the ≤12-char first-line theme that generateWeekSummary now prompts for
//         (PR-4c-1: "first-line ≤12-char title" instruction added to summary prompt).
// body  = the rest of the summary (everything after the first non-empty line).

import { neon } from '@neondatabase/serverless';

export const maxDuration = 10;

/**
 * Split a week-summary note into { title, body }.
 *   title = first non-empty line, ≤12 chars (defensively trimmed; longer → still surfaced)
 *   body  = remainder, leading whitespace stripped
 *
 * Pure helper exported for testing.
 *
 * @param {string} noteText
 * @returns {{ title: string|null, body: string }}
 */
export function splitWeekSummary(noteText) {
  if (typeof noteText !== 'string' || noteText.length === 0) return { title: null, body: '' };
  const lines = noteText.split(/\r?\n/);
  let titleIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t.length > 0) { titleIdx = i; break; }
  }
  if (titleIdx === -1) return { title: null, body: '' };
  const title = lines[titleIdx].trim();
  const body = lines.slice(titleIdx + 1).join('\n').replace(/^[\s\n]+/, '');
  return { title, body };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const studentId = String(req.query?.studentId || '').trim();
  const module    = String(req.query?.module    || 'self').trim();
  const week      = parseInt(req.query?.week);
  if (!studentId) return res.status(400).json({ error: 'Missing required query: studentId' });
  if (!Number.isFinite(week) || week < 1 || week > 3) {
    return res.status(400).json({ error: 'Invalid week (1-3)' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT note_text FROM damon_notes
      WHERE student_id = ${studentId} AND module = ${module}
        AND week = ${week} AND is_week_summary = TRUE
      LIMIT 1
    `;
    if (rows.length === 0) {
      return res.status(200).json({ week, title: null, body: '', exists: false });
    }
    const { title, body } = splitWeekSummary(rows[0].note_text);
    return res.status(200).json({ week, title, body, exists: true });
  } catch (e) {
    console.error('[week-report] error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
