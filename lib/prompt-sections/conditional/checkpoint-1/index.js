// lib/prompt-sections/conditional/checkpoint-1/index.js
// CP1 (21 天 daily session 結構) sub-prompts 聚合
//
// 18 個檔案、5 種 dispatch_mode:
//   - phase_context     (phase 內 step 觸發、依 current_phase + sub_step)
//   - phase_transition  (phase 邊界過渡、依 transition trigger)
//   - phase_mode_block  (mode 啟用時 inject 進 dynamic context)
//   - scenario_inject   (附錄 C 情境觸發)
//
// chat.js (PR-4b) 用 current_phase + sub_step 或 scenario flag 選對應 sub-prompt
// (CP1 sub-prompts 不直接 register 到 detector registry — 它們是 phase context)

// ── Phase 1: Values Elicitation ──
import phase1OpeningAndElicitation from './phase-1/opening-and-elicitation.js';
import phase1GoalAlignmentTest from './phase-1/goal-alignment-test.js';

// ── Phase 2: Identity Test ──
import phase2InitiateIdentityTest from './phase-2/initiate-identity-test.js';

// ── Phase 3a: Owned Path (Build Vision) ──
import phase3aBuildVision from './phase-3a/build-vision.js';
import phase3aCheckResistance from './phase-3a/check-resistance.js';
import phase3aLetItWork from './phase-3a/let-it-work.js';

// ── Phase 3b: Ambiguous Path (Self-Concept Model、含 2 原創 IP) ──
import phase3bMappingAcross from './phase-3b/mapping-across.js';
import phase3bCounterExampleIntegration from './phase-3b/counter-example-integration.js';  // ⭐ 東方文化 IP #2
import phase3bThreeWayTriangulation from './phase-3b/three-way-triangulation.js';          // ⭐⭐ 原創 IP #3
import phase3bScopeOverlap from './phase-3b/scope-overlap.js';                              // ⭐⭐ 原創 IP #1

// ── Phase 4: Cascade Down ──
import phase4MiniSelfConcept from './phase-4/mini-self-concept.js';

// ── Phase 5: Future Pacing + Let it Go + Export ──
import phase5FuturePacing from './phase-5/future-pacing-comprehensive.js';
import phase5LetItGo from './phase-5/let-it-go.js';
import phase5ExportGuidance from './phase-5/export-guidance.js';

// ── Integration Retention Mode ──
import integrationRetentionBlock from './integration-retention/retention-mode-block.js';

// ── Transitions ──
import transition3bTo3aSimplified from './transitions/phase-3b-to-3a-simplified.js';
import transition3bTo4Acceptance from './transitions/phase-3b-to-4-acceptance.js';
import transition3aTo3bRegression from './transitions/phase-3a-to-3b-regression.js';

// ── Appendix C: 5.7.4 原創情境 ──
import appendixCTopicResistance from './appendix-c/topic-resistance.js';                    // C.2.1
import appendixCMidSessionEnd from './appendix-c/mid-session-end.js';                       // C.2.2

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
  transitions: Object.freeze({
    phase_3b_to_3a_simplified: transition3bTo3aSimplified,
    phase_3b_to_4_acceptance:  transition3bTo4Acceptance,
    phase_3a_to_3b_regression: transition3aTo3bRegression,
  }),
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
  transition3bTo3aSimplified, transition3bTo4Acceptance, transition3aTo3bRegression,
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
  transition3bTo3aSimplified, transition3bTo4Acceptance, transition3aTo3bRegression,
  appendixCTopicResistance, appendixCMidSessionEnd,
};
