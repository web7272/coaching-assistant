// lib/detector-handlers/engine-4-mode-aware.test.js
// v5.1 Step 5c — Lock V6 selection + mode-aware takeaway + carry_forward plumbing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  DAY_OPENING_VARIANTS, V6_SUB_BRANCHES, V6_SUB_BRANCH_PHRASING,
  selectV6SubBranch, selectDayOpeningVariant,
  TAKEAWAY_MODE_PHRASING, selectTakeawayPhrasing,
  deriveTakeawayTerm, isTakeawayDuplicate,
  buildLastSessionDaySummary,
  buildCrisisCarryForward, updateCarryForwardOnSessionClose,
} from './engine-4-mode-aware.js';
import { e4DayOpeningHandler, e4TakeawayHandler } from './engine-4.js';

// ─── V6 selection ────────────────────────────────────────

test('🛑 selectV6SubBranch: passive_dw_count >= 3 → cross_count_3_plus (Patch 23 align)', () => {
  const r = selectV6SubBranch({}, 3);
  assert.equal(r, V6_SUB_BRANCHES.CROSS_COUNT_3_PLUS);
  const r2 = selectV6SubBranch({ handoff_choice: 'a' }, 5);
  // cross-count >= 3 wins even over handoff_choice.
  assert.equal(r2, V6_SUB_BRANCHES.CROSS_COUNT_3_PLUS);
});

test('🛑 selectV6SubBranch: si_risk_level=passive → si_risk_passive', () => {
  const r = selectV6SubBranch({ si_risk_level: 'passive' }, 0);
  assert.equal(r, V6_SUB_BRANCHES.SI_RISK_PASSIVE);
});

test('🛑 selectV6SubBranch: handoff_choice=c → handoff_c', () => {
  const r = selectV6SubBranch({ handoff_choice: 'c' }, 0);
  assert.equal(r, V6_SUB_BRANCHES.HANDOFF_C);
});

test('🛑 selectV6SubBranch: handoff_choice=a → handoff_a', () => {
  const r = selectV6SubBranch({ handoff_choice: 'a' }, 0);
  assert.equal(r, V6_SUB_BRANCHES.HANDOFF_A);
});

test('selectV6SubBranch: no carry_forward → null', () => {
  assert.equal(selectV6SubBranch(null, 0), null);
  assert.equal(selectV6SubBranch({}, 0), null);
});

// ─── V6 phrasing (ship-able per spec §A2) ────────────────

test('🛑 V6_SUB_BRANCH_PHRASING: handoff_c contains spec-given「我看到你回來了」', () => {
  assert.match(V6_SUB_BRANCH_PHRASING[V6_SUB_BRANCHES.HANDOFF_C], /我看到你回來了/);
  assert.match(V6_SUB_BRANCH_PHRASING[V6_SUB_BRANCHES.HANDOFF_C], /可以先停在這、聊輕一點的/);
});

test('🛑 V6_SUB_BRANCH_PHRASING: si_risk_passive contains 1925 line + de-escalation framing', () => {
  const txt = V6_SUB_BRANCH_PHRASING[V6_SUB_BRANCHES.SI_RISK_PASSIVE];
  assert.match(txt, /1925/);
  assert.match(txt, /上次我們聊到的那個/);
  assert.match(txt, /24 小時/);
});

test('🛑 V6_SUB_BRANCH_PHRASING: cross_count_3_plus contains Vivi referral phrasing', () => {
  const txt = V6_SUB_BRANCH_PHRASING[V6_SUB_BRANCHES.CROSS_COUNT_3_PLUS];
  assert.match(txt, /Vivi 知道你的狀況/);
  assert.match(txt, /過去幾次、你提過類似的/);
  assert.match(txt, /現在這個時刻、安全嗎/);
});

// ─── selectDayOpeningVariant (mode-aware + V6 override) ──

