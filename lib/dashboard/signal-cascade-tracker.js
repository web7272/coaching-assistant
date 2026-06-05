// lib/dashboard/signal-cascade-tracker.js
// v5.1 Step 8 — Signal invocation rate + signal→reframe success rate.
//
// Source: v51_dashboard_errata.md §3.4 + Step 5a 7 threshold flags ingestion +
//         Patch 23 H4 (連續 3 次哲學表述 caution) integration.
//
// per_signal_invocation_rate (errata §3.4 targets verbatim):
//   S1 external_locus:          20-50% (vulnerable higher)
//   S2 passive_hope:            vulnerable high, healthy < 5%
//   S3 frequency_illusion:      10-30%
//   S4 conditional_worth:       5-20%
//   S5 negative_generalization: vulnerable high, healthy 5-15%
//   S6 modal_operator:          monitor-only (Step 7 PR-7b, not in errata §3.4)
//
// alert (errata §3.4):
//   S2 healthy cohort > 10%:        regex 過敏感
//   S2 vulnerable cohort < 30%:     regex sensitivity 不足
//
// signal_to_reframe_success_rate:
//   target: > 30%

// ── Targets per signal × cohort (errata §3.4 verbatim) ────

export const PER_SIGNAL_TARGETS = Object.freeze({
  S1: {
    healthy:    { min: 0.20, max: 0.50 },
    vulnerable: { min: 0.30, max: 0.50 },
  },
  S2: {
    healthy:    { max: 0.05 },                  // healthy < 5% expected
    vulnerable: { min: 0.30 },                  // vulnerable >= 30% expected
  },
  S3: {
    healthy:    { min: 0.10, max: 0.30 },
    vulnerable: { min: 0.10, max: 0.30 },
  },
  S4: {
    healthy:    { min: 0.05, max: 0.20 },
    vulnerable: { min: 0.05, max: 0.20 },
  },
  S5: {
    healthy:    { min: 0.05, max: 0.15 },
    vulnerable: { min: 0.15 },                  // vulnerable high — no upper cap target
  },
});

export const S2_DUAL_ALERTS = Object.freeze({
  healthy_oversensitive_threshold:    0.10,   // healthy > 10% → regex too sensitive
  vulnerable_undersensitive_threshold: 0.30,  // vulnerable < 30% → regex undersensitive
});

export const SIGNAL_TO_REFRAME_TARGET = Object.freeze({ min: 0.30 });

export const MONITOR_ONLY_SIGNALS = Object.freeze(['S6']);

// ── Step 5a threshold flag ingestion ─────────────────────

/**
 * The 7 threshold flags Step 5a emits but never had a tracker to consume:
 *   s1_r1_priority_flag, s1_hitl_alert_flag,
 *   s2_e3_evaluate_flag,
 *   s3_r7_priority_flag,
 *   s4_bargain_flag,
 *   s5_integration_deeper_flag, s5_hitl_alert_flag,
 *
 * Step 7 PR-7b also added s6_e3_external_locus_pattern_flag (no S6 metric target,
 * monitor-only — flag is still aggregated as an alert hit).
 */
export const STEP_5A_THRESHOLD_FLAGS = Object.freeze([
  's1_r1_priority_flag',
  's1_hitl_alert_flag',
  's2_e3_evaluate_flag',
  's3_r7_priority_flag',
  's4_bargain_flag',
  's5_integration_deeper_flag',
  's5_hitl_alert_flag',
  's6_e3_external_locus_pattern_flag',
]);

/**
 * Count threshold flag occurrences across a cohort's session_state snapshots.
 *
 * @param {Array<object>} perSessionStates
 * @returns {Record<string, number>}
 */
export function countThresholdFlags(perSessionStates) {
  const out = {};
  for (const flag of STEP_5A_THRESHOLD_FLAGS) out[flag] = 0;
  if (!Array.isArray(perSessionStates)) return out;
  for (const s of perSessionStates) {
    if (!s || typeof s !== 'object') continue;
    for (const flag of STEP_5A_THRESHOLD_FLAGS) {
      if (s[flag] === true) out[flag] += 1;
    }
  }
  return out;
}

// ── per_signal_invocation_rate ────────────────────────────

/**
 * Calculate per-signal detection rate across N sessions for a given cohort.
 *
 * @param {object} args
 * @param {Array<object>} args.perSessionStates — has *_detected booleans per signal
 * @returns {Record<'S1'|'S2'|'S3'|'S4'|'S5'|'S6', number>} rate per signal
 */
export function calculatePerSignalRates({ perSessionStates = [] } = {}) {
  if (perSessionStates.length === 0) {
    return { S1: 0, S2: 0, S3: 0, S4: 0, S5: 0, S6: 0 };
  }
  const total = perSessionStates.length;
  const map = {
    S1: 'external_locus_detected',
    S2: 'passive_hope_detected',
    S3: 'frequency_illusion_detected',
    S4: 'conditional_worth_detected',
    S5: 'negative_generalization_detected',
    S6: 'modal_operator_detected',
  };
  const rates = {};
  for (const [sId, key] of Object.entries(map)) {
    const hits = perSessionStates.filter(s => s && s[key] === true).length;
    rates[sId] = hits / total;
  }
  return rates;
}

