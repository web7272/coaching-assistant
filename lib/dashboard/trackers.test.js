// lib/dashboard/trackers.test.js
// v5.1 Step 8 — Lock 4 trackers + their metric formulas/targets/alerts (errata §3).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  METRIC_1_TARGETS, METRIC_1_ALERTS, METRIC_2_TARGET, METRIC_2_ALERT,
  countTransitionsThisSession, meanTransitionsPerSession,
  classifyMetric1, detectMetric1Alert,
  meanSimultaneousActiveModes, classifyMetric2, detectMetric2Alert,
  buildModeTransitionReport,
} from './mode-transition-tracker.js';
import {
  METRIC_4_TARGET, METRIC_4_ALERT, REFRAME_SUCCESS_TARGETS, MONITOR_ONLY_REFRAMES,
  calculateInvocationRate, classifyMetric4, detectMetric4Alert,
  computePerReframeStats, classifyMetric5,
  buildReframeReport,
} from './reframe-invocation-tracker.js';
import {
  METRIC_6_TARGET, METRIC_6_ALERT, METRIC_8_ALERT,
  aggregateCarryForwards, calculateDeliveryRate, classifyMetric6,
  calculateAckRate, calculateRefusalRate, classifyMetric8,
  aggregateM71M73Events, buildLandingPageReport,
} from './landing-page-alignment-tracker.js';
import {
  PER_SIGNAL_TARGETS, S2_DUAL_ALERTS, SIGNAL_TO_REFRAME_TARGET,
  STEP_5A_THRESHOLD_FLAGS, MONITOR_ONLY_SIGNALS,
  countThresholdFlags, calculatePerSignalRates, classifyPerSignal,
  s2DualAlerts, calculateSignalToReframeSuccessRate, classifySignalToReframe,
  patch23H4PhilosophicalCaution, buildSignalCascadeReport,
} from './signal-cascade-tracker.js';

// ═════════════════════════════════════════════════════════
// mode-transition-tracker (metric_1 + metric_2)
// ═════════════════════════════════════════════════════════

test('🛑 METRIC_1_TARGETS verbatim from errata §3.1', () => {
  assert.deepEqual(METRIC_1_TARGETS.healthy,    { min: 2, max: 5 });
  assert.deepEqual(METRIC_1_TARGETS.vulnerable, { min: 3, max: 7 });
});

test('🛑 METRIC_1_ALERTS thresholds verbatim (<1 / >8 / 3 sessions)', () => {
  assert.equal(METRIC_1_ALERTS.under_driven_threshold, 1);
  assert.equal(METRIC_1_ALERTS.thrash_threshold, 8);
  assert.equal(METRIC_1_ALERTS.persistence_sessions, 3);
});

test('🛑 countTransitionsThisSession: only counts primary_mode delta', () => {
  const log = [
    { from_primary: 'elicitation', to_primary: 'identity_anchoring' },  // transition
    { from_primary: 'identity_anchoring', to_primary: 'identity_anchoring' }, // not
    { from_primary: 'identity_anchoring', to_primary: 'integration' },  // transition
  ];
  assert.equal(countTransitionsThisSession(log), 2);
  assert.equal(countTransitionsThisSession([]), 0);
  assert.equal(countTransitionsThisSession(null), 0);
});

test('🛑 classifyMetric1: healthy cohort target 2-5', () => {
  assert.equal(classifyMetric1(3, 'healthy').status, 'on_target');
  assert.equal(classifyMetric1(1, 'healthy').status, 'below_target');
  assert.equal(classifyMetric1(6, 'healthy').status, 'above_target');
});

test('🛑 detectMetric1Alert: 3 consecutive sessions < 1 → under_driven', () => {
  assert.equal(detectMetric1Alert([0, 0, 0]).alert_type, 'under_driven');
  assert.equal(detectMetric1Alert([0, 1, 0]).alert_type, null);  // 1 not strictly < 1
  assert.equal(detectMetric1Alert([0, 0]).alert_type, null);  // <3 sessions
});

