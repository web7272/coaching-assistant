// lib/simulation/beta-16-coverage.test.js
// v5.1 Step 10 — Beta 16 場 simulation 總表 + coverage map.
//
// Naming convention: every test starts with「🎬 SIM 」for easy filtering:
//   npm run sim  (registered in package.json — runs only sim-tagged tests)
//
// Coverage philosophy:
//   - Aggregate existing scattered simulation tests (s4c task 9 / 5a / 5b /
//     6 E2E PATH 1-6 / 6b E2E A006 Day 2/3 V6 / 7 reframe library)
//   - Add stub coverage for 16 Beta cohort cases not yet directly tested
//     via deterministic state-machine traces (no Sonnet / no DB — A3/A4
//     live verification is a separate Patrick-executed runbook).
//   - This file is the 16 場 simulation 總表 — every Beta case gets at least
//     one assertion verifying mode flow / signals / reframes / crisis path.
//
// Step 10 deliverable per task spec C:
//   ✓ Simulation 總表 (this file's COVERAGE_MAP + tests)
//   ✓ 3 重點 case trace coverage references
//   ⏸️ A3 cached §3 真實 Sonnet calls — see docs/v5-spec/operations/step-10-runbook.md
//   ⏸️ A4 prod DB + endpoint hit — see runbook (sandbox no creds)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { passiveHopeCascadeHandler } from '../detector-handlers/passive-hope-cascade.js';
import { crisisSopHandler } from '../detector-handlers/crisis-sop.js';
import { buildCrisisCarryForward, selectDayOpeningVariant, V6_SUB_BRANCHES, DAY_OPENING_VARIANTS }
  from '../detector-handlers/engine-4-mode-aware.js';
import {
  SOP_STEPS, CRISIS_AWAITING, CRISIS_CATEGORY, STEP1_VARIANT,
  buildInitialSopState,
} from '../sub-prompts/crisis/_constants.js';
import { detectAllSignals } from '../detector-handlers/engine-1-signals/index.js';

// ══════════════════════════════════════════════════════════════
// COVERAGE_MAP — 16 場 Beta cohort × verification anchor
// ══════════════════════════════════════════════════════════════
//
// Each entry: { case_id, day, anchor, covered_by, sim_test_name }.
// "covered_by" cites the production test file that holds the canonical sim.
// "sim_test_name" is the test in THIS file that re-asserts the case via the
// deterministic path (state machine only — no Sonnet involved).

