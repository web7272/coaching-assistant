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
  computeUnlockedCurrentDay,
} from '../lib/api/journey-state.js';
import { computePhaseReportStates } from '../lib/api/phase-state.js';

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
    // PR-4c-4e — pace-aware currentDay resolution.
    //   daily:     currentDay = max(1, session_day_count)
    //   self-paced + last session day_complete=true:  +1 (Day N+1 active-empty same day)
    // Brand-new students (session_day_count=0 or no UPE row): floored to 1 by
    // computeUnlockedCurrentDay — keeps the PR-4c-4b regression invariant.
    const dailyTakeaways = Array.isArray(profile?.daily_takeaways) ? profile.daily_takeaways : [];
    const exportPromptGeneratedAt = profile?.export_prompt_generated_at || null;

    // Fetch pace + last session's day_complete + current_phase (defensively — no row → defaults)
    let pace = 'daily';
    let lastSessionComplete = false;
    let currentPhase = null;
    try {
      const pr = await sql`SELECT pace FROM students WHERE student_id = ${studentId} LIMIT 1`;
      if (pr.length > 0 && pr[0].pace) pace = pr[0].pace;
    } catch (e) { console.warn('[journey] pace lookup failed:', e.message); }
    try {
      // PR-4c-green P4 — also grab session_state.current_phase for phases[] derivation
      const lr = await sql`
        SELECT day_complete, session_state FROM sessions
        WHERE student_id = ${studentId} AND module = ${module}
        ORDER BY created_at DESC LIMIT 1
      `;
      if (lr.length > 0) {
        lastSessionComplete = !!lr[0].day_complete;
        currentPhase = lr[0].session_state?.current_phase || null;
      }
    } catch (e) { console.warn('[journey] last session lookup failed:', e.message); }

    const currentDay = computeUnlockedCurrentDay({
      pace,
      sessionDayCount: profile?.session_day_count || 0,
      lastSessionComplete,
    });

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
      // weeks[] kept in the response for back-compat with anything pre-P4 that
      // still reads it; the v2.1-green frontend ignores it and reads phases[]
      // instead (spec 09 §10: weeks → phases, week reports retired).
      weeks:      computeWeeklyCells({ currentDay, weeksWithSummary }),
      // PR-4c-green P4: 5 Phase Report states (locked/unlocked) for the
      // treasure shelf. Spec 09 §5.5 + §10.
      phases:     computePhaseReportStates(currentPhase),
      graduation: computeGraduationCell({ currentDay, exportPromptGeneratedAt }),
    });
  } catch (e) {
    console.error('[journey] error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