test('🛑 detectMetric1Alert: 3 consecutive sessions > 8 → thrash', () => {
  assert.equal(detectMetric1Alert([9, 10, 12]).alert_type, 'thrash');
  assert.equal(detectMetric1Alert([9, 8, 9]).alert_type, null);   // 8 not > 8
});

test('🛑 METRIC_2_TARGET verbatim 1.5-2.5', () => {
  assert.deepEqual(METRIC_2_TARGET, { min: 1.5, max: 2.5 });
  assert.equal(METRIC_2_ALERT.persistent_max, 3);
  assert.equal(METRIC_2_ALERT.persistence_turns, 5);
});

test('🛑 meanSimultaneousActiveModes: averages len(active_modes)', () => {
  const snapshots = [
    { active_modes: ['elicitation'] },                    // 1
    { active_modes: ['identity_anchoring', 'crisis'] },   // 2
    { active_modes: ['integration', 'cascade', 'future_pacing'] }, // 3
  ];
  assert.equal(meanSimultaneousActiveModes(snapshots), 2);
});

test('🛑 detectMetric2Alert: persistent > 3 active for >= 5 turns → alert', () => {
  const snapshots = [
    { active_modes: ['a', 'b', 'c', 'd'] },  // 4
    { active_modes: ['a', 'b', 'c', 'd'] },
    { active_modes: ['a', 'b', 'c', 'd'] },
    { active_modes: ['a', 'b', 'c', 'd'] },
    { active_modes: ['a', 'b', 'c', 'd'] },  // 5th turn
  ];
  assert.equal(detectMetric2Alert(snapshots).alert, true);
  assert.equal(detectMetric2Alert(snapshots).longest_streak, 5);
});

test('🛑 detectMetric2Alert: streak < 5 → no alert', () => {
  const snapshots = [
    { active_modes: ['a', 'b', 'c', 'd'] },  // 4
    { active_modes: ['a', 'b', 'c', 'd'] },
    { active_modes: ['a', 'b'] },             // break
    { active_modes: ['a', 'b', 'c', 'd'] },
  ];
  assert.equal(detectMetric2Alert(snapshots).alert, false);
});

test('buildModeTransitionReport: returns both metric_1 + metric_2 blocks', () => {
  const report = buildModeTransitionReport({
    perSessionLogs: [[{ from_primary: 'a', to_primary: 'b' }]],
    perTurnSnapshotsPerSession: [[{ active_modes: ['a', 'b'] }]],
    cohort: 'healthy',
  });
  assert.ok(report.metric_1_mode_transition_rate);
  assert.ok(report.metric_2_simultaneous_active_modes_mean);
  assert.equal(report.metric_1_mode_transition_rate.mean, 1);
});

// ═════════════════════════════════════════════════════════
// reframe-invocation-tracker (metric_4 + metric_5)
// ═════════════════════════════════════════════════════════

test('🛑 METRIC_4 thresholds verbatim from errata §3.2', () => {
  assert.deepEqual(METRIC_4_TARGET, { min: 0.10, max: 0.25 });
  assert.equal(METRIC_4_ALERT.under_threshold, 0.05);
  assert.equal(METRIC_4_ALERT.over_threshold, 0.35);
});

test('🛑 REFRAME_SUCCESS_TARGETS verbatim §3.2 (R1>40 R2>60 R3>50 R4>70 R5>70 R6>50 R7>60)', () => {
  assert.equal(REFRAME_SUCCESS_TARGETS.R1, 0.40);
  assert.equal(REFRAME_SUCCESS_TARGETS.R2, 0.60);
  assert.equal(REFRAME_SUCCESS_TARGETS.R3, 0.50);
  assert.equal(REFRAME_SUCCESS_TARGETS.R4, 0.70);
  assert.equal(REFRAME_SUCCESS_TARGETS.R5, 0.70);
  assert.equal(REFRAME_SUCCESS_TARGETS.R6, 0.50);
  assert.equal(REFRAME_SUCCESS_TARGETS.R7, 0.60);
});

test('🛑 MONITOR_ONLY_REFRAMES: R8 + R12 (no target band, monitor only)', () => {
  assert.deepEqual([...MONITOR_ONLY_REFRAMES].sort(), ['R12', 'R8']);
});

