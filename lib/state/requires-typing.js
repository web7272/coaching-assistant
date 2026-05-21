// lib/state/requires-typing.js
// A1 物理性 PPL 防護機制（Engine 1 §A1 + §4.6）
//
// 設計：pure decision functions、無 DB I/O。
//   - shouldTrigger / clearsRequirement / shouldHandoff
//   - patch builders 給 caller（chat.js, P2）apply 到 session_state via state-manager
//
// session_state 欄位（migration 014 已有）：
//   - requires_typing_active: bool
//
// failed-attempts 計數：spec 寫「最多 2 次、超過 cascade A3」但沒有 named field。
// PR-3b 採 stateless 風格 — caller 傳入 currentFailedAttempts、本模組計算決策、
// 實際持久化由 chat.js (P2) 決定（可選方案：放 session_state 新欄位 / 用
// short-lived in-memory turn-scoped）。

// 設計刻意不 import sensory-detail judge —
// 本模組只接受 judgment 結果（任何 shape 含 sensory_detail_score）、
// caller (chat.js, P2) 自己呼叫 judge、把結果餵進來。
// 這樣 state/ 跟 haiku-judge/ 之間沒有編譯期依賴。

// ─────────────────────────────────────────────────────────
// constants
// ─────────────────────────────────────────────────────────

export const MAX_FAILED_ATTEMPTS = 2;
export const PPL_FORCE_TRIGGER_THRESHOLD = 0.8;
export const CLEARANCE_SENSORY_DETAIL_MIN = 2;

// ─────────────────────────────────────────────────────────
// decision functions
// ─────────────────────────────────────────────────────────

/**
 * Should requires_typing_active be flipped to true this turn?
 * (Spec engine 1 §A1 trigger_conditions)
 *
 * @param {object} inputs
 * @param {boolean} [inputs.current_active=false]
 * @param {boolean} [inputs.short_compliance_after_e1c=false]
 *   true when previous turn was an E1c inject AND this turn's user response
 *   still matched short_compliance regex.
 * @param {number}  [inputs.cumulative_ppl_score=0]
 * @returns {boolean}
 */
export function shouldTrigger({
  current_active = false,
  short_compliance_after_e1c = false,
  cumulative_ppl_score = 0,
} = {}) {
  if (current_active) return false;
  if (short_compliance_after_e1c) return true;
  if (cumulative_ppl_score >= PPL_FORCE_TRIGGER_THRESHOLD) return true;
  return false;
}

/**
 * Does a sensory-detail judgment clear the requires_typing gate?
 *
 * Engine 1 §A1.judgment uses dim 1 only (`sensory_detail_score >= 2`).
 * NOT the spec 02 strict clearance (which also checks attribution + derived).
 * Different consumer; this is the A1-specific threshold.
 *
 * @param {object} judgment - sensory-detail judge output
 * @returns {boolean}
 */
export function clearsRequirement(judgment) {
  if (!judgment || typeof judgment !== 'object') return false;
  const s = judgment.sensory_detail_score;
  return typeof s === 'number' && s >= CLEARANCE_SENSORY_DETAIL_MIN;
}

/**
 * After this many failed attempts, cascade to A3 handoff_escalation.
 *
 * @param {number} failedAttempts - count of judgments that did NOT clear
 * @returns {boolean}
 */
export function shouldHandoff(failedAttempts) {
  return typeof failedAttempts === 'number' && failedAttempts >= MAX_FAILED_ATTEMPTS;
}

// ─────────────────────────────────────────────────────────
// patch builders (caller applies via state-manager.updateState)
// ─────────────────────────────────────────────────────────

export function patchOnActivate() {
  return { requires_typing_active: true };
}

export function patchOnClear() {
  return { requires_typing_active: false };
}

/**
 * Convenience: given the latest sensory-detail judgment + current failed
 * attempt count, return the next-state directives.
 *
 * Returns:
 *   { cleared: bool, patch: object, handoff: bool }
 *
 * - `cleared`  : judgment passes A1 threshold → state can clear
 * - `patch`    : shallow patch to merge into session_state via state-manager
 * - `handoff`  : caller should cascade to handoff-escalation (A3)
 */
export function evaluateUserTurn({ judgment, failedAttempts = 0 }) {
  if (clearsRequirement(judgment)) {
    return { cleared: true, patch: patchOnClear(), handoff: false };
  }
  const nextFailed = failedAttempts + 1;
  if (shouldHandoff(nextFailed)) {
    // chat.js will cascade — also clear the typing gate so we don't double-block
    return { cleared: false, patch: patchOnClear(), handoff: true };
  }
  // Stay blocked, increment retry (caller manages the counter — see module comment)
  return { cleared: false, patch: {}, handoff: false };
}
