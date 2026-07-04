// lib/detector-handlers/engine-1.js
// 引擎 1 對話偏離 pipeline handler
// master_detector (regex) → subtype-classifier judge (Haiku) → 選 E1a/b/c/d
//
// 對齊：detector registry handler 介面 async (ctx) → { handled, inject?, patch? }
// 規則內容在 prompt-sections/conditional/engine-1/、本檔只 orchestrate。

import { ENGINE_1_PIPELINE, masterDetector } from '../prompt-sections/conditional/engine-1/index.js';
import { judge as classifierJudge, TIMEOUT_FALLBACK } from '../haiku-judge/subtype-classifier.js';
import { JudgeTimeoutError, JudgeSchemaError } from '../haiku-judge/_base.js';
import { PPL_SCORE, PPL_EVENT_DELTAS } from '../state/cumulative-score.js';
// v5.1 Step 5a — 5 signal detectors (S1-S5) + routing.
import {
  detectAllSignals,
  S2_LIGHT_INJECT, S3_LIGHT_INJECT, S4_WEAK_INJECT, S5_INTEGRATION_INJECT,
} from './engine-1-signals/index.js';
import { readModeState, ACTIVE_MODES } from '../session/mode-tracker.js';
// Step 7 PR-7a — R1 Reframe Library 接管 S1 medium+ / S4 medium dispatch.
import { R1 } from '../damon-reframe-library/r1-reclaim-source.js';
import { countPerSession, buildInvocationPatch }
  from '../damon-reframe-library/invocation-tracker.js';

// ─────────────────────────────────────────────────────────
// master regex matching
// ─────────────────────────────────────────────────────────

/**
 * Run E1 master detector regex + cumulative-state signals.
 * @returns {{ triggered: string[], explicit_protest: boolean }}
 */
export function matchE1(userResponse, sessionState = {}) {
  const triggered = [];
  let explicit_protest = false;
  const text = typeof userResponse === 'string' ? userResponse : '';
  const rp = masterDetector.regex_patterns;

  if (rp.vague_words.some(re => re.test(text))) triggered.push('vague_words');
  if (rp.short_compliance.some(re => re.test(text))) triggered.push('short_compliance');
  if (rp.spiritual_big_words.some(re => re.test(text))) triggered.push('spiritual_big_words');
  if (rp.explicit_protest.some(re => re.test(text))) {
    triggered.push('explicit_protest');
    explicit_protest = true;
  }

  // cumulative-state signals (engine 1 §4.2)
  if ((sessionState.consecutive_short_responses || 0) >= 2) triggered.push('cumulative_short');
  if ((sessionState.consecutive_offtopic_turns || 0) >= 1) triggered.push('cumulative_offtopic');
  if ((sessionState.consecutive_vague_turns || 0) >= 3) triggered.push('cumulative_vague');   // fable 6/26: 2->3 放寬 (中文語助詞誤判、多給一輪 grace)
  if ((sessionState.cumulative_ppl_score || 0) >= 0.6) triggered.push('cumulative_ppl');

  return { triggered, explicit_protest };
}

// ─────────────────────────────────────────────────────────
// E1 pipeline handler (registered as user_turn, priority 10)
// ─────────────────────────────────────────────────────────

/**
 * @param {object} ctx - dispatch context
 * @param {object} ctx.session_state
 * @param {string} ctx.user_response
 * @param {object} ctx.judges - { subtypeClassifier }
 * @param {function} [ctx.logMiss] - optional miss logger
 * @returns {Promise<{handled: boolean, inject?: string, patch?: object}>}
 */
/**
 * v5.1 Step 5a — Decide which signal-driven inject to use this turn per
 * v51_engine_1_errata.md §A3 routing rules.
 *
 * Priority (per spec same-turn multi-signal rule): S2 > S4 > S1 > S5 > S3.
 * Returns ONE inject string + optional cascade signal (S2 death-adjacent),
 * or null if no signal-driven inject applies.
 *
 * @param {object} signals  - output of detectAllSignals
 * @param {object} state    - session_state
 * @returns {{inject:string|null, cascade:'passive_hope'|null}}
 */