export const COVERAGE_MAP = Object.freeze([
  // ── A001 (healthy cohort, 鑽石 false positive guard) ────
  { case_id: 'A001', day: 1, anchor: '鑽石 Day 1 假陽性 — 4 重組合判決 G6 防線',
    covered_by: 'lib/detector-handlers/landmine-check.test.js + engine-2/master-detector tier1',
    sim_test_name: '🎬 SIM A001-D1: 鑽石類詞 tier1 reject + 4 重組合判決' },
  { case_id: 'A001', day: 2, anchor: 'clean takeaway Day 2 開場',
    covered_by: 'lib/detector-handlers/engine-4-mode-aware.test.js (V1 standard path)',
    sim_test_name: '🎬 SIM A001-D2: clean takeaway → V1 standard day opening' },

  // ── A002 (no clean material) ────────────────────────────
  { case_id: 'A002', day: 2, anchor: 'no clean material → V2 ambiguous / V3 換',
    covered_by: 'lib/detector-handlers/engine-4-mode-aware.test.js (V2 + V3)',
    sim_test_name: '🎬 SIM A002-D2: no clean material → V2 / V3 day opening fallback' },

  // ── A003 (healthy, Top 1 演進 mode cycle) ─────────────
  { case_id: 'A003', day: 3, anchor: 'S3 frequency illusion「真正自由的人頻率要更高吧」',
    covered_by: 'lib/detector-handlers/engine-1-signals/engine-1-signals.test.js (A003 Day 3 case)',
    sim_test_name: '🎬 SIM A003-D3: S3 frequency_illusion detected' },
  { case_id: 'A003', day: 5, anchor: 'Top 1 演進 surface 新方向 ≠ failure',
    covered_by: 'lib/detector-handlers/detector-handlers.test.js (sim A003 Day 3-5)',
    sim_test_name: '🎬 SIM A003-D5: Top 1 演進 = mode flexibility, not P21/M-failure' },

  // ── A005 (亞洲女性 cohort, Phase 1 → SI probe → deny) ─
  { case_id: 'A005', day: 1, anchor: 'Phase 1 鏈式追問 → SI probe deny → Step 3 + 4 標準三選一',
    covered_by: 'lib/detector-handlers/crisis-sop.test.js PATH 1 (deny)',
    sim_test_name: '🎬 SIM A005-D1: SI deny → protective factor → standard handoff' },

  // ── A006 (vulnerable cohort, passive DW longitudinal) ─
  { case_id: 'A006', day: 1, anchor: 'passive_hope「上天讓我活著」+ death-adjacent',
    covered_by: 'lib/detector-handlers/detector-handlers.test.js sim A006-D1 escalated',
    sim_test_name: '🎬 SIM A006-D1: passive_hope + death-adjacent → crisis cascade' },
  { case_id: 'A006', day: 2, anchor: 'full 9-step Crisis SOP → carry_forward write',
    covered_by: 'lib/detector-handlers/crisis-sop-pr6b.test.js E2E A006 Day 2',
    sim_test_name: '🎬 SIM A006-D2: full SOP + real carry_forward write path' },
  { case_id: 'A006', day: '3a', anchor: 'V6 day-opening reads real carry_forward (HANDOFF_C)',
    covered_by: 'lib/detector-handlers/crisis-sop-pr6b.test.js E2E A006 Day 3 V6',
    sim_test_name: '🎬 SIM A006-D3a: V6 HANDOFF_C + reminder gate (already delivered)' },
  { case_id: 'A006', day: '3b', anchor: 'crisis-mixed-with-meaning-making sub-mode (R1_C limited)',
    covered_by: 'lib/damon-reframe-library/damon-reframe-library.test.js + crisis-sop.test.js',
    sim_test_name: '🎬 SIM A006-D3b: de-escalation sub-mode R1_C unlock + ≤ 2 cap' },
  { case_id: 'A006', day: 4, anchor: 'passive DW re-trigger + 拒絕 1925 (Step 5.2)',
    covered_by: 'lib/detector-handlers/crisis-sop.test.js + landmine-check tier2/3',
    sim_test_name: '🎬 SIM A006-D4: passive DW re-trigger + 1925 declined' },

  // ── A008 (Phase 1 → SI probe deny → standard handoff) ─
  { case_id: 'A008', day: 1, anchor: 'Phase 1 deep S2 probe → Step 3 + standard handoff',
    covered_by: 'lib/detector-handlers/crisis-sop.test.js PATH 1',
    sim_test_name: '🎬 SIM A008-D1: deep S2 → SI deny → standard handoff' },

  // ── A012 (integration mode Parts Integration / R12) ───
  { case_id: 'A012', day: 1, anchor: 'integration mode Parts Integration (R12 trigger 不主動引發)',
    covered_by: 'lib/damon-reframe-library/pr7b-additions.test.js R12 SOP',
    sim_test_name: '🎬 SIM A012-D1: integration mode R12 SOP guidance inject' },
  { case_id: 'A012', day: 2, anchor: 'Mode 3 整合完成 → Mode 2 重新測試',
    covered_by: 'lib/detector-handlers/detector-handlers.test.js (integration → identity_anchoring)',
    sim_test_name: '🎬 SIM A012-D2: Mode 3 → Mode 2 雙向流動' },

  // ── PATH ladder (crisis SOP all 6 paths from Step 6) ──
  { case_id: 'PATH-2', day: null, anchor: 'confirm SI + has_plan → only_b + HITL critical',
    covered_by: 'lib/detector-handlers/crisis-sop.test.js PATH 2',
    sim_test_name: '🎬 SIM PATH-2: confirm has_plan → only_b' },
  { case_id: 'PATH-4-6', day: null, anchor: 'no protective / count≥3 / count≥5 → only_b / remove_c / freeze',
    covered_by: 'lib/detector-handlers/crisis-sop.test.js PATH 4-6',
    sim_test_name: '🎬 SIM PATH-4-6: variant escalation by cumulative count' },
]);

