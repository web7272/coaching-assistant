// lib/dashboard/active-context-tracker.test.js
// v5.2 第五塊 — Lock active_context tracker formulas/labels/edge cases.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORY_CODES, CATEGORY_LABELS, CATEGORY_SHORT_LABELS, PROGRAM_FINAL_DAY,
  aggregateActiveContextDistribution,
  computePerContextCompletion,
  computeOnboardedRate,
  buildActiveContextReport,
  SWAP_ESCALATE_CONSECUTIVE_TURNS, SWAP_LEVELS, classifySwapLevel,
  METRIC_METADATA,
} from './active-context-tracker.js';

// ─── Enum locks (mirror migration 029 + spec §1.3) ───────

test('🛑 CATEGORY_CODES verbatim: [1, 2, 3, 4, 5]', () => {
  assert.deepEqual(CATEGORY_CODES, [1, 2, 3, 4, 5]);
});

test('🛑 CATEGORY_LABELS: 5 categories verbatim from migration 029', () => {
  assert.equal(CATEGORY_LABELS[1], '事業 / 工作 / 金錢');
  assert.equal(CATEGORY_LABELS[2], '親密關係 (伴侶 / 戀愛)');
  assert.equal(CATEGORY_LABELS[3], '家庭 (原生家庭 / 子女)');
  assert.equal(CATEGORY_LABELS[4], '健康 / 身體');
  assert.equal(CATEGORY_LABELS[5], '自我 / 內在狀態 / 心理');
});

test('🛑 CATEGORY_SHORT_LABELS: 5 短字 verbatim', () => {
  assert.deepEqual(CATEGORY_SHORT_LABELS, {
    1: '事業', 2: '親密', 3: '家庭', 4: '健康', 5: '自我',
  });
});

test('🛑 PROGRAM_FINAL_DAY = 21 (matches sessions.day=21 day_complete convention)', () => {
  assert.equal(PROGRAM_FINAL_DAY, 21);
});

// ─── aggregateActiveContextDistribution ──────────────────

test('🛑 distribution: empty / non-array → all zeros + total=0', () => {
  const a = aggregateActiveContextDistribution([]);
  assert.equal(a.total, 0);
  assert.equal(a.unknown_count, 0);
  for (const c of CATEGORY_CODES) assert.equal(a.per_category[c].count, 0);
  const b = aggregateActiveContextDistribution(null);
  assert.equal(b.total, 0);
});

test('🛑 distribution: mix of categories → correct group-by counts', () => {
  const rows = [
    { active_context_category: 1 }, { active_context_category: 1 },
    { active_context_category: 2 }, { active_context_category: 2 }, { active_context_category: 2 },
    { active_context_category: 3 },
    { active_context_category: 5 }, { active_context_category: 5 },
  ];
  const a = aggregateActiveContextDistribution(rows);
  assert.equal(a.total, 8);
  assert.equal(a.per_category[1].count, 2);
  assert.equal(a.per_category[2].count, 3);
  assert.equal(a.per_category[3].count, 1);
  assert.equal(a.per_category[4].count, 0);
  assert.equal(a.per_category[5].count, 2);
  // Labels carried through.
  assert.equal(a.per_category[2].label, '親密關係 (伴侶 / 戀愛)');
  assert.equal(a.per_category[2].short_label, '親密');
});

test('🛑 distribution: invalid category values (0/6/null/NaN/string) → unknown_count', () => {
  const rows = [
    { active_context_category: 0 }, { active_context_category: 6 },
    { active_context_category: null }, { active_context_category: NaN },
    { active_context_category: 'foo' }, { active_context_category: 2 },
  ];
  const a = aggregateActiveContextDistribution(rows);
  assert.equal(a.total, 1, 'only the valid =2 row counts toward total');
  assert.equal(a.unknown_count, 5);
  assert.equal(a.per_category[2].count, 1);
});

// ─── computePerContextCompletion ─────────────────────────

test('🛑 completion: empty → all zeros + total=0', () => {
  const r = computePerContextCompletion([]);
  assert.equal(r.total, 0);
  for (const c of CATEGORY_CODES) {
    assert.equal(r.per_category[c].total, 0);
    assert.equal(r.per_category[c].avg_current_day, 0);
    assert.equal(r.per_category[c].completed_count, 0);
    assert.equal(r.per_category[c].completion_rate, 0);
  }
});

test('🛑 completion: completion = day >= 21; in_progress = 1-20; not_started = 0', () => {
  const rows = [
    { active_context_category: 1, current_day: 0 },     // not_started
    { active_context_category: 1, current_day: 10 },    // in_progress
    { active_context_category: 1, current_day: 21 },    // completed
    { active_context_category: 2, current_day: 21 },
    { active_context_category: 2, current_day: 22 },    // >= 21 also counts completed
    { active_context_category: 5, current_day: 5 },
  ];
  const r = computePerContextCompletion(rows);
  assert.equal(r.total, 6);
  // Category 1
  assert.equal(r.per_category[1].total, 3);
  assert.equal(r.per_category[1].not_started_count, 1);
  assert.equal(r.per_category[1].in_progress_count, 1);
  assert.equal(r.per_category[1].completed_count, 1);
  assert.equal(r.per_category[1].avg_current_day, (0 + 10 + 21) / 3);
  assert.equal(r.per_category[1].completion_rate, 1 / 3);
  // Category 2
  assert.equal(r.per_category[2].total, 2);
  assert.equal(r.per_category[2].completed_count, 2);
  assert.equal(r.per_category[2].completion_rate, 1);
  // Category 5
  assert.equal(r.per_category[5].in_progress_count, 1);
  assert.equal(r.per_category[5].avg_current_day, 5);
});

