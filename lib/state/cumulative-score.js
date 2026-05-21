// lib/state/cumulative-score.js
// A2 通用累積分數模板（Engine 1 §A2）
//
// 設計：factory pattern
//   - createCumulativeScore({...}) 產生一個 score 定義（含 apply / applyDecay / checkAlert）
//   - PPL_SCORE 是第一個 instance（cumulative_ppl_score、Engine 1 E1c 用）
//   - 未來可 createCumulativeScore 新 instance（例：Engine 3 提到的 cumulative_resistance_score）
//     不重寫邏輯、不重寫 clamp / decay / alert threshold 比較。

// ─────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────

/**
 * @typedef {object} CumulativeScoreDef
 * @property {string} fieldName - session_state column / key 名（例：cumulative_ppl_score）
 * @property {number} initialValue - 0.0 通常
 * @property {[number, number]} range - [min, max]
 * @property {number} decayPerTurn - 無相關訊號時自然衰減（負數）
 * @property {Object<number, string>} alertThresholds - 數值 → label 對照
 * @property {(currentValue: number, delta: number) => number} apply - 套 delta + clamp
 * @property {(currentValue: number) => number} applyDecay - 套 decayPerTurn
 * @property {(value: number) => string | null} checkAlert - 回傳 highest threshold label or null
 */

/**
 * @param {object} opts
 * @param {string} opts.fieldName
 * @param {number} [opts.initialValue=0.0]
 * @param {[number, number]} [opts.range=[0.0, 1.0]]
 * @param {number} [opts.decayPerTurn=-0.05]
 * @param {Object<number|string, string>} [opts.alertThresholds={}]
 * @returns {CumulativeScoreDef}
 */
export function createCumulativeScore({
  fieldName,
  initialValue = 0.0,
  range = [0.0, 1.0],
  decayPerTurn = -0.05,
  alertThresholds = {},
} = {}) {
  if (typeof fieldName !== 'string' || !fieldName) {
    throw new TypeError('createCumulativeScore: fieldName (non-empty string) required');
  }
  if (!Array.isArray(range) || range.length !== 2
      || typeof range[0] !== 'number' || typeof range[1] !== 'number'
      || range[0] >= range[1]) {
    throw new TypeError('createCumulativeScore: range must be [min, max] with min < max');
  }
  if (typeof initialValue !== 'number'
      || initialValue < range[0] || initialValue > range[1]) {
    throw new TypeError(`createCumulativeScore: initialValue ${initialValue} outside range ${JSON.stringify(range)}`);
  }
  if (typeof decayPerTurn !== 'number') {
    throw new TypeError('createCumulativeScore: decayPerTurn must be number');
  }
  if (alertThresholds === null || typeof alertThresholds !== 'object' || Array.isArray(alertThresholds)) {
    throw new TypeError('createCumulativeScore: alertThresholds must be plain object');
  }

  // Pre-sort alert thresholds descending (numeric)
  const sortedAlerts = Object.entries(alertThresholds)
    .map(([k, v]) => [Number(k), v])
    .filter(([k]) => !Number.isNaN(k))
    .sort((a, b) => b[0] - a[0]);

  const [min, max] = range;

  function clamp(v) {
    if (v < min) return min;
    if (v > max) return max;
    return v;
  }

  return Object.freeze({
    fieldName,
    initialValue,
    range: Object.freeze([min, max]),
    decayPerTurn,
    alertThresholds: Object.freeze({ ...alertThresholds }),

    apply(currentValue, delta) {
      if (typeof currentValue !== 'number') currentValue = initialValue;
      if (typeof delta !== 'number') delta = 0;
      return clamp(currentValue + delta);
    },

    applyDecay(currentValue) {
      return this.apply(currentValue, decayPerTurn);
    },

    /**
     * Return the highest threshold label whose key <= value.
     * Returns null if value below all thresholds.
     */
    checkAlert(value) {
      if (typeof value !== 'number') return null;
      for (const [threshold, label] of sortedAlerts) {
        if (value >= threshold) return label;
      }
      return null;
    },
  });
}

// ─────────────────────────────────────────────────────────
// PPL_SCORE — first instance（Engine 1 §3.1 E1c）
// ─────────────────────────────────────────────────────────

export const PPL_SCORE = createCumulativeScore({
  fieldName: 'cumulative_ppl_score',
  initialValue: 0.0,
  range: [0.0, 1.0],
  decayPerTurn: -0.05,
  alertThresholds: {
    0.6: 'classifier_trigger',  // 進 E1_subtype_classifier 判 PPL 門檻
    0.8: 'force_inject',         // 強制 inject E1c sub-prompt、繞過 classifier
    1.0: 'hitl_alert',           // 方法論 6.10 失敗訊號 3、HITL alert
  },
});

// ─────────────────────────────────────────────────────────
// PPL 事件 delta 對照（Engine 1 §3.1 update_rule）
// ─────────────────────────────────────────────────────────

export const PPL_EVENT_DELTAS = Object.freeze({
  classifier_ppl_high:          +0.20,
  classifier_ppl_medium:        +0.10,
  explicit_protest_hit:         +0.30,
  consecutive_short_runs_3plus: +0.15,
  echo_overlap_high:            +0.10,
  level_exit_door3_fail:        +0.15,
});

/**
 * Sum the delta contributions from a list of PPL events.
 * Unknown event keys contribute 0 (forgiving — caller is responsible for typing).
 *
 * @param {string[]} events
 * @returns {number}
 */
export function computePplDeltaForEvents(events) {
  if (!Array.isArray(events)) return 0;
  let delta = 0;
  for (const e of events) {
    delta += PPL_EVENT_DELTAS[e] ?? 0;
  }
  return delta;
}
