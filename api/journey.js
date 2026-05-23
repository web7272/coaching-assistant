// api/journey.js
// GET /api/journey?studentId=A001&module=self
// Per docs/v5-spec/engineering/07-pr4c-ui-integration-and-data-contract.md §3-C
//
// Response shape (strict, do not extend without ping):
//   {
//     module, moduleLabel, currentDay,
//     days:  [{ day, state, phrase }],
//     weeks: [{ week, state }],
//     graduation: { state }
//   }

import { neon } from '@neondatabase/serverless';
import { getUserProfile } from '../lib/state/state-manager.js';
import {
  computeDailyCells, computeWeeklyCells, computeGraduationCell, MODULE_LABEL,
} from '../lib/api/journey-state.js';

export const maxDuration = 10;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const studentId = String(req.query?.studentId || '').trim();
  const module    = String(req.query?.module    || 'self').trim();
  if (!studentId) return res.status(400).json({ error: 'Missing required query: studentId' });

  try {
    const sql = neon(process.env.DATABASE_URL);

    // user_profile_evolution — currentDay + daily_takeaways + export marker
    let profile = null;
    try { profile = await getUserProfile(studentId); }
    catch (e) { console.warn('[journey] getUserProfile failed:', e.message); }
    const currentDay = profile?.session_day_count || 0;
    const dailyTakeaways = Array.isArray(profile?.daily_takeaways) ? profile.daily_takeaways : [];
    const exportPromptGeneratedAt = profile?.export_prompt_generated_at || null;

    // weeks with summary — read damon_notes is_week_summary=true (collapse to Set)
    let weeksWithSummary = new Set();
    try {
      const rows = await sql`
        SELECT DISTINCT week FROM damon_notes
        WHERE student_id = ${studentId} AND module = ${module} AND is_week_summary = TRUE
      `;
      weeksWithSummary = new Set(rows.map(r => r.week));
    } catch (e) {
      console.warn('[journey] weeksWithSummary lookup failed:', e.message);
    }

    return res.status(200).json({
      module,
      moduleLabel: MODULE_LABEL,                                  // 硬傷 1: 一律「看見自己」
      currentDay,
      days:       computeDailyCells({ currentDay, dailyTakeaways }),
      weeks:      computeWeeklyCells({ currentDay, weeksWithSummary }),
      graduation: computeGraduationCell({ currentDay, exportPromptGeneratedAt }),
    });
  } catch (e) {
    console.error('[journey] error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
