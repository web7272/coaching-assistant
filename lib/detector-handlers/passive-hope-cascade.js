// lib/detector-handlers/passive-hope-cascade.js
// PR-23s4c task 4 — Passive hope cascade handler.
// 對齊 v51_engine_3_errata_v02.md task 4: A006 case 「passive_hope_signals_detected」
// 偵測 + cascade 到 deep_signal_detector (crisis mode).
//
// Source:
//   ✅ Step 5a (PR-Step-5a) — switched to engine-1 S2 detector (proper context filter
//     + intensity + death_adjacent flag). Inline PASSIVE_IMPLICIT_REGEX path retired.
//   passive-hope-cascade runs at priority 25 AFTER engine-1 at priority 10 — but each
//   handler reads its own ctx.user_response (handlers don't share intermediate
//   patches mid-dispatch). So we call s2.detect directly here for fresh same-turn
//   detection. Dedup vs deep-signal-detector still via deep_signal_flags.passive_dw_detected.
//
// 邏輯 (per spec):
//   Step 1 context 評估:
//     hope context 含「活下去 / 死亡 / 結束生命 / 此生 / 留戀 / 動力」
//     → passive DW 隱性候選, 進 Step 2
//     否則維持一般 passive_hope, 不升級.
//   Step 2 累積:
//     同 session 已有其他 deep_signal 訊號 → 觸發
//     無 → 標 activity_death_adjacent=true, 同 session 累積 >= 2 → 觸發
//     cross-session passive_death_wish_count >= 3 → 觸發
//   Step 3:
//     觸發 → cascade E3_deep_signal_detector (detected=true, count+1, crisis mode)
//     未觸發 → return false.
//
// 重要 (per spec):
//   不可與 Patch 23 既有偵測重複計數 (同 turn 同訊號只 count 一次).
//   This handler runs BEFORE deep-signal-detector? No — must run AFTER per
//   `handled: false` semantics. Actually: this handler returns a patch that
//   triggers crisis cascade via primary_mode change + signals, but doesn't
//   itself bump passive_death_wish_count. The deep-signal handler will see
//   the cascade signal next turn (if needed) OR we set the count++ here.
//   We avoid double-count by checking deep_signal_flags.passive_dw_detected:
//     if true this turn → deep-signal-detector已 counted, we skip.

import {
  ACTIVE_MODES, triggerCrisis, readModeState,
} from '../session/mode-tracker.js';
import {
  TRIGGER_TYPES, buildTransitionEntry, appendTransitionPatch,
} from '../session/mode-transition-logger.js';
// ✅ Step 5a — engine-1 S2 detector is the canonical passive_hope source.
import * as s2 from './engine-1-signals/s2-passive-hope.js';

// PASSIVE_HOPE_SOURCE switch (Step 5a complete) — calls engine-1 S2 detector
// with proper context filter + death-adjacent classification.
function detectPassiveHopeWithS2(text, sessionState, prevTurns) {
  const res = s2.detect(text, sessionState, prevTurns);
  return {
    hit: !!res.hit,
    death_adjacent: !!res.death_adjacent,
    intensity: res.intensity || null,
    groups_matched: res.groups_matched || [],
  };
}

/**
 * Passive Hope Cascade handler.
 *
 * @param {object} ctx - { session_state, user_response, user_profile, last_3_turns, judges, logMiss }
 * @returns {Promise<{handled:boolean, inject?:string, patch?:object, user_profile_increments?:object}>}
 */
