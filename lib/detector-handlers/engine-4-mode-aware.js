// lib/detector-handlers/engine-4-mode-aware.js
// v5.1 Step 5c (Vivi 6/4) — Engine 4 mode-aware helpers.
// 對齊 v51_engine_4_errata.md §A2 (V6 day-opening) + §A3 (takeaway mode-aware) + §A4
// (cross-session anchor write + crisis_state_carry_forward plumbing).
//
// Pure functions — no DB I/O. Caller (engine-4.js handlers) compose patches.

import { ACTIVE_MODES, readModeState } from '../session/mode-tracker.js';
// Step 7 PR-7a — R7_C Let It Go Ritual replaces takeaway future_pacing TODO.
import { R7, R7_VARIANTS } from '../damon-reframe-library/r7-slip-into-unconscious.js';

// ─────────────────────────────────────────────────────────
// A2 — Day N+1 variant selector (mode-aware + V6 crisis follow-up)
// ─────────────────────────────────────────────────────────

export const DAY_OPENING_VARIANTS = Object.freeze({
  V1: 'V1', V2: 'V2', V3: 'V3', V4: 'V4', V5: 'V5', V6: 'V6',
});

/**
 * V6 sub-branches (per errata §A2 spec-given phrasing, ship-able).
 *   handoff_a / handoff_c / si_risk_passive / cross_count_3_plus
 */
export const V6_SUB_BRANCHES = Object.freeze({
  HANDOFF_A:         'handoff_a',
  HANDOFF_C:         'handoff_c',
  SI_RISK_PASSIVE:   'si_risk_passive',
  CROSS_COUNT_3_PLUS:'cross_count_3_plus',
});

/**
 * Decide V6 sub-branch per errata §A2 priority.
 * Returns null if no V6 sub-branch applies (caller falls through to V1-V5).
 *
 * @param {object} carryForward     - crisis_state_carry_forward object
 * @param {number} passiveDwCount   - cross-session passive_death_wish_count
 * @returns {string|null}           - V6_SUB_BRANCHES value OR null
 */
export function selectV6SubBranch(carryForward, passiveDwCount = 0) {
  // Priority 1 — cross-session count >= 3 (Patch 23 alignment).
  if (passiveDwCount >= 3) return V6_SUB_BRANCHES.CROSS_COUNT_3_PLUS;
  if (!carryForward || typeof carryForward !== 'object') return null;
  // Priority 2 — si_risk_level >= passive (active or higher).
  const si = carryForward.si_risk_level;
  if (si === 'passive' || si === 'active' || si === 'high') {
    return V6_SUB_BRANCHES.SI_RISK_PASSIVE;
  }
  // Priority 3 — handoff_choice = c (回來 unresolved).
  if (carryForward.handoff_choice === 'c') return V6_SUB_BRANCHES.HANDOFF_C;
  // Priority 4 — handoff_choice = a (paused at anchor / takeaway_term).
  if (carryForward.handoff_choice === 'a') return V6_SUB_BRANCHES.HANDOFF_A;
  return null;
}

/**
 * Main selector — produces variant V1-V6 per spec mode-aware rules.
 *
 * @param {object} args
 * @param {object} args.userProfile       - includes last_session_day_summary + crisis_state_carry_forward + passive_death_wish_count
 * @param {number} args.gapDays
 * @param {string} args.userResponseText  - kickoff text (for「我想接 / 繼續」 / 「今天我想換」 detection)
 * @returns {{ variant: string, v6SubBranch: string|null }}
 */
