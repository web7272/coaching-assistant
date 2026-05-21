// lib/dashboard/visual-channel-tracker.test.js
// errata 5/21 Patch 4: visual_channel_self_surfaced_rate 指標 + Beta thresholds

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  VISUAL_BODY_MARKER_REGEX,
  detectVisualChannelMarkers,
  calculateRate,
  THRESHOLDS,
  DECISIONS,
  COHORT_MIN_FOR_UPGRADE,
  checkThreshold,
  METRIC_METADATA,
} from './visual-channel-tracker.js';

// ─────────────────────────────────────────────────────────
// detectVisualChannelMarkers
// ─────────────────────────────────────────────────────────

test('detectVisualChannelMarkers: detects visual markers', () => {
  assert.equal(detectVisualChannelMarkers('我看到一個畫面'), true);
  assert.equal(detectVisualChannelMarkers('那是紅色的'), true);
  assert.equal(detectVisualChannelMarkers('我看見自己在做'), true);
});

test('detectVisualChannelMarkers: detects body markers', () => {
  assert.equal(detectVisualChannelMarkers('身體裡很緊'), true);
  assert.equal(detectVisualChannelMarkers('胸口悶悶的'), true);
  assert.equal(detectVisualChannelMarkers('胃在抽'), true);
  assert.equal(detectVisualChannelMarkers('手在抖'), true);
});

test('detectVisualChannelMarkers: detects temperature / weight markers', () => {
  assert.equal(detectVisualChannelMarkers('感覺很熱'), true);
  assert.equal(detectVisualChannelMarkers('整個人很沉'), true);
  assert.equal(detectVisualChannelMarkers('心裡很重'), true);
});

test('detectVisualChannelMarkers: detects expression / posture markers', () => {
  assert.equal(detectVisualChannelMarkers('他的表情很放鬆'), true);
  assert.equal(detectVisualChannelMarkers('我看到他的姿勢'), true);
});

test('detectVisualChannelMarkers: returns false for pure conceptual / scenario language', () => {
  assert.equal(detectVisualChannelMarkers('我會跟同事討論一個案子'), false);
  assert.equal(detectVisualChannelMarkers('做決定的時候、我會先想清楚'), false);
  assert.equal(detectVisualChannelMarkers('明天上班我會早點到、跟主管聊一下'), false);
});

test('detectVisualChannelMarkers: handles edge cases', () => {
  assert.equal(detectVisualChannelMarkers(''), false);
  assert.equal(detectVisualChannelMarkers(null), false);
  assert.equal(detectVisualChannelMarkers(undefined), false);
  assert.equal(detectVisualChannelMarkers(123), false);
});

test('VISUAL_BODY_MARKER_REGEX is exported as RegExp', () => {
  assert.ok(VISUAL_BODY_MARKER_REGEX instanceof RegExp);
});

// ─────────────────────────────────────────────────────────
// calculateRate
// ─────────────────────────────────────────────────────────

test('calculateRate: typical rate calculation', () => {
  assert.equal(calculateRate([true, false, true, false, true]), 0.6);
  assert.equal(calculateRate([false, false, false, false]), 0);
  assert.equal(calculateRate([true, true, true, true]), 1);
});

test('calculateRate: empty / non-array → 0', () => {
  assert.equal(calculateRate([]), 0);
  assert.equal(calculateRate(null), 0);
  assert.equal(calculateRate(undefined), 0);
  assert.equal(calculateRate('not array'), 0);
});

// ─────────────────────────────────────────────────────────
// THRESHOLDS + DECISIONS constants (errata Patch 4)
// ─────────────────────────────────────────────────────────

test('THRESHOLDS match errata Patch 4 (10% / 30%)', () => {
  assert.equal(THRESHOLDS.B_PATH_VALIDATED, 0.10);
  assert.equal(THRESHOLDS.B_BASELINE_MAX, 0.30);
  assert.equal(THRESHOLDS.UPGRADE_TO_C, 0.30);
});

test('COHORT_MIN_FOR_UPGRADE = 50 (errata cohort_size_caveat)', () => {
  assert.equal(COHORT_MIN_FOR_UPGRADE, 50);
});

test('DECISIONS: 5 distinct categories', () => {
  const values = Object.values(DECISIONS);
  assert.equal(values.length, 5);
  assert.equal(new Set(values).size, 5);
});

// ─────────────────────────────────────────────────────────
// checkThreshold — decision logic
// ─────────────────────────────────────────────────────────

test('checkThreshold: rate < 10% → B_path_validated', () => {
  assert.equal(checkThreshold({ rate: 0.05, cohortSize: 100 }), DECISIONS.B_PATH_VALIDATED);
  assert.equal(checkThreshold({ rate: 0.099, cohortSize: 30 }), DECISIONS.B_PATH_VALIDATED);
});

test('checkThreshold: rate 10-30% → B_baseline (in target range)', () => {
  assert.equal(checkThreshold({ rate: 0.15, cohortSize: 100 }), DECISIONS.B_BASELINE);
  assert.equal(checkThreshold({ rate: 0.25, cohortSize: 30 }), DECISIONS.B_BASELINE);
});

