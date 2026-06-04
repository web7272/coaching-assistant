// lib/prompt-sections/conditional/engine-4/index.js
// 引擎 4: AI 主動引用機制 — 4 個子組件
//
// 跟引擎 1-3 不同:E4 是 lifecycle event triggered (不在 user_turn cascade):
//   - day_opening_selector   → trigger_event: new_session_day
//   - takeaway_planter       → trigger_event: session_end
//   - cascade_down_reference → trigger_event: paired (E3_cascade_mode_validator)
//   - export                 → trigger_event: program_milestone (Day 21)

import dayOpeningSelector from './day-opening-selector.js';
import takeawayPlanter from './takeaway-planter.js';
import cascadeDownReference from './cascade-down-reference.js';
import exportPersonalCoachPrompt from './export-personal-coach-prompt.js';

export const ENGINE_4_COMPONENTS = Object.freeze({
  day_opening:    dayOpeningSelector,
  takeaway:       takeawayPlanter,
  cascade_ref:    cascadeDownReference,
  export:         exportPersonalCoachPrompt,
});

export {
  dayOpeningSelector,
  takeawayPlanter,
  cascadeDownReference,
  exportPersonalCoachPrompt,
};
