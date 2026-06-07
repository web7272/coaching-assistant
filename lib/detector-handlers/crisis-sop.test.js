// lib/detector-handlers/crisis-sop.test.js
// v5.1 Step 6 PR-6a — Lock 9-step Crisis SOP state machine + sub-prompt snapshots.
//
// Coverage:
//   - 6 full-path simulations (deny / confirm has_plan / ambiguous / no protective /
//     count >= 3 remove_c / count >= 5 freeze)
//   - parsers (SI / plan / protective / handoff / reminder / safe location / contracting)
//   - Step 6 Landing Page Reminder 變體 A/B/C snapshot lock (Vivi 終審 guard)
//   - Step 7 framing line lock (landing errata §1.3)
//   - Step 8 closure phrasing lock
//   - PR-23a si_confirm_pending classifier 退役 — no longer set / no longer read by SOP
//   - R1_C unlock gate (de_escalation_sub_mode required)
//   - CASCADE_PRIORITY.CRISIS_sop = 2 (fires before everything)
//   - Gate — handler returns handled=false when not in crisis

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  crisisSopHandler, CRISIS_SOP_DETECTOR,
  parseSiAnswer, parsePlanAnswer, parseProtectiveFactor,
  parseHandoffChoice, parseReminderResponse, parseSafeLocation, parseContracting,
} from './crisis-sop.js';
import {
  SOP_STEPS, CRISIS_AWAITING, CRISIS_CATEGORY, STEP1_VARIANT,
  SI_ANSWER, PLAN_ANSWER, HANDOFF_VARIANT, HANDOFF_CHOICE, REMINDER_VARIANT,
  SI_RISK_LEVEL,
  buildInitialSopState, advanceSopState,
} from '../sub-prompts/crisis/_constants.js';
import {
  selectReminderVariant, getReminderInject,
  VARIANT_A_STANDARD, VARIANT_B_CUMULATIVE, VARIANT_C_REFUSAL,
} from '../sub-prompts/crisis/landing-page-reminder.js';
import { getHandoffInject } from '../sub-prompts/crisis/handoff-three-options.js';
import { getResource1925Inject } from '../sub-prompts/crisis/resource-1925.js';
import safetyPlanning, {
  STEP_7_1_ACTIVITY_BASED_OPENER, STEP_7_1_ACTIVITY_ACK_TEMPLATE,
  STEP_7_2_SAFE_LOCATION_QUESTIONS, STEP_7_2_ALONE_ACK,
  STEP_7_3_CONTRACTING_ACK, STEP_7_FORBIDDEN_7,
} from '../sub-prompts/crisis/safety-planning.js';
import crisisSessionClosure, {
  STEP_8_1_EXPLICIT_CLOSURE,
} from '../sub-prompts/crisis/crisis-session-closure.js';
import directSiQuestion from '../sub-prompts/crisis/direct-si-question.js';
import protectiveFactorInquiry from '../sub-prompts/crisis/protective-factor-inquiry.js';
import immediateSafetyCheck from '../sub-prompts/crisis/immediate-safety-check.js';
import {
  mapSopCategoryToCarryForward, deriveSiRiskLevel, buildFullCarryForward,
} from '../sub-prompts/crisis/carry-forward-writer.js';
import { CASCADE_PRIORITY } from '../detector/registry.js';
import { R1, R1_VARIANTS } from '../damon-reframe-library/r1-reclaim-source.js';

// ─── Gate ────────────────────────────────────────────────

test('🛑 crisisSopHandler: not in crisis → handled=false (no-op)', async () => {
  const r = await crisisSopHandler({
    session_state: { primary_mode: 'integration' },
    user_response: 'hello',
  });
  assert.equal(r.handled, false);
});

test('🛑 crisisSopHandler: crisis_in_progress alone → fires (no primary_mode)', async () => {
  const r = await crisisSopHandler({
    session_state: { crisis_in_progress: true },
    user_response: '我聽到了',
  });
  assert.equal(r.handled, true);
});

test('🛑 crisisSopHandler: primary_mode=crisis → fires', async () => {
  const r = await crisisSopHandler({
    session_state: { primary_mode: 'crisis' },
    user_response: '謝謝',
  });
  assert.equal(r.handled, true);
});

test('🛑 CASCADE_PRIORITY.CRISIS_sop = 2 (fires before E1=10, deep_signal=20)', () => {
  assert.equal(CASCADE_PRIORITY.CRISIS_sop, 2);
  assert.equal(CRISIS_SOP_DETECTOR.priority, 2);
  assert.ok(CRISIS_SOP_DETECTOR.priority < CASCADE_PRIORITY.E1_deviation_pipeline);
  assert.ok(CRISIS_SOP_DETECTOR.priority < CASCADE_PRIORITY.E3_deep_signal_detector);
});

// ─── Parsers ─────────────────────────────────────────────

test('🛑 parseSiAnswer: 「沒有」 → deny', () => {
  assert.equal(parseSiAnswer('沒有'), SI_ANSWER.DENY);
  assert.equal(parseSiAnswer('不會'), SI_ANSWER.DENY);
});

test('🛑 parseSiAnswer: 「有」/「會」 → confirm', () => {
  assert.equal(parseSiAnswer('有'), SI_ANSWER.CONFIRM);
  assert.equal(parseSiAnswer('會'), SI_ANSWER.CONFIRM);
});

test('🛑 parseSiAnswer: 「有時候會」/「不一定」 → ambiguous', () => {
  assert.equal(parseSiAnswer('有時候會'), SI_ANSWER.AMBIGUOUS);
  assert.equal(parseSiAnswer('不一定'), SI_ANSWER.AMBIGUOUS);
  assert.equal(parseSiAnswer('說不上來'), SI_ANSWER.AMBIGUOUS);
});

test('🛑 parsePlanAnswer: 「有計畫」/「想好了」 → has_plan', () => {
  assert.equal(parsePlanAnswer('有計畫'), PLAN_ANSWER.HAS_PLAN);
  assert.equal(parsePlanAnswer('我想好了'), PLAN_ANSWER.HAS_PLAN);
});

test('🛑 parsePlanAnswer: 「沒有計畫、只是念頭」 → no_plan', () => {
  assert.equal(parsePlanAnswer('沒有計畫、只是念頭'), PLAN_ANSWER.NO_PLAN);
  assert.equal(parsePlanAnswer('就是想想'), PLAN_ANSWER.NO_PLAN);
});

test('🛑 parseProtectiveFactor: 「我有家人」 → entity surfaced', () => {
  const r = parseProtectiveFactor('我有家人在啊');
  assert.equal(r.hasProtective, true);
  assert.equal(r.entity, '家人');
});