export async function passiveHopeCascadeHandler(ctx) {
  const state = ctx.session_state || {};
  const text = ctx.user_response || '';

  // Avoid double-count: if deep-signal-detector already detected passive DW this
  // turn (its handler runs earlier in cascade), our cascade is redundant.
  if (state.deep_signal_flags?.passive_dw_detected === true) {
    return { handled: false };
  }

  // Step 1: passive hope detection via engine-1 S2 detector (✅ Step 5a switch).
  //   S2 already applies context filter + classifies death_adjacent.
  const prevTurns = Array.isArray(ctx.last_3_turns) ? ctx.last_3_turns : [];
  const s2Result = detectPassiveHopeWithS2(text, state, prevTurns);
  if (!s2Result.hit) return { handled: false };

  // Step 1b: hope context — S2's death_adjacent flag is the canonical signal
  //   (含「活下去 / 死亡 / 結束生命 / 此生 / 留戀」 per _base.js DEATH_ADJACENT_REGEX).
  //   Per spec: 「否則維持一般 passive_hope、不升級」 — non-death-adjacent stays
  //   handled by engine-1 master (S2_LIGHT_INJECT).
  if (!s2Result.death_adjacent) {
    return { handled: false };
  }

  // Step 2: accumulation check.
  // 2a: any other deep_signal this session → trigger immediately.
  const otherDeepSignal = !!(state.deep_signal_flags?.trauma_marker_detected
    || state.deep_signal_flags?.worth_fiction_detected
    || (state.deep_signal_flags?.depth_judgment_score >= 2));
  // 2b: cross-session passive_death_wish_count >= 3 → trigger.
  const crossSessionCount = Number(ctx.user_profile?.passive_death_wish_count ?? 0);
  const crossSessionTrigger = crossSessionCount >= 3;
  // 2c: same-session activity_death_adjacent累積 >= 2 → trigger.
  const adjacentCountSoFar = Number(state.activity_death_adjacent_count ?? 0);
  // (We'd ++ this on this fire even if not triggering, so we get to 2 on subsequent fires.)
  const sameSessionTrigger = adjacentCountSoFar >= 1;   // this is the 2nd → 2 reached

  const triggered = otherDeepSignal || crossSessionTrigger || sameSessionTrigger;

  if (!triggered) {
    // Mark activity_death_adjacent + increment counter, but don't cascade.
    return {
      handled: true,
      // Light inject acknowledges the signal without escalating to crisis.
      inject: `[SYSTEM INJECT — Passive Hope Adjacent (no escalation yet)]
本 turn 偵測到 passive hope 訊號 + life-context 共現, 但尚未滿足 cascade 條件
(無 other deep_signal / cross-session count < 3 / same-session adjacent < 2).
標記 activity_death_adjacent=true, 累積追蹤. AI 應該:
- 不繼續挖 values; temperature 略低; 同類詞不追問.
- 簡短承認 + 引導當下小場景 (對齊 elicitation router 起手分流溫和路徑).`,
      patch: {
        activity_death_adjacent: true,
        activity_death_adjacent_count: adjacentCountSoFar + 1,
      },
    };
  }

  // Step 3: cascade triggered → trigger crisis mode + emit transition log.
  // Don't bump passive_death_wish_count here (deep-signal handler did/will own
  // that count when fired directly). We DO trigger crisis primary_mode +
  // mark a structural flag so deep-signal sees the cascade signal.
  const modeRead = readModeState(state);
  const newModeState = triggerCrisis(modeRead);
  const turnCount = typeof state.turn_count_this_session === 'number'
    ? state.turn_count_this_session : 0;
  const transitionEntry = buildTransitionEntry({
    from_active_modes: modeRead.active_modes,
    to_active_modes:   newModeState.active_modes,
    from_primary:      modeRead.primary_mode,
    to_primary:        newModeState.primary_mode,
    trigger_type:      TRIGGER_TYPES.SIGNAL_CASCADE,
    trigger_detail:    JSON.stringify({
      source: 'passive_hope_cascade',
      reasons: {
        other_deep_signal: otherDeepSignal,
        cross_session_dw_ge_3: crossSessionTrigger,
        same_session_adjacent_ge_2: sameSessionTrigger,
      },
    }),
    turn_count: turnCount,
  });
  const logPatch = appendTransitionPatch(state, transitionEntry);

  console.info('[passive-hope-cascade][triggered]', JSON.stringify({
    event: 'passive_hope_cascade_triggered',
    other_deep_signal: otherDeepSignal,
    cross_session_count: crossSessionCount,
    same_session_adjacent: adjacentCountSoFar,
  }));

  return {
    handled: true,
    // Cascade trigger ack inject — deep-signal-detector picks up via state next turn.
    inject: `[SYSTEM INJECT — Passive Hope Cascade Triggered]
Passive hope + life-context 訊號滿足 cascade 條件
(other_deep_signal=${otherDeepSignal} OR cross_session_count>=3=${crossSessionTrigger}
 OR same_session_adjacent>=2=${sameSessionTrigger}).
本 turn 觸發 crisis mode cascade. 後續由 deep-signal-detector + crisis SOP (Step 6) 接管.
AI 立即停; 不繼續挖 values; 走 handoff_escalation 三選一 + 1925.`,
    patch: {
      ...newModeState && {
        primary_mode: newModeState.primary_mode,
        active_modes: newModeState.active_modes,
        paused_modes: newModeState.paused_modes,
      },
      ...logPatch,
      crisis_in_progress: true,
      activity_death_adjacent: true,
      activity_death_adjacent_count: adjacentCountSoFar + 1,
      // Signal flag for deep-signal-detector / dashboard.
      passive_hope_cascade_triggered_this_session: true,
    },
    // 不在此 ++ passive_death_wish_count (deep-signal handler 同 turn 偵測會 ++,
    // 避免 double-count per spec 「同 turn 同訊號只 count 一次」).
  };
}

// Detector definition (lifecycle = user_turn, fires AFTER deep-signal-detector
// so the dedup guard works. Priority 25 = between deep_signal 20 and
// elicitation_router 30).
export const PASSIVE_HOPE_CASCADE_DETECTOR = Object.freeze({
  id: 'E3_passive_hope_cascade',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  priority: 25,
  handler: passiveHopeCascadeHandler,
});