test('🛑 selectDayOpeningVariant: V6 overrides everything when carry_forward unresolved', () => {
  const r = selectDayOpeningVariant({
    userProfile: {
      crisis_state_carry_forward: { handoff_choice: 'a', resolved_at: null },
      passive_death_wish_count: 0,
      last_session_day_summary: { primary_mode: 'elicitation', takeaway_term: 'X' },
    },
    gapDays: 0,
    userResponseText: '我想接著走',   // would normally → V1
  });
  assert.equal(r.variant, DAY_OPENING_VARIANTS.V6);
  assert.equal(r.v6SubBranch, V6_SUB_BRANCHES.HANDOFF_A);
});

test('🛑 selectDayOpeningVariant: V6 NOT triggered when resolved_at != null (standard flow)', () => {
  const r = selectDayOpeningVariant({
    userProfile: {
      crisis_state_carry_forward: { handoff_choice: 'a', resolved_at: '2026-06-01T00:00:00Z' },
      last_session_day_summary: { primary_mode: 'elicitation', takeaway_term: 'X' },
    },
    gapDays: 0,
  });
  // Falls through to V1-V5 (elicitation + takeaway → V1).
  assert.equal(r.variant, DAY_OPENING_VARIANTS.V1);
});

test('🛑 selectDayOpeningVariant: gap_days > 7 → V4', () => {
  const r = selectDayOpeningVariant({ userProfile: {}, gapDays: 10 });
  assert.equal(r.variant, DAY_OPENING_VARIANTS.V4);
});

test('🛑 selectDayOpeningVariant: gap_days 3-7 → V3', () => {
  assert.equal(selectDayOpeningVariant({ userProfile: {}, gapDays: 3 }).variant, DAY_OPENING_VARIANTS.V3);
  assert.equal(selectDayOpeningVariant({ userProfile: {}, gapDays: 7 }).variant, DAY_OPENING_VARIANTS.V3);
});

test('🛑 selectDayOpeningVariant: 學員「我想接」 → V1 override', () => {
  const r = selectDayOpeningVariant({
    userProfile: { last_session_day_summary: { primary_mode: 'cascade', cascade_completed: false } },
    gapDays: 0,
    userResponseText: '我想接著走',
  });
  assert.equal(r.variant, DAY_OPENING_VARIANTS.V1);
});

test('🛑 selectDayOpeningVariant: 學員「今天我想換」 → V3 override', () => {
  const r = selectDayOpeningVariant({
    userProfile: {},
    gapDays: 0,
    userResponseText: '今天我想換個聊',
  });
  assert.equal(r.variant, DAY_OPENING_VARIANTS.V3);
});

test('🛑 selectDayOpeningVariant: gap<=2 + identity_anchoring + ambiguous → V2', () => {
  const r = selectDayOpeningVariant({
    userProfile: { last_session_day_summary: { primary_mode: 'identity_anchoring', last_quality_status: 'ambiguous' } },
    gapDays: 1,
  });
  assert.equal(r.variant, DAY_OPENING_VARIANTS.V2);
});

test('🛑 selectDayOpeningVariant: gap<=2 + cascade 未完 → V5', () => {
  const r = selectDayOpeningVariant({
    userProfile: { last_session_day_summary: { primary_mode: 'cascade', cascade_completed: false } },
    gapDays: 0,
  });
  assert.equal(r.variant, DAY_OPENING_VARIANTS.V5);
});

// ─── Takeaway mode-aware (Patch 3) ───────────────────────

test('🛑 selectTakeawayPhrasing: crisis primary → disable + closure phrase + takeaway_term=null', () => {
  const r = selectTakeawayPhrasing({
    primary_mode: 'crisis',
    active_modes: ['crisis'],
    paused_modes: [],
  });
  assert.equal(r.crisis_disabled, true);
  assert.equal(r.takeaway_term, null);
  assert.match(r.phrasing, /我記著你在這裡/);
  assert.match(r.phrasing, /準備好的時候、回來就行/);
});

test('🛑 selectTakeawayPhrasing: crisis in active_modes (paused primary) → also disable', () => {
  const r = selectTakeawayPhrasing({
    primary_mode: 'elicitation',     // primary not crisis
    active_modes: ['elicitation', 'crisis'],   // but crisis active
    paused_modes: [],
  });
  assert.equal(r.crisis_disabled, true);
});

