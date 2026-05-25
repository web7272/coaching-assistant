// lib/session/phase-advance.test.js
// checkAdvance exit-condition evaluators + phaseEntryPatch (Q1 patch).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { phaseEntryPatch, checkAdvance, phaseForDay } from './phase-advance.js';

// ─────────────────────────────────────────────────────────
// phaseForDay — v5.0 天數驅動 phase (spec 09 §12, 5/25)
// ─────────────────────────────────────────────────────────

test('🛑 phaseForDay: boundaries — Day 1-4 phase_1, 5-8 phase_2, 9-12 phase_3a, 13-16 phase_4, 17-20 phase_5', () => {
  // phase_1: Day 1-4 (incl. boundary)
  assert.equal(phaseForDay(1), 'phase_1');
  assert.equal(phaseForDay(4), 'phase_1');
  // phase_2: Day 5-8
  assert.equal(phaseForDay(5), 'phase_2');
  assert.equal(phaseForDay(8), 'phase_2');
  // phase_3a: Day 9-12
  assert.equal(phaseForDay(9),  'phase_3a');
  assert.equal(phaseForDay(12), 'phase_3a');
  // phase_4: Day 13-16
  assert.equal(phaseForDay(13), 'phase_4');
  assert.equal(phaseForDay(16), 'phase_4');
  // phase_5: Day 17-20
  assert.equal(phaseForDay(17), 'phase_5');
  assert.equal(phaseForDay(20), 'phase_5');
});

test('🛑 phaseForDay: Day 21+ → integration_retention', () => {
  assert.equal(phaseForDay(21), 'integration_retention');
  assert.equal(phaseForDay(25), 'integration_retention');
  assert.equal(phaseForDay(100), 'integration_retention');
});

test('🛑 phaseForDay: invalid / undefined input → phase_1 (defensive default)', () => {
  assert.equal(phaseForDay(undefined), 'phase_1');
  assert.equal(phaseForDay(null), 'phase_1');
  assert.equal(phaseForDay('not-a-number'), 'phase_1');
  assert.equal(phaseForDay(0), 'phase_1');
  assert.equal(phaseForDay(-3), 'phase_1');
  assert.equal(phaseForDay(NaN), 'phase_1');
});

// ─────────────────────────────────────────────────────────
// phaseEntryPatch — phase-scoped reset (Q1 patch)
// ─────────────────────────────────────────────────────────

test('phaseEntryPatch: always sets current_phase + resets mid_session_takeaway_count', () => {
  const patch = phaseEntryPatch('phase_4');
  assert.equal(patch.current_phase, 'phase_4');
  assert.equal(patch.mid_session_takeaway_count, 0,
    'Q1 patch: mid_session_takeaway_count is phase-scoped, reset on phase entry');
});

test('🛑 phaseEntryPatch: every phase entry resets mid_session_takeaway_count', () => {
  for (const p of ['phase_2', 'phase_3a', 'phase_3b', 'phase_4', 'phase_5']) {
    assert.equal(phaseEntryPatch(p).mid_session_takeaway_count, 0,
      `${p} entry must reset mid_session_takeaway_count`);
  }
});

test('phaseEntryPatch: phase_3a re-inits build_vision_progress', () => {
  const patch = phaseEntryPatch('phase_3a');
  assert.ok(patch.build_vision_progress, 'build_vision_progress object present');
  assert.equal(patch.build_vision_progress.step, 'step_1_build_vision');
  assert.deepEqual(patch.build_vision_progress.vision_components, []);
  assert.equal(patch.build_vision_progress.resistance_resolved, false);
  assert.ok(!('self_concept_progress' in patch), 'no self_concept_progress for 3a');
});

