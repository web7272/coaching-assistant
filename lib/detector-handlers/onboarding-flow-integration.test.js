// lib/detector-handlers/onboarding-flow-integration.test.js
// v5.2 第四塊 PR-b — Onboarding intercept integration tests:
//   1. handler defers when crisis_in_progress (safety override) — orthogonal.
//   2. handler emits onboarding_complete_write payload at COMPLETE step
//      (chat.js consumes for atomic students UPDATE — mocked SQL would lock here).
//   3. Full 3-turn happy path: !onboarded → step 1 → step 2 → step 3 confirm
//      → COMPLETE write.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onboardingFlowHandler } from './onboarding-flow.js';
import {
  ONBOARDING_STEPS, ONBOARDING_AWAITING,
} from '../sub-prompts/onboarding/index.js';

// ─── Full happy path (3 turns) ───────────────────────────

test('🛑 v5.2 onboarding full path: new student → step 1 → step 2 → step 3 confirm → COMPLETE', async () => {
  let state = {};
  let writePayload = null;

  // Turn 0: !onboarded + no state → init + inject step 1.
  let r = await onboardingFlowHandler({
    session_state: state, user_response: '',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, true);
  assert.match(r.inject, /Step 1 · Category Pick/);
  assert.match(r.inject, /從你最在意的地方開始/);
  state = { onboarding_step: r.patch.onboarding_step };
  assert.equal(state.onboarding_step.current_step, ONBOARDING_STEPS.STEP_1_CATEGORY_PICK);

  // Turn 1: 學員回應「2」 → step 2 articulate.
  r = await onboardingFlowHandler({
    session_state: state, user_response: '2',
    student_context_onboarded: false,
  });
  assert.match(r.inject, /Step 2 · Articulate/);
  state = { onboarding_step: r.patch.onboarding_step };
  assert.equal(state.onboarding_step.current_step, ONBOARDING_STEPS.STEP_2_ARTICULATE);
  assert.equal(state.onboarding_step.picked_category, 2);

  // Turn 2: 學員 articulate「我跟先生的溝通」 → step 3 confirm with verbatim phrasing.
  r = await onboardingFlowHandler({
    session_state: state, user_response: '我跟先生的溝通',
    student_context_onboarded: false,
  });
  assert.match(r.inject, /Step 3 · Confirm/);
  assert.match(r.inject, /這 21 天、我們聚焦在『我跟先生的溝通』/);
  state = { onboarding_step: r.patch.onboarding_step };
  assert.equal(state.onboarding_step.current_step, ONBOARDING_STEPS.STEP_3_CONFIRM);
  assert.equal(state.onboarding_step.articulate_text, '我跟先生的溝通');

  // Turn 3: 學員 confirm「對」 → COMPLETE + emit write payload.
  r = await onboardingFlowHandler({
    session_state: state, user_response: '對',
    student_context_onboarded: false,
  });
  assert.match(r.inject, /Onboarding Complete/);
  // State cleared.
  assert.equal(r.patch.onboarding_step, null);
  // Write payload contract for chat.js atomic UPDATE.
  writePayload = r.onboarding_complete_write;
  assert.deepEqual(writePayload, {
    active_context_category: 2,
    active_context_name: '我跟先生的溝通',
    active_context_definition: '我跟先生的溝通',
    context_onboarded: true,
  });
});

// ─── Reject path: step 3 → reject → step 2 → re-articulate → confirm ──

test('🛑 v5.2 onboarding reject path: step 3 reject → step 2 → re-articulate → confirm', async () => {
  let state = {
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_3_CONFIRM,
      awaiting: ONBOARDING_AWAITING.CONFIRM,
      picked_category: 3,
      articulate_text: '原生家庭',
    },
  };

  // Reject → 回 step 2 + clear articulate_text.
  let r = await onboardingFlowHandler({
    session_state: state, user_response: '不對',
    student_context_onboarded: false,
  });
  assert.match(r.inject, /回 step 2 重新 articulate/);
  state = { onboarding_step: r.patch.onboarding_step };
  assert.equal(state.onboarding_step.current_step, ONBOARDING_STEPS.STEP_2_ARTICULATE);
  assert.equal(state.onboarding_step.articulate_text, null);
  assert.equal(state.onboarding_step.picked_category, 3, 'category preserved across reject');
  assert.equal(r.onboarding_complete_write, undefined);

  // Re-articulate with new phrasing → step 3 with new text.
  r = await onboardingFlowHandler({
    session_state: state, user_response: '我跟父母的距離',
    student_context_onboarded: false,
  });
  assert.match(r.inject, /這 21 天、我們聚焦在『我跟父母的距離』/);
  state = { onboarding_step: r.patch.onboarding_step };
  assert.equal(state.onboarding_step.articulate_text, '我跟父母的距離');

  // Confirm → COMPLETE with new articulate.
  r = await onboardingFlowHandler({
    session_state: state, user_response: '對',
    student_context_onboarded: false,
  });
  assert.equal(r.onboarding_complete_write.active_context_category, 3);
  assert.equal(r.onboarding_complete_write.active_context_name, '我跟父母的距離');
  assert.equal(r.onboarding_complete_write.context_onboarded, true);
});

