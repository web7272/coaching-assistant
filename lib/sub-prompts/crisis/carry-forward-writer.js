// lib/sub-prompts/crisis/carry-forward-writer.js
// v5.1 Step 6 PR-6a — crisis_state_carry_forward schema + builder.
//
// PR-6a 提供 schema + 建構函式; PR-6b 補完整寫入 + V6 對齊 + 監控.
// Step 5c 已建 shell (engine-4-mode-aware.buildCrisisCarryForward) — 本檔 extend
// with full §10.3 step 7.3 schema + landing errata §2.2 新 3 欄.

import { SI_RISK_LEVEL, CRISIS_CATEGORY } from './_constants.js';

/**
 * Schema 完整 (turn2b §10.3 step 7.3 + landing errata §2.2):
 *
 * {
 *   crisis_triggered_at:                ISO timestamp,
 *   crisis_category:                    'trauma' | 'worth_fiction' | 'passive_death_wish',
 *   handoff_choice:                     'a' | 'b' | 'c' | null,
 *   protective_factor_surfaced:         string | null,
 *   si_risk_level:                      'denied' | 'passive' | 'active_no_plan' | 'active_with_plan',
 *   safety_plan: {
 *     activities:                       string[],
 *     safe_location:                    boolean | null,
 *     self_harm_denied:                 boolean | null,
 *   },
 *   next_session_focus:                 'follow_up_not_explore',
 *
 *   ⭐ landing errata §2.2 新 3 欄:
 *   landing_page_reminder_delivered:    boolean,     // 不 reset (cross-session 累積)
 *   professional_referral_acknowledged: boolean,
 *   professional_referral_refused:      boolean,
 *
 *   ⭐ Step 5c 已建欄位:
 *   resolved_at:                        ISO timestamp | null,
 *   resolution_type:                    'vivi_handoff' | 'natural_de_escalation' | 'freeze' | null,
 *   sessions_since_trigger:             integer,
 * }
 */

/**
 * Map turn2b §10.3 step 7.3 category enum from SOP state into carry_forward enum.
 * SOP `crisis_trigger_category` is finer (5 values incl. cumulative/freeze);
 * carry_forward uses 3-value Damon-aligned bucket (trauma / worth_fiction / passive_death_wish).
 */
export function mapSopCategoryToCarryForward(sopCategory) {
  switch (sopCategory) {
    case CRISIS_CATEGORY.TRAUMA:              return 'trauma';
    case CRISIS_CATEGORY.WORTH_FICTION:       return 'worth_fiction';
    case CRISIS_CATEGORY.PASSIVE_DW_STRONG:
    case CRISIS_CATEGORY.PASSIVE_DW_IMPLICIT:
    case CRISIS_CATEGORY.CUMULATIVE:
    case CRISIS_CATEGORY.FREEZE:              return 'passive_death_wish';
    default:                                  return null;
  }
}

/**
 * Map SI answer + plan answer to SI risk level (turn2b §10.3 step 2/2.3).
 */
export function deriveSiRiskLevel({ siAnswer, planAnswer }) {
  if (siAnswer === 'deny') return SI_RISK_LEVEL.DENIED;
  if (siAnswer === 'confirm' || siAnswer === 'ambiguous') {
    if (planAnswer === 'has_plan') return SI_RISK_LEVEL.ACTIVE_WITH_PLAN;
    if (planAnswer === 'no_plan')  return SI_RISK_LEVEL.ACTIVE_NO_PLAN;
    return SI_RISK_LEVEL.PASSIVE;   // confirm without plan answer yet
  }
  return SI_RISK_LEVEL.PASSIVE;
}

/**
 * Build complete carry_forward object from SOP state + invocation ISO.
 * PR-6a 提供 builder; PR-6b 在 e4TakeawayHandler 接 wire.
 *
 * @param {object} args
 * @param {object} args.sopState — session_state.crisis_sop_state
 * @param {string} args.invokedAt — ISO timestamp (caller-supplied)
 * @returns {object} carry_forward shape per spec
 */
export function buildFullCarryForward({ sopState, invokedAt }) {
  if (!sopState) return null;
  const category = mapSopCategoryToCarryForward(sopState.crisis_trigger_category);
  const siRisk = deriveSiRiskLevel({
    siAnswer: sopState.si_answer,
    planAnswer: sopState.plan_answer,
  });
  return {
    crisis_triggered_at: invokedAt || null,
    crisis_category: category,
    handoff_choice: sopState.handoff_choice || null,
    protective_factor_surfaced: sopState.protective_factor_surfaced || null,
    si_risk_level: siRisk,
    safety_plan: {
      activities: Array.isArray(sopState.safety_plan?.activities)
        ? [...sopState.safety_plan.activities] : [],
      safe_location: sopState.safety_plan?.safe_location ?? null,
      self_harm_denied: sopState.safety_plan?.self_harm_denied ?? null,
    },
    next_session_focus: 'follow_up_not_explore',

    // landing errata §2.2 新 3 欄.
    landing_page_reminder_delivered: !!sopState.reminder_variant_used,
    professional_referral_acknowledged: false,   // PR-6b 由 takeaway / closure parser 填
    professional_referral_refused: false,        // 同上、學員拒絕 1925 / 拒絕專業 surface

    // Step 5c shell 欄位 — buildCrisisCarryForward 在 engine-4-mode-aware 既有.
    resolved_at: null,
    resolution_type: null,
    sessions_since_trigger: 0,
  };
}
