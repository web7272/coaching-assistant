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
  STEP_1_INJECT, buildStep2Inject, buildStep3Inject,
  parseCategoryPick, parseArticulate, parseConfirm,
  sanitizeName, sanitizeDefinition,
} from '../sub-prompts/onboarding/index.js';
import deepSignalDetector, {
  PASSIVE_STRONG_REGEX, PASSIVE_IMPLICIT_REGEX,
  // ⭐ 6/6 v2 hotfix — preemptive defer must also catch active SI explicit so
  //   onboarding handler logs the correct signal_kind. Functionally TRAUMA
  //   catches 「自殺」 too, so even pre-fix the turn would defer; new check
  //   gives accurate classification for observability.
  ACTIVE_SI_EXPLICIT_REGEX,
} from '../prompt-sections/conditional/engine-3/deep-signal-detector.js';

// ⭐ 6/5 SAFETY HOTFIX — Patch 23 / A006 Day 1 lesson, hardened for onboarding.
//   Mirror engine-3.js: extract TRAUMA + STRONG_EMOTION regexes from the canonical
//   trigger_signals export so onboarding's preemptive check stays in lock-step with
//   deep-signal-detector additions (no new public regex export to keep in sync).
const TRAUMA_REGEX =
  deepSignalDetector.trigger_signals.strong.find(
    s => s.kind === 'regex' && /虐待/.test(String(s.pattern)),
  )?.pattern;
const STRONG_EMOTION_REGEX =
  deepSignalDetector.trigger_signals.strong.find(
    s => s.kind === 'regex' && /崩潰/.test(String(s.pattern)),
  )?.pattern;

/**
 * Preemptive crisis-signal detector for the CURRENT user_response.
 *
 * Why this exists:
 *   chat.js gates the entire user_turn dispatch (incl. crisis deep-signal-
 *   detector @ priority 20) behind `!onboardingTookTurn`. If onboarding
 *   swallows the turn while the FIRST user_response surfaces death wish /
 *   trauma / 強烈情緒, the cascade is skipped and the signal is lost — exactly
 *   the A006 Day 1 failure mode, only now at Turn 0.
 *
 * Categories mirrored verbatim from deep-signal-detector.trigger_signals.strong:
 *   - PASSIVE_STRONG: 明說想死 / 希望死
 *   - PASSIVE_IMPLICIT: 隱性訊號 (上天讓我活著 / 此生無憾 ...)
 *   - TRAUMA: 創傷 marker (虐待 / 上吊 / 性侵 / 親人過世 ...)
 *   - STRONG_EMOTION: 強烈情緒突發 (哭 / 崩潰 / 喘不過氣 / 手抖 ...)
 *
 * Single-hit → defer (no co-occurrence requirement). Onboarding is the earliest
 * phase; over-deferring costs one cascade-routed turn, under-deferring loses
 * the signal entirely.
 *
 * @param {string} text user_response (raw)
 * @returns {string|null} signal kind, or null if no hit
 */
function detectPreemptiveCrisisSignal(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  // ⭐ 6/6 v2 hotfix — active SI explicit takes highest precedence so log
  //   reflects what engine-3 will route to (Step 4 high_risk fast-path).
  if (ACTIVE_SI_EXPLICIT_REGEX.test(text)) return 'active_si_explicit';
  if (PASSIVE_STRONG_REGEX.test(text))     return 'passive_strong';
  if (PASSIVE_IMPLICIT_REGEX.test(text))   return 'passive_implicit';
  if (TRAUMA_REGEX && TRAUMA_REGEX.test(text))                 return 'trauma';
  if (STRONG_EMOTION_REGEX && STRONG_EMOTION_REGEX.test(text)) return 'strong_emotion';
  return null;
}

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

  // Crisis override (safety first per task spec) — TWO paths:
  //   (a) state already shows crisis active (already-triggered case).
  //   (b) CURRENT user_response surfaces a deep-signal that crisis-SOP must
  //       handle FIRST. Without (b), chat.js skips user_turn dispatch on
  //       onboardingTookTurn=true → deep-signal-detector (priority 20) never
  //       fires → passive death wish at onboarding Turn 0 is silently lost.
  //       This is the Patch 23 / A006 Day 1 failure mode, now at the earliest
  //       possible surface.
  const inCrisis = state.crisis_in_progress === true
    || state.primary_mode === 'crisis'
    || (Array.isArray(state.active_modes) && state.active_modes.includes('crisis'));
  if (inCrisis) {
    logOnboardingEvent({ event: 'onboarding_deferred_to_crisis' });
    return { handled: false };
  }
  const preemptiveSignal = detectPreemptiveCrisisSignal(userResponse);
  if (preemptiveSignal !== null) {
    // onboarding_step intentionally NOT cleared — same in_progress preservation
    // semantics as path (a); crisis exits → next turn resumes same onboarding step.
    logOnboardingEvent({
      event: 'onboarding_deferred_to_crisis_preemptive',
      signal_kind: preemptiveSignal,
    });
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
  // ⭐ 6/6 hotfix: bake picked category into the step-2 inject so AI grounds
  //    on it (not on stale students.active_context_category default 1).
  return {
    handled: true,
    inject: buildStep2Inject(category),
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
    // ⭐ 6/6 hotfix: pass picked_category so anchor stays correct.
    // ⭐ 6/6 phrasing: 處理 → 探索.
    return {
      handled: true,
      inject: buildStep2Inject(prevState.picked_category)
        + '\n\n[SYSTEM NOTE] 學員回應 vague — 輕引「就你今天最想探索的那塊」, 再給空間.',
      patch: {},
    };
  }
  // Move to step 3 confirm with articulate text recorded.
  // ⭐ 6/6 hotfix: pass picked_category to buildStep3Inject.
  return {
    handled: true,
    inject: buildStep3Inject(articulate, prevState.picked_category),
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
    // ⭐ 6/6 hotfix: pass picked_category so anchor stays correct on re-articulate.
    return {
      handled: true,
      inject: buildStep2Inject(prevState.picked_category)
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
    // ⭐ 6/6 hotfix: pass picked_category to keep anchor stable on re-confirm.
    return {
      handled: true,
      inject: buildStep3Inject(prevState.articulate_text, prevState.picked_category)
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