export function selectDayOpeningVariant({ userProfile = {}, gapDays = 0, userResponseText = '' }) {
  // V6 — highest priority, overrides everything.
  const cf = userProfile.crisis_state_carry_forward;
  // V6 fires only when carry_forward exists AND not yet resolved (resolved_at == null).
  const v6Active = cf && typeof cf === 'object' && !cf.resolved_at;
  if (v6Active) {
    const passiveCount = Number(userProfile.passive_death_wish_count ?? 0);
    const sub = selectV6SubBranch(cf, passiveCount);
    if (sub) return { variant: DAY_OPENING_VARIANTS.V6, v6SubBranch: sub };
  }

  // Override: 學員開場「我想接 / 繼續」 → V1; 「今天我想換」 → V3.
  if (/(我想接|繼續|接著走|延續)/.test(userResponseText)) {
    return { variant: DAY_OPENING_VARIANTS.V1, v6SubBranch: null };
  }
  if (/(今天.{0,5}換|想換個|想聊別的)/.test(userResponseText)) {
    return { variant: DAY_OPENING_VARIANTS.V3, v6SubBranch: null };
  }

  // gap_days primary heuristic.
  const days = Number.isFinite(gapDays) ? gapDays : 0;
  if (days > 7) return { variant: DAY_OPENING_VARIANTS.V4, v6SubBranch: null };
  if (days >= 3) return { variant: DAY_OPENING_VARIANTS.V3, v6SubBranch: null };

  // gap_days <= 2 — mode-aware sub-selection.
  const lastSummary = userProfile.last_session_day_summary || {};
  const lastPrimary = lastSummary.primary_mode;
  const lastQualityStatus = lastSummary.last_quality_status;
  const lastTakeawayOk = !!lastSummary.takeaway_term;

  // elicitation + takeaway success → V1.
  if (lastPrimary === ACTIVE_MODES.ELICITATION && lastTakeawayOk) {
    return { variant: DAY_OPENING_VARIANTS.V1, v6SubBranch: null };
  }
  // identity_anchoring / integration + ambiguous → V2.
  if ((lastPrimary === ACTIVE_MODES.IDENTITY_ANCHORING
       || lastPrimary === ACTIVE_MODES.INTEGRATION)
      && lastQualityStatus === 'ambiguous') {
    return { variant: DAY_OPENING_VARIANTS.V2, v6SubBranch: null };
  }
  // cascade 未完 → V5.
  if (lastPrimary === ACTIVE_MODES.CASCADE
      && lastSummary.cascade_completed !== true) {
    return { variant: DAY_OPENING_VARIANTS.V5, v6SubBranch: null };
  }
  // Default → V1.
  return { variant: DAY_OPENING_VARIANTS.V1, v6SubBranch: null };
}

/**
 * V6 sub-branch ship-able phrasing (per errata §A2, spec-given).
 */
export const V6_SUB_BRANCH_PHRASING = Object.freeze({
  [V6_SUB_BRANCHES.HANDOFF_A]:
    '昨天你停在這裡——『[anchor / takeaway_term]』 今天、想從哪裡接著走?我會跟著你的節奏。',
  [V6_SUB_BRANCHES.HANDOFF_C]:
    '我看到你回來了。你準備好的時候、我們繼續走——也可以先停在這、聊輕一點的。 你想怎麼開始?',
  [V6_SUB_BRANCHES.SI_RISK_PASSIVE]:
    '在我們開始前——上次我們聊到的那個 [feeling/state]、現在還在嗎?不論是還是不是、都可以告訴我。\n'
  + '1925 仍在那裡、24 小時、不需要『真的要做什麼』才能打。',
  [V6_SUB_BRANCHES.CROSS_COUNT_3_PLUS]:
    '我看到你回來了。過去幾次、你提過類似的——我必須跟你直接說:這個我們不能輕輕帶過。\n'
  + 'Vivi 知道你的狀況。她會直接聯絡你。\n'
  + '在那之前——你今天、現在這個時刻、安全嗎?',
});

// ─────────────────────────────────────────────────────────
// A3 — Takeaway mode-aware phrasing
// ─────────────────────────────────────────────────────────

export const TAKEAWAY_MODE_PHRASING = Object.freeze({
  // crisis disable — no takeaway, crisis closure inject instead.
  crisis_closure:
    '我記著你在這裡。你準備好的時候、回來就行。',
  // elicitation — seed Top 1 candidate.
  elicitation:
    '你今天說了『[candidate term]』。\n這個你帶著走。明天從這裡繼續、現在不解釋、不延伸。',
  // identity_anchoring owned — seed quality-as-identity.
  identity_anchoring:
    '『[quality]』現在是你的。\n不需要每天檢查、它就在那。',
  // integration — seed reframe anchor or reconciliation phrase.
  integration:
    '你今天讓『[reframe anchor]』成形了。\n這個帶著走、明天再回來、它仍會在那裡。',
  // cascade — seed progress note for Top 2/3.
  cascade:
    '今天 cascade 走到『[progress]』。\n明天從這裡接、不需要從頭。',
  // future_pacing — R7_C Let It Go Ritual (library §8.5 verbatim, Step 7 PR-7a 接管).
  // 完整 ritual 由 selectTakeawayPhrasing 經 R7.buildInject 動態建構; 此 fallback
  // 短句保留給 unit tests + 安全 default (library import 失敗等場景).
  future_pacing:
    '身體記得、頭腦不一定要記得。\n[quality] 現在是你的。如果某天 fade、也不需要焦慮。',
});

