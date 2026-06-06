// lib/sub-prompts/onboarding/_constants.js
// v5.2 第四塊 PR-a (Vivi 6/5) — Onboarding state machine shared enums + state shape.
//
// Source: v52_context_anchored_spec §1 (Onboarding 3 步驟 終審 verbatim) + §7.2
//         (新學員強制走).
//
// session_state.onboarding_step shape:
//   {
//     current_step: 1 | 2 | 3 | null,
//     awaiting: null | 'category_pick' | 'articulate' | 'confirm',
//     picked_category: number|null (1-5),
//     articulate_text: string|null (學員 step 2 articulate),
//   }
//
// Completion: current_step=null + students.context_onboarded=TRUE atomic write
// (PR-b chat.js wire).

export const ONBOARDING_STEPS = Object.freeze({
  STEP_1_CATEGORY_PICK: 1,
  STEP_2_ARTICULATE:    2,
  STEP_3_CONFIRM:       3,
  COMPLETE:             null,
});

export const ONBOARDING_AWAITING = Object.freeze({
  CATEGORY_PICK: 'category_pick',
  ARTICULATE:    'articulate',
  CONFIRM:       'confirm',
});

/**
 * Build the initial onboarding state when chat.js first detects
 * !context_onboarded for a student.
 */
export function buildInitialOnboardingState() {
  return {
    current_step:     ONBOARDING_STEPS.STEP_1_CATEGORY_PICK,
    awaiting:         ONBOARDING_AWAITING.CATEGORY_PICK,
    picked_category:  null,
    articulate_text:  null,
  };
}

/**
 * Advance onboarding state immutably.
 */
export function advanceOnboardingState(prev, { nextStep, nextAwaiting, patch = {} }) {
  return {
    ...prev,
    ...patch,
    current_step: nextStep,
    awaiting: nextAwaiting,
  };
}
