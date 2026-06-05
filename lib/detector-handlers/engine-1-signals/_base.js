// lib/detector-handlers/engine-1-signals/_base.js
// v5.1 Step 5a (Vivi 6/4) — Shared scaffolding for engine 1's 5 new signal detectors.
// 對齊 v51_engine_1_errata.md §A1 + §A4.
//
// 設計:
//   - 每個 signal (S1-S5) 一檔, 各自 export detect(text, sessionState, prevTurns).
//   - regex groups + context filter + intensity classifier + score delta.
//   - 純函式; 無 DB I/O. caller (engine-1.js handler) drains + persists.

export const SIGNAL_NAMES = Object.freeze([
  'external_locus',
  'passive_hope',
  'frequency_illusion',
  'conditional_worth',
  'negative_generalization',
  'modal_operator',   // ⭐ Step 7 PR-7b — S6 應該/必須/一定要 (External Locus 弱訊號 marker).
]);

export const INTENSITY = Object.freeze({
  WEAK:   'weak',
  MEDIUM: 'medium',
  STRONG: 'strong',
});

// Score deltas per intensity (per v51_engine_1_errata.md §A4).
// frequency_illusion / conditional_worth / negative_generalization = flat +2 per hit
// (no intensity gradient in spec).
export const SCORE_DELTAS = Object.freeze({
  external_locus: { weak: 1, medium: 3, strong: 5 },
  // S2 — strong_death_adjacent triggers immediate cascade (handled separately,
  // not via score). The "+10" in spec is a notional weight for ordering.
  passive_hope:   { weak: 1, medium: 3, strong_death_adjacent: 10 },
  frequency_illusion:       { every_hit: 2 },
  conditional_worth:        { every_hit: 2 },
  negative_generalization:  { every_hit: 2 },
  // S6 — modal_operator: weak/medium/strong gradient per spec §5.3.
  //   weak = single group, medium = multi-group, strong = medium + ppl >= 0.5.
  modal_operator:           { weak: 1, medium: 2, strong: 4 },
});

// Thresholds per v51 spec §A4.
//   *_session_*: per-session count threshold → priority/HITL flag for THIS session.
//   *_cumulative_*: cross-session count threshold → flag persisted forward.
export const THRESHOLDS = Object.freeze({
  external_locus: {
    session_r1_priority:    10,   // session count >= 10 → R1 強制 priority flag
    cumulative_hitl_alert:  20,   // cross-session >= 20 → HITL alert
  },
  passive_hope: {
    cumulative_e3_evaluate: 15,   // cross-session >= 15 → 引擎 3 評估 flag
    // death-adjacent immediate cascade NOT threshold-gated (any hit cascades).
  },
  frequency_illusion: {
    session_r7_priority:    8,    // session >= 8 → R7 強制 priority flag
  },
  conditional_worth: {
    cumulative_bargain:     10,   // cross-session >= 10 → Bargain pattern flag, HITL note
  },
  negative_generalization: {
    session_integration_deeper: 6,   // session >= 6 → integration 深入 flag
    cumulative_hitl_alert:      12,  // cross-session >= 12 → HITL alert
  },
  // ⭐ Step 7 PR-7b — S6 modal_operator cross-session threshold (errata v0.2 §5.3).
  //   migration 028: modal_operator_signals_count_cumulative INT NOT NULL DEFAULT 0.
  modal_operator: {
    cumulative_e3_external_locus_pattern: 5,   // cross-session >= 5 → 引擎 3 評估 External Locus 確立
  },
});

// ─────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────

/**
 * Test text against an object of regex groups, return list of group names hit.
 *
 * @param {Object<string, RegExp>} groups
 * @param {string} text
 * @returns {string[]} group names hit (subset of Object.keys(groups))
 */
export function matchGroups(groups, text) {
  if (typeof text !== 'string' || text.length === 0) return [];
  const out = [];
  for (const [name, re] of Object.entries(groups)) {
    if (re instanceof RegExp && re.test(text)) out.push(name);
  }
  return out;
}

