// lib/util/coach-filter.js
// Patrick 6/3 — 教練後台學員清單 filter decision (pure).
//
// 6 群組:
//   all       — 全部
//   beta      — 封測者: is_beta=true
//   blocked   — 已停用: is_blocked=true
//   active    — 進行中: !is_blocked AND days_completed >= 1 AND effective_day < 21
//                       (至少完成 Day 1, 還在跑; Vivi 6/3 修正: 不再排除 beta,
//                        因為 beta phase 內全是 beta、原 `!beta && !blocked` 永遠 0).
//                        「點了 Day 1 但沒完成」(days_completed=0) 排除掉.
//   finished  — 已完成 Day 21: effective_day >= 21
//   at_risk   — 14+ 天沒動: days_since_last_active >= 14 (且還在跑 = 沒 blocked、沒完成)
//
// 純函式抽到 lib 方便 unit-test boundary 行為.
// coach.js 內聯同份 + 由 lib/util/coach-filter.test.js 鎖.

export const COACH_FILTERS = Object.freeze([
  'all', 'beta', 'blocked', 'active', 'finished', 'at_risk',
]);

const DAY_MS = 24 * 60 * 60 * 1000;
const AT_RISK_DAYS = 14;
const FINISHED_DAY = 21;

/**
 * 該 student 是否符合 filter.
 *
 * Defensive: 不對的 filter → true (no-op, 等同 'all'); 缺欄位 → 視為 false 該欄位.
 *
 * @param {object} s        — 學員 row, 含 is_beta / is_blocked / effective_day /
 *                            last_active (ISO string or null).
 * @param {string} filter   — one of COACH_FILTERS.
 * @param {Date|number} [now]  — defaults to Date.now() for testability.
 * @returns {boolean}
 */
export function matchesCoachFilter(s, filter, now) {
  if (!s || typeof s !== 'object') return false;
  if (!filter || filter === 'all') return true;

  const beta    = s.is_beta    === true;
  const blocked = s.is_blocked === true;
  const day     = Number.isFinite(s.effective_day) ? s.effective_day
                : Number.isFinite(s.current_day)   ? s.current_day
                : 0;

  const daysDone = Number.isFinite(s.days_completed) ? s.days_completed : 0;

  switch (filter) {
    case 'beta':     return beta;
    case 'blocked':  return blocked;
    case 'active':   return !blocked && daysDone >= 1 && day < FINISHED_DAY;
    case 'finished': return day >= FINISHED_DAY;
    case 'at_risk': {
      // 14+ 天沒動, 且還在跑 (沒被 block, 沒完成 Day 21).
      if (blocked || day >= FINISHED_DAY) return false;
      if (!s.last_active) return false;     // 沒登入過不算 at_risk (該由 30 天 window 處理).
      const lastMs = new Date(s.last_active).getTime();
      if (!Number.isFinite(lastMs)) return false;
      const nowMs = now instanceof Date ? now.getTime()
                  : Number.isFinite(now) ? now
                  : Date.now();
      return (nowMs - lastMs) >= AT_RISK_DAYS * DAY_MS;
    }
    default:
      // 未知 filter → 不擋 (caller bug 不該讓 UI 變空白).
      return true;
  }
}

/**
 * Filter a list of students.
 *
 * @param {Array<object>} students
 * @param {string} filter
 * @param {Date|number} [now]
 * @returns {Array<object>}
 */
export function applyCoachFilter(students, filter, now) {
  if (!Array.isArray(students)) return [];
  if (!filter || filter === 'all') return students.slice();
  return students.filter(s => matchesCoachFilter(s, filter, now));
}

// ── 6/18 Vivi — cohort tab (與上面 op filter 正交 2D) ──────────────
//   all / beta / day1_trial(plan=trial) / first_paid(plan_a|plan_b 且非封測).
//   封測者雖領 plan_a 但免費 → 不算 first_paid。
export const COACH_COHORTS = Object.freeze(['all', 'beta', 'day1_trial', 'first_paid']);

export function matchesCoachCohort(s, cohort) {
  if (!s || typeof s !== 'object') return false;
  if (!cohort || cohort === 'all') return true;
  const beta = s.is_beta === true;
  const plan = typeof s.plan === 'string' ? s.plan : '';
  switch (cohort) {
    case 'beta':       return beta;
    case 'day1_trial': return plan === 'trial';
    case 'first_paid': return (plan === 'plan_a' || plan === 'plan_b') && !beta;
    default:           return true;
  }
}
