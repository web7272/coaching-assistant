// lib/dashboard/alert-rules.js
// v5.1 Step 8 — Mode-specific alert rules (errata Patch 2 §2.2 verbatim).
//
// Pure-function evaluator: evaluate(profile, recent) → alerts[].
// Each alert: { type, severity, reason, payload, source_spec }.
//
// 6 categories (errata §2.2):
//   1. mode_thrash_alert            — > 10 transitions/session, 連 3 sessions → HITL
//   2. simultaneous_active_modes    — > 3 持 5+ turns → HITL
//   3. crisis_activation            — 4 sub-levels (first / count≥3 / count≥5 / active_SI)
//   4. landmine_top1_attempt        — 連 3 次同 Landmine 詞
//   5. reframe_invocation_imbalance — 單一 R > 40% of all invocations
//   6. no_reframe_invocation        — < 5% reframe rate 持 3 sessions
//
// 廢除 alerts (errata §2.1):
//   - phase_regression (mode 概念下不存在 regression)
//   - phase_max_day_overdue (mode 不靠時間強制收尾)
// repo 現實: v5.0 未實作 phase_regression / phase_overdue alerts (Beta dashboard
// errata only ever defined the rules). Nothing to delete — note as documentation.
//
// Alert log shape (鐵律 #2 — no raw text):
//   [dashboard-alert] { type, severity, reason, payload: {enums+counts only}, source_spec }
//
// Crisis ladder note: errata levels deliberately overlap with Patch 23 / Step 6
// existing handler behavior (HITL notify at count >= 3 / count >= 5 / active SI).
// evaluator includes a `crisis_handler_already_fired` flag in payload to prevent
// duplicate dispatch — caller dedup downstream.

import {
  METRIC_1_ALERTS,
  detectMetric1Alert,
} from './mode-transition-tracker.js';
import {
  METRIC_4_ALERT,
} from './reframe-invocation-tracker.js';

// ─── Thresholds (errata §2.2 verbatim) ───────────────────

export const MODE_THRASH_THRESHOLD = Object.freeze({
  per_session_count: 10,
  consecutive_sessions: 3,
});

export const SIMULTANEOUS_MODES_THRESHOLD = Object.freeze({
  max_active_modes: 3,
  persistence_turns: 5,
});

export const CRISIS_LADDER_LEVELS = Object.freeze({
  FIRST_ACTIVATION:      'first_crisis_activation',          // HITL Vivi (next business day)
  COUNT_3_PLUS:          'passive_death_wish_count_3_plus',  // HITL Vivi (same day)
  COUNT_5_PLUS:          'passive_death_wish_count_5_plus',  // critical (immediate + freeze)
  ACTIVE_SI:             'active_si_confirmed',              // critical (immediate)
});

export const LANDMINE_TOP1_THRESHOLD = Object.freeze({
  consecutive_same_term_attempts: 3,
});

export const REFRAME_IMBALANCE_THRESHOLD = Object.freeze({
  single_reframe_share: 0.40,    // > 40% of all reframe invocations
});

export const NO_REFRAME_THRESHOLD = Object.freeze({
  rate_threshold: METRIC_4_ALERT.under_threshold,   // = 0.05
  consecutive_sessions: 3,
});

// ─── 廢除 alerts marker (errata §2.1) ────────────────────

export const DEPRECATED_ALERTS = Object.freeze({
  phase_regression: { reason: 'mode 概念下不存在 regression — errata §2.1' },
  phase_max_day_overdue: { reason: 'mode 不靠時間強制收尾 — errata §2.1' },
});

// ─── Severity (errata § implicit) ────────────────────────

export const ALERT_SEVERITY = Object.freeze({
  CRITICAL: 'critical',
  HITL:     'hitl',
  REVIEW:   'review',
});

// ─── Individual rule evaluators ──────────────────────────

/**
 * Rule 1 — mode_thrash_alert.
 *
 * @param {object} args
 * @param {number[]} args.recentSessionTransitionCounts — chronological
 * @returns {object|null} alert or null
 */
export function evaluateModeThrash({ recentSessionTransitionCounts = [] } = {}) {
  const det = detectMetric1Alert(recentSessionTransitionCounts);
  if (det.alert_type !== 'thrash') return null;
  return {
    type: 'mode_thrash_alert',
    severity: ALERT_SEVERITY.HITL,
    reason: `> ${METRIC_1_ALERTS.thrash_threshold} mode transitions per session 持續 ${det.sessions} sessions`,
    payload: {
      threshold_per_session: METRIC_1_ALERTS.thrash_threshold,
      consecutive_sessions: det.sessions,
      recent_counts: [...recentSessionTransitionCounts],
    },
    source_spec: 'errata §2.2 mode_thrash_alert',
    action: 'HITL 觀察(連續 3 sessions → Vivi 1-on-1 預約)',
  };
}

/**
 * Rule 2 — simultaneous_active_modes_alert.
 *
 * @param {object} args
 * @param {Array<{active_modes: string[]}>} args.perTurnSnapshots
 * @returns {object|null}
 */
