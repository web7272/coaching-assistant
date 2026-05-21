// lib/prompt-sections/conditional/engine-3/index.js
// 引擎 3: 4.7 中央路由器 — 5 個互斥 conditional inject 子路由器
// 全部 trigger_event='user_turn'、priority 升序排序：
//   deep_signal (20) > opening_branch (30) > top1 (40) > status (50) > cascade_down (60)
// E3 全部優先級在 E1 (10) 之後、E2 (70) 之前

import deepSignalDetector from './deep-signal-detector.js';
import openingBranchRouter from './opening-branch-router.js';
import top1Determination from './top1-determination.js';
import statusRouter from './status-router.js';
import cascadeDownValidator from './cascade-down-validator.js';

export const ENGINE_3_SUB_ROUTERS = Object.freeze([
  deepSignalDetector,
  openingBranchRouter,
  top1Determination,
  statusRouter,
  cascadeDownValidator,
]);

export {
  deepSignalDetector,
  openingBranchRouter,
  top1Determination,
  statusRouter,
  cascadeDownValidator,
};