test('🛑 parseProtectiveFactor: 「沒有人」 → no protective factor', () => {
  const r = parseProtectiveFactor('沒有人');
  assert.equal(r.hasProtective, false);
  assert.equal(r.entity, null);
});

test('parseProtectiveFactor: 「不知道」 (no marker either way) → null', () => {
  const r = parseProtectiveFactor('不知道');
  assert.equal(r.hasProtective, null);
});

// ⭐ errata v02 (Vivi 6/6) — parseHandoffChoice 退役 (學員不再 choice a/b/c).
//   Function exported as @deprecated stub always returning null. Tests confirm
//   the retirement contract.
test('🛑 errata v02: parseHandoffChoice always returns null (deprecated stub)', () => {
  assert.equal(parseHandoffChoice('我選 b'), null);
  assert.equal(parseHandoffChoice('(a)'), null);
  assert.equal(parseHandoffChoice('我要 c'), null);
  assert.equal(parseHandoffChoice(''), null);
  assert.equal(parseHandoffChoice(null), null);
});

test('🛑 parseReminderResponse: 「我會去找諮商師」 → acknowledged', () => {
  const r = parseReminderResponse('我會去找諮商師');
  assert.equal(r.acknowledged, true);
});

test('🛑 parseReminderResponse: 「不要找諮商師」 → refused', () => {
  const r = parseReminderResponse('不要找諮商師');
  assert.equal(r.refused, true);
});

test('parseSafeLocation: 「跟家人在一起」 → true', () => {
  assert.equal(parseSafeLocation('跟家人在一起'), true);
});

test('parseSafeLocation: 「一個人」 → false', () => {
  assert.equal(parseSafeLocation('一個人'), false);
});

test('parseContracting: 「我不會傷害自己」 → true', () => {
  assert.equal(parseContracting('我不會傷害自己'), true);
});

// ─── Path 1 — deny → Step 3 has factor → Step 4 standard ──

test('🛑 PATH 1 (deny): Step 1 ack → Step 2 deny → Step 3 family → Step 4 standard', async () => {
  // Turn 1: Step 1 already injected by deep-signal-detector. SOP state initialized to Step 1.
  const state1 = {
    crisis_in_progress: true,
    primary_mode: 'crisis',
    crisis_sop_state: buildInitialSopState({
      category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1,
    }),
  };
  // Step 1 C-1 has built-in SI question — fromStep1 skips injecting Step 2.1 explicit.
  const r1 = await crisisSopHandler({ session_state: state1, user_response: '聽到了' });
  assert.equal(r1.handled, true);
  assert.match(r1.inject, /Step 1 C-1 已問 SI/);
  assert.equal(r1.patch.crisis_sop_state.current_step, SOP_STEPS.STEP_2_SI_RISK);
  assert.equal(r1.patch.crisis_sop_state.awaiting, CRISIS_AWAITING.SI_ANSWER);

  // Turn 2: student denies SI → Step 3 protective factor.
  const state2 = { ...state1, crisis_sop_state: r1.patch.crisis_sop_state };
  const r2 = await crisisSopHandler({ session_state: state2, user_response: '沒有' });
  assert.equal(r2.handled, true);
  assert.match(r2.inject, /Step 3 Protective Factor/);
  assert.equal(r2.patch.crisis_sop_state.current_step, SOP_STEPS.STEP_3_PROTECTIVE);
  assert.equal(r2.patch.crisis_sop_state.si_answer, SI_ANSWER.DENY);

  // Turn 3: student surfaces family → Step 4 standard.
  const state3 = { ...state2, crisis_sop_state: r2.patch.crisis_sop_state };
  const r3 = await crisisSopHandler({
    session_state: state3,
    user_response: '我有家人',
    user_profile: { passive_death_wish_count: 1 },
  });
  assert.equal(r3.handled, true);
  assert.match(r3.inject, /Step 4 Handoff Direct-1925 \(standard\)/);
  assert.equal(r3.patch.crisis_sop_state.handoff_variant_used, HANDOFF_VARIANT.STANDARD);
  assert.equal(r3.patch.crisis_sop_state.protective_factor_surfaced, '家人');
  assert.equal(r3.patch.crisis_sop_state.handoff_choice, null,
    'errata v02: handoff_choice always null in new sessions');
  assert.equal(r3.patch.crisis_sop_state.awaiting, CRISIS_AWAITING.HANDOFF_ACK,
    'errata v02: awaiting HANDOFF_ACK, not HANDOFF_CHOICE');
  assert.notEqual(r3.patch.hitl_critical_alert, true);
});

// ─── Path 2 — confirm + has_plan → Step 4 only_b + HITL ───

test('🛑 PATH 2 (confirm has_plan): Step 2 confirm → Step 2.3 has_plan → Step 4 only_b + HITL critical', async () => {
  let state = {
    crisis_in_progress: true,
    crisis_sop_state: {
      ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
      current_step: SOP_STEPS.STEP_2_SI_RISK,
      awaiting: CRISIS_AWAITING.SI_ANSWER,
    },
  };
  // confirm SI.
  const r1 = await crisisSopHandler({ session_state: state, user_response: '有' });
  assert.match(r1.inject, /Step 2\.3 Immediate Safety Check/);
  assert.equal(r1.patch.crisis_sop_state.si_answer, SI_ANSWER.CONFIRM);

  // has plan → Step 4 high_risk + HITL critical (errata v02: was 'only_b').
  state = { ...state, crisis_sop_state: r1.patch.crisis_sop_state };
  const r2 = await crisisSopHandler({ session_state: state, user_response: '有計畫' });
  assert.match(r2.inject, /Step 4 Handoff Direct-1925 \(high_risk\)/);
  assert.match(r2.inject, /HITL critical alert/);
  assert.equal(r2.patch.crisis_sop_state.plan_answer, PLAN_ANSWER.HAS_PLAN);
  assert.equal(r2.patch.crisis_sop_state.handoff_variant_used, HANDOFF_VARIANT.HIGH_RISK);
  assert.equal(r2.patch.crisis_sop_state.handoff_choice, null,
    'errata v02: handoff_choice not set in new sessions');
  assert.equal(r2.patch.hitl_critical_alert, true);
});

// ─── Path 3 — ambiguous treated as confirm ────────────────

