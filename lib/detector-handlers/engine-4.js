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
// v5.1 Step 5c — mode-aware helpers (V6 + takeaway + carry_forward).
import {
  selectDayOpeningVariant, V6_SUB_BRANCH_PHRASING, DAY_OPENING_VARIANTS,
  selectTakeawayPhrasing, buildLastSessionDaySummary,
  buildCrisisCarryForward, updateCarryForwardOnSessionClose,
} from './engine-4-mode-aware.js';
// 6/12 — Record R7 invocation when selectTakeawayPhrasing emits R7_C variant
// (future_pacing takeaway ritual). Reframe_id = 'R7' (per REFRAME_REGISTRY),
// variant = 'R7_C'.
import { buildInvocationPatch } from '../damon-reframe-library/invocation-tracker.js';

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

  // ⭐ v5.1 Step 5c — mode-aware variant selection + V6 crisis follow-up.
  //   V6 fires when crisis_state_carry_forward != null AND resolved_at == null
  //   (currently 「上線休眠」 — Step 6 carry_forward write 後才會觸發 in practice).
  //   V6 sub-branch phrasing is ship-able (spec §A2 內含全文).
  const variantPick = selectDayOpeningVariant({
    userProfile: profile,
    gapDays: Number(ctx.gap_days ?? 0),
    userResponseText: ctx.user_response || '',
  });
  let inject = dayOpeningSelector.prompt_content;
  if (variantPick.variant === DAY_OPENING_VARIANTS.V6 && variantPick.v6SubBranch) {
    const v6Phrase = V6_SUB_BRANCH_PHRASING[variantPick.v6SubBranch];
    inject = `${inject}\n\n---\n\n[SYSTEM INJECT — Day Opening V6 Crisis Follow-up (${variantPick.v6SubBranch})]\n\n話術 (spec §A2 內含, ship-able):\n> ${v6Phrase}\n\n機制:\n- V6 overrides all other variants (V1-V5 rules).\n- crisis_state_carry_forward.resolved_at == null 才觸發.\n- SI passive / cross-count >= 3 sub-branches cascade crisis mode 下 turn.`;
  }
  return {
    handled: true,
    inject,
    // PR-4c-green E4 fix — day_opening_inject_active suppresses the competing
    // elicitation opening 起手式 in modeContextFor (see lib/session/mode-context.js).
    // Cleared by maybeAutoTransitionRouterPhase post-LLM so it doesn't linger
    // into turn 2.
    patch: {
      router_phase: 'opening',
      day_opening_inject_active: true,
      day_opening_variant: variantPick.variant,
      day_opening_v6_sub_branch: variantPick.v6SubBranch,
    },
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

  // ⭐ v5.1 Step 5c errata Patch 3 — mode-aware takeaway phrasing + crisis disable.
  //   crisis primary OR active_modes.includes(crisis) → takeaway disabled,
  //     crisis closure inject + takeaway_term=null + carry_forward write.
  //   Otherwise per-mode phrasing (elicitation/identity_anchoring/integration/cascade/future_pacing).
  //   F2 dedup: deriveTakeawayTerm prioritizes reframe success anchor > quality candidate.
  const takeawayResult = selectTakeawayPhrasing(state);

  // ⭐ v5.1 Step 5c errata Patch 4 — cross-session anchor write strengthening.
  //   last_session_day_summary now carries primary_mode + active_modes + paused_modes
  //   + ended_naturally + hard_limit_hit + takeaway_term (null when crisis) +
  //   anchors_referenced + reframe_invocation_history_in_session + crisis_in_progress_at_close.
  //   chat.js Step 11+ persists this via setLastSessionDaySummary (user_profile_evolution).
  const summaryPatch = buildLastSessionDaySummary({
    sessionState: state,
    takeawayResult,
    endedNaturally: !state.hard_limit_hit_this_session,
    hardLimitHit: !!state.hard_limit_hit_this_session,
  });

  // ⭐ Step 6 PR-6b — crisis_state_carry_forward full write.
  //   Reads session_state.crisis_sop_state (populated by crisis-sop.js state
  //   machine) and writes full schema per turn2b §10.3 step 7.3 +
  //   landing errata §2.2 new 3 fields. Caller passes invokedAt ISO string
  //   so the function stays pure (workflow-resume safe).
  //   ⚠️ M73 — Safety Planning 完成不得 reset resolved (enforced in
  //     updateCarryForwardOnSessionClose: resolved_at only set after 3 sessions
  //     no re-trigger natural_de_escalation).
  const prevCarry = (ctx.user_profile && ctx.user_profile.crisis_state_carry_forward) || null;
  const sopState = state.crisis_sop_state;
  const crisisTriggeredThisSession = takeawayResult.crisis_disabled
    || state.crisis_in_progress
    || (state.deep_signal_flags && state.deep_signal_flags.passive_dw_detected)
    || !!sopState;
  const invokedAt = ctx.now_iso || null;   // caller (chat.js) passes ISO string
  let newCarryForward;
  if (prevCarry) {
    newCarryForward = updateCarryForwardOnSessionClose(prevCarry, crisisTriggeredThisSession,
      { invokedAt });
    // Merge any fresh fields from this session's SOP state on top of prev (don't lose
    // landing_page_reminder_delivered — accumulates).
    if (sopState) {
      const fresh = buildCrisisCarryForward(state, { invokedAt });
      if (fresh) {
        newCarryForward = {
          ...newCarryForward,
          // Fresh SOP data overrides prior — but landing_page_reminder_delivered
          // sticky (never goes false once true per landing errata §2.2 reset_on=不 reset).
          ...fresh,
          landing_page_reminder_delivered:
            !!(prevCarry.landing_page_reminder_delivered
               || fresh.landing_page_reminder_delivered),
          sessions_since_trigger: newCarryForward.sessions_since_trigger,
          resolved_at: newCarryForward.resolved_at,
          resolution_type: newCarryForward.resolution_type,
        };
      }
    }
  } else if (crisisTriggeredThisSession) {
    newCarryForward = buildCrisisCarryForward(state, { invokedAt });
  } else {
    newCarryForward = null;
  }

  // Inject — replace base takeaway content with mode-aware phrasing OR crisis closure.
  let inject = takeawayPlanter.prompt_content;
  if (takeawayResult.crisis_disabled) {
    inject = `${inject}\n\n---\n\n[SYSTEM INJECT — Takeaway DISABLED (crisis mode active)]\n\n` +
      `crisis 在 primary 或 active_modes → 正常 takeaway 禁用. 改 crisis closure:\n` +
      `> 「${takeawayResult.phrasing}」\n\n` +
      `機制:\n- takeaway_term = null (per spec §A3).\n` +
      `- crisis_state_carry_forward 寫入 (per spec §A4).\n` +
      `- 下次 session 開場走 V6 sub-branch.`;
  } else {
    inject = `${inject}\n\n---\n\n[SYSTEM INJECT — Mode-Aware Takeaway (${takeawayResult.mode_key})]\n\n` +
      `話術:\n> ${takeawayResult.phrasing}\n\n` +
      `F2 dedup: takeaway_term = ${takeawayResult.takeaway_term ?? '(null)'}\n` +
      `(來源優先序: reframe success anchor > quality candidate; F2 同 phrase ≥ 2 次→換詞.)`;
  }

  // 6/12 — Record R7 invocation when R7_C ritual is the takeaway phrasing.
  // selectTakeawayPhrasing emits {reframe_invoked: 'R7_C'} only when key ===
  // future_pacing AND takeawayTerm exists. variant='R7_C' (Let It Go ritual).
  const reframePatch = takeawayResult.reframe_invoked === 'R7_C'
    ? buildInvocationPatch({ reframe_id: 'R7', state, ctx, variant: 'R7_C' })
    : null;

  return {
    handled: true,
    inject,
    patch: {
      takeaway_seeded_this_session: true,
      takeaway_term_this_session: takeawayResult.takeaway_term,
      takeaway_mode_key: takeawayResult.mode_key,
      takeaway_crisis_disabled: takeawayResult.crisis_disabled,
      // Persist new schema — handler emits; finalize-day.js / chat.js writes to
      // user_profile_evolution.last_session_day_summary via setLastSessionDaySummary.
      session_close_summary_patch: summaryPatch,
      // crisis carry_forward — null OR populated (handler emits; finalize-day persists).
      crisis_state_carry_forward_pending_write: newCarryForward,
      ...(reframePatch || {}),
    },
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
