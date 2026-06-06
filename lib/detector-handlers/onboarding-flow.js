// lib/detector-handlers/onboarding-flow.js
// v5.2 第四塊 PR-a — Onboarding 3-step state machine handler.
//
// Source: v52_context_anchored_spec §1 (Onboarding 3 步驟 終審) + §7.2 (新學員強制).
//
// Architectural placement (per task spec):
//   - chat.js Step 7 cascade: AFTER crisis detector, BEFORE Mode routing.
//   - Crisis override: if crisis_in_progress → onboarding handler defers.
//   - Gate: state.onboarding_step != null OR student !context_onboarded
//     (PR-b chat.js initializes state on first turn when student !onboarded).
//
// State shape: session_state.onboarding_step (see _constants.js).
// Completion = current_step=null + students.context_onboarded=TRUE atomic write
// (PR-b chat.js performs write after handler signals onboarding_complete).

import {
  ONBOARDING_STEPS, ONBOARDING_AWAITING,
  buildInitialOnboardingState, advanceOnboardingState,
  STEP_1_INJECT, STEP_2_INJECT, buildStep3Inject,
  parseCategoryPick, parseArticulate, parseConfirm,
  sanitizeName, sanitizeDefinition,
} from '../sub-prompts/onboarding/index.js';

/**
 * Onboarding flow handler.
 *
 * Gate semantics:
 *   - Crisis active (state.crisis_in_progress OR primary_mode=crisis) → defer
 *     (return handled=false, let crisis SOP take the turn).
 *   - state.onboarding_step exists (running) → dispatch by current step.
 *   - !state.onboarding_step AND !ctx.student_context_onboarded → initialize +
 *     inject step 1.
 *   - !state.onboarding_step AND ctx.student_context_onboarded → defer (normal flow).
 *
 * @param {object} ctx
 * @param {object} ctx.session_state
 * @param {string} ctx.user_response
 * @param {boolean} [ctx.student_context_onboarded] — from students.context_onboarded
 *                                                    (PR-b chat.js threads this in)
 * @returns {Promise<{handled:boolean, inject?:string, patch?:object, onboarding_complete_write?:object}>}
 */
export async function onboardingFlowHandler(ctx) {
  const state = ctx.session_state || {};
  const userResponse = typeof ctx.user_response === 'string' ? ctx.user_response : '';

  // Crisis override (safety first per task spec): onboarding intercept defers
  // when crisis active. crisis-sop handler (priority 2) takes the turn.
  const inCrisis = state.crisis_in_progress === true
    || state.primary_mode === 'crisis'
    || (Array.isArray(state.active_modes) && state.active_modes.includes('crisis'));
  if (inCrisis) {
    logOnboardingEvent({ event: 'onboarding_deferred_to_crisis' });
    return { handled: false };
  }

  const onbState = state.onboarding_step;

  // Gate 1: not running + already onboarded → defer to normal flow.
  if (!onbState && ctx.student_context_onboarded === true) {
    return { handled: false };
  }

  // Gate 2: not running + NOT onboarded → initialize + inject Step 1.
  if (!onbState && ctx.student_context_onboarded !== true) {
    const initial = buildInitialOnboardingState();
    logOnboardingEvent({ event: 'onboarding_initialized' });
    return {
      handled: true,
      inject: STEP_1_INJECT,
      patch: { onboarding_step: initial },
    };
  }

  // Gate 3: running → dispatch by step.
  switch (onbState.current_step) {
    case ONBOARDING_STEPS.STEP_1_CATEGORY_PICK: return fromStep1(onbState, userResponse);
    case ONBOARDING_STEPS.STEP_2_ARTICULATE:    return fromStep2(onbState, userResponse);
    case ONBOARDING_STEPS.STEP_3_CONFIRM:       return fromStep3(onbState, userResponse);
    default:
      // Defensive: unknown step → clear state, defer.
      return { handled: false, patch: { onboarding_step: null } };
  }
}

// ─── Step dispatchers ─────────────────────────────────────

function fromStep1(prevState, userResponse) {
  const category = parseCategoryPick(userResponse);
  logOnboardingEvent({ event: 'step_1_parsed', category });
  if (category === null) {
    // Re-prompt step 1 (escape hatch / unique frame not mapped / vague).
    return {
      handled: true,
      inject: STEP_1_INJECT
        + '\n\n[SYSTEM NOTE] 學員回應未對應 1-5 — 輕推回選擇:'
        + '「跟哪一個比較接近?」 (不允許 escape hatch、必須落 1-5).',
      patch: {},   // state unchanged, re-prompt
    };
  }
  // Move to step 2 with picked category recorded.
  return {
    handled: true,
    inject: STEP_2_INJECT,
    patch: {
      onboarding_step: advanceOnboardingState(prevState, {
        nextStep: ONBOARDING_STEPS.STEP_2_ARTICULATE,
        nextAwaiting: ONBOARDING_AWAITING.ARTICULATE,
        patch: { picked_category: category },
      }),
    },
  };
}

