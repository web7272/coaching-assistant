// api/graduation.js
// GET /api/graduation?studentId=A001&module=self
// Per docs/v5-spec/engineering/07-pr4c §3-F.
//
// Response shape:
//   {
//     coachLetter, poem21, declaration,
//     exportedToEmail, exists
//   }
// Reads:
//   user_profile_evolution.last_session_day_summary.graduation = { coach_letter, declaration }
//   user_profile_evolution.daily_takeaways                     → poem21 (sorted ASC by day)
//   user_profile_evolution.export_prompt_generated_at          → exportedToEmail

import { getUserProfile } from '../lib/state/state-manager.js';
// PR-4c-green Auth rebuild stage 1d — auto-detect: coach session → query
// studentId (coach reviews any student); else student session → sid from cookie
// (client-supplied studentId in query ignored).
import { assertCoachSession } from '../lib/auth/coach-session.js';
import { guardStudentOr401 } from '../lib/auth/student-session.js';

export const maxDuration = 10;

/**
 * Project the 21 daily_takeaways into the poem21 string array.
 * Sorted ASC by day. Missing days = '' placeholder (so the array is always length-21
 * for the frontend, even if some days have no captured term).
 *
 * Pure helper exported for testing.
 *
 * @param {Array<{day:number,term:string}>} dailyTakeaways
 * @returns {string[]}
 */
export function projectPoem21(dailyTakeaways) {
  const byDay = new Map();
  for (const t of Array.isArray(dailyTakeaways) ? dailyTakeaways : []) {
    if (t && typeof t.day === 'number' && typeof t.term === 'string') {
      byDay.set(t.day, t.term);
    }
  }
  const out = [];
  for (let d = 1; d <= 21; d++) out.push(byDay.get(d) ?? '');
  return out;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // Resolve studentId: coach session → trust query (coach reviews any student);
  // else require a student session and use sid from cookie. A student WITHOUT
  // a coach session cannot read another student's graduation by passing
  // ?studentId=A999 in the query — that branch routes to the cookie-only path.
  let studentId;
  if (await assertCoachSession(req)) {
    studentId = String(req.query?.studentId || '').trim();
    if (!studentId) return res.status(400).json({ error: 'Missing required query: studentId' });
  } else {
    studentId = await guardStudentOr401(req, res);
    if (!studentId) return;
  }

  try {
    const profile = await getUserProfile(studentId);
    if (!profile) {
      return res.status(200).json({
        coachLetter: null, poem21: projectPoem21([]),
        declaration: null, exportedToEmail: false, exists: false,
      });
    }
    const grad = profile.last_session_day_summary?.graduation || null;
    const coachLetter = grad?.coach_letter || null;
    const declaration = grad?.declaration  || null;
    const poem21      = projectPoem21(profile.daily_takeaways);
    const exportedToEmail = !!profile.export_prompt_generated_at;
    const exists      = !!(coachLetter || declaration || exportedToEmail);

    return res.status(200).json({
      coachLetter, poem21, declaration, exportedToEmail, exists,
    });
  } catch (e) {
    console.error('[graduation] error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