test('🛑 calculateInvocationRate: clamped to [0, 1]', () => {
  assert.equal(calculateInvocationRate({ total_turns: 100, turns_with_any_reframe: 15 }), 0.15);
  assert.equal(calculateInvocationRate({ total_turns: 0 }), 0);
  assert.equal(calculateInvocationRate({ total_turns: 10, turns_with_any_reframe: 100 }), 1);
});

test('🛑 detectMetric4Alert: 3 consecutive sessions < 5% → under_used', () => {
  assert.equal(detectMetric4Alert([0.01, 0.02, 0.03]).alert_type, 'under_used');
  assert.equal(detectMetric4Alert([0.01, 0.06, 0.02]).alert_type, null);
});

test('🛑 detectMetric4Alert: 3 consecutive sessions > 35% → over_used', () => {
  assert.equal(detectMetric4Alert([0.40, 0.50, 0.60]).alert_type, 'over_used');
});

test('🛑 computePerReframeStats: groups + computes rate', () => {
  const history = [
    { reframe_id: 'R1', outcome: 'success' },
    { reframe_id: 'R1', outcome: 'pending' },
    { reframe_id: 'R1', outcome: 'success' },
    { reframe_id: 'R2', outcome: 'partial' },
  ];
  const stats = computePerReframeStats(history);
  assert.equal(stats.R1.invocations, 3);
  assert.equal(stats.R1.successes, 2);
  assert.ok(Math.abs(stats.R1.rate - 0.6667) < 0.01);
  assert.equal(stats.R2.invocations, 1);
  assert.equal(stats.R2.successes, 0);
  assert.equal(stats.R2.rate, 0);
});

test('🛑 classifyMetric5: R1 0.45 > 0.40 target → on_target; R2 0.50 < 0.60 → below_target', () => {
  const stats = {
    R1: { invocations: 100, successes: 45, rate: 0.45 },
    R2: { invocations: 100, successes: 50, rate: 0.50 },
    R8: { invocations: 10,  successes: 5,  rate: 0.50 },   // monitor only
  };
  const out = classifyMetric5(stats);
  assert.equal(out.R1.status, 'on_target');
  assert.equal(out.R2.status, 'below_target');
  assert.equal(out.R8.status, 'monitor_only');
  assert.equal(out.R8.target, null);
});

test('buildReframeReport: combines metric_4 + metric_5', () => {
  const history = [
    { reframe_id: 'R1', outcome: 'success', invoked_at_turn: 5, session_id: 1 },
    { reframe_id: 'R2', outcome: 'partial', invoked_at_turn: 6, session_id: 1 },
  ];
  const report = buildReframeReport({ invocationHistory: history, total_turns: 50 });
  assert.equal(report.metric_4_reframe_invocation_rate.turns_with_any_reframe, 2);
  assert.equal(report.metric_4_reframe_invocation_rate.rate, 0.04);
  assert.ok(report.metric_5_per_reframe_success_rate.R1);
});

// ═════════════════════════════════════════════════════════
// landing-page-alignment-tracker (metric_6 + metric_7 + metric_8 + M71-73)
// ═════════════════════════════════════════════════════════

test('🛑 METRIC_6 / METRIC_8 thresholds verbatim §3.3', () => {
  assert.equal(METRIC_6_TARGET.min, 0.95);
  assert.equal(METRIC_6_ALERT.under_threshold, 0.90);
  assert.equal(METRIC_8_ALERT.over_threshold, 0.60);
});

test('🛑 aggregateCarryForwards: counts delivered / ack / refused', () => {
  const cfs = [
    { landing_page_reminder_delivered: true,  professional_referral_acknowledged: true,  professional_referral_refused: false },
    { landing_page_reminder_delivered: true,  professional_referral_acknowledged: false, professional_referral_refused: true },
    { landing_page_reminder_delivered: false, professional_referral_acknowledged: false, professional_referral_refused: false },
  ];
  const agg = aggregateCarryForwards(cfs);
  assert.equal(agg.crisis_session_count, 3);
  assert.equal(agg.reminder_delivered_count, 2);
  assert.equal(agg.referral_acknowledged_count, 1);
  assert.equal(agg.referral_refused_count, 1);
});

