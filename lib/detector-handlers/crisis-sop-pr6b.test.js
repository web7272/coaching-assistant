// lib/detector-handlers/crisis-sop-pr6b.test.js
// v5.1 Step 6 PR-6b — Lock carry_forward full write + V6 alignment + structured logs
//                     + M71 / M72 / M73 (ship conditions per Vivi) +
//                     A006 Day 2 + Day 3 V6 E2E (real carry_forward write path, no mocks).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { crisisSopHandler } from './crisis-sop.js';
import {
  buildCrisisCarryForward, updateCarryForwardOnSessionClose,
  selectV6SubBranch, v6ReminderGate, selectDayOpeningVariant,
  V6_SUB_BRANCHES, DAY_OPENING_VARIANTS,
} from './engine-4-mode-aware.js';
import { e4TakeawayHandler } from './engine-4.js';
import {
  SOP_STEPS, CRISIS_AWAITING, CRISIS_CATEGORY, STEP1_VARIANT,
  HANDOFF_VARIANT, REMINDER_OFFER_MAX, SI_RISK_LEVEL,
  buildInitialSopState,
} from '../sub-prompts/crisis/_constants.js';
import { buildFullCarryForward } from '../sub-prompts/crisis/carry-forward-writer.js';
import {
  _setSqlClient, setCrisisStateCarryForward, getUserProfile,
} from '../state/state-manager.js';

// ─── Test SQL mock (NO mocking of carry_forward shape — real state-manager calls) ──

/**
 * makeMockSql — record every SQL call (text + values) and replay rows.
 * Same pattern as lib/state/state-manager.test.js — REAL state-manager logic runs,
 * only the leaf SQL call is captured. carry_forward shape is built by real code.
 */
function makeMockSql(rows = []) {
  const calls = [];
  const fn = (strings, ...values) => {
    const text = strings.reduce((a, s, i) => a + s + (i < values.length ? `$${i + 1}` : ''), '');
    calls.push({ text, values });
    return Promise.resolve(rows);
  };
  fn.calls = calls;
  return fn;
}

// ─── buildCrisisCarryForward: SOP-driven full-schema write ────

test('🛑 buildCrisisCarryForward: w/ crisis_sop_state → full schema via buildFullCarryForward', () => {
  const sessionState = {
    crisis_in_progress: true,
    deep_signal_flags: { passive_dw_detected: true },
    crisis_sop_state: {
      crisis_trigger_category: CRISIS_CATEGORY.PASSIVE_DW_STRONG,
      si_answer: 'confirm', plan_answer: 'has_plan',
      protective_factor_surfaced: '家人',
      handoff_choice: 'b',
      handoff_variant_used: HANDOFF_VARIANT.ONLY_B,
      reminder_variant_used: 'A',
      reminder_offer_count: 1,
      safety_plan: { activities: ['上班', '接小孩'], safe_location: true, self_harm_denied: true },
    },
  };
  const cf = buildCrisisCarryForward(sessionState, { invokedAt: '2026-06-05T18:00:00Z' });
  assert.equal(cf.crisis_category, 'passive_death_wish');
  assert.equal(cf.si_risk_level, SI_RISK_LEVEL.ACTIVE_WITH_PLAN);
  assert.equal(cf.protective_factor_surfaced, '家人');
  assert.equal(cf.handoff_choice, 'b');
  assert.deepEqual(cf.safety_plan.activities, ['上班', '接小孩']);
  assert.equal(cf.safety_plan.safe_location, true);
  assert.equal(cf.safety_plan.self_harm_denied, true);
  // landing errata §2.2 new 3 fields.
  assert.equal(cf.landing_page_reminder_delivered, true);
  assert.equal(cf.professional_referral_acknowledged, false);
  assert.equal(cf.professional_referral_refused, false);
  // Step 5c shell carries through.
  assert.equal(cf.resolved_at, null);
  assert.equal(cf.sessions_since_trigger, 0);
  // Caller-supplied ISO timestamp threaded.
  assert.equal(cf.crisis_triggered_at, '2026-06-05T18:00:00Z');
});

