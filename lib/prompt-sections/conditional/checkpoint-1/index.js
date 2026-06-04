// lib/prompt-sections/conditional/checkpoint-1/index.js
// CP1 (21 天 daily session 結構) sub-prompts 聚合
//
// PR-23s4c task 5 directory reorg (Vivi 6/4):
//   實體檔案搬到 lib/sub-prompts/{mode}/, 本 index 改 re-export wrapper.
//   不改稿 — file 內容文字一字不動 (Vivi 6/4 「搬家不改稿」).
//   舊 group key (phase_1 / phase_2 / phase_3a / phase_3b / phase_4 / phase_5)
//   也保留 (避免 test churn), 同時新增 mode-named groups.
//
// 17 個檔案、5 種 dispatch_mode:
//   - phase_context     (mode 內 step 觸發、依 current_phase + sub_step)
//   - phase_transition  (廢除 PR-23s4b)
//   - phase_mode_block  (mode 啟用時 inject 進 dynamic context)
//   - scenario_inject   (附錄 C 情境觸發)
//
// CP1 sub-prompts 不直接 register 到 detector registry — 它們是 mode context.

// ── Elicitation mode (was phase-1) ──
import phase1OpeningAndElicitation from '../../../sub-prompts/elicitation/opening-and-elicitation.js';
import phase1GoalAlignmentTest from '../../../sub-prompts/elicitation/goal-alignment-test.js';

// ── Identity Anchoring mode (was phase-2) ──
import phase2InitiateIdentityTest from '../../../sub-prompts/identity_anchoring/initiate-identity-test.js';

// ── Integration mode (was phase-3a + phase-3b, unified per v5.1 toolbox) ──
import phase3aBuildVision from '../../../sub-prompts/integration/build-vision.js';
import phase3aCheckResistance from '../../../sub-prompts/integration/check-resistance.js';
import phase3aLetItWork from '../../../sub-prompts/integration/let-it-work.js';
import phase3bMappingAcross from '../../../sub-prompts/integration/mapping-across.js';
import phase3bCounterExampleIntegration from '../../../sub-prompts/integration/counter-example-integration.js';  // ⭐ 東方文化 IP #2
import phase3bThreeWayTriangulation from '../../../sub-prompts/integration/three-way-triangulation.js';          // ⭐⭐ 原創 IP #3
import phase3bScopeOverlap from '../../../sub-prompts/integration/scope-overlap.js';                              // ⭐⭐ 原創 IP #1

// ── Cascade mode (was phase-4) ──
import phase4MiniSelfConcept from '../../../sub-prompts/cascade/mini-self-concept.js';

// ── Future Pacing mode (was phase-5 + integration-retention) ──
import phase5FuturePacing from '../../../sub-prompts/future_pacing/future-pacing-comprehensive.js';
import phase5LetItGo from '../../../sub-prompts/future_pacing/let-it-go.js';
import phase5ExportGuidance from '../../../sub-prompts/future_pacing/export-guidance.js';
import integrationRetentionBlock from '../../../sub-prompts/future_pacing/retention-mode-block.js';

// ── Transitions ── ⚠️ PR-23s4b: transitions/ 廢除.

// ── Appendix C: 5.7.4 原創情境 ──
import appendixCTopicResistance from '../../../sub-prompts/appendix_c/topic-resistance.js';   // C.2.1
import appendixCMidSessionEnd from '../../../sub-prompts/appendix_c/mid-session-end.js';      // C.2.2

// ─────────────────────────────────────────────────────────
// Grouped exports by phase
// ─────────────────────────────────────────────────────────

export const CHECKPOINT_1_BY_PHASE = Object.freeze({
  phase_1: Object.freeze({
    opening_and_elicitation: phase1OpeningAndElicitation,
    goal_alignment_test:     phase1GoalAlignmentTest,
  }),
  phase_2: Object.freeze({
    initiate_identity_test:  phase2InitiateIdentityTest,
  }),
  phase_3a: Object.freeze({
    build_vision:            phase3aBuildVision,
    check_resistance:        phase3aCheckResistance,
    let_it_work:             phase3aLetItWork,
  }),
  phase_3b: Object.freeze({
    mapping_across:                phase3bMappingAcross,
    counter_example_integration:   phase3bCounterExampleIntegration,
    three_way_triangulation:       phase3bThreeWayTriangulation,
    scope_overlap:                 phase3bScopeOverlap,
  }),
  phase_4: Object.freeze({
    mini_self_concept:       phase4MiniSelfConcept,
  }),
  phase_5: Object.freeze({
    future_pacing:           phase5FuturePacing,
    let_it_go:               phase5LetItGo,
    export_guidance:         phase5ExportGuidance,
  }),
  integration_retention: Object.freeze({
    retention_mode_block:    integrationRetentionBlock,
  }),
  // transitions: 廢除 (PR-23s4b).
  // owned_via_acceptance 路徑由 mode-transition-router 接管;
  // 3a/3b regression / simplified 概念退役.
  appendix_c: Object.freeze({
    topic_resistance:        appendixCTopicResistance,
    mid_session_end:         appendixCMidSessionEnd,
  }),
});

// ─────────────────────────────────────────────────────────
// Flat array of all CP1 sub-prompts (tests + introspection)
// ─────────────────────────────────────────────────────────

export const ALL_CHECKPOINT_1_SUB_PROMPTS = Object.freeze([
  phase1OpeningAndElicitation, phase1GoalAlignmentTest,
  phase2InitiateIdentityTest,
  phase3aBuildVision, phase3aCheckResistance, phase3aLetItWork,
  phase3bMappingAcross, phase3bCounterExampleIntegration,
  phase3bThreeWayTriangulation, phase3bScopeOverlap,
  phase4MiniSelfConcept,
  phase5FuturePacing, phase5LetItGo, phase5ExportGuidance,
  integrationRetentionBlock,
  // transitions retired (PR-23s4b).
  appendixCTopicResistance, appendixCMidSessionEnd,
]);

// ─────────────────────────────────────────────────────────
// 2 v5.0 原創 IPs + 1 東方文化 IP — explicit named exports for review
// ─────────────────────────────────────────────────────────

export const ORIGINAL_IP_SUB_PROMPTS = Object.freeze({
  scope_overlap:           phase3bScopeOverlap,            // IP #1
  east_asian_softening:    phase3bCounterExampleIntegration, // IP #2
  three_way_triangulation: phase3bThreeWayTriangulation,    // IP #3
});

export {
  phase1OpeningAndElicitation, phase1GoalAlignmentTest,
  phase2InitiateIdentityTest,
  phase3aBuildVision, phase3aCheckResistance, phase3aLetItWork,
  phase3bMappingAcross, phase3bCounterExampleIntegration,
  phase3bThreeWayTriangulation, phase3bScopeOverlap,
  phase4MiniSelfConcept,
  phase5FuturePacing, phase5LetItGo, phase5ExportGuidance,
  integrationRetentionBlock,
  // transitions retired (PR-23s4b).
  appendixCTopicResistance, appendixCMidSessionEnd,
};
