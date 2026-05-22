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
  if ((sessionState.consecutive_vague_turns || 0) >= 2) triggered.push('cumulative_vague');
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
export async function e1MasterHandler(ctx) {
  const state = ctx.session_state || {};
  const { triggered, explicit_protest } = matchE1(ctx.user_response, state);

  if (triggered.length === 0) {
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

  // false_positive / none → not handled, continue cascade
  if (sub === 'none') {
    return { handled: false, patch };
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

  return {
    handled: true,
    inject: subPrompt.prompt_content,
    patch,
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