test('phaseEntryPatch: phase_3b re-inits self_concept_progress', () => {
  const patch = phaseEntryPatch('phase_3b');
  assert.ok(patch.self_concept_progress, 'self_concept_progress object present');
  assert.equal(patch.self_concept_progress.sub_step, 'mapping_across');
  assert.deepEqual(patch.self_concept_progress.reference_scenarios, []);
  assert.deepEqual(patch.self_concept_progress.reference_submodalities, []);
  assert.equal(patch.self_concept_progress.counter_examples_count, 0);
  assert.ok(!('build_vision_progress' in patch), 'no build_vision_progress for 3b');
});

test('phaseEntryPatch: phase_2 has neither progress object', () => {
  const patch = phaseEntryPatch('phase_2');
  assert.ok(!('build_vision_progress' in patch));
  assert.ok(!('self_concept_progress' in patch));
});

// ─────────────────────────────────────────────────────────
// checkAdvance — guards
// ─────────────────────────────────────────────────────────

test('checkAdvance: null / non-object → null', () => {
  assert.equal(checkAdvance(null), null);
  assert.equal(checkAdvance(undefined), null);
  assert.equal(checkAdvance('phase_1'), null);
});

test('checkAdvance: unknown current_phase → null', () => {
  assert.equal(checkAdvance({ current_phase: 'phase_99' }), null);
});

test('checkAdvance: program_completed is terminal → null', () => {
  assert.equal(checkAdvance({ current_phase: 'program_completed' }), null);
});

// ─────────────────────────────────────────────────────────
// exit phase_1 → phase_2
// ─────────────────────────────────────────────────────────

test('checkAdvance: phase_1 does NOT advance until top1 + routing both set', () => {
  assert.equal(checkAdvance({ current_phase: 'phase_1' }), null);
  assert.equal(checkAdvance({ current_phase: 'phase_1', top1_value: '勇敢' }), null);
  assert.equal(checkAdvance({
    current_phase: 'phase_1', router_phase: 'identity_test_routing',
  }), null);
});

test('checkAdvance: phase_1 → phase_2 when top1_value + identity_test_routing', () => {
  const r = checkAdvance({
    current_phase: 'phase_1',
    top1_value: '勇敢',
    router_phase: 'identity_test_routing',
  });
  assert.ok(r);
  assert.equal(r.from, 'phase_1');
  assert.equal(r.to, 'phase_2');
  assert.equal(r.regression, false);
  assert.equal(r.patch.current_phase, 'phase_2');
});

// ─────────────────────────────────────────────────────────
// exit phase_2 → phase_3a / phase_3b
// ─────────────────────────────────────────────────────────

test('checkAdvance: phase_2 → phase_3a when current_quality_status owned', () => {
  const r = checkAdvance({ current_phase: 'phase_2', current_quality_status: 'owned' });
  assert.equal(r.to, 'phase_3a');
  assert.equal(r.regression, false);
  assert.ok(r.patch.build_vision_progress, 'entry patch inits build_vision_progress');
});

test('checkAdvance: phase_2 → phase_3b when current_quality_status ambiguous', () => {
  const r = checkAdvance({ current_phase: 'phase_2', current_quality_status: 'ambiguous' });
  assert.equal(r.to, 'phase_3b');
  assert.ok(r.patch.self_concept_progress, 'entry patch inits self_concept_progress');
});

test('checkAdvance: phase_2 stays when status none / candidate', () => {
  assert.equal(checkAdvance({ current_phase: 'phase_2', current_quality_status: 'none' }), null);
  assert.equal(checkAdvance({ current_phase: 'phase_2', current_quality_status: 'candidate' }), null);
});

// ─────────────────────────────────────────────────────────
// exit phase_3a — forward + P10 regression
// ─────────────────────────────────────────────────────────

test('checkAdvance: phase_3a → phase_4 when Let it Work done + takeaway seeded', () => {
  const r = checkAdvance({
    current_phase: 'phase_3a',
    build_vision_progress: { step: 'step_3_let_it_work' },
    takeaway_seeded_this_session: true,
  });
  assert.equal(r.to, 'phase_4');
  assert.equal(r.regression, false);
});

