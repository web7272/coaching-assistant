// lib/detector-handlers/engine-3.js
// 引擎 3 中央路由器 — 5 個互斥 conditional_inject 子路由器 handler
// 全部 user_turn、priority 20/30/40/50/60（registry Sequential cascade 升序）
//
// 規則內容在 prompt-sections/conditional/engine-3/、本檔 orchestrate:
//   trigger 條件判斷 + Haiku judge call（deep-signal A4 / elicitation C A4）+ inject + patch
//
// PR-23s4b 改名 (per v51_engine_3_errata_v02.md task 1):
//   e3OpeningBranchHandler → e3ElicitationRouterHandler
//   e3Top1Handler          → e3Top1JudgeHandler
//   e3StatusRouterHandler  → e3ModeTransitionHandler (+ 接管 transition 判定 + emit log)
//   e3CascadeDownHandler   → e3CascadeModeHandler

import {
  deepSignalDetector, elicitationRouter, top1Judge,
  integrationRouter,         // PR-23s4c task 2
  modeTransitionRouter, cascadeModeValidator,
  futurePacingRouter,        // PR-23s4c task 2
} from '../prompt-sections/conditional/engine-3/index.js';
import {
  // ⭐ §3 patch 6/4 (safety patch #23) — passive DW regex imports + variant
  //   content references. Single source of truth in deep-signal-detector.js.
  PASSIVE_STRONG_REGEX, PASSIVE_IMPLICIT_REGEX, SURFACE_LIFE_SIGNAL_REGEX,
  // ⭐ 6/6 v2 hotfix — active SI explicit fast-path regex.
  ACTIVE_SI_EXPLICIT_REGEX,
} from '../prompt-sections/conditional/engine-3/deep-signal-detector.js';
// ⭐ 6/6 dedupe gate — AI-facing phrasings imported from single source of truth.
import {
  HANDOFF_4_1_STANDARD_PHRASING,
  HANDOFF_4_3_HIGH_RISK_PHRASING,
} from '../sub-prompts/crisis/_phrasings.js';
// ⭐ 6/6 v2 hotfix — crisis SOP constants for pre-initialized Step 4 state.
import {
  SOP_STEPS, CRISIS_AWAITING, CRISIS_CATEGORY,
  SI_ANSWER, HANDOFF_VARIANT,
} from '../sub-prompts/crisis/_constants.js';
import {
  selectPassiveDWVariant,
} from '../state/handoff-escalation.js';
// PR-23s4b — mode-tracker + logger 接管 transition (task 1).
import {
  ACTIVE_MODES, readModeState, transitionPrimary, triggerCrisis,
} from '../session/mode-tracker.js';
import {
  TRIGGER_TYPES, buildTransitionEntry, appendTransitionPatch,
} from '../session/mode-transition-logger.js';
import { judge as depthSignalJudge, shouldDeepRoute } from '../haiku-judge/depth-signal.js';
// v5.1 Step 5b — A1 dim 4 (sensory-detail judge) for cascade Top 2/3 evidence.
import {
  judge as sensoryDetailJudge,
  R2_STRATEGY_REFRAME_INJECT,
} from '../haiku-judge/sensory-detail.js';
import { JudgeTimeoutError, JudgeSchemaError } from '../haiku-judge/_base.js';
// 6/12 — Record R2 invocation when cascade dim_4 fires (此處 R2_STRATEGY_REFRAME_INJECT
// 跟 engine-2.js 同份 const).
import { buildInvocationPatch } from '../damon-reframe-library/invocation-tracker.js';

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

// ⭐ §3 patch 6/4 (safety patch #23) + errata v02 — A6 SI confirm transition classifier.
//   ⚠️ DEAD CODE under v5.1 Step 6 PR-6a + errata v02: crisis-sop.js (priority 2)
//   takes over once crisis_in_progress=true (set when passive_dw signal fires).
//   This block kept for safety net only — fires only if crisis-sop is bypassed.
//   Phrasings updated to errata v02 direct-1925 to avoid contradicting Step 4.
//   DENY → standard direct-1925; CONFIRM/AMBIGUOUS → high_risk direct-1925 + HITL.
const SI_DENY_REGEX = /(沒有|沒念頭|沒想|不會|不想要|不想.{0,3}傷害)/;
const SI_CONFIRM_REGEX = /(有|有念頭|想.{0,3}傷害|想.{0,3}死|想.{0,3}消失)/;