test('🛑 PATH 3 (ambiguous): Step 2 ambiguous → Step 2.3 (treated as confirm)', async () => {
  const state = {
    crisis_in_progress: true,
    crisis_sop_state: {
      ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
      current_step: SOP_STEPS.STEP_2_SI_RISK, awaiting: CRISIS_AWAITING.SI_ANSWER,
    },
  };
  const r = await crisisSopHandler({ session_state: state, user_response: '有時候會' });
  assert.match(r.inject, /Step 2\.3 Immediate Safety Check/);
  assert.equal(r.patch.crisis_sop_state.si_answer, SI_ANSWER.AMBIGUOUS);
  assert.equal(r.patch.crisis_sop_state.current_step, SOP_STEPS.STEP_2_3_PLAN_CHECK);
});

// ─── Path 4 — no protective factor → only_b + HITL ────────

test('🛑 PATH 4 (no protective): Step 3 no → Step 4 high_risk + HITL critical (errata v02)', async () => {
  const state = {
    crisis_in_progress: true,
    crisis_sop_state: {
      ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
      current_step: SOP_STEPS.STEP_3_PROTECTIVE, awaiting: CRISIS_AWAITING.PROTECTIVE_FACTOR,
      si_answer: SI_ANSWER.DENY,
    },
  };
  const r = await crisisSopHandler({
    session_state: state,
    user_response: '沒有人',
    user_profile: { passive_death_wish_count: 1 },
  });
  assert.match(r.inject, /Step 4 Handoff Direct-1925 \(high_risk\)/);
  assert.match(r.inject, /HITL critical alert/);
  assert.equal(r.patch.crisis_sop_state.protective_factor_surfaced, null);
  assert.equal(r.patch.crisis_sop_state.handoff_variant_used, HANDOFF_VARIANT.HIGH_RISK);
  assert.equal(r.patch.hitl_critical_alert, true);
});

// ─── Path 5 — count >= 2 → cumulative (errata v02: was 3 → remove_c) ──

test('🛑 PATH 5 (errata v02 count >= 2): Step 3 has factor + count=2 → Step 4 cumulative', async () => {
  const state = {
    crisis_in_progress: true,
    crisis_sop_state: {
      ...buildInitialSopState({ category: CRISIS_CATEGORY.CUMULATIVE, step1Variant: STEP1_VARIANT.C_3 }),
      current_step: SOP_STEPS.STEP_3_PROTECTIVE, awaiting: CRISIS_AWAITING.PROTECTIVE_FACTOR,
      si_answer: SI_ANSWER.DENY,
    },
  };
  // errata v02: threshold lowered 3 → 2; count=2 fires cumulative variant.
  const r = await crisisSopHandler({
    session_state: state,
    user_response: '我有朋友',
    user_profile: { passive_death_wish_count: 2 },
  });
  assert.match(r.inject, /Step 4 Handoff Direct-1925 \(cumulative\)/);
  assert.equal(r.patch.crisis_sop_state.handoff_variant_used, HANDOFF_VARIANT.CUMULATIVE);
});

test('🛑 PATH 5 boundary: count=1 + has protective → standard (errata v02 threshold lock)', async () => {
  const state = {
    crisis_in_progress: true,
    crisis_sop_state: {
      ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
      current_step: SOP_STEPS.STEP_3_PROTECTIVE, awaiting: CRISIS_AWAITING.PROTECTIVE_FACTOR,
      si_answer: SI_ANSWER.DENY,
    },
  };
  const r = await crisisSopHandler({
    session_state: state,
    user_response: '我有家人',
    user_profile: { passive_death_wish_count: 1 },
  });
  assert.match(r.inject, /Step 4 Handoff Direct-1925 \(standard\)/);
  assert.equal(r.patch.crisis_sop_state.handoff_variant_used, HANDOFF_VARIANT.STANDARD);
});

// ─── Path 6 — count >= 5 → freeze ─────────────────────────

test('🛑 PATH 6 (count >= 5): Step 3 with count=5 → Step 4 freeze', async () => {
  const state = {
    crisis_in_progress: true,
    crisis_sop_state: {
      ...buildInitialSopState({ category: CRISIS_CATEGORY.FREEZE, step1Variant: STEP1_VARIANT.C_3 }),
      current_step: SOP_STEPS.STEP_3_PROTECTIVE, awaiting: CRISIS_AWAITING.PROTECTIVE_FACTOR,
      si_answer: SI_ANSWER.DENY,
    },
  };
  const r = await crisisSopHandler({
    session_state: state,
    user_response: '有家人',
    user_profile: { passive_death_wish_count: 5 },
  });
  assert.match(r.inject, /Step 4 Handoff Direct-1925 \(freeze\)/);
  assert.equal(r.patch.crisis_sop_state.handoff_variant_used, HANDOFF_VARIANT.FREEZE);
});

// ─── Step 6 Landing Page Reminder snapshot lock (Vivi 終審) ──

test('🛑 SNAPSHOT LOCK — Reminder 變體 A 逐字 (landing errata §1.1)', () => {
  assert.equal(VARIANT_A_STANDARD, `我想停在這裡、跟你說一件事——

你還記得 program 開始前、我們有提過嗎?
這個 program、不適合在重大事件中、或還在療癒中的人。
那時候的 reminder、現在更明確——

你剛才說的、值得有一個真正的諮商師 / 心理醫生陪你走。
不是 1925(那是緊急、24 小時)、是長期。

我可以陪你到今晚安全為止——但接下來、你需要的不是我。`);
});

test('🛑 SNAPSHOT LOCK — Reminder 變體 B 逐字 (landing errata §1.1)', () => {
  assert.match(VARIANT_B_CUMULATIVE, /我必須再說一次——/);
  assert.match(VARIANT_B_CUMULATIVE, /過去幾次、你提過類似的/);
  assert.match(VARIANT_B_CUMULATIVE, /不是 AI、不是 21 天 program、不是 1925 緊急專線——/);
  assert.match(VARIANT_B_CUMULATIVE, /我會陪你到今晚安全為止。但這個橋、我希望你走過去。/);
});

test('🛑 SNAPSHOT LOCK — Reminder 變體 C 逐字 (landing errata §1.1)', () => {
  assert.equal(VARIANT_C_REFUSAL, `我聽到了。

我不會強推。
但我希望你聽見:
我不是諮商師、我也不能假裝我是。
我能做的、就是現在這個——陪你到今晚安全。

如果你某天願意找諮商師、那個門一直開著。`);
});

test('🛑 selectReminderVariant: count==1 → A', () => {
  assert.equal(selectReminderVariant({ passive_death_wish_count: 1 }), 'A');
});

test('🛑 selectReminderVariant: count>=2 → B', () => {
  assert.equal(selectReminderVariant({ passive_death_wish_count: 2 }), 'B');
  assert.equal(selectReminderVariant({ passive_death_wish_count: 5 }), 'B');
});

