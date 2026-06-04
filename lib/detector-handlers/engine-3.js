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
import {
  // ⭐ §3 patch 6/4 (safety patch #23) — passive DW regex imports + variant
  //   content references. Single source of truth in deep-signal-detector.js.
  PASSIVE_STRONG_REGEX, PASSIVE_IMPLICIT_REGEX, SURFACE_LIFE_SIGNAL_REGEX,
} from '../prompt-sections/conditional/engine-3/deep-signal-detector.js';
import {
  selectPassiveDWVariant,
} from '../state/handoff-escalation.js';
import { judge as depthSignalJudge, shouldDeepRoute } from '../haiku-judge/depth-signal.js';
import { JudgeTimeoutError, JudgeSchemaError } from '../haiku-judge/_base.js';

// regex from deep-signal-detector prompt-section trigger_signals
// ⭐ §3 patch 6/4 — trauma regex 加「上吊」 (從 deep-signal-detector.js single source).
const TRAUMA_REGEX = deepSignalDetector.trigger_signals.strong.find(s => s.kind === 'regex' && /虐待/.test(String(s.pattern)))?.pattern
  || /(虐待|遺棄|背叛|被打|被罵|霸凌|性侵|猥褻|暴力|親人過世|自殺|上吊)/;
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

// ⭐ §3 patch 6/4 (safety patch #23) — A6 SI confirm transition classifier.
//   TODO(任務3): replace with Crisis Mode SI SOP (full risk assessment + safety plan).
//   For now: minimal regex split — DENY (沒有 / 不會 / 沒想) → standard 三選一 +
//   1925; CONFIRM / AMBIGUOUS (default) → only-(b) + HITL + freeze.
//   Bias for safety: ambiguous treated as confirm (false-negative = danger).
const SI_DENY_REGEX = /(沒有|沒念頭|沒想|不會|不想要|不想.{0,3}傷害)/;
const SI_CONFIRM_REGEX = /(有|有念頭|想.{0,3}傷害|想.{0,3}死|想.{0,3}消失)/;

// ⭐ §3 patch 6/4 PR-23b (safety patch #23, Vivi 6/4 折衷裁決) — C-2 implicit
//   pending classifier. When previous turn fired C-2 (passive 隱性 + life signal),
//   classify student's framing answer:
//     PHILOSOPHICAL (字面 / 哲學 / 完成感 / 疲憊) → light 1925, no 三選一, count
//                                                  already +1 from C-2 fire,
//                                                  dashboard event for H4 監控
//     REAL          (真的不想活 / 真的累 / 想離開) → escalate to C-1 (set
//                                                   si_confirm_pending, count++)
//     AMBIGUOUS     (default)                    → bias safety, escalate C-1
const IMPLICIT_PHILOSOPHICAL_REGEX = /(字面|哲學|就是.{0,3}字面|就是.{0,3}意思|完成感|疲憊|單純.{0,3}累|沒.{0,3}想死|大致.{0,3}沒|就是.{0,3}這個意思|是這個意思)/;
const IMPLICIT_REAL_REGEX = /(真的.{0,3}不想|真的.{0,3}想離開|真的.{0,3}很沉|真的.{0,3}活不下|很沉的感受|沉重的感受|不想活|想離開|想結束)/;

function classifyStudentSIResponse(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return 'ambiguous';
  if (SI_DENY_REGEX.test(text)) return 'deny';
  if (SI_CONFIRM_REGEX.test(text)) return 'confirm';
  return 'ambiguous';
}

// PR-23b — C-2 implicit pending classifier.
//   REAL check runs first (overrides PHILOSOPHICAL match) — student saying
//   「真的不想活」OR「真的累、想離開」 must escalate to C-1 even if「字面」
//   appears in same sentence (defensive).
function classifyImplicitFraming(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return 'ambiguous';
  if (IMPLICIT_REAL_REGEX.test(text)) return 'real';
  if (IMPLICIT_PHILOSOPHICAL_REGEX.test(text)) return 'philosophical';
  return 'ambiguous';
}

const SI_DENY_INJECT = `[SYSTEM INJECT — SI Confirm · Deny path]

學員 deny SI 念頭 — 走標準 handoff_escalation 三選一 + 1925 安心專線文案.

**必須做**:

1. 承認學員的回答:
   > 「謝謝你告訴我。」

2. handoff_escalation 三選一 (與既有變體 A/B 同):
   > 「你現在比較想要:
   > (a)先停在這、不繼續挖、我們改聊輕一點的
   > (b)我幫你預約跟 Vivi 1-on-1、有個真人陪你走這段
   > (c)我們先回到日常、Future Pacing、過陣子再回來看」

3. 附 1925:
   > 「如果之後有任何「不想活」的感覺、可以打 1925 (24 小時、不用預約)。」

**禁止**:
- 不可繼續追問 SI 細節 (學員已 deny)
- 不可繼續身份測試 / values elicitation
- 不可說「我們一起面對」/「我陪你走」`;