export function selectSignalInject(signals, state = {}) {
  const hints = signals?.inject_hints || {};
  const modeRead = readModeState(state);
  const primary = modeRead.primary_mode;
  const isIntegration = primary === ACTIVE_MODES.INTEGRATION;

  // Priority 1 — S2 death-adjacent → CASCADE (not inject, handled by passive-hope-cascade).
  if (hints.passive_hope && hints.passive_hope.death_adjacent) {
    return { inject: null, cascade: 'passive_hope' };
  }
  // Priority 1b — S2 non-death → light inject (ship-able, spec-given phrasing).
  if (hints.passive_hope && !hints.passive_hope.death_adjacent) {
    return { inject: S2_LIGHT_INJECT, cascade: null };
  }
  // Priority 2 — S4 weak (group_a 交易句式) → 紅線 23 phrasing inject.
  //   Step 7 PR-7a: medium → R1 完整版 (landmine context); strong → integration-router.
  if (hints.conditional_worth) {
    const intensity = hints.conditional_worth.intensity;
    if (intensity === 'weak') return { inject: S4_WEAK_INJECT, cascade: null };
    if (intensity === 'medium') {
      // Library R1 接管 — landmine context, deep-dig real underlying quality.
      const r1Body = R1.buildInject({
        variant: 'standard',
        projection_quote: '[交易句式原話]',
        mode: state.primary_mode || 'integration',
        landmine_term: '[conditional worth term]',
        prior_invocations: countPerSession(state, 'R1'),
      });
      return { inject: `[SYSTEM INJECT — S4 medium → R1 Library invocation]\n\n${r1Body}`, cascade: null, reframe_invoked: 'R1' };
    }
    // strong → flag only this turn (integration-router 接管).
  }
  // Priority 3 — S1 external_locus medium+ → R1 完整版 (Step 7 PR-7a).
  if (hints.external_locus && (hints.external_locus.intensity === 'medium' || hints.external_locus.intensity === 'strong')) {
    const r1Body = R1.buildInject({
      variant: 'standard',
      projection_quote: '[S1 偵測到的投射句]',
      mode: state.primary_mode || 'integration',
      prior_invocations: countPerSession(state, 'R1'),
    });
    return { inject: `[SYSTEM INJECT — S1 medium+ → R1 Library invocation]\n\n${r1Body}`, cascade: null, reframe_invoked: 'R1' };
  }
  // Priority 4 — S5 in integration mode → ship-able「又」 inject (R11 body).
  if (hints.negative_generalization && isIntegration) {
    return { inject: S5_INTEGRATION_INJECT, cascade: null };
  }
  // ⭐ Step 7 PR-7b — S6 modal_operator medium → R1 invoke (External Locus 變體).
  //   spec §5.3 話術: 「『應該』這個字、我想停一下。這個『應該』、是誰告訴你的?」
  //   strong → cascade 引擎 3 (mode-transition-router 接管 External Locus 確立).
  if (hints.modal_operator && hints.modal_operator.intensity === 'medium') {
    const r1Body = R1.buildInject({
      variant: 'standard',
      projection_quote: '[S6 偵測到的「應該/必須」句]',
      mode: state.primary_mode || 'integration',
      prior_invocations: countPerSession(state, 'R1'),
    });
    return {
      inject: `[SYSTEM INJECT — S6 modal_operator medium → R1 (External Locus 變體)]

spec §5.3 話術 (ship-able):
> 「『應該』這個字、我想停一下。
>  這個『應該』、是誰告訴你的?是你自己、還是外面?」

---

${r1Body}`,
      cascade: null,
      reframe_invoked: 'R1',
    };
  }
  // Priority 5 — S3 frequency_illusion → R7 Library 接管 (Step 7 PR-7a).
  //   S3_LIGHT_INJECT 已內含 R7_A full library body (見 engine-1-signals/index.js).
  if (hints.frequency_illusion) {
    // S3_LIGHT_INJECT is baked with R7_A body — record R7 invocation.
    return { inject: S3_LIGHT_INJECT, cascade: null, reframe_invoked: 'R7' };
  }
  return { inject: null, cascade: null };
}

