// lib/sub-prompts/crisis/_constants.js
// v5.1 Step 6 PR-6a — Crisis SOP shared enums + state shape.
//
// Source: v51_checkpoint1_v2_turn2b.md §10 (9-step SOP) + landing errata Step 6 insertion.
//
// session_state.crisis_sop_state shape:
//   {
//     current_step: 0 | 1 | 2 | '2.3' | 3 | 4 | 5 | 6 | 7 | 8,
//     awaiting: null | 'acknowledge_ack' | 'si_answer' | 'plan_question' |
//               'protective_factor' | 'handoff_choice' | 'reminder_response' |
//               'safety_activities' | 'safe_location' | 'contracting' | 'closure_ack',
//     steps_completed: ['0', '1', '2', ...],
//     crisis_trigger_category: 'trauma' | 'worth_fiction' |
//                              'passive_dw_strong' | 'passive_dw_implicit' | 'cumulative',
//     step1_variant_used: 'A' | 'B' | 'C-1' | 'C-2' | 'C-3',
//     si_answer: null | 'deny' | 'confirm' | 'ambiguous',
//     plan_answer: null | 'has_plan' | 'no_plan',
//     protective_factor_surfaced: null | string,
//     handoff_choice: null | 'a' | 'b' | 'c',
//     handoff_variant_used: null | 'standard' | 'remove_c' | 'only_b' | 'freeze',
//     reminder_variant_used: null | 'A' | 'B' | 'C',
//     reminder_offer_count: number,    // <= 3 不糾纏 (M72)
//     safety_plan: {
//       activities: [],
//       safe_location: bool | null,
//       self_harm_denied: bool | null,
//     },
//     closure_explicit: bool | null,
//   }

export const SOP_STEPS = Object.freeze({
  STEP_0_TRANSITION:       0,
  STEP_1_ACKNOWLEDGE:      1,
  STEP_2_SI_RISK:          2,
  STEP_2_3_PLAN_CHECK:     '2.3',
  STEP_3_PROTECTIVE:       3,
  STEP_4_HANDOFF:          4,
  STEP_5_1925:             5,
  STEP_6_LANDING_REMINDER: 6,
  STEP_7_SAFETY_PLANNING:  7,
  STEP_8_CLOSURE:          8,
});

export const CRISIS_AWAITING = Object.freeze({
  ACKNOWLEDGE_ACK:    'acknowledge_ack',
  SI_ANSWER:          'si_answer',
  PLAN_QUESTION:      'plan_question',
  PROTECTIVE_FACTOR:  'protective_factor',
  HANDOFF_CHOICE:     'handoff_choice',      // @deprecated errata v02 — kept for legacy state read; new sessions use HANDOFF_ACK
  HANDOFF_ACK:        'handoff_ack',          // ⭐ errata v02 — AI delivered direct-1925, awaiting tacit ack (any response advances)
  REMINDER_RESPONSE:  'reminder_response',
  SAFETY_ACTIVITIES:  'safety_activities',
  SAFE_LOCATION:      'safe_location',
  CONTRACTING:        'contracting',
  CLOSURE_ACK:        'closure_ack',
});

export const CRISIS_CATEGORY = Object.freeze({
  TRAUMA:              'trauma',                   // 變體 A (turn2b §10.3 step 1)
  WORTH_FICTION:       'worth_fiction',            // 變體 B
  PASSIVE_DW_STRONG:   'passive_dw_strong',        // 變體 C-1
  PASSIVE_DW_IMPLICIT: 'passive_dw_implicit',      // 變體 C-2
  CUMULATIVE:          'cumulative',               // 變體 C-3 (count >= 3)
  FREEZE:              'freeze',                   // count >= 5 (Step 1 C-4 / Step 4.4)
});

export const STEP1_VARIANT = Object.freeze({
  A:   'A',
  B:   'B',
  C_1: 'C-1',
  C_2: 'C-2',
  C_3: 'C-3',
});

