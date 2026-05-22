// lib/session/phase-advance.js
// Phase 推進決策 — 純函數模組（full、不 stub）
//
// checkAdvance(state) → { patch } | null
//   依 CP1 exit conditions 判斷是否推進 current_phase、回 state patch。
//   含 forward 推進 + 2 個 regression（P10 phase_3a→3b / 3b→3a simplified）。
//
// ⚠️ Q1 patch（5/21 errata）：phase exit 時 reset mid_session_takeaway_count（phase-scoped、
//    不是 cross-day reset；day-boundary RESET_FIELDS 已移除此欄位）。
//
// 對齊：CP1 turn 1 §6.3 / §7.3 + turn 2 §8.3 / §9.7 / §10 + turn 3 §12.3

import {
  canTransitionPhase, canTransitionPhaseWithRegression,
} from './phase-machine.js';

// ─────────────────────────────────────────────────────────
// phase entry state initializer
// 進入新 phase 時、重置 phase-scoped 欄位（含 Q1 mid_session_takeaway_count）
// ─────────────────────────────────────────────────────────

/**
 * Build the entry-state patch for a phase. Resets phase-scoped progress fields.
 * @param {string} nextPhase
 * @returns {object}
 */
export function phaseEntryPatch(nextPhase) {
  const patch = {
    current_phase: nextPhase,
    // ⭐ Q1 patch: mid_session_takeaway_count 是 phase-scoped、phase exit 時 reset
    mid_session_takeaway_count: 0,
  };

  // phase progress 物件 re-init（per CP1 §8.6 / §9.8）
  if (nextPhase === 'phase_3a') {
    patch.build_vision_progress = {
      step: 'step_1_build_vision',
      vision_components: [],
      resistance_detected: false,
      resistance_type: null,
      resistance_resolved: false,
    };
  }
  if (nextPhase === 'phase_3b') {
    patch.self_concept_progress = {
      sub_step: 'mapping_across',
      findings_template_filled: false,
      reference_quality: null,
      reference_scenarios: [],
      reference_submodalities: [],
      mapping_differences: [],
      counter_examples_count: 0,
      triangulation_completed: false,
      triangulation_results: [],
      scope_overlap_applied: false,
      expanded_definition: null,
    };
  }
  return patch;
}

// ─────────────────────────────────────────────────────────
// exit condition evaluators (per phase)
// 回 { to, regressionReason? } | null
// ─────────────────────────────────────────────────────────

function exitFromPhase1(s) {
  // CP1 §6.3: top1_value 確定 + Goal Alignment Test 通過
  // 可用 state 訊號: top1_value != null + router_phase 已切到 identity_test_routing
  if (s.top1_value != null && s.router_phase === 'identity_test_routing') {
    return { to: 'phase_2' };
  }
  return null;
}

function exitFromPhase2(s) {
  // CP1 §7.3: current_quality_status 確定
  if (s.current_quality_status === 'owned') return { to: 'phase_3a' };
  if (s.current_quality_status === 'ambiguous') return { to: 'phase_3b' };
  return null;
}

function exitFromPhase3a(s) {
  // P10 regression: build_vision_progress.p10_regression flag
  if (s.build_vision_progress?.p10_regression === true) {
    return { to: 'phase_3b', regressionReason: 'p10_regression' };
  }
  // CP1 §8.3: Let it Work 完成 + takeaway 種下
  if (s.build_vision_progress?.step === 'step_3_let_it_work' && s.takeaway_seeded_this_session === true) {
    return { to: 'phase_4' };
  }
  return null;
}

function exitFromPhase3b(s) {
  // CP1 §10.1: Scope Overlap 升級 owned → Phase 3a Simplified
  if (s.self_concept_progress?.scope_overlap_applied === true && s.current_quality_status === 'owned') {
    return { to: 'phase_3a', regressionReason: 'scope_overlap_to_simplified' };
  }
  // CP1 §10.2: 接受 ambiguous → Phase 4
  if (s.current_quality_status === 'owned_via_acceptance') {
    return { to: 'phase_4' };
  }
  return null;
}

function exitFromPhase4(s) {
  // CP1 §11.3: cascade_down_progress.status == "completed"
  if (s.cascade_down_progress?.status === 'completed') {
    return { to: 'phase_5' };
  }
  return null;
}

function exitFromPhase5(s) {
  // CP1 §12.3: export 完成
  if (s.export_prompt_generated_at != null) {
    if ((s.calendar_day_count || 0) >= 21) return { to: 'program_completed' };
    return { to: 'integration_retention' };
  }
  return null;
}

function exitFromIntegrationRetention(s) {
  // CP1 §4.4: calendar_day_count == 21 → program end
  if ((s.calendar_day_count || 0) >= 21) return { to: 'program_completed' };
  return null;
}

const EXIT_EVALUATORS = Object.freeze({
  phase_1: exitFromPhase1,
  phase_2: exitFromPhase2,
  phase_3a: exitFromPhase3a,
  phase_3b: exitFromPhase3b,
  phase_4: exitFromPhase4,
  phase_5: exitFromPhase5,
  integration_retention: exitFromIntegrationRetention,
  program_completed: () => null,  // terminal
});

// ─────────────────────────────────────────────────────────
// checkAdvance — main entry
// ─────────────────────────────────────────────────────────

/**
 * Check whether the current_phase should advance, given session_state.
 *
 * @param {object} state - session_state
 * @returns {{ patch: object, from: string, to: string, regression: boolean } | null}
 */
export function checkAdvance(state) {
  if (!state || typeof state !== 'object') return null;
  const from = state.current_phase;
  const evaluator = EXIT_EVALUATORS[from];
  if (!evaluator) return null;

  const exit = evaluator(state);
  if (!exit) return null;

  const { to, regressionReason } = exit;

  // validate transition
  const valid = regressionReason
    ? canTransitionPhaseWithRegression(from, to, regressionReason)
    : canTransitionPhase(from, to);
  if (!valid) {
    throw new Error(`phase-advance: illegal transition ${from} → ${to}${regressionReason ? ` (${regressionReason})` : ''}`);
  }

  return {
    patch: phaseEntryPatch(to),
    from,
    to,
    regression: !!regressionReason,
  };
}