// ─── Crisis override during onboarding ──────────────────

test('🛑 v5.2 onboarding crisis override: 學員 step 1 surface 死亡訊號 → defer to crisis SOP', async () => {
  // Crisis state takes precedence per task spec safety rule.
  const state = {
    crisis_in_progress: true,
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_1_CATEGORY_PICK,
      awaiting: ONBOARDING_AWAITING.CATEGORY_PICK,
      picked_category: null,
      articulate_text: null,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '我不想活',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, false,
    'crisis_in_progress must defer onboarding (regardless of onboarding state)');
  // Onboarding state NOT cleared — when crisis exits, learner resumes onboarding
  // at the same step (no data loss).
});

test('🛑 v5.2 onboarding: primary_mode=crisis → defer (active_modes alternative path)', async () => {
  const state = {
    primary_mode: 'crisis', active_modes: ['crisis'],
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_2_ARTICULATE,
      awaiting: ONBOARDING_AWAITING.ARTICULATE,
      picked_category: 5,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '我的焦慮',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, false);
});

test('🛑 v5.2 onboarding: active_modes includes crisis → defer', async () => {
  const state = {
    primary_mode: 'elicitation', active_modes: ['elicitation', 'crisis'],
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_1_CATEGORY_PICK,
      awaiting: ONBOARDING_AWAITING.CATEGORY_PICK,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '事業',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, false);
});

// ─── Existing beta student (onboarded=TRUE) ──────────────

test('🛑 v5.2 onboarding: existing beta student (onboarded=TRUE) → defer (normal flow)', async () => {
  const r = await onboardingFlowHandler({
    session_state: {},
    user_response: '我想要更勇敢',
    student_context_onboarded: true,
  });
  assert.equal(r.handled, false, 'onboarded student bypasses onboarding intercept');
});

// ─── Edge: long articulate truncation ───────────────────

test('🛑 v5.2 onboarding: articulate > 30 chars → name truncated + def 200 cap', async () => {
  const longText = '我跟先生的溝通主要是日常溝通也包含原生家庭的影響很複雜需要慢慢處理';
  assert.ok(longText.length > 30, 'test fixture must exceed 30');
  const state = {
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_3_CONFIRM,
      awaiting: ONBOARDING_AWAITING.CONFIRM,
      picked_category: 2,
      articulate_text: longText,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '是的',
    student_context_onboarded: false,
  });
  assert.equal(r.onboarding_complete_write.active_context_name.length, 30);
  assert.equal(r.onboarding_complete_write.active_context_definition.length,
    Math.min(longText.length, 200));
});
