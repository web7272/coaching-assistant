// lib/detector-handlers/crisis-sop.js
// v5.1 Step 6 PR-6a — Crisis SOP State Machine handler.
//
// Source: v51_checkpoint1_v2_turn2b.md §10.3 (9-step SOP) +
//         v51_section10_landing_page_errata.md §1.1-§1.3 (Step 6 + Step 7 framing).
//
// 接入點 (per Step 6 task spec):
//   Priority 2 — fires BEFORE engine-1 (10) / deep-signal (20) / passive-hope-cascade (25).
//   Only fires when state.crisis_in_progress OR primary_mode == 'crisis'.
//   When fires, returns {handled: true} → cascade short-circuit, other sub-routers skip.
//
// State machine 推進規則:
//   Each turn = read crisis_sop_state.current_step + awaiting, parse user response,
//   dispatch to next step's sub-prompt, update state for next turn.
//   Patch 23 過渡 si_confirm_pending classifier 由本 module 取代 (Step 2 完整 branches).

import {
  SOP_STEPS, CRISIS_AWAITING, CRISIS_CATEGORY, STEP1_VARIANT,
  SI_ANSWER, PLAN_ANSWER, HANDOFF_VARIANT, HANDOFF_CHOICE,
  REMINDER_VARIANT, REMINDER_OFFER_MAX,
  buildInitialSopState, advanceSopState,
  directSiQuestion, immediateSafetyCheck, protectiveFactorInquiry,
  getHandoffInject, getResource1925Inject,
  selectReminderVariant, getReminderInject,
  safetyPlanning, crisisSessionClosure,
} from '../sub-prompts/crisis/index.js';
import { CASCADE_PRIORITY } from '../detector/registry.js';

// ─────────────────────────────────────────────────────────
// User-response parsers — each step has a typed parser.
// 鐵律 #2: parsers operate on text but do not log raw text.
// ─────────────────────────────────────────────────────────

const DENY_REGEX    = /(沒有|不會|不會啦|沒|沒有那種|不用|不是|沒事|沒問題)(?!.*(?:計畫|具體))/;
const CONFIRM_REGEX = /(有|會|對|是的|嗯)(?!.*(?:沒|不|還沒))/;
const AMBIGUOUS_REGEX = /(不一定|偶爾|有時候|說不上|可能|大概|不知道|有點)/;

export function parseSiAnswer(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return null;
  if (AMBIGUOUS_REGEX.test(t)) return SI_ANSWER.AMBIGUOUS;
  if (DENY_REGEX.test(t))      return SI_ANSWER.DENY;
  if (CONFIRM_REGEX.test(t))   return SI_ANSWER.CONFIRM;
  return null;   // can't parse — caller decides fallback
}

const HAS_PLAN_REGEX = /(有(計畫|具體|想過|想好|想到|準備)|想好了|想過怎麼|計畫.{0,4}好|已經.{0,4}想)/;
const NO_PLAN_REGEX  = /(沒有.{0,4}計畫|沒計畫|沒具體|只是.{0,4}(念頭|想想|想法)|就是.{0,4}想想|沒.{0,4}具體)/;

export function parsePlanAnswer(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return null;
  // ⚠️ Check NO_PLAN first — 「沒有計畫」 contains the substring「有計畫」 which
  //   would otherwise be a HAS_PLAN false positive.
  if (NO_PLAN_REGEX.test(t))  return PLAN_ANSWER.NO_PLAN;
  if (HAS_PLAN_REGEX.test(t)) return PLAN_ANSWER.HAS_PLAN;
  return null;
}

// Protective factor — surface 句通常含 entity (家人/朋友/小孩/媽媽/etc).
//   None marker (「沒有人 / 都沒有 / 我想不到」) → null entity.
const PROTECTIVE_NONE_REGEX = /(沒有.{0,4}(人|事|可以|什麼)|都沒有|我想不到|想不出|找不到|無)/;
const PROTECTIVE_ENTITY_REGEX = /(家人|家裡|爸|媽|兒子|女兒|小孩|孩子|朋友|伴侶|先生|太太|老公|老婆|寵物|貓|狗|信仰|神|教會|目標|夢想|工作|學業|貢獻)/;

export function parseProtectiveFactor(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return { hasProtective: null, entity: null };
  if (PROTECTIVE_NONE_REGEX.test(t)) return { hasProtective: false, entity: null };
  const m = t.match(PROTECTIVE_ENTITY_REGEX);
  if (m) return { hasProtective: true, entity: m[1] };
  // No marker either way — leave for next turn / clarification.
  return { hasProtective: null, entity: null };
}

