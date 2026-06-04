// lib/prompt-sections/conditional/index.js
// 4 engines 全部 conditional prompt-sections 聚合
//
// PR-4b chat.js 用此 module 拿到所有 sub-prompts、註冊到 detector registry。
//
// 全部 detector 一覽（registry 直接 register 的、含 priority / lifecycle）:
//
// user_turn cascade (priority 升序):
//   10  E1_deviation_master_detector
//   20  E3_deep_signal_detector
//   30  E3_elicitation_router
//   40  E3_top1_judge
//   50  E3_mode_transition_router
//   60  E3_cascade_mode_validator
//   70  E2_identity_test_master_detector  (skip_if = deviation_handled_this_turn != null)
//
// lifecycle events:
//   new_session_day   → E4_day_opening_reference_selector
//   session_end       → E4_takeaway_planter
//   paired            → E4_cascade_down_reference (paired_with: E3_cascade_mode_validator)
//   program_milestone → E4_export_personal_coach_prompt
//
// pipeline internal (不直接 register、由父 detector handler 調用):
//   E1_subtype_classifier (parent: E1_deviation_master_detector)
//   E1a/b/c/d (parent: E1_subtype_classifier)
//   E2_aggregator (parent: E2_identity_test_master_detector)
//   E2_upgrade/stay/continue (parent: E2_aggregator)

import { ENGINE_1_PIPELINE } from './engine-1/index.js';
import { ENGINE_2_PIPELINE } from './engine-2/index.js';
import { ENGINE_3_SUB_ROUTERS } from './engine-3/index.js';
import { ENGINE_4_COMPONENTS } from './engine-4/index.js';

export {
  ENGINE_1_PIPELINE,
  ENGINE_2_PIPELINE,
  ENGINE_3_SUB_ROUTERS,
  ENGINE_4_COMPONENTS,
};

/**
 * All sub-prompt modules that should be DIRECTLY registered to detector registry.
 * (Pipeline internals not included — they're invoked by master handlers.)
 */
export const DIRECTLY_REGISTERED_DETECTORS = Object.freeze([
  // E1
  ENGINE_1_PIPELINE.master,
  // E3 (5 子路由器、全 user_turn)
  ...ENGINE_3_SUB_ROUTERS,
  // E2
  ENGINE_2_PIPELINE.master,
  // E4 (4 lifecycle / paired)
  ENGINE_4_COMPONENTS.day_opening,
  ENGINE_4_COMPONENTS.takeaway,
  ENGINE_4_COMPONENTS.cascade_ref,
  ENGINE_4_COMPONENTS.export,
]);

/**
 * All sub-prompt modules including pipeline internals (for testing / introspection).
 */
export const ALL_PROMPT_SECTIONS = Object.freeze([
  // E1 (6)
  ENGINE_1_PIPELINE.master,
  ENGINE_1_PIPELINE.classifier,
  ENGINE_1_PIPELINE.sub_prompts.E1a,
  ENGINE_1_PIPELINE.sub_prompts.E1b,
  ENGINE_1_PIPELINE.sub_prompts.E1c,
  ENGINE_1_PIPELINE.sub_prompts.E1d,
  // E2 (5)
  ENGINE_2_PIPELINE.master,
  ENGINE_2_PIPELINE.aggregator,
  ENGINE_2_PIPELINE.sub_prompts.upgrade,
  ENGINE_2_PIPELINE.sub_prompts.stay,
  ENGINE_2_PIPELINE.sub_prompts.continue,
  // E3 (5)
  ...ENGINE_3_SUB_ROUTERS,
  // E4 (4)
  ENGINE_4_COMPONENTS.day_opening,
  ENGINE_4_COMPONENTS.takeaway,
  ENGINE_4_COMPONENTS.cascade_ref,
  ENGINE_4_COMPONENTS.export,
]);
