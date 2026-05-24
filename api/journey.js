// api/journey.js
// GET /api/journey?studentId=A001&module=self
// Per docs/v5-spec/engineering/07-pr4c-ui-integration-and-data-contract.md §3-C
// (with PR-4c-green updates — weeks[] retired, phases[] added — spec 09 §10)
//
// Response shape (strict, do not extend without ping):
//   {
//     module, moduleLabel, currentDay,
//     days:       [{ day, state, phrase }],   // 21 cells
//     phases:     [{ phase, state }],         // 5 phase reports (treasure shelf)
//     graduation: { state }
//   }

import { neon } from '@neondatabase/serverless';
import { getUserProfile } from '../lib/state/state-manager.js';
import {
  computeDailyCells, computeGraduationCell, MODULE_LABEL,
  computeUnlockedCurrentDay,
} from '../lib/api/journey-state.js';
import { computePhaseReportStates } from '../lib/api/phase-state.js';
// PR-4c-green Auth rebuild stage 1d — studentId now comes from the verified
// student_session cookie, NEVER from client-supplied query. Client-passed
// `?studentId=A999` is ignored entirely.
import { guardStudentOr401 } from '../lib/auth/student-session.js';

export const maxDuration = 10;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  // 鐵則: sid always from session, never from req.query. 401 if no valid session.
  const studentId = await guardStudentOr401(req, res);
  if (!studentId) return;
  const module    = String(req.query?.module || 'self').trim();

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

    // PR-4c-green 5/24 cleanup — 週報 + weeks[] field retired. Spec 09 §10:
    // 5 phase reports 取代週報。weeksWithSummary lookup + weeks[] payload field
    // both removed; nothing live reads either. The is_week_summary column on
    // damon_notes stays (composite UNIQUE key still in use for daily rows).
    return res.status(200).json({
      module,
      moduleLabel: MODULE_LABEL,                                  // 硬傷 1: 一律「看見自己」
      currentDay,
      days:       computeDailyCells({ currentDay, dailyTakeaways }),
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