// ⭐ §3 patch 6/4 PR-23b (safety patch #23, Vivi 6/4 折衷裁決) — C-2 implicit
//   pending classifier. When previous turn fired C-2 (passive 隱性 + life signal),
//   classify student's framing answer:
//     PHILOSOPHICAL (字面 / 哲學 / 完成感 / 疲憊) → light 1925, no direct-1925 (errata v02), count
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

const SI_DENY_INJECT = `[SYSTEM INJECT — SI Confirm · Deny path (errata v02 direct-1925)]

學員 deny SI 念頭 — 走 Step 4 standard direct-1925 (errata v02 廢direct-1925 (errata v02)).

**必須做**:

1. 承認學員的回答:
   > 「謝謝你告訴我。」

2. Step 4 standard direct-1925 phrasing (Vivi 6/6 終審 — source: _phrasings.js HANDOFF_4_1_STANDARD_PHRASING):
${HANDOFF_4_1_STANDARD_PHRASING.split('\n').map(l => '   > ' + l).join('\n')}

**禁止**:
- 不可繼續追問 SI 細節 (學員已 deny)
- 不可繼續身份測試 / values elicitation
- 不可說「我們一起面對」/「我陪你走」
- 不可 offer「預約 Vivi 1-on-1」 (errata v02 廢除、萬人規模不可行)
- 不可給「direct-1925 (errata v02)」 a/b/c (errata v02 廢除)`;