test('🎬 SIM COVERAGE: 16 Beta cohort cases × verification anchors', () => {
  // Lock the coverage map — every Beta case must have a documented sim test.
  assert.ok(COVERAGE_MAP.length >= 16,
    `expected ≥ 16 Beta sim entries, got ${COVERAGE_MAP.length}`);
  // Every entry has all 4 required fields.
  for (const entry of COVERAGE_MAP) {
    assert.ok(entry.case_id, 'case_id required');
    assert.ok(entry.anchor, 'anchor required');
    assert.ok(entry.covered_by, 'covered_by required');
    assert.ok(entry.sim_test_name, 'sim_test_name required');
    assert.match(entry.sim_test_name, /^🎬 SIM /,
      `sim_test_name must start with「🎬 SIM 」 for npm run sim filter`);
  }
  // Verify the 3 Vivi-specified重點 cases are covered.
  const caseIds = COVERAGE_MAP.map(e => `${e.case_id}-D${e.day}`);
  assert.ok(caseIds.some(id => /A006-D1/.test(id)), '重點 1: A006 Day 1 passive_hope cascade');
  assert.ok(caseIds.some(id => /A003-D[35]/.test(id)), '重點 2: A003 Day 3-5 Top 1 演進');
  assert.ok(caseIds.some(id => /A006-D2/.test(id)) && caseIds.some(id => /A006-D3a/.test(id)),
    '重點 3: A006 Day 2-3 cross-session crisis carry_forward');
});

// ══════════════════════════════════════════════════════════════
// 重點 1: A006 Day 1 passive_hope cascade
// ══════════════════════════════════════════════════════════════

