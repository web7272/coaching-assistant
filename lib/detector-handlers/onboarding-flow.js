// lib/detector-handlers/onboarding-flow.js
// v5.2 第四塊 PR-a — Onboarding 2-step state machine handler.
//
// History: was 3-step (category-pick / articulate / confirm). Vivi 6/7
// 乾淨重測 confirmed the step-3「這 21 天聚焦在 X。這樣對嗎?」 yes/no is
// pure friction — every learner just says「對」. Removed: step 2 clear-
// articulate path now completes onboarding directly (acknowledge + first
// Mode 1 question in the same turn, no confirm round-trip).
//
// Source: v52_context_anchored_spec §1 (Onboarding 終審) + §7.2 (新學員強制),
// 2-step simplification per Vivi 6/7.
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
  STEP_1_INJECT, buildStep2Inject,
  parseCategoryPick, parseArticulate,
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

  // Crisis defer — TWO paths (Vivi 6/6 P0 hotfix rewrite):
  //   (a) SOP IS actively in progress (state exists AND not yet complete) —
  //       multi-turn protocol mid-flight; let crisis-sop dispatch the turn.
  //   (b) CURRENT user_response surfaces a deep-signal that crisis-SOP must
  //       handle FIRST. Without (b), chat.js skips user_turn dispatch on
  //       onboardingTookTurn=true → deep-signal-detector (priority 20) never
  //       fires → passive death wish at onboarding Turn 0 is silently lost.
  //       This is the Patch 23 / A006 Day 1 failure mode (preserved verbatim).
  //
  // ⭐ HOTFIX (P0 merge blocker, A015 case): previously this gate read the 3
  //   lock flags (crisis_in_progress / primary_mode='crisis' / active_modes
  //   includes 'crisis'). Those flags were set in 4 production sites and
  //   never cleared — any student who triggered crisis ONCE was permanently
  //   brick'd (onboarding deferred forever → fall back to step 1 phrasing).
  //   Fix: gate on (a) ACTUAL SOP-in-flight state, not stale flags. Combined
  //   with Fix 1 (closure clears the flags) the system has belt-and-suspenders.
  const sopActiveIncomplete = state.crisis_sop_state != null
    && typeof state.crisis_sop_state === 'object'
    && state.crisis_sop_complete !== true;
  if (sopActiveIncomplete) {
    logOnboardingEvent({ event: 'onboarding_deferred_to_crisis_sop_in_flight' });
    return { handled: false };
  }
  // (b) preemptive per-turn re-detection — UNCHANGED safety net (A006 防線).
  //     Do NOT modify the signal list. de939b6 active SI fast-path is verified.
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
    // STEP_3_CONFIRM removed (Vivi 6/7) — fromStep2 now completes directly.
    // If a learner is mid-flight with the OLD step-3 state (left over from a
    // pre-deploy session), the default case below treats it as unknown and
    // clears the state; chat.js will re-init and they finish in 2 steps. The
    // saved articulate_text is lost (re-prompted), but no data corruption.
    default:
      // Defensive: unknown step → clear state, defer.
      return { handled: false, patch: { onboarding_step: null } };
  }
}

// ─── Step dispatchers ─────────────────────────────────────

// ⭐ Vivi 6/19 — Step-1 RE-PROMPT 暖化.
//   舊行為: 學員給自由文字 (parseCategoryPick→null) 時, 直接「再貼一次」 STEP_1_INJECT
//   (verbatim「不改一字」) → AI 冷冷把同一份開場白+選單原封不動重印一次 (A024 路人
//   就卡在這個鬼打牆). 改成: 先「收到」學員剛說的 + 用軟性問法把 5 選項遞回去,
//   不再冷複製開場白. 安全護欄不變 (不允許 escape hatch、必須落 1-5).
const STEP_1_REPROMPT_INJECT = `[SYSTEM INJECT — v5.2 Onboarding Step 1 RE-PROMPT (學員未落 1-5)]

學員上一句不是 1-5 的明確選擇 (自由描述 / escape hatch / 模糊).

本 turn 是 RE-PROMPT (不是第一次起手), 必須:
1. 先「接住」學員剛說的 — 一句簡短、溫的話收到他 (例「收到了。」),
   不複述他整句、不評價、不解釋、不追問細節.
2. 再用軟性問法把選擇遞回去, 例:
   「如果用下面這 5 點來看, 哪一個比較接近你想探索的?」
   然後列出 5 個選項:

1. 事業 / 工作 / 金錢
2. 親密關係(伴侶 / 戀愛)
3. 家庭(原生家庭 / 子女)
4. 健康 / 身體
5. 自我 / 內在狀態 / 心理

⚠️ 不可做:
❌ 不要把第一次的開場白原封不動冷冷再貼一次 (學員已看過).
❌ 不允許 escape hatch (「都可以」「隨便」「都不是」) — 輕推回選擇.
❌ 不問為什麼選 (那是 step 2).
必須輕推回落 1-5 才進下一步.`;

