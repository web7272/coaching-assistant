// lib/session/mode-transition-logger.js
// v5.1 Step 4 (PR-23s4a) — mode transition logger.
//
// 對齊: v51_engine_3_errata_v02.md task 6 + migration 025 session_state schema:
//   session_state.mode_transition_log (array of transition records, per session)
//   user_profile_evolution.mode_history  (array of session summaries, cross session)
//
// 6 trigger_type (per spec):
//   learner_surfaced           — 學員直接帶出新訊號 (e.g. surface 新方向)
//   ai_initiated               — AI 主動切換 (e.g. mode-transition-router 判定)
//   signal_cascade             — deep-signal-detector 命中 → crisis cascade
//   mode_natural_progression   — 自然推進 (e.g. integration owned 完成 → cascade)
//   natural_completion         — mode 自然收尾 (e.g. cascade 全部 Top 2/3 過 → future_pacing)
//   session_natural_end        — session 結束 (day_complete, soft/hard limit)
//
// Pure functions — no DB I/O. Caller (chat.js) builds entry, appends via patch,
// optionally aggregates per-session at finalize-day for user_profile_evolution.

// ─────────────────────────────────────────────────────────
// constants
// ─────────────────────────────────────────────────────────

export const TRIGGER_TYPES = Object.freeze({
  LEARNER_SURFACED:         'learner_surfaced',
  AI_INITIATED:             'ai_initiated',
  SIGNAL_CASCADE:           'signal_cascade',
  MODE_NATURAL_PROGRESSION: 'mode_natural_progression',
  NATURAL_COMPLETION:       'natural_completion',
  SESSION_NATURAL_END:      'session_natural_end',
});

export const TRIGGER_TYPE_LIST = Object.freeze(Object.values(TRIGGER_TYPES));

// ─────────────────────────────────────────────────────────
// buildTransitionEntry — pure log-entry constructor
// ─────────────────────────────────────────────────────────

/**
 * Build a single transition log entry. Pure — caller appends to log array.
 *
 * @param {object} args
 * @param {string[]} args.from_active_modes  - active_modes BEFORE transition
 * @param {string[]} args.to_active_modes    - active_modes AFTER transition
 * @param {string}   args.from_primary       - primary BEFORE
 * @param {string}   args.to_primary         - primary AFTER
 * @param {string}   args.trigger_type       - one of TRIGGER_TYPES values
 * @param {string|object} [args.trigger_detail=null]  - free-form context
 * @param {number}   [args.turn_count=0]
 * @param {string}   [args.timestamp]        - ISO string; defaults to now (injectable for tests)
 * @returns {object} log entry
 */
export function buildTransitionEntry({
  from_active_modes,
  to_active_modes,
  from_primary,
  to_primary,
  trigger_type,
  trigger_detail = null,
  turn_count = 0,
  timestamp = null,
} = {}) {
  if (!TRIGGER_TYPE_LIST.includes(trigger_type)) {
    throw new TypeError(
      `buildTransitionEntry: unknown trigger_type "${trigger_type}" `
      + `(must be one of ${TRIGGER_TYPE_LIST.join(', ')})`
    );
  }
  return {
    timestamp: timestamp || new Date().toISOString(),
    turn_count: typeof turn_count === 'number' && Number.isFinite(turn_count)
      ? turn_count : 0,
    from_active_modes: Array.isArray(from_active_modes) ? [...from_active_modes] : [],
    to_active_modes:   Array.isArray(to_active_modes)   ? [...to_active_modes]   : [],
    from_primary: typeof from_primary === 'string' ? from_primary : null,
    to_primary:   typeof to_primary   === 'string' ? to_primary   : null,
    trigger_type,
    trigger_detail,
  };
}

// ─────────────────────────────────────────────────────────
// appendTransitionPatch — produce a session_state patch that appends entry
// ─────────────────────────────────────────────────────────

/**
 * Build a session_state patch that appends a transition entry to the log array.
 * Existing entries preserved; defensive against missing/non-array log.
 *
 * @param {object|null|undefined} sessionState
 * @param {object} entry  - from buildTransitionEntry
 * @returns {{mode_transition_log: object[]}}
 */
export function appendTransitionPatch(sessionState, entry) {
  if (!entry || typeof entry !== 'object') {
    throw new TypeError('appendTransitionPatch: entry must be an object');
  }
  const existing = Array.isArray(sessionState?.mode_transition_log)
    ? sessionState.mode_transition_log
    : [];
  return { mode_transition_log: [...existing, entry] };
}

// ─────────────────────────────────────────────────────────
// aggregateForUserProfile — per-session summary for cross-session mode_history
// ─────────────────────────────────────────────────────────

/**
 * Aggregate a session's transition log into the summary entry that gets appended
 * to user_profile_evolution.mode_history at session end. Pure — caller passes
 * the result to setLastSessionDaySummary / a dedicated mode_history append helper.
 *
 * primary_mode_distribution: { mode → turn_count spent in that mode }.
 *   Computed by walking transitions in order: between transition i and i+1,
 *   the primary at i held for (transitions[i+1].turn_count - transitions[i].turn_count) turns.
 *   For the final segment, we use opts.finalTurnCount (session end turn count).
 *
 * @param {object} args
 * @param {number} [args.sessionId]
 * @param {Array<object>} args.transitions  - from session_state.mode_transition_log
 * @param {boolean} [args.crisisTriggered=false]
 * @param {number}  [args.finalTurnCount=0]  - turn_count at session end (closes the last segment)
 * @param {string|null} [args.initialPrimary=null]  - primary at session start
 *                                                    (transitions only carry from→to, so
 *                                                     to compute the very first segment's
 *                                                     duration we need to know what primary
 *                                                     held before transition[0])
 * @returns {{
 *   session_id: number|null,
 *   primary_mode_distribution: object,
 *   transitions_in_session: number,
 *   crisis_triggered: boolean,
 * }}
 */
export function aggregateForUserProfile({
  sessionId = null,
  transitions = [],
  crisisTriggered = false,
  finalTurnCount = 0,
  initialPrimary = null,
} = {}) {
  const safeTransitions = Array.isArray(transitions) ? transitions : [];
  const distribution = {};

  // The session starts with `initialPrimary` (or transitions[0].from_primary as
  // fallback). Walk transitions and bucket turn ranges to whichever primary held.
  let cursorPrimary = initialPrimary
    || (safeTransitions[0] && safeTransitions[0].from_primary)
    || null;
  let cursorTurn = 0;

  for (const t of safeTransitions) {
    if (!t || typeof t !== 'object') continue;
    const tTurn = typeof t.turn_count === 'number' && Number.isFinite(t.turn_count)
      ? Math.max(cursorTurn, t.turn_count)
      : cursorTurn;
    if (cursorPrimary) {
      const duration = tTurn - cursorTurn;
      if (duration > 0) {
        distribution[cursorPrimary] = (distribution[cursorPrimary] || 0) + duration;
      }
    }
    cursorPrimary = t.to_primary || cursorPrimary;
    cursorTurn = tTurn;
  }

  // Close the final segment (cursor → finalTurnCount).
  if (cursorPrimary && Number.isFinite(finalTurnCount)) {
    const tail = Math.max(0, finalTurnCount - cursorTurn);
    if (tail > 0) {
      distribution[cursorPrimary] = (distribution[cursorPrimary] || 0) + tail;
    }
  }

  return {
    session_id: sessionId,
    primary_mode_distribution: distribution,
    transitions_in_session: safeTransitions.length,
    crisis_triggered: !!crisisTriggered,
  };
}
