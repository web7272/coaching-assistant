// lib/dashboard/active-context-tracker.js
// v5.2 第五塊 — active_context dashboard tracker.
//
// 來源: v52_context_anchored_spec §6.1 (active_context_distribution + per-context
//       completion) + spec §4.2 (case 3 連續 swap → escalate Vivi、wired in
//       chat.js + alert-rules).
//
// Pure-function tracker (照 lib/dashboard/visual-channel-tracker.js +
// passive-death-wish-tracker.js pattern, 無 DB I/O). caller (v5-metrics
// endpoint) feeds in students rows from a single students SELECT and we slice.
//
// 3 metrics:
//   1. active_context_distribution     — 5 category 學員分布 (group by)
//   2. per_context_completion          — 各 category 平均 day + 完成數
//   3. onboarded_rate                  — context_onboarded TRUE/FALSE 比
//
// 鐵律 #2: tracker 只看 enum / count / day number — 無 raw 學員文字.

// ─────────────────────────────────────────────────────────
// Category enum (verbatim from migration 029 + spec §1.3)
// ─────────────────────────────────────────────────────────

export const CATEGORY_CODES = Object.freeze([1, 2, 3, 4, 5]);

export const CATEGORY_LABELS = Object.freeze({
  1: '事業 / 工作 / 金錢',
  2: '親密關係 (伴侶 / 戀愛)',
  3: '家庭 (原生家庭 / 子女)',
  4: '健康 / 身體',
  5: '自我 / 內在狀態 / 心理',
});

export const CATEGORY_SHORT_LABELS = Object.freeze({
  1: '事業', 2: '親密', 3: '家庭', 4: '健康', 5: '自我',
});

// ─────────────────────────────────────────────────────────
// Program length (21 天) — matches sessions.day = 21 day_complete=TRUE convention
// ─────────────────────────────────────────────────────────

export const PROGRAM_FINAL_DAY = 21;

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

/**
 * Defensive student row read. Returns category int 1-5 or null (filter out).
 */
function readCategory(student) {
  if (!student || typeof student !== 'object') return null;
  const c = Number(student.active_context_category);
  if (!Number.isFinite(c) || c < 1 || c > 5) return null;
  return c;
}

function readCurrentDay(student) {
  const d = Number(student?.current_day);
  if (!Number.isFinite(d) || d < 0) return 0;
  return d;
}

// ─────────────────────────────────────────────────────────
// Metric 1: active_context_distribution
// ─────────────────────────────────────────────────────────

/**
 * Group students by active_context_category. Invalid categories are dropped
 * (logged via the per-category 'unknown' aggregate so dashboard surfaces them).
 *
 * @param {Array<{active_context_category:number}>} students
 * @returns {{
 *   per_category: Record<1|2|3|4|5, {category:number, label:string, short_label:string, count:number}>,
 *   total: number,
 *   unknown_count: number
 * }}
 */
export function aggregateActiveContextDistribution(students) {
  const per_category = {};
  for (const code of CATEGORY_CODES) {
    per_category[code] = {
      category: code,
      label: CATEGORY_LABELS[code],
      short_label: CATEGORY_SHORT_LABELS[code],
      count: 0,
    };
  }
  if (!Array.isArray(students)) {
    return { per_category, total: 0, unknown_count: 0 };
  }
  let total = 0;
  let unknown_count = 0;
  for (const s of students) {
    const cat = readCategory(s);
    if (cat === null) { unknown_count += 1; continue; }
    per_category[cat].count += 1;
    total += 1;
  }
  return { per_category, total, unknown_count };
}

// ─────────────────────────────────────────────────────────
// Metric 2: per_context_completion
// ─────────────────────────────────────────────────────────

/**
 * For each category, compute:
 *   - avg_current_day (mean of students.current_day in that category)
 *   - completed_count (students who reached PROGRAM_FINAL_DAY=21)
 *   - in_progress_count (current_day in [1, 20])
 *   - not_started_count (current_day = 0)
 *   - completion_rate (completed / total in category)
 *
 * @param {Array<{active_context_category:number, current_day:number}>} students
 * @param {object} [opts]
 * @param {number} [opts.finalDay=PROGRAM_FINAL_DAY]
 * @returns {{
 *   per_category: Record<1|2|3|4|5, {
 *     category:number, label:string, short_label:string,
 *     total:number, avg_current_day:number,
 *     completed_count:number, in_progress_count:number, not_started_count:number,
 *     completion_rate:number
 *   }>,
 *   total: number
 * }}
 */
