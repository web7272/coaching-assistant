// lib/dashboard/passive-death-wish-tracker.test.js
// Patrick 6/4 (safety patch #23 PR-23b) — Lock dashboard metric boundaries.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PASSIVE_DW_ESCALATE_THRESHOLD,
  PASSIVE_DW_FREEZE_THRESHOLD,
  PHILOSOPHICAL_CONSECUTIVE_CAUTION,
  COHORT_MIN_FOR_RATES,
  RATE_THRESHOLDS,
  LEARNER_LEVELS,
  classifyLearnerLevel,
  aggregateCohort,
  computeFalsePositiveRate,
  computeDay1MissRate,
  consecutivePhilosophicalCaution,
  computeRecallRate,
  METRIC_METADATA,
} from './passive-death-wish-tracker.js';

// ─── constants ───────────────────────────────────────────

test('🛑 thresholds align with lib/state/handoff-escalation.js (3 / 5)', () => {
  assert.equal(PASSIVE_DW_ESCALATE_THRESHOLD, 3);
  assert.equal(PASSIVE_DW_FREEZE_THRESHOLD,   5);
});

test('🛑 PHILOSOPHICAL_CONSECUTIVE_CAUTION = 3 (Vivi 6/4 spec: 連 3 次哲學 → H4 caution)', () => {
  assert.equal(PHILOSOPHICAL_CONSECUTIVE_CAUTION, 3);
});

test('RATE_THRESHOLDS frozen + spec values (Vivi 6/4)', () => {
  assert.ok(Object.isFrozen(RATE_THRESHOLDS));
  assert.equal(RATE_THRESHOLDS.FALSE_POSITIVE_HIGH,  0.30);
  assert.equal(RATE_THRESHOLDS.DAY1_MISS_ACCEPTABLE, 0.10);
  assert.equal(RATE_THRESHOLDS.DAY1_MISS_AUDIT,      0.15);
  assert.equal(RATE_THRESHOLDS.RECALL_LOW,           0.70);
});

// ─── classifyLearnerLevel ────────────────────────────────

test('🛑 classifyLearnerLevel: count = 0 → healthy', () => {
  assert.equal(classifyLearnerLevel(0), LEARNER_LEVELS.HEALTHY);
});

test('🛑 classifyLearnerLevel: count = 1-2 → review (normal observation)', () => {
  assert.equal(classifyLearnerLevel(1), LEARNER_LEVELS.REVIEW);
  assert.equal(classifyLearnerLevel(2), LEARNER_LEVELS.REVIEW);
});

test('🛑 classifyLearnerLevel: count = 3 (escalate threshold) → escalate_vivi', () => {
  assert.equal(classifyLearnerLevel(3), LEARNER_LEVELS.ESCALATE_VIVI);
  assert.equal(classifyLearnerLevel(4), LEARNER_LEVELS.ESCALATE_VIVI);
});

test('🛑 classifyLearnerLevel: count = 5 (freeze threshold) → freeze_hitl', () => {
  assert.equal(classifyLearnerLevel(5), LEARNER_LEVELS.FREEZE_HITL);
  assert.equal(classifyLearnerLevel(12), LEARNER_LEVELS.FREEZE_HITL);
});

test('classifyLearnerLevel: negative / NaN / non-number → healthy (defensive)', () => {
  assert.equal(classifyLearnerLevel(-1), LEARNER_LEVELS.HEALTHY);
  assert.equal(classifyLearnerLevel(NaN), LEARNER_LEVELS.HEALTHY);
  assert.equal(classifyLearnerLevel(null), LEARNER_LEVELS.HEALTHY);
  assert.equal(classifyLearnerLevel('5'), LEARNER_LEVELS.HEALTHY,
    'string input rejected — dashboard caller must Number() its SQL result');
});

// ─── aggregateCohort ─────────────────────────────────────

test('🛑 aggregateCohort: histogram + escalate_list + freeze_list', () => {
  const learners = [
    { student_id: 'A001', count: 0 },     // healthy
    { student_id: 'A002', count: 0 },     // healthy
    { student_id: 'A003', count: 1 },     // review
    { student_id: 'A004', count: 2 },     // review
    { student_id: 'A005', count: 3 },     // escalate
    { student_id: 'A006', count: 4 },     // escalate
    { student_id: 'A007', count: 5 },     // freeze
    { student_id: 'A008', count: 7 },     // freeze
  ];
  const out = aggregateCohort(learners);
  assert.deepEqual(out.histogram, { healthy: 2, review: 2, escalate_vivi: 2, freeze_hitl: 2 });
  assert.deepEqual(out.escalate_list, ['A005', 'A006']);
  assert.deepEqual(out.freeze_list, ['A007', 'A008']);
  assert.equal(out.total, 8);
  assert.equal(out.pct_healthy, 0.25);
});