function fromStep2(prevState, userResponse) {
  const articulate = parseArticulate(userResponse);
  logOnboardingEvent({
    event: 'step_2_parsed',
    has_articulate: articulate !== null,
  });
  if (articulate === null) {
    // Vague — re-prompt step 2 with gentle reinforcement.
    return {
      handled: true,
      inject: STEP_2_INJECT
        + '\n\n[SYSTEM NOTE] 學員回應 vague — 輕引「就你今天最想處理的那塊」, 再給空間.',
      patch: {},
    };
  }
  // Move to step 3 confirm with articulate text recorded.
  return {
    handled: true,
    inject: buildStep3Inject(articulate),
    patch: {
      onboarding_step: advanceOnboardingState(prevState, {
        nextStep: ONBOARDING_STEPS.STEP_3_CONFIRM,
        nextAwaiting: ONBOARDING_AWAITING.CONFIRM,
        patch: { articulate_text: articulate },
      }),
    },
  };
}

function fromStep3(prevState, userResponse) {
  const verdict = parseConfirm(userResponse);
  logOnboardingEvent({ event: 'step_3_parsed', verdict });
  if (verdict === 'reject') {
    // Reject → re-prompt step 2 (re-articulate).
    return {
      handled: true,
      inject: STEP_2_INJECT
        + '\n\n[SYSTEM NOTE] 學員想修正 — 回 step 2 重新 articulate.',
      patch: {
        onboarding_step: advanceOnboardingState(prevState, {
          nextStep: ONBOARDING_STEPS.STEP_2_ARTICULATE,
          nextAwaiting: ONBOARDING_AWAITING.ARTICULATE,
          patch: { articulate_text: null },
        }),
      },
    };
  }
  if (verdict !== 'confirm') {
    // Vague / unclear — re-prompt confirm with same articulate.
    return {
      handled: true,
      inject: buildStep3Inject(prevState.articulate_text)
        + '\n\n[SYSTEM NOTE] 學員回應未明確 — 輕推「目前這個版本對嗎? 改不改都可以」.',
      patch: {},
    };
  }

  // CONFIRM — onboarding complete.
  //   Hand off to chat.js (PR-b) for atomic write:
  //   students.active_context_category / _name / _definition + context_onboarded=TRUE.
  const sName = sanitizeName(prevState.articulate_text);
  const sDef  = sanitizeDefinition(prevState.articulate_text);
  logOnboardingEvent({
    event: 'onboarding_complete',
    category: prevState.picked_category,
    name_truncated: sName.truncated,
    def_truncated: sDef.truncated,
  });
  return {
    handled: true,
    // Provide an explicit closure inject — Sonnet acknowledges and pivots to Mode 1.
    inject: `[SYSTEM INJECT — v5.2 Onboarding Complete]

學員 confirm: 21 天聚焦在『${prevState.articulate_text}』.

寫入 (PR-b chat.js 接管 atomic UPDATE students):
- active_context_category = ${prevState.picked_category}
- active_context_name = '${sName.name}' (≤30 字${sName.truncated ? '、已截斷' : ''})
- active_context_definition = '${sDef.definition}' (≤200 字${sDef.truncated ? '、已截斷' : ''})
- context_onboarded = TRUE

下個 turn 進 Mode 1 elicitation, phrasing anchor 自動接管:
  「在『${sName.name}』這塊、你想要什麼?」 (v5.2 第二塊 PR-b 已 ship)

AI 本 turn 自然 acknowledge 學員 confirm, 不解釋為什麼 21 天聚焦一塊.`,
    patch: {
      onboarding_step: null,   // clear state, exit onboarding intercept
    },
    onboarding_complete_write: {
      active_context_category: prevState.picked_category,
      active_context_name: sName.name,
      active_context_definition: sDef.definition,
      context_onboarded: true,
    },
  };
}

// ─── Structured logging (鐵律 #2 — no raw user text) ────

function logOnboardingEvent(payload) {
  // eslint-disable-next-line no-console
  console.info('[v5_2_onboarding]', JSON.stringify(payload));
}
