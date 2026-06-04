// lib/state/handoff-escalation.js
// A3 handoff_escalation 機制（Engine 1 §A3）
//
// 設計：state mechanics only — 不含具體 prompt template。
//   - 6 個觸發 source 各自的 two_choice 文案在 P2 conditional/ inject 段落
//   - 本模組只提供：count++ / HITL alert threshold / branch enum / patch builder
//
// session_state 欄位（migration 014 已有）：
//   - handoff_triggered_count: int
//
// 連續累積 2 次 → HITL alert（per Engine 1 §A3 + §6.10 失敗訊號）

// ─────────────────────────────────────────────────────────
// constants
// ─────────────────────────────────────────────────────────

export const HITL_ALERT_THRESHOLD = 2;

// ⭐ §3 patch 6/4 (safety patch #23) — Passive Death Wish 累積閾值.
//   cross-session count from user_profile_evolution.passive_death_wish_count.
//   E3 deep-signal handler 用這兩個 threshold 切變體 C-1/C-2 (count < 3) →
//   C-3 移除三選一 (c) (count >= 3) → C-4 freeze AI + HITL (count >= 5).
export const PASSIVE_DW_ESCALATE_THRESHOLD = 3;
export const PASSIVE_DW_FREEZE_THRESHOLD   = 5;

/**
 * 跨引擎合法 trigger source 統一 enum（spec engine 1+3+4 累積）。
 * Dashboard / debug 用、本模組不持久化來源、由 caller log 到 prompt_engineering_misses 表。
 */
export const HANDOFF_TRIGGER_SOURCES = Object.freeze({
  E1c_requires_typing_failed:    'E1c_requires_typing_failed',    // A1 2 次 fail
  E1d_bypassing_layer_maxed:     'E1d_bypassing_layer_maxed',     // E1d progress >= 6
  E1a_offtopic_persistent:       'E1a_offtopic_persistent',       // consecutive_offtopic >= 3
  E3_deep_signal:                'E3_deep_signal',                // 深創傷訊號
  E3_opening_branch_refused:     'E3_opening_branch_refused',     // 學員拒絕 reframe
  E3_top1_linear_thinking_stuck: 'E3_top1_linear_thinking_stuck', // Linear Error 2 次無進展
  E4_day_opening_refused:        'E4_day_opening_refused',        // 學員拒絕跨 day 引用
  // ⭐ §3 patch 6/4 (safety patch #23) — 4 個 passive DW 子 source.
  E3_passive_dw_strong:          'E3_passive_dw_strong',          // C-1 強訊號 SI confirm
  E3_passive_dw_implicit:        'E3_passive_dw_implicit',        // C-2 隱性訊號 + 支持訊號
  E3_passive_dw_repeat:          'E3_passive_dw_repeat',          // C-3 累積 >= 3
  E3_passive_dw_freeze:          'E3_passive_dw_freeze',          // C-4 累積 >= 5, freeze
});

/**
 * Post-handoff 三分支（學員選擇後的後續走向）。
 * 實際 state mutation 主要由 chat.js (P2) 處理；本模組只暴露 enum 統一語彙。
 */
export const POST_HANDOFF_BRANCHES = Object.freeze({
  REDIRECT: 'redirect', // 學員 chooses (a) — AI 接受新方向、不追問
  PAUSE:    'pause',    // 學員 chooses (b) — 引導 takeaway 收尾、不強推
  SILENT:   'silent',   // 學員 silent / evades — 低強度收尾、保留體面結束
});

// ─────────────────────────────────────────────────────────
// decision functions
// ─────────────────────────────────────────────────────────

export function incrementHandoffCount(currentCount) {
  const n = typeof currentCount === 'number' ? currentCount : 0;
  return n + 1;
}

/**
 * 累積 handoff_triggered_count >= 2 → 觸發 HITL alert（Engine 1 §A3 side_effects）。
 *
 * @param {number} count
 * @returns {boolean}
 */
export function shouldAlertHITL(count) {
  return typeof count === 'number' && count >= HITL_ALERT_THRESHOLD;
}

/**
 * @param {string} source
 * @returns {boolean}
 */
export function isValidTriggerSource(source) {
  return Object.prototype.hasOwnProperty.call(HANDOFF_TRIGGER_SOURCES, source)
    || Object.values(HANDOFF_TRIGGER_SOURCES).includes(source);
}