const SI_CONFIRM_INJECT = `[SYSTEM INJECT — SI Confirm · Confirm / Ambiguous path (errata v02 high_risk)]

⚠️ 學員 confirm 或回答 ambiguous SI confirm — 立即升級 Step 4 high_risk direct-1925 + HITL + freeze.
**AI 不再給推進選項、不繼續推進對話** (errata v02 廢direct-1925 (errata v02) + 廢預約 1-on-1).

**必須做**:

1. Step 4 high_risk direct-1925 phrasing (Vivi 6/6 終審 — source: _phrasings.js HANDOFF_4_3_HIGH_RISK_PHRASING):
${HANDOFF_4_3_HIGH_RISK_PHRASING.split('\n').map(l => '   > ' + l).join('\n')}

2. HITL alert Vivi + freeze 推進.

📞 24 小時安心專線 1925、生命線 1995、張老師 1980.

**禁止**:
- 不可給「想開一點」「不要想太多」這類淺安撫
- 不可繼續身份測試 / values elicitation
- 不可推學員去做 Crisis Mode SOP 之外的任何操作
- 不可 offer「我幫你安排 Vivi 1-on-1」 (errata v02 廢除)
- 不可承諾 Vivi 1-on-1 預約 (Vivi 主動聯絡是「我看到你回來了」開場用、非 AI offer booking)`;

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
  //   PHILOSOPHICAL → light 1925 inject, no direct-1925 (errata v02), no extra count (already +1
  //                   from C-2). Log philosophical_declaration event for H4
  //                   dashboard caution (連 3 次 → tracker flag).
  //   REAL          → escalate to C-1 (set si_confirm_pending=true, count++,
  //                   inject C-1 strong content).
  //   AMBIGUOUS     → bias safety, treat as real.
  if (state.passive_dw_implicit_pending === true) {
    const framing = classifyImplicitFraming(text);
    if (framing === 'philosophical') {
      // Vivi 6/4 折衷: 不開direct-1925 (errata v02), 不 handoff_triggered_count++, 但記錄供 dashboard
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
        router_phase: 'deep_signal_handoff',   // PR-23s4b: deprecated, mirror only
        primary_mode: ACTIVE_MODES.CRISIS,     // PR-23s4b: mode-tracker source of truth
        crisis_in_progress: true,
        handoff_triggered_count: (state.handoff_triggered_count || 0) + 1,
        si_confirm_pending: variant === 'strong',
        passive_dw_frozen: variant === 'freeze',
      },
      user_profile_increments: { passive_death_wish_count: 1 },
    };
  }

  // ⭐ 6/6 v2 hotfix (Vivi 沙盒 #2) — Active SI explicit 快速路徑.
  //   Highest priority among all signals — student already declared explicit
  //   first-person suicide / end-life intent. Do NOT ask 「有沒有念頭」 (C-1
  //   direct-SI question) — that's absurd post-declaration.
  //
  //   Fast-path bypass:
  //     - Skip Step 1 acknowledge 直問 + Step 2 SI assessment.
  //     - Pre-initialize crisis_sop_state at Step 4 awaiting HANDOFF_ACK.
  //     - Emit Step 4.3 high_risk direct-1925 phrasing immediately.
  //     - HITL critical alert immediate.
  //     - passive_death_wish_count + 1 (cross-session 追蹤).
  //   Variant precedence (within active SI):
  //     count >= 5 → FREEZE (escalated, 「我看到你回來了」 next session)
  //     else       → HIGH_RISK (current session 1925 + 真人在你旁邊)
  if (ACTIVE_SI_EXPLICIT_REGEX.test(text)) {
    const currentCount = Number(ctx.user_profile?.passive_death_wish_count ?? 0);
    const newCount = currentCount + 1;
    const activeSiVariant = newCount >= 5 ? HANDOFF_VARIANT.FREEZE : HANDOFF_VARIANT.HIGH_RISK;

    // mode-tracker + transition log (mirror passive_strong path).
    const modeReadActive = readModeState(state);
    const newModeStateActive = triggerCrisis(modeReadActive);
    const turnCountActive = typeof state.turn_count_this_session === 'number'
      ? state.turn_count_this_session : 0;
    const transitionEntryActive = buildTransitionEntry({
      from_active_modes: modeReadActive.active_modes,
      to_active_modes:   newModeStateActive.active_modes,
      from_primary:      modeReadActive.primary_mode,
      to_primary:        newModeStateActive.primary_mode,
      trigger_type:      TRIGGER_TYPES.SIGNAL_CASCADE,
      trigger_detail:    JSON.stringify({
        source: 'deep_signal_detector',
        signal: 'active_si_explicit',
        variant: activeSiVariant,
        new_count: newCount,
      }),
      turn_count: turnCountActive,
    });
    const logPatchActive = appendTransitionPatch(state, transitionEntryActive);

    // Pre-initialize crisis_sop_state at Step 4 — skip Step 1/2/3 entirely.
    // si_answer = CONFIRM (student already declared); plan_answer left null
    // (we explicitly DO NOT assess plan, per Vivi 6/6 v2 spec).
    const sopStateAtStep4 = {
      current_step: SOP_STEPS.STEP_4_HANDOFF,
      awaiting:     CRISIS_AWAITING.HANDOFF_ACK,
      steps_completed: ['0', '1', '2', '2.3', '3'],
      crisis_trigger_category: CRISIS_CATEGORY.PASSIVE_DW_STRONG,   // mapped to passive_death_wish carry-forward bucket
      step1_variant_used: null,                                      // skipped
      si_answer:    SI_ANSWER.CONFIRM,                               // explicit declaration
      plan_answer:  null,                                            // not assessed
      protective_factor_surfaced: null,                              // not assessed
      handoff_choice: null,                                          // errata v02 deprecated
      handoff_variant_used: activeSiVariant,
      reminder_variant_used: null,
      reminder_offer_count: 0,
      safety_plan: { activities: [], safe_location: null, self_harm_denied: null },
      closure_explicit: null,
      active_si_explicit: true,
    };

    return {
      handled: true,
      inject: deepSignalDetector.prompt_content_active_si_explicit,
      patch: {
        deep_signal_flags: {
          ...(state.deep_signal_flags || {}),
          worth_fiction_detected: false,
          trauma_marker_detected: false,
          parts_resistance_detected: false,
          active_si_explicit_detected: true,
          passive_dw_detected: true,
          passive_dw_signal: 'active_si_explicit',
          passive_dw_variant: activeSiVariant,
          passive_dw_cross_session_count: newCount,
        },
        crisis_sop_state: sopStateAtStep4,
        crisis_in_progress: true,
        primary_mode: newModeStateActive.primary_mode,
        active_modes: newModeStateActive.active_modes,
        paused_modes: newModeStateActive.paused_modes,
        ...logPatchActive,
        hitl_critical_alert: true,
        router_phase: 'deep_signal_handoff',
        handoff_triggered_count: (state.handoff_triggered_count || 0) + 1,
        // Critical: si_confirm_pending = false (no next-turn classifier needed —
        // crisis-sop.js takes over at Step 4 directly).
        si_confirm_pending: false,
        passive_dw_implicit_pending: false,
        passive_dw_frozen: activeSiVariant === HANDOFF_VARIANT.FREEZE,
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

    // ⭐ PR-23s4c task 3 — mode-aware logging.
    //   Use triggerCrisis to compute proper paused_modes (pause non-crisis modes).
    //   Emit signal_cascade transition log via mode-transition-logger.
    //   crisis_state_carry_forward stub (Step 6 will populate fully).
    const modeRead = readModeState(state);
    const newModeState = triggerCrisis(modeRead);
    const turnCountSafe = typeof state.turn_count_this_session === 'number'
      ? state.turn_count_this_session : 0;
    const transitionEntry = buildTransitionEntry({
      from_active_modes: modeRead.active_modes,
      to_active_modes:   newModeState.active_modes,
      from_primary:      modeRead.primary_mode,
      to_primary:        newModeState.primary_mode,
      trigger_type:      TRIGGER_TYPES.SIGNAL_CASCADE,
      trigger_detail:    JSON.stringify({
        source: 'deep_signal_detector',
        signal,                // 'strong' | 'implicit'
        variant,               // 'strong'|'implicit'|'repeat'|'freeze'
        new_count: newCount,
        was_implicit_pending: !!state.passive_dw_implicit_pending,
      }),
      turn_count: turnCountSafe,
    });
    const logPatch = appendTransitionPatch(state, transitionEntry);

    // crisis_state_carry_forward stub (per spec — full schema lands Step 6).
    const crisisStateStub = {
      crisis_triggered_at: new Date().toISOString(),
      crisis_category: `passive_dw_${signal}_${variant}`,
      // Full fields (handoff_choice / si_risk_level / safety_plan / next_session_focus /
      // resolved_at / resolution_type) populated by Step 6 Crisis Mode SOP.
      pending_step6_complete: true,
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
        router_phase: 'deep_signal_handoff',   // PR-23s4b: deprecated, mirror only
        // PR-23s4c task 3: full mode-tracker write (was: primary_mode only).
        primary_mode: newModeState.primary_mode,
        active_modes: newModeState.active_modes,
        paused_modes: newModeState.paused_modes,
        crisis_in_progress: true,
        crisis_state_carry_forward: crisisStateStub,
        ...logPatch,
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
// E3 elicitation_router (priority 30、4 分支 — A curiosity / B 強制翻轉 / C 深度判斷 / D 副產品)
// 前身 e3OpeningBranchHandler. PR-23s4b 改名 + 加 D 副產品挑戰分支 (對齊紅線 24).
// ─────────────────────────────────────────────────────────

// PR-23s4b — D 副產品偵測 (對齊紅線 24, byproduct words 當 quality).
const OPENING_BYPRODUCT = /(開心|快樂|幸福|滿足|意義|目的)/;

export async function e3ElicitationRouterHandler(ctx) {
  const state = ctx.session_state || {};
  // PR-23s4b — 讀 primary_mode (with fallback). 仍接受 elicitation_mode_active
  // 作為 dual-write 期間的 legacy gate.
  const modeRead = readModeState(state);
  const isElicitation = modeRead.primary_mode === ACTIVE_MODES.ELICITATION
    || state.elicitation_mode_active;
  if (!isElicitation) return { handled: false };
  // elicitation_branch_handled 取代 opening_branch_handled.
  if (state.elicitation_branch_handled || state.opening_branch_handled) return { handled: false };

  const text = ctx.user_response || '';
  const stuckHit = OPENING_STUCK.test(text);
  const flipHit = OPENING_FORCE_FLIP.test(text);
  const worthHit = OPENING_WORTH.test(text);
  const byproductHit = OPENING_BYPRODUCT.test(text);

  if (!stuckHit && !flipHit && !worthHit && !byproductHit) return { handled: false };

  const patch = {
    // PR-23s4b: 新 key + 舊 key dual-write (test backward compat).
    elicitation_branch_handled: true,
    opening_branch_handled: true,
    router_phase: 'elicitation',   // deprecated mirror, 給 still-reading detectors
  };

  // 分支 C: worth-fiction → A4 depth judge
  if (worthHit && !stuckHit && !flipHit && !byproductHit) {
    try {
      const judgeFn = ctx.judges?.depthSignal || depthSignalJudge;
      const j = await judgeFn({
        user_response: text,
        last_3_turns: ctx.last_3_turns || [],
        anchors_top3: ctx.anchors_top3 || [],
      });
      patch.deep_signal_flags = { ...(state.deep_signal_flags || {}), depth_judgment_score: j.depth_judgment_score };
    } catch (e) {
      if (e instanceof JudgeTimeoutError || e instanceof JudgeSchemaError) {
        ctx.logMiss?.({ miss_type: 'judge_timeout', detector: 'E3_elicitation_C_A4', error: e.message });
      } else {
        throw e;
      }
    }
  }
  // 分支 D 副產品: no judge needed, prompt content handles framing.

  return { handled: true, inject: elicitationRouter.prompt_content, patch };
}

// ─────────────────────────────────────────────────────────
// E3 top1_judge (priority 40、state-check + inject)
// 前身 e3Top1Handler. PR-23s4b 改名 + primary_mode 讀取.
// ─────────────────────────────────────────────────────────

export async function e3Top1JudgeHandler(ctx) {
  const state = ctx.session_state || {};
  // PR-23s4b — read primary_mode first (with router_phase fallback).
  const modeRead = readModeState(state);
  const isElicitationContext = modeRead.primary_mode === ACTIVE_MODES.ELICITATION
    || ['elicitation', 'top1_determination'].includes(state.router_phase);
  const valuesCount = Array.isArray(state.values_collected_list) ? state.values_collected_list.length : 0;
  const triggered = valuesCount >= 3
    && state.top1_value == null
    && isElicitationContext;

  if (!triggered) return { handled: false };

  return {
    handled: true,
    inject: top1Judge.prompt_content,
    patch: {
      // PR-23s4b: dual-write router_phase + primary_mode 不變 (still elicitation
      // until top1_value 確定後 mode-transition-router 切到 identity_anchoring).
      router_phase: 'top1_determination',   // deprecated mirror
    },
  };
}

// ─────────────────────────────────────────────────────────
// E3 mode_transition_router (priority 50、接管 transition 判定 + emit log)
// 前身 e3StatusRouterHandler. PR-23s4b 廢除 4-quality_status routing, 改 mode transition.
// ─────────────────────────────────────────────────────────

export async function e3ModeTransitionHandler(ctx) {
  const state = ctx.session_state || {};
  const text = ctx.user_response || '';
  const modeRead = readModeState(state);

  // Only fires when in a mode that mode-transition-router governs.
  const governedModes = [
    ACTIVE_MODES.IDENTITY_ANCHORING,
    ACTIVE_MODES.CASCADE,
    ACTIVE_MODES.INTEGRATION,
  ];
  if (!governedModes.includes(modeRead.primary_mode)) {
    return { handled: false };
  }

  // Determine transition target per PR-23s4b spec rules.
  let nextPrimary = null;
  let triggerType = TRIGGER_TYPES.MODE_NATURAL_PROGRESSION;
  let triggerDetail = null;
  let extraPatch = {};

  if (modeRead.primary_mode === ACTIVE_MODES.IDENTITY_ANCHORING) {
    const status = state.current_quality_status;
    if (status === 'owned') {
      // Has Top 2/3 待測 → cascade. 沒有 → future_pacing (cascade 不需要).
      const hasMoreToCascade = Array.isArray(state.values_ranking)
        && state.values_ranking.length > 1;
      nextPrimary = hasMoreToCascade ? ACTIVE_MODES.CASCADE : ACTIVE_MODES.FUTURE_PACING;
      triggerDetail = `owned + ${hasMoreToCascade ? 'has_top2_3' : 'no_more_values'}`;
    } else if (status === 'ambiguous' || status === 'owned_was') {
      nextPrimary = ACTIVE_MODES.INTEGRATION;
      triggerDetail = status;
    } else if (status === 'owned_via_acceptance') {
      // PR-23s4b: 暫住此處 (原 transitions/phase-3b-to-4-acceptance.js).
      //   PR-23s4c integration-router 接管後本分支搬走、本檔僅留 emit log.
      nextPrimary = ACTIVE_MODES.CASCADE;
      triggerType = TRIGGER_TYPES.LEARNER_SURFACED;
      triggerDetail = 'owned_via_acceptance';
      extraPatch.router_phase = 'cascade_down';   // deprecated mirror
    } else {
      // candidate / none / null → 不 transition.
      return { handled: false };
    }
  } else if (modeRead.primary_mode === ACTIVE_MODES.CASCADE) {
    const cascadeStatus = state.cascade_down_progress?.status;
    if (cascadeStatus === 'completed') {
      nextPrimary = ACTIVE_MODES.FUTURE_PACING;
      triggerType = TRIGGER_TYPES.NATURAL_COMPLETION;
      triggerDetail = 'cascade_completed';
    } else {
      return { handled: false };
    }
  } else if (modeRead.primary_mode === ACTIVE_MODES.INTEGRATION) {
    // TODO(PR-23s4c task 2) — integration-router 接管 toolbox exit 判定.
    return { handled: false };
  }

  if (!nextPrimary || nextPrimary === modeRead.primary_mode) {
    return { handled: false };
  }

  // Apply transition via mode-tracker + emit log via mode-transition-logger.
  const newModeState = transitionPrimary(modeRead, nextPrimary);
  const transitionEntry = buildTransitionEntry({
    from_active_modes: modeRead.active_modes,
    to_active_modes:   newModeState.active_modes,
    from_primary:      modeRead.primary_mode,
    to_primary:        newModeState.primary_mode,
    trigger_type:      triggerType,
    trigger_detail:    triggerDetail,
    turn_count:        typeof state.turn_count_this_session === 'number'
                         ? state.turn_count_this_session : 0,
  });
  const logPatch = appendTransitionPatch(state, transitionEntry);

  return {
    handled: true,
    inject: modeTransitionRouter.prompt_content,
    patch: {
      primary_mode: newModeState.primary_mode,
      active_modes: newModeState.active_modes,
      paused_modes: newModeState.paused_modes,
      ...logPatch,
      ...extraPatch,
    },
  };
}

// ─────────────────────────────────────────────────────────
// E3 integration_router (priority 45、mode-gated inject)
// PR-23s4c task 2 — fires when primary_mode === 'integration'.
// Inject content describes toolbox + exit framing; mode-transition-router
// still handles the actual primary_mode change. Owned_via_acceptance framing
// is in this inject's prompt_content (per Vivi 6/4「搬家」 spec).
// ─────────────────────────────────────────────────────────

export async function e3IntegrationRouterHandler(ctx) {
  const state = ctx.session_state || {};
  const modeRead = readModeState(state);
  if (modeRead.primary_mode !== ACTIVE_MODES.INTEGRATION) return { handled: false };
  return {
    handled: true,
    inject: integrationRouter.prompt_content,
    patch: {},   // toolbox dispatch is LLM-driven via prompt; no state change here.
  };
}

// ─────────────────────────────────────────────────────────
// E3 cascade_mode_validator (priority 60、state-check + inject)
// 前身 e3CascadeDownHandler. PR-23s4b 改名 + primary_mode 讀取.
// ─────────────────────────────────────────────────────────

export async function e3CascadeModeHandler(ctx) {
  const state = ctx.session_state || {};
  const modeRead = readModeState(state);
  // PR-23s4b: primary_mode === cascade (with router_phase fallback already
  // applied by readModeState).
  if (modeRead.primary_mode !== ACTIVE_MODES.CASCADE
      && state.router_phase !== 'cascade_down') {
    return { handled: false };
  }

  // ⭐ v5.1 Step 5b — dim 4 alignment for Top 2/3 evidence (Vivi 6/4 spec).
  //   When cascade_down_progress.status === 'testing', run A1 judge on the response
  //   (same judge engine-2 uses). dim_4=true → append R2 reframe inject (Top 2/3
  //   evidence is strategy not quality). fail-open: judge timeout/missing → skip.
  let dim4Inject = '';
  let patch = {};
  const cd = state.cascade_down_progress;
  const isTesting = cd && cd.status === 'testing';
  const isIdentityTestQuestion = /你是一個.*的人嗎/.test(state.last_ai_question || '');
  if (isTesting && isIdentityTestQuestion && ctx.user_response) {
    try {
      const judgeFn = ctx.judges?.sensoryDetail || sensoryDetailJudge;
      const judgment = await judgeFn({
        user_response: ctx.user_response,
        prior_question: state.last_ai_question || '(cascade identity test)',
        value_being_tested: cd.value || '(Top 2/3 quality)',
      });
      if (judgment && judgment.dim_4 === true) {
        dim4Inject = `\n\n---\n\n${R2_STRATEGY_REFRAME_INJECT}`;
        patch.cascade_dim_4_triggered_this_turn = true;
        // 6/12 — R2_STRATEGY_REFRAME_INJECT bakes R2 body. Record R2.
        Object.assign(patch, buildInvocationPatch({ reframe_id: 'R2', state, ctx }));
      }
    } catch (e) {
      if (e instanceof JudgeTimeoutError || e instanceof JudgeSchemaError) {
        ctx.logMiss?.({ miss_type: 'judge_timeout', detector: 'E3_cascade_dim_4', error: e.message });
      } else {
        throw e;
      }
    }
  }

  return {
    handled: true,
    inject: cascadeModeValidator.prompt_content + dim4Inject,
    patch,
  };
}

// ─────────────────────────────────────────────────────────
// E3 future_pacing_router (priority 65、mode-gated inject)
// PR-23s4c task 2 — fires when primary_mode === 'future_pacing'.
// 3 時間維度 → Let it Go → Export trigger framing. mode-transition-router
// handles actual exit to program_completed / integration_retention.
// ─────────────────────────────────────────────────────────

export async function e3FuturePacingRouterHandler(ctx) {
  const state = ctx.session_state || {};
  const modeRead = readModeState(state);
  if (modeRead.primary_mode !== ACTIVE_MODES.FUTURE_PACING) return { handled: false };
  return {
    handled: true,
    inject: futurePacingRouter.prompt_content,
    patch: {},
  };
}

// detector definitions (PR-23s4b: id + handler 換新名; PR-23s4c: +integration + future_pacing)
export const E3_DETECTORS = Object.freeze([
  { id: deepSignalDetector.id,     type: deepSignalDetector.type,     trigger_event: 'user_turn', priority: deepSignalDetector.priority,     handler: e3DeepSignalHandler },
  { id: elicitationRouter.id,      type: elicitationRouter.type,      trigger_event: 'user_turn', priority: elicitationRouter.priority,      handler: e3ElicitationRouterHandler },
  { id: top1Judge.id,              type: top1Judge.type,              trigger_event: 'user_turn', priority: top1Judge.priority,              handler: e3Top1JudgeHandler },
  { id: integrationRouter.id,      type: integrationRouter.type,      trigger_event: 'user_turn', priority: integrationRouter.priority,      handler: e3IntegrationRouterHandler },   // PR-23s4c
  { id: modeTransitionRouter.id,   type: modeTransitionRouter.type,   trigger_event: 'user_turn', priority: modeTransitionRouter.priority,   handler: e3ModeTransitionHandler },
  { id: cascadeModeValidator.id,   type: cascadeModeValidator.type,   trigger_event: 'user_turn', priority: cascadeModeValidator.priority,   handler: e3CascadeModeHandler },
  { id: futurePacingRouter.id,     type: futurePacingRouter.type,     trigger_event: 'user_turn', priority: futurePacingRouter.priority,     handler: e3FuturePacingRouterHandler },  // PR-23s4c
]);
