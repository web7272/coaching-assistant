// lib/dashboard/visual-channel-tracker.js
// Dashboard 指標: visual_channel_self_surfaced_rate
// 對應 v5_errata_patch_phase_3a_3b_scope_overlap_default.md Patch 4
//
// 用途：
//   Phase 3a Step 1 + Phase 3b Step 1 期間、
//   學員自發 surface 視覺-身體 channel(畫面 / 顏色 / 溫度 / 身體位置 / 表情)的比率。
//   用於校準 (B) 傾向版 vs (C) 雙軌的 Beta 後決策。
//
// 設計：純函數模組、無 DB I/O。caller (chat.js, P2) 收集 per-session boolean、
//      finalize-day / dashboard 聚合計算 rate + 套 thresholds。

// ─────────────────────────────────────────────────────────
// regex: 學員回應內視覺-身體 channel markers
// ─────────────────────────────────────────────────────────

export const VISUAL_BODY_MARKER_REGEX = new RegExp(
  [
    // 視覺 channel
    '畫面', '看到', '看見', '顏色', '紅', '藍', '綠', '黃', '黑', '白',
    // 觸覺 / 溫度
    '溫度', '熱', '冷', '溫', '涼',
    // 身體部位
    '身體', '胸口', '胃', '喉嚨', '手', '腳', '肩膀', '背', '頭', '臉',
    // 表情 / 姿勢
    '表情', '姿勢',
    // 重量 / 質感
    '重', '沉', '輕', '緊', '鬆',
  ].join('|'),
);

/**
 * Detect whether a single user response surfaces visual-body channel.
 *
 * @param {string} text - user response text
 * @returns {boolean}
 */
export function detectVisualChannelMarkers(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  return VISUAL_BODY_MARKER_REGEX.test(text);
}

// ─────────────────────────────────────────────────────────
// Per-session aggregation
// ─────────────────────────────────────────────────────────

/**
 * Compute rate from session-level booleans.
 *
 * @param {boolean[]} sessionBooleans - per session: did learner surface visual-body channel?
 * @returns {number} rate in [0, 1]; returns 0 when sessions empty
 */
export function calculateRate(sessionBooleans) {
  if (!Array.isArray(sessionBooleans) || sessionBooleans.length === 0) return 0;
  const surfaced = sessionBooleans.filter(Boolean).length;
  return surfaced / sessionBooleans.length;
}

// ─────────────────────────────────────────────────────────
// Beta calibration thresholds + decisions (per errata Patch 4)
// ─────────────────────────────────────────────────────────

export const COHORT_MIN_FOR_UPGRADE = 50;

export const THRESHOLDS = Object.freeze({
  B_PATH_VALIDATED: 0.10,   // < 10% → (B) 傾向版完全足夠、不需要 (C) 雙軌
  B_BASELINE_MAX:   0.30,   // < 30% → (B) 傾向版 default 路徑命中、紅線 14 設計正確
  UPGRADE_TO_C:     0.30,   // >= 30% (cohort >= 50) → 評估升級 (C) 雙軌
});

export const DECISIONS = Object.freeze({
  B_PATH_VALIDATED:        'B_path_validated',         // (B) 簡化架構正確
  B_BASELINE:              'B_baseline',                // (B) default 命中、預期範圍
  CONSIDER_UPGRADE_TO_C:   'consider_upgrade_to_C',     // cohort >= 50、評估 (C) 雙軌
  EARLY_SIGNAL_HOLD:       'early_signal_hold',         // rate 偏高但 cohort < 50、不立即反應
  PHASE_PROBLEM:           'phase_problem',             // 兩條 channel 都無感、phase 結構問題
});

/**
 * Decide action category based on rate + cohort size + P10 rate.
 *
 * @param {object} inputs
 * @param {number} inputs.rate - visual_channel_self_surfaced_rate in [0, 1]
 * @param {number} inputs.cohortSize - number of sessions in cohort
 * @param {number} [inputs.p10Rate] - P10 (Scope Overlap default 無進展) rate; optional
 * @returns {string} one of DECISIONS values
 */
export function checkThreshold({ rate, cohortSize, p10Rate }) {
  if (typeof rate !== 'number' || rate < 0 || rate > 1) {
    throw new TypeError(`checkThreshold: rate must be number in [0, 1], got ${rate}`);
  }
  if (typeof cohortSize !== 'number' || cohortSize < 0 || !Number.isInteger(cohortSize)) {
    throw new TypeError(`checkThreshold: cohortSize must be non-negative integer, got ${cohortSize}`);
  }

  // Cross-signal: 兩 channel 都無感 → phase 結構問題（errata Patch 4 related_failure_modes）
  if (
    typeof p10Rate === 'number'
    && p10Rate > 0.15
    && rate < 0.20
  ) {
    return DECISIONS.PHASE_PROBLEM;
  }

  if (rate < THRESHOLDS.B_PATH_VALIDATED) {
    return DECISIONS.B_PATH_VALIDATED;
  }
  if (rate < THRESHOLDS.B_BASELINE_MAX) {
    return DECISIONS.B_BASELINE;
  }

  // rate >= 30%
  if (cohortSize < COHORT_MIN_FOR_UPGRADE) {
    return DECISIONS.EARLY_SIGNAL_HOLD;
  }
  return DECISIONS.CONSIDER_UPGRADE_TO_C;
}

// ─────────────────────────────────────────────────────────
// metadata for dashboard registration
// ─────────────────────────────────────────────────────────

export const METRIC_METADATA = Object.freeze({
  id: 'visual_channel_self_surfaced_rate',
  description: 'Phase 3a/3b Step 1 期間、學員自發 surface 視覺-身體 channel 的比率(per session boolean、跨 session aggregate)',
  formula: 'count(sessions where learner mentioned visual-body markers >= once) / count(total sessions)',
  measurement_method: '主 regex 偵測學員回應內視覺-身體詞彙、per session boolean、跨 session aggregate',
  beta_calibration: {
    target_baseline_for_B: '< 30%',
    upgrade_to_C_signal:   '>= 30%',
    B_path_validated:      '< 10%',
  },
  cohort_size_caveat: 'Beta cohort N 仍小、>= 30% 不立即升級 (C)、需 cohort >= 50 且持續觀察 2 週才考慮升級',
  errata_source: 'v5_errata_patch_phase_3a_3b_scope_overlap_default.md Patch 4',
});