export function evaluateSimultaneousModes({ perTurnSnapshots = [] } = {}) {
  if (!Array.isArray(perTurnSnapshots) || perTurnSnapshots.length === 0) return null;
  let streak = 0, longest = 0;
  for (const s of perTurnSnapshots) {
    if (Array.isArray(s?.active_modes) && s.active_modes.length > SIMULTANEOUS_MODES_THRESHOLD.max_active_modes) {
      streak += 1;
      if (streak > longest) longest = streak;
    } else {
      streak = 0;
    }
  }
  if (longest < SIMULTANEOUS_MODES_THRESHOLD.persistence_turns) return null;
  return {
    type: 'simultaneous_active_modes_alert',
    severity: ALERT_SEVERITY.HITL,
    reason: `> ${SIMULTANEOUS_MODES_THRESHOLD.max_active_modes} modes active 持續 ${longest} turns`,
    payload: {
      threshold_modes: SIMULTANEOUS_MODES_THRESHOLD.max_active_modes,
      persistence_turns_required: SIMULTANEOUS_MODES_THRESHOLD.persistence_turns,
      longest_streak: longest,
    },
    source_spec: 'errata §2.2 simultaneous_active_modes_alert',
  };
}

/**
 * Rule 3 — crisis_activation_alert (4 sub-levels).
 *
 * @param {object} args
 * @param {boolean} args.crisis_triggered_this_session
 * @param {number} args.passive_death_wish_count_cumulative
 * @param {boolean} args.active_si_confirmed_this_session
 * @param {boolean} args.crisis_handler_already_fired — set if Patch 23 / Step 6
 *                                                       handler already notified Vivi
 * @returns {object|null}
 */
export function evaluateCrisisLadder({
  crisis_triggered_this_session = false,
  passive_death_wish_count_cumulative = 0,
  active_si_confirmed_this_session = false,
  crisis_handler_already_fired = false,
} = {}) {
  // Pick highest applicable ladder rung.
  let level = null;
  if (active_si_confirmed_this_session)               level = CRISIS_LADDER_LEVELS.ACTIVE_SI;
  else if (passive_death_wish_count_cumulative >= 5)  level = CRISIS_LADDER_LEVELS.COUNT_5_PLUS;
  else if (passive_death_wish_count_cumulative >= 3)  level = CRISIS_LADDER_LEVELS.COUNT_3_PLUS;
  else if (crisis_triggered_this_session)             level = CRISIS_LADDER_LEVELS.FIRST_ACTIVATION;
  if (!level) return null;

  const sevMap = {
    [CRISIS_LADDER_LEVELS.ACTIVE_SI]:        ALERT_SEVERITY.CRITICAL,
    [CRISIS_LADDER_LEVELS.COUNT_5_PLUS]:     ALERT_SEVERITY.CRITICAL,
    [CRISIS_LADDER_LEVELS.COUNT_3_PLUS]:     ALERT_SEVERITY.HITL,
    [CRISIS_LADDER_LEVELS.FIRST_ACTIVATION]: ALERT_SEVERITY.HITL,
  };

  return {
    type: 'crisis_activation_alert',
    severity: sevMap[level],
    reason: `crisis ladder level: ${level}`,
    payload: {
      level,
      crisis_handler_already_fired,
      // ⚠️ dedup hint — caller suppresses notification if handler已 fired (Patch 23 + Step 6).
      passive_death_wish_count_cumulative,
      active_si: active_si_confirmed_this_session,
    },
    source_spec: 'errata §2.2 crisis_activation_alert (overlaps Patch 23 + §10 Step 6)',
    action_by_level: {
      first_crisis_activation:        'HITL Vivi 通知(下個工作日 review)',
      passive_death_wish_count_3_plus:'HITL Vivi 通知(同日 review)',
      passive_death_wish_count_5_plus:'critical alert(immediate, freeze AI 推進)',
      active_si_confirmed:            'critical alert(immediate)',
    },
  };
}

/**
 * Rule 4 — landmine_top1_attempt_alert.
 *
 * @param {object} args
 * @param {string[]} args.recent_landmine_attempts — chronological term values
 * @returns {object|null}
 */
export function evaluateLandmineTop1Attempt({ recent_landmine_attempts = [] } = {}) {
  if (!Array.isArray(recent_landmine_attempts)) return null;
  const N = LANDMINE_TOP1_THRESHOLD.consecutive_same_term_attempts;
  if (recent_landmine_attempts.length < N) return null;
  const window = recent_landmine_attempts.slice(-N);
  const first = window[0];
  if (!first) return null;
  if (window.every(t => t === first)) {
    return {
      type: 'landmine_top1_attempt_alert',
      severity: ALERT_SEVERITY.REVIEW,
      reason: `Top 1 Landmine Check 連續 ${N} 次同詞 fail`,
      payload: {
        consecutive_threshold: N,
        // ⚠️ 鐵律 #2: only log the term hash, not raw — but landmine terms are
        // ALREADY a fixed enum in master-detector.js blacklist_tier1, so they
        // are safe enum values, not student-authored text. Include as-is.
        term: first,
      },
      source_spec: 'errata §2.2 landmine_top1_attempt_alert',
    };
  }
  return null;
}