test('checkThreshold: rate >= 30% + cohort < 50 → early_signal_hold', () => {
  assert.equal(checkThreshold({ rate: 0.35, cohortSize: 40 }), DECISIONS.EARLY_SIGNAL_HOLD);
  assert.equal(checkThreshold({ rate: 0.50, cohortSize: 10 }), DECISIONS.EARLY_SIGNAL_HOLD);
});

test('🛑 checkThreshold: rate >= 30% + cohort >= 50 → consider_upgrade_to_C', () => {
  assert.equal(checkThreshold({ rate: 0.30, cohortSize: 50 }), DECISIONS.CONSIDER_UPGRADE_TO_C);
  assert.equal(checkThreshold({ rate: 0.45, cohortSize: 100 }), DECISIONS.CONSIDER_UPGRADE_TO_C);
});

test('🛑 checkThreshold: cross-signal phase_problem (p10 > 15% + rate < 20%)', () => {
  assert.equal(
    checkThreshold({ rate: 0.15, cohortSize: 100, p10Rate: 0.20 }),
    DECISIONS.PHASE_PROBLEM,
    '兩 channel 都無感、phase 結構問題',
  );
  assert.equal(
    checkThreshold({ rate: 0.05, cohortSize: 100, p10Rate: 0.25 }),
    DECISIONS.PHASE_PROBLEM,
  );
});

test('checkThreshold: p10 high but visual rate high → not phase_problem (only one signal)', () => {
  // visual_rate >= 20%, so phase_problem cross-signal doesn't trigger
  assert.equal(
    checkThreshold({ rate: 0.25, cohortSize: 100, p10Rate: 0.20 }),
    DECISIONS.B_BASELINE,
  );
});

test('checkThreshold: validates inputs', () => {
  assert.throws(() => checkThreshold({ rate: -0.1, cohortSize: 10 }), /rate must be number/);
  assert.throws(() => checkThreshold({ rate: 1.5, cohortSize: 10 }), /rate must be number/);
  assert.throws(() => checkThreshold({ rate: 'high', cohortSize: 10 }), /rate must be number/);
  assert.throws(() => checkThreshold({ rate: 0.2, cohortSize: -1 }), /cohortSize/);
  assert.throws(() => checkThreshold({ rate: 0.2, cohortSize: 3.5 }), /cohortSize/);
});

// ─────────────────────────────────────────────────────────
// METRIC_METADATA
// ─────────────────────────────────────────────────────────

test('METRIC_METADATA has expected shape', () => {
  assert.equal(METRIC_METADATA.id, 'visual_channel_self_surfaced_rate');
  assert.ok(typeof METRIC_METADATA.description === 'string');
  assert.ok(typeof METRIC_METADATA.formula === 'string');
  assert.ok(METRIC_METADATA.beta_calibration);
  assert.ok(METRIC_METADATA.errata_source.includes('Patch 4'));
  assert.ok(Object.isFrozen(METRIC_METADATA));
});

// ─────────────────────────────────────────────────────────
// 🛑 End-to-end: simulated Phase 3a/3b Step 1 cohort
// ─────────────────────────────────────────────────────────

test('🛑 simulated cohort: low visual surfacing → B_PATH_VALIDATED', () => {
  // 100 sessions, 5 with visual surfacing
  const sessions = Array(100).fill(false).map((_, i) => i < 5);
  const rate = calculateRate(sessions);
  assert.equal(rate, 0.05);
  assert.equal(checkThreshold({ rate, cohortSize: 100 }), DECISIONS.B_PATH_VALIDATED);
});

test('🛑 simulated cohort: 20% visual surfacing → B_BASELINE (target range)', () => {
  const sessions = Array(100).fill(false).map((_, i) => i < 20);
  const rate = calculateRate(sessions);
  // Use approximate due to floating-point arithmetic
  assert.ok(Math.abs(rate - 0.20) < 1e-10);
  assert.equal(checkThreshold({ rate, cohortSize: 100 }), DECISIONS.B_BASELINE);
});

test('🛑 simulated cohort: 35% visual surfacing + small cohort → EARLY_SIGNAL_HOLD', () => {
  const sessions = Array(40).fill(false).map((_, i) => i < 14);
  const rate = calculateRate(sessions);
  assert.equal(rate, 0.35);
  assert.equal(checkThreshold({ rate, cohortSize: 40 }), DECISIONS.EARLY_SIGNAL_HOLD);
});

test('🛑 simulated cohort: 35% visual surfacing + cohort >= 50 → CONSIDER_UPGRADE_TO_C', () => {
  const sessions = Array(60).fill(false).map((_, i) => i < 21);
  const rate = calculateRate(sessions);
  assert.equal(rate, 0.35);
  assert.equal(checkThreshold({ rate, cohortSize: 60 }), DECISIONS.CONSIDER_UPGRADE_TO_C);
});
