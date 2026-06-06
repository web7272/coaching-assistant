// lib/sub-prompts/onboarding/index.js
// v5.2 第四塊 PR-a — Onboarding state machine + sub-prompts registry.

export {
  ONBOARDING_STEPS, ONBOARDING_AWAITING,
  buildInitialOnboardingState, advanceOnboardingState,
} from './_constants.js';

export { default as step1CategoryPick, STEP_1_PHRASING_VERBATIM, prompt_content as STEP_1_INJECT }
  from './step-1-category-pick.js';

export {
  default as step2Articulate,
  prompt_content as STEP_2_INJECT,    // backwards-compat (placeholder category label)
  buildStep2Inject,                    // 6/6 hotfix — picked_category-aware
  buildStep2Phrasing,                  // 6/6 v3 — student-facing 2-line phrasing builder (replaces STEP_2_PHRASING_VERBATIM)
} from './step-2-articulate.js';

export {
  default as step3Confirm,
  buildStep3Phrasing, buildPromptContent as buildStep3Inject,
} from './step-3-confirm.js';

export {
  parseCategoryPick, parseArticulate, parseConfirm,
  sanitizeName, sanitizeDefinition,
} from './parse-helpers.js';
