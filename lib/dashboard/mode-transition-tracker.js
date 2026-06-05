// lib/dashboard/mode-transition-tracker.js
// v5.1 Step 8 — Mode transition + simultaneous active modes metrics.
//
// Source: v51_dashboard_errata.md §3.1 metric_1 + metric_2.
//
// metric_1: mode_transition_rate
//   target: healthy 2-5 / vulnerable 3-7 transitions per session.
//   alert:  < 1 持續 3 sessions (under-driven) OR > 8 持續 3 sessions (thrash).
//
// metric_2: simultaneous_active_modes_mean
//   target: 1.5-2.5 mean len(active_modes) per turn.
//   alert:  persistent > 3 → HITL.
//
// Data sources:
//   - session_state.mode_transition_log (Step 4 mode-transition-logger writes per turn).
//   - user_profile_evolution.mode_history (PR-23s4c+ writes on session close).
//
// Pure-function module — no DB I/O. Caller aggregates per-cohort.

// ── Thresholds ────────────────────────────────────────────

export const METRIC_1_TARGETS = Object.freeze({
  healthy:    { min: 2, max: 5 },
  vulnerable: { min: 3, max: 7 },
});

export const METRIC_1_ALERTS = Object.freeze({
  under_driven_threshold: 1,    // < 1 持續 3 sessions → alert
  thrash_threshold:       8,    // > 8 持續 3 sessions → alert
  persistence_sessions:   3,
});

export const METRIC_2_TARGET = Object.freeze({ min: 1.5, max: 2.5 });
export const METRIC_2_ALERT = Object.freeze({
  persistent_max:    3,
  persistence_turns: 5,         // > 3 mode active 持 5+ turns → HITL
});

// ── metric_1: mode transition rate ────────────────────────

/**
 * Count mode transitions in a single session from its log.
 *
 * @param {Array<object>} modeTransitionLog — entries with {from_primary, to_primary, trigger_type, ...}
 * @returns {number} count of distinct mode changes (primary_mode delta)
 */
export function countTransitionsThisSession(modeTransitionLog) {
  if (!Array.isArray(modeTransitionLog)) return 0;
  return modeTransitionLog.filter(e => e && e.from_primary !== e.to_primary).length;
}

/**
 * metric_1 — mean transitions per session across a cohort.
 *
 * @param {Array<Array<object>>} perSessionLogs — outer: sessions, inner: log entries
 * @returns {number} mean (0 when empty)
 */
export function meanTransitionsPerSession(perSessionLogs) {
  if (!Array.isArray(perSessionLogs) || perSessionLogs.length === 0) return 0;
  const counts = perSessionLogs.map(countTransitionsThisSession);
  const total = counts.reduce((a, b) => a + b, 0);
  return total / counts.length;
}

/**
 * Classify metric_1 result against cohort target.
 *
 * @param {number} mean
 * @param {string} cohort — 'healthy' | 'vulnerable'
 * @returns {{status: 'on_target'|'below_target'|'above_target', target: {min,max}}}
 */
export function classifyMetric1(mean, cohort = 'healthy') {
  const t = METRIC_1_TARGETS[cohort] || METRIC_1_TARGETS.healthy;
  if (mean < t.min) return { status: 'below_target', target: t };
  if (mean > t.max) return { status: 'above_target', target: t };
  return { status: 'on_target', target: t };
}

/**
 * Sliding-window alert detection (errata §3.1):
 *   < 1 OR > 8 持續 3 sessions.
 *
 * @param {number[]} recentSessionCounts — N most recent session counts (chronological)
 * @returns {{alert_type: 'under_driven'|'thrash'|null, sessions: number}}
 */
export function detectMetric1Alert(recentSessionCounts) {
  if (!Array.isArray(recentSessionCounts)) return { alert_type: null, sessions: 0 };
  const N = METRIC_1_ALERTS.persistence_sessions;
  if (recentSessionCounts.length < N) return { alert_type: null, sessions: recentSessionCounts.length };
  const window = recentSessionCounts.slice(-N);
  if (window.every(c => c < METRIC_1_ALERTS.under_driven_threshold)) {
    return { alert_type: 'under_driven', sessions: N };
  }
  if (window.every(c => c > METRIC_1_ALERTS.thrash_threshold)) {
    return { alert_type: 'thrash', sessions: N };
  }
  return { alert_type: null, sessions: N };
}

// ── metric_2: simultaneous active modes mean ──────────────

/**
 * Mean len(active_modes) per turn across a session.
 *
 * @param {Array<{active_modes: string[]}>} perTurnSnapshots — snapshots of state at each turn
 * @returns {number} mean
 */
export function meanSimultaneousActiveModes(perTurnSnapshots) {
  if (!Array.isArray(perTurnSnapshots) || perTurnSnapshots.length === 0) return 0;
  const lens = perTurnSnapshots
    .map(s => Array.isArray(s?.active_modes) ? s.active_modes.length : 0);
  const total = lens.reduce((a, b) => a + b, 0);
  return total / lens.length;
}

export function classifyMetric2(mean) {
  if (mean < METRIC_2_TARGET.min) return { status: 'below_target', target: METRIC_2_TARGET };
  if (mean > METRIC_2_TARGET.max) return { status: 'above_target', target: METRIC_2_TARGET };
  return { status: 'on_target', target: METRIC_2_TARGET };
}

/**
 * Detect persistent > 3 modes for 5+ turns.
 *
 * @param {Array<{active_modes: string[]}>} perTurnSnapshots — chronological
 * @returns {{alert: boolean, longest_streak: number}}
 */
export function detectMetric2Alert(perTurnSnapshots) {
  if (!Array.isArray(perTurnSnapshots)) return { alert: false, longest_streak: 0 };
  let streak = 0;
  let longest = 0;
  for (const s of perTurnSnapshots) {
    if (Array.isArray(s?.active_modes) && s.active_modes.length > METRIC_2_ALERT.persistent_max) {
      streak += 1;
      if (streak > longest) longest = streak;
    } else {
      streak = 0;
    }
  }
  return { alert: longest >= METRIC_2_ALERT.persistence_turns, longest_streak: longest };
}

// ── Aggregator (used by /api/admin/v5-metrics) ────────────

/**
 * Build a full metric_1 + metric_2 report for a single student/cohort.
 *
 * @param {object} args
 * @param {Array<Array<object>>} args.perSessionLogs
 * @param {Array<Array<object>>} args.perTurnSnapshotsPerSession  — flattened per session
 * @param {string} args.cohort — 'healthy' | 'vulnerable'
 * @returns {object}
 */
export function buildModeTransitionReport({ perSessionLogs = [], perTurnSnapshotsPerSession = [], cohort = 'healthy' } = {}) {
  const counts = perSessionLogs.map(countTransitionsThisSession);
  const mean1 = meanTransitionsPerSession(perSessionLogs);
  const flatTurns = perTurnSnapshotsPerSession.flat();
  const mean2 = meanSimultaneousActiveModes(flatTurns);
  return {
    metric_1_mode_transition_rate: {
      mean: mean1,
      per_session_counts: counts,
      classification: classifyMetric1(mean1, cohort),
      alert: detectMetric1Alert(counts),
    },
    metric_2_simultaneous_active_modes_mean: {
      mean: mean2,
      classification: classifyMetric2(mean2),
      alert: detectMetric2Alert(flatTurns),
    },
  };
}