test('🛑 selectTakeawayPhrasing: per-mode phrasing for 5 non-crisis modes', () => {
  for (const mode of ['elicitation', 'identity_anchoring', 'integration', 'cascade', 'future_pacing']) {
    const r = selectTakeawayPhrasing({
      primary_mode: mode,
      active_modes: [mode],
      paused_modes: [],
    });
    assert.equal(r.crisis_disabled, false);
    assert.equal(r.mode_key, mode);
    assert.ok(typeof r.phrasing === 'string' && r.phrasing.length > 0,
      `${mode} should have phrasing`);
  }
});

test('🛑 deriveTakeawayTerm: reframe success anchor > quality candidate priority', () => {
  const term = deriveTakeawayTerm({
    reframe_invocation_history_in_session: [
      { reframe_id: 'R2', outcome: 'success', anchor_phrase_if_success: '我是溫暖的' },
    ],
    top1_value: '勇敢的',
  });
  assert.equal(term, '我是溫暖的', 'reframe success anchor wins priority');
});

test('deriveTakeawayTerm: no reframe → falls to top1_value', () => {
  const term = deriveTakeawayTerm({ top1_value: '勇敢的' });
  assert.equal(term, '勇敢的');
});

test('deriveTakeawayTerm: no anchors → null', () => {
  assert.equal(deriveTakeawayTerm({}), null);
});

test('isTakeawayDuplicate: same phrase → true (F2)', () => {
  assert.equal(isTakeawayDuplicate('安靜', '安靜'), true);
  assert.equal(isTakeawayDuplicate('安靜', '勇敢'), false);
  assert.equal(isTakeawayDuplicate(null, '安靜'), false);
});

// ─── Cross-session anchor write (Patch 4) ────────────────

test('🛑 buildLastSessionDaySummary: full v5.1 schema', () => {
  const summary = buildLastSessionDaySummary({
    sessionState: {
      primary_mode: 'cascade',
      active_modes: ['cascade'],
      paused_modes: [],
      current_quality_status: 'owned',
      cascade_down_progress: { status: 'testing' },
      anchors_referenced_this_session: ['安靜', '勇敢'],
      reframe_invocation_history_in_session: [
        { reframe_id: 'R1', outcome: 'success', invoked_at_turn: 5 },
      ],
    },
    takeawayResult: { takeaway_term: '安靜', crisis_disabled: false },
    endedNaturally: true,
    hardLimitHit: false,
  });
  assert.equal(summary.primary_mode, 'cascade');
  assert.deepEqual(summary.active_modes, ['cascade']);
  assert.equal(summary.ended_naturally, true);
  assert.equal(summary.hard_limit_hit, false);
  assert.equal(summary.takeaway_term, '安靜');
  assert.deepEqual(summary.anchors_referenced, ['安靜', '勇敢']);
  assert.equal(summary.reframe_invocation_history_in_session.length, 1);
  assert.equal(summary.crisis_in_progress_at_close, false);
  assert.equal(summary.last_quality_status, 'owned');
  assert.equal(summary.cascade_completed, false);
});

test('buildLastSessionDaySummary: crisis_in_progress flag captured', () => {
  const summary = buildLastSessionDaySummary({
    sessionState: { primary_mode: 'crisis', active_modes: ['crisis'], paused_modes: [] },
    takeawayResult: { takeaway_term: null, crisis_disabled: true },
  });
  assert.equal(summary.crisis_in_progress_at_close, true);
  assert.equal(summary.takeaway_term, null);
});

// ─── Crisis carry_forward (Patch 4 §10.5 plumbing) ───────

