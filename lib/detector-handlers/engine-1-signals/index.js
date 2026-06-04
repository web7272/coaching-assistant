// lib/detector-handlers/engine-1-signals/index.js
// v5.1 Step 5a (Vivi 6/4) — Engine 1 signals aggregator.
//
// Runs all 5 signal detectors against a user turn + builds:
//   - per-turn flags + groups_matched (for inject routing / dashboard log)
//   - session_state patch (5 detected flags + 5 session counts + 5 inject hints
//                          for routing)
//   - user_profile_increments (5 cumulative cross-session counters, migration 026)
//   - safe log payloads (no student-raw-text per 鐵律 #2)

import {
  SIGNAL_NAMES, INTENSITY, THRESHOLDS, buildSignalLog,
  sessionCountKey, detectedFlagKey,
} from './_base.js';
import * as s1 from './s1-external-locus.js';
import * as s2 from './s2-passive-hope.js';
import * as s3 from './s3-frequency-illusion.js';
import * as s4 from './s4-conditional-worth.js';
import * as s5 from './s5-negative-generalization.js';

export const SIGNAL_DETECTORS = Object.freeze({
  external_locus:          s1,
  passive_hope:            s2,
  frequency_illusion:      s3,
  conditional_worth:       s4,
  negative_generalization: s5,
});

/**
 * Run all 5 signal detectors. Returns aggregated patch + increments + flags.
 *
 * @param {object} args
 * @param {string} args.text                 - user_response
 * @param {object} args.sessionState
 * @param {object} args.userProfile          - for cumulative counter reads
 * @param {string[]} args.prevTurns          - last 1-3 turns for context window
 * @returns {{
 *   patch: object,
 *   user_profile_increments: object,
 *   inject_hints: object,   // per-signal routing hints (see A3 spec)
 *   logs: object[],         // safe structured logs to emit
 * }}
 */
export function detectAllSignals({ text, sessionState = {}, userProfile = {}, prevTurns = [] }) {
  const patch = {};
  const user_profile_increments = {};
  const inject_hints = {};
  const logs = [];

  for (const [signal, detector] of Object.entries(SIGNAL_DETECTORS)) {
    const res = detector.detect(text, sessionState, prevTurns);
    if (!res.hit) {
      patch[detectedFlagKey(signal)] = false;
      continue;
    }
    // Per-turn flag.
    patch[detectedFlagKey(signal)] = true;
    // Per-session count: previous + 1.
    const sessKey = sessionCountKey(signal);
    const prevSessCount = Number(sessionState[sessKey] || 0);
    patch[sessKey] = prevSessCount + 1;
    // Cross-session counter: drained by chat.js → incrementUserProfileCounters.
    user_profile_increments[`${signal}_signals`] = 1;

    // Per-signal routing hints (read by engine-1.js master handler for inject decisions).
    inject_hints[signal] = {
      intensity: res.intensity || null,
      groups_matched: res.groups_matched || [],
      score_delta: res.score_delta || 0,
      death_adjacent: !!res.death_adjacent,                  // S2 only
      you_word_present: !!res.you_word_present,              // S5 only
    };

    // Threshold flags per session / cross-session — set in patch for routing+dashboard.
    const newSessCount = prevSessCount + 1;
    const newCumulative = Number(userProfile[`${signal}_signals_count_cumulative`] || 0) + 1;
    addThresholdFlags(signal, newSessCount, newCumulative, patch);

    // Safe structured log.
    logs.push(buildSignalLog({
      signal,
      intensity: res.intensity,
      groups_matched: res.groups_matched,
      context_filter_blocked: false,
      score_delta: res.score_delta,
    }));
  }

  return { patch, user_profile_increments, inject_hints, logs };
}

/**
 * Add per-signal threshold flags into the patch (per v51 §A4).
 */
