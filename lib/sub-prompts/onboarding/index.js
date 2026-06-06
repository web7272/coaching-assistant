// lib/sub-prompts/onboarding/index.js
// v5.2 第四塊 PR-a — Onboarding state machine + sub-prompts registry.

export {
  ONBOARDING_STEPS, ONBOARDING_AWAITING,
  buildInitialOnboardingState, advanceOnboardingState,
} from './_constants.js';

export { default as step1CategoryPick, STEP_1_PHRASING_VERBATIM, prompt_content as STEP_1_INJECT }
  from './step-1-category-pick.js';

export { default as step2Articulate, STEP_2_PHRASING_VERBATIM, prompt_content as STEP_2_INJECT }
  from './step-2-articulate.js';

export {
  default as step3Confirm,
  buildStep3Phrasing, buildPromptContent as buildStep3Inject,
} from './step-3-confirm.js';

export {
  parseCategoryPick, parseArticulate, parseConfirm,
  sanitizeName, sanitizeDefinition,
} from './parse-helpers.js';