test('🛑 buildCrisisCarryForward: passive_dw_detected → full structural shell', () => {
  const cf = buildCrisisCarryForward({
    crisis_in_progress: true,
    deep_signal_flags: {
      passive_dw_detected: true,
      passive_dw_signal: 'strong',
      passive_dw_variant: 'strong',
    },
    handoff_choice: 'b',
  });
  assert.ok(cf);
  assert.equal(cf.crisis_category, 'passive_dw_strong_strong');
  assert.equal(cf.handoff_choice, 'b');
  // Step 6 fields are null with TODO.
  assert.equal(cf.si_risk_level, null);
  assert.equal(cf.protective_factor_surfaced, null);
  assert.equal(cf.safety_plan, null);
  assert.equal(cf.next_session_focus, null);
  assert.equal(cf.resolved_at, null);
  assert.equal(cf.resolution_type, null);
  assert.equal(cf.sessions_since_trigger, 0);
});

test('buildCrisisCarryForward: no crisis → null', () => {
  const cf = buildCrisisCarryForward({});
  assert.equal(cf, null);
});

test('🛑 updateCarryForwardOnSessionClose: 3 sessions no re-trigger → auto-resolved', () => {
  let cf = buildCrisisCarryForward({
    crisis_in_progress: true,
    deep_signal_flags: { passive_dw_detected: true, passive_dw_signal: 'strong', passive_dw_variant: 'strong' },
  });
  cf = updateCarryForwardOnSessionClose(cf, false);   // session 1 no re-trigger
  assert.equal(cf.sessions_since_trigger, 1);
  assert.equal(cf.resolved_at, null);
  cf = updateCarryForwardOnSessionClose(cf, false);   // session 2
  assert.equal(cf.sessions_since_trigger, 2);
  assert.equal(cf.resolved_at, null);
  cf = updateCarryForwardOnSessionClose(cf, false);   // session 3 → auto-resolve
  assert.equal(cf.sessions_since_trigger, 3);
  assert.ok(cf.resolved_at, 'resolved_at populated at 3 sessions clean');
  assert.equal(cf.resolution_type, 'natural_de_escalation');
});

test('🛑 updateCarryForwardOnSessionClose: crisis re-trigger resets counter', () => {
  let cf = buildCrisisCarryForward({
    crisis_in_progress: true,
    deep_signal_flags: { passive_dw_detected: true, passive_dw_signal: 'strong', passive_dw_variant: 'strong' },
  });
  cf = updateCarryForwardOnSessionClose(cf, false);
  cf = updateCarryForwardOnSessionClose(cf, false);
  assert.equal(cf.sessions_since_trigger, 2);
  cf = updateCarryForwardOnSessionClose(cf, true);     // re-triggered
  assert.equal(cf.sessions_since_trigger, 0);
  assert.equal(cf.resolved_at, null);
});

test('updateCarryForwardOnSessionClose: already resolved → no change', () => {
  const cf = {
    resolved_at: '2026-06-01', resolution_type: 'vivi_handoff_resolved', sessions_since_trigger: 5,
  };
  const out = updateCarryForwardOnSessionClose(cf, false);
  assert.equal(out, cf, 'idempotent on resolved carry_forward');
});

// ─── e4 handler integration ──────────────────────────────

