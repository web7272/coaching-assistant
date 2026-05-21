// lib/session/phase-machine.js
// current_phase (CP1, 8 enum) ↔ router_phase (E3, 7 enum) mapping + validation
//
// 設計範圍邊界：本模組只做 **mapping + validation + pure patch builder**。
//   - 不持有 entry/exit conditions（CP1 spec 未來範圍）
//   - 不做 advance decision（chat.js / P2 / 未來 CP1 module 範圍）
//   - 提供：constants / canTransitionPhase / canSetRouterPhase / advancePhase patch
//
// spec：
//   - Engine 3 §3.1 router_phase 7 enum
//   - 02-lib-modules-spec §3 phase-machine skeleton
//   - 03-v40-adaptation §2 cascade priority

// ─────────────────────────────────────────────────────────
// 8 個 current_phase enum
// ─────────────────────────────────────────────────────────

export const CURRENT_PHASES = Object.freeze({
  PHASE_1:                'phase_1',                // values elicitation + Top 1 determination
  PHASE_2:                'phase_2',                // identity test (Build Vision 或 Self-Concept 入口)
  PHASE_3A:               'phase_3a',               // Build Vision (current_quality_status == "owned")
  PHASE_3B:               'phase_3b',               // Self-Concept Model (== "ambiguous")
  PHASE_4:                'phase_4',                // Cascade Down (Top 2/3 驗證)
  PHASE_5:                'phase_5',                // Completion (takeaway + Future Pacing)
  INTEGRATION_RETENTION:  'integration_retention',  // Day 8-21 retention（提早完成 5 phase）
  PROGRAM_COMPLETED:      'program_completed',      // Day 21 / 學員主動結束
});

// ─────────────────────────────────────────────────────────
// 7 個 router_phase enum（Engine 3 owns）
// ─────────────────────────────────────────────────────────

export const ROUTER_PHASES = Object.freeze({
  OPENING:                'opening',
  ELICITATION:            'elicitation',
  TOP1_DETERMINATION:     'top1_determination',
  IDENTITY_TEST_ROUTING:  'identity_test_routing',
  CASCADE_DOWN:           'cascade_down',
  DEEP_SIGNAL_HANDOFF:    'deep_signal_handoff',    // ⭐ cross-cutting：任何 phase 都可進
  COMPLETED:              'completed',
});

// ─────────────────────────────────────────────────────────
// 對映表：每個 current_phase 內合法的 router_phases
// （deep_signal_handoff 是 cross-cutting、不歸某個 phase 獨佔）
// ─────────────────────────────────────────────────────────

export const PHASE_TRANSITION_MAP = Object.freeze({
  phase_1:                Object.freeze(['opening', 'elicitation', 'top1_determination']),
  phase_2:                Object.freeze(['identity_test_routing']),
  phase_3a:               Object.freeze(['identity_test_routing']),
  phase_3b:               Object.freeze(['identity_test_routing']),
  phase_4:                Object.freeze(['cascade_down']),
  phase_5:                Object.freeze(['completed']),
  integration_retention:  Object.freeze(['opening', 'elicitation']),
  program_completed:      Object.freeze([]),
});

// ─────────────────────────────────────────────────────────
// 合法的 current_phase 推進路徑
// ─────────────────────────────────────────────────────────

export const ALLOWED_PHASE_TRANSITIONS = Object.freeze({
  phase_1:                Object.freeze(['phase_2']),
  phase_2:                Object.freeze(['phase_3a', 'phase_3b']),
  phase_3a:               Object.freeze(['phase_4']),
  phase_3b:               Object.freeze(['phase_4']),
  phase_4:                Object.freeze(['phase_5']),
  phase_5:                Object.freeze(['integration_retention', 'program_completed']),
  integration_retention:  Object.freeze(['program_completed']),
  program_completed:      Object.freeze([]),
});

// ─────────────────────────────────────────────────────────
// validation
// ─────────────────────────────────────────────────────────

export function isValidCurrentPhase(p) {
  return Object.values(CURRENT_PHASES).includes(p);
}

export function isValidRouterPhase(p) {
  return Object.values(ROUTER_PHASES).includes(p);
}

/**
 * Can current_phase transition from → to?
 *
 * @param {string} from
 * @param {string} to
 * @returns {boolean}
 */
export function canTransitionPhase(from, to) {
  if (!isValidCurrentPhase(from) || !isValidCurrentPhase(to)) return false;
  const allowed = ALLOWED_PHASE_TRANSITIONS[from];
  return allowed.includes(to);
}

/**
 * Is `routerPhase` valid within `currentPhase`?
 *
 * - DEEP_SIGNAL_HANDOFF is cross-cutting and allowed from any current_phase
 *   (per Engine 3 §3.1 — "deep_signal_handoff" can be entered from any phase
 *   when E3_deep_signal_detector triggers).
 * - All other router_phases must be in the phase's allowed list.
 *
 * @param {string} currentPhase
 * @param {string} routerPhase
 * @returns {boolean}
 */
export function canSetRouterPhase(currentPhase, routerPhase) {
  if (!isValidCurrentPhase(currentPhase) || !isValidRouterPhase(routerPhase)) return false;
  if (routerPhase === ROUTER_PHASES.DEEP_SIGNAL_HANDOFF) return true;
  const allowed = PHASE_TRANSITION_MAP[currentPhase];
  return allowed.includes(routerPhase);
}

// ─────────────────────────────────────────────────────────
// patch builder (caller applies via state-manager.updateState)
// ─────────────────────────────────────────────────────────

/**
 * Build a state patch to advance current_phase from `state.current_phase` to `nextPhase`.
 *
 * Throws if the transition is not allowed by ALLOWED_PHASE_TRANSITIONS.
 *
 * NOTE: This module does NOT decide WHEN to advance — that's CP1 / chat.js's job
 * (entry/exit conditions live in CP1 phase docs). This function only validates +
 * builds the patch.
 *
 * @param {object} state
 * @param {string} state.current_phase
 * @param {string} nextPhase
 * @returns {{ current_phase: string }}
 */
export function advancePhase(state, nextPhase) {
  const from = state?.current_phase;
  if (!canTransitionPhase(from, nextPhase)) {
    throw new Error(
      `phase-machine: invalid transition "${from}" → "${nextPhase}". `
      + `Allowed from "${from}": ${JSON.stringify(ALLOWED_PHASE_TRANSITIONS[from] ?? [])}`,
    );
  }
  return { current_phase: nextPhase };
}

/**
 * Build a state patch to set router_phase within the current_phase.
 *
 * @param {object} state
 * @param {string} state.current_phase
 * @param {string} nextRouterPhase
 * @returns {{ router_phase: string }}
 */
export function setRouterPhase(state, nextRouterPhase) {
  const currentPhase = state?.current_phase;
  if (!canSetRouterPhase(currentPhase, nextRouterPhase)) {
    throw new Error(
      `phase-machine: router_phase "${nextRouterPhase}" not valid within current_phase "${currentPhase}".`,
    );
  }
  return { router_phase: nextRouterPhase };
}
