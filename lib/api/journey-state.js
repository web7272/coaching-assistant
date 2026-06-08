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
 *                    PLUS — 5/27 Patrick (封測 bug 根因 ②): if the most-recent
 *                    session is day_complete=TRUE AND gapDaysSinceLastSession >= 1
 *                    (台北日界、隔日才算)、advance by 1 so journey unlocks Day N+1
 *                    even before chat.js incrementUserProfileCounters bumps
 *                    session_day_count (that bump happens INSIDE chat.js — but
 *                    journey is what lets the student click into chat in the
 *                    first place).
 *                    同日不解 (gapDays=0)、隔日解 (gapDays>=1) — daily 步調本意.
 *
 *   self-paced:      same as daily, PLUS — if the most-recent session is
 *                    day_complete=TRUE and sessionDayCount < 21, advance the
 *                    effective currentDay by 1 so the next cell becomes
 *                    active-empty (clickable into a fresh Day N+1 conversation
 *                    same calendar day). No gapDays gate — self-paced 同日連走 OK.
 *
 *   ⭐ 6/8 Vivi (A006 bug): if there's an in-progress session on Day D (most-
 *     recent session row, day_complete=FALSE, sessions.day=D), then Day D is
 *     ALWAYS unlocked, regardless of pace / sessionDayCount / complete-advance
 *     paths above. The learner already entered that day — they must be able
 *     to re-enter and resume.
 *     Repro: self-paced 學員點開某天但沒講話 → 空殼 session, lastSessionComplete=
 *     FALSE → 既有 self-paced/daily +1 paths 兩個都不觸發 → return floored
 *     (= 落後的 sessionDayCount) → 已經點開的那天反而被鎖.
 *     Fix: Math.max(result, inProgressDay). 不會 over-unlock (only takes the
 *     bigger of computed-unlock vs in-progress-day; bounded to ≤ 21).
 *
 * Pure — no I/O. Caller fetches inputs (pace + sessionDayCount + lastSessionComplete
 * + gapDaysSinceLastSession + inProgressDay) and projects through this helper.
 *
 * @param {object} args
 * @param {'daily'|'self-paced'} [args.pace='daily']
 * @param {number} [args.sessionDayCount=0]
 * @param {boolean} [args.lastSessionComplete=false]
 * @param {number} [args.gapDaysSinceLastSession=0]  台北日界 gap, daily 解鎖閘
 * @param {number} [args.inProgressDay=0]  最後 session 若未完成則為其 day, 否則 0
 * @returns {number}  1..21
 */
export function computeUnlockedCurrentDay({
  pace = 'daily', sessionDayCount = 0, lastSessionComplete = false,
  gapDaysSinceLastSession = 0, inProgressDay = 0,
} = {}) {
  const floored = Math.max(1, Math.min(21, sessionDayCount || 0));
  let result = floored;
  // self-paced: 走完即可立刻 +1（同日連走）.
  if (pace === 'self-paced' && lastSessionComplete && floored < 21) {
    result = floored + 1;
  }
  // daily: 走完 + 已隔台北日 → +1, journey 自己解鎖 Day N+1. 進 chat 後
  // chat.js 的 isNewDay 偵測會把 session_day_count 正式 bump.
  else if (pace === 'daily' && lastSessionComplete
      && gapDaysSinceLastSession >= 1 && floored < 21) {
    result = floored + 1;
  }
  // ⭐ 6/8 放行:有 in-progress 次日 session → 那天一定解鎖.
  //   Math.max 不會降低原本算出的解鎖日; 只在 in-progress 那天較大時放行.
  //   Bounds: inProgressDay 已 clamp 到 [0, 21], 不會 over-unlock 超過 Day 21.
  const ip = Math.max(0, Math.min(21, Number.isFinite(inProgressDay) ? inProgressDay : 0));
  return Math.max(result, ip);
}