function addThresholdFlags(signal, newSessCount, newCumulative, patch) {
  const T = THRESHOLDS[signal] || {};
  if (signal === 'external_locus') {
    if (newSessCount >= T.session_r1_priority)        patch.s1_r1_priority_flag = true;
    if (newCumulative >= T.cumulative_hitl_alert)      patch.s1_hitl_alert_flag = true;
  }
  if (signal === 'passive_hope') {
    if (newCumulative >= T.cumulative_e3_evaluate)     patch.s2_e3_evaluate_flag = true;
  }
  if (signal === 'frequency_illusion') {
    if (newSessCount >= T.session_r7_priority)         patch.s3_r7_priority_flag = true;
  }
  if (signal === 'conditional_worth') {
    if (newCumulative >= T.cumulative_bargain)         patch.s4_bargain_flag = true;
  }
  if (signal === 'negative_generalization') {
    if (newSessCount >= T.session_integration_deeper)  patch.s5_integration_deeper_flag = true;
    if (newCumulative >= T.cumulative_hitl_alert)      patch.s5_hitl_alert_flag = true;
  }
}

// ─── Inject content (ship-able per spec) ──────────────────

/**
 * S2 light path inject — when passive_hope WITHOUT death-adjacent context.
 * Spec gives the exact phrasing, ship as-is.
 */
export const S2_LIGHT_INJECT = `[SYSTEM INJECT — Passive Hope (light path, no cascade)]
偵測到 passive hope 訊號 (等老天 / 等對的人 / 存在性 hope), 但 context 沒有死亡類詞 —
不 cascade 引擎 3, 走輕量 inject.

話術 (spec §A3 內含):
> 「你在等什麼?那個希望、是讓你活著的、還是讓你不必行動的?」

機制:
- AI 不繼續挖 wishing 細節; temperature 略低.
- 學員回應 → 後續 turn 由 mode-transition-router 評估是否切 mode.`;

/**
 * S3 light path inject — frequency_illusion, single-line reframe pointer.
 * 對齊 §3 紅線 22 既有 pattern「『X』是身份、不是成績單」.
 */
export const S3_LIGHT_INJECT = `[SYSTEM INJECT — Frequency Illusion (interim, R7 待 Step 7)]
偵測到 frequency_illusion 訊號 (成績單 / 及格分數 / 頻率比較 / self-check).
TODO(Step 7): R7 Reframe Library 接管完整 reframe.
過渡: 主對話 LLM 引用 §3 紅線 22 既有 pattern「『X』是身份、不是成績單」一行提示.

話術:
> 「『[X]』是身份、不是成績單。身份不是頻率。」`;

/**
 * S4 weak path inject — conditional_worth (group_a 交易句式) → 紅線 23 phrasing.
 * 對齊 §3 紅線 23 既有 phrasing「這個交易是誰定的?」「沒有 X、Y 真的不能存在嗎?」.
 */
export const S4_WEAK_INJECT = `[SYSTEM INJECT — Conditional Worth (weak, 紅線 23 phrasing)]
偵測到 conditional_worth 訊號 weak intensity (group_a 交易句式).
對齊 §3 紅線 23 phrasing, ship-able 不依賴 Reframe Library.

話術 (spec §A3 內含):
> 「這個交易是誰定的?」
> 「沒有 X、Y 真的不能存在嗎?」

機制:
- AI 挑戰交易條件本身, 不接受結論.`;

/**
 * S5 light path inject — negative_generalization in integration mode.
 * Spec 給了全文「這個『又』、我想停下來。」
 */
export const S5_INTEGRATION_INJECT = `[SYSTEM INJECT — Negative Generalization (integration mode, ship-able)]
偵測到 negative_generalization 訊號 + primary_mode == integration.
Damon 特別點名「又」字為 negative generalization 關鍵 trigger.

話術 (spec §A3 內含):
> 「這個『又』、我想停下來。這個感覺、最早是什麼時候開始的?」

機制:
- 引導學員回到該感覺最早源頭 (Damon Scope 工具).
- 不在 integration mode 時, flag only, 不提早 invoke (per spec).`;
