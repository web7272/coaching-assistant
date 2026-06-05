// lib/dashboard/reframe-invocation-tracker.js
// v5.1 Step 8 — Reframe invocation rate + per-reframe success rate.
//
// Source: v51_dashboard_errata.md §3.2 metric_4 + metric_5.
//
// metric_4: reframe_invocation_rate
//   target: 10-25% of turns invoke some reframe.
//   alert:  < 5% persistent (under-used library) / > 35% persistent (toxic positivity).
//
// metric_5: per_reframe_success_rate (errata §3.2 targets verbatim):
//   R1 > 40% (multi-turn) / R2 > 60% / R3 > 50% / R4 > 70% /
//   R5 > 70% / R6 > 50% / R7 > 60%.
//   R8 / R12 — monitor only (errata: no target band, just invocation tracking).
//
// Data source: user_profile_evolution.reframe_invocation_history (migration 027)
//              + Step 7 invocation-tracker session-level entries.

// ── Targets (errata §3.2 verbatim) ────────────────────────

export const METRIC_4_TARGET = Object.freeze({ min: 0.10, max: 0.25 });
export const METRIC_4_ALERT = Object.freeze({
  under_threshold: 0.05,
  over_threshold:  0.35,
});

export const REFRAME_SUCCESS_TARGETS = Object.freeze({
  R1: 0.40,
  R2: 0.60,
  R3: 0.50,
  R4: 0.70,
  R5: 0.70,
  R6: 0.50,
  R7: 0.60,
  // R8 / R12 — monitor only (errata §3.2 + Step 7 PR-7b note).
});

export const MONITOR_ONLY_REFRAMES = Object.freeze(['R8', 'R12']);

// ── metric_4 — invocation rate ────────────────────────────

/**
 * Calculate reframe invocation rate across turns.
 *
 * @param {object} args
 * @param {number} args.total_turns
 * @param {number} args.turns_with_any_reframe — how many turns invoked at least one reframe
 * @returns {number} rate in [0, 1]
 */
export function calculateInvocationRate({ total_turns = 0, turns_with_any_reframe = 0 } = {}) {
  if (!Number.isFinite(total_turns) || total_turns <= 0) return 0;
  return Math.max(0, Math.min(1, turns_with_any_reframe / total_turns));
}

export function classifyMetric4(rate) {
  if (rate < METRIC_4_TARGET.min) return { status: 'below_target', target: METRIC_4_TARGET };
  if (rate > METRIC_4_TARGET.max) return { status: 'above_target', target: METRIC_4_TARGET };
  return { status: 'on_target', target: METRIC_4_TARGET };
}

/**
 * Persistent alert: < 5% OR > 35% across N recent sessions.
 *
 * @param {number[]} recentSessionRates — chronological session-level rates
 * @returns {{alert_type: 'under_used'|'over_used'|null, sessions: number}}
 */
export function detectMetric4Alert(recentSessionRates, persistenceSessions = 3) {
  if (!Array.isArray(recentSessionRates)) return { alert_type: null, sessions: 0 };
  if (recentSessionRates.length < persistenceSessions) {
    return { alert_type: null, sessions: recentSessionRates.length };
  }
  const window = recentSessionRates.slice(-persistenceSessions);
  if (window.every(r => r < METRIC_4_ALERT.under_threshold)) {
    return { alert_type: 'under_used', sessions: persistenceSessions };
  }
  if (window.every(r => r > METRIC_4_ALERT.over_threshold)) {
    return { alert_type: 'over_used', sessions: persistenceSessions };
  }
  return { alert_type: null, sessions: persistenceSessions };
}

// ── metric_5 — per-reframe success rate ───────────────────

/**
 * Group reframe_invocation_history entries by reframe_id and compute success rate.
 *
 * An entry counts as success when entry.outcome === 'success'.
 *
 * @param {Array<{reframe_id: string, outcome: string}>} history
 * @returns {Record<string, {invocations: number, successes: number, rate: number}>}
 */
export function computePerReframeStats(history) {
  if (!Array.isArray(history)) return {};
  const stats = {};
  for (const entry of history) {
    if (!entry || typeof entry.reframe_id !== 'string') continue;
    const id = entry.reframe_id;
    if (!stats[id]) stats[id] = { invocations: 0, successes: 0, rate: 0 };
    stats[id].invocations += 1;
    if (entry.outcome === 'success') stats[id].successes += 1;
  }
  // Compute rate.
  for (const id of Object.keys(stats)) {
    stats[id].rate = stats[id].invocations === 0 ? 0 : stats[id].successes / stats[id].invocations;
  }
  return stats;
}

/**
 * Per-reframe classification against errata §3.2 targets.
 * R8/R12 → monitor-only (no status — just expose count).
 *
 * @param {object} stats — output of computePerReframeStats
 * @returns {Record<string, {invocations, successes, rate, target, status}>}
 */
export function classifyMetric5(stats) {
  const out = {};
  for (const id of Object.keys(stats || {})) {
    const s = stats[id];
    const target = REFRAME_SUCCESS_TARGETS[id] ?? null;
    if (MONITOR_ONLY_REFRAMES.includes(id) || target === null) {
      out[id] = { ...s, target: null, status: 'monitor_only' };
      continue;
    }
    out[id] = {
      ...s,
      target,
      status: s.rate >= target ? 'on_target' : 'below_target',
    };
  }
  return out;
}

// ── Aggregator ────────────────────────────────────────────

/**
 * Build a full metric_4 + metric_5 report.
 *
 * @param {object} args
 * @param {Array<{reframe_id, outcome}>} args.invocationHistory — cross-session (migration 027)
 * @param {number} args.total_turns — denominator for invocation rate
 * @param {number[]} args.recentSessionRates — recent session invocation rates (optional, for alert)
 * @returns {object}
 */
export function buildReframeReport({
  invocationHistory = [], total_turns = 0, recentSessionRates = [],
} = {}) {
  // For metric_4, count distinct turns with at least one invocation.
  const distinctTurns = new Set();
  for (const e of invocationHistory) {
    if (typeof e?.invoked_at_turn === 'number' && typeof e?.session_id !== 'undefined') {
      distinctTurns.add(`${e.session_id}:${e.invoked_at_turn}`);
    }
  }
  const rate = calculateInvocationRate({
    total_turns,
    turns_with_any_reframe: distinctTurns.size,
  });
  const stats = computePerReframeStats(invocationHistory);
  return {
    metric_4_reframe_invocation_rate: {
      rate,
      total_turns,
      turns_with_any_reframe: distinctTurns.size,
      classification: classifyMetric4(rate),
      alert: detectMetric4Alert(recentSessionRates),
    },
    metric_5_per_reframe_success_rate: classifyMetric5(stats),
  };
}