export const SI_ANSWER = Object.freeze({
  DENY:      'deny',
  CONFIRM:   'confirm',
  AMBIGUOUS: 'ambiguous',
});

export const PLAN_ANSWER = Object.freeze({
  HAS_PLAN: 'has_plan',
  NO_PLAN:  'no_plan',
});

export const SI_RISK_LEVEL = Object.freeze({
  DENIED:           'denied',
  PASSIVE:          'passive',
  ACTIVE_NO_PLAN:   'active_no_plan',
  ACTIVE_WITH_PLAN: 'active_with_plan',
});

// ⭐ errata v02 (Vivi 6/6) — 三選一 廢除, 改 direct-1925.
//   STANDARD / CUMULATIVE / HIGH_RISK / FREEZE — semantic 改 + threshold 改:
//     CUMULATIVE: count >= 2 (was REMOVE_C count >= 3 under old design)
//     HIGH_RISK:  SI confirm + has_plan OR no protective (was ONLY_B same trigger)
//   REMOVE_C / ONLY_B 保留 as deprecated aliases (same value as new names) for
//   back-compat with existing in-flight session_state / historical carry_forward.
export const HANDOFF_VARIANT = Object.freeze({
  STANDARD:   'standard',     // 4.1 direct 1925
  CUMULATIVE: 'cumulative',   // 4.2 count >= 2, errata v02
  HIGH_RISK:  'high_risk',    // 4.3 SI confirm+plan OR no protective
  FREEZE:     'freeze',       // 4.3b count >= 5
  // @deprecated — back-compat aliases (same value as new names).
  REMOVE_C:   'cumulative',   // alias of CUMULATIVE
  ONLY_B:     'high_risk',    // alias of HIGH_RISK
});

// @deprecated errata v02 — 學員不再 choice (a)(b)(c). Kept for legacy
// carry_forward read in V6 reminder gate + day-opening selector. New sessions
// always write handoff_choice = null.
export const HANDOFF_CHOICE = Object.freeze({
  A: 'a',
  B: 'b',
  C: 'c',
});

export const REMINDER_VARIANT = Object.freeze({
  A: 'A',   // First crisis (passive_death_wish_count == 1)
  B: 'B',   // Cross-session 累積 (count >= 2)
  C: 'C',   // Student 拒絕專業 resource
});

export const REMINDER_OFFER_MAX = 3;   // M72 不糾纏 cap.

/**
 * Default initial crisis_sop_state when crisis is first triggered.
 *
 * @param {object} args
 * @returns {object}
 */
export function buildInitialSopState({ category, step1Variant }) {
  return {
    current_step: SOP_STEPS.STEP_1_ACKNOWLEDGE,
    awaiting: CRISIS_AWAITING.ACKNOWLEDGE_ACK,
    steps_completed: [String(SOP_STEPS.STEP_0_TRANSITION)],
    crisis_trigger_category: category || CRISIS_CATEGORY.PASSIVE_DW_STRONG,
    step1_variant_used: step1Variant || STEP1_VARIANT.C_1,
    si_answer: null,
    plan_answer: null,
    protective_factor_surfaced: null,
    handoff_choice: null,
    handoff_variant_used: null,
    reminder_variant_used: null,
    reminder_offer_count: 0,
    safety_plan: { activities: [], safe_location: null, self_harm_denied: null },
    closure_explicit: null,
  };
}

/**
 * Advance step + mark completed (immutable patch helper).
 */
export function advanceSopState(prevState, { nextStep, nextAwaiting, patch = {} }) {
  const completed = Array.isArray(prevState.steps_completed)
    ? prevState.steps_completed : [];
  const currentKey = String(prevState.current_step);
  const nextCompleted = completed.includes(currentKey) ? completed : [...completed, currentKey];
  return {
    ...prevState,
    ...patch,
    current_step: nextStep,
    awaiting: nextAwaiting ?? null,
    steps_completed: nextCompleted,
  };
}