/**
 * Decide takeaway phrasing per primary_mode + crisis state.
 * Crisis in primary OR active_modes → disable normal takeaway, return crisis closure.
 *
 * @param {object} sessionState
 * @returns {{ phrasing: string, mode_key: string, takeaway_term: string|null, crisis_disabled: boolean }}
 */
export function selectTakeawayPhrasing(sessionState = {}) {
  const modeRead = readModeState(sessionState);
  const primary = modeRead.primary_mode;
  const activeModes = modeRead.active_modes || [];
  const crisisActive = primary === ACTIVE_MODES.CRISIS
    || activeModes.includes(ACTIVE_MODES.CRISIS);

  if (crisisActive) {
    return {
      phrasing: TAKEAWAY_MODE_PHRASING.crisis_closure,
      mode_key: 'crisis_closure',
      takeaway_term: null,    // per spec: takeaway_term=null when crisis-disabled
      crisis_disabled: true,
    };
  }

  // Map primary_mode → phrasing key.
  const key = primary || ACTIVE_MODES.ELICITATION;
  const takeawayTerm = deriveTakeawayTerm(sessionState);

  // ⭐ Step 7 PR-7a — future_pacing 走 R7_C Let It Go Ritual (library §8.5 verbatim).
  //   Replaces the placeholder short phrasing TODO with full ritual. R7_C is the
  //   program-close anchor — only fires when key === future_pacing.
  if (key === ACTIVE_MODES.FUTURE_PACING && takeawayTerm) {
    const r7cBody = R7.buildInject({
      variant: R7_VARIANTS.R7_C,
      quality: takeawayTerm,
      mode: 'future_pacing',
    });
    return {
      phrasing: r7cBody,
      mode_key: key,
      takeaway_term: takeawayTerm,
      crisis_disabled: false,
      reframe_invoked: 'R7_C',
    };
  }

  return {
    phrasing: TAKEAWAY_MODE_PHRASING[key] || TAKEAWAY_MODE_PHRASING.elicitation,
    mode_key: key,
    takeaway_term: takeawayTerm,
    crisis_disabled: false,
  };
}

/**
 * F2 — derive takeaway term per priority (reframe success anchor > quality candidate).
 * F2 dedup vs last_takeaway_planted (same phrase >= 2 → caller swaps).
 */
export function deriveTakeawayTerm(sessionState = {}) {
  // 1. Reframe success anchor (highest priority).
  const reframeHistory = Array.isArray(sessionState.reframe_invocation_history_in_session)
    ? sessionState.reframe_invocation_history_in_session : [];
  const lastSuccess = reframeHistory.filter(r =>
    r && r.outcome === 'success' && typeof r.anchor_phrase_if_success === 'string'
    && r.anchor_phrase_if_success.length > 0
  ).slice(-1)[0];
  if (lastSuccess) return lastSuccess.anchor_phrase_if_success;
  // 2. Top 1 / quality candidate.
  return sessionState.top1_value
    || sessionState.current_quality_candidate_term
    || null;
}

/**
 * F2 dedup check — same takeaway term used twice in a row? Caller can swap to
 * alternative (next priority).
 */
export function isTakeawayDuplicate(candidate, lastTakeawayPlanted) {
  if (typeof candidate !== 'string' || typeof lastTakeawayPlanted !== 'string') return false;
  return candidate === lastTakeawayPlanted;
}

// ─────────────────────────────────────────────────────────
// A4 — Cross-session anchor write (last_session_day_summary new schema)
// ─────────────────────────────────────────────────────────

/**
 * Build the v5.1 last_session_day_summary patch per errata §A4 new schema.
 * Caller drains at session close (e4TakeawayHandler).
 *
 * @param {object} args
 * @returns {object} - last_session_day_summary patch
 */
