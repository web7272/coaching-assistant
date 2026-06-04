// lib/prompt-sections/conditional/engine-3/index.js
// 引擎 3: 4.7 中央路由器 — 7 個互斥 conditional inject 子路由器
// 全部 trigger_event='user_turn'、priority 升序排序：
//   deep_signal (20) > elicitation (30) > top1_judge (40) > integration (45)
//     > mode_transition (50) > cascade_mode (60) > future_pacing (65)
// E3 全部優先級在 E1 (10) 之後、E2 (70) 之前.
//
// PR-23s4b 改名 (per v51_engine_3_errata_v02.md task 1):
//   opening-branch-router → elicitation-router
//   top1-determination    → top1-judge
//   status-router         → mode-transition-router
//   cascade-down-validator → cascade-mode-validator
//
// PR-23s4c 新增 (task 2):
//   integration-router (45)      — integration mode toolbox dispatcher
//   future-pacing-router (65)    — future_pacing mode dispatcher

import deepSignalDetector   from './deep-signal-detector.js';
import elicitationRouter    from './elicitation-router.js';
import top1Judge            from './top1-judge.js';
import integrationRouter    from './integration-router.js';   // PR-23s4c
import modeTransitionRouter from './mode-transition-router.js';
import cascadeModeValidator from './cascade-mode-validator.js';
import futurePacingRouter   from './future-pacing-router.js'; // PR-23s4c

export const ENGINE_3_SUB_ROUTERS = Object.freeze([
  deepSignalDetector,
  elicitationRouter,
  top1Judge,
  integrationRouter,        // PR-23s4c
  modeTransitionRouter,
  cascadeModeValidator,
  futurePacingRouter,       // PR-23s4c
]);

export {
  deepSignalDetector,
  elicitationRouter,
  top1Judge,
  integrationRouter,        // PR-23s4c
  modeTransitionRouter,
  cascadeModeValidator,
  futurePacingRouter,       // PR-23s4c
};
