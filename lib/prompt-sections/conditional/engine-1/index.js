// lib/prompt-sections/conditional/engine-1/index.js
// 引擎 1: 對話偏離識別 — pipeline 結構
//
// pipeline: master → classifier → E1a/b/c/d (互斥、依 classifier 輸出)
// 只有 master_detector 註冊到 registry(trigger_event='user_turn', priority=10)
// 其他 5 個檔由 master 的 handler 透過 pipeline 內部調用

import masterDetector from './master-detector.js';
import subtypeClassifier from './subtype-classifier.js';
import e1aOffTopic from './e1a-off-topic.js';
import e1bVagueResponse from './e1b-vague-response.js';
import e1cPeoplePleasing from './e1c-people-pleasing.js';
import e1dSpiritualBypassing from './e1d-spiritual-bypassing.js';

export const ENGINE_1_PIPELINE = Object.freeze({
  master:     masterDetector,
  classifier: subtypeClassifier,
  sub_prompts: Object.freeze({
    E1a: e1aOffTopic,
    E1b: e1bVagueResponse,
    E1c: e1cPeoplePleasing,
    E1d: e1dSpiritualBypassing,
  }),
});

export {
  masterDetector,
  subtypeClassifier,
  e1aOffTopic,
  e1bVagueResponse,
  e1cPeoplePleasing,
  e1dSpiritualBypassing,
};