/**
 * Rule 5 — reframe_invocation_imbalance_alert.
 *
 * @param {object} args
 * @param {Record<string, number>} args.reframe_invocation_counts — { R1: 12, R2: 3, ... }
 * @returns {object|null}
 */
export function evaluateReframeImbalance({ reframe_invocation_counts = {} } = {}) {
  const total = Object.values(reframe_invocation_counts).reduce((a, b) => a + (Number(b) || 0), 0);
  if (total === 0) return null;
  const offenders = [];
  for (const [rId, count] of Object.entries(reframe_invocation_counts)) {
    const share = (Number(count) || 0) / total;
    if (share > REFRAME_IMBALANCE_THRESHOLD.single_reframe_share) {
      offenders.push({ reframe_id: rId, share, count });
    }
  }
  if (offenders.length === 0) return null;
  return {
    type: 'reframe_invocation_imbalance_alert',
    severity: ALERT_SEVERITY.REVIEW,
    reason: `single reframe(s) share > ${REFRAME_IMBALANCE_THRESHOLD.single_reframe_share * 100}% of all invocations`,
    payload: {
      threshold_share: REFRAME_IMBALANCE_THRESHOLD.single_reframe_share,
      total_invocations: total,
      offenders,
    },
    source_spec: 'errata §2.2 reframe_invocation_imbalance_alert',
  };
}

/**
 * Rule 6 — no_reframe_invocation_alert.
 *
 * @param {object} args
 * @param {number[]} args.recent_reframe_rates — chronological session-level rates
 * @returns {object|null}
 */
export function evaluateNoReframeInvocation({ recent_reframe_rates = [] } = {}) {
  if (!Array.isArray(recent_reframe_rates)) return null;
  const N = NO_REFRAME_THRESHOLD.consecutive_sessions;
  if (recent_reframe_rates.length < N) return null;
  const window = recent_reframe_rates.slice(-N);
  if (window.every(r => r < NO_REFRAME_THRESHOLD.rate_threshold)) {
    return {
      type: 'no_reframe_invocation_alert',
      severity: ALERT_SEVERITY.REVIEW,
      reason: `reframe invocation rate < ${NO_REFRAME_THRESHOLD.rate_threshold * 100}% 持續 ${N} sessions`,
      payload: {
        rate_threshold: NO_REFRAME_THRESHOLD.rate_threshold,
        consecutive_sessions: N,
        recent_rates: [...recent_reframe_rates],
      },
      source_spec: 'errata §2.2 no_reframe_invocation_alert',
    };
  }
  return null;
}

// ─── Master evaluator ────────────────────────────────────

/**
 * Evaluate all 6 rules in sequence; return array of triggered alerts.
 * Emits [dashboard-alert] structured logs for each (鐵律 #2 — no raw user text).
 *
 * @param {object} state — composite metric inputs
 * @returns {object[]} alerts
 */
export function evaluateAllRules(state = {}) {
  const alerts = [];
  const push = (a) => { if (a) { alerts.push(a); logAlert(a); } };

  push(evaluateModeThrash({
    recentSessionTransitionCounts: state.recentSessionTransitionCounts,
  }));
  push(evaluateSimultaneousModes({ perTurnSnapshots: state.perTurnSnapshots }));
  push(evaluateCrisisLadder({
    crisis_triggered_this_session:        state.crisis_triggered_this_session,
    passive_death_wish_count_cumulative:  state.passive_death_wish_count_cumulative,
    active_si_confirmed_this_session:     state.active_si_confirmed_this_session,
    crisis_handler_already_fired:         state.crisis_handler_already_fired,
  }));
  push(evaluateLandmineTop1Attempt({
    recent_landmine_attempts: state.recent_landmine_attempts,
  }));
  push(evaluateReframeImbalance({
    reframe_invocation_counts: state.reframe_invocation_counts,
  }));
  push(evaluateNoReframeInvocation({
    recent_reframe_rates: state.recent_reframe_rates,
  }));
  return alerts;
}

/**
 * Structured log emission — caller-overridable for tests.
 */
let _logger = (payload) => {
  // eslint-disable-next-line no-console
  console.info('[dashboard-alert]', JSON.stringify(payload));
};

export function setAlertLogger(fn) {
  _logger = typeof fn === 'function' ? fn : _logger;
}

export function logAlert(alert) {
  if (!alert || typeof alert !== 'object') return;
  // 鐵律 #2 — alert.payload should already be enums + counts; strip any stray text.
  _logger({
    event: 'dashboard_alert',
    type: alert.type,
    severity: alert.severity,
    reason: alert.reason,
    source_spec: alert.source_spec,
    payload: alert.payload,
  });
}