test('🛑 buildCrisisCarryForward: w/o crisis_sop_state → Step 5c fallback shell w/ landing errata defaults', () => {
  const cf = buildCrisisCarryForward(
    { crisis_in_progress: true, deep_signal_flags: { passive_dw_detected: true, passive_dw_signal: 'strong', passive_dw_variant: 'strong' } },
    { invokedAt: '2026-06-05T18:00:00Z' },
  );
  assert.equal(cf.crisis_category, 'passive_dw_strong_strong');
  // landing errata §2.2 defaults present (PR-6b enhancement to fallback).
  assert.equal(cf.landing_page_reminder_delivered, false);
  assert.equal(cf.professional_referral_acknowledged, false);
  assert.equal(cf.professional_referral_refused, false);
  // workflow-safe — no Date.now()
  assert.equal(cf.crisis_triggered_at, '2026-06-05T18:00:00Z');
});

test('🛑 updateCarryForwardOnSessionClose: 3-session no re-trigger w/ invokedAt → auto-resolved w/ ISO', () => {
  let cf = {
    crisis_triggered_at: '2026-06-01T00:00:00Z',
    crisis_category: 'passive_death_wish',
    si_risk_level: 'passive',
    landing_page_reminder_delivered: true,
    sessions_since_trigger: 2,
    resolved_at: null,
  };
  cf = updateCarryForwardOnSessionClose(cf, false, { invokedAt: '2026-06-04T00:00:00Z' });
  assert.equal(cf.sessions_since_trigger, 3);
  assert.equal(cf.resolved_at, '2026-06-04T00:00:00Z');
  assert.equal(cf.resolution_type, 'natural_de_escalation');
  // landing_page_reminder_delivered remains sticky.
  assert.equal(cf.landing_page_reminder_delivered, true);
});

// ─── V6 alignment (landing errata §3.2) ────────────────────

test('🛑 v6ReminderGate: landing_page_reminder_delivered=true → no re-inject reminder in V6', () => {
  const r = v6ReminderGate({ landing_page_reminder_delivered: true, handoff_choice: 'c' });
  assert.equal(r.shouldInjectReminderInV6, false);
  assert.equal(r.reason, 'already_delivered_prior_session');
});

test('🛑 v6ReminderGate: landing_page_reminder_delivered=false → V6 should補 invoke (interrupted prior)', () => {
  const r = v6ReminderGate({ landing_page_reminder_delivered: false, handoff_choice: 'c' });
  assert.equal(r.shouldInjectReminderInV6, true);
  assert.equal(r.reason, 'not_yet_delivered_interrupted_prior');
});

test('v6ReminderGate: null carry_forward → no inject', () => {
  assert.equal(v6ReminderGate(null).shouldInjectReminderInV6, false);
  assert.equal(v6ReminderGate({}).shouldInjectReminderInV6, true);   // empty object = not yet delivered
});

test('🛑 selectV6SubBranch: turn2b SI risk levels (active_no_plan / active_with_plan) → SI_RISK_PASSIVE', () => {
  for (const si of ['passive', 'active_no_plan', 'active_with_plan', 'active', 'high']) {
    assert.equal(selectV6SubBranch({ si_risk_level: si }, 0), V6_SUB_BRANCHES.SI_RISK_PASSIVE,
      `si_risk_level=${si} should route to SI_RISK_PASSIVE`);
  }
});

// ─── M71 — Landing Page Reminder 必執行 (ship 條件) ────────

test('🛑 M71 SHIP CONDITION — SOP audit: SI risk surface + reminder skipped → m71_violation flag', async () => {
  // Build SOP state mimicking a bad path: SI risk surfaced (confirm) but
  // reminder_variant_used is null (programmer / regex bug skipped Step 6).
  const state = {
    crisis_in_progress: true, primary_mode: 'crisis',
    crisis_sop_state: {
      ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
      current_step: SOP_STEPS.STEP_8_CLOSURE,
      awaiting: CRISIS_AWAITING.CLOSURE_ACK,
      si_answer: 'confirm',
      reminder_variant_used: null,    // <-- M71 violation seed
      reminder_offer_count: 0,
    },
  };
  const r = await crisisSopHandler({ session_state: state, user_response: '好' });
  assert.equal(r.handled, true);
  assert.ok(r.patch.m71_reminder_audit);
  assert.equal(r.patch.m71_reminder_audit.delivered, false);
  assert.equal(r.patch.m71_reminder_audit.si_risk_surface_expected_reminder, true);
  assert.equal(r.patch.m71_reminder_audit.violation, true);
});