test('checkAdvance: phase_3a stays if takeaway not seeded', () => {
  assert.equal(checkAdvance({
    current_phase: 'phase_3a',
    build_vision_progress: { step: 'step_3_let_it_work' },
    takeaway_seeded_this_session: false,
  }), null);
});

test('checkAdvance: phase_3a → phase_3b P10 regression', () => {
  const r = checkAdvance({
    current_phase: 'phase_3a',
    build_vision_progress: { p10_regression: true },
  });
  assert.equal(r.to, 'phase_3b');
  assert.equal(r.regression, true);
  assert.ok(r.patch.self_concept_progress, 'regression into 3b inits self_concept_progress');
});

// ─────────────────────────────────────────────────────────
// exit phase_3b — forward + Scope Overlap simplified regression
// ─────────────────────────────────────────────────────────

test('checkAdvance: phase_3b → phase_3a simplified (Scope Overlap upgraded to owned)', () => {
  const r = checkAdvance({
    current_phase: 'phase_3b',
    self_concept_progress: { scope_overlap_applied: true },
    current_quality_status: 'owned',
  });
  assert.equal(r.to, 'phase_3a');
  assert.equal(r.regression, true);
  assert.ok(r.patch.build_vision_progress);
});

test('checkAdvance: phase_3b → phase_4 when owned_via_acceptance', () => {
  const r = checkAdvance({
    current_phase: 'phase_3b',
    current_quality_status: 'owned_via_acceptance',
  });
  assert.equal(r.to, 'phase_4');
  assert.equal(r.regression, false);
});

test('checkAdvance: phase_3b stays when scope_overlap applied but not yet owned', () => {
  assert.equal(checkAdvance({
    current_phase: 'phase_3b',
    self_concept_progress: { scope_overlap_applied: true },
    current_quality_status: 'ambiguous',
  }), null);
});

// ─────────────────────────────────────────────────────────
// exit phase_4 → phase_5
// ─────────────────────────────────────────────────────────

test('checkAdvance: phase_4 → phase_5 when cascade_down completed', () => {
  const r = checkAdvance({
    current_phase: 'phase_4',
    cascade_down_progress: { status: 'completed' },
  });
  assert.equal(r.to, 'phase_5');
});

test('checkAdvance: phase_4 stays when cascade still in progress', () => {
  assert.equal(checkAdvance({
    current_phase: 'phase_4',
    cascade_down_progress: { status: 'in_progress' },
  }), null);
});

// ─────────────────────────────────────────────────────────
// exit phase_5 → integration_retention / program_completed
// ─────────────────────────────────────────────────────────

test('checkAdvance: phase_5 → integration_retention when export done, day < 21', () => {
  const r = checkAdvance({
    current_phase: 'phase_5',
    export_prompt_generated_at: '2026-05-21T00:00:00Z',
    calendar_day_count: 7,
  });
  assert.equal(r.to, 'integration_retention');
});

test('checkAdvance: phase_5 → program_completed when export done, day >= 21', () => {
  const r = checkAdvance({
    current_phase: 'phase_5',
    export_prompt_generated_at: '2026-05-21T00:00:00Z',
    calendar_day_count: 21,
  });
  assert.equal(r.to, 'program_completed');
});

test('checkAdvance: phase_5 stays until export generated', () => {
  assert.equal(checkAdvance({ current_phase: 'phase_5', calendar_day_count: 7 }), null);
});

// ─────────────────────────────────────────────────────────
// exit integration_retention → program_completed
// ─────────────────────────────────────────────────────────

test('checkAdvance: integration_retention → program_completed at day 21', () => {
  const r = checkAdvance({ current_phase: 'integration_retention', calendar_day_count: 21 });
  assert.equal(r.to, 'program_completed');
});

test('checkAdvance: integration_retention stays before day 21', () => {
  assert.equal(checkAdvance({ current_phase: 'integration_retention', calendar_day_count: 14 }), null);
});