test('🛑 selectReminderVariant: professional_referral_refused → C (overrides count)', () => {
  assert.equal(
    selectReminderVariant({ passive_death_wish_count: 5, professional_referral_refused: true }),
    'C',
  );
});

// ─── Step 7 Safety Planning framing lock (landing errata §1.3) ──

test('🛑 SNAPSHOT LOCK — Step 7.1 opener uses landing errata framing「在 Vivi 聯絡你之前」', () => {
  assert.equal(STEP_7_1_ACTIVITY_BASED_OPENER, `OK。在 Vivi 聯絡你之前(或者你決定打 1925 之前)——
我想確認你今晚 OK。
今天接下來、你有哪些事要做?`);
});

test('🛑 Step 7 framing: 學員 facing phrasing uses 「在 Vivi 聯絡你之前」 not 「我們一起做 safety plan」', () => {
  // The new bridge framing MUST appear in 學員 facing line + active opener segment.
  assert.match(STEP_7_1_ACTIVITY_BASED_OPENER, /在 Vivi 聯絡你之前/);
  assert.match(STEP_7_1_ACTIVITY_BASED_OPENER, /或者你決定打 1925 之前/);
  // The v0.1 framing must NOT appear in the student-facing opener segment.
  assert.doesNotMatch(STEP_7_1_ACTIVITY_BASED_OPENER, /我們一起做 safety plan/);
  // Prompt body documents the deprecation as a forbidden marker — that's fine, just
  // assert the deprecated phrasing is annotated as a 廢除 marker (not as student-facing).
  assert.match(safetyPlanning.prompt_content, /我們一起做 safety plan.*廢除/);
});

test('🛑 SNAPSHOT LOCK — Step 7 禁止清單 v5.1 新 3 條', () => {
  // v0.1 4 條.
  assert.match(STEP_7_FORBIDDEN_7, /不問「自殺方法」/);
  assert.match(STEP_7_FORBIDDEN_7, /不要求 written safety plan/);
  assert.match(STEP_7_FORBIDDEN_7, /不問「最近一次想自殺是什麼時候」/);
  assert.match(STEP_7_FORBIDDEN_7, /不過度具體化未來的危險/);
  // v5.1 新 3 條.
  assert.match(STEP_7_FORBIDDEN_7, /不假裝在「做完整 safety plan」/);
  assert.match(STEP_7_FORBIDDEN_7, /不假設「Safety Planning 完成 = 學員 OK 了」/);
  assert.match(STEP_7_FORBIDDEN_7, /不在 Safety Planning 後 reset crisis_state_carry_forward 為 resolved/);
});

test('🛑 SNAPSHOT LOCK — Step 7.2 + 7.3 + acks (turn2b 逐字)', () => {
  assert.equal(STEP_7_2_SAFE_LOCATION_QUESTIONS, `你今晚一個人在家嗎?

(或) 你今晚會跟誰在一起?`);
  assert.equal(STEP_7_2_ALONE_ACK, `OK、我記住你說的——你今晚是安全的。`);
  assert.equal(STEP_7_3_CONTRACTING_ACK, `謝謝你告訴我。我記著你說的。`);
  assert.equal(STEP_7_1_ACTIVITY_ACK_TEMPLATE, `OK、[activity] 有人、有事做、這是今晚最好的事。`);
});

// ─── Step 8 closure snapshot lock ─────────────────────────

test('🛑 SNAPSHOT LOCK — Step 8.1 explicit closure (turn2b §10.3 step 7.1 逐字)', () => {
  assert.equal(STEP_8_1_EXPLICIT_CLOSURE, `我記著你在這裡。
你準備好的時候、回來就行。`);
});

test('🛑 Step 8 prompt: NO takeaway + NO resolved reset', () => {
  assert.match(crisisSessionClosure.prompt_content, /不種 takeaway/);
  assert.match(crisisSessionClosure.prompt_content, /不在 Safety Planning 後 reset resolved/);
  assert.match(crisisSessionClosure.prompt_content, /M73/);
});

// ─── Step 4 inject variant lookup — errata v02 (Vivi 6/6) direct-1925 ──

test('🛑 errata v02 + 6/6 wording: getHandoffInject(standard) — 口語 + 台灣框 + 兜底句', () => {
  const inject = getHandoffInject('standard');
  // Verbatim Step 4.1 (errata v02 + Vivi 6/6 wording 修訂):
  assert.match(inject, /我聽到了。/);
  assert.match(inject, /你說了這句話,我有聽進去——我想先停在這裡,不急著往下走。/);
  assert.match(inject, /如果你現在有立即的危險:在台灣,可以打 1925\(安心專線、24 小時、免費\)。/);
  assert.match(inject, /如果你不在台灣,請搜尋你所在地的緊急專線。/);
  // Negations — deprecated mechanic must NOT appear.
  assert.doesNotMatch(inject, /\(a\) 先停在這、不繼續挖/);
  assert.doesNotMatch(inject, /\(b\) 我幫你預約跟 Vivi/);
  assert.doesNotMatch(inject, /\(c\) 我們先回到日常/);
  assert.doesNotMatch(inject, /我幫你預約/);
  // 6/6 wording: 去「很重」書面腔 (positive verbatim no longer present).
  assert.doesNotMatch(inject, /這句話很重——我想停在這裡/);
});

test('🛑 errata v02 + 6/6 wording: getHandoffInject(cumulative) — 口語 + 台灣框 + 諮商師 framing', () => {
  const inject = getHandoffInject('cumulative');
  assert.match(inject, /過去幾次,你提過類似的。/);
  assert.match(inject, /我想先停在這裡,不急著往下走。/);
  assert.match(inject, /如果你現在有立即的危險:在台灣,可以打 1925\(安心專線、24 小時、免費\)。/);
  assert.match(inject, /如果你不在台灣,請搜尋你所在地的緊急專線。/);
  assert.match(inject, /你需要的,是真正的諮商師 \/ 心理醫生長期陪伴——/);
  assert.match(inject, /不是 AI、不是 21 天 program。/);
  // No deprecated mechanic.
  assert.doesNotMatch(inject, /我幫你預約/);
  assert.doesNotMatch(inject, /\(a\)/);
  assert.doesNotMatch(inject, /\(b\)/);
});

test('🛑 errata v02: getHandoffInject(remove_c) back-compat alias → cumulative', () => {
  // back-compat: existing in-flight sessions with handoff_variant_used='remove_c'
  // must still resolve to a phrasing (cumulative — new wording).
  const inject = getHandoffInject('remove_c');
  assert.match(inject, /過去幾次,你提過類似的。/);
});