const HANDOFF_A_REGEX = /(^|\s|選|要|想)(\(?a\)?|甲|A|第一個|停一下|聊輕)/;
const HANDOFF_B_REGEX = /(^|\s|選|要|想)(\(?b\)?|乙|B|第二個|Vivi|預約|真人)/;
const HANDOFF_C_REGEX = /(^|\s|選|要|想)(\(?c\)?|丙|C|第三個|過陣子|future|再回來)/;

export function parseHandoffChoice(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return null;
  if (HANDOFF_B_REGEX.test(t)) return HANDOFF_CHOICE.B;
  if (HANDOFF_C_REGEX.test(t)) return HANDOFF_CHOICE.C;
  if (HANDOFF_A_REGEX.test(t)) return HANDOFF_CHOICE.A;
  return null;
}

const REFERRAL_REFUSE_REGEX = /(不要|不去|不需要|不會找|不打|不用|拒絕|沒用|找過.{0,4}沒用|看過.{0,4}沒用)/;
const REFERRAL_ACK_REGEX    = /(我.{0,3}(會|想|可以|要).{0,4}(找|去|看|預約|聯絡).{0,4}(諮商|心理|醫生|專業)|找專業|去諮商)/;

export function parseReminderResponse(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return { acknowledged: false, refused: false };
  return {
    acknowledged: REFERRAL_ACK_REGEX.test(t),
    refused: REFERRAL_REFUSE_REGEX.test(t) && !REFERRAL_ACK_REGEX.test(t),
  };
}

const ALONE_REGEX  = /(一個人|自己一個|沒人|獨自|沒陪)/;
const COMPANY_REGEX = /(跟|和|陪|有人在|跟家人|跟朋友|跟伴|跟先生|跟太太|跟孩子|有.{0,4}陪)/;

export function parseSafeLocation(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return null;
  if (COMPANY_REGEX.test(t)) return true;
  if (ALONE_REGEX.test(t))   return false;
  return null;
}

const CONTRACTING_REGEX = /(不會傷害|不會做|不會的|不會|沒事|我會 (?:好好|沒事)|我承諾|不會做傻事|不會這樣)/;

export function parseContracting(text) {
  const t = typeof text === 'string' ? text.trim() : '';
  if (!t) return null;
  return CONTRACTING_REGEX.test(t);
}

// ─────────────────────────────────────────────────────────
// Crisis SOP handler
// ─────────────────────────────────────────────────────────

/**
 * Crisis SOP state machine handler.
 *
 * Fires when state.crisis_in_progress OR primary_mode == 'crisis'.
 * Each turn advances by one SOP step based on user response.
 *
 * @param {object} ctx — { session_state, user_response, user_profile, ... }
 * @returns {Promise<{handled:boolean, inject?:string, patch?:object}>}
 */
export async function crisisSopHandler(ctx) {
  const state = ctx.session_state || {};
  const userResponse = typeof ctx.user_response === 'string' ? ctx.user_response : '';

  // Gate — only fire in crisis mode.
  const inCrisis = state.crisis_in_progress === true
    || state.primary_mode === 'crisis'
    || (Array.isArray(state.active_modes) && state.active_modes.includes('crisis'));
  if (!inCrisis) return { handled: false };

  // Load or initialize SOP state.
  let sopState = state.crisis_sop_state;
  if (!sopState || typeof sopState !== 'object') {
    // First entry — initialize based on the triggering signal in flags.
    // Caller (deep-signal-detector / passive-hope-cascade) sets state hints; we read them.
    const flags = state.deep_signal_flags || {};
    let category = CRISIS_CATEGORY.PASSIVE_DW_STRONG;
    let step1Variant = STEP1_VARIANT.C_1;
    if (flags.trauma_marker_detected)           { category = CRISIS_CATEGORY.TRAUMA;          step1Variant = STEP1_VARIANT.A; }
    else if (flags.worth_fiction_detected)      { category = CRISIS_CATEGORY.WORTH_FICTION;   step1Variant = STEP1_VARIANT.B; }
    else if (flags.passive_dw_implicit_pending) { category = CRISIS_CATEGORY.PASSIVE_DW_IMPLICIT; step1Variant = STEP1_VARIANT.C_2; }
    else if (Number(ctx.user_profile?.passive_death_wish_count ?? 0) >= 3) {
      category = CRISIS_CATEGORY.CUMULATIVE; step1Variant = STEP1_VARIANT.C_3;
    }
    sopState = buildInitialSopState({ category, step1Variant });
    // Step 1 acknowledge phrasing 已由 deep-signal-detector 在觸發 turn inject.
    // 本 handler 從 Step 1 完成後的下一 turn 接管 (awaiting acknowledge_ack).
  }

  // Dispatch by current step.
  return dispatch(sopState, userResponse, ctx);
}

