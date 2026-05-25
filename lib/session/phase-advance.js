// lib/session/phase-advance.js
// Phase 推進決策 — 純函數模組（full、不 stub）
//
// 5/25 上架前 (spec 09 §12)：對話 phase 改天數驅動 — phaseForDay()。
//   checkAdvance 判定式狀態機因 codebase 沒寫入 top1_value / router_phase==='identity_test_routing'
//   等欄位 → 永遠卡 phase_1（= v4 鬼打牆）。每 4 天前進一階是新的單一決策軸。
//
// 對齊：CP1 turn 1 §6.3 / §7.3 + turn 2 §8.3 / §9.7 / §10 + turn 3 §12.3 (legacy)

import {
  canTransitionPhase, canTransitionPhaseWithRegression,
} from './phase-machine.js';

// ─────────────────────────────────────────────────────────
// v5.0 天數驅動「對話 phase」（spec 09 §12 拍板）
// ─────────────────────────────────────────────────────────

/**
 * v5.0 天數驅動「對話 phase」（取代 checkAdvance 判定式狀態機、見 spec 09 §12）。
 * 每 4 天前進一階；Day 21+ → integration_retention。
 * @param {number} sessionDay 1-based session day
 * @returns {string} canonical current_phase
 */
export function phaseForDay(sessionDay) {
  const d = Number(sessionDay);
  if (!Number.isFinite(d) || d <= 4) return 'phase_1';
  if (d <= 8)  return 'phase_2';
  if (d <= 12) return 'phase_3a';
  if (d <= 16) return 'phase_4';
  if (d <= 20) return 'phase_5';
  return 'integration_retention';   // Day 21+
}

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

// ⚠️ DEPRECATED v5.0（5/25）：phase 改天數驅動、見 phaseForDay。
//    此函式不再 wire 進 runtime（api/chat.js Step 5b 改 phaseForDay）、
//    保留供參考/測試。判定式狀態機的 exit conditions 仍記錄了 v5.0 想要的
//    phase 推進「該長什麼樣」、未來如果要回 condition-driven 可從這裡撿回。
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
