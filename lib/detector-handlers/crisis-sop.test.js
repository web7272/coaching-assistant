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

test('🛑 parseHandoffChoice: 「我選 b」 → b', () => {
  assert.equal(parseHandoffChoice('我選 b'), HANDOFF_CHOICE.B);
});

test('🛑 parseHandoffChoice: 「(a)」/「甲」 → a', () => {
  assert.equal(parseHandoffChoice('(a)'), HANDOFF_CHOICE.A);
  assert.equal(parseHandoffChoice('我要 a'), HANDOFF_CHOICE.A);
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
  assert.match(r3.inject, /Step 4 Handoff Escalation \(standard\)/);
  assert.equal(r3.patch.crisis_sop_state.handoff_variant_used, HANDOFF_VARIANT.STANDARD);
  assert.equal(r3.patch.crisis_sop_state.protective_factor_surfaced, '家人');
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

  // has plan → Step 4 only_b + HITL critical.
  state = { ...state, crisis_sop_state: r1.patch.crisis_sop_state };
  const r2 = await crisisSopHandler({ session_state: state, user_response: '有計畫' });
  assert.match(r2.inject, /Step 4 Handoff Escalation \(only_b\)/);
  assert.match(r2.inject, /HITL critical alert/);
  assert.equal(r2.patch.crisis_sop_state.plan_answer, PLAN_ANSWER.HAS_PLAN);
  assert.equal(r2.patch.crisis_sop_state.handoff_variant_used, HANDOFF_VARIANT.ONLY_B);
  assert.equal(r2.patch.crisis_sop_state.handoff_choice, HANDOFF_CHOICE.B);
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

test('🛑 PATH 4 (no protective): Step 3 no → Step 4 only_b + HITL critical', async () => {
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
  assert.match(r.inject, /Step 4 Handoff Escalation \(only_b\)/);
  assert.match(r.inject, /HITL critical alert/);
  assert.equal(r.patch.crisis_sop_state.protective_factor_surfaced, null);
  assert.equal(r.patch.crisis_sop_state.handoff_variant_used, HANDOFF_VARIANT.ONLY_B);
  assert.equal(r.patch.hitl_critical_alert, true);
});

// ─── Path 5 — count >= 3 → remove_c ──────────────────────

test('🛑 PATH 5 (count >= 3): Step 3 has factor + count=3 → Step 4 remove_c', async () => {
  const state = {
    crisis_in_progress: true,
    crisis_sop_state: {
      ...buildInitialSopState({ category: CRISIS_CATEGORY.CUMULATIVE, step1Variant: STEP1_VARIANT.C_3 }),
      current_step: SOP_STEPS.STEP_3_PROTECTIVE, awaiting: CRISIS_AWAITING.PROTECTIVE_FACTOR,
      si_answer: SI_ANSWER.DENY,
    },
  };
  const r = await crisisSopHandler({
    session_state: state,
    user_response: '我有朋友',
    user_profile: { passive_death_wish_count: 3 },
  });
  assert.match(r.inject, /Step 4 Handoff Escalation \(remove_c\)/);
  assert.equal(r.patch.crisis_sop_state.handoff_variant_used, HANDOFF_VARIANT.REMOVE_C);
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
  assert.match(r.inject, /Step 4 Handoff Escalation \(freeze\)/);
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

// ─── Step 4 inject variant lookup ─────────────────────────

test('🛑 getHandoffInject: standard contains 三選一 a/b/c verbatim', () => {
  const inject = getHandoffInject('standard');
  assert.match(inject, /\(a\) 先停在這、不繼續挖、我們改聊輕一點的/);
  assert.match(inject, /\(b\) 我幫你預約跟 Vivi 1-on-1/);
  assert.match(inject, /\(c\) 我們先回到日常、Future Pacing/);
});

test('🛑 getHandoffInject: remove_c contains a/b but NOT c (turn2b §10.3 4.2 逐字)', () => {
  const inject = getHandoffInject('remove_c');
  assert.match(inject, /\(a\) 先停在這/);
  assert.match(inject, /\(b\) 我幫你預約跟 Vivi 1-on-1/);
  assert.doesNotMatch(inject, /\(c\) 我們先回到日常/);
});

test('🛑 getHandoffInject: only_b contains 自殺防治專線 1925 + 強制 (b) (turn2b 4.3 逐字)', () => {
  const inject = getHandoffInject('only_b');
  assert.match(inject, /你現在最需要的、是一個真人在你旁邊/);
  assert.match(inject, /自殺防治專線 1925/);
  assert.match(inject, /HITL critical alert/);
});

test('🛑 getHandoffInject: freeze references PR-23b ship-able phrasing', () => {
  const inject = getHandoffInject('freeze');
  assert.match(inject, /我看到你回來了。Vivi 知道你的狀況/);
});

// ─── Step 5 1925 inject ───────────────────────────────────

test('🛑 getResource1925Inject: standard contains 1925 + 不需要做什麼才能打 (turn2b 5.1)', () => {
  const inject = getResource1925Inject('standard');
  assert.match(inject, /自殺防治專線 1925/);
  assert.match(inject, /24 小時、免費/);
  assert.match(inject, /不需要『真的要做什麼』才能打/);
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
