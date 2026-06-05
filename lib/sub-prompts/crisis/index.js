// lib/sub-prompts/crisis/index.js
// v5.1 Step 6 PR-6a — Crisis SOP sub-prompts registry.

export {
  SOP_STEPS, CRISIS_AWAITING, CRISIS_CATEGORY, STEP1_VARIANT,
  SI_ANSWER, PLAN_ANSWER, SI_RISK_LEVEL,
  HANDOFF_VARIANT, HANDOFF_CHOICE, REMINDER_VARIANT, REMINDER_OFFER_MAX,
  buildInitialSopState, advanceSopState,
} from './_constants.js';

export {
  getStep1Inject, STEP_1_VARIANTS_AVAILABLE,
} from './acknowledge-variants.js';

export { default as directSiQuestion } from './direct-si-question.js';
export { default as immediateSafetyCheck } from './immediate-safety-check.js';
export { default as protectiveFactorInquiry } from './protective-factor-inquiry.js';
export {
  default as handoffThreeOptions, getHandoffInject, HANDOFF_VARIANTS_AVAILABLE,
} from './handoff-three-options.js';
export {
  default as resource1925, getResource1925Inject, STEP_5_SUBSTEPS,
} from './resource-1925.js';
export {
  default as landingPageReminder, selectReminderVariant, getReminderInject,
  REMINDER_VARIANTS_AVAILABLE,
  VARIANT_A_STANDARD, VARIANT_B_CUMULATIVE, VARIANT_C_REFUSAL,
} from './landing-page-reminder.js';
export { default as safetyPlanning } from './safety-planning.js';
export { default as crisisSessionClosure } from './crisis-session-closure.js';
export {
  mapSopCategoryToCarryForward, deriveSiRiskLevel, buildFullCarryForward,
} from './carry-forward-writer.js';
