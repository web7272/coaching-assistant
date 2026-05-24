// lib/api/journey-state.js
// Pure cell-state rules for GET /api/journey — per docs/v5-spec/engineering/07-pr4c §3-C.
//
// Why a separate module: the state rules are testable independent of DB I/O.
// api/journey.js fetches (sessions / user_profile_evolution / damon_notes),
// then calls these helpers to project the data into the response shape.

/**
 * @typedef {object} DailyCellState
 * @property {number} day                      1..21
 * @property {'future'|'active-empty'|'active-filled'|'revealed'} state
 * @property {string|null} phrase              short takeaway phrase (only when filled / revealed)
 *
 * @typedef {object} GraduationCellState
 * @property {'future'|'active'|'revealed'} state
 *
 * (WeeklyCellState retired — PR-4c-green 5/24 cleanup. 5 phase reports
 *  replace the 3-bucket week structure on the journey screen.)
 */

/**
 * Compute the 21 daily cell states.
 *
 * Rule (07 §3-C):
 *   day  < currentDay              → revealed     (短句來自 takeaways[day])
 *   day === currentDay AND closed  → active-filled (短句來自 takeaways[day])
 *   day === currentDay AND !closed → active-empty
 *   day  > currentDay              → future
 *
 * "Closed today" is signalled by daily_takeaways containing an entry for currentDay
 * (because takeaways are only appended after finalize-day runs).
 *
 * @param {object} args
 * @param {number} args.currentDay          1..21. Pure-function contract supports 0 →
 *   defensive "all 21 cells future" (no session_day_count yet). Callers wanting brand-new
 *   students to see Day 1 active (UX choice) should floor to >=1 BEFORE calling — that's
 *   what api/journey.js does (Math.max(1, profile?.session_day_count || 0)).
 *   This function stays pure & literal so it composes both ways.
 * @param {Array<{day:number,term:string}>} [args.dailyTakeaways=[]]
 * @returns {DailyCellState[]}
 */
export function computeDailyCells({ currentDay, dailyTakeaways = [] } = {}) {
  const byDay = new Map();
  for (const t of Array.isArray(dailyTakeaways) ? dailyTakeaways : []) {
    if (t && typeof t.day === 'number' && typeof t.term === 'string') {
      byDay.set(t.day, t.term);
    }
  }
  const cd = Number.isFinite(currentDay) && currentDay >= 1 ? currentDay : 0;

  const cells = [];
  for (let day = 1; day <= 21; day++) {
    if (day < cd) {
      cells.push({ day, state: 'revealed', phrase: byDay.get(day) ?? null });
    } else if (day === cd) {
      const hasTakeaway = byDay.has(day);
      cells.push({
        day,
        state: hasTakeaway ? 'active-filled' : 'active-empty',
        phrase: hasTakeaway ? byDay.get(day) : null,
      });
    } else {
      cells.push({ day, state: 'future', phrase: null });
    }
  }
  return cells;
}

/**
 * Compute the graduation cell state.
 *
 * Rule (07 §3-C):
 *   export_prompt_generated_at != null            → revealed
 *   currentDay === 21 (Day 21 in progress)        → active
 *   otherwise                                     → future
 *
 * @param {object} args
 * @param {number} args.currentDay
 * @param {string|Date|null} [args.exportPromptGeneratedAt]
 * @returns {GraduationCellState}
 */
export function computeGraduationCell({ currentDay, exportPromptGeneratedAt = null } = {}) {
  if (exportPromptGeneratedAt) return { state: 'revealed' };
  if (currentDay === 21) return { state: 'active' };
  return { state: 'future' };
}

/**
 * Module label override (PR-4c 硬傷 1：移除「金錢事業」標籤、Day 1-21 全用「看見自己」).
 * Backend `module` 仍是 'self'；frontend display 一律「看見自己」.
 */
export const MODULE_LABEL = '看見自己';

/**
 * PR-4c-4e — Resolve the "effective" currentDay the journey grid should show,
 * accounting for the student's pace setting.
 *
 *   daily (default): currentDay = max(1, sessionDayCount).
 *                    Day N+1 unlocks only when the calendar day rolls over
 *                    (chat.js incrementUserProfileCounters on isNewDay=true).
 *
 *   self-paced:      same as daily, PLUS — if the most-recent session is
 *                    day_complete=TRUE and sessionDayCount < 21, advance the
 *                    effective currentDay by 1 so the next cell becomes
 *                    active-empty (clickable into a fresh Day N+1 conversation
 *                    same calendar day).
 *
 * Pure — no I/O. Caller fetches the inputs (pace + sessionDayCount + lastSessionComplete)
 * and projects through this helper.
 *
 * @param {object} args
 * @param {'daily'|'self-paced'} [args.pace='daily']
 * @param {number} [args.sessionDayCount=0]
 * @param {boolean} [args.lastSessionComplete=false]
 * @returns {number}  1..21
 */
export function computeUnlockedCurrentDay({ pace = 'daily', sessionDayCount = 0, lastSessionComplete = false } = {}) {
  const floored = Math.max(1, Math.min(21, sessionDayCount || 0));
  if (pace === 'self-paced' && lastSessionComplete && floored < 21) {
    return floored + 1;
  }
  return floored;
}