const SI_CONFIRM_INJECT = `[SYSTEM INJECT — SI Confirm · Confirm / Ambiguous path]

⚠️ 學員 confirm 或回答 ambiguous SI confirm — 立即升級為強制 only-(b) + HITL + freeze.
**AI 不再給推進選項、不再給 (a)/(c)、不繼續推進對話**.

**必須做**:

1. 承認 + 不分析:
   > 「我聽到了。我想停下來、把這裡交給 Vivi。」

2. 強制只剩 (b) + 1925:
   > 「下一步、我幫你安排跟 Vivi 1-on-1 (或你信任的精神科 / 諮商心理師),有個真人陪你走這段。
   > 在那之前、如果你願意、可以打 1925 (24 小時、不用預約),有人接、不用付費。」

3. HITL alert Vivi + freeze 推進.

📞 24 小時安心專線 1925、生命線 1995、張老師 1980.

**禁止**:
- 不可給「想開一點」「不要想太多」這類淺安撫
- 不可繼續身份測試 / values elicitation
- 不可推學員去做 Crisis Mode SOP 之外的任何操作`;

export async function e3DeepSignalHandler(ctx) {
  const state = ctx.session_state || {};
  const text = ctx.user_response || '';

  // ⭐ §3 patch 6/4 (safety patch #23) — A6 transition: SI confirm classifier.
  //   If previous turn set si_confirm_pending (variant C-1 asked the SI question),
  //   classify the student response BEFORE doing fresh detection. Clears the
  //   pending flag in the patch.
  if (state.si_confirm_pending === true) {
    const verdict = classifyStudentSIResponse(text);
    const patch = {
      si_confirm_pending: false,
      si_confirm_result: verdict,
      router_phase: 'deep_signal_handoff',
      handoff_triggered_count: (state.handoff_triggered_count || 0) + 1,
    };
    if (verdict === 'deny') {
      return { handled: true, inject: SI_DENY_INJECT, patch };
    }
    // confirm / ambiguous — bias for safety, treat both as confirmed.
    patch.passive_dw_frozen = true;
    return { handled: true, inject: SI_CONFIRM_INJECT, patch };
  }

  // ⭐ §3 patch 6/4 PR-23b (Vivi 6/4 折衷裁決) — C-2 implicit_pending classifier.
  //   Previous turn fired C-2 (asked 字面 vs 感受). Classify framing answer.
  //   PHILOSOPHICAL → light 1925 inject, no 三選一, no extra count (already +1
  //                   from C-2). Log philosophical_declaration event for H4
  //                   dashboard caution (連 3 次 → tracker flag).
  //   REAL          → escalate to C-1 (set si_confirm_pending=true, count++,
  //                   inject C-1 strong content).
  //   AMBIGUOUS     → bias safety, treat as real.
  if (state.passive_dw_implicit_pending === true) {
    const framing = classifyImplicitFraming(text);
    if (framing === 'philosophical') {
      // Vivi 6/4 折衷: 不開三選一, 不 handoff_triggered_count++, 但記錄供 dashboard
      // 算 H4 false_positive_rate + 連續 3 次 caution.
      console.info('[passive-dw][philosophical-declaration]', JSON.stringify({
        event: 'passive_dw_implicit_philosophical_declaration',
        // SAFE LOG: 不 log 學員原話 (鐵律 #2 諮商保密), 只 log structural fact.
        ctx_sid: ctx.student_id || null,
      }));
      return {
        handled: true,
        inject: deepSignalDetector.prompt_content_passive_dw_implicit_philosophical,
        patch: {
          passive_dw_implicit_pending: false,
          passive_dw_implicit_result: 'philosophical',
          // Per Vivi 折衷: count 不 +1 here (already +1 when C-2 fired).
          // router_phase 維持 deep_signal_handoff 一輪, 下 turn auto 回 normal.
        },
        // No user_profile_increments — count already happened.
      };
    }
    // real / ambiguous → escalate to C-1 strong.
    const currentCount = Number(ctx.user_profile?.passive_death_wish_count ?? 0);
    const newCount = currentCount + 1;
    const variant = selectPassiveDWVariant({ signal: 'strong', newCount });
    const injectMap = {
      strong:   deepSignalDetector.prompt_content_passive_dw_strong,
      repeat:   deepSignalDetector.prompt_content_passive_dw_repeat,
      freeze:   deepSignalDetector.prompt_content_passive_dw_freeze,
    };
    return {
      handled: true,
      inject: injectMap[variant] || deepSignalDetector.prompt_content_passive_dw_strong,
      patch: {
        passive_dw_implicit_pending: false,
        passive_dw_implicit_result: framing,  // 'real' or 'ambiguous'
        deep_signal_flags: {
          ...(state.deep_signal_flags || {}),
          passive_dw_detected: true,
          passive_dw_signal: 'strong',
          passive_dw_variant: variant,
          passive_dw_cross_session_count: newCount,
        },
        router_phase: 'deep_signal_handoff',
        handoff_triggered_count: (state.handoff_triggered_count || 0) + 1,
        si_confirm_pending: variant === 'strong',
        passive_dw_frozen: variant === 'freeze',
      },
      user_profile_increments: { passive_death_wish_count: 1 },
    };
  }

  // ⭐ §3 patch 6/4 (safety patch #23) — Passive Death Wish 偵測, FIRST priority
  //   over trauma/emotion/worth-fiction (more critical, more specific).
  //   Strong signal: 明說「不想活 / 希望死」, fires alone.
  //   Implicit signal: 「上天讓我活著」「此生無憾」, only fires if本 session
  //                   also surfaced 「活下去 / 動力 / 意義」類詞 (support signal,
  //                   per spec §C-2 — 區分哲學表述 vs 真實 passive DW).
  const passiveStrongHit = PASSIVE_STRONG_REGEX.test(text);
  const passiveImplicitHit = PASSIVE_IMPLICIT_REGEX.test(text);
  const sessionTurns = Array.isArray(ctx.last_3_turns) ? ctx.last_3_turns : [];
  const hasLifeSignal = sessionTurns.some(t =>
    typeof t === 'string' && SURFACE_LIFE_SIGNAL_REGEX.test(t)
  );
  const passiveImplicitTriggered = passiveImplicitHit && hasLifeSignal;

  if (passiveStrongHit || passiveImplicitTriggered) {
    const signal = passiveStrongHit ? 'strong' : 'implicit';
    // Cross-session count from user_profile_evolution.passive_death_wish_count.
    // Migration 024 adds the column; defensive ?? 0 covers pre-migration runs.
    const currentCount = Number(ctx.user_profile?.passive_death_wish_count ?? 0);
    const newCount = currentCount + 1;
    // selectPassiveDWVariant: count >= 5 → freeze, >= 3 → repeat, else signal.
    const variant = selectPassiveDWVariant({ signal, newCount });
    const injectMap = {
      strong:   deepSignalDetector.prompt_content_passive_dw_strong,
      implicit: deepSignalDetector.prompt_content_passive_dw_implicit,
      repeat:   deepSignalDetector.prompt_content_passive_dw_repeat,
      freeze:   deepSignalDetector.prompt_content_passive_dw_freeze,
    };
    return {
      handled: true,
      inject: injectMap[variant],
      patch: {
        deep_signal_flags: {
          ...(state.deep_signal_flags || {}),
          worth_fiction_detected: false,
          trauma_marker_detected: false,
          parts_resistance_detected: false,
          // §3 patch #23 — new passive DW state.
          passive_dw_detected: true,
          passive_dw_signal: signal,
          passive_dw_variant: variant,
          passive_dw_cross_session_count: newCount,
        },
        router_phase: 'deep_signal_handoff',
        handoff_triggered_count: (state.handoff_triggered_count || 0) + 1,
        // TODO(任務3): replace with Crisis Mode SI SOP. C-1 sets si_confirm_pending
        // so next turn's handler routes to a deny/confirm/ambiguous classifier
        // (transitional behavior per Vivi 6/4 spec A6).
        si_confirm_pending: variant === 'strong',
        passive_dw_implicit_pending: variant === 'implicit',
        passive_dw_frozen: variant === 'freeze',
      },
      // §3 patch #23 — chat.js drains and forwards to incrementUserProfileCounters
      // so the cross-session counter persists. Per spec H4: count even when
      // student turns out to mean it philosophically (we observe regardless).
      user_profile_increments: { passive_death_wish_count: 1 },
    };
  }

  // existing trauma / emotion / worth-fiction path (variants A / B) — unchanged.
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