// ─────────────────────────────────────────────────────────
// Step dispatchers
// ─────────────────────────────────────────────────────────

function dispatch(sopState, userResponse, ctx) {
  switch (String(sopState.current_step)) {
    case String(SOP_STEPS.STEP_1_ACKNOWLEDGE):       return fromStep1(sopState, userResponse, ctx);
    case String(SOP_STEPS.STEP_2_SI_RISK):           return fromStep2(sopState, userResponse, ctx);
    case String(SOP_STEPS.STEP_2_3_PLAN_CHECK):      return fromStep2_3(sopState, userResponse, ctx);
    case String(SOP_STEPS.STEP_3_PROTECTIVE):        return fromStep3(sopState, userResponse, ctx);
    case String(SOP_STEPS.STEP_4_HANDOFF):           return fromStep4(sopState, userResponse, ctx);
    case String(SOP_STEPS.STEP_5_1925):              return fromStep5(sopState, userResponse, ctx);
    case String(SOP_STEPS.STEP_6_LANDING_REMINDER):  return fromStep6(sopState, userResponse, ctx);
    case String(SOP_STEPS.STEP_7_SAFETY_PLANNING):   return fromStep7(sopState, userResponse, ctx);
    case String(SOP_STEPS.STEP_8_CLOSURE):           return fromStep8(sopState, userResponse, ctx);
    default:
      return { handled: false };
  }
}

/** Step 1 acknowledged → inject Step 2 SI question. */
function fromStep1(sopState, _userResponse, _ctx) {
  // 學員回應 Step 1 後、進 Step 2.1 direct SI question.
  // Step 1 C-1 已內含 SI question — 若 step1_variant_used = C-1, skip 2.1 inject、awaiting si_answer directly.
  const skipInject = sopState.step1_variant_used === STEP1_VARIANT.C_1;
  const inject = skipInject
    ? '[SYSTEM INJECT — Crisis SOP Step 2 (Step 1 C-1 已問 SI、本 turn awaiting answer)]\n\n本 turn 等學員回應 Step 1 C-1「你現在有沒有想要傷害自己的念頭?」'
    : directSiQuestion.prompt_content;
  return {
    handled: true,
    inject,
    patch: {
      crisis_sop_state: advanceSopState(sopState, {
        nextStep: SOP_STEPS.STEP_2_SI_RISK,
        nextAwaiting: CRISIS_AWAITING.SI_ANSWER,
      }),
    },
  };
}

/** Step 2 SI answer → branch deny/confirm/ambiguous. */
function fromStep2(sopState, userResponse, _ctx) {
  const siAnswer = parseSiAnswer(userResponse);
  if (siAnswer === null) {
    // Can't parse — re-ask gently (defensive; handler shouldn't loop forever).
    return {
      handled: true,
      inject: directSiQuestion.prompt_content
        + '\n\n[SYSTEM NOTE] 學員回應未明確 — 請主對話 LLM 溫和重述 Step 2.1 SI question、不催促.',
      patch: {},   // keep awaiting si_answer
    };
  }
  if (siAnswer === SI_ANSWER.DENY) {
    return {
      handled: true,
      inject: protectiveFactorInquiry.prompt_content,
      patch: {
        crisis_sop_state: advanceSopState(sopState, {
          nextStep: SOP_STEPS.STEP_3_PROTECTIVE,
          nextAwaiting: CRISIS_AWAITING.PROTECTIVE_FACTOR,
          patch: { si_answer: siAnswer },
        }),
      },
    };
  }
  // confirm / ambiguous → Step 2.3 immediate safety check.
  return {
    handled: true,
    inject: immediateSafetyCheck.prompt_content,
    patch: {
      crisis_sop_state: advanceSopState(sopState, {
        nextStep: SOP_STEPS.STEP_2_3_PLAN_CHECK,
        nextAwaiting: CRISIS_AWAITING.PLAN_QUESTION,
        patch: { si_answer: siAnswer },
      }),
    },
  };
}