test('🛑 e4DayOpeningHandler (V6): mock carry_forward unresolved → V6 inject + sub-branch in patch', async () => {
  const r = await e4DayOpeningHandler({
    user_profile: {
      anchors: ['X'],   // hasAssets gate
      crisis_state_carry_forward: { handoff_choice: 'c', resolved_at: null },
      passive_death_wish_count: 0,
    },
    gap_days: 0,
    user_response: '今天我來了',
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.day_opening_variant, 'V6');
  assert.equal(r.patch.day_opening_v6_sub_branch, V6_SUB_BRANCHES.HANDOFF_C);
  assert.match(r.inject, /Day Opening V6 Crisis Follow-up/);
  assert.match(r.inject, /我看到你回來了/);   // spec phrasing
});

test('🛑 e4DayOpeningHandler: no carry_forward → standard V1-V5 path', async () => {
  const r = await e4DayOpeningHandler({
    user_profile: {
      anchors: ['X'],
      last_session_day_summary: { primary_mode: 'elicitation', takeaway_term: 'Y' },
    },
    gap_days: 1,
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.day_opening_variant, 'V1');
  assert.equal(r.patch.day_opening_v6_sub_branch, null);
});

test('🛑 e4TakeawayHandler: crisis primary → takeaway DISABLED inject + carry_forward in patch', async () => {
  const r = await e4TakeawayHandler({
    session_state: {
      primary_mode: 'crisis',
      active_modes: ['crisis'],
      paused_modes: [],
      crisis_in_progress: true,
      deep_signal_flags: { passive_dw_detected: true, passive_dw_signal: 'strong', passive_dw_variant: 'strong' },
    },
    user_profile: {},
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.takeaway_term_this_session, null);
  assert.equal(r.patch.takeaway_crisis_disabled, true);
  assert.match(r.inject, /Takeaway DISABLED/);
  assert.match(r.inject, /我記著你在這裡/);
  // crisis_state_carry_forward built for fresh crisis.
  assert.ok(r.patch.crisis_state_carry_forward_pending_write);
  assert.equal(r.patch.crisis_state_carry_forward_pending_write.crisis_category, 'passive_dw_strong_strong');
});

test('🛑 e4TakeawayHandler: identity_anchoring mode → quality takeaway phrasing', async () => {
  const r = await e4TakeawayHandler({
    session_state: {
      primary_mode: 'identity_anchoring',
      active_modes: ['identity_anchoring'],
      paused_modes: [],
      top1_value: '勇敢的',
    },
    user_profile: {},
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.takeaway_mode_key, 'identity_anchoring');
  assert.equal(r.patch.takeaway_term_this_session, '勇敢的');
  assert.match(r.inject, /Mode-Aware Takeaway \(identity_anchoring\)/);
  assert.match(r.inject, /現在是你的/);
});

test('e4TakeawayHandler: session_close_summary_patch carries new schema', async () => {
  const r = await e4TakeawayHandler({
    session_state: {
      primary_mode: 'integration',
      active_modes: ['integration'],
      paused_modes: [],
      current_quality_status: 'ambiguous',
    },
    user_profile: {},
  });
  const summary = r.patch.session_close_summary_patch;
  assert.equal(summary.primary_mode, 'integration');
  assert.equal(summary.last_quality_status, 'ambiguous');
  assert.equal(summary.ended_naturally, true);
});

test('e4TakeawayHandler: already seeded → not handled (idempotent)', async () => {
  const r = await e4TakeawayHandler({
    session_state: { takeaway_seeded_this_session: true },
    user_profile: {},
  });
  assert.equal(r.handled, false);
});

// ─── cached section 4 (size + content) ───────────────────

test('🛑 Patch 1 cached: active-reference contains DAMON REFRAME LIBRARY section', async () => {
  const { default: section } = await import('../prompt-sections/cached/active-reference-styles.js');
  assert.match(section.content, /\[DAMON REFRAME LIBRARY REFERENCE\]/);
  // 7 reframes
  for (const r of ['R1 Reclaim Source', 'R2 Behavior to Identity',
                   'R3 失敗作為 Feedback', 'R4 金錢',
                   'R5 Away From → Toward', 'R6 第一感知位置回歸',
                   'R7 Slip into Unconscious']) {
    assert.match(section.content, new RegExp(r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  // Stacking rules.
  assert.match(section.content, /REFRAME STACKING RULES/);
  assert.match(section.content, /crisis mode active → 不 invoke 任何 reframe/);
});

test('🛑 Patch 1 cached: active-reference contains MODE-AWARE ROUTING section', async () => {
  const { default: section } = await import('../prompt-sections/cached/active-reference-styles.js');
  assert.match(section.content, /\[MODE-AWARE ROUTING\]/);
  assert.match(section.content, /elicitation → identity_anchoring/);
  assert.match(section.content, /integration → cascade/);
  assert.match(section.content, /any → crisis/);
  assert.match(section.content, /不需 explicit announce mode 切換給學員/);
});

test('Patch 1 cached: token_estimate bumped to 1200', async () => {
  const { default: section } = await import('../prompt-sections/cached/active-reference-styles.js');
  assert.equal(section.token_estimate, 1200);
});