test('🛑 M71 SHIP CONDITION — SOP audit: reminder delivered → no violation', async () => {
  const state = {
    crisis_in_progress: true, primary_mode: 'crisis',
    crisis_sop_state: {
      ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
      current_step: SOP_STEPS.STEP_8_CLOSURE,
      awaiting: CRISIS_AWAITING.CLOSURE_ACK,
      si_answer: 'confirm',
      reminder_variant_used: 'A',
      reminder_offer_count: 1,
    },
  };
  const r = await crisisSopHandler({ session_state: state, user_response: '好' });
  assert.equal(r.patch.m71_reminder_audit.delivered, true);
  assert.equal(r.patch.m71_reminder_audit.violation, false);
});

test('🛑 M71 SHIP CONDITION — SI denied + factor → no reminder needed → no violation', async () => {
  const state = {
    crisis_in_progress: true, primary_mode: 'crisis',
    crisis_sop_state: {
      ...buildInitialSopState({ category: CRISIS_CATEGORY.TRAUMA, step1Variant: STEP1_VARIANT.A }),
      current_step: SOP_STEPS.STEP_8_CLOSURE,
      awaiting: CRISIS_AWAITING.CLOSURE_ACK,
      si_answer: 'deny',
      protective_factor_surfaced: '家人',
      reminder_variant_used: null,    // not delivered, but not needed either
    },
  };
  const r = await crisisSopHandler({ session_state: state, user_response: '好' });
  assert.equal(r.patch.m71_reminder_audit.delivered, false);
  assert.equal(r.patch.m71_reminder_audit.si_risk_surface_expected_reminder, false);
  assert.equal(r.patch.m71_reminder_audit.violation, false,
    'SI deny path doesn\'t require Step 6 reminder — M71 not violated');
});

// ─── M72 — Reminder ≤ 3 不糾纏 (ship 條件) ──────────────────

test('🛑 M72 SHIP CONDITION — REMINDER_OFFER_MAX = 3', () => {
  assert.equal(REMINDER_OFFER_MAX, 3);
});

test('🛑 M72 SHIP CONDITION — Step 5 dispatch: offer_count >= 3 → SKIP Step 6 reminder, jump straight to Step 7/8', async () => {
  const state = {
    crisis_in_progress: true, primary_mode: 'crisis',
    crisis_sop_state: {
      ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
      current_step: SOP_STEPS.STEP_5_1925,
      awaiting: CRISIS_AWAITING.REMINDER_RESPONSE,
      si_answer: 'confirm',
      reminder_offer_count: REMINDER_OFFER_MAX,   // already at cap
    },
  };
  const r = await crisisSopHandler({
    session_state: state, user_response: '謝謝',
    user_profile: { passive_death_wish_count: 1 },
  });
  // Should not call Step 6 reminder inject — should jump to Step 7 (siRiskSurface) or Step 8.
  assert.equal(r.patch.crisis_sop_state.current_step, SOP_STEPS.STEP_7_SAFETY_PLANNING);
  assert.doesNotMatch(r.inject, /Landing Page 對齊 Reminder/);
});

test('🛑 M72 SHIP CONDITION — Step 5 dispatch: offer_count < 3 → reminder INJECTED', async () => {
  const state = {
    crisis_in_progress: true, primary_mode: 'crisis',
    crisis_sop_state: {
      ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
      current_step: SOP_STEPS.STEP_5_1925,
      awaiting: CRISIS_AWAITING.REMINDER_RESPONSE,
      si_answer: 'confirm',
      reminder_offer_count: 2,    // not yet at cap
    },
  };
  const r = await crisisSopHandler({
    session_state: state, user_response: '謝謝',
    user_profile: { passive_death_wish_count: 1 },
  });
  assert.equal(r.patch.crisis_sop_state.current_step, SOP_STEPS.STEP_6_LANDING_REMINDER);
  assert.match(r.inject, /Landing Page 對齊 Reminder/);
  assert.equal(r.patch.crisis_sop_state.reminder_offer_count, 3);
});