test('🛑 completion: respects finalDay override (sandbox edge)', () => {
  const rows = [
    { active_context_category: 3, current_day: 10 },
    { active_context_category: 3, current_day: 14 },
  ];
  const r = computePerContextCompletion(rows, { finalDay: 14 });
  assert.equal(r.per_category[3].completed_count, 1);
  assert.equal(r.per_category[3].in_progress_count, 1);
  assert.equal(r.per_category[3].completion_rate, 0.5);
});

test('🛑 completion: defensive — non-finite / negative current_day → not_started', () => {
  const rows = [
    { active_context_category: 4, current_day: -5 },
    { active_context_category: 4, current_day: 'foo' },
    { active_context_category: 4, current_day: null },
  ];
  const r = computePerContextCompletion(rows);
  assert.equal(r.per_category[4].total, 3);
  assert.equal(r.per_category[4].not_started_count, 3);
  assert.equal(r.per_category[4].completion_rate, 0);
  assert.equal(r.per_category[4].avg_current_day, 0);
});

// ─── computeOnboardedRate ────────────────────────────────

test('🛑 onboarded_rate: empty → rate=1, all zeros (defensive default)', () => {
  const r = computeOnboardedRate([]);
  assert.equal(r.total, 0);
  assert.equal(r.rate, 1);
});

test('🛑 onboarded_rate: mix → correct rate + counts', () => {
  const rows = [
    { context_onboarded: true }, { context_onboarded: true }, { context_onboarded: true },
    { context_onboarded: false }, { context_onboarded: false },
  ];
  const r = computeOnboardedRate(rows);
  assert.equal(r.total, 5);
  assert.equal(r.onboarded_count, 3);
  assert.equal(r.not_onboarded_count, 2);
  assert.equal(r.rate, 0.6);
});

test('🛑 onboarded_rate: missing field treated as not onboarded (strict TRUE check)', () => {
  const rows = [
    { context_onboarded: true },
    { context_onboarded: 'true' },     // not strict true
    { /* missing */ },
    { context_onboarded: 1 },          // not strict true
  ];
  const r = computeOnboardedRate(rows);
  assert.equal(r.onboarded_count, 1);
  assert.equal(r.not_onboarded_count, 3);
});

// ─── buildActiveContextReport (master integration) ───────

test('🛑 buildActiveContextReport: integrates all 3 metrics in one call', () => {
  const rows = [
    { active_context_category: 1, current_day: 5,  context_onboarded: true },
    { active_context_category: 1, current_day: 21, context_onboarded: true },
    { active_context_category: 2, current_day: 0,  context_onboarded: false },
    { active_context_category: 3, current_day: 21, context_onboarded: true },
  ];
  const r = buildActiveContextReport(rows);
  // distribution
  assert.equal(r.distribution.total, 4);
  assert.equal(r.distribution.per_category[1].count, 2);
  assert.equal(r.distribution.per_category[2].count, 1);
  assert.equal(r.distribution.per_category[3].count, 1);
  // completion
  assert.equal(r.completion.per_category[1].completed_count, 1);
  assert.equal(r.completion.per_category[1].avg_current_day, 13);
  assert.equal(r.completion.per_category[3].completion_rate, 1);
  // onboarded
  assert.equal(r.onboarded.onboarded_count, 3);
  assert.equal(r.onboarded.rate, 0.75);
});

// ─── classifySwapLevel ───────────────────────────────────

test('🛑 SWAP_ESCALATE_CONSECUTIVE_TURNS = 3 (spec §4.2 連續 3 turn)', () => {
  assert.equal(SWAP_ESCALATE_CONSECUTIVE_TURNS, 3);
});

test('🛑 classifySwapLevel: 0 → healthy', () => {
  assert.equal(classifySwapLevel(0), SWAP_LEVELS.HEALTHY);
});

test('🛑 classifySwapLevel: 1-2 → watching (within tolerance)', () => {
  assert.equal(classifySwapLevel(1), SWAP_LEVELS.WATCHING);
  assert.equal(classifySwapLevel(2), SWAP_LEVELS.WATCHING);
});

test('🛑 classifySwapLevel: 3 → escalate_vivi (threshold crossed)', () => {
  assert.equal(classifySwapLevel(3), SWAP_LEVELS.ESCALATE);
});

test('🛑 classifySwapLevel: 4+ → still escalate_vivi (monotonic)', () => {
  assert.equal(classifySwapLevel(4), SWAP_LEVELS.ESCALATE);
  assert.equal(classifySwapLevel(99), SWAP_LEVELS.ESCALATE);
});

test('🛑 classifySwapLevel: defensive — NaN / negative / non-number → healthy', () => {
  assert.equal(classifySwapLevel(undefined), SWAP_LEVELS.HEALTHY);
  assert.equal(classifySwapLevel(null), SWAP_LEVELS.HEALTHY);
  assert.equal(classifySwapLevel(-5), SWAP_LEVELS.HEALTHY);
  assert.equal(classifySwapLevel('foo'), SWAP_LEVELS.HEALTHY);
});

// ─── METRIC_METADATA shape ───────────────────────────────

test('🛑 METRIC_METADATA: 4 named metrics + spec_ref', () => {
  assert.equal(METRIC_METADATA.id, 'active_context');
  assert.ok(METRIC_METADATA.metrics.active_context_distribution);
  assert.ok(METRIC_METADATA.metrics.per_context_completion);
  assert.ok(METRIC_METADATA.metrics.onboarded_rate);
  assert.ok(METRIC_METADATA.metrics.cross_context_swap_escalate);
  assert.match(METRIC_METADATA.spec_ref, /v52_context_anchored_spec/);
});