/** Step 2.3 plan answer → has_plan → Step 4 only_b; no_plan → Step 3. */
function fromStep2_3(sopState, userResponse, _ctx) {
  const planAnswer = parsePlanAnswer(userResponse);
  if (planAnswer === null) {
    return {
      handled: true,
      inject: immediateSafetyCheck.prompt_content
        + '\n\n[SYSTEM NOTE] 學員回應未明確 — 重述 Step 2.3 plan question、不追問細節.',
      patch: {},
    };
  }
  if (planAnswer === PLAN_ANSWER.HAS_PLAN) {
    // Skip Step 3, jump to Step 4 only_b forced + HITL critical alert.
    return {
      handled: true,
      inject: getHandoffInject(HANDOFF_VARIANT.ONLY_B)
        + '\n\n[SYSTEM ALERT] HITL critical alert — SI confirm + has plan、實時通知 Vivi.',
      patch: {
        crisis_sop_state: advanceSopState(sopState, {
          nextStep: SOP_STEPS.STEP_4_HANDOFF,
          nextAwaiting: CRISIS_AWAITING.HANDOFF_CHOICE,
          patch: {
            plan_answer: planAnswer,
            handoff_variant_used: HANDOFF_VARIANT.ONLY_B,
            handoff_choice: HANDOFF_CHOICE.B,   // forced
          },
        }),
        hitl_critical_alert: true,
      },
    };
  }
  // no_plan → Step 3 protective factor.
  return {
    handled: true,
    inject: protectiveFactorInquiry.prompt_content,
    patch: {
      crisis_sop_state: advanceSopState(sopState, {
        nextStep: SOP_STEPS.STEP_3_PROTECTIVE,
        nextAwaiting: CRISIS_AWAITING.PROTECTIVE_FACTOR,
        patch: { plan_answer: planAnswer },
      }),
    },
  };
}

/** Step 3 protective factor → has → Step 4 standard; none → Step 4 only_b. */
function fromStep3(sopState, userResponse, ctx) {
  const { hasProtective, entity } = parseProtectiveFactor(userResponse);
  if (hasProtective === null) {
    // 無 marker — 等學員 articulate. Don't loop.
    return {
      handled: true,
      inject: protectiveFactorInquiry.prompt_content
        + '\n\n[SYSTEM NOTE] 學員回應 ambiguous — 等待 articulate、不催促.',
      patch: {},
    };
  }
  // Determine Step 4 variant — also gate by cumulative passive_death_wish_count.
  const cumulativeDw = Number(ctx?.user_profile?.passive_death_wish_count ?? 0);
  let variant;
  if (cumulativeDw >= 5) variant = HANDOFF_VARIANT.FREEZE;
  else if (!hasProtective) variant = HANDOFF_VARIANT.ONLY_B;
  else if (cumulativeDw >= 3) variant = HANDOFF_VARIANT.REMOVE_C;
  else variant = HANDOFF_VARIANT.STANDARD;

  const extraNote = !hasProtective
    ? '\n\n[SYSTEM ALERT] HITL critical alert — protective factor absent、實時通知 Vivi.'
    : '';

  return {
    handled: true,
    inject: getHandoffInject(variant) + extraNote,
    patch: {
      crisis_sop_state: advanceSopState(sopState, {
        nextStep: SOP_STEPS.STEP_4_HANDOFF,
        nextAwaiting: CRISIS_AWAITING.HANDOFF_CHOICE,
        patch: {
          protective_factor_surfaced: entity,
          handoff_variant_used: variant,
          ...(variant === HANDOFF_VARIANT.ONLY_B ? { handoff_choice: HANDOFF_CHOICE.B } : {}),
        },
      }),
      ...(!hasProtective ? { hitl_critical_alert: true } : {}),
    },
  };
}

