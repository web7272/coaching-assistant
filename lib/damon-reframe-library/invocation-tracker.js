// lib/damon-reframe-library/invocation-tracker.js
// v5.1 Step 7 PR-7a — Reframe invocation tracking helper.
//
// Per-session: 寫 session_state.reframe_invocation_history_in_session JSONB.
// Cross-session: 在 session close 時 cascade 到 user_profile_evolution.
//   reframe_invocation_history (migration 027 已 ship, Step 5c errata Patch 4).
//
// 主要 entry: recordInvocation(state, params) — 純函式、返回 patch 描述,
//             handler/router 拿到後 merge 進 session_state patch、不 mutate.

import { REFRAME_REGISTRY } from './index.js';

/**
 * Build a single invocation history entry (per spec migration 027 schema:
 *   { reframe_id, invoked_at_turn, session_id, outcome, anchor_phrase_if_success?, invoked_at }
 * ).
 *
 * outcome defaults to 'pending' — finalize-day or subsequent turn determines success.
 *
 * @param {object} params
 * @returns {object} entry
 */
export function buildInvocationEntry(params = {}) {
  const id = params.reframe_id;
  if (!id || !REFRAME_REGISTRY[id]) {
    throw new TypeError(`buildInvocationEntry: unknown reframe_id ${id}`);
  }
  if (typeof params.invoked_at_turn !== 'number' || params.invoked_at_turn < 0) {
    throw new TypeError('buildInvocationEntry: invoked_at_turn must be non-negative number');
  }
  return {
    reframe_id: id,
    invoked_at_turn: params.invoked_at_turn,
    session_id: params.session_id ?? null,
    outcome: params.outcome || 'pending',                       // pending | success | partial | no_change
    variant: params.variant || null,
    mode: params.mode || null,
    anchor_phrase_if_success: params.anchor_phrase_if_success ?? null,
    invoked_at: params.invoked_at,    // ⚠️ caller provides ISO timestamp (no Date.now())
  };
}

/**
 * Count per-reframe invocations in current session.
 *
 * @param {object} state — session_state slice
 * @param {string} reframeId
 * @returns {number}
 */
export function countPerSession(state, reframeId) {
  const list = state?.reframe_invocation_history_in_session;
  if (!Array.isArray(list)) return 0;
  return list.filter(e => e?.reframe_id === reframeId).length;
}

/**
 * §9.1 level_5 — per-session downsizing rule: same reframe > 5 times → invoke
 * is blocked (caller should fall back to acknowledge / different reframe).
 *
 * @param {object} state
 * @param {string} reframeId
 * @returns {boolean} true if downsize triggered (should NOT invoke)
 */
export function shouldDownsize(state, reframeId) {
  return countPerSession(state, reframeId) >= 5;
}

/**
 * Build state patch to append an invocation entry to
 * session_state.reframe_invocation_history_in_session.
 *
 * Handler usage:
 *   const patch = appendToSessionHistoryPatch(state, entry);
 *   return { handled: true, inject, patch };
 *
 * @param {object} state — current session_state slice (read-only)
 * @param {object} entry — buildInvocationEntry result
 * @returns {object} patch slice (caller merges into full patch)
 */
export function appendToSessionHistoryPatch(state, entry) {
  const prior = Array.isArray(state?.reframe_invocation_history_in_session)
    ? state.reframe_invocation_history_in_session
    : [];
  return {
    reframe_invocation_history_in_session: [...prior, entry],
  };
}

/**
 * Compute outcome update — when later turn 確認 reframe 成功 (e.g. student
 * surface owned anchor phrase), patch the most-recent matching invocation
 * entry's outcome field. Called by takeaway handler / mode-tracker.
 *
 * @param {object} state
 * @param {string} reframeId
 * @param {object} outcomeUpdate — { outcome, anchor_phrase_if_success? }
 * @returns {object|null} patch slice or null if nothing to update
 */
export function patchLatestOutcome(state, reframeId, outcomeUpdate) {
  const list = state?.reframe_invocation_history_in_session;
  if (!Array.isArray(list) || list.length === 0) return null;
  // Find last entry matching this reframe_id with pending outcome.
  let idx = -1;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i]?.reframe_id === reframeId && list[i]?.outcome === 'pending') {
      idx = i;
      break;
    }
  }
  if (idx === -1) return null;
  const updated = [...list];
  updated[idx] = {
    ...updated[idx],
    outcome: outcomeUpdate.outcome || updated[idx].outcome,
    anchor_phrase_if_success:
      outcomeUpdate.anchor_phrase_if_success ?? updated[idx].anchor_phrase_if_success,
  };
  return { reframe_invocation_history_in_session: updated };
}