test('🛑 classifyMetric6: < 90% → critical_alert step_6_skipped_bug', () => {
  assert.equal(classifyMetric6(0.85).status, 'critical_alert');
  assert.equal(classifyMetric6(0.85).reason, 'step_6_skipped_bug');
  assert.equal(classifyMetric6(0.92).status, 'below_target_warning');
  assert.equal(classifyMetric6(0.96).status, 'on_target');
});

test('🛑 calculateAckRate / RefusalRate: 0 when no reminder delivered', () => {
  assert.equal(calculateAckRate({ reminder_delivered_count: 0 }), 0);
  assert.equal(calculateRefusalRate({ reminder_delivered_count: 0 }), 0);
});

test('🛑 classifyMetric8: > 60% → review_reminder_phrasing', () => {
  assert.equal(classifyMetric8(0.70).status, 'review_reminder_phrasing');
  assert.equal(classifyMetric8(0.50).status, 'on_target');
});

test('🛑 aggregateM71M73Events: PR-6b audit aggregation', () => {
  const audits = [
    { delivered: false, violation: true, offer_count: 0 },
    { delivered: true, violation: false, offer_count: 1, variant: 'A' },
    { delivered: false, violation: false, offer_count: 3 },   // M72 max-skip
  ];
  const ev = aggregateM71M73Events(audits);
  assert.equal(ev.m71_violations, 1);
  assert.equal(ev.m72_offer_max_skips, 1);
});

test('buildLandingPageReport: integrates carry_forwards + m71 audits', () => {
  const r = buildLandingPageReport({
    crisisCarryForwards: [{
      landing_page_reminder_delivered: true,
      professional_referral_acknowledged: true,
      professional_referral_refused: false,
    }],
    m71Audits: [{ delivered: true, violation: false, offer_count: 1 }],
  });
  assert.equal(r.metric_6_landing_page_reminder_delivery_rate.rate, 1);
  assert.equal(r.metric_7_professional_referral_acknowledgment_rate.rate, 1);
  assert.equal(r.metric_8_professional_referral_refusal_rate.rate, 0);
});

// ═════════════════════════════════════════════════════════
// signal-cascade-tracker (§3.4)
// ═════════════════════════════════════════════════════════

test('🛑 PER_SIGNAL_TARGETS verbatim §3.4', () => {
  // S1 healthy 20-50 / vulnerable 30-50
  assert.deepEqual(PER_SIGNAL_TARGETS.S1.healthy,    { min: 0.20, max: 0.50 });
  assert.deepEqual(PER_SIGNAL_TARGETS.S1.vulnerable, { min: 0.30, max: 0.50 });
  // S2 dual band
  assert.equal(PER_SIGNAL_TARGETS.S2.healthy.max,    0.05);
  assert.equal(PER_SIGNAL_TARGETS.S2.vulnerable.min, 0.30);
  // S3 10-30 both cohorts
  assert.deepEqual(PER_SIGNAL_TARGETS.S3.healthy, { min: 0.10, max: 0.30 });
  // S4 5-20 both
  assert.deepEqual(PER_SIGNAL_TARGETS.S4.healthy, { min: 0.05, max: 0.20 });
  // S5 healthy 5-15 / vulnerable >= 15 no upper
  assert.deepEqual(PER_SIGNAL_TARGETS.S5.healthy, { min: 0.05, max: 0.15 });
  assert.equal(PER_SIGNAL_TARGETS.S5.vulnerable.min, 0.15);
});

test('🛑 S2_DUAL_ALERTS: healthy oversensitive > 10% / vulnerable undersensitive < 30%', () => {
  assert.equal(S2_DUAL_ALERTS.healthy_oversensitive_threshold, 0.10);
  assert.equal(S2_DUAL_ALERTS.vulnerable_undersensitive_threshold, 0.30);
});

test('🛑 MONITOR_ONLY_SIGNALS: S6 (Step 7 PR-7b modal_operator, not in errata §3.4)', () => {
  assert.deepEqual([...MONITOR_ONLY_SIGNALS], ['S6']);
});