/** Step 4 handoff choice → Step 5 1925 (passive_dw / SI confirm) OR direct to Step 6/7/8. */
function fromStep4(sopState, userResponse, ctx) {
  // Variant only_b / freeze 已強制 handoff_choice=b 在前 step; this turn just acknowledge ack.
  let choice = sopState.handoff_choice;
  if (!choice) {
    choice = parseHandoffChoice(userResponse);
    if (!choice) {
      return {
        handled: true,
        inject: getHandoffInject(sopState.handoff_variant_used || HANDOFF_VARIANT.STANDARD)
          + '\n\n[SYSTEM NOTE] 學員回應未明確選擇 — 重述三選一、不催促.',
        patch: {},
      };
    }
  }

  // Determine if Step 5 1925 is needed (passive_dw cohort OR SI confirm).
  const isPassiveDw = ['passive_dw_strong','passive_dw_implicit','cumulative','freeze']
    .includes(sopState.crisis_trigger_category);
  const siConfirmed = sopState.si_answer === SI_ANSWER.CONFIRM
    || sopState.si_answer === SI_ANSWER.AMBIGUOUS;
  const needs1925 = isPassiveDw || siConfirmed;

  // If only_b / freeze, 1925 was already in handoff inject — skip to Step 6.
  const variant = sopState.handoff_variant_used;
  const onlyB = variant === HANDOFF_VARIANT.ONLY_B || variant === HANDOFF_VARIANT.FREEZE;

  if (onlyB) {
    return {
      handled: true,
      inject: getReminderInject(selectReminderVariant({
        passive_death_wish_count: Number(ctx?.user_profile?.passive_death_wish_count ?? 1),
        professional_referral_refused: false,
      })),
      patch: {
        crisis_sop_state: advanceSopState(sopState, {
          nextStep: SOP_STEPS.STEP_6_LANDING_REMINDER,
          nextAwaiting: CRISIS_AWAITING.REMINDER_RESPONSE,
          patch: {
            handoff_choice: choice,
            reminder_variant_used: selectReminderVariant({
              passive_death_wish_count: Number(ctx?.user_profile?.passive_death_wish_count ?? 1),
              professional_referral_refused: false,
            }),
            reminder_offer_count: 1,
          },
        }),
      },
    };
  }

  if (needs1925) {
    return {
      handled: true,
      inject: getResource1925Inject('standard'),
      patch: {
        crisis_sop_state: advanceSopState(sopState, {
          nextStep: SOP_STEPS.STEP_5_1925,
          nextAwaiting: CRISIS_AWAITING.REMINDER_RESPONSE,   // next turn = 1925 ack OR decline
          patch: { handoff_choice: choice },
        }),
      },
    };
  }

  // SI denied + protective factor: skip Step 5/6/7, jump to Step 8 closure (light path).
  return {
    handled: true,
    inject: crisisSessionClosure.prompt_content,
    patch: {
      crisis_sop_state: advanceSopState(sopState, {
        nextStep: SOP_STEPS.STEP_8_CLOSURE,
        nextAwaiting: CRISIS_AWAITING.CLOSURE_ACK,
        patch: { handoff_choice: choice },
      }),
    },
  };
}

/** Step 5 — student reacted to 1925 offer (or implicitly continued). Move to Step 6 Landing Reminder. */
function fromStep5(sopState, userResponse, ctx) {
  const { acknowledged: _ack, refused } = parseReminderResponse(userResponse);
  const variant = selectReminderVariant({
    passive_death_wish_count: Number(ctx?.user_profile?.passive_death_wish_count ?? 1),
    professional_referral_refused: refused,
  });
  const declineInject = refused
    ? '\n\n---\n\n' + getResource1925Inject('declined')
    : '';
  return {
    handled: true,
    inject: getReminderInject(variant) + declineInject,
    patch: {
      crisis_sop_state: advanceSopState(sopState, {
        nextStep: SOP_STEPS.STEP_6_LANDING_REMINDER,
        nextAwaiting: CRISIS_AWAITING.REMINDER_RESPONSE,
        patch: {
          reminder_variant_used: variant,
          reminder_offer_count: (sopState.reminder_offer_count || 0) + 1,
        },
      }),
    },
  };
}

