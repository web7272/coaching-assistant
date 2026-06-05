// lib/dashboard/alert-rules.test.js
// v5.1 Step 8 — Lock 6 mode-specific alert rules (errata Patch 2 §2.2 verbatim).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MODE_THRASH_THRESHOLD, SIMULTANEOUS_MODES_THRESHOLD,
  CRISIS_LADDER_LEVELS, LANDMINE_TOP1_THRESHOLD,
  REFRAME_IMBALANCE_THRESHOLD, NO_REFRAME_THRESHOLD,
  DEPRECATED_ALERTS, ALERT_SEVERITY,
  evaluateModeThrash, evaluateSimultaneousModes, evaluateCrisisLadder,
  evaluateLandmineTop1Attempt, evaluateReframeImbalance, evaluateNoReframeInvocation,
  evaluateAllRules, setAlertLogger, logAlert,
} from './alert-rules.js';

// ─── Thresholds verbatim from errata §2.2 ─────────────────

test('🛑 MODE_THRASH_THRESHOLD: > 10 per session, 連 3 sessions', () => {
  assert.equal(MODE_THRASH_THRESHOLD.per_session_count, 10);
  assert.equal(MODE_THRASH_THRESHOLD.consecutive_sessions, 3);
});

test('🛑 SIMULTANEOUS_MODES_THRESHOLD: > 3 持 5+ turns', () => {
  assert.equal(SIMULTANEOUS_MODES_THRESHOLD.max_active_modes, 3);
  assert.equal(SIMULTANEOUS_MODES_THRESHOLD.persistence_turns, 5);
});

test('🛑 CRISIS_LADDER_LEVELS: 4 sub-levels verbatim', () => {
  assert.equal(CRISIS_LADDER_LEVELS.FIRST_ACTIVATION, 'first_crisis_activation');
  assert.equal(CRISIS_LADDER_LEVELS.COUNT_3_PLUS, 'passive_death_wish_count_3_plus');
  assert.equal(CRISIS_LADDER_LEVELS.COUNT_5_PLUS, 'passive_death_wish_count_5_plus');
  assert.equal(CRISIS_LADDER_LEVELS.ACTIVE_SI, 'active_si_confirmed');
});

test('🛑 LANDMINE_TOP1_THRESHOLD: 連續 3 次同 Landmine 詞', () => {
  assert.equal(LANDMINE_TOP1_THRESHOLD.consecutive_same_term_attempts, 3);
});

test('🛑 REFRAME_IMBALANCE_THRESHOLD: 單一 R > 40%', () => {
  assert.equal(REFRAME_IMBALANCE_THRESHOLD.single_reframe_share, 0.40);
});

test('🛑 NO_REFRAME_THRESHOLD: < 5% rate 持 3 sessions', () => {
  assert.equal(NO_REFRAME_THRESHOLD.rate_threshold, 0.05);
  assert.equal(NO_REFRAME_THRESHOLD.consecutive_sessions, 3);
});

test('🛑 DEPRECATED_ALERTS: phase_regression / phase_max_day_overdue marked', () => {
  assert.deepEqual(
    Object.keys(DEPRECATED_ALERTS).sort(),
    ['phase_max_day_overdue', 'phase_regression'],
  );
});

// ─── Rule 1 — mode_thrash ─────────────────────────────────

test('🛑 evaluateModeThrash: 3 consecutive > 10 → alert HITL', () => {
  const a = evaluateModeThrash({ recentSessionTransitionCounts: [11, 12, 11] });
  assert.ok(a);
  assert.equal(a.type, 'mode_thrash_alert');
  assert.equal(a.severity, ALERT_SEVERITY.HITL);
  assert.equal(a.payload.consecutive_sessions, 3);
});

test('🛑 evaluateModeThrash: NOT 3 consecutive > 10 → null', () => {
  assert.equal(evaluateModeThrash({ recentSessionTransitionCounts: [11, 5, 12] }), null);
});

// ─── Rule 2 — simultaneous_modes ─────────────────────────

test('🛑 evaluateSimultaneousModes: > 3 active for 5+ consecutive turns → alert', () => {
  const snapshots = Array.from({ length: 6 }, () => ({ active_modes: ['a','b','c','d'] }));
  const a = evaluateSimultaneousModes({ perTurnSnapshots: snapshots });
  assert.ok(a);
  assert.equal(a.type, 'simultaneous_active_modes_alert');
});

test('🛑 evaluateSimultaneousModes: streak < 5 → null', () => {
  const snapshots = [
    ...Array.from({ length: 4 }, () => ({ active_modes: ['a','b','c','d'] })),
    { active_modes: ['a'] },
  ];
  assert.equal(evaluateSimultaneousModes({ perTurnSnapshots: snapshots }), null);
});

// ─── Rule 3 — crisis_ladder (4 sub-levels) ───────────────

test('🛑 evaluateCrisisLadder: first_crisis_activation → HITL', () => {
  const a = evaluateCrisisLadder({ crisis_triggered_this_session: true });
  assert.equal(a.payload.level, 'first_crisis_activation');
  assert.equal(a.severity, ALERT_SEVERITY.HITL);
});

test('🛑 evaluateCrisisLadder: count >= 3 → HITL same day', () => {
  const a = evaluateCrisisLadder({
    crisis_triggered_this_session: true, passive_death_wish_count_cumulative: 3,
  });
  assert.equal(a.payload.level, 'passive_death_wish_count_3_plus');
  assert.equal(a.severity, ALERT_SEVERITY.HITL);
});