export async function e1MasterHandler(ctx) {
  const state = ctx.session_state || {};

  // v5.1 Step 5a — 5 signal detectors run in parallel with existing deviation detection.
  //   Signals accumulate flags + counts + cumulative deltas every turn; routing
  //   decision (inject vs cascade vs flag-only) per selectSignalInject above.
  const signals = detectAllSignals({
    text: ctx.user_response,
    sessionState: state,
    userProfile: ctx.user_profile || {},
    prevTurns: ctx.last_3_turns || [],
  });
  // Safe structured logs (鐵律 #2 — no raw student text).
  for (const log of signals.logs) {
    console.info('[engine1-signal]', JSON.stringify({ ...log, ctx_sid: ctx.student_id || null }));
  }
  const signalRouting = selectSignalInject(signals, state);

  // 6/12 — Record reframe invocation when selectSignalInject decided to invoke
  // R1 / R7 via S3 baked body. Patch merges into the signals patch returned below;
  // chat.js detectorPatch-merge concats across handlers (lib/state/detector-patch-merge.js).
  const reframePatch = signalRouting.reframe_invoked
    ? buildInvocationPatch({ reframe_id: signalRouting.reframe_invoked, state, ctx })
    : null;

  const { triggered, explicit_protest } = matchE1(ctx.user_response, state);

  if (triggered.length === 0) {
    // No deviation. If signal alone says inject, do that. Otherwise propagate
    // signal patch+increments without injecting.
    if (signalRouting.inject) {
      return {
        handled: true,
        inject: signalRouting.inject,
        patch: { ...signals.patch, ...(reframePatch || {}) },
        user_profile_increments: signals.user_profile_increments,
      };
    }
    // No deviation, no signal inject — return state delta only (counts / flags
    // still update; cascade handled by passive-hope-cascade if S2 death-adjacent).
    if (Object.keys(signals.patch).length > 0
        || Object.keys(signals.user_profile_increments).length > 0) {
      return {
        handled: false,
        patch: signals.patch,
        user_profile_increments: signals.user_profile_increments,
      };
    }
    return { handled: false };
  }

  // explicit_protest → cumulative_ppl_score += 0.30 (engine 1 §4.2 priority_override)
  const patch = {
    deviation_suspected_this_turn: true,
    triggered_signals: triggered,
    explicit_protest_hit: explicit_protest,
  };
  if (explicit_protest) {
    patch.cumulative_ppl_score = PPL_SCORE.apply(
      state.cumulative_ppl_score,
      PPL_EVENT_DELTAS.explicit_protest_hit,
    );
  }

  // run subtype-classifier judge
  let classification;
  try {
    classification = await (ctx.judges?.subtypeClassifier
      ? ctx.judges.subtypeClassifier({
          user_response: ctx.user_response,
          last_ai_question: state.last_ai_question,
          triggered_signals: triggered,
          cumulative_ppl_score: patch.cumulative_ppl_score ?? state.cumulative_ppl_score ?? 0,
          anchors_top3: ctx.anchors_top3 || [],
          consecutive_short_responses: state.consecutive_short_responses || 0,
          consecutive_offtopic_turns: state.consecutive_offtopic_turns || 0,
          consecutive_vague_turns: state.consecutive_vague_turns || 0,
          elicitation_mode_active: state.elicitation_mode_active ?? true,
          recent_specific_examples_count: state.recent_specific_examples_count || 0,
        })
      : classifierJudge({
          user_response: ctx.user_response,
          last_ai_question: state.last_ai_question,
          triggered_signals: triggered,
          cumulative_ppl_score: patch.cumulative_ppl_score ?? state.cumulative_ppl_score ?? 0,
          anchors_top3: ctx.anchors_top3 || [],
          consecutive_short_responses: state.consecutive_short_responses || 0,
          consecutive_offtopic_turns: state.consecutive_offtopic_turns || 0,
          consecutive_vague_turns: state.consecutive_vague_turns || 0,
          elicitation_mode_active: state.elicitation_mode_active ?? true,
          recent_specific_examples_count: state.recent_specific_examples_count || 0,
        }));
  } catch (e) {
    if (e instanceof JudgeTimeoutError || e instanceof JudgeSchemaError) {
      classification = TIMEOUT_FALLBACK;
      ctx.logMiss?.({ miss_type: 'classifier_timeout', detector: 'E1_subtype_classifier', error: e.message });
    } else {
      throw e;
    }
  }

  const sub = classification.recommended_sub_prompt;

  // false_positive / none → not handled, continue cascade.
  // Still surface signal-driven inject if applicable (signals are independent
  // of deviation classifier outcome).
  if (sub === 'none') {
    const mergedPatch = { ...patch, ...signals.patch };
    if (signalRouting.inject) {
      return {
        handled: true, inject: signalRouting.inject,
        patch: { ...mergedPatch, ...(reframePatch || {}) },  // 6/12 record reframe
        user_profile_increments: signals.user_profile_increments,
      };
    }
    return {
      handled: false, patch: mergedPatch,
      user_profile_increments: signals.user_profile_increments,
    };
  }

  // select sub-prompt (E1a/b/c/d)
  const subPrompt = ENGINE_1_PIPELINE.sub_prompts[sub];
  if (!subPrompt) {
    // unknown sub-prompt — degrade
    ctx.logMiss?.({ miss_type: 'classifier_unknown_sub', detector: 'E1', error: `unknown sub ${sub}` });
    return { handled: false, patch };
  }

  // counter updates per classification
  if (sub === 'E1a') patch.consecutive_offtopic_turns = (state.consecutive_offtopic_turns || 0) + 1;
  if (sub === 'E1b') patch.consecutive_vague_turns = (state.consecutive_vague_turns || 0) + 1;

  patch.deviation_handled_this_turn = sub;
  patch.deviation_classification = {
    deviation_type: classification.deviation_type,
    confidence: classification.confidence,
    recommended_sub_prompt: sub,
  };

  // v5.1 Step 5a — merge signal patch + increments + (optional) signal inject AFTER the
  // primary deviation inject (separator keeps the prompt parseable for Sonnet).
  // 6/12 — when signalRouting.inject ships (appended after subPrompt body), record
  // the reframe invocation. When signalRouting.inject is dropped (no signal),
  // no reframe was actually shipped → no record.
  const mergedPatch = signalRouting.inject
    ? { ...patch, ...signals.patch, ...(reframePatch || {}) }
    : { ...patch, ...signals.patch };
  const mergedInject = signalRouting.inject
    ? `${subPrompt.prompt_content}\n\n---\n\n${signalRouting.inject}`
    : subPrompt.prompt_content;
  return {
    handled: true,
    inject: mergedInject,
    patch: mergedPatch,
    user_profile_increments: signals.user_profile_increments,
  };
}

// detector definition for registry.register (handler attached)
export const E1_DETECTOR = Object.freeze({
  id: masterDetector.id,
  type: masterDetector.type,
  trigger_event: masterDetector.trigger_event,
  priority: masterDetector.priority,
  handler: e1MasterHandler,
});
