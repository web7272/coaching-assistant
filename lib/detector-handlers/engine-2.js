// lib/detector-handlers/engine-2.js
// 引擎 2 身份測試 pipeline handler
// master_detector (regex: Quality 詞表 + 身份句結構) → aggregator (JS 4-door cascade)
//   → 選 upgrade / stay / continue
//
// E2 aggregator = JS orchestration（Patrick 5/22 Q2）:
//   door 1 詞彙 regex / door 2 pattern / door 3 NOT-PPL 讀 state /
//   door 4 confirm 呼叫 P1 sensory-detail judge
// Sequential cascade：任一 door fail 停、door 4 Haiku 只在前 3 door 過才 call
//
// skip_if: deviation_handled_this_turn != null（E1 已處理偏離、registry.skipIfDeviationHandled）

import { ENGINE_2_PIPELINE, masterDetector } from '../prompt-sections/conditional/engine-2/index.js';
import { judge as sensoryDetailJudge } from '../haiku-judge/sensory-detail.js';
import { JudgeTimeoutError, JudgeSchemaError } from '../haiku-judge/_base.js';

// ─────────────────────────────────────────────────────────
// master regex: Quality 詞表 + 身份句結構
// ─────────────────────────────────────────────────────────

/**
 * Detect identity signal (Quality candidate term or identity sentence).
 * @returns {{ suspected: boolean, candidate_term: string|null, identity_sentence_hit: boolean }}
 */
export function matchE2(userResponse) {
  const text = typeof userResponse === 'string' ? userResponse : '';
  const qt = masterDetector.quality_terms;
  const flags = masterDetector.quality_term_flags;

  // identity sentence structures (8 regex)
  let identity_sentence_hit = false;
  for (const s of masterDetector.identity_sentence_structures) {
    if (s.regex.test(text)) { identity_sentence_hit = true; break; }
  }

  // quality term match (groups A-E, exclude blacklist)
  let candidate_term = null;
  const groups = ['damon_validated', 'east_asian_adapted', 'action_qualities', 'existence_qualities', 'a001_corpus'];
  for (const g of groups) {
    for (const term of qt[g]) {
      if (text.includes(term)) {
        // 鑽石 / requires_identity_sentence: 只在伴隨身份句時才算
        if (flags.requires_identity_sentence.includes(term) && !identity_sentence_hit) continue;
        candidate_term = term;
        break;
      }
    }
    if (candidate_term) break;
  }

  // blacklist hit → not a valid candidate (engine 2 §5.1 黑名單)
  const blacklistHit = qt.blacklist.some(term => text.includes(term));

  const suspected = (!!candidate_term || identity_sentence_hit) && !(!candidate_term && blacklistHit);
  return { suspected, candidate_term, identity_sentence_hit };
}

// ─────────────────────────────────────────────────────────
// aggregator — JS 4-door Sequential cascade
// ─────────────────────────────────────────────────────────

/**
 * Run the 4-door aggregation. Sequential cascade: any door fail stops.
 * door 4 (Haiku sensory-detail) only called when doors 1-3 pass.
 *
 * @returns {Promise<{ doors_passed: number, passed_doors: string[], recommended_sub_prompt: string }>}
 */
export async function runAggregator(ctx, e2signal) {
  const state = ctx.session_state || {};
  const passed = [];

  // door 1 — lexical
  const door1 = !!e2signal.candidate_term
    || !!state.current_quality_candidate_term
    || e2signal.identity_sentence_hit;
  if (!door1) {
    return { doors_passed: 0, passed_doors: passed, recommended_sub_prompt: 'continue' };
  }
  passed.push('lexical');

  // door 2 — pattern
  const door2 = e2signal.identity_sentence_hit
    || !!state.identity_sentence_pattern_hit
    || !!state.pattern_signal_hit;
  if (!door2) {
    return { doors_passed: 1, passed_doors: passed, recommended_sub_prompt: 'stay' };
  }
  passed.push('pattern');

  // door 3 — NOT People Pleasing (繼承引擎 1 cumulative_ppl_score)
  const pplScore = state.cumulative_ppl_score || 0;
  const pureCompliance = /^(是|對|都可以|好|嗯)[。!\s]*$/.test((ctx.user_response || '').trim());
  const door3 = pplScore < 0.6 && !pureCompliance;
  if (!door3) {
    return { doors_passed: 2, passed_doors: passed, recommended_sub_prompt: 'stay' };
  }
  passed.push('not_ppl');

  // door 4 — confirm (Haiku sensory-detail、只在前 3 door 過才 call)
  let door4 = false;
  try {
    const judgeFn = ctx.judges?.sensoryDetail || sensoryDetailJudge;
    const judgment = await judgeFn({
      user_response: ctx.user_response,
      prior_question: state.last_ai_question || '(evidence script)',
      value_being_tested: e2signal.candidate_term || state.current_quality_candidate_term || '(quality)',
    });
    door4 = judgment.sensory_detail_score >= 2;
  } catch (e) {
    if (e instanceof JudgeTimeoutError || e instanceof JudgeSchemaError) {
      // 保守降級：door 4 視為 fail（不放行升級）
      door4 = false;
      ctx.logMiss?.({ miss_type: 'judge_timeout', detector: 'E2_aggregator_door4', error: e.message });
    } else {
      throw e;
    }
  }
  if (!door4) {
    return { doors_passed: 3, passed_doors: passed, recommended_sub_prompt: 'stay' };
  }
  passed.push('confirm');

  return { doors_passed: 4, passed_doors: passed, recommended_sub_prompt: 'upgrade' };
}

// ─────────────────────────────────────────────────────────
// E2 pipeline handler (registered as user_turn, priority 70, skip_if deviation_handled)
// ─────────────────────────────────────────────────────────

export async function e2MasterHandler(ctx) {
  const state = ctx.session_state || {};
  const e2signal = matchE2(ctx.user_response);

  if (!e2signal.suspected) {
    return { handled: false };
  }

  const patch = {
    identity_signal_suspected_this_turn: true,
    identity_sentence_pattern_hit: e2signal.identity_sentence_hit,
  };
  if (e2signal.candidate_term) {
    patch.current_quality_candidate_term = e2signal.candidate_term;
  }

  const agg = await runAggregator(ctx, e2signal);
  const sub = agg.recommended_sub_prompt;  // upgrade | stay | continue
  const subPrompt = ENGINE_2_PIPELINE.sub_prompts[sub];

  // quality status transition (engine 2 §4.2)
  const cur = state.current_quality_status || 'none';
  if (agg.doors_passed === 4) {
    patch.current_quality_status = 'owned';
    patch.identity_test_evidence_count = (state.identity_test_evidence_count || 0) + 1;
  } else if (agg.doors_passed >= 1) {
    if (cur === 'none') patch.current_quality_status = 'candidate';
    // candidate → ambiguous on 「有時/偶爾」detected
    if (cur === 'candidate' && /有時|偶爾|還在練習/.test(ctx.user_response || '')) {
      patch.current_quality_status = 'ambiguous';
    }
  }
  patch.aggregation_result = {
    doors_passed: agg.doors_passed,
    passed_doors: agg.passed_doors,
    recommended_sub_prompt: sub,
  };

  return {
    handled: true,
    inject: subPrompt.prompt_content,
    patch,
  };
}

// detector definition (handler + skip_if attached by chat.js registration)
export const E2_DETECTOR = Object.freeze({
  id: masterDetector.id,
  type: masterDetector.type,
  trigger_event: masterDetector.trigger_event,
  priority: masterDetector.priority,
  handler: e2MasterHandler,
});
