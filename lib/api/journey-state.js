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
 * @typedef {object} WeeklyCellState
 * @property {number} week                     1..3
 * @property {'future'|'active'|'revealed'} state
 *
 * @typedef {object} GraduationCellState
 * @property {'future'|'active'|'revealed'} state
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
 * @param {number} args.currentDay          1..21 (= user_profile_evolution.session_day_count;
 *                                                 0 for a brand-new student → all cells future)
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
 * Compute the 3 weekly cell states.
 *
 * Rule (07 §3-C):
 *   weekIsPast AND has week-summary in damon_notes → revealed
 *   week is the active week                        → active
 *   otherwise (future)                             → future
 *
 * @param {object} args
 * @param {number} args.currentDay          1..21 (0 → all weeks future)
 * @param {Set<number>|number[]} [args.weeksWithSummary=[]]  weeks that have is_week_summary row
 * @returns {WeeklyCellState[]}
 */
export function computeWeeklyCells({ currentDay, weeksWithSummary = [] } = {}) {
  const summarySet = weeksWithSummary instanceof Set
    ? weeksWithSummary
    : new Set(Array.isArray(weeksWithSummary) ? weeksWithSummary : []);
  const cd = Number.isFinite(currentDay) && currentDay >= 1 ? currentDay : 0;
  const currentWeek = cd > 0 ? Math.ceil(cd / 7) : 0;

  const cells = [];
  for (let week = 1; week <= 3; week++) {
    const weekEndDay = week * 7;  // 7, 14, 21
    let state;
    if (cd > weekEndDay && summarySet.has(week)) {
      state = 'revealed';
    } else if (week === currentWeek) {
      state = 'active';
    } else {
      state = 'future';
    }
    cells.push({ week, state });
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
