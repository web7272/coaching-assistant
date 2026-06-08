// lib/api/crisis-session-flag.js
// Vivi 6/7 — derive "did this session touch crisis?" from session_state.
//
// Use case: api/finalize-day.js → generateDamonNote → generateNotebookPage.
// The notebook-page 「我看見的」 section has two registers:
//   - sharp (default): directly point at the SC observation's identity-rule
//     / belief, using the student's own words as the blade (Vivi 6/7 spec)
//   - gentle (this helper === true): soft conjecture, no direct point, no
//     "discomfort = signal" reframe (回到原本 80-字 緩衝版本)
//
// Crisis turn followed by a sharp identity-rule sentence is unkind — the
// learner just exposed a vulnerable place. This helper decides which way
// the prompt branches.
//
// Signals (in order of reliability, OR-ed):
//
//   1. crisis_sop_state present (truthy object).
//      STRONGEST signal. The SOP state object is instantiated the moment
//      Step 1 fires (lib/detector-handlers/crisis-sop.js) and PERSISTS past
//      closure (Step 8 sets crisis_sop_complete=true but does NOT clear
//      crisis_sop_state — confirmed in crisis-sop.js L711). So even a
//      cleanly-closed crisis session still carries this flag at finalize.
//
//   2. crisis_state_carry_forward_pending_write present.
//      Secondary. Set by e4TakeawayHandler at session close when the SOP
//      reached a state worth carrying forward. Won't fire if the session
//      ended mid-SOP without taking the closure path, but doubles as
//      cross-check when present.
//
//   3. deep_signal_flags.passive_dw_detected === true (if available).
//      Tertiary. The deep-signal-detector sets this when a passive death-
//      wish was detected; not all crisis turns set this (e.g., trauma-only
//      markers), but when present it confirms the session went through the
//      crisis cascade.
//
// Fail-safe direction (per spec):
//   "偵測不確定時偏向溫和" — when in doubt, return TRUE (go gentle). Any
//   malformed session_state / parse error → TRUE.
//
//   Rationale: a non-crisis session getting the gentle copy costs UX
//   sharpness for one student. A crisis session getting the sharp copy
//   risks landing a「身份規則」 sentence on a learner who just exposed
//   their wound — qualitatively worse failure.

/**
 * @param {unknown} sessionState - session_state column value (parsed object or null)
 * @returns {boolean} true if the session touched crisis (use gentle prompt)
 */
export function sessionTouchedCrisis(sessionState) {
  // Defensive: null / undefined / non-object → cautious gentle.
  if (sessionState === null || sessionState === undefined) return false;
  if (typeof sessionState !== 'object') {
    // Parse-shape unknown → fail-safe to gentle.
    return true;
  }
  if (Array.isArray(sessionState)) return true;

  try {
    // 1. crisis_sop_state present (strongest signal).
    const sopState = sessionState.crisis_sop_state;
    if (sopState !== null && sopState !== undefined && typeof sopState === 'object') {
      return true;
    }

    // 2. crisis_state_carry_forward_pending_write present.
    if (sessionState.crisis_state_carry_forward_pending_write !== null
        && sessionState.crisis_state_carry_forward_pending_write !== undefined) {
      return true;
    }

    // 3. deep_signal_flags.passive_dw_detected === true.
    const flags = sessionState.deep_signal_flags;
    if (flags && typeof flags === 'object'
        && flags.passive_dw_detected === true) {
      return true;
    }

    // No crisis signal found — safe to go sharp.
    return false;
  } catch (_err) {
    // Any unexpected throw → cautious gentle.
    return true;
  }
}
