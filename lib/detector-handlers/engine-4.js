// lib/detector-handlers/engine-4.js
// 引擎 4 AI 主動引用 — 4 個 lifecycle handler
//   day_opening   → trigger_event: new_session_day
//   takeaway      → trigger_event: session_end
//   cascade_ref   → trigger_event: paired (paired_with E3_cascade_mode_validator)
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
  // trigger condition: 任一「昨天有東西」訊號非空
  //   PR-4c-green bug 3 fix — 原 gate 只看 anchors / quality_focus_history / top1_value，
  //   Day 2 fresh student 只有 daily_takeaways（quality 還沒升 owned）→ gate 拒、
  //   handler skip、主 LLM 看到 phase_1 opening variant 起手式 → 鬼打牆每天重開場。
  //   修：把 daily_takeaways + last_session_day_summary.last_takeaway_term 也算「資產」。
  //   Day 1 first session（無 prior session、無 takeaway）→ 仍正常 fall-through 到 phase_1 起手式。
  const lastSummary = (profile.last_session_day_summary && typeof profile.last_session_day_summary === 'object')
    ? profile.last_session_day_summary : {};
  const hasAssets =
       (Array.isArray(profile.anchors) && profile.anchors.length > 0)
    || (Array.isArray(profile.quality_focus_history) && profile.quality_focus_history.length > 0)
    || profile.top1_value != null
    || (Array.isArray(profile.daily_takeaways) && profile.daily_takeaways.length > 0)
    || (typeof lastSummary.last_takeaway_term === 'string' && lastSummary.last_takeaway_term.length > 0);

  if (!hasAssets) {
    // Day 1 first session: 無資產、不觸發、主對話 LLM 正常開場
    return { handled: false };
  }

  return {
    handled: true,
    inject: dayOpeningSelector.prompt_content,
    // PR-4c-green E4 fix — day_opening_inject_active suppresses the competing
    // phase_1.opening 起手式 in contextFor (see lib/session/phase-context.js).
    // Cleared by maybeAutoTransitionRouterPhase post-LLM so it doesn't linger
    // into turn 2 (which uses phase_1.elicitation 鏈式追問).
    patch: { router_phase: 'opening', day_opening_inject_active: true },
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
// E4 cascade_down_reference (paired with E3_cascade_mode_validator)
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
  { id: cascadeDownReference.id,     type: cascadeDownReference.type,     trigger_event: 'paired',            paired_with: 'E3_cascade_mode_validator', handler: e4CascadeRefHandler },
  { id: exportPersonalCoachPrompt.id, type: exportPersonalCoachPrompt.type, trigger_event: 'program_milestone', handler: e4ExportHandler },
]);
