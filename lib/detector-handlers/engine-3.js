// lib/detector-handlers/engine-3.js
// 引擎 3 中央路由器 — 5 個互斥 conditional_inject 子路由器 handler
// 全部 user_turn、priority 20/30/40/50/60（registry Sequential cascade 升序）
//
// 規則內容在 prompt-sections/conditional/engine-3/、本檔 orchestrate:
//   trigger 條件判斷 + Haiku judge call（deep-signal A4 / opening-branch C A4）+ inject + patch

import {
  deepSignalDetector, openingBranchRouter, top1Determination,
  statusRouter, cascadeDownValidator,
} from '../prompt-sections/conditional/engine-3/index.js';
import { judge as depthSignalJudge, shouldDeepRoute } from '../haiku-judge/depth-signal.js';
import { JudgeTimeoutError, JudgeSchemaError } from '../haiku-judge/_base.js';

// regex from deep-signal-detector prompt-section trigger_signals
const TRAUMA_REGEX = deepSignalDetector.trigger_signals.strong.find(s => s.kind === 'regex' && /虐待/.test(String(s.pattern)))?.pattern
  || /(虐待|遺棄|背叛|被打|被罵|霸凌|性侵|猥褻|暴力|親人過世|自殺)/;
const EMOTION_BURST_REGEX = deepSignalDetector.trigger_signals.strong.find(s => s.kind === 'regex' && /崩潰/.test(String(s.pattern)))?.pattern
  || /(哭|崩潰|受不了|喘不過氣|無法呼吸|腦袋空白|手抖)/;
const WORTH_FICTION_REGEX = /(不夠好|不配|沒價值|沒用)/;

// 開場特殊分支觸發詞
const OPENING_STUCK = /(卡住|不知道|沒方向|混亂)/;
const OPENING_FORCE_FLIP = /(老是|總是|永遠都).{0,8}(搞砸|失敗|卡|做不到|不行)/;
const OPENING_WORTH = /(不夠好|不配|沒價值|沒用)/;

// ─────────────────────────────────────────────────────────
// E3 deep_signal_detector (priority 20、最高、用 A4 judge)
// ─────────────────────────────────────────────────────────

export async function e3DeepSignalHandler(ctx) {
  const state = ctx.session_state || {};
  const text = ctx.user_response || '';

  const traumaHit = TRAUMA_REGEX.test(text);
  const emotionHit = EMOTION_BURST_REGEX.test(text);
  const worthHit = WORTH_FICTION_REGEX.test(text);

  // strong signal 任一即偵測；worth-fiction 需 A4 judge 確認深度
  let depthScore = 0;
  let triggered = traumaHit || emotionHit;

  if (worthHit && !triggered) {
    try {
      const judgeFn = ctx.judges?.depthSignal || depthSignalJudge;
      const j = await judgeFn({
        user_response: text,
        last_3_turns: ctx.last_3_turns || [],
        anchors_top3: ctx.anchors_top3 || [],
      });
      depthScore = j.depth_judgment_score;
      triggered = shouldDeepRoute(j);  // score >= 2
    } catch (e) {
      if (e instanceof JudgeTimeoutError || e instanceof JudgeSchemaError) {
        // 保守降級：depth-signal timeout → 觸發 deep handoff（寧可 escalate）
        triggered = true;
        depthScore = 2;
        ctx.logMiss?.({ miss_type: 'judge_timeout', detector: 'E3_deep_signal_A4', error: e.message });
      } else {
        throw e;
      }
    }
  }

  if (!triggered) return { handled: false };

  return {
    handled: true,
    inject: deepSignalDetector.prompt_content,
    patch: {
      deep_signal_flags: {
        worth_fiction_detected: worthHit,
        trauma_marker_detected: traumaHit,
        parts_resistance_detected: false,
        depth_judgment_score: depthScore,
      },
      router_phase: 'deep_signal_handoff',
      handoff_triggered_count: (state.handoff_triggered_count || 0) + 1,
    },
  };
}

// ─────────────────────────────────────────────────────────
// E3 opening_branch_router (priority 30、3 分支、分支 C 用 A4)
// ─────────────────────────────────────────────────────────