export function computePerContextCompletion(students, { finalDay = PROGRAM_FINAL_DAY } = {}) {
  const per_category = {};
  for (const code of CATEGORY_CODES) {
    per_category[code] = {
      category: code,
      label: CATEGORY_LABELS[code],
      short_label: CATEGORY_SHORT_LABELS[code],
      total: 0,
      avg_current_day: 0,
      completed_count: 0,
      in_progress_count: 0,
      not_started_count: 0,
      completion_rate: 0,
    };
  }
  if (!Array.isArray(students)) return { per_category, total: 0 };
  const sumDayByCategory = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let total = 0;
  for (const s of students) {
    const cat = readCategory(s);
    if (cat === null) continue;
    const day = readCurrentDay(s);
    sumDayByCategory[cat] += day;
    per_category[cat].total += 1;
    total += 1;
    if (day >= finalDay) per_category[cat].completed_count += 1;
    else if (day >= 1)   per_category[cat].in_progress_count += 1;
    else                 per_category[cat].not_started_count += 1;
  }
  for (const code of CATEGORY_CODES) {
    const slot = per_category[code];
    if (slot.total > 0) {
      slot.avg_current_day = sumDayByCategory[code] / slot.total;
      slot.completion_rate = slot.completed_count / slot.total;
    }
  }
  return { per_category, total };
}

// ─────────────────────────────────────────────────────────
// Metric 3: onboarded_rate
// ─────────────────────────────────────────────────────────

/**
 * Onboarding completion ratio (new students). Existing beta students are
 * back-filled context_onboarded=TRUE by migration 031 → they count in
 * `onboarded_count` but were not produced by the onboarding flow itself.
 * Dashboard can filter by is_beta if a "new students only" view is needed.
 *
 * @param {Array<{context_onboarded:boolean}>} students
 * @returns {{onboarded_count:number, not_onboarded_count:number, total:number, rate:number}}
 */
export function computeOnboardedRate(students) {
  if (!Array.isArray(students) || students.length === 0) {
    return { onboarded_count: 0, not_onboarded_count: 0, total: 0, rate: 1 };
  }
  let onboarded_count = 0;
  let not_onboarded_count = 0;
  for (const s of students) {
    if (s && s.context_onboarded === true) onboarded_count += 1;
    else                                    not_onboarded_count += 1;
  }
  const total = students.length;
  const rate = total === 0 ? 1 : onboarded_count / total;
  return { onboarded_count, not_onboarded_count, total, rate };
}

// ─────────────────────────────────────────────────────────
// Master builder (called by v5-metrics endpoint)
// ─────────────────────────────────────────────────────────

/**
 * One-shot report builder. Feed in a students-table SELECT result (with
 * active_context_category, current_day, context_onboarded columns).
 *
 * @param {Array<object>} students
 * @param {object} [opts]
 * @returns {{
 *   distribution: ReturnType<typeof aggregateActiveContextDistribution>,
 *   completion:   ReturnType<typeof computePerContextCompletion>,
 *   onboarded:    ReturnType<typeof computeOnboardedRate>
 * }}
 */
export function buildActiveContextReport(students, opts = {}) {
  return {
    distribution: aggregateActiveContextDistribution(students),
    completion:   computePerContextCompletion(students, opts),
    onboarded:    computeOnboardedRate(students),
  };
}

// ─────────────────────────────────────────────────────────
// Per-student swap classification (consumed by v5-metrics + alert-rules)
// ─────────────────────────────────────────────────────────

export const SWAP_ESCALATE_CONSECUTIVE_TURNS = 3;

export const SWAP_LEVELS = Object.freeze({
  HEALTHY:  'healthy',
  WATCHING: 'watching',       // 1-2 consecutive — within tolerance
  ESCALATE: 'escalate_vivi',  // >= SWAP_ESCALATE_CONSECUTIVE_TURNS
});

/**
 * @param {number} consecutiveSwapTurns - session_state.cross_context_swap_count
 * @returns {string} one of SWAP_LEVELS
 */
export function classifySwapLevel(consecutiveSwapTurns) {
  const n = Number(consecutiveSwapTurns);
  if (!Number.isFinite(n) || n <= 0) return SWAP_LEVELS.HEALTHY;
  if (n >= SWAP_ESCALATE_CONSECUTIVE_TURNS) return SWAP_LEVELS.ESCALATE;
  return SWAP_LEVELS.WATCHING;
}

// ─────────────────────────────────────────────────────────
// metric metadata (for dashboard registration)
// ─────────────────────────────────────────────────────────

export const METRIC_METADATA = Object.freeze({
  id: 'active_context',
  description: 'v5.2 第五塊 — active_context 分布 + per-category completion + onboarded rate + case 3 swap escalate',
  metrics: {
    active_context_distribution: {
      formula: 'GROUP BY students.active_context_category',
      target: '揭露偏斜 (例: > 80% 都在一個 category → product 信號)',
    },
    per_context_completion: {
      formula: 'per category: AVG(current_day), COUNT(current_day >= 21)',
      target: 'completion_rate 各 category 接近 (差距 > 30 個百分點 → 揭露 product 不對齊)',
    },
    onboarded_rate: {
      formula: 'COUNT(context_onboarded=TRUE) / COUNT(*)',
      target: '> 90% for active cohort (新學員 onboarding 完成率)',
    },
    cross_context_swap_escalate: {
      formula: 'classifySwapLevel(session_state.cross_context_swap_count)',
      target: 'count >= 3 consecutive → Vivi HITL (context 設錯 / 學員真想換 → 評估後台改)',
    },
  },
  spec_ref: 'v52_context_anchored_spec §6.1 (distribution + completion) + §4.2 (case 3 swap escalate)',
});