test('🛑 evaluateCrisisLadder: count >= 5 → critical immediate', () => {
  const a = evaluateCrisisLadder({
    passive_death_wish_count_cumulative: 5,
  });
  assert.equal(a.payload.level, 'passive_death_wish_count_5_plus');
  assert.equal(a.severity, ALERT_SEVERITY.CRITICAL);
});

test('🛑 evaluateCrisisLadder: active_si_confirmed → critical (overrides all)', () => {
  const a = evaluateCrisisLadder({
    active_si_confirmed_this_session: true,
    passive_death_wish_count_cumulative: 5,
  });
  assert.equal(a.payload.level, 'active_si_confirmed');
  assert.equal(a.severity, ALERT_SEVERITY.CRITICAL);
});

test('🛑 evaluateCrisisLadder: no triggers → null', () => {
  assert.equal(evaluateCrisisLadder({}), null);
});

test('🛑 evaluateCrisisLadder: crisis_handler_already_fired flag passes through (caller dedup)', () => {
  const a = evaluateCrisisLadder({
    crisis_triggered_this_session: true,
    crisis_handler_already_fired: true,
  });
  // Alert still emitted, but flag tells caller to suppress notification.
  assert.equal(a.payload.crisis_handler_already_fired, true);
});

// ─── Rule 4 — landmine_top1_attempt ──────────────────────

test('🛑 evaluateLandmineTop1Attempt: 連續 3 次同詞 → alert', () => {
  const a = evaluateLandmineTop1Attempt({
    recent_landmine_attempts: ['被需要', '被需要', '被需要'],
  });
  assert.ok(a);
  assert.equal(a.type, 'landmine_top1_attempt_alert');
  assert.equal(a.payload.term, '被需要');
});

test('🛑 evaluateLandmineTop1Attempt: different terms → null', () => {
  const a = evaluateLandmineTop1Attempt({
    recent_landmine_attempts: ['被需要', '證明自己', '被需要'],
  });
  assert.equal(a, null);
});

// ─── Rule 5 — reframe_imbalance ──────────────────────────

test('🛑 evaluateReframeImbalance: R1 = 50/100 > 40% → alert offender R1', () => {
  const a = evaluateReframeImbalance({
    reframe_invocation_counts: { R1: 50, R2: 30, R3: 20 },
  });
  assert.ok(a);
  assert.equal(a.type, 'reframe_invocation_imbalance_alert');
  assert.equal(a.payload.offenders.length, 1);
  assert.equal(a.payload.offenders[0].reframe_id, 'R1');
  assert.equal(a.payload.offenders[0].share, 0.5);
});

test('🛑 evaluateReframeImbalance: balanced → null', () => {
  assert.equal(evaluateReframeImbalance({
    reframe_invocation_counts: { R1: 30, R2: 30, R3: 40 },
  }), null);
});

// ─── Rule 6 — no_reframe ─────────────────────────────────

test('🛑 evaluateNoReframeInvocation: 3 consecutive < 5% → alert', () => {
  const a = evaluateNoReframeInvocation({
    recent_reframe_rates: [0.01, 0.03, 0.02],
  });
  assert.ok(a);
  assert.equal(a.type, 'no_reframe_invocation_alert');
});

test('🛑 evaluateNoReframeInvocation: any session >= 5% → null', () => {
  assert.equal(evaluateNoReframeInvocation({
    recent_reframe_rates: [0.01, 0.10, 0.02],
  }), null);
});

// ─── evaluateAllRules ────────────────────────────────────

test('🛑 evaluateAllRules: integrates all 6 rules', () => {
  const events = [];
  setAlertLogger(p => events.push(p));
  const alerts = evaluateAllRules({
    recentSessionTransitionCounts: [11, 12, 11],
    perTurnSnapshots: Array.from({ length: 6 }, () => ({ active_modes: ['a','b','c','d'] })),
    crisis_triggered_this_session: true,
    passive_death_wish_count_cumulative: 5,
    recent_landmine_attempts: ['被需要', '被需要', '被需要'],
    reframe_invocation_counts: { R1: 50, R2: 30, R3: 20 },
    recent_reframe_rates: [0.01, 0.03, 0.02],
  });
  // All 6 alerts triggered.
  assert.equal(alerts.length, 6);
  // Events logged via custom logger.
  assert.equal(events.length, 6);
  // 鐵律 #2 — payloads contain enum + counts only (no raw text leaks).
  for (const e of events) {
    const serialized = JSON.stringify(e.payload);
    // No common Chinese student phrases. Landmine term '被需要' is an enum
    // value (master-detector blacklist_tier1), not student-authored — safe.
    assert.doesNotMatch(serialized, /我.*覺得|我.*感覺/);
  }
  setAlertLogger(null);  // restore default
});

test('🛑 logAlert: emits structured payload', () => {
  let captured = null;
  setAlertLogger(p => { captured = p; });
  logAlert({
    type: 'mode_thrash_alert',
    severity: ALERT_SEVERITY.HITL,
    reason: 'test',
    payload: { foo: 1 },
    source_spec: 'test',
  });
  assert.ok(captured);
  assert.equal(captured.event, 'dashboard_alert');
  assert.equal(captured.type, 'mode_thrash_alert');
  assert.equal(captured.severity, ALERT_SEVERITY.HITL);
  setAlertLogger(null);
});
