// lib/session/day-boundary.js
// new_session_day detection + cross-day RESET_FIELDS patch builder.
// spec: docs/v5-spec/engineering/01-migration-014-state-schema.md §3
//
// 設計：本模組只提供 pure functions（detect + buildResetPatch）。
// 實際 DB 寫入由呼叫端（chat.js / finalize-day.js）透過 lib/state/state-manager
// updateState(session_id, patch) 完成 — 跨 day reset 用淺合併 || 寫入 session_state、
// 不碰 phase 進度 6 欄位（白名單外、自動保留）。

// ─────────────────────────────────────────────────────────
// RESET_FIELDS 白名單（24 欄位）
// 對齊 migration 014 §3、含 5/21 errata
// ─────────────────────────────────────────────────────────
//
// errata（5/21）：以下三欄位從「不 reset」改為「reset」
//   - current_quality_status   （Day N+1 fresh 觀察 quality）
//   - router_phase             （Day N+1 重走 opening）
//   - elicitation_mode_active  （reset 為 true、重新進採集模式 + 讀 user_profile 持久資產做開場引用）

export const RESET_FIELDS = Object.freeze({
  // Engine 1（對話偏離）
  cumulative_ppl_score:               0,
  consecutive_short_responses:        0,
  consecutive_offtopic_turns:         0,
  consecutive_vague_turns:            0,
  recent_specific_examples_count:     0,
  bypassing_layer_progress:           0,
  requires_typing_active:             false,
  handoff_triggered_count:            0,

  // Engine 2（身份測試）— errata
  current_quality_status:             'none',
  current_quality_candidate_term:     null,
  identity_test_evidence_count:       0,

  // Engine 3（中央路由器）— errata
  router_phase:                       'opening',
  cascade_down_progress:              null,
  deep_signal_flags: {
    worth_fiction_detected:  false,
    trauma_marker_detected:  false,
    parts_resistance_detected: false,
    depth_judgment_score:    0,
  },
  opening_branch_handled:             false,
  elicitation_mode_active:            true,

  // Engine 4（主動引用）
  opening_reference_variant_used:     null,
  takeaway_seeded_this_session:       false,

  // Checkpoint 1（mid-session counter 而已、phase 進度不在這）
  mid_session_takeaway_count:         0,

  // Dashboard（per-session 監控）
  amnesia_signal_this_session:        false,
  e1c_trigger_count_this_session:     0,
  turn_count_this_session:            0,
  hard_limit_hit_this_session:        false,
});

// 反向白名單（documentation + regression test 用）：
// phase 進度 6 欄位**絕對不能**在 RESET_FIELDS、跨 day 保留（學員努力產出）。
export const PHASE_PROGRESS_NEVER_RESET = Object.freeze([
  'current_phase',
  'phase_progress',
  'integration_retention_mode_active',
  'build_vision_progress',
  'self_concept_progress',
  'counter_examples_list',
]);

// Errata 三欄位（5/21）— 從「不 reset」改為 reset、明示供 test verify。
export const ERRATA_NOW_RESET = Object.freeze([
  'current_quality_status',
  'router_phase',
  'elicitation_mode_active',
]);

// ─────────────────────────────────────────────────────────
// pure helpers
// ─────────────────────────────────────────────────────────

/**
 * Calendar day diff (UTC midnight → midnight, integer days).
 * @param {Date} from
 * @param {Date} to
 * @returns {number} positive when `to` is later than `from`
 */
export function calcCalendarDayDiff(from, to) {
  if (!(from instanceof Date) || !(to instanceof Date)) {
    throw new TypeError('calcCalendarDayDiff: from / to must be Date');
  }
  const fromMid = Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate());
  const toMid = Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate());
  return Math.floor((toMid - fromMid) / 86_400_000);
}

/**
 * Detect a new session day.
 *
 * new_session_day = calendar day 已過 + 學員本日首次發 message
 * （第二個條件由 chat.js 處理 — 本函數只判斷 calendar day 是否已過）
 *
 * @param {{ last_active_date?: string | Date | null }} user_profile
 * @param {Date} now
 * @returns {{ is_new_day: boolean, gap_days: number }}
 */
export function detectNewSessionDay(user_profile, now) {
  if (!(now instanceof Date)) {
    throw new TypeError('detectNewSessionDay: now must be Date');
  }
  const last = user_profile?.last_active_date;
  if (!last) return { is_new_day: true, gap_days: 0 };
  const lastDate = last instanceof Date ? last : new Date(last);
  if (Number.isNaN(lastDate.getTime())) {
    throw new TypeError('detectNewSessionDay: last_active_date is invalid');
  }
  const gap_days = calcCalendarDayDiff(lastDate, now);
  return { is_new_day: gap_days >= 1, gap_days };
}

/**
 * Build a fresh patch object containing all 24 RESET_FIELDS keys at initial values.
 *
 * Returned object is mutable and safe to pass to state-manager.updateState
 * (which JSON-stringifies it for `||` merge).
 *
 * Phase progress 6 fields are NEVER included (preserved via shallow-merge semantics:
 * keys not in the patch retain their value in session_state).
 *
 * @returns {object}
 */
export function buildResetPatch() {
  const patch = {};
  for (const [k, v] of Object.entries(RESET_FIELDS)) {
    patch[k] = cloneInitialValue(v);
  }
  return patch;
}

function cloneInitialValue(v) {
  if (v === null) return null;
  if (typeof v === 'object') return JSON.parse(JSON.stringify(v));
  return v;
}
