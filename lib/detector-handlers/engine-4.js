// lib/detector-handlers/engine-4.js
// 引擎 4 AI 主動引用 — 4 個 lifecycle handler
//   day_opening   → trigger_event: new_session_day
//   takeaway      → trigger_event: session_end
//   cascade_ref   → trigger_event: paired (paired_with E3_cascade_down_validator)
//   export        → trigger_event: program_milestone
//
// E4 是 consumer 端、handler 主要 = inject + patch（不做 detection cascade）。
// takeaway sentiment（A6 judge）在收尾後評估 → finalize-day.js（PR-4c）負責、本檔不 call。

import {
  dayOpeningSelector, takeawayPlanter, cascadeDownReference, exportPersonalCoachPrompt,
} from '../prompt-sections/conditional/engine-4/index.js';

// ─────────────────────────────────────────────────────────
// E4 day_opening_reference_selector (new_session_day)
// ─────────────────────────────────────────────────────────

export async function e4DayOpeningHandler(ctx) {
  const profile = ctx.user_profile || {};
  // trigger condition: 任一 user-scoped 持久資產非空
  const hasAssets = (Array.isArray(profile.anchors) && profile.anchors.length > 0)
    || (Array.isArray(profile.quality_focus_history) && profile.quality_focus_history.length > 0)
    || profile.top1_value != null;

  if (!hasAssets) {
    // Day 1 first session: 無資產、不觸發、主對話 LLM 正常開場
    return { handled: false };
  }

  return {
    handled: true,
    inject: dayOpeningSelector.prompt_content,
    patch: { router_phase: 'opening' },
  };
}

// ─────────────────────────────────────────────────────────
// E4 takeaway_planter (session_end)
// ─────────────────────────────────────────────────────────

export async function e4TakeawayHandler(ctx) {
  const state = ctx.session_state || {};
  if (state.takeaway_seeded_this_session) {
    // 已種過、不重複
    return { handled: false };
  }
  return {
    handled: true,
    inject: takeawayPlanter.prompt_content,
    patch: { takeaway_seeded_this_session: true },
  };
}

// ─────────────────────────────────────────────────────────
// E4 cascade_down_reference (paired with E3_cascade_down_validator)
// ─────────────────────────────────────────────────────────

export async function e4CascadeRefHandler(ctx) {
  const state = ctx.session_state || {};
  // paired: 只在 cascade_down + testing 時提供過渡引用
  if (state.router_phase !== 'cascade_down') return { handled: false };
  return {
    handled: true,
    inject: cascadeDownReference.prompt_content,
    patch: {},
  };
}

// ─────────────────────────────────────────────────────────
// E4 export_personal_coach_prompt (program_milestone)
// ─────────────────────────────────────────────────────────

export async function e4ExportHandler(ctx) {
  return {
    handled: true,
    inject: exportPersonalCoachPrompt.prompt_content,
    patch: { export_prompt_generated_at: new Date().toISOString() },
  };
}

// detector definitions
export const E4_DETECTORS = Object.freeze([
  { id: dayOpeningSelector.id,       type: dayOpeningSelector.type,       trigger_event: 'new_session_day',   handler: e4DayOpeningHandler },
  { id: takeawayPlanter.id,          type: takeawayPlanter.type,          trigger_event: 'session_end',       handler: e4TakeawayHandler },
  { id: cascadeDownReference.id,     type: cascadeDownReference.type,     trigger_event: 'paired',            paired_with: 'E3_cascade_down_validator', handler: e4CascadeRefHandler },
  { id: exportPersonalCoachPrompt.id, type: exportPersonalCoachPrompt.type, trigger_event: 'program_milestone', handler: e4ExportHandler },
]);