test('aggregateCohort: empty / non-array → safe defaults', () => {
  assert.deepEqual(aggregateCohort([]).histogram, { healthy: 0, review: 0, escalate_vivi: 0, freeze_hitl: 0 });
  assert.equal(aggregateCohort(null).total, 0);
  assert.equal(aggregateCohort(undefined).pct_healthy, 1);
});

test('aggregateCohort: skips malformed learner entries', () => {
  const out = aggregateCohort([
    { student_id: 'A001', count: 3 },
    null,
    'not_a_learner',
    { student_id: 'A002', count: 0 },
  ]);
  assert.equal(out.total, 4);   // total counts the array length passed in
  assert.equal(out.histogram.healthy, 1);
  assert.equal(out.histogram.escalate_vivi, 1);
});

// ─── computeFalsePositiveRate ────────────────────────────

test('🛑 computeFalsePositiveRate: rate >= 30% → regex_oversensitive (Vivi 6/4)', () => {
  const r = computeFalsePositiveRate({
    c2_fired_count: 100,
    philosophical_declaration_count: 35,
    cohort_size: 60,
  });
  assert.equal(r.rate, 0.35);
  assert.equal(r.decision, 'regex_oversensitive');
});

test('🛑 computeFalsePositiveRate: rate < 30% → healthy', () => {
  const r = computeFalsePositiveRate({
    c2_fired_count: 100,
    philosophical_declaration_count: 25,
    cohort_size: 60,
  });
  assert.equal(r.rate, 0.25);
  assert.equal(r.decision, 'healthy');
});

test('computeFalsePositiveRate: boundary at exactly 30% → regex_oversensitive (>= threshold)', () => {
  const r = computeFalsePositiveRate({
    c2_fired_count: 100,
    philosophical_declaration_count: 30,
    cohort_size: 60,
  });
  assert.equal(r.decision, 'regex_oversensitive');
});

test('computeFalsePositiveRate: cohort_size < 50 → early_signal_hold (rate calculated but not actioned)', () => {
  const r = computeFalsePositiveRate({
    c2_fired_count: 10,
    philosophical_declaration_count: 5,
    cohort_size: 12,
  });
  assert.equal(r.rate, 0.5);
  assert.equal(r.decision, 'early_signal_hold');
});

test('computeFalsePositiveRate: zero c2 fired → no_data', () => {
  const r = computeFalsePositiveRate({
    c2_fired_count: 0,
    philosophical_declaration_count: 0,
  });
  assert.equal(r.decision, 'no_data');
});

test('computeFalsePositiveRate: rejects bad inputs', () => {
  assert.throws(() => computeFalsePositiveRate({ c2_fired_count: -1, philosophical_declaration_count: 0 }));
  assert.throws(() => computeFalsePositiveRate({ c2_fired_count: 10, philosophical_declaration_count: -5 }));
});

// ─── computeDay1MissRate ─────────────────────────────────

test('🛑 computeDay1MissRate: > 15% → regex_sensitivity_audit', () => {
  const learners = [
    { student_id: 'A001', day1_detected: false, day2plus_detected: true },   // missed
    { student_id: 'A002', day1_detected: false, day2plus_detected: true },   // missed
    { student_id: 'A003', day1_detected: false, day2plus_detected: true },   // missed
    { student_id: 'A004', day1_detected: true,  day2plus_detected: true },   // caught
    { student_id: 'A005', day1_detected: false, day2plus_detected: false },  // no DW at all
  ];
  const r = computeDay1MissRate(learners);
  assert.equal(r.rate, 0.6);
  assert.equal(r.decision, 'regex_sensitivity_audit');
  assert.deepEqual(r.missed, ['A001', 'A002', 'A003']);
});

test('🛑 computeDay1MissRate: < 10% → healthy', () => {
  const learners = Array.from({ length: 100 }, (_, i) => ({
    student_id: `A${String(i).padStart(3, '0')}`,
    // 5/100 missed (5%)
    day1_detected: i >= 5,
    day2plus_detected: true,
  }));
  const r = computeDay1MissRate(learners);
  assert.equal(r.rate, 0.05);
  assert.equal(r.decision, 'healthy');
});

test('computeDay1MissRate: 10% < rate <= 15% → borderline', () => {
  const learners = Array.from({ length: 100 }, (_, i) => ({
    student_id: `A${String(i).padStart(3, '0')}`,
    day1_detected: i >= 12,        // 12/100 missed
    day2plus_detected: true,
  }));
  const r = computeDay1MissRate(learners);
  assert.equal(r.rate, 0.12);
  assert.equal(r.decision, 'borderline');
});

test('computeDay1MissRate: empty / non-array → no_data', () => {
  assert.equal(computeDay1MissRate([]).decision, 'no_data');
  assert.equal(computeDay1MissRate(null).decision, 'no_data');
});

// ─── consecutivePhilosophicalCaution (H4) ────────────────