test('🛑 errata v02 + 6/6 wording: getHandoffInject(high_risk) — 真人在你旁邊 + 口語 + 撐不下去', () => {
  const inject = getHandoffInject('high_risk');
  assert.match(inject, /你現在最需要的,是一個真人在你旁邊。/);
  assert.match(inject, /如果你現在有立即的危險:在台灣,可以打 1925\(安心專線、24 小時、免費\)。/);
  assert.match(inject, /如果你不在台灣,請搜尋你所在地的緊急專線。/);
  assert.match(inject, /你不需要『真的打算做什麼』才能打。/);
  assert.match(inject, /就算只是現在很難受、撐不下去,打過去都可以。/);
  assert.match(inject, /HITL critical alert/);
  // No 預約 Vivi.
  assert.doesNotMatch(inject, /我幫你預約跟 Vivi/);
  assert.doesNotMatch(inject, /Vivi 1-on-1/);
  // 6/6 wording: 「只是很重」 retired in high_risk phrasing positive line.
  assert.doesNotMatch(inject, /只是很重、打過去就可以/);
});

test('🛑 errata v02: getHandoffInject(only_b) back-compat alias → high_risk (new wording)', () => {
  const inject = getHandoffInject('only_b');
  assert.match(inject, /你現在最需要的,是一個真人在你旁邊。/);
});

test('🛑 errata v02: getHandoffInject(freeze) — Vivi 主動聯絡 (capacity OK)', () => {
  const inject = getHandoffInject('freeze');
  assert.match(inject, /我看到你回來了。Vivi 知道你的狀況、她會直接聯絡你。/);
  // freeze KEEPs「Vivi 直接聯絡」(主動非 booking, capacity OK per errata v02).
  // But still must NOT offer「我幫你預約 1-on-1」.
  assert.doesNotMatch(inject, /我幫你預約/);
  assert.doesNotMatch(inject, /我幫你安排.*1-on-1/);
});

test('🛑 errata v02 + 6/6 wording: HANDOFF_PHRASINGS_VERBATIM exports all 4 variants', async () => {
  const { HANDOFF_PHRASINGS_VERBATIM } = await import(
    '../sub-prompts/crisis/handoff-three-options.js'
  );
  // standard — full verbatim snapshot (new wording, Vivi 6/6 終審).
  assert.equal(HANDOFF_PHRASINGS_VERBATIM.standard, `我聽到了。

你說了這句話,我有聽進去——我想先停在這裡,不急著往下走。

如果你現在有立即的危險:在台灣,可以打 1925(安心專線、24 小時、免費)。
如果你不在台灣,請搜尋你所在地的緊急專線。`);
  // cumulative
  assert.match(HANDOFF_PHRASINGS_VERBATIM.cumulative, /過去幾次,你提過類似的。/);
  assert.match(HANDOFF_PHRASINGS_VERBATIM.cumulative, /你需要的,是真正的諮商師 \/ 心理醫生長期陪伴/);
  // high_risk
  assert.match(HANDOFF_PHRASINGS_VERBATIM.high_risk, /你現在最需要的,是一個真人在你旁邊。/);
  assert.match(HANDOFF_PHRASINGS_VERBATIM.high_risk, /你不需要『真的打算做什麼』才能打。/);
  assert.match(HANDOFF_PHRASINGS_VERBATIM.high_risk, /就算只是現在很難受、撐不下去,打過去都可以。/);
  // freeze (unchanged)
  assert.equal(HANDOFF_PHRASINGS_VERBATIM.freeze,
    '我看到你回來了。Vivi 知道你的狀況、她會直接聯絡你。');
});

// ─── 6/6 wording 修訂 — defensive locks (Vivi 6/6 終審) ─────────────

test('🛑 6/6 wording: phrasings (standard/cumulative/high_risk) 不含「自殺」字眼', async () => {
  // AI 回應不出現「自殺」字眼 (改用「安心專線 / 緊急專線」). 偵測 regex
  // (deep-signal-detector ACTIVE_SI_EXPLICIT_REGEX / TRAUMA_REGEX_PATTERN) 仍
  // 含「自殺」 — system 端、不動 (per Vivi spec NOT touched).
  const { HANDOFF_PHRASINGS_VERBATIM } = await import(
    '../sub-prompts/crisis/handoff-three-options.js'
  );
  for (const variant of ['standard', 'cumulative', 'high_risk']) {
    assert.doesNotMatch(HANDOFF_PHRASINGS_VERBATIM[variant], /自殺/,
      `${variant}: AI-facing phrasing must NOT contain 「自殺」`);
  }
  // Also lock Step 5.1 1925 inject (was 「自殺防治專線」 → now 「安心專線」).
  const step5 = getResource1925Inject('standard');
  assert.doesNotMatch(step5, /自殺防治專線/,
    'Step 5.1 1925 inject must NOT contain 「自殺防治專線」 (renamed to 「安心專線」 per Vivi 6/6)');
});

test('🛑 6/6 wording: phrasings (standard/cumulative/high_risk) 不含「很重」書面腔', async () => {
  // 6/6 wording 修訂 #1: 去「很重」 書面腔 → 口語.
  const { HANDOFF_PHRASINGS_VERBATIM } = await import(
    '../sub-prompts/crisis/handoff-three-options.js'
  );
  for (const variant of ['standard', 'cumulative', 'high_risk']) {
    assert.doesNotMatch(HANDOFF_PHRASINGS_VERBATIM[variant], /很重/,
      `${variant}: AI-facing phrasing must NOT contain 「很重」 (去書面腔, Vivi 6/6)`);
  }
});

test('🛑 6/6 wording: phrasings (standard/cumulative/high_risk) 含「在台灣」+ 非台灣兜底句 (localization safety net)', async () => {
  // 6/6 wording 修訂 #2: 1925 一律框「台灣」 + 加非台灣兜底句.
  const { HANDOFF_PHRASINGS_VERBATIM } = await import(
    '../sub-prompts/crisis/handoff-three-options.js'
  );
  for (const variant of ['standard', 'cumulative', 'high_risk']) {
    assert.match(HANDOFF_PHRASINGS_VERBATIM[variant], /在台灣,可以打 1925/,
      `${variant}: must frame 1925 as 「在台灣」 (localization)`);
    assert.match(HANDOFF_PHRASINGS_VERBATIM[variant], /如果你不在台灣,請搜尋你所在地的緊急專線。/,
      `${variant}: must include non-Taiwan fallback (兜底句)`);
  }
  // Step 5.1 same.
  const step5 = getResource1925Inject('standard');
  assert.match(step5, /台灣有個地方可以接住你/);
  assert.match(step5, /如果你不在台灣,請搜尋你所在地的緊急專線。/);
});

