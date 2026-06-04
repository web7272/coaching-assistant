// lib/session/mode-tracker.js
// v5.1 Step 4 (PR-23s4a) — mode lifecycle state machine.
//
// 對齊: v51_engine_3_errata_v02.md task 6 + migration 025 schema.
// 設計師 6/4 spec: 廢 phase 線性 state machine, 改 active_modes list + primary_mode
// + paused_modes (雙向流動、無 regression 概念).
//
// 6 modes (enum, 對齊 migration 025 §5 對映表):
//   elicitation        — values 採集 + 起手分流 + curiosity reframe
//   identity_anchoring — 身份測試 (Top 1 / cascade Top 2/3)
//   integration        — Self-Concept 收編 (原 phase-3a/3b toolbox)
//   cascade            — Cascade Down (Top 2/3 重新測, orthogonal 可從任何 mode 觸發)
//   future_pacing      — Future Pacing + Let it Go + Export
//   crisis             — deep signal handoff / passive DW (Patch 23)
//
// Mode 流動規則 (per spec):
//   - active_modes 同時 1-3 個 (>3 → HITL alert flag, 異常)
//   - crisis 觸發 → 其他 modes 全 paused_modes、primary=crisis
//   - crisis 退出 → resume paused、primary 回原 (first paused or first active)
//   - 學員 surface 新方向 → 新 mode 加進 active (任何 mode 可演進、非 failure)
//
// Read-time fallback (空窗期保護, migration 025 跑完 + Step 4 runtime 之間):
//   讀不到 primary_mode 但有 router_phase → 即時 derive、不寫回 DB
//   (caller 決定要不要在 turn end 持久化, 透過 was_fallback flag)
//
// 過渡期: PR-23s4a 是 coexistence — phase-machine + mode-tracker dual-write.
//   phase-machine 廢除留 PR-23s4b.

// ─────────────────────────────────────────────────────────
// constants
// ─────────────────────────────────────────────────────────

export const ACTIVE_MODES = Object.freeze({
  ELICITATION:        'elicitation',
  IDENTITY_ANCHORING: 'identity_anchoring',
  INTEGRATION:        'integration',
  CASCADE:            'cascade',
  FUTURE_PACING:      'future_pacing',
  CRISIS:             'crisis',
});

export const MODE_LIST = Object.freeze(Object.values(ACTIVE_MODES));
export const MAX_ACTIVE_MODES = 3;

// ─────────────────────────────────────────────────────────
// Read-time fallback: router_phase → mode
// (mirrors migration 025 §5 對映表 verbatim — single source of truth for the
//  legacy-to-mode mapping. Both run during the transitional window where the
//  schema has been migrated but new sessions may still be written with
//  router_phase by the v5.0 runtime.)
// ─────────────────────────────────────────────────────────

const ROUTER_PHASE_TO_MODE = Object.freeze({
  opening:               ACTIVE_MODES.ELICITATION,
  elicitation:           ACTIVE_MODES.ELICITATION,
  top1_determination:    ACTIVE_MODES.ELICITATION,
  identity_test_routing: ACTIVE_MODES.IDENTITY_ANCHORING,
  cascade_down:          ACTIVE_MODES.CASCADE,
  deep_signal_handoff:   ACTIVE_MODES.CRISIS,
  completed:             ACTIVE_MODES.FUTURE_PACING,
});

/**
 * Derive primary_mode from a legacy router_phase string.
 *
 * @param {string|null|undefined} routerPhase
 * @returns {string|null} one of ACTIVE_MODES, OR null when routerPhase is unknown.
 */
export function deriveModeFromRouterPhase(routerPhase) {
  if (typeof routerPhase !== 'string') return null;
  return ROUTER_PHASE_TO_MODE[routerPhase] || null;
}

// ─────────────────────────────────────────────────────────
// readModeState — extract / derive mode state from session_state
// ─────────────────────────────────────────────────────────

/**
 * Read mode state from session_state, applying router_phase fallback when the
 * mode keys are missing. Pure read — no mutation. Caller decides whether to
 * persist the derived state at turn end via buildModeStatePatch.
 *
 * @param {object|null|undefined} sessionState
 * @returns {{
 *   active_modes: string[],
 *   primary_mode: string,
 *   paused_modes: string[],
 *   was_fallback: boolean,
 * }}
 *   was_fallback=true → mode keys were missing in session_state, we derived
 *   from router_phase (or defaulted to ELICITATION). Caller may log + write
 *   the resulting state back to DB to advance the row past the transitional window.
 */
export function readModeState(sessionState) {
  // Defensive shell for null / non-object input
  if (!sessionState || typeof sessionState !== 'object') {
    return {
      active_modes: [ACTIVE_MODES.ELICITATION],
      primary_mode: ACTIVE_MODES.ELICITATION,
      paused_modes: [],
      was_fallback: true,
    };
  }

  // Happy path — mode keys present + valid
  if (typeof sessionState.primary_mode === 'string'
      && MODE_LIST.includes(sessionState.primary_mode)) {
    const rawActive = Array.isArray(sessionState.active_modes)
      ? sessionState.active_modes.filter(m => MODE_LIST.includes(m))
      : [];
    const active = rawActive.length > 0 ? rawActive : [sessionState.primary_mode];
    const paused = Array.isArray(sessionState.paused_modes)
      ? sessionState.paused_modes.filter(m => MODE_LIST.includes(m))
      : [];
    return {
      active_modes: active,
      primary_mode: sessionState.primary_mode,
      paused_modes: paused,
      was_fallback: false,
    };
  }

  // Fallback path — derive from router_phase, OR default to elicitation
  const derived = deriveModeFromRouterPhase(sessionState.router_phase)
    || ACTIVE_MODES.ELICITATION;
  // crisis fallback: also surface as primary (no paused snapshot from legacy row).
  return {
    active_modes: [derived],
    primary_mode: derived,
    paused_modes: [],
    was_fallback: true,
  };
}