/**
 * Classify per-signal rate against errata §3.4 targets.
 *
 * @param {Record<string, number>} rates
 * @param {string} cohort — 'healthy' | 'vulnerable'
 * @returns {Record<string, object>}
 */
export function classifyPerSignal(rates, cohort = 'healthy') {
  const out = {};
  for (const sId of Object.keys(rates || {})) {
    const rate = rates[sId];
    if (MONITOR_ONLY_SIGNALS.includes(sId)) {
      out[sId] = { rate, target: null, status: 'monitor_only' };
      continue;
    }
    const target = PER_SIGNAL_TARGETS[sId]?.[cohort];
    if (!target) {
      out[sId] = { rate, target: null, status: 'no_target_for_cohort' };
      continue;
    }
    let status = 'on_target';
    if (target.min != null && rate < target.min) status = 'below_target';
    if (target.max != null && rate > target.max) status = 'above_target';
    out[sId] = { rate, target, status };
  }
  return out;
}

/**
 * S2 dual alerts (errata §3.4 verbatim):
 *   healthy > 10% → 'regex_oversensitive'
 *   vulnerable < 30% → 'regex_undersensitive'
 *
 * @param {object} args
 * @param {number} args.healthyRate
 * @param {number} args.vulnerableRate
 * @returns {{healthy_alert: string|null, vulnerable_alert: string|null}}
 */
export function s2DualAlerts({ healthyRate, vulnerableRate } = {}) {
  let healthy_alert = null, vulnerable_alert = null;
  if (typeof healthyRate === 'number' && healthyRate > S2_DUAL_ALERTS.healthy_oversensitive_threshold) {
    healthy_alert = 'regex_oversensitive';
  }
  if (typeof vulnerableRate === 'number' && vulnerableRate < S2_DUAL_ALERTS.vulnerable_undersensitive_threshold) {
    vulnerable_alert = 'regex_undersensitive';
  }
  return { healthy_alert, vulnerable_alert };
}

// ── signal_to_reframe_success_rate ───────────────────────

/**
 * Compute signal → reframe success rate (errata §3.4):
 *   count(reframe success after signal triggered) / count(signal triggered).
 *
 * @param {object} args
 * @param {number} args.signals_triggered
 * @param {number} args.reframe_success_after_signal
 * @returns {number}
 */
export function calculateSignalToReframeSuccessRate({
  signals_triggered = 0, reframe_success_after_signal = 0,
} = {}) {
  if (signals_triggered <= 0) return 0;
  return reframe_success_after_signal / signals_triggered;
}

export function classifySignalToReframe(rate) {
  if (rate < SIGNAL_TO_REFRAME_TARGET.min) {
    return { status: 'below_target', target: SIGNAL_TO_REFRAME_TARGET };
  }
  return { status: 'on_target', target: SIGNAL_TO_REFRAME_TARGET };
}

// ── Patch 23 H4 — 連續 3 次哲學表述 caution ───────────────

/**
 * Patch 23 H4 alignment: detect consecutive philosophical-path streak of >= 3.
 * Reads state.passive_dw_philosophical_consecutive_count (set by deep-signal-detector).
 *
 * @param {Array<object>} perSessionStates
 * @returns {{flagged: boolean, longest_streak: number}}
 */
export function patch23H4PhilosophicalCaution(perSessionStates) {
  if (!Array.isArray(perSessionStates)) return { flagged: false, longest_streak: 0 };
  let longest = 0;
  for (const s of perSessionStates) {
    const n = Number(s?.passive_dw_philosophical_consecutive_count || 0);
    if (n > longest) longest = n;
  }
  return { flagged: longest >= 3, longest_streak: longest };
}

// ── Full report ──────────────────────────────────────────

export function buildSignalCascadeReport({
  perSessionStatesHealthy = [],
  perSessionStatesVulnerable = [],
  signals_triggered = 0,
  reframe_success_after_signal = 0,
} = {}) {
  const ratesH = calculatePerSignalRates({ perSessionStates: perSessionStatesHealthy });
  const ratesV = calculatePerSignalRates({ perSessionStates: perSessionStatesVulnerable });
  const cohortRates = {
    healthy: classifyPerSignal(ratesH, 'healthy'),
    vulnerable: classifyPerSignal(ratesV, 'vulnerable'),
  };
  const s2Alerts = s2DualAlerts({ healthyRate: ratesH.S2, vulnerableRate: ratesV.S2 });
  const signalReframeRate = calculateSignalToReframeSuccessRate({
    signals_triggered, reframe_success_after_signal,
  });
  return {
    per_signal_invocation_rate: cohortRates,
    s2_dual_alerts: s2Alerts,
    signal_to_reframe_success_rate: {
      rate: signalReframeRate,
      classification: classifySignalToReframe(signalReframeRate),
    },
    step_5a_threshold_flag_counts_healthy:    countThresholdFlags(perSessionStatesHealthy),
    step_5a_threshold_flag_counts_vulnerable: countThresholdFlags(perSessionStatesVulnerable),
    patch_23_h4_philosophical_caution: patch23H4PhilosophicalCaution(
      [...perSessionStatesHealthy, ...perSessionStatesVulnerable],
    ),
  };
}