test('🛑 s2DualAlerts: healthy 12% → regex_oversensitive; vulnerable 25% → regex_undersensitive', () => {
  const r = s2DualAlerts({ healthyRate: 0.12, vulnerableRate: 0.25 });
  assert.equal(r.healthy_alert, 'regex_oversensitive');
  assert.equal(r.vulnerable_alert, 'regex_undersensitive');
});

test('🛑 s2DualAlerts: in-band rates → no alert', () => {
  const r = s2DualAlerts({ healthyRate: 0.03, vulnerableRate: 0.45 });
  assert.equal(r.healthy_alert, null);
  assert.equal(r.vulnerable_alert, null);
});

test('🛑 calculatePerSignalRates: extracts *_detected boolean rates', () => {
  const states = [
    { external_locus_detected: true, passive_hope_detected: false },
    { external_locus_detected: true, passive_hope_detected: true  },
    { external_locus_detected: false, passive_hope_detected: false },
  ];
  const rates = calculatePerSignalRates({ perSessionStates: states });
  assert.ok(Math.abs(rates.S1 - 2/3) < 0.01);
  assert.ok(Math.abs(rates.S2 - 1/3) < 0.01);
});

test('🛑 classifyPerSignal: S1 0.35 healthy → on_target; 0.10 healthy → below_target', () => {
  const out = classifyPerSignal({ S1: 0.35 }, 'healthy');
  assert.equal(out.S1.status, 'on_target');
  const out2 = classifyPerSignal({ S1: 0.10 }, 'healthy');
  assert.equal(out2.S1.status, 'below_target');
});

test('🛑 classifyPerSignal: S6 → monitor_only', () => {
  const out = classifyPerSignal({ S6: 0.50 }, 'healthy');
  assert.equal(out.S6.status, 'monitor_only');
});

test('🛑 SIGNAL_TO_REFRAME_TARGET min 0.30; < target → below_target', () => {
  assert.equal(SIGNAL_TO_REFRAME_TARGET.min, 0.30);
  assert.equal(classifySignalToReframe(0.25).status, 'below_target');
  assert.equal(classifySignalToReframe(0.40).status, 'on_target');
});

test('🛑 countThresholdFlags: all 8 Step 5a/7 flags aggregated', () => {
  const states = [
    { s1_r1_priority_flag: true, s5_hitl_alert_flag: true },
    { s2_e3_evaluate_flag: true },
  ];
  const counts = countThresholdFlags(states);
  assert.equal(counts.s1_r1_priority_flag, 1);
  assert.equal(counts.s5_hitl_alert_flag, 1);
  assert.equal(counts.s2_e3_evaluate_flag, 1);
  assert.equal(counts.s6_e3_external_locus_pattern_flag, 0);
});

test('🛑 STEP_5A_THRESHOLD_FLAGS: 8 entries (7 Step 5a + S6 Step 7)', () => {
  assert.equal(STEP_5A_THRESHOLD_FLAGS.length, 8);
  assert.ok(STEP_5A_THRESHOLD_FLAGS.includes('s6_e3_external_locus_pattern_flag'));
});

test('🛑 patch23H4PhilosophicalCaution: longest >= 3 → flagged', () => {
  const states = [
    { passive_dw_philosophical_consecutive_count: 2 },
    { passive_dw_philosophical_consecutive_count: 3 },
    { passive_dw_philosophical_consecutive_count: 1 },
  ];
  const r = patch23H4PhilosophicalCaution(states);
  assert.equal(r.flagged, true);
  assert.equal(r.longest_streak, 3);
});

test('buildSignalCascadeReport: integrates all signal metrics', () => {
  const report = buildSignalCascadeReport({
    perSessionStatesHealthy: [
      { passive_hope_detected: true }, { passive_hope_detected: true },
    ],
    perSessionStatesVulnerable: [{ passive_hope_detected: false }],
    signals_triggered: 10, reframe_success_after_signal: 4,
  });
  assert.equal(report.s2_dual_alerts.healthy_alert, 'regex_oversensitive');
  assert.equal(report.signal_to_reframe_success_rate.rate, 0.4);
});
