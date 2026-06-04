// lib/prompt-sections/conditional/engine-3/index.js
// 引擎 3: 4.7 中央路由器 — 5 個互斥 conditional inject 子路由器
// 全部 trigger_event='user_turn'、priority 升序排序：
//   deep_signal (20) > elicitation (30) > top1_judge (40) > mode_transition (50) > cascade_mode (60)
// E3 全部優先級在 E1 (10) 之後、E2 (70) 之前
//
// PR-23s4b 改名 (per v51_engine_3_errata_v02.md task 1):
//   opening-branch-router → elicitation-router (id: E3_opening_branch_router → E3_elicitation_router)
//   top1-determination    → top1-judge          (id: E3_top1_determination → E3_top1_judge)
//   status-router         → mode-transition-router (id: E3_status_router → E3_mode_transition_router)
//   cascade-down-validator → cascade-mode-validator (id: E3_cascade_down_validator → E3_cascade_mode_validator)

import deepSignalDetector  from './deep-signal-detector.js';
import elicitationRouter   from './elicitation-router.js';
import top1Judge           from './top1-judge.js';
import modeTransitionRouter from './mode-transition-router.js';
import cascadeModeValidator from './cascade-mode-validator.js';

export const ENGINE_3_SUB_ROUTERS = Object.freeze([
  deepSignalDetector,
  elicitationRouter,
  top1Judge,
  modeTransitionRouter,
  cascadeModeValidator,
]);

export {
  deepSignalDetector,
  elicitationRouter,
  top1Judge,
  modeTransitionRouter,
  cascadeModeValidator,
};
