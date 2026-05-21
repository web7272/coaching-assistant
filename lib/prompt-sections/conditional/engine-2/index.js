// lib/prompt-sections/conditional/engine-2/index.js
// 引擎 2: 身份測試判決 — pipeline 結構
//
// pipeline: master → aggregator → upgrade/stay/continue (互斥、依 doors_passed)
// 只有 master_detector 註冊 (trigger_event='user_turn', priority=70)、
// skip_if = deviation_handled_this_turn != null (E1 處理偏離中跳過)

import masterDetector from './master-detector.js';
import aggregator from './aggregator.js';
import upgradeToOwned from './upgrade-to-owned.js';
import stayCandidate from './stay-candidate.js';
import continueElicitation from './continue-elicitation.js';

export const ENGINE_2_PIPELINE = Object.freeze({
  master:     masterDetector,
  aggregator: aggregator,
  sub_prompts: Object.freeze({
    upgrade:  upgradeToOwned,
    stay:     stayCandidate,
    continue: continueElicitation,
  }),
});

export {
  masterDetector,
  aggregator,
  upgradeToOwned,
  stayCandidate,
  continueElicitation,
};