/** Step 6 Reminder — log ack/refuse + decide Step 7 vs Step 8 path. */
function fromStep6(sopState, userResponse, _ctx) {
  const { acknowledged, refused } = parseReminderResponse(userResponse);
  // M72 不糾纏 — if already offered >= REMINDER_OFFER_MAX times, don't loop reminder.
  // Move to Step 7 if SI risk surface; else Step 8.
  const siRiskSurface = sopState.si_answer === SI_ANSWER.CONFIRM
    || sopState.si_answer === SI_ANSWER.AMBIGUOUS;

  if (siRiskSurface) {
    return {
      handled: true,
      inject: safetyPlanning.prompt_content,
      patch: {
        crisis_sop_state: advanceSopState(sopState, {
          nextStep: SOP_STEPS.STEP_7_SAFETY_PLANNING,
          nextAwaiting: CRISIS_AWAITING.SAFETY_ACTIVITIES,
          patch: {
            referral_acknowledged_this_turn: acknowledged,
            referral_refused_this_turn: refused,
          },
        }),
      },
    };
  }
  // No SI risk → skip Step 7, go to Step 8.
  return {
    handled: true,
    inject: crisisSessionClosure.prompt_content,
    patch: {
      crisis_sop_state: advanceSopState(sopState, {
        nextStep: SOP_STEPS.STEP_8_CLOSURE,
        nextAwaiting: CRISIS_AWAITING.CLOSURE_ACK,
        patch: {
          referral_acknowledged_this_turn: acknowledged,
          referral_refused_this_turn: refused,
        },
      }),
    },
  };
}

/** Step 7 Safety Planning — collect activities → safe_location → contracting → Step 8. */
function fromStep7(sopState, userResponse, _ctx) {
  const awaiting = sopState.awaiting;
  const plan = sopState.safety_plan || { activities: [], safe_location: null, self_harm_denied: null };

  if (awaiting === CRISIS_AWAITING.SAFETY_ACTIVITIES) {
    const activity = userResponse.trim().slice(0, 100);    // truncate defensively
    const activities = activity ? [...plan.activities, activity] : plan.activities;
    return {
      handled: true,
      inject: safetyPlanning.prompt_content
        + '\n\n[SYSTEM NOTE] 進 Step 7.2 safe location — Sonnet ack 學員 activities + 問 safe location.',
      patch: {
        crisis_sop_state: advanceSopState(sopState, {
          nextStep: SOP_STEPS.STEP_7_SAFETY_PLANNING,
          nextAwaiting: CRISIS_AWAITING.SAFE_LOCATION,
          patch: {
            safety_plan: { ...plan, activities },
          },
        }),
      },
    };
  }
  if (awaiting === CRISIS_AWAITING.SAFE_LOCATION) {
    const safeLoc = parseSafeLocation(userResponse);
    return {
      handled: true,
      inject: safetyPlanning.prompt_content
        + '\n\n[SYSTEM NOTE] 進 Step 7.3 contracting — Sonnet ack safe location + 問 contracting.',
      patch: {
        crisis_sop_state: advanceSopState(sopState, {
          nextStep: SOP_STEPS.STEP_7_SAFETY_PLANNING,
          nextAwaiting: CRISIS_AWAITING.CONTRACTING,
          patch: { safety_plan: { ...plan, safe_location: safeLoc } },
        }),
      },
    };
  }
  if (awaiting === CRISIS_AWAITING.CONTRACTING) {
    const denied = parseContracting(userResponse);
    return {
      handled: true,
      inject: crisisSessionClosure.prompt_content,
      patch: {
        crisis_sop_state: advanceSopState(sopState, {
          nextStep: SOP_STEPS.STEP_8_CLOSURE,
          nextAwaiting: CRISIS_AWAITING.CLOSURE_ACK,
          patch: { safety_plan: { ...plan, self_harm_denied: denied === true ? true : denied } },
        }),
      },
    };
  }
  // Fallback — stay in Step 7.
  return {
    handled: true,
    inject: safetyPlanning.prompt_content,
    patch: {},
  };
}

/** Step 8 Closure — emit carry_forward write signal (full write in PR-6b). */
function fromStep8(sopState, _userResponse, _ctx) {
  return {
    handled: true,
    inject: crisisSessionClosure.prompt_content
      + '\n\n[SYSTEM NOTE] Step 8 complete — carry_forward 完整寫入 PR-6b. 本 turn 結束 SOP.',
    patch: {
      crisis_sop_state: advanceSopState(sopState, {
        nextStep: SOP_STEPS.STEP_8_CLOSURE,
        nextAwaiting: null,
        patch: { closure_explicit: true },
      }),
      crisis_sop_complete: true,    // PR-6b carry_forward writer reads this flag.
    },
  };
}

// Detector definition.
export const CRISIS_SOP_DETECTOR = Object.freeze({
  id: 'CRISIS_sop_state_machine',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  priority: CASCADE_PRIORITY.CRISIS_sop,   // = 2, fires before E1 (10), deep_signal (20).
  handler: crisisSopHandler,
});

export const REMINDER_OFFER_MAX_EXPORT = REMINDER_OFFER_MAX;