// ─── M73 — Safety Planning 不誤當 long-term intervention (ship 條件) ────────

test('🛑 M73 SHIP CONDITION — Safety Planning 完成不 reset resolved', () => {
  // Build a carry_forward at end of crisis session with safety_plan complete.
  // Verify resolved_at remains null — only natural de-escalation (3 sessions no
  // re-trigger) or explicit Vivi handoff can set resolved_at.
  const cf = buildFullCarryForward({
    sopState: {
      crisis_trigger_category: CRISIS_CATEGORY.PASSIVE_DW_STRONG,
      si_answer: 'confirm', plan_answer: 'no_plan',
      protective_factor_surfaced: '家人',
      handoff_choice: 'a',
      reminder_variant_used: 'A', reminder_offer_count: 1,
      safety_plan: { activities: ['看書'], safe_location: true, self_harm_denied: true },
    },
    invokedAt: '2026-06-05T18:00:00Z',
  });
  // Safety Planning complete (activities + safe_location + self_harm_denied all set).
  assert.equal(cf.safety_plan.activities.length, 1);
  assert.equal(cf.safety_plan.safe_location, true);
  assert.equal(cf.safety_plan.self_harm_denied, true);
  // ⚠️ resolved_at MUST be null — Safety Planning is bridge, not resolution.
  assert.equal(cf.resolved_at, null);
  assert.equal(cf.resolution_type, null);
});

test('🛑 M73 SHIP CONDITION — updateCarryForwardOnSessionClose: re-trigger w/ safety_plan complete → still NOT resolved', () => {
  const prev = {
    crisis_category: 'passive_death_wish', si_risk_level: 'active_no_plan',
    safety_plan: { activities: ['看書'], safe_location: true, self_harm_denied: true },
    landing_page_reminder_delivered: true,
    sessions_since_trigger: 2,
    resolved_at: null,
  };
  // Crisis re-triggered THIS session — reset counter, NOT resolved.
  const next = updateCarryForwardOnSessionClose(prev, true, { invokedAt: '2026-06-05T18:00:00Z' });
  assert.equal(next.sessions_since_trigger, 0);
  assert.equal(next.resolved_at, null);
  assert.equal(next.resolution_type, null);
  // landing_page_reminder_delivered stays sticky.
  assert.equal(next.landing_page_reminder_delivered, true);
});

test('🛑 M73 SHIP CONDITION — updateCarryForwardOnSessionClose: already resolved → no mutation', () => {
  const resolved = {
    resolved_at: '2026-06-01T00:00:00Z',
    resolution_type: 'vivi_handoff_resolved',
    sessions_since_trigger: 5,
  };
  const out = updateCarryForwardOnSessionClose(resolved, false, { invokedAt: '2026-06-05T18:00:00Z' });
  assert.equal(out, resolved, 'idempotent on resolved carry_forward');
});

// ─── A006 Day 2 E2E (real carry_forward write path, no mocks) ────────