function fromStep1(prevState, userResponse) {
  const category = parseCategoryPick(userResponse);
  logOnboardingEvent({ event: 'step_1_parsed', category });
  if (category === null) {
    // Re-prompt step 1 (escape hatch / unique frame not mapped / vague).
    // Vivi 6/19: 暖化 — 先收到學員、再軟性遞回 5 選項; 不冷複製 STEP_1_INJECT.
    return {
      handled: true,
      inject: STEP_1_REPROMPT_INJECT,
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

  // ⭐ Vivi 6/7 — 2-step simplification.
  //
  // Old flow: clear articulate → advance to STEP_3_CONFIRM → next turn ask
  //           「這 21 天聚焦在 X。這樣對嗎?」 → wait for「對」 → complete.
  // New flow: clear articulate → complete directly. The AI's response THIS
  //           turn is acknowledge + first Mode 1 question in the same reply.
  //
  // Rationale (Vivi 乾淨重測 observation): the confirm round-trip is pure
  // friction. Every learner just says「對」; in the rare case they want to
  // edit, the Mode 1 first question「在『X』這塊、你想要什麼?」 IS the
  // natural place to refine — they can answer with the refined framing.
  //
  // Sanitize the just-parsed `articulate` (was previously sanitized at step 3
  // from prevState.articulate_text). PR-b chat.js still does the atomic
  // students UPDATE — same write contract, just emitted one turn earlier.
  const sName = sanitizeName(articulate);
  const sDef  = sanitizeDefinition(articulate);
  logOnboardingEvent({
    event: 'onboarding_complete',
    category: prevState.picked_category,
    name_truncated: sName.truncated,
    def_truncated: sDef.truncated,
    flow_variant: '2_step',
  });
  return {
    handled: true,
    inject: `[SYSTEM INJECT — v5.2 Onboarding Complete (2-step, no confirm)]

學員選定聚焦『${articulate}』.

寫入 (PR-b chat.js 接管 atomic UPDATE students):
- active_context_category = ${prevState.picked_category}
- active_context_name = '${sName.name}' (≤30 字${sName.truncated ? '、已截斷' : ''})
- active_context_definition = '${sDef.definition}' (≤200 字${sDef.truncated ? '、已截斷' : ''})
- context_onboarded = TRUE

AI 本 turn 同一則回應:
  簡短 acknowledge,例「好,這 21 天我們從『${sName.name}』開始。」
  + 直接接 Mode 1 第一個問題「在『${sName.name}』這塊、你想要什麼?」

不問「這樣對嗎」、不解釋為什麼 21 天聚焦一塊.`,
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

// STEP_3_CONFIRM dispatch removed (Vivi 6/7). The fromStep3 function and its
// buildStep3Inject / parseConfirm dependencies are dead code at this layer.
// The phrasing modules (lib/sub-prompts/onboarding/step-3-confirm.js, etc.)
// remain exported in case downstream code references the constants, but are
// no longer reachable from production onboarding flow.

// ─── Structured logging (鐵律 #2 — no raw user text) ────

function logOnboardingEvent(payload) {
  // eslint-disable-next-line no-console
  console.info('[v5_2_onboarding]', JSON.stringify(payload));
}