/**
 * @param {string} branch
 * @returns {boolean}
 */
export function isValidPostHandoffBranch(branch) {
  return Object.values(POST_HANDOFF_BRANCHES).includes(branch);
}

// ─────────────────────────────────────────────────────────
// patch builders (caller applies via state-manager.updateState)
// ─────────────────────────────────────────────────────────

/**
 * Patch to apply when a handoff is triggered.
 * Caller passes currentCount (read from session_state.handoff_triggered_count).
 *
 * @param {number} currentCount
 * @returns {{ handoff_triggered_count: number }}
 */
export function patchForHandoff(currentCount) {
  return { handoff_triggered_count: incrementHandoffCount(currentCount) };
}

/**
 * Convenience: full evaluation given current count + source.
 * Returns the next state + whether HITL should be alerted.
 *
 * @param {object} inputs
 * @param {number} inputs.currentCount - current session_state.handoff_triggered_count
 * @param {string} inputs.source - one of HANDOFF_TRIGGER_SOURCES values
 * @returns {{ patch: object, hitl_alert: boolean, new_count: number }}
 */
export function evaluateHandoff({ currentCount = 0, source }) {
  if (!isValidTriggerSource(source)) {
    throw new TypeError(`evaluateHandoff: unknown trigger source "${source}"`);
  }
  const new_count = incrementHandoffCount(currentCount);
  return {
    patch: { handoff_triggered_count: new_count },
    hitl_alert: shouldAlertHITL(new_count),
    new_count,
  };
}

// ─────────────────────────────────────────────────────────
// ⭐ §3 patch 6/4 (safety patch #23) — Passive DW variant selector.
// ─────────────────────────────────────────────────────────

/**
 * 給 E3 deep-signal handler 用 — 由 (a) 偵測訊號類型 + (b) 跨 session count
 * 決定要走 C-1/C-2/C-3/C-4 哪個 variant. count 由 user_profile_evolution.
 * passive_death_wish_count 取得 (handler 已 +1 之後的 NEW count).
 *
 * Rules:
 *   newCount >= PASSIVE_DW_FREEZE_THRESHOLD (5)   → 'freeze' (C-4, HITL alert)
 *   newCount >= PASSIVE_DW_ESCALATE_THRESHOLD (3) → 'repeat' (C-3, 移除 c 選項)
 *   signal === 'strong'                            → 'strong' (C-1, SI confirm)
 *   signal === 'implicit'                          → 'implicit' (C-2, 問字面 vs 感受)
 *
 * @param {{ signal:'strong'|'implicit', newCount:number }} args
 * @returns {'strong'|'implicit'|'repeat'|'freeze'}
 */
export function selectPassiveDWVariant({ signal, newCount = 0 }) {
  if (signal !== 'strong' && signal !== 'implicit') {
    throw new TypeError(`selectPassiveDWVariant: signal must be 'strong' or 'implicit', got "${signal}"`);
  }
  if (typeof newCount !== 'number' || !Number.isFinite(newCount) || newCount < 0) {
    throw new TypeError(`selectPassiveDWVariant: newCount must be non-negative number, got ${newCount}`);
  }
  // Threshold checks run highest-first.
  if (newCount >= PASSIVE_DW_FREEZE_THRESHOLD)   return 'freeze';
  if (newCount >= PASSIVE_DW_ESCALATE_THRESHOLD) return 'repeat';
  return signal;
}

/**
 * Map variant name → HANDOFF_TRIGGER_SOURCES enum value (for logging /
 * prompt_engineering_misses table).
 *
 * @param {'strong'|'implicit'|'repeat'|'freeze'} variant
 * @returns {string}
 */
export function passiveDWVariantToTriggerSource(variant) {
  switch (variant) {
    case 'strong':   return HANDOFF_TRIGGER_SOURCES.E3_passive_dw_strong;
    case 'implicit': return HANDOFF_TRIGGER_SOURCES.E3_passive_dw_implicit;
    case 'repeat':   return HANDOFF_TRIGGER_SOURCES.E3_passive_dw_repeat;
    case 'freeze':   return HANDOFF_TRIGGER_SOURCES.E3_passive_dw_freeze;
    default:
      throw new TypeError(`passiveDWVariantToTriggerSource: unknown variant "${variant}"`);
  }
}