// ─── Step 5 1925 inject ───────────────────────────────────

test('🛑 6/6 wording: getResource1925Inject(standard) — 安心專線 + 兜底句 (NO 自殺防治專線)', () => {
  const inject = getResource1925Inject('standard');
  assert.match(inject, /安心專線 1925/);
  assert.match(inject, /24 小時、免費/);
  assert.match(inject, /如果你不在台灣,請搜尋你所在地的緊急專線。/);
  // 6/6 wording: deprecated naming gone.
  assert.doesNotMatch(inject, /自殺防治專線/);
});

test('🛑 getResource1925Inject: declined contains 不強推 + 那個門 (turn2b 5.2 逐字)', () => {
  const inject = getResource1925Inject('declined');
  assert.match(inject, /1925 就在那裡、你不需要打/);
  assert.match(inject, /但如果你某天想打、它都在/);
  // forbidden 3 verbatim (turn2b 5.3).
  assert.match(inject, /不重複強推 1925/);
  assert.match(inject, /不假設「不打 1925 = 不嚴重」/);
  assert.match(inject, /不質問「為什麼不打」/);
});

// ─── Sub-prompt phrasing locks ───────────────────────────

test('🛑 directSiQuestion: contains Step 2.1 phrasing verbatim', () => {
  assert.match(directSiQuestion.prompt_content,
    /你現在有沒有想要傷害自己、或是結束生命的念頭/);
});

test('🛑 immediateSafetyCheck: contains Step 2.3 phrasing「你今天有具體的計畫嗎」', () => {
  assert.match(immediateSafetyCheck.prompt_content, /我聽到了/);
  assert.match(immediateSafetyCheck.prompt_content, /你今天有具體的計畫嗎/);
  assert.match(immediateSafetyCheck.prompt_content,
    /不可追問「什麼計畫\?」.*紅線/);
});

test('🛑 protectiveFactorInquiry: contains Step 3.1 「你的『理由』、是你會記得回來的」', () => {
  assert.match(protectiveFactorInquiry.prompt_content,
    /你現在生命裡、有沒有任何人、任何事/);
  assert.match(protectiveFactorInquiry.prompt_content, /是你的『理由』、是你會記得回來的/);
});

// ─── carry_forward writer helpers ─────────────────────────

test('🛑 mapSopCategoryToCarryForward: trauma/worth/passive_dw_* → 3-bucket carry_forward', () => {
  assert.equal(mapSopCategoryToCarryForward(CRISIS_CATEGORY.TRAUMA),              'trauma');
  assert.equal(mapSopCategoryToCarryForward(CRISIS_CATEGORY.WORTH_FICTION),       'worth_fiction');
  assert.equal(mapSopCategoryToCarryForward(CRISIS_CATEGORY.PASSIVE_DW_STRONG),   'passive_death_wish');
  assert.equal(mapSopCategoryToCarryForward(CRISIS_CATEGORY.PASSIVE_DW_IMPLICIT), 'passive_death_wish');
  assert.equal(mapSopCategoryToCarryForward(CRISIS_CATEGORY.CUMULATIVE),          'passive_death_wish');
  assert.equal(mapSopCategoryToCarryForward(CRISIS_CATEGORY.FREEZE),              'passive_death_wish');
});

test('🛑 deriveSiRiskLevel: deny → denied; confirm + no_plan → active_no_plan; confirm + has_plan → active_with_plan', () => {
  assert.equal(deriveSiRiskLevel({ siAnswer: 'deny' }),                      SI_RISK_LEVEL.DENIED);
  assert.equal(deriveSiRiskLevel({ siAnswer: 'confirm', planAnswer: 'no_plan' }),  SI_RISK_LEVEL.ACTIVE_NO_PLAN);
  assert.equal(deriveSiRiskLevel({ siAnswer: 'confirm', planAnswer: 'has_plan' }), SI_RISK_LEVEL.ACTIVE_WITH_PLAN);
  assert.equal(deriveSiRiskLevel({ siAnswer: 'ambiguous' }),                 SI_RISK_LEVEL.PASSIVE);
});

test('🛑 buildFullCarryForward: complete schema with landing errata §2.2 new 3 fields', () => {
  const cf = buildFullCarryForward({
    sopState: {
      crisis_trigger_category: CRISIS_CATEGORY.PASSIVE_DW_STRONG,
      si_answer: 'confirm', plan_answer: 'has_plan',
      protective_factor_surfaced: '家人',
      handoff_choice: 'b',
      reminder_variant_used: 'A',
      safety_plan: { activities: ['上班', '接小孩'], safe_location: true, self_harm_denied: true },
    },
    invokedAt: '2026-06-05T12:00:00Z',
  });
  assert.equal(cf.crisis_category, 'passive_death_wish');
  assert.equal(cf.si_risk_level, SI_RISK_LEVEL.ACTIVE_WITH_PLAN);
  assert.deepEqual(cf.safety_plan.activities, ['上班', '接小孩']);
  // landing errata §2.2 new fields.
  assert.equal(cf.landing_page_reminder_delivered, true);
  assert.equal(cf.professional_referral_acknowledged, false);
  assert.equal(cf.professional_referral_refused, false);
  // resolved stays null at write time.
  assert.equal(cf.resolved_at, null);
  assert.equal(cf.resolution_type, null);
});

// ─── PR-23a si_confirm_pending classifier 退役 ────────────

test('🛑 deep-signal-detector: si_confirm_pending TODO marker REPLACED with crisis-sop ref', async () => {
  const { default: dsd, prompt_content_passive_dw_strong } = await import(
    '../prompt-sections/conditional/engine-3/deep-signal-detector.js'
  );
  // PR-23a TODO marker gone.
  assert.doesNotMatch(prompt_content_passive_dw_strong, /TODO\(任務3\)/);
  // New ref to crisis-sop.js + retirement note.
  assert.match(prompt_content_passive_dw_strong, /Step 6 PR-6a/);
  assert.match(prompt_content_passive_dw_strong, /crisis-sop\.js/);
  assert.match(prompt_content_passive_dw_strong, /si_confirm_pending 過渡 classifier 退役/);
});

// ─── R1_C unlock for de-escalation sub-mode ──────────────

test('🛑 R1_C: gate blocked when de_escalation_sub_mode flag absent', () => {
  const inject = R1.buildInject({ variant: R1_VARIANTS.R1_C });
  assert.match(inject, /disabled/);
  assert.match(inject, /沒進入 crisis-mixed-with-meaning-making/);
});