/**
 * Build a session_state patch to persist mode state. Caller merges into
 * the patch handed to updateState() at turn end.
 *
 * @param {{active_modes:string[], primary_mode:string, paused_modes:string[]}} modeState
 * @returns {{active_modes:string[], primary_mode:string, paused_modes:string[]}}
 */
export function buildModeStatePatch(modeState) {
  if (!modeState || typeof modeState !== 'object') {
    throw new TypeError('buildModeStatePatch: modeState must be an object');
  }
  return {
    active_modes: Array.isArray(modeState.active_modes) ? [...modeState.active_modes] : [],
    primary_mode: modeState.primary_mode,
    paused_modes: Array.isArray(modeState.paused_modes) ? [...modeState.paused_modes] : [],
  };
}

// ─────────────────────────────────────────────────────────
// Mode lifecycle operators — all pure, take + return mode state
// ─────────────────────────────────────────────────────────

function assertMode(mode, fn) {
  if (!MODE_LIST.includes(mode)) {
    throw new TypeError(`${fn}: unknown mode "${mode}" (must be one of ${MODE_LIST.join(', ')})`);
  }
}

function dedupe(arr) {
  return arr.filter((x, i) => arr.indexOf(x) === i);
}

/**
 * Add a mode to active set (no-op if already active). Does NOT change primary.
 * @param {object} modeState
 * @param {string} mode
 * @returns {object} new modeState
 */
export function addMode(modeState, mode) {
  assertMode(mode, 'addMode');
  if (modeState.active_modes.includes(mode)) return modeState;
  return {
    ...modeState,
    active_modes: [...modeState.active_modes, mode],
  };
}

/**
 * Remove a mode from active set. If it was primary, demote to first remaining
 * active mode (or fall back to elicitation if active becomes empty — guard
 * against ever having an empty active_modes).
 *
 * @param {object} modeState
 * @param {string} mode
 * @returns {object} new modeState
 */
export function removeMode(modeState, mode) {
  assertMode(mode, 'removeMode');
  if (!modeState.active_modes.includes(mode)) return modeState;
  const new_active = modeState.active_modes.filter(m => m !== mode);
  let new_primary = modeState.primary_mode;
  if (mode === modeState.primary_mode) {
    new_primary = new_active[0] || ACTIVE_MODES.ELICITATION;
  }
  return {
    ...modeState,
    active_modes: new_active.length > 0 ? new_active : [new_primary],
    primary_mode: new_primary,
  };
}

/**
 * Switch primary_mode. If the new primary isn't already in active_modes, add it.
 *
 * @param {object} modeState
 * @param {string} newPrimary
 * @returns {object} new modeState
 */
export function transitionPrimary(modeState, newPrimary) {
  assertMode(newPrimary, 'transitionPrimary');
  if (modeState.primary_mode === newPrimary
      && modeState.active_modes.includes(newPrimary)) {
    return modeState;
  }
  const new_active = modeState.active_modes.includes(newPrimary)
    ? modeState.active_modes
    : [...modeState.active_modes, newPrimary];
  return {
    ...modeState,
    active_modes: new_active,
    primary_mode: newPrimary,
  };
}

/**
 * Crisis trigger — move all non-crisis active modes to paused_modes,
 * primary becomes crisis, active becomes [crisis] only.
 *
 * @param {object} modeState
 * @returns {object} new modeState
 */
export function triggerCrisis(modeState) {
  const non_crisis = modeState.active_modes.filter(m => m !== ACTIVE_MODES.CRISIS);
  return {
    ...modeState,
    active_modes: [ACTIVE_MODES.CRISIS],
    primary_mode: ACTIVE_MODES.CRISIS,
    paused_modes: dedupe([...modeState.paused_modes, ...non_crisis]),
  };
}

/**
 * Crisis resolution — remove crisis, resume paused_modes back to active.
 * Primary becomes the first previously-paused mode (which best represents
 * "where we were before the crisis derail"), or first remaining active if
 * paused was empty.
 *
 * @param {object} modeState
 * @returns {object} new modeState
 */
export function resolveCrisis(modeState) {
  const resumed = [...modeState.paused_modes];
  const remaining_active = modeState.active_modes.filter(m => m !== ACTIVE_MODES.CRISIS);
  const new_active = dedupe([...remaining_active, ...resumed]);
  const new_primary = resumed[0]
    || new_active[0]
    || ACTIVE_MODES.ELICITATION;   // safe last-resort
  return {
    ...modeState,
    active_modes: new_active.length > 0 ? new_active : [new_primary],
    primary_mode: new_primary,
    paused_modes: [],
  };
}

// ─────────────────────────────────────────────────────────
// validation
// ─────────────────────────────────────────────────────────

/**
 * Check whether active_modes count violates the spec limit (>3 = anomaly,
 * caller should HITL alert). Pure check — does NOT throw.
 *
 * @param {object} modeState
 * @returns {{ok:true} | {ok:false, reason:string, count:number}}
 */
export function checkActiveModesLimit(modeState) {
  const count = Array.isArray(modeState?.active_modes)
    ? modeState.active_modes.length
    : 0;
  if (count > MAX_ACTIVE_MODES) {
    return { ok: false, reason: 'exceeds_max_active_modes', count };
  }
  if (count < 1) {
    return { ok: false, reason: 'empty_active_modes', count };
  }
  return { ok: true };
}