test('🛑 E2E A006 Day 2: full 6-turn SOP → setCrisisStateCarryForward real write w/ landing errata §2.2 fields', async () => {
  const sqlCalls = [];
  // Real state-manager: makeMockSql captures the actual SQL the helper emits.
  const sql = makeMockSql();
  _setSqlClient(sql);

  // Simulate 6 turns of crisis SOP (A006 Day 2 emergent path):
  //   Turn 1: deep-signal-detector triggered (passive_dw_strong) — state init only.
  //   Turn 2: student responds to Step 1 → crisis-sop advances Step 1 → Step 2.
  //   Turn 3: student denies SI → crisis-sop advances Step 2 → Step 3.
  //   Turn 4: student surfaces family → crisis-sop advances Step 3 → Step 4 standard.
  //   Turn 5: student picks (c) → Step 5 1925 inject.
  //   Turn 6: student acknowledges 1925 → Step 6 Landing Reminder variant A.
  //   Turn 7: student responds → Step 8 closure (SI denied → no Step 7).

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

  // Turn 3: deny SI.
  r = await crisisSopHandler({ session_state: state, user_response: '沒有', user_profile: profile });
  state = { ...state, crisis_sop_state: r.patch.crisis_sop_state };

  // Turn 4: surface family.
  r = await crisisSopHandler({ session_state: state, user_response: '我有家人', user_profile: profile });
  state = { ...state, crisis_sop_state: r.patch.crisis_sop_state };

  // Turn 5: errata v02 — student doesn't choose abc, any ack advances. Step 4 → Step 5 1925.
  r = await crisisSopHandler({ session_state: state, user_response: '好', user_profile: profile });
  state = { ...state, crisis_sop_state: r.patch.crisis_sop_state };

  // Turn 6: ack 1925.
  r = await crisisSopHandler({ session_state: state, user_response: '謝謝', user_profile: profile });
  state = { ...state, crisis_sop_state: r.patch.crisis_sop_state };

  // Turn 7: ack reminder → Step 6 → Step 8 (SI denied means no Step 7 needed).
  r = await crisisSopHandler({ session_state: state, user_response: '好的', user_profile: profile });
  state = { ...state, crisis_sop_state: r.patch.crisis_sop_state };
  assert.equal(state.crisis_sop_state.current_step, SOP_STEPS.STEP_8_CLOSURE,
    'Step 6 SI-denied path → Step 8');

  // Turn 8: dispatch from Step 8 → emit crisis_sop_complete + M71 audit.
  r = await crisisSopHandler({ session_state: state, user_response: '謝謝', user_profile: profile });
  state = { ...state, crisis_sop_state: r.patch.crisis_sop_state };
  assert.equal(r.patch.crisis_sop_complete, true, 'SOP should signal complete at Step 8');
  assert.ok(r.patch.m71_reminder_audit);
  assert.equal(r.patch.m71_reminder_audit.delivered, true,
    'A006 Day 2 path delivered reminder variant A');
  assert.equal(r.patch.m71_reminder_audit.violation, false);

  // Build REAL carry_forward via the production path (no mock shape).
  const carryForward = buildCrisisCarryForward(state, { invokedAt: '2026-06-05T18:00:00Z' });
  assert.equal(carryForward.crisis_category, 'passive_death_wish');
  assert.equal(carryForward.si_risk_level, SI_RISK_LEVEL.DENIED);
  assert.equal(carryForward.protective_factor_surfaced, '家人');
  // errata v02: handoff_choice always null in new sessions (deprecated).
  assert.equal(carryForward.handoff_choice, null,
    'errata v02: handoff_choice retired (kept in schema for legacy read, null for new sessions)');
  assert.equal(carryForward.landing_page_reminder_delivered, true);
  assert.equal(carryForward.resolved_at, null,
    'M73 — resolved_at MUST be null after crisis session, no matter what');

  // Persist via REAL state-manager (only SQL layer mocked).
  await setCrisisStateCarryForward('A006', carryForward);
  assert.equal(sql.calls.length, 1);
  assert.match(sql.calls[0].text, /INSERT INTO user_profile_evolution/i);
  assert.match(sql.calls[0].text, /ON CONFLICT.*crisis_state_carry_forward/is);
  // SQL value 1 = student_id, value 2 = JSON payload of the full schema.
  assert.equal(sql.calls[0].values[0], 'A006');
  const persisted = JSON.parse(sql.calls[0].values[1]);
  assert.equal(persisted.crisis_category, 'passive_death_wish');
  assert.equal(persisted.handoff_choice, null,
    'errata v02: persisted handoff_choice is null for new sessions');
  assert.equal(persisted.protective_factor_surfaced, '家人');
  assert.equal(persisted.landing_page_reminder_delivered, true);
  assert.equal(persisted.resolved_at, null);

  _setSqlClient(null);
});

// ─── A006 Day 3 V6 E2E (V6 reads REAL carry_forward, no mocks) ────────