/**
 * Defensive intensity rules per spec:
 *   weak   = single regex group matched
 *   medium = multiple regex groups matched OR same sentence multi-group
 *   strong = medium + PPL emotional density high (cumulative_ppl_score >= 0.5)
 *
 * Used by S1 / S2. Other signals use flat scoring.
 *
 * @param {string[]} groupHits
 * @param {object} sessionState
 * @returns {'weak'|'medium'|'strong'}
 */
export function classifyIntensity(groupHits, sessionState = {}) {
  const ppl = Number(sessionState?.cumulative_ppl_score ?? 0);
  if (!Array.isArray(groupHits) || groupHits.length === 0) return INTENSITY.WEAK;
  if (groupHits.length >= 2) {
    return ppl >= 0.5 ? INTENSITY.STRONG : INTENSITY.MEDIUM;
  }
  return INTENSITY.WEAK;
}

/**
 * Self-context check (used by S1/S2/S3/S4 context filters).
 * "I / me / myself" presence in text or recent turns.
 */
export const SELF_CONTEXT_REGEX = /(我|自己|我的|我會|我是)/;

/**
 * Fact-indicator regex — used to exclude objective descriptions (S1/S3/S4).
 * 「統計 / 數據 / 報告 / 事實是 / 根據」 are markers that the speaker is
 * describing OBSERVED facts, not self-projecting.
 */
export const FACT_INDICATOR_REGEX = /(統計|數據|報告|事實是|根據|新聞|報導)/;

/**
 * Hope / death / life context regex — used by S2 to detect cascade-vs-light path.
 *   Death-adjacent: 「活下去 / 死亡 / 結束生命 / 此生 / 留戀」
 *   → cascade to passive-hope-cascade.js (引擎 3).
 *   Non-death hope context → light inject「你在等什麼?」 (引擎 1).
 */
export const DEATH_ADJACENT_REGEX = /(活下去|死亡|結束.{0,3}生命|此生|留戀|不想活|想死|快點走)/;

/**
 * Self-eval / emotion-value context — used by S1 context filter.
 * 「覺得 / 感覺 / 不該 / 應該 / 值不值 / 配不配」 etc.
 */
export const EMOTION_VALUE_REGEX = /(覺得|感覺|傷心|痛|難過|生氣|害怕|不安|想要|希望|不該|應該|配|值)/;

/**
 * Quality / status / identity context — used by S3 context filter.
 * 「身份 / 算不算 / 真正的 / 是不是」 + quality terms.
 */
export const QUALITY_STATUS_REGEX = /(身份|算不算|是不是|真的|真正的|夠|平靜|自由|愛|勇敢|善良|安全|穩|誠實)/;

/**
 * Self-worth context — used by S4 context filter.
 * 「配 / 值 / 我這個人 / 我這樣 / 不夠」.
 */
export const SELF_WORTH_REGEX = /(配|值|我這個人|我這樣|不夠|沒價值|沒用|不被愛)/;

/**
 * Build a structured log payload — used by all detectors to surface what hit
 * so Vivi can compute false-positive rate during Beta校準.
 * 鐵律 #2 諮商保密: do NOT log raw student text.
 *
 * @param {object} args
 * @returns {object} safe-log payload
 */
export function buildSignalLog({
  signal, intensity, groups_matched, context_filter_blocked, score_delta,
}) {
  return {
    event: 'engine1_signal_detected',
    signal,
    intensity: intensity || null,
    groups_matched: Array.isArray(groups_matched) ? groups_matched : [],
    context_filter_blocked: !!context_filter_blocked,
    score_delta: typeof score_delta === 'number' ? score_delta : 0,
    // SAFE: do NOT include user_response or student_id (caller can add ctx_sid for telemetry only).
  };
}

/**
 * Get the column name for a signal's cumulative cross-session counter (matches
 * migration 026 schema).
 */
export function cumulativeColName(signal) {
  return `${signal}_signals_count_cumulative`;
}

/**
 * Get session_state key for per-session count.
 */
export function sessionCountKey(signal) {
  return `${signal}_count_this_session`;
}

/**
 * Get session_state key for per-turn detected flag.
 */
export function detectedFlagKey(signal) {
  return `${signal}_detected`;
}