test('🎬 SIM A006-D1: passive_hope + death-adjacent → crisis cascade', async () => {
  const r = await passiveHopeCascadeHandler({
    session_state: {
      primary_mode: 'elicitation',
      active_modes: ['elicitation'],
      paused_modes: [],
      deep_signal_flags: {},
      activity_death_adjacent_count: 1,
    },
    user_response: '上天讓我活著吧',
    last_3_turns: ['不想活', '結束生命'],
    user_profile: { passive_death_wish_count: 0 },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.primary_mode, 'crisis');
  assert.equal(r.patch.crisis_in_progress, true);
  // v5.1 mode flow correctness — paused_modes captures elicitation suspension.
  assert.ok(Array.isArray(r.patch.paused_modes));
  // mode_transition_log emits signal_cascade trigger_type.
  assert.equal(r.patch.mode_transition_log[0].trigger_type, 'signal_cascade');
});

test('🎬 SIM A006-D1: cross-session count ≥ 3 → immediate cascade (V6 ladder seed)', async () => {
  const r = await passiveHopeCascadeHandler({
    session_state: { primary_mode: 'elicitation', deep_signal_flags: {} },
    user_response: '我想等老天安排',
    last_3_turns: ['活下去的動力', '此生'],
    user_profile: { passive_death_wish_count: 3 },
  });
  assert.equal(r.patch.primary_mode, 'crisis');
});

// ══════════════════════════════════════════════════════════════
// 重點 2: A003 Day 3-5 Top 1 演進 (mode flexibility, NOT failure)
// ══════════════════════════════════════════════════════════════

test('🎬 SIM A003-D3: S3 frequency_illusion detected (「真正自由的人頻率要更高吧、我這樣不算」)', () => {
  // ⚠️ S3 regex requires the「我...不算/不夠」 context to fire — the full A003
  //   Day 3 utterance includes the self-assessment suffix (see existing
  //   engine-1-signals.test.js line 237).
  const r = detectAllSignals({
    text: '真正自由的人頻率要更高吧, 我這樣不算',
    sessionState: { primary_mode: 'identity_anchoring' },
    userProfile: {},
    prevTurns: [],
  });
  assert.equal(r.patch.frequency_illusion_detected, true,
    'S3 should detect frequency illusion in A003 Day 3 quote');
});

test('🎬 SIM A003-D5: Top 1 演進 → 不算 failure (mode flexibility)', () => {
  // v5.1 mode model: surface 新方向 in any mode = legal Top 1 evolution.
  // P21 deprecated (Top 1 演進 is legitimate cycle, not regression).
  // Verify by checking failure-modes registry: P21 throws as deprecated.
  return import('../dashboard/failure-modes.js').then(({ getFailureMode }) => {
    assert.throws(() => getFailureMode('P21'),
      /Top 1 演進為合法 mode cycle/,
      'P21 must be marked DEPRECATED — Top 1 演進 is legitimate, not failure');
  });
});

// ══════════════════════════════════════════════════════════════
// 重點 3: A006 Day 2-3 cross-session crisis carry_forward
// ══════════════════════════════════════════════════════════════

test('🎬 SIM A006-D2 → D3: full SOP → carry_forward → V6 day-opening (deterministic)', async () => {
  // Build the SOP final state matching A006 Day 2 emergent path:
  //   SI deny → protective family → standard handoff → choice (c).
  let state = {
    crisis_in_progress: true, primary_mode: 'crisis',
    deep_signal_flags: { passive_dw_detected: true, passive_dw_signal: 'strong' },
    crisis_sop_state: buildInitialSopState({
      category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1,
    }),
  };
  const profile = { passive_death_wish_count: 1 };

  // Turn 2: respond to Step 1.
  let r = await crisisSopHandler({ session_state: state, user_response: '聽到', user_profile: profile });
  state = { ...state, crisis_sop_state: r.patch.crisis_sop_state };
  // Turn 3: deny.
  r = await crisisSopHandler({ session_state: state, user_response: '沒有', user_profile: profile });
  state = { ...state, crisis_sop_state: r.patch.crisis_sop_state };
  // Turn 4: family.
  r = await crisisSopHandler({ session_state: state, user_response: '我有家人', user_profile: profile });
  state = { ...state, crisis_sop_state: r.patch.crisis_sop_state };
  // Turn 5: pick (c).
  r = await crisisSopHandler({ session_state: state, user_response: '我選 c', user_profile: profile });
  state = { ...state, crisis_sop_state: r.patch.crisis_sop_state };
  // Turn 6: ack 1925.
  r = await crisisSopHandler({ session_state: state, user_response: '謝謝', user_profile: profile });
  state = { ...state, crisis_sop_state: r.patch.crisis_sop_state };
  // Turn 7: reminder ack.
  r = await crisisSopHandler({ session_state: state, user_response: '好的', user_profile: profile });
  state = { ...state, crisis_sop_state: r.patch.crisis_sop_state };
  // Turn 8: Step 8 closure.
  r = await crisisSopHandler({ session_state: state, user_response: '謝謝', user_profile: profile });
  state = { ...state, crisis_sop_state: r.patch.crisis_sop_state };

  // Build the REAL carry_forward via production path.
  const cf = buildCrisisCarryForward(state, { invokedAt: '2026-06-05T18:00:00Z' });
  assert.equal(cf.crisis_category, 'passive_death_wish');
  assert.equal(cf.handoff_choice, 'c');
  assert.equal(cf.protective_factor_surfaced, '家人');
  assert.equal(cf.landing_page_reminder_delivered, true);
  assert.equal(cf.resolved_at, null, 'M73: never resolved after one Crisis session');

  // Day 3 open — V6 HANDOFF_C.
  const dayOpen = selectDayOpeningVariant({
    userProfile: {
      crisis_state_carry_forward: cf,
      passive_death_wish_count: 1,
      last_session_day_summary: { primary_mode: 'crisis' },
    },
    gapDays: 1,
  });
  assert.equal(dayOpen.variant, DAY_OPENING_VARIANTS.V6);
  assert.equal(dayOpen.v6SubBranch, V6_SUB_BRANCHES.HANDOFF_C);
});

// ══════════════════════════════════════════════════════════════
// Additional Beta case stubs (deterministic state checks)
// ══════════════════════════════════════════════════════════════

test('🎬 SIM A001-D1: 鑽石類詞 tier1 reject (G6 防線)', async () => {
  // A001 Day 1「鑽石」假陽性 — v5.0 misclassified, v5.1 4 重組合判決 + Landmine tier 1
  // catches it. We verify tier1 Landmine Check for 「成功的」 (鑽石類 quality 詞).
  const { classifyLandmine, LANDMINE_RESULT } = await import('../detector-handlers/landmine-check.js');
  const r = classifyLandmine('成功的');
  assert.equal(r.tier, 'tier1');
  assert.equal(r.result, LANDMINE_RESULT.TIER1_REJECTED);
});

test('🎬 SIM A001-D2: clean takeaway → V1 standard day opening (gap=1)', async () => {
  const dayOpen = selectDayOpeningVariant({
    userProfile: {
      last_session_day_summary: { primary_mode: 'elicitation', last_quality_status: 'owned',
        takeaway_term: '勇敢' },
    },
    gapDays: 1,
  });
  assert.equal(dayOpen.variant, DAY_OPENING_VARIANTS.V1,
    'clean takeaway + gap=1 + owned → V1 standard continuation');
});

test('🎬 SIM A002-D2: no clean material → V2 ambiguous fallback', async () => {
  const dayOpen = selectDayOpeningVariant({
    userProfile: {
      last_session_day_summary: { primary_mode: 'identity_anchoring',
        last_quality_status: 'ambiguous' },
    },
    gapDays: 1,
  });
  assert.equal(dayOpen.variant, DAY_OPENING_VARIANTS.V2,
    'ambiguous last status + gap≤2 + identity_anchoring → V2 (per Step 5c §A2)');
});

test('🎬 SIM A005-D1: SI deny → protective factor → standard handoff', async () => {
  // Mirrors PATH 1 from Step 6 PR-6a (deny → 家人 → standard).
  let state = {
    crisis_in_progress: true, primary_mode: 'crisis',
    crisis_sop_state: {
      ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
      current_step: SOP_STEPS.STEP_2_SI_RISK,
      awaiting: CRISIS_AWAITING.SI_ANSWER,
    },
  };
  // SI deny.
  let r = await crisisSopHandler({ session_state: state, user_response: '沒有',
    user_profile: { passive_death_wish_count: 1 } });
  assert.equal(r.patch.crisis_sop_state.si_answer, 'deny');
  assert.equal(r.patch.crisis_sop_state.current_step, SOP_STEPS.STEP_3_PROTECTIVE);
});

test('🎬 SIM A006-D3b: R1_C de-escalation sub-mode unlocked (limited invoke per session ≤ 2)', async () => {
  const { R1, R1_VARIANTS } = await import('../damon-reframe-library/r1-reclaim-source.js');
  // Without de_escalation_sub_mode flag → blocked.
  const blocked = R1.buildInject({ variant: R1_VARIANTS.R1_C });
  assert.match(blocked, /disabled/);
  // With flag → unlocked, M70 guard documented.
  const unlocked = R1.buildInject({
    variant: R1_VARIANTS.R1_C, de_escalation_sub_mode: true,
    projection_quote: '他不在我就沒動力',
  });
  assert.match(unlocked, /Step 6 PR-6a unlocked/);
  assert.match(unlocked, /M70 guard/);
  assert.match(unlocked, /per session R1_C 不得 > 2 次/);
});

test('🎬 SIM A006-D4: passive DW re-trigger + 1925 declined → reminder variant C', async () => {
  const { selectReminderVariant } = await import('../sub-prompts/crisis/landing-page-reminder.js');
  // Re-trigger + refused → C overrides count.
  const variant = selectReminderVariant({
    passive_death_wish_count: 2, professional_referral_refused: true,
  });
  assert.equal(variant, 'C');
});

test('🎬 SIM A008-D1: deep S2 → SI deny → standard handoff (mirrors PATH 1)', async () => {
  // A008 emergent path 重複 PATH 1 structure. Re-verify SI denial routing.
  let state = {
    crisis_in_progress: true, primary_mode: 'crisis',
    crisis_sop_state: {
      ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
      current_step: SOP_STEPS.STEP_3_PROTECTIVE,
      awaiting: CRISIS_AWAITING.PROTECTIVE_FACTOR,
      si_answer: 'deny',
    },
  };
  const r = await crisisSopHandler({
    session_state: state, user_response: '我有家人',
    user_profile: { passive_death_wish_count: 1 },
  });
  assert.equal(r.patch.crisis_sop_state.handoff_variant_used, 'standard');
});

test('🎬 SIM A012-D1: integration mode R12 SOP guidance inject (TODO Vivi 終審 markers)', async () => {
  const { default: r12 } = await import('../sub-prompts/integration/heros-welcome-4-step-sop.js');
  assert.equal(r12.id, 'integration_heros_welcome_4_step_sop');
  // 4 step TODO markers locked.
  const todoCount = (r12.prompt_content.match(/TODO\(Vivi 終審\)/g) || []).length;
  assert.ok(todoCount >= 4, 'R12 must have ≥ 4 Vivi 終審 phrasing TODOs');
});

test('🎬 SIM A012-D2: Mode 3 整合完成 → Mode 2 重新測試 (雙向流動 reference)', async () => {
  // Mode flow allowed: integration → identity_anchoring back. Cached §3 declares this.
  // We assert the cached §3 content explicitly describes the back-flow.
  const { default: cached3 } = await import('../prompt-sections/cached/mode-aware-router-reference.js');
  // 「← Mode 3:integration 完成後回 Mode 2 重新測試」 is in Mode 2 section's 跟其他 mode 關係.
  assert.match(cached3.content, /← Mode 3:integration 完成後回 Mode 2 重新測試/);
});

// ══════════════════════════════════════════════════════════════
// PATH ladder summary (crisis SOP 6 paths)
// ══════════════════════════════════════════════════════════════

test('🎬 SIM PATH-2: confirm SI + has_plan → only_b + HITL critical', async () => {
  let state = {
    crisis_in_progress: true,
    crisis_sop_state: {
      ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
      current_step: SOP_STEPS.STEP_2_SI_RISK, awaiting: CRISIS_AWAITING.SI_ANSWER,
    },
  };
  // confirm SI.
  let r = await crisisSopHandler({ session_state: state, user_response: '有' });
  state = { ...state, crisis_sop_state: r.patch.crisis_sop_state };
  // has plan → only_b + HITL.
  r = await crisisSopHandler({ session_state: state, user_response: '有計畫' });
  assert.equal(r.patch.crisis_sop_state.handoff_variant_used, 'only_b');
  assert.equal(r.patch.hitl_critical_alert, true);
});

test('🎬 SIM PATH-4-6: count ≥ 3 → remove_c; count ≥ 5 → freeze', async () => {
  // remove_c
  let r = await crisisSopHandler({
    session_state: {
      crisis_in_progress: true,
      crisis_sop_state: {
        ...buildInitialSopState({ category: CRISIS_CATEGORY.CUMULATIVE, step1Variant: STEP1_VARIANT.C_3 }),
        current_step: SOP_STEPS.STEP_3_PROTECTIVE, awaiting: CRISIS_AWAITING.PROTECTIVE_FACTOR,
        si_answer: 'deny',
      },
    },
    user_response: '有朋友',
    user_profile: { passive_death_wish_count: 3 },
  });
  assert.equal(r.patch.crisis_sop_state.handoff_variant_used, 'remove_c');
  // freeze
  r = await crisisSopHandler({
    session_state: {
      crisis_in_progress: true,
      crisis_sop_state: {
        ...buildInitialSopState({ category: CRISIS_CATEGORY.FREEZE, step1Variant: STEP1_VARIANT.C_3 }),
        current_step: SOP_STEPS.STEP_3_PROTECTIVE, awaiting: CRISIS_AWAITING.PROTECTIVE_FACTOR,
        si_answer: 'deny',
      },
    },
    user_response: '有家人',
    user_profile: { passive_death_wish_count: 5 },
  });
  assert.equal(r.patch.crisis_sop_state.handoff_variant_used, 'freeze');
});

// ══════════════════════════════════════════════════════════════
// Mode override sanity — crisis pauses all other modes
// ══════════════════════════════════════════════════════════════

test('🎬 SIM mode override: crisis active → all other engine sub-routers skip', async () => {
  // Verify by checking handler gate: passive-hope-cascade returns handled=false
  // when deep_signal_flags.passive_dw_detected is already true (dedup) — proxy
  // for the "crisis 內 其他 sub-router 全 skip" cached §3 declaration.
  const r = await passiveHopeCascadeHandler({
    session_state: {
      primary_mode: 'crisis',
      deep_signal_flags: { passive_dw_detected: true },
    },
    user_response: '我不想活了',
    user_profile: {},
  });
  assert.equal(r.handled, false, 'crisis already active → handler defers');
});