test('🛑 E2E A006 Day 3 V6: real carry_forward (handoff_choice=c, reminder_delivered=true) → V6 HANDOFF_C + v6ReminderGate no re-inject', () => {
  // Carry_forward derived from real PR-6b SOP path (Day 2 closure above).
  // Reuse buildFullCarryForward to get the production-shape carry_forward.
  const realCarryForward = buildFullCarryForward({
    sopState: {
      crisis_trigger_category: CRISIS_CATEGORY.PASSIVE_DW_STRONG,
      si_answer: 'deny', plan_answer: null,
      protective_factor_surfaced: '家人',
      handoff_choice: 'c',
      reminder_variant_used: 'A', reminder_offer_count: 1,
      safety_plan: { activities: [], safe_location: null, self_harm_denied: null },
    },
    invokedAt: '2026-06-05T18:00:00Z',
  });

  // Day 3 open — V6 selection reads the REAL carry_forward.
  const dayOpenSelection = selectDayOpeningVariant({
    userProfile: {
      crisis_state_carry_forward: realCarryForward,
      passive_death_wish_count: 1,
      last_session_day_summary: { primary_mode: 'crisis' },
    },
    gapDays: 1,
  });
  assert.equal(dayOpenSelection.variant, DAY_OPENING_VARIANTS.V6,
    'V6 MUST trigger when carry_forward unresolved');
  assert.equal(dayOpenSelection.v6SubBranch, V6_SUB_BRANCHES.HANDOFF_C);

  // V6 reminder gate — landing_page_reminder_delivered = true → don't re-inject reminder.
  const gate = v6ReminderGate(realCarryForward);
  assert.equal(gate.shouldInjectReminderInV6, false);
  assert.equal(gate.reason, 'already_delivered_prior_session');
});

test('🛑 E2E A006 Day 3 V6: interrupted prior (reminder NOT delivered) → V6 SHOULD補 invoke reminder', () => {
  const partialCarryForward = buildFullCarryForward({
    sopState: {
      crisis_trigger_category: CRISIS_CATEGORY.PASSIVE_DW_STRONG,
      si_answer: 'confirm', plan_answer: 'no_plan',
      handoff_choice: 'c',
      reminder_variant_used: null,    // session interrupted before Step 6
      reminder_offer_count: 0,
      safety_plan: { activities: [], safe_location: null, self_harm_denied: null },
    },
    invokedAt: '2026-06-05T18:00:00Z',
  });
  assert.equal(partialCarryForward.landing_page_reminder_delivered, false);
  const gate = v6ReminderGate(partialCarryForward);
  assert.equal(gate.shouldInjectReminderInV6, true);
  assert.equal(gate.reason, 'not_yet_delivered_interrupted_prior');
});

// ─── e4TakeawayHandler: invokedAt threading + landing_page_reminder_delivered sticky ──

test('🛑 e4TakeawayHandler: invokedAt threaded into carry_forward (no Date.now)', async () => {
  const r = await e4TakeawayHandler({
    session_state: {
      primary_mode: 'crisis', active_modes: ['crisis'],
      crisis_in_progress: true,
      crisis_sop_state: {
        crisis_trigger_category: CRISIS_CATEGORY.PASSIVE_DW_STRONG,
        si_answer: 'confirm', plan_answer: 'no_plan',
        protective_factor_surfaced: '家人',
        handoff_choice: 'b',
        reminder_variant_used: 'A', reminder_offer_count: 1,
        safety_plan: { activities: [], safe_location: null, self_harm_denied: true },
      },
      deep_signal_flags: { passive_dw_detected: true },
    },
    user_profile: {},
    now_iso: '2026-06-05T20:00:00Z',
  });
  assert.equal(r.handled, true);
  const cf = r.patch.crisis_state_carry_forward_pending_write;
  assert.ok(cf, 'must emit carry_forward');
  assert.equal(cf.crisis_triggered_at, '2026-06-05T20:00:00Z');
  assert.equal(cf.landing_page_reminder_delivered, true);
});