export async function e3OpeningBranchHandler(ctx) {
  const state = ctx.session_state || {};
  if (!state.elicitation_mode_active) return { handled: false };
  if (state.opening_branch_handled) return { handled: false };

  const text = ctx.user_response || '';
  const stuckHit = OPENING_STUCK.test(text);
  const flipHit = OPENING_FORCE_FLIP.test(text);
  const worthHit = OPENING_WORTH.test(text);

  if (!stuckHit && !flipHit && !worthHit) return { handled: false };

  const patch = { opening_branch_handled: true, router_phase: 'elicitation' };

  // 分支 C: worth-fiction → A4 depth judge
  if (worthHit && !stuckHit && !flipHit) {
    try {
      const judgeFn = ctx.judges?.depthSignal || depthSignalJudge;
      const j = await judgeFn({
        user_response: text,
        last_3_turns: ctx.last_3_turns || [],
        anchors_top3: ctx.anchors_top3 || [],
      });
      patch.deep_signal_flags = { ...(state.deep_signal_flags || {}), depth_judgment_score: j.depth_judgment_score };
      // score >= 2 → 不在此處理、讓 E3_deep_signal_detector 下輪接（本輪仍 inject opening C 淺處理 framing）
    } catch (e) {
      if (e instanceof JudgeTimeoutError || e instanceof JudgeSchemaError) {
        ctx.logMiss?.({ miss_type: 'judge_timeout', detector: 'E3_opening_branch_C_A4', error: e.message });
      } else {
        throw e;
      }
    }
  }

  return { handled: true, inject: openingBranchRouter.prompt_content, patch };
}

// ─────────────────────────────────────────────────────────
// E3 top1_determination (priority 40、state-check + inject)
// ─────────────────────────────────────────────────────────

export async function e3Top1Handler(ctx) {
  const state = ctx.session_state || {};
  const valuesCount = Array.isArray(state.values_collected_list) ? state.values_collected_list.length : 0;
  const triggered = valuesCount >= 3
    && state.top1_value == null
    && ['elicitation', 'top1_determination'].includes(state.router_phase);

  if (!triggered) return { handled: false };

  return {
    handled: true,
    inject: top1Determination.prompt_content,
    patch: { router_phase: 'top1_determination' },
  };
}

// ─────────────────────────────────────────────────────────
// E3 status_router (priority 50、讀 current_quality_status 路由)
// ─────────────────────────────────────────────────────────

export async function e3StatusRouterHandler(ctx) {
  const state = ctx.session_state || {};
  const triggered = state.router_phase === 'identity_test_routing'
    && state.current_quality_status
    && state.current_quality_status !== 'none';

  if (!triggered) return { handled: false };

  const ROUTE = {
    owned:     'build_vision',
    ambiguous: 'self_concept_model',
    candidate: 'continue_evidence',
  };
  const nextAction = ROUTE[state.current_quality_status] || 'values_elicitation';
  const patch = { next_action: nextAction };
  if (state.current_quality_status === 'none') patch.router_phase = 'elicitation';

  return { handled: true, inject: statusRouter.prompt_content, patch };
}

// ─────────────────────────────────────────────────────────
// E3 cascade_down_validator (priority 60、state-check + inject)
// ─────────────────────────────────────────────────────────

export async function e3CascadeDownHandler(ctx) {
  const state = ctx.session_state || {};
  if (state.router_phase !== 'cascade_down') return { handled: false };

  return {
    handled: true,
    inject: cascadeDownValidator.prompt_content,
    patch: {},
  };
}

// detector definitions
export const E3_DETECTORS = Object.freeze([
  { id: deepSignalDetector.id,    type: deepSignalDetector.type,    trigger_event: 'user_turn', priority: deepSignalDetector.priority,    handler: e3DeepSignalHandler },
  { id: openingBranchRouter.id,   type: openingBranchRouter.type,   trigger_event: 'user_turn', priority: openingBranchRouter.priority,   handler: e3OpeningBranchHandler },
  { id: top1Determination.id,     type: top1Determination.type,     trigger_event: 'user_turn', priority: top1Determination.priority,     handler: e3Top1Handler },
  { id: statusRouter.id,          type: statusRouter.type,          trigger_event: 'user_turn', priority: statusRouter.priority,          handler: e3StatusRouterHandler },
  { id: cascadeDownValidator.id,  type: cascadeDownValidator.type,  trigger_event: 'user_turn', priority: cascadeDownValidator.priority,  handler: e3CascadeDownHandler },
]);