test('🛑 consecutivePhilosophicalCaution: last 3 outcomes all philosophical → true (H4 caution)', () => {
  const events = [
    { event_type: 'philosophical_declaration', timestamp: '2026-06-04' },   // newest
    { event_type: 'philosophical_declaration', timestamp: '2026-06-02' },
    { event_type: 'philosophical_declaration', timestamp: '2026-05-30' },
    { event_type: 'real_escalation',            timestamp: '2026-05-25' },  // older
  ];
  assert.equal(consecutivePhilosophicalCaution(events), true);
});

test('🛑 consecutivePhilosophicalCaution: mixed last 3 → false', () => {
  const events = [
    { event_type: 'philosophical_declaration', timestamp: '2026-06-04' },
    { event_type: 'real_escalation',            timestamp: '2026-06-02' },
    { event_type: 'philosophical_declaration', timestamp: '2026-05-30' },
  ];
  assert.equal(consecutivePhilosophicalCaution(events), false);
});

test('consecutivePhilosophicalCaution: < 3 events → false (not enough signal)', () => {
  const events = [
    { event_type: 'philosophical_declaration', timestamp: '2026-06-04' },
    { event_type: 'philosophical_declaration', timestamp: '2026-06-02' },
  ];
  assert.equal(consecutivePhilosophicalCaution(events), false);
});

test('consecutivePhilosophicalCaution: filters out c2_fired (only outcomes matter)', () => {
  const events = [
    { event_type: 'c2_fired',                  timestamp: '2026-06-05' },   // question, ignore
    { event_type: 'philosophical_declaration', timestamp: '2026-06-04' },
    { event_type: 'c2_fired',                  timestamp: '2026-06-03' },
    { event_type: 'philosophical_declaration', timestamp: '2026-06-02' },
    { event_type: 'philosophical_declaration', timestamp: '2026-05-30' },
  ];
  assert.equal(consecutivePhilosophicalCaution(events), true);
});

test('consecutivePhilosophicalCaution: custom k threshold (e.g. stricter k=4)', () => {
  const events = Array.from({ length: 4 }, () => ({ event_type: 'philosophical_declaration' }));
  assert.equal(consecutivePhilosophicalCaution(events, 4), true);
  assert.equal(consecutivePhilosophicalCaution(events.slice(0, 3), 4), false);
});

test('consecutivePhilosophicalCaution: non-array → false', () => {
  assert.equal(consecutivePhilosophicalCaution(null), false);
  assert.equal(consecutivePhilosophicalCaution(undefined), false);
});

// ─── computeRecallRate ───────────────────────────────────

test('🛑 computeRecallRate: rate < 70% → recall_low', () => {
  const samples = [
    { ai_detected: true,  human_truth: 'passive_dw' },     // TP
    { ai_detected: false, human_truth: 'passive_dw' },     // FN
    { ai_detected: false, human_truth: 'passive_dw' },     // FN
    { ai_detected: true,  human_truth: 'passive_dw' },     // TP
    { ai_detected: true,  human_truth: 'not_passive_dw' }, // FP (ignored for recall)
  ];
  // 2 TP / 4 truth positives = 0.5 recall
  const r = computeRecallRate(samples);
  assert.equal(r.rate, 0.5);
  assert.equal(r.decision, 'recall_low');
});

test('🛑 computeRecallRate: rate >= 70% → healthy', () => {
  const samples = [
    { ai_detected: true,  human_truth: 'passive_dw' },
    { ai_detected: true,  human_truth: 'passive_dw' },
    { ai_detected: true,  human_truth: 'passive_dw' },
    { ai_detected: false, human_truth: 'passive_dw' },
    { ai_detected: false, human_truth: 'not_passive_dw' },
  ];
  // 3 TP / 4 truth positives = 0.75 recall
  const r = computeRecallRate(samples);
  assert.equal(r.rate, 0.75);
  assert.equal(r.decision, 'healthy');
});

test('computeRecallRate: empty / non-array → no_data', () => {
  assert.deepEqual(computeRecallRate([]), { rate: null, decision: 'no_data', sample_size: 0 });
  assert.equal(computeRecallRate(null).decision, 'no_data');
});

test('computeRecallRate: no ground-truth positives → no_data', () => {
  const samples = [
    { ai_detected: false, human_truth: 'not_passive_dw' },
    { ai_detected: false, human_truth: 'not_passive_dw' },
  ];
  const r = computeRecallRate(samples);
  assert.equal(r.decision, 'no_data');
  assert.equal(r.sample_size, 2);
});

// ─── metadata ─────────────────────────────────────────────

test('METRIC_METADATA: frozen + carries spec links', () => {
  assert.ok(Object.isFrozen(METRIC_METADATA));
  assert.equal(METRIC_METADATA.id, 'passive_death_wish');
  assert.ok(METRIC_METADATA.metrics.cross_session_accumulation);
  assert.ok(METRIC_METADATA.metrics.day1_miss_rate);
  assert.ok(METRIC_METADATA.metrics.false_positive_rate);
  assert.ok(METRIC_METADATA.metrics.consecutive_philosophical_caution);
  assert.ok(METRIC_METADATA.metrics.recall_rate);
  assert.match(METRIC_METADATA.patch_source, /safety patch #23/);
});