export function buildLastSessionDaySummary({
  sessionState = {},
  takeawayResult = {},     // from selectTakeawayPhrasing
  endedNaturally = true,
  hardLimitHit = false,
}) {
  const modeRead = readModeState(sessionState);
  return {
    primary_mode:    modeRead.primary_mode,
    active_modes:    modeRead.active_modes,
    paused_modes:    modeRead.paused_modes,
    ended_naturally: !!endedNaturally,
    hard_limit_hit:  !!hardLimitHit,
    takeaway_term:   takeawayResult.takeaway_term,    // null when crisis-disabled
    anchors_referenced: Array.isArray(sessionState.anchors_referenced_this_session)
      ? sessionState.anchors_referenced_this_session : [],
    reframe_invocation_history_in_session: Array.isArray(sessionState.reframe_invocation_history_in_session)
      ? sessionState.reframe_invocation_history_in_session : [],
    crisis_in_progress_at_close: modeRead.primary_mode === ACTIVE_MODES.CRISIS
      || !!sessionState.crisis_in_progress,
    last_quality_status: sessionState.current_quality_status || null,
    cascade_completed: !!(sessionState.cascade_down_progress
      && sessionState.cascade_down_progress.status === 'completed'),
  };
}

/**
 * Build crisis_state_carry_forward patch (per Checkpoint 1 v2 §10.5).
 * Step 6 fields (si_risk_level / protective_factor_surfaced / safety_plan /
 *   next_session_focus / resolution_type) left null with TODO.
 *
 * Caller invokes at session close IF this session triggered crisis.
 *
 * @param {object} sessionState
 * @returns {object|null} - carry_forward object OR null if no crisis triggered
 */
export function buildCrisisCarryForward(sessionState = {}) {
  const flags = sessionState.deep_signal_flags || {};
  const triggered = !!(flags.passive_dw_detected || flags.trauma_marker_detected
    || flags.worth_fiction_detected || sessionState.crisis_in_progress);
  if (!triggered) return null;
  // Derive category from deep_signal_flags.
  let category = 'unknown';
  if (flags.passive_dw_detected) {
    category = `passive_dw_${flags.passive_dw_signal || 'strong'}_${flags.passive_dw_variant || 'unknown'}`;
  } else if (flags.trauma_marker_detected) {
    category = 'trauma_marker';
  } else if (flags.worth_fiction_detected) {
    category = 'worth_fiction';
  }
  return {
    crisis_triggered_at: new Date().toISOString(),
    crisis_category: category,
    handoff_choice: sessionState.handoff_choice || null,   // populated by handoff_escalation if learner picked
    protective_factor_surfaced: null,    // TODO(Step 6) Crisis Mode SOP
    si_risk_level:               null,    // TODO(Step 6) — populated by SI Risk Assessment SOP
    safety_plan:                 null,    // TODO(Step 6)
    next_session_focus:          null,    // TODO(Step 6)
    resolved_at:                 null,    // null = unresolved (drives V6 trigger)
    resolution_type:             null,    // TODO(Step 6) — 'natural_de_escalation' | 'vivi_handoff_resolved'
    // Marker for auto-resolve logic below.
    sessions_since_trigger: 0,
  };
}

/**
 * v5.1 §A4 auto-resolve logic — 連續 3 session 無 crisis re-trigger → 自動 resolved.
 *
 * @param {object} prevCarryForward  - prior carry_forward from user_profile
 * @param {boolean} crisisTriggeredThisSession
 * @returns {object|null}            - updated carry_forward OR resolved version (resolved_at set)
 */
export function updateCarryForwardOnSessionClose(prevCarryForward, crisisTriggeredThisSession) {
  if (!prevCarryForward || typeof prevCarryForward !== 'object') return null;
  if (prevCarryForward.resolved_at) return prevCarryForward;   // already resolved, no change

  if (crisisTriggeredThisSession) {
    // Re-trigger — reset sessions_since_trigger counter.
    return { ...prevCarryForward, sessions_since_trigger: 0 };
  }

  // No re-trigger this session — increment counter.
  const next = (prevCarryForward.sessions_since_trigger || 0) + 1;
  if (next >= 3) {
    // Auto-resolve via natural de-escalation.
    return {
      ...prevCarryForward,
      sessions_since_trigger: next,
      resolved_at: new Date().toISOString(),
      resolution_type: 'natural_de_escalation',
    };
  }
  return { ...prevCarryForward, sessions_since_trigger: next };
}