test('🛑 R1_C: unlocked when de_escalation_sub_mode=true (Step 6 PR-6a)', () => {
  const inject = R1.buildInject({
    variant: R1_VARIANTS.R1_C,
    de_escalation_sub_mode: true,
    projection_quote: '他不在我就沒動力',
  });
  assert.match(inject, /de-escalation sub-mode/);
  assert.match(inject, /Step 6 PR-6a unlocked/);
  // limited invoke marker.
  assert.match(inject, /M70 guard/);
  assert.match(inject, /per session R1_C 不得 > 2 次/);
});

// ─── advanceSopState helper ──────────────────────────────

test('🛑 advanceSopState: marks current step completed + sets next + immutable', () => {
  const initial = buildInitialSopState({
    category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1,
  });
  const next = advanceSopState(initial, {
    nextStep: SOP_STEPS.STEP_2_SI_RISK, nextAwaiting: CRISIS_AWAITING.SI_ANSWER,
  });
  assert.equal(next.current_step, SOP_STEPS.STEP_2_SI_RISK);
  assert.equal(next.awaiting, CRISIS_AWAITING.SI_ANSWER);
  assert.ok(next.steps_completed.includes('1'));
  // immutability — initial unchanged.
  assert.equal(initial.current_step, SOP_STEPS.STEP_1_ACKNOWLEDGE);
});

// ─── Reminder offer cap (M72) ─────────────────────────────

test('🛑 REMINDER_OFFER_MAX = 3 (M72 不糾纏 cap)', async () => {
  const { REMINDER_OFFER_MAX } = await import('../sub-prompts/crisis/_constants.js');
  assert.equal(REMINDER_OFFER_MAX, 3);
});

// ─── Detector registration ───────────────────────────────

test('🛑 CRISIS_SOP_DETECTOR shape: id + priority + handler', () => {
  assert.equal(CRISIS_SOP_DETECTOR.id, 'CRISIS_sop_state_machine');
  assert.equal(CRISIS_SOP_DETECTOR.type, 'conditional_inject');
  assert.equal(CRISIS_SOP_DETECTOR.trigger_event, 'user_turn');
  assert.equal(CRISIS_SOP_DETECTOR.priority, CASCADE_PRIORITY.CRISIS_sop);
  assert.equal(typeof CRISIS_SOP_DETECTOR.handler, 'function');
});

// ════════════════════════════════════════════════════════════════
// P0 HOTFIX (Vivi 6/6, A015 case) — crisis lock release at closure
// ════════════════════════════════════════════════════════════════

test('🛑 P0 Fix 1: fromStep8 closure clears crisis_in_progress / primary_mode / active_modes', async () => {
  // Set up Step 8 entry state with all 3 lock flags + non-crisis paused modes.
  const state = {
    crisis_in_progress: true,
    primary_mode: 'crisis',
    active_modes: ['crisis'],
    paused_modes: ['elicitation', 'identity_anchoring'],
    crisis_sop_state: {
      ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
      current_step: SOP_STEPS.STEP_8_CLOSURE,
      awaiting: CRISIS_AWAITING.CLOSURE_ACK,
      si_answer: SI_ANSWER.DENY,
      reminder_variant_used: 'A',
      reminder_offer_count: 1,
    },
  };
  const r = await crisisSopHandler({ session_state: state, user_response: '謝謝' });
  assert.equal(r.handled, true);
  // Closure complete.
  assert.equal(r.patch.crisis_sop_complete, true);
  // ⭐ 3 lock flags cleared so onboarding / normal routing can take over.
  assert.equal(r.patch.crisis_in_progress, false,
    'closure MUST release crisis_in_progress (A015 brick fix)');
  assert.equal(r.patch.primary_mode, null,
    'closure MUST clear primary_mode (no more crisis routing)');
  assert.ok(Array.isArray(r.patch.active_modes),
    'closure MUST emit a new active_modes array');
  assert.ok(!r.patch.active_modes.includes('crisis'),
    'closure MUST remove crisis from active_modes');
  assert.ok(Array.isArray(r.patch.paused_modes));
  assert.ok(!r.patch.paused_modes.includes('crisis'));
  // Audit + carry-forward signal preserved.
  assert.ok(r.patch.m71_reminder_audit);
  assert.equal(r.patch.m71_reminder_audit.delivered, true);
  // sopState preserved with closure_explicit=true (audit trail).
  assert.equal(r.patch.crisis_sop_state.closure_explicit, true);
  assert.equal(r.patch.crisis_sop_state.current_step, SOP_STEPS.STEP_8_CLOSURE);
  // Inject still emits closure phrasing + new SYSTEM NOTE about lock release.
  assert.match(r.inject, /Crisis 鎖已釋放/);
});

test('🛑 P0 Fix 1: closure cleanup preserves non-crisis active_modes (e.g. elicitation)', async () => {
  // Edge — non-crisis modes that were active at closure must survive.
  const state = {
    crisis_in_progress: true,
    primary_mode: 'crisis',
    active_modes: ['crisis', 'integration'],
    paused_modes: ['identity_anchoring'],
    crisis_sop_state: {
      ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
      current_step: SOP_STEPS.STEP_8_CLOSURE,
      awaiting: CRISIS_AWAITING.CLOSURE_ACK,
      si_answer: SI_ANSWER.DENY,
      reminder_variant_used: 'A',
    },
  };
  const r = await crisisSopHandler({ session_state: state, user_response: '謝謝' });
  // Only 'crisis' removed; other modes preserved.
  assert.deepEqual(r.patch.active_modes, ['integration']);
  assert.deepEqual(r.patch.paused_modes, ['identity_anchoring']);
});

// ─── P0 Fix 3: kickoff RESUME re-presents current step ───────────────

test('🛑 P0 Fix 3 (Patrick 回修): kickoff (is_kickoff=true, user_response="") + mid-SOP Step 4 → re-present, no advance', async () => {
  // A015 case: 學員打「我想自殺」 → engine-3 fast-path inits SOP at Step 4 →
  // 學員 disengages → comes back, frontend sends kickoff. chat.js (L1127)
  // CLEARS user_response to '' on kickoff to keep other detectors quiet.
  // crisis-sop reads ctx.is_kickoff (boolean) — not the stripped sentinel.
  const sopState = {
    ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
    current_step: SOP_STEPS.STEP_4_HANDOFF,
    awaiting: CRISIS_AWAITING.HANDOFF_ACK,
    handoff_variant_used: 'high_risk',
    si_answer: SI_ANSWER.CONFIRM,
    active_si_explicit: true,
  };
  const state = {
    crisis_in_progress: true,
    primary_mode: 'crisis',
    active_modes: ['crisis'],
    crisis_sop_state: sopState,
  };
  // Production-faithful: user_response is '' (cleared by chat.js); is_kickoff=true.
  const r = await crisisSopHandler({
    session_state: state,
    user_response: '',
    is_kickoff: true,
  });
  assert.equal(r.handled, true);
  // No state advance (patch empty).
  assert.deepEqual(r.patch, {},
    'kickoff RESUME must NOT advance sopState (preserve mid-SOP position)');
  // Re-emits Step 4 high_risk phrasing.
  assert.match(r.inject, /Step 4 Handoff Direct-1925 \(high_risk\)/);
  assert.match(r.inject, /Kickoff RESUME/);
});