test('🛑 e4TakeawayHandler: prev carry_forward + this session re-trigger → landing_page_reminder_delivered STICKY (per landing errata §2.2)', async () => {
  const r = await e4TakeawayHandler({
    session_state: {
      primary_mode: 'crisis', active_modes: ['crisis'],
      crisis_in_progress: true,
      crisis_sop_state: {
        crisis_trigger_category: CRISIS_CATEGORY.PASSIVE_DW_STRONG,
        si_answer: 'deny', plan_answer: null,
        handoff_choice: 'a',
        reminder_variant_used: null,    // this session didn't redo reminder
        reminder_offer_count: 0,
        safety_plan: { activities: [], safe_location: null, self_harm_denied: null },
      },
      deep_signal_flags: { passive_dw_detected: true },
    },
    user_profile: {
      crisis_state_carry_forward: {
        landing_page_reminder_delivered: true,   // PRIOR session already delivered
        sessions_since_trigger: 1,
      },
    },
    now_iso: '2026-06-05T20:00:00Z',
  });
  const cf = r.patch.crisis_state_carry_forward_pending_write;
  assert.equal(cf.landing_page_reminder_delivered, true,
    'landing_page_reminder_delivered MUST stay true once set (sticky per landing errata §2.2 reset_on=不 reset)');
});

// ─── Structured logs — 鐵律 #2 (no raw text) ──────────────

test('🛑 logSopEvent: payloads contain enums + counts, NO raw user text', async () => {
  const events = [];
  const origInfo = console.info;
  console.info = (tag, json) => {
    if (tag === '[crisis-sop]') events.push(JSON.parse(json));
  };
  try {
    let state = {
      crisis_in_progress: true,
      crisis_sop_state: {
        ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
        current_step: SOP_STEPS.STEP_2_SI_RISK, awaiting: CRISIS_AWAITING.SI_ANSWER,
      },
    };
    // 學員 surface "沒有" (raw text) — log must NOT contain it.
    await crisisSopHandler({ session_state: state, user_response: '沒有' });
    assert.ok(events.length > 0);
    for (const e of events) {
      const serialized = JSON.stringify(e);
      assert.doesNotMatch(serialized, /沒有/, 'log MUST NOT contain raw user text (鐵律 #2)');
    }
  } finally {
    console.info = origInfo;
  }
});

test('🛑 logSopEvent: emits sop_step_advanced + si_risk_classified at Step 2 transition', async () => {
  const events = [];
  const origInfo = console.info;
  console.info = (tag, json) => {
    if (tag === '[crisis-sop]') events.push(JSON.parse(json));
  };
  try {
    const state = {
      crisis_in_progress: true,
      crisis_sop_state: {
        ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
        current_step: SOP_STEPS.STEP_2_SI_RISK, awaiting: CRISIS_AWAITING.SI_ANSWER,
      },
    };
    await crisisSopHandler({ session_state: state, user_response: '沒有' });
    const eventTypes = events.map(e => e.event);
    assert.ok(eventTypes.includes('sop_step_advanced'));
    assert.ok(eventTypes.includes('si_risk_classified'));
  } finally {
    console.info = origInfo;
  }
});

// ─── state-manager: setCrisisStateCarryForward shape ───────

test('🛑 setCrisisStateCarryForward: ON CONFLICT shape + JSONB payload', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await setCrisisStateCarryForward('A006', {
    crisis_category: 'passive_death_wish',
    handoff_choice: 'c',
    landing_page_reminder_delivered: true,
  });
  assert.equal(sql.calls.length, 1);
  const { text, values } = sql.calls[0];
  assert.match(text, /INSERT INTO user_profile_evolution/i);
  assert.match(text, /ON CONFLICT \(student_id\) DO UPDATE/i);
  assert.match(text, /crisis_state_carry_forward.*::jsonb/is);
  assert.equal(values[0], 'A006');
  const payload = JSON.parse(values[1]);
  assert.equal(payload.crisis_category, 'passive_death_wish');
  assert.equal(payload.landing_page_reminder_delivered, true);
  _setSqlClient(null);
});

test('🛑 setCrisisStateCarryForward: null → UPDATE SET NULL (clear path)', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await setCrisisStateCarryForward('A006', null);
  assert.equal(sql.calls.length, 1);
  assert.match(sql.calls[0].text, /SET\s+crisis_state_carry_forward = NULL/is);
  _setSqlClient(null);
});

test('setCrisisStateCarryForward: rejects bad inputs', async () => {
  _setSqlClient(makeMockSql());
  await assert.rejects(() => setCrisisStateCarryForward('', {}), /student_id/);
  await assert.rejects(() => setCrisisStateCarryForward('A006', [1, 2]), /object or null/);
});