test('🛑 P0 Fix 3: kickoff + Step 3 (protective) mid-SOP → re-present protective inquiry', async () => {
  const sopState = {
    ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
    current_step: SOP_STEPS.STEP_3_PROTECTIVE,
    awaiting: CRISIS_AWAITING.PROTECTIVE_FACTOR,
    si_answer: SI_ANSWER.DENY,
  };
  const state = {
    crisis_in_progress: true,
    crisis_sop_state: sopState,
  };
  const r = await crisisSopHandler({
    session_state: state,
    user_response: '',           // production: cleared on kickoff
    is_kickoff: true,
  });
  assert.equal(r.handled, true);
  assert.match(r.inject, /Step 3 Protective Factor/);
  assert.match(r.inject, /Kickoff RESUME/);
});

test('🛑 P0 Fix 3 regression: NON-kickoff (is_kickoff absent) real user turn at Step 4 → normal dispatch (advances to Step 6)', async () => {
  // Regression: Fix 3 must fire ONLY on kickoff. Real student response should
  // progress the SOP normally and NOT mis-fire as a resume.
  const sopState = {
    ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
    current_step: SOP_STEPS.STEP_4_HANDOFF,
    awaiting: CRISIS_AWAITING.HANDOFF_ACK,
    handoff_variant_used: 'high_risk',
    si_answer: SI_ANSWER.CONFIRM,
  };
  const state = {
    crisis_in_progress: true,
    crisis_sop_state: sopState,
  };
  const r = await crisisSopHandler({
    session_state: state,
    user_response: '好',          // real student ack
    // is_kickoff omitted (undefined → falsy)
    user_profile: { passive_death_wish_count: 1 },
  });
  assert.equal(r.handled, true);
  // Normal advance: high_risk variant → oneShot1925 path → Step 6.
  assert.equal(r.patch.crisis_sop_state.current_step, SOP_STEPS.STEP_6_LANDING_REMINDER);
  // Reminder inject (Step 6), not Kickoff RESUME marker.
  assert.doesNotMatch(r.inject, /Kickoff RESUME/);
});

test('🛑 P0 Fix 3 edge: is_kickoff=true at FIRST-entry (no preExistingSopState) → NORMAL init + dispatch (NOT resume)', async () => {
  // Negative regression per Patrick: the very first crisis turn can also be
  // a kickoff (e.g. legacy session reloaded with stale lock flags but no
  // sopState). Without preExistingSopState the resume path MUST NOT fire —
  // handler should initialize fresh SOP and dispatch.
  const state = {
    crisis_in_progress: true,
    primary_mode: 'crisis',
    // NO crisis_sop_state yet
    deep_signal_flags: { passive_dw_detected: true, passive_dw_signal: 'strong' },
  };
  const r = await crisisSopHandler({
    session_state: state,
    user_response: '',
    is_kickoff: true,
  });
  assert.equal(r.handled, true);
  // Initialize-then-dispatch path → state was created + advanced.
  assert.notEqual(r.patch.crisis_sop_state?.current_step, undefined);
  assert.doesNotMatch(r.inject, /Kickoff RESUME/);
});

test('🛑 P0 Fix 3 regression: synthetic sentinel in user_response (without is_kickoff) → NOT a resume', async () => {
  // Defensive: even if a future bug accidentally lets the kickoff sentinel
  // bleed through to user_response (instead of being cleared to ''), the
  // string-check path is GONE — only ctx.is_kickoff fires the resume.
  // This locks Patrick's repro: production contract is "is_kickoff boolean".
  const sopState = {
    ...buildInitialSopState({ category: CRISIS_CATEGORY.PASSIVE_DW_STRONG, step1Variant: STEP1_VARIANT.C_1 }),
    current_step: SOP_STEPS.STEP_4_HANDOFF,
    awaiting: CRISIS_AWAITING.HANDOFF_ACK,
    handoff_variant_used: 'high_risk',
    si_answer: SI_ANSWER.CONFIRM,
  };
  const state = { crisis_in_progress: true, crisis_sop_state: sopState };
  const r = await crisisSopHandler({
    session_state: state,
    user_response: '[session-start trigger — synthetic sentinel that production never sends]',
    // is_kickoff intentionally absent — sentinel string alone is NOT enough
  });
  assert.doesNotMatch(r.inject, /Kickoff RESUME/,
    'sentinel string in user_response (no is_kickoff) must NOT trigger resume — Patrick contract');
});

// ─── P0 hotfix gate: SOP-in-flight via sopState (belt-and-suspenders) ──

test('🛑 P0 Fix 1 + Fix 2: handler does NOT fire post-closure (flags cleared, sopState complete)', async () => {
  // After Fix 1 ran, the next turn must not re-enter the crisis SOP.
  const state = {
    crisis_in_progress: false,         // cleared
    primary_mode: null,                 // cleared
    active_modes: ['elicitation'],     // crisis filtered out
    crisis_sop_state: {                 // preserved (audit)
      current_step: SOP_STEPS.STEP_8_CLOSURE,
      awaiting: null,
      closure_explicit: true,
    },
    crisis_sop_complete: true,
  };
  const r = await crisisSopHandler({ session_state: state, user_response: 'thanks' });
  assert.equal(r.handled, false,
    'post-closure → handler must not re-enter SOP');
});

test('🛑 P0 hotfix gate: sopState alone (no flags) gates crisis-sop entry (belt-and-suspenders)', async () => {
  // Defensive: even if a future code path sets crisis_sop_state without
  // setting the lock flags, crisis-sop must still take the turn.
  const state = {
    // NO lock flags
    crisis_sop_state: {
      current_step: SOP_STEPS.STEP_4_HANDOFF,
      awaiting: CRISIS_AWAITING.HANDOFF_ACK,
      handoff_variant_used: 'standard',
      si_answer: SI_ANSWER.DENY,
    },
  };
  const r = await crisisSopHandler({
    session_state: state,
    user_response: 'ok',
    user_profile: { passive_death_wish_count: 1 },
  });
  assert.equal(r.handled, true,
    'sopState in-flight (no flags) must still fire handler — belt-and-suspenders');
});
