// api/chat.js — v5.0 orchestration handler
//
// v5.0 = 「保留管線、換引擎」（spec docs/v5-spec/engineering/03-v40-adaptation.md §3）。
// v4.0 infra 保留：neon / Anthropic SDK / prompt caching / chat_usage_log / loadFeatureFlags。
// v4.0 prompt 結構全砍：DAMON_CORE / WEEK_GOALS / 守則三 / 觸發 #1-10 / Day N hardcode。
//
// v5.0 orchestration（12 步、本檔只做 orchestration、規則全在 lib/）：
//   1. parse req.body（accept week/day、但 v5.0 ignore — Q-B 過渡相容）
//   2. strip 開頭非 user message
//   3. neon SQL + loadFeatureFlags
//   4. getUserProfile + detectNewSessionDay（gap_days）
//   5. loadOrCreateSession（新 session 跨 day reset：transient reset + phase 進度 carry-over）
//   6. INSERT user message
//   7. dispatch detectors（new_session_day lifecycle + user_turn cascade）
//   8. buildSystemPromptArrayV5（cached prefix 4 段 + dynamic、breakpoint 在段落 4 結尾）
//   9. Anthropic Sonnet call
//   10. INSERT assistant message
//   11. checkAdvance phase + updateState（Postgres || merge）
//   12. touchUserProfile（last_active_date / calendar_day_count）+ chat_usage_log
//
// generateDamonNote / generateNotebookPage 保留 export（api/finalize-day.js 依賴、PR-4c 才改寫）。

import { neon } from '@neondatabase/serverless';
import Anthropic from '@anthropic-ai/sdk';

import { CACHED_PREFIX_SECTIONS } from '../lib/prompt-sections/cached/index.js';
import { DetectorRegistry, skipIfDeviationHandled } from '../lib/detector/registry.js';
import { ALL_DETECTORS, E2_DETECTOR } from '../lib/detector-handlers/index.js';
import {
  detectNewSessionDay, buildResetPatch, PHASE_PROGRESS_NEVER_RESET,
  taipeiDateString,
} from '../lib/session/day-boundary.js';
// 5/28 Patrick — A006 case fix: 殭屍 session row rollback decision helper.
import { rollbackSessionIfNeeded } from '../lib/api/chat-rollback.js';
// 6/3 Patrick (Vivi burst protection) — Anthropic 429 / 5xx 友善 handling + retry.
//   429 → exponential backoff retry (1s/2s/4s, cap 8s). 全部退到底 → 回 503 overload.
//   5xx → attempt 0 retry 一次. 仍失敗 → throw.
import { callAnthropicWithRetry } from '../lib/api/anthropic-retry.js';
// 5/29 Patrick — PRODUCT-TRUTH v2.3 §2.5: 採集深度視覺指示 (純函式、不影響 prompt).
import { computeDepthSignal } from '../lib/api/depth-signal.js';
// 5/29 Patrick (Vivi access gate) — is_blocked 入口檢查 + 30 天 window lazy expiry.
import { isBlocked, shouldExpireBetaWindow, BLOCKED_RESPONSE } from '../lib/api/access-gate.js';
// ⭐ v5.1 Step 4 PR-23s4b — phase-context retired. mode-context 取代.
import { modeContextFor } from '../lib/session/mode-context.js';
// ⭐ v5.2 第二塊 PR-a (Vivi 6/5) — active_context inject helper.
import {
  buildActiveContextBlock, pickActiveContext, deriveContextNameForPhrasing,
} from '../lib/session/active-context.js';
// ⭐ v5.2 第三塊 PR-b — Cross-Session Memory inject (per-category bucket from UPE).
import { buildActiveContextSummaryInject } from '../lib/session/active-context-summary-inject.js';
// ⭐ v5.2 第四塊 PR-b — Onboarding intercept (new students, before Mode routing).
import { onboardingFlowHandler } from '../lib/detector-handlers/onboarding-flow.js';
// ⭐ v5.2 第二塊 PR-b — cross-context handler (case 3 reminder lock).
import {
  detectCrossContextSwapIntent, buildCrossContextReminderLockInject,
} from '../lib/sub-prompts/cross-context-handler.js';
// ⭐ v5.2 第五塊 — case 3 連續 swap escalate threshold.
import {
  CROSS_CONTEXT_SWAP_THRESHOLD,
} from '../lib/dashboard/alert-rules.js';
// ⭐ 6/6 A011 hotfix — session resume guidance inject (Vivi 6/6 拍板).
import {
  buildResumeGuidanceInject,
} from '../lib/sub-prompts/session-resume/resume-guidance.js';
// ⭐ 6/7 P0 safety (Vivi A016) — deterministic crisis-output scrubber.
//   Defense 2 backstop: even if prompt rules slip, scrub「自殺」 from
//   assistant text before persist/return. Crisis turns only.
import {
  scrubCrisisAssistantOutput, isInCrisisState,
} from '../lib/util/crisis-output-scrubber.js';
// ⭐ v5.1 Step 4 PR-23s4b — phase-advance / phase-machine 退役 (廢除).
//   chat.js Step 5b (phaseForDay + phaseEntryPatch 天數驅動) 已刪除.
//   mode 流動由 detector handlers (尤其 mode-transition-router) 完全接管.
import {
  readModeState, buildModeStatePatch, checkActiveModesLimit,
} from '../lib/session/mode-tracker.js';
import {
  updateState, getUserProfile, incrementUserProfileCounters,
} from '../lib/state/state-manager.js';
// PR-4c-green Auth rebuild stage 1d — studentId from session cookie ONLY.
import { guardStudentOr401 } from '../lib/auth/student-session.js';

// v34 hotfix 6: Vercel Pro 預設 15s timeout、明寫 60s
export const maxDuration = 60;

const MODEL = 'claude-sonnet-4-6';
// Dashboard §2.4 hard limit：turn >= 40 → hard_limit_hit_this_session
const HARD_LIMIT_TURNS = 40;
// PR-4c session_end soft limit：turn >= 25 → inject closure-guidance（AI 開始往收尾走）
const SOFT_LIMIT_TURNS = 25;

/**
 * v4 收尾 marker — v5 主對話 LLM 在引導下會自然輸出這些短語當作收尾訊號。
 * 偵測這些 marker 在 AI response 中出現 → dayComplete true。
 *
 * spec：docs/v5-spec/engineering/07-pr4c-ui-integration-and-data-contract.md §4
 */
export const CLOSURE_MARKERS = Object.freeze([
  '明天從這裡繼續',
  '今天先到這裡',
  '把這句話留下來',
  '明天我們繼續',
  '今天就到這裡',
]);

// ════════════════════════════════════════════════════════════════
// Anthropic SDK — lazy singleton（讓本檔可在無 API key 環境被 import / unit test）
// ════════════════════════════════════════════════════════════════
let _anthropic = null;
function getAnthropic() {
  if (_anthropic) return _anthropic;
  _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// ════════════════════════════════════════════════════════════════
// Detector registry — module-level singleton（detector defs 靜態、註冊一次）
// E2 master 帶 skip_if（engine 2 §4.1：E1 處理偏離時 E2 跳過）。
// ════════════════════════════════════════════════════════════════
const detectorRegistry = (() => {
  const reg = new DetectorRegistry();
  for (const det of ALL_DETECTORS) {
    // index.js 已對 E2 套 skip_if；defensive 再確認一次
    if (det.id === E2_DETECTOR.id && !det.skip_if) {
      reg.register({ ...det, skip_if: skipIfDeviationHandled });
    } else {
      reg.register(det);
    }
  }
  return reg;
})();

// ════════════════════════════════════════════════════════════════
// loadFeatureFlags — DB-driven flags + 30s in-memory cache + env fallback（v4.0 繼承）
// ════════════════════════════════════════════════════════════════
let _flagsCache = null;
let _flagsCacheTime = 0;
async function loadFeatureFlags(sql) {
  if (_flagsCache && Date.now() - _flagsCacheTime < 30000) return _flagsCache;
  try {
    const rows = await sql`SELECT key, enabled FROM feature_flags`;
    _flagsCache = Object.fromEntries(rows.map(r => [r.key, r.enabled]));
    _flagsCacheTime = Date.now();
  } catch (e) {
    console.error('[flags] load failed, fallback to env:', e.message);
    _flagsCache = {
      // 6/3 Patrick (Vivi burst protection spec) — default ON.
      //   Cached prefix 5K tokens × Day-1 burst 50-200 並發 → without caching
      //   blow Tier 2 input TPM (80K) in < 1 min. cache_read 0.1× billed +
      //   不算 TPM 配額 → 實質容量 +5-10×. Explicit kill switch:
      //   FEATURE_PROMPT_CACHING='false' env OR feature_flags row enabled=FALSE.
      PROMPT_CACHING: process.env.FEATURE_PROMPT_CACHING !== 'false',
    };
    _flagsCacheTime = Date.now();
  }
  return _flagsCache;
}

// ════════════════════════════════════════════════════════════════
// v5.0 session_state — 初始 phase 進度 + carry-over
// ════════════════════════════════════════════════════════════════

/**
 * Phase 進度欄位初始值（PHASE_PROGRESS_NEVER_RESET 的 7 欄位）。
 * 跨 day 保留（學員努力產出）— migration 014 §3 exception。
 */
export const INITIAL_PHASE_STATE = Object.freeze({
  current_phase:                     'phase_1',
  phase_progress:                    {},
  integration_retention_mode_active: false,
  build_vision_progress:             null,
  self_concept_progress:             null,
  counter_examples_list:             [],
  mid_session_takeaway_count:        0,
});

/**
 * Build the session_state for a freshly-created session row.
 *
 * 跨 day 語意（migration 014 §3）：
 *   - transient 22 欄位 → reset（buildResetPatch、NLP Amnesia）
 *   - phase 進度 7 欄位 → 從前一 session 的 session_state carry-over（保留）
 *
 * @param {object|null} priorState - 前一個 session 的 session_state（無前例傳 null）
 * @returns {object}
 */
export function buildCarryOverState(priorState) {
  const out = { ...INITIAL_PHASE_STATE };
  if (priorState && typeof priorState === 'object') {
    for (const f of PHASE_PROGRESS_NEVER_RESET) {
      if (priorState[f] !== undefined) out[f] = priorState[f];
    }
  }
  // transient reset 蓋在最後（22 欄位、絕不含 phase 進度）
  return { ...out, ...buildResetPatch() };
}

/**
 * Normalize a Postgres DATE value (which @neondatabase returns as either a JS
 * Date object or a 'YYYY-MM-DD' string) to a canonical 'YYYY-MM-DD' string.
 * Pure helper, exported for testing.
 *
 * @param {Date|string|null|undefined} d
 * @returns {string|null}
 */
export function normalizeDateString(d) {
  if (!d) return null;
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  return String(d).slice(0, 10);
}

/**
 * PR-4c-4e — Decide what loadOrCreateSession should do, given the lookup
 * results + pace + today's calendar date.
 *
 * Returns:
 *   { action: 'reuse',  sessionDay }                        — in-progress session, continue
 *   { action: 'create', sessionDay }                        — open a fresh Day-N row
 *   { action: 'locked', sessionDay }                        — daily mode, Day N+1 waits for next calendar day
 *   { action: 'awaiting_prior_finalize', sessionDay, priorDay } — PR-4c-green E4 修法 1: would create
 *                                                                  Day N+1 but prior day's finalize race
 *                                                                  is still in flight (caller waits/retries)
 *
 * sessionDay derivation:
 *   reuse  → inProgress.day
 *   create → (userSessionDayCount || 0) + 1   — source of truth is the cross-session counter;
 *                                               works with scripts/advance_student_day.sql
 *                                               (which bumps session_day_count without
 *                                               creating sessions rows)
 *   locked → prior.day                       — informational
 *   awaiting_prior_finalize → priorDay + 1   — informational; same value `create` would return
 *
 * @param {object} args
 * @param {{day?:number}|null} args.inProgress       — most-recent day_complete=FALSE row (or null)
 * @param {{day?:number,session_date?:Date|string}|null} args.prior  — most-recent row of any state
 * @param {'daily'|'self-paced'} args.pace
 * @param {string} args.sessionDate                  — today's 'YYYY-MM-DD'
 * @param {number} args.userSessionDayCount          — user_profile_evolution.session_day_count
 * @param {boolean} [args.priorDayFinalized=true]    — PR-4c-green E4 修法 1: caller-computed
 *                                                     "has prior day's finalize-day write landed?".
 *                                                     true means safe to create Day N+1.
 *                                                     false means race is in flight + we're still
 *                                                     within the recency window → block.
 *                                                     Defaults to true → all existing callers
 *                                                     keep their behavior; only the chat.js handler
 *                                                     (which knows daily_takeaways + prior.updated_at)
 *                                                     supplies false.
 * @returns {{ action:'reuse'|'create'|'locked'|'awaiting_prior_finalize', sessionDay:number, priorDay?:number }}
 */
export function decideSessionAction({
  inProgress, prior, pace, sessionDate,
  userSessionDayCount = 0,
  priorDayFinalized = true,
} = {}) {
  if (inProgress) {
    return { action: 'reuse', sessionDay: inProgress.day || 1 };
  }
  const priorDay = prior?.day || 0;
  const priorDateStr = normalizeDateString(prior?.session_date);
  if (pace === 'daily' && priorDateStr && priorDateStr === sessionDate) {
    return { action: 'locked', sessionDay: priorDay };
  }
  // PR-4c-green E4 修法 1 — finalize race gate.
  //   Self-paced (gap_days=0, no calendar-day lock) lets the student tap into Day N+1
  //   before /api/finalize-day finishes writing yesterday's daily_takeaways +
  //   last_session_day_summary. Result: E4 reads empty assets → falls back to cold
  //   起手式 (A001 Day 2 災難). When the caller signals priorDayFinalized=false
  //   AND there's actually a prior day to be racing against (priorDay >= 1), block.
  if (priorDay >= 1 && !priorDayFinalized) {
    return { action: 'awaiting_prior_finalize', sessionDay: priorDay + 1, priorDay };
  }
  return { action: 'create', sessionDay: (userSessionDayCount || 0) + 1 };
}

/**
 * PR-4c-green E4 修法 1 — compute "has prior day's finalize-day write landed?"
 *
 * Two signals:
 *   (a) daily_takeaways contains an entry for priorDay → finalize landed. Done.
 *   (b) No entry, but prior.updated_at is older than the recency window
 *       (default 90s, longer than any healthy finalize-day call) → assume the
 *       race is over; either finalize succeeded without a 關鍵句 (no takeaway),
 *       or it truly failed long ago. Don't lock forever — proceed and let E4
 *       fall back to no-inject gracefully.
 *
 * Caller passes this into decideSessionAction's priorDayFinalized arg.
 *
 * @param {object} args
 * @param {number} args.priorDay
 * @param {Date|string|null} args.priorUpdatedAt
 * @param {Array<{day?:number}>} [args.dailyTakeaways]
 * @param {number} [args.recencyMs=90000]
 * @param {Date} [args.now]    — injectable clock for tests
 * @returns {boolean}
 */
export function isPriorDayFinalized({
  priorDay, priorUpdatedAt, dailyTakeaways = [],
  recencyMs = 90_000, now = new Date(),
} = {}) {
  if (!priorDay || priorDay < 1) return true;   // no prior, nothing to race against
  const hasEntry = Array.isArray(dailyTakeaways)
    && dailyTakeaways.some(t => Number(t?.day) === Number(priorDay));
  if (hasEntry) return true;
  if (!priorUpdatedAt) return true;             // no timestamp to gate on; don't lock
  const t = priorUpdatedAt instanceof Date ? priorUpdatedAt : new Date(priorUpdatedAt);
  if (Number.isNaN(t.getTime())) return true;
  const ageMs = now.getTime() - t.getTime();
  return ageMs >= recencyMs;                    // stale enough → stop waiting
}

/**
 * Find an in-progress (day_complete=FALSE) session for this student/module, OR
 * create a fresh row for the next Day. PR-4c-4e refactor — pace-aware, with the
 * pure decision in decideSessionAction() above.
 *
 * @returns {Promise<{
 *   sessionId: number|null,
 *   sessionDay: number,
 *   turnCount: number,
 *   sessionStart: Date,
 *   sessionState: object,
 *   isNew: boolean,
 *   pacingLocked?: boolean,
 * }>}
 */
async function loadOrCreateSession(sql, {
  studentId, module, sessionDate, sessionNotes,
  pace = 'daily', userSessionDayCount = 0,
  // PR-4c-green E4 修法 1 — passed from handler so we can detect finalize race
  // before creating Day N+1's row.
  dailyTakeaways = [],
}) {
  // 1. Look for an in-progress session (day_complete=FALSE) — that's the current Day N being worked.
  const inProgressRows = await sql`
    SELECT id, day, questions_today, created_at, session_state
    FROM sessions
    WHERE student_id = ${studentId} AND module = ${module} AND day_complete = FALSE
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const inProgress = inProgressRows[0] || null;

  // 2. No in-progress — look up the most-recent prior row for carry-over + pace check + finalize-race check.
  //    PR-4c-green E4 修法 1: added `updated_at` so we can recency-gate the
  //    finalize race (don't lock forever if a real prior failure happened long ago).
  let prior = null;
  if (!inProgress) {
    const priorRows = await sql`
      SELECT day, session_state, session_date, updated_at
      FROM sessions
      WHERE student_id = ${studentId} AND module = ${module}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    prior = priorRows[0] || null;
  }

  // PR-4c-green E4 修法 1 — caller-computed race signal. True when prior day's
  // daily_takeaways write landed (or the recency window expired).
  const priorDayFinalized = isPriorDayFinalized({
    priorDay:        prior?.day || 0,
    priorUpdatedAt:  prior?.updated_at || null,
    dailyTakeaways,
  });

  const decision = decideSessionAction({
    inProgress, prior, pace, sessionDate, userSessionDayCount, priorDayFinalized,
  });

  if (decision.action === 'reuse') {
    return {
      sessionId:    inProgress.id,
      sessionDay:   decision.sessionDay,
      turnCount:    inProgress.questions_today || 0,
      sessionStart: new Date(inProgress.created_at),
      sessionState: inProgress.session_state || {},
      isNew:        false,
      // ⭐ 6/6 A011 hotfix — flag the reuse path so the handler can detect
      // resume-across-gap (vs locked / awaiting_prior_finalize, which also have
      // isNew=false). Used to inject session-resume guidance on kickoff turn
      // when gap_days >= 1 (Vivi 6/6 spec).
      wasReuse:     true,
    };
  }

  if (decision.action === 'locked') {
    return {
      sessionId:    null,
      sessionDay:   decision.sessionDay,
      turnCount:    0,
      sessionStart: new Date(),
      sessionState: prior?.session_state || {},
      isNew:        false,
      pacingLocked: true,
    };
  }

  // PR-4c-green E4 修法 1 — race in flight; surface to handler → 409 retry.
  if (decision.action === 'awaiting_prior_finalize') {
    return {
      sessionId:           null,
      sessionDay:          decision.sessionDay,
      turnCount:           0,
      sessionStart:        new Date(),
      sessionState:        prior?.session_state || {},
      isNew:               false,
      awaitingPriorFinalize: true,
      priorDay:            decision.priorDay,
    };
  }

  // 'create' — fresh Day-N row with carry-over + reset
  const nextDay = decision.sessionDay;
  const initialState = buildCarryOverState(prior?.session_state || null);
  const created = await sql`
    INSERT INTO sessions
      (student_id, module, week, day, session_date, session_notes, questions_today, session_state)
    VALUES
      (${studentId}, ${module}, ${Math.max(1, Math.ceil(nextDay / 7))}, ${nextDay},
       ${sessionDate}, ${sessionNotes || ''}, 0,
       ${JSON.stringify(initialState)}::jsonb)
    RETURNING id, created_at
  `;
  return {
    sessionId:    created[0].id,
    sessionDay:   nextDay,
    turnCount:    0,
    sessionStart: new Date(created[0].created_at),
    sessionState: initialState,
    isNew:        true,
  };
}

// ════════════════════════════════════════════════════════════════
// v5.0 prompt assembly
// ════════════════════════════════════════════════════════════════

/**
 * Build the {{...}} dynamic runtime block (spec 04 §4 — not cached, recomputed每 turn).
 *
 * @param {object} sessionState
 * @param {object} userProfile
 * @param {number} gapDays
 * @param {object} [opts]
 * @param {{category:number,name:string|null,definition:string|null}} [opts.activeContext]
 *   v5.2 第二塊 PR-a — per-student active_context from students table.
 *   When set + valid, prepends [Active Context] block per spec §4.1 (~80 tok).
 *   When null / invalid, omitted (graceful fallback to v5.1 behavior per spec §7.3).
 * @returns {string}
 */
export function buildDynamicContext(sessionState = {}, userProfile = {}, gapDays = 0, opts = {}) {
  // ⭐ v5.2 第二塊 PR-a — Active Context block (English internal awareness for Sonnet).
  //   Lives in dynamic block (breakpoint 後), NOT cached — per-student content,
  //   進 cached 會破全員 cache. Per spec §4.1 verbatim template.
  const activeContextBlock = opts.activeContext
    ? buildActiveContextBlock(opts.activeContext)
    : null;
  const linesActiveContext = activeContextBlock
    ? [activeContextBlock, '']   // block + blank line separator
    : [];

  // ⭐ v5.1 Step 4 PR-23s4b — primary_mode 取代 current_phase.
  //   readModeState 走 fallback (legacy router_phase / null state → elicitation).
  const modeRead = readModeState(sessionState);
  const primaryMode = modeRead.primary_mode;
  const lines = [...linesActiveContext, '━━━ 本場學員狀態（runtime、不快取）━━━'];

  const top1 = userProfile.top1_value || sessionState.top1_value || null;
  const anchors = Array.isArray(userProfile.anchors) ? userProfile.anchors : [];
  const ranking = Array.isArray(userProfile.values_ranking) ? userProfile.values_ranking : [];

  lines.push(`primary_mode：${primaryMode}`);
  // ⭐ v5.1 cached §3 replacement (Step 9, 2026-06-05): §3 Engine Integration
  //   Reference declares `active_modes: list` as inject — unconditional.
  //   Previously we only emitted when length > 1; cached §3 expects model to
  //   always see this list (single-mode case shows ['<primary>']).
  if (Array.isArray(modeRead.active_modes)) {
    lines.push(`active_modes：${modeRead.active_modes.join(', ') || primaryMode}`);
  }
  if (Array.isArray(modeRead.paused_modes) && modeRead.paused_modes.length > 0) {
    lines.push(`paused_modes：${modeRead.paused_modes.join(', ')}`);
  }
  lines.push(`session_day_count：${userProfile.session_day_count ?? 0}｜gap_days：${gapDays}`);
  if (top1) lines.push(`top1_value：${top1}`);
  if (ranking.length) {
    lines.push(`values_ranking（Top 3）：${ranking.slice(0, 3).map(r => r?.value || r).join('、')}`);
  }

  // {{anchors_top3}} — Day N+1 開場引用素材
  const anchorTerms = anchors
    .slice(-3)
    .map(a => (typeof a === 'string' ? a : a?.term))
    .filter(Boolean);
  lines.push(anchorTerms.length
    ? `owned qualities（最近 3 個 anchor）：${anchorTerms.join('、')}`
    : 'owned qualities：（尚無、從零採集）');

  // ⭐ PR-4c-green 5/24 root cause fix — surface yesterday's takeaway material
  // into the dynamic context so the E4 day-opening inject actually has something
  // to weave in. Without this, the inject says「引用 last_takeaway_term」 but
  // Sonnet can't see the value → ignores it (A002) or fabricates (A001).
  //
  // Two signals (E4 inject reads either):
  //   last_takeaway_term — full sentence from last finalize-day (≤ ~6 weeks old)
  //   daily_takeaways — array of {day, term} entries (we surface the latest)
  const lastSummary = (userProfile.last_session_day_summary
    && typeof userProfile.last_session_day_summary === 'object')
    ? userProfile.last_session_day_summary : {};
  const lastTakeawayTerm = typeof lastSummary.last_takeaway_term === 'string'
    && lastSummary.last_takeaway_term.length > 0
      ? lastSummary.last_takeaway_term : null;
  const dailyTakeaways = Array.isArray(userProfile.daily_takeaways)
    ? userProfile.daily_takeaways : [];
  const latestDailyTakeaway = dailyTakeaways
    .filter(t => t && typeof t.term === 'string' && t.term.length > 0)
    .sort((a, b) => (b.day || 0) - (a.day || 0))[0] || null;

  if (lastTakeawayTerm || latestDailyTakeaway) {
    lines.push('━━━ 昨天的素材（E4 開場引用、不直引、抓「意思」）━━━');
    if (lastTakeawayTerm) {
      lines.push(`last_takeaway_term：「${lastTakeawayTerm}」`);
    }
    if (latestDailyTakeaway) {
      lines.push(`daily_takeaways[最後一筆]：Day ${latestDailyTakeaway.day} →「${latestDailyTakeaway.term}」`);
    }
  } else {
    // Explicit empty signal so the inject's「模式 B 安全暖開場」 path is
    // unambiguous. Sonnet must NOT fabricate when this line is here.
    lines.push('昨天的素材：（無真實素材 — 走安全暖開場、絕對不杜撰「你昨天說…」）');
  }

  // ⭐ v5.2 第三塊 PR-b — Cross-Session Memory per-category inject (bug #7 fix).
  //   讀 UPE.active_context_session_summary[active_context.category] → format §5.2 block.
  //   Token-controlled: 8 examples max, ≤100 chars each, ~200 tok total.
  //   Empty bucket / no active_context → null → skip (fallback to「昨天素材」 continuity).
  //   ⚠️ 自然乾淨切換: 換 category 後只讀新 category bucket, 舊 category 累積保留但
  //      不引用 (design 即乾淨, no cleanup needed).
  if (opts.activeContext && opts.activeContext.category) {
    const summaryJsonb = (userProfile && typeof userProfile.active_context_session_summary === 'object')
      ? userProfile.active_context_session_summary
      : null;
    const summaryInject = buildActiveContextSummaryInject({
      summaryJsonb,
      category: opts.activeContext.category,
      // contextName via derive helper (same as Mode anchor below).
      contextName: deriveContextNameForPhrasing(opts.activeContext),
    });
    if (summaryInject) {
      lines.push('');           // blank line separator
      lines.push(summaryInject);
    }
  }

  // {{current_mode_context}} — v5.1 Step 4 PR-23s4b:
  //   modeContextFor 取代 contextFor. elicitation mode router_phase-aware variant
  //   (opening 含起手式 / elicitation 鏈式追問) for transitional dual-write compat.
  //   E4 day-opening inject active 時走 deferred variant (避免冷起手式 collide).
  // ⭐ v5.2 第二塊 PR-b — context anchor phrasing for Mode 1/2/4/5.
  //   contextName derived from active_context (name OR category 短字 fallback).
  //   When null → modeContextFor returns v5.1 phrasing (graceful fallback per §7.3).
  const contextName = opts.activeContext
    ? deriveContextNameForPhrasing(opts.activeContext)
    : null;
  const modeCtx = modeContextFor(primaryMode, sessionState.router_phase, {
    dayOpeningInjectActive: !!sessionState.day_opening_inject_active,
    contextName,
  });
  if (modeCtx) lines.push('\n' + modeCtx);

  // Integration Retention conditional（spec 04 §5）
  if (sessionState.integration_retention_mode_active) {
    lines.push(`
【Integration Retention 階段（Day 8-21）】
- 不挖新 quality、不深化新技術。
- 強化 owned qualities 在生活中 manifest、Future Pacing。
- turn budget 5-10/day soft limit、reinforce 而非 explore。`);
  }

  return lines.join('\n');
}

/**
 * Assemble the Anthropic `system` param array.
 *
 * caching ON：4 個 cached prefix 段落（breakpoint cache_control 在段落 4 結尾）
 *             + 1 個 dynamic 段落（不 cached）。
 * caching OFF：全部併成單一 text block。
 *
 * @returns {Array<{type:'text', text:string, cache_control?:object}>}
 */
export function buildSystemPromptArrayV5({
  sessionState, userProfile, gapDays = 0, conditionalInjects = [], cachingEnabled = false,
  activeContext = null,   // ⭐ v5.2 第二塊 PR-a — threaded through to dynamic block
}) {
  const dynamicText = buildDynamicContext(sessionState, userProfile, gapDays, { activeContext })
    + (conditionalInjects.length ? '\n\n' + conditionalInjects.join('\n\n') : '');

  if (!cachingEnabled) {
    const merged = CACHED_PREFIX_SECTIONS.map(s => s.content).join('\n\n')
      + '\n\n' + dynamicText;
    return [{ type: 'text', text: merged }];
  }

  const lastIdx = CACHED_PREFIX_SECTIONS.length - 1;
  const arr = CACHED_PREFIX_SECTIONS.map((s, i) => {
    const block = { type: 'text', text: s.content };
    if (i === lastIdx) block.cache_control = { type: 'ephemeral' };  // ⭐ breakpoint
    return block;
  });
  arr.push({ type: 'text', text: dynamicText });  // dynamic、breakpoint 之後
  return arr;
}

/**
 * Merge detector dispatch results into { injects, patch }.
 *
 * - patch：所有 result 的 patch 淺合併（含 handled:false 仍帶 patch 的 case）。
 * - injects：只收 handled:true 且 inject 非空的。
 *
 * @param {import('../lib/detector/registry.js').DispatchResult[]} results
 * @returns {{ injects: string[], patch: object }}
 */
export function collectDetectorOutput(results) {
  const injects = [];
  let patch = {};
  // ⭐ §3 patch 6/4 (safety patch #23) — Collect cross-session counter deltas
  //   so handlers can bump user_profile_evolution counters without direct DB
  //   access. Drained by chat.js Step 12 → incrementUserProfileCounters.
  //   Multiple detectors in one turn can each emit; same key → sum.
  const user_profile_increments = {};
  for (const r of results || []) {
    if (!r || !r.ok || !r.result) continue;
    const out = r.result;
    if (out.patch && typeof out.patch === 'object') patch = { ...patch, ...out.patch };
    if (out.handled === true && typeof out.inject === 'string' && out.inject.length > 0) {
      injects.push(out.inject);
    }
    if (out.user_profile_increments && typeof out.user_profile_increments === 'object') {
      for (const [k, v] of Object.entries(out.user_profile_increments)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          user_profile_increments[k] = (user_profile_increments[k] || 0) + v;
        }
      }
    }
  }
  return { injects, patch, user_profile_increments };
}

// ════════════════════════════════════════════════════════════════
// PR-4c-1b: router_phase auto-transition（fixes 開場重複 bug）
//
// phase_1 phase-context 是 router_phase-aware 兩變體（opening / elicitation）。
// `e3OpeningBranchHandler` 只對 stuck / flip / worth 觸發詞動 router_phase，
// 普通開場流（A001 Day 1 親測場景）不會 fire → router_phase 一直停在 'opening' →
// AI 每 turn 看到 phase_1 opening 變體含「起手式」→ 重複 emit。
//
// 修復：handler 在 phase_1 + router_phase='opening' + 本 turn 沒有 detector/advance
// 動過 router_phase 時，post-response auto-transition 'opening' → 'elicitation'。
// 持久化進 session_state、turn 2 載到 elicitation 變體（用鏈式追問、不重複起手式）。
// ════════════════════════════════════════════════════════════════

/**
 * @param {{ stateForPrompt: object, detectorPatch?: object, advancePatch?: object }} args
 * @returns {{ router_phase: 'elicitation' } | null}
 */
export function maybeAutoTransitionRouterPhase({ stateForPrompt, detectorPatch = {}, advancePatch = {} } = {}) {
  if (!stateForPrompt || typeof stateForPrompt !== 'object') return null;
  // PR-23s4b — primary_mode 取代 current_phase. elicitation mode 才適用此 auto-transition
  // (對應 v5.0 phase_1; identity_anchoring / cascade / future_pacing 沒有 opening→elicitation flip).
  // Accept primary_mode='elicitation' OR legacy current_phase='phase_1' for dual-write compat.
  const isElicitationMode = stateForPrompt.primary_mode === 'elicitation'
    || stateForPrompt.current_phase === 'phase_1';
  if (!isElicitationMode) return null;
  if (stateForPrompt.router_phase !== 'opening') return null;
  // detector 或 mode-transition 已動過 router_phase → 尊重它、不覆寫
  if (detectorPatch && detectorPatch.router_phase != null) return null;
  if (advancePatch  && advancePatch.router_phase  != null) return null;
  // PR-4c-green E4 fix — also clear day_opening_inject_active so turn 2 uses
  // elicitation 鏈式追問 cleanly, never the deferred variant.
  return { router_phase: 'elicitation', day_opening_inject_active: false };
}

// ════════════════════════════════════════════════════════════════
// PR-4c session_end detection — pure functions（chat.js orchestration 用）
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
// PR-4c-4c: session-start kickoff handshake（fixes Day 1 empty-screen bug）
//
// Anthropic API needs messages[0]=user. v5 chat.js was previously waiting for
// the student to type something before emitting the AI's phase-1 opening, but
// per UI spec + storyboard, the student opens the conversation page and the AI
// 起手式 should already be there. Frontend now sends { kickoff: true } when
// entering a fresh conversation (state.conversation empty); chat.js detects
// the flag, synthesizes a sentinel user-role message Sonnet can respond to
// (the phase-context opening variant in the system prompt does the actual
// "say the 起手式" work), and ships back the AI opening. The synthetic
// sentinel is NOT inserted into the messages table — keeps the audit clean
// and Damon Note generation sees only real student content.
//
// Composes naturally with the opening-dup fix:
//   kickoff turn — router_phase=opening → AI emits 起手式 →
//   auto-transition (maybeAutoTransitionRouterPhase) flips to elicitation →
//   student's real first message — router_phase=elicitation → chain-追問.
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
// PR-4c-green E4 fix — should we dispatch new_session_day this turn?
//
// Root cause of A001 Day 2 冷起手式:
//   The previous gate was `if (isNew)` — only fired E4 when loadOrCreateSession
//   *created* a new row this request. But Day 2's session row already exists by
//   the time the kickoff request lands (day_complete=FALSE, in-progress) → load
//   path returns isNew=false → E4 skip → main LLM ships phase_1 cold 起手式.
//
// Fix: gate on a per-session flag (day_opening_done_this_session) so we always
//   dispatch new_session_day exactly once per session row — regardless of which
//   request created the row. The flag lives in session_state JSONB which is
//   per-day (migration 018 UNIQUE on student_id+module+day), so it resets
//   naturally between days.
//
// Idempotence: dispatch may be the no-op handled=false (Day 1 / brand new
//   student / no takeaway yet) — still mark the flag, so we don't retry
//   the no-op cascade on every subsequent turn.
//
// @param {object} sessionState
// @returns {boolean}
// ════════════════════════════════════════════════════════════════

export function shouldDispatchDayOpening(sessionState) {
  if (!sessionState || typeof sessionState !== 'object') return true;
  return !sessionState.day_opening_done_this_session;
}

export const KICKOFF_TRIGGER_CONTENT =
  '[session-start trigger — 本場第一輪、請依當前 phase_context + router_phase'
  + '（+ 若有 E4 day-opening inject）直接出開場問句、不 echo 此訊息、'
  + '不解釋你正在做什麼、不前置「你好」「我們開始」這類客套。]';

/**
 * Did the frontend ask for a session-start AI opening?
 * @param {object} body
 * @returns {boolean}
 */
export function isKickoffRequest(body) {
  return !!(body && body.kickoff === true);
}

/**
 * ⭐ 6/6 A011 hotfix (Vivi 6/6) — pure decision function for resume-across-gap.
 *
 * Returns true when this turn picks up an unfinished session AND a calendar
 * gap has elapsed (≥ 1 day). chat.js uses this both to (a) inject the
 * [SESSION RESUME] guidance on kickoff and (b) defensively gate E4 day-opening.
 *
 * @param {object} args
 * @param {boolean} args.wasReuse — loadOrCreateSession set this on the reuse path
 * @param {number}  args.gapDays  — detectNewSessionDay's gap_days (calendar days)
 * @returns {boolean}
 */
export function isResumeAcrossGap({ wasReuse, gapDays } = {}) {
  if (!wasReuse) return false;
  const g = Number(gapDays);
  return Number.isFinite(g) && g >= 1;
}

/**
 * The messages array Sonnet sees during a kickoff turn.
 * Single user-role meta-instruction; the actual opening question comes from
 * the system prompt's phase-context opening variant (+ E4 day-opening inject
 * on Day N+1 if anchors exist).
 *
 * @returns {Array<{role:'user', content:string}>}
 */
export function buildKickoffMessages() {
  return [{ role: 'user', content: KICKOFF_TRIGGER_CONTENT }];
}

/**
 * v5 session-end 偵測（PR-4c）。
 *
 * dayComplete = AI response 含 CLOSURE_MARKERS 任一 OR turn count 到 hard limit。
 * （soft limit 不觸發 dayComplete、只觸發 closure-guidance inject、見 buildClosureHint）
 *
 * @param {{ content?: string, turnCount?: number, hardLimit?: number }} args
 * @returns {boolean}
 */
export function detectDayComplete({ content, turnCount, hardLimit = HARD_LIMIT_TURNS } = {}) {
  if (typeof turnCount === 'number' && turnCount >= hardLimit) return true;
  if (typeof content !== 'string' || content.length === 0) return false;
  return CLOSURE_MARKERS.some(m => content.includes(m));
}

/**
 * v5.1 PR-23s4b — Extracted response payload builder (Vivi 6/4 demand: response
 * assembly must have test coverage so a ReferenceError can't ship green).
 *
 * Semantics preserved across the phase-* retirement:
 *   - `phase` field → primary_mode (was current_phase, frontend name kept for
 *     response-shape backward compat; no current consumer reads it).
 *   - `routerPhase` → unchanged (legacy mirror, still null in most cases).
 *   - `phaseAdvanced` → true at "this turn crosses a session-day boundary"
 *     (was: current_phase shifted due to phaseForDay) OR "this turn emitted a
 *     mode transition" (mode-transition-router fired). Both are the v5.1
 *     equivalent of v5.0's "phase just changed" semantic.
 *
 * Pure — no I/O. All inputs explicit; throws TypeError on null content (so an
 * inadvertent miss surfaces as a fast failure, not a 200 with bogus shape).
 *
 * @param {object} args
 * @param {string} args.content                — Anthropic response text
 * @param {number} args.turnCount
 * @param {number|null} args.sessionId
 * @param {object} args.stateForPrompt         — merged session state (mode-aware)
 * @param {object} args.fullPatch              — patch about to be persisted
 * @param {object} args.priorSessionState      — sessionState BEFORE this turn's patches
 * @param {object} args.detectorPatch          — handler-emitted patches this turn
 * @param {boolean} args.isNew                 — loadOrCreateSession created the row
 * @param {boolean} args.dayComplete
 * @param {number} args.hardLimitTurns
 * @param {number} args.depthSignal
 * @returns {object} 200 response body
 */
export function buildChatResponsePayload({
  content,
  turnCount,
  sessionId,
  stateForPrompt = {},
  fullPatch = {},
  priorSessionState = {},
  detectorPatch = {},
  isNew = false,
  dayComplete = false,
  hardLimitTurns = HARD_LIMIT_TURNS,
  depthSignal = 0,
} = {}) {
  if (typeof content !== 'string') {
    throw new TypeError('buildChatResponsePayload: content must be a string');
  }
  // phaseAdvanced = cross-day-boundary OR mode-transition-this-turn.
  // Cross-day boundary: isNew (loadOrCreateSession just opened today's row).
  // Mode transition: detectorPatch.mode_transition_log grew vs priorSessionState's log.
  const priorLogLen = Array.isArray(priorSessionState?.mode_transition_log)
    ? priorSessionState.mode_transition_log.length : 0;
  const newLogLen = Array.isArray(detectorPatch?.mode_transition_log)
    ? detectorPatch.mode_transition_log.length : priorLogLen;
  const modeChangedThisTurn = newLogLen > priorLogLen;
  return {
    content,
    turnCount: typeof turnCount === 'number' ? turnCount : 0,
    sessionId: sessionId ?? null,
    // PR-23s4b — field name `phase` kept for response-shape compat (no
    // frontend consumer at time of refactor); value mapped to primary_mode.
    phase: stateForPrompt.primary_mode || null,
    routerPhase: fullPatch.router_phase || priorSessionState.router_phase || null,
    phaseAdvanced: !!isNew || modeChangedThisTurn,
    // PR-4c session_end: frontend reads dayComplete=true to trigger §5.2 transition
    dayComplete: !!dayComplete,
    notesGenerating: !!dayComplete,
    turnsLeft: Math.max(0, hardLimitTurns - (typeof turnCount === 'number' ? turnCount : 0)),
    depthSignal: typeof depthSignal === 'number' && Number.isFinite(depthSignal) ? depthSignal : 0,
  };
}

/**
 * Soft-limit closure-guidance hint —
 * 在 buildSystemPromptArrayV5 的 conditionalInjects 加入此 hint 段、
 * AI 看到後會開始往收尾走（採 takeaway + 用 CLOSURE_MARKERS 收尾話術）。
 *
 * 回傳 null 表示 turnCount 還沒到 softLimit、不需要 inject。
 *
 * @returns {string|null}
 */
export function buildClosureHint({ turnCount, softLimit = SOFT_LIMIT_TURNS, hardLimit = HARD_LIMIT_TURNS } = {}) {
  if (typeof turnCount !== 'number' || turnCount < softLimit) return null;
  const turnsToHard = Math.max(0, hardLimit - turnCount);
  return `[SYSTEM HINT — Session 收尾接近]
本場 turn count = ${turnCount}（soft limit ${softLimit}、hard limit ${hardLimit}、距 hard ${turnsToHard} turn）。
今天的對話已足夠——從這一輪開始往收尾走、不再開新話題、不再追問新場景。
若已採集到 takeaway（一個學員停下來的詞 / 一句真的話）、用收尾話術：
「明天從這裡繼續。」或「今天先到這裡。把這句話留下來。」
若還沒、用一個輕的問句讓學員自己給今天的一個詞、然後接收尾。`;
}

// ════════════════════════════════════════════════════════════════
// v5.0 handler
// ════════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // PR-4c-green Auth rebuild stage 1d — studentId from session cookie ALWAYS.
  // 鐵則: a client putting `body.studentId='A999'` cannot read someone else's
  // data. The body field is ignored entirely. 401 if no valid student session.
  const studentId = await guardStudentOr401(req, res);
  if (!studentId) return;

  // Step 1 — parse the rest. `module` is the only client field we still trust;
  // it's per-student so cross-student access isn't possible via this knob.
  const { messages: rawMessagesIn, module, week, day, sessionNotes, today } = req.body || {};
  if (!module) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // PR-4c-4c kickoff handshake — frontend signals "I want the AI opening".
  // Synthesize a sentinel user message; rest of handler runs almost normally,
  // with isKickoff gating the user-INSERT / turnCount / detector ctx branches.
  const isKickoff = isKickoffRequest(req.body);
  const rawMessages = isKickoff ? buildKickoffMessages() : rawMessagesIn;
  if (!rawMessages) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Step 2 — strip 開頭非 user message（Anthropic 規定首條須 user）
  const firstUserIdx = rawMessages.findIndex(m => m?.role === 'user');
  const messages = firstUserIdx >= 0 ? rawMessages.slice(firstUserIdx) : [];
  if (messages.length === 0) return res.status(400).json({ error: 'NO_USER_MESSAGE' });

  // 5/27 Patrick — 台北日界 (UTC+8). toLocaleDateString('sv') 走 Vercel 本地
  // TZ (UTC) → 台北凌晨 1 點還算 UTC 昨天 → sessionDate 跟 prior.session_date
  // 同字串、loadOrCreateSession decideSessionAction 把它當「同一天 continue」 →
  // Day 2 永遠不解鎖. 用 taipeiDateString 一律切到台北日界.
  const sessionDate = today || taipeiDateString(new Date());
  const requestStart = Date.now();
  const now = new Date();

  // 5/28 Patrick — A006 case fix: 殭屍 session row rollback.
  // loadOrCreateSession 已建好 row 之後、任何外部呼叫 (Anthropic credit / timeout /
  // Brevo / DB hiccup) 失敗 → 那條 row 留在 DB、day_complete=FALSE → journey 撈最新
  // session 撈到它 → lastSessionComplete=false → self-paced/daily +1 不觸發 → 卡住.
  // 修法：finally + _succeeded flag、失敗時且 isNew=true 才 DELETE (reuse 的 row
  // 是用戶 in-progress 對話、絕不刪).
  // sql 在 try 內初始化、需 hoist 出來讓 finally 能拿到 (DELETE 用).
  let sql = null;
  let _rollbackSessionId = null;
  let _succeeded = false;

  try {
    // Step 3 — SQL + flags
    sql = neon(process.env.DATABASE_URL);
    const flags = await loadFeatureFlags(sql);
    // 6/3 Patrick (Vivi burst protection) — caching default ON; explicit FALSE
    // in feature_flags row turns it OFF (kill switch preserved). Missing row
    // OR env unset → ON. cachingEnabled flips buildSystemPromptArrayV5's path
    // to the 4-section + cache_control breakpoint array (lib/prompt-sections/
    // cached/*: damon-core 1900t + 5-layer 600t + 4-7 router 1700t + active-
    // ref 800t = ~5000 tokens cached). cache_read 0.1× billed + 不算 TPM 配額.
    const cachingEnabled = flags.PROMPT_CACHING !== false;

    // Step 4 — user profile + pace + new_session_day 偵測
    let userProfile = null;
    try {
      userProfile = await getUserProfile(studentId);
    } catch (e) {
      console.warn('getUserProfile failed:', e.message);
    }
    // PR-4c-4e — fetch pace from students table (defaults to 'daily' if not set)
    // 5/26 Patrick (Stage 1 漏斗): 順手把 plan 一起撈、trial gate 用.
    // 5/29 Patrick (access gate): 也撈 is_blocked / is_beta / created_at 給入口
    // 守門 + 30 天 window lazy check.
    let pace = 'daily';
    let plan = 'trial';
    let studentRow = null;
    try {
      const pr = await sql`
        SELECT pace, plan, is_blocked, is_beta, created_at,
               active_context_category, active_context_name, active_context_definition,
               context_onboarded
          FROM students WHERE student_id = ${studentId} LIMIT 1
      `;
      if (pr.length > 0) {
        studentRow = pr[0];
        if (pr[0].pace) pace = pr[0].pace;
        if (pr[0].plan) plan = pr[0].plan;
      }
    } catch (e) { console.warn('[chat] pace/plan/access lookup failed:', e.message); }

    // 5/29 Patrick — access gate. 已 blocked → 403. is_beta 過 30 天且未完成 Day 21
    // → lazy 設 is_blocked=TRUE + 403. 設在 loadOrCreateSession 之前、避免燒
    // 任何 LLM token 給已關 access 的學員.
    if (studentRow && isBlocked(studentRow)) {
      return res.status(403).json(BLOCKED_RESPONSE);
    }
    if (studentRow && studentRow.is_beta === true) {
      try {
        // Day 21 完成 = sessions WHERE day=21 AND day_complete=TRUE 至少 1 筆.
        const d21 = await sql`
          SELECT 1 FROM sessions
           WHERE student_id = ${studentId}
             AND day = 21
             AND day_complete = TRUE
           LIMIT 1
        `;
        const hasDay21Complete = d21.length > 0;
        if (shouldExpireBetaWindow({ student: studentRow, hasDay21Complete, now: Date.now() })) {
          await sql`UPDATE students SET is_blocked = TRUE WHERE student_id = ${studentId}`;
          console.info('[chat][beta-window-expired]', JSON.stringify({
            event: 'beta_window_auto_block', student_id: studentId,
            created_at: studentRow.created_at,
          }));
          return res.status(403).json(BLOCKED_RESPONSE);
        }
      } catch (e) {
        // Window check 失敗 → fail-open (寧可放行 trial run 也不誤鎖).
        console.warn('[chat] beta-window check failed (fail-open):', e?.message || e);
      }
    }
    const { gap_days } = detectNewSessionDay(userProfile, now);

    // Step 5 — load / create today's session（PR-4c-4e: pace-aware + day_complete-aware）
    const sess = await loadOrCreateSession(sql, {
      studentId, module, sessionDate, sessionNotes,
      pace,
      userSessionDayCount: userProfile?.session_day_count || 0,
      // PR-4c-green E4 修法 1 — finalize race gate input
      dailyTakeaways: userProfile?.daily_takeaways || [],
    });
    // PR-4c-4e — daily mode + last session already complete today → Day N+1 locked
    if (sess.pacingLocked) {
      return res.status(409).json({
        error:      'PACING_LOCKED',
        message:    '今天的對話已收尾、明天再回來。',
        sessionDay: sess.sessionDay,
      });
    }
    // PR-4c-green E4 修法 1 — would create Day N+1 but prior day's finalize race
    // is still in flight (no daily_takeaways entry yet + prior.updated_at recent).
    // 409 with retry hint; frontend gates the kickoff fetch + auto-retries until clear.
    // Self-paced is the most common path here — daily mode would already have
    // returned PACING_LOCKED above.
    if (sess.awaitingPriorFinalize) {
      return res.status(409).json({
        error:      'PRIOR_FINALIZE_PENDING',
        message:    '教練還在寫昨天的字、稍等一下再回來。',
        priorDay:   sess.priorDay,
        sessionDay: sess.sessionDay,
        retryAfterMs: 3000,
      });
    }
    // 5/26 Patrick — Trial gate (Stage 1, flag-protected).
    // plan='trial' 只能走 Day 1. 預設 OFF (沒設 TRIAL_GATING_ENABLED='true'
    // → 不 gate、行為跟現在一樣) → push 不會鎖到任何現有封測者. 啟用順序由
    // Vivi 控：先把封測者改 plan_a → 開白老鼠 trial → 才設 env=true.
    // Day 2 的空 session row 可能已被 loadOrCreateSession 建出來、無妨；
    // 付費後同一天會續用同一個 row.
    if (process.env.TRIAL_GATING_ENABLED === 'true'
        && plan === 'trial'
        && (sess.sessionDay || 1) >= 2) {
      return res.status(402).json({
        error: 'TRIAL_UPGRADE_REQUIRED',
        sessionDay: sess.sessionDay,
      });
    }
    const { sessionId, sessionStart, isNew } = sess;
    // ⭐ 6/6 A011 hotfix — resume-across-gap detection (Vivi 6/6 拍板).
    //   Fires when this turn loaded an in-progress session (wasReuse=true) AND
    //   the calendar gap_days >= 1 (student returned a day or more later).
    //   Used to (i) inject [SESSION RESUME] guidance on kickoff turn and
    //   (ii) defensively gate E4 day-opening so a resume across gap can't be
    //   misclassified as a fresh Day N+1 opening.
    const resumeAcrossGap = isResumeAcrossGap({ wasReuse: sess.wasReuse, gapDays: gap_days });
    // 5/28 Patrick (A006 rollback) — 只記錄這 turn 自己「新建」的 row, reuse 的 in-progress
    // row 不能刪. 之後任何 downstream 炸 → finally DELETE 這個 id.
    _rollbackSessionId = isNew ? sessionId : null;
    // ⭐ Patrick 6/7 Day-1 monthly quota signal — write-if-null at the moment
    //   real cost is incurred (first chat turn that creates a fresh session
    //   row). Subsequent Day 2/3/N session creates are no-ops because of
    //   the IS NULL guard. Existing students who already have day1_started_at
    //   set never get re-counted. Fail-soft: write failure must not block
    //   the chat turn.
    if (isNew) {
      try {
        await sql`
          UPDATE students
             SET day1_started_at = NOW()
           WHERE student_id = ${studentId}
             AND day1_started_at IS NULL
        `;
      } catch (day1WriteErr) {
        console.warn('[day1-quota][day1_started_at-write-failed]',
          day1WriteErr?.message || day1WriteErr);
      }
    }
    let { turnCount, sessionState } = sess;

    // Step 5b 已刪除 (PR-23s4b 完成 phase-machine 退役):
    //   原 phaseForDay / phaseEntryPatch 天數驅動 phase 推進邏輯廢除.
    //   mode 流動完全由 detector handlers (尤其 mode-transition-router) 接管.
    //   dayPhasePatch 不再存在 (空 object 替代 in fullPatch merge below).
    const dayPhasePatch = {};

    // ⭐ Step 5c — v5.1 mode-tracker (PR-23s4b 正式接管).
    //   read mode state with router_phase fallback (migration 025 covered
    //   pre-existing sessions; new sessions created during this transitional
    //   window need read-time derive + write-back so DB rows progressively
    //   stop relying on the fallback path).
    //   No mode-transition decisions here — task 1 mode-transition-router will
    //   own that. This step just ensures the mode keys exist with sane values.
    const modeRead = readModeState(sessionState);
    if (modeRead.was_fallback) {
      console.info('[mode-tracker][fallback]', JSON.stringify({
        event: 'derived_from_router_phase',
        primary_mode: modeRead.primary_mode,
        router_phase: sessionState.router_phase ?? null,
      }));
    }
    // active_modes limit sanity (defensive — caller should never see this
    // unless something upstream wrote >3 modes by accident).
    const modeLimitCheck = checkActiveModesLimit(modeRead);
    if (!modeLimitCheck.ok) {
      console.warn('[mode-tracker][invariant]', JSON.stringify({
        event: 'active_modes_invariant_violation',
        reason: modeLimitCheck.reason,
        count: modeLimitCheck.count,
      }));
    }
    const modeStatePatch = buildModeStatePatch(modeRead);
    sessionState = { ...sessionState, ...modeStatePatch };

    // Step 6 — INSERT user message + bump questions_today
    // PR-4c-4c: skip both for kickoff (synthetic sentinel is not real student content)
    const userMessage = messages[messages.length - 1];
    if (!isKickoff) {
      await sql`
        INSERT INTO messages (session_id, role, content, question_number)
        VALUES (${sessionId}, 'user', ${userMessage.content}, ${turnCount})
      `;
      await sql`
        UPDATE sessions SET questions_today = questions_today + 1, updated_at = NOW()
        WHERE id = ${sessionId}
      `;
      turnCount++;
    }

    // last_ai_question = 最近一條 assistant message（detector ctx 用）
    // last_user_response — for kickoff, leave as-is (sentinel is not real content)
    const lastAi = [...messages].reverse().find(m => m?.role === 'assistant');
    sessionState = {
      ...sessionState,
      last_ai_question: lastAi?.content ?? sessionState.last_ai_question ?? null,
      last_user_response: isKickoff
        ? (sessionState.last_user_response ?? '')
        : userMessage.content,
    };

    // Step 7 — dispatch detectors
    const anchorsArr = Array.isArray(userProfile?.anchors) ? userProfile.anchors : [];
    const ctx = {
      session_state: sessionState,
      // PR-4c-4c kickoff: pass empty user_response so detectors (E1/E2 etc.)
      // don't fire on the synthetic sentinel content.
      user_response: isKickoff ? '' : userMessage.content,
      // ⭐ P0 hotfix Fix 3 (Patrick 6/6 回修, A015): explicit kickoff flag so
      //   handlers don't have to introspect a stripped user_response sentinel.
      //   crisis-sop.js Fix 3 (kickoff RESUME re-present) checks ctx.is_kickoff
      //   to distinguish a returning mid-SOP learner from a real user turn.
      is_kickoff: isKickoff,
      user_profile: userProfile || {},
      anchors_top3: anchorsArr.slice(-3),
      last_3_turns: messages.slice(-6).map(m => m?.content || ''),
      // judges 留空 → detector handlers 用真實 Haiku judge（lib/haiku-judge/*）
      logMiss: (m) => console.warn('[detector miss]', JSON.stringify(m)),
    };

    const conditionalInjects = [];
    let detectorPatch = {};
    // ⭐ §3 patch 6/4 (safety patch #23) — Cross-session counter deltas drained
    //   from detector outputs (currently passive_death_wish_count from E3).
    //   Forwarded to incrementUserProfileCounters at Step 12.
    const userProfileIncrements = {};
    const mergeIncrements = (inc) => {
      if (!inc) return;
      for (const [k, v] of Object.entries(inc)) {
        if (typeof v === 'number' && Number.isFinite(v)) {
          userProfileIncrements[k] = (userProfileIncrements[k] || 0) + v;
        }
      }
    };

    // ⭐ v5.2 第四塊 PR-b — Onboarding intercept (before Mode routing per task spec).
    //   Gate: !students.context_onboarded → run onboarding state machine.
    //   Handler defers internally if crisis_in_progress (safety override).
    //   On COMPLETE → atomic UPDATE students (active_context_* + onboarded=TRUE).
    //   Once injected, onboarding TAKES THE TURN — skip other detectors below
    //   (mode routing / elicitation should not run during onboarding).
    let onboardingTookTurn = false;
    {
      const studentContextOnboarded = studentRow ? studentRow.context_onboarded === true : true;
      // Default to TRUE for legacy students (no row found) — avoid surprising onboarding
      // gate trigger for pre-migration-031 students. They take normal flow.
      const onbOut = await onboardingFlowHandler({
        ...ctx,
        student_context_onboarded: studentContextOnboarded,
      });
      if (onbOut.handled) {
        onboardingTookTurn = true;
        if (onbOut.inject) conditionalInjects.push(onbOut.inject);
        if (onbOut.patch) detectorPatch = { ...detectorPatch, ...onbOut.patch };
        // Atomic write at COMPLETE step — UPDATE students with all 4 fields in one shot.
        if (onbOut.onboarding_complete_write) {
          const w = onbOut.onboarding_complete_write;
          try {
            await sql`
              UPDATE students SET
                active_context_category   = ${w.active_context_category},
                active_context_name       = ${w.active_context_name},
                active_context_definition = ${w.active_context_definition},
                context_onboarded         = ${w.context_onboarded}
              WHERE student_id = ${studentId}
            `;
            console.info('[v5_2_onboarding][complete_write]', JSON.stringify({
              event: 'onboarding_atomic_write',
              category: w.active_context_category,
              name_present: !!w.active_context_name,
              def_present: !!w.active_context_definition,
              // 鐵律 #2: not logging raw values.
            }));
          } catch (e) {
            console.error('[v5_2_onboarding] atomic write failed (fail-soft):', e.message);
          }
        }
      }
    }

    // 7a — new_session_day lifecycle（E4 day opening；handler 自己 gate 有無資產）
    //   PR-4c-green E4 fix: gate on session-state flag, not isNew (which only
    //   covers fresh row inserts). See shouldDispatchDayOpening() comment block.
    // ⭐ 6/6 A011 hotfix — additionally gate on !resumeAcrossGap. E4 day-opening
    //   is for "this is a new calendar day with carry-over from yesterday".
    //   Resume-across-gap is "this is the SAME unfinished day picked up later".
    //   Even if day_opening_done_this_session flag is missing on a legacy row,
    //   don't fire E4 cold-start on a resume — the [SESSION RESUME] inject
    //   (pushed below) drives continuity instead.
    if (shouldDispatchDayOpening(sessionState) && !resumeAcrossGap) {
      try {
        const r = await detectorRegistry.dispatch('new_session_day', ctx);
        const out = collectDetectorOutput(r);
        conditionalInjects.push(...out.injects);
        detectorPatch = { ...detectorPatch, ...out.patch };
        mergeIncrements(out.user_profile_increments);
      } catch (e) {
        console.error('new_session_day dispatch failed:', e.message);
      }
      // Stamp the flag regardless of whether E4 handled — idempotent retry
      // protection within the same session row. Flag resets naturally on Day N+1
      // (new session row → fresh session_state).
      detectorPatch.day_opening_done_this_session = true;
    }

    // ⭐ 6/6 A011 hotfix — resume-across-gap kickoff inject.
    //   Fires only on the kickoff turn of a resume-across-gap (not on
    //   every reuse turn). Tells the AI to look at message history and
    //   reference the prior thread instead of cold-starting with the
    //   elicitation 起手式. The history is already in the messages array
    //   sent to Sonnet, so no data fetch is needed — guidance alone is enough.
    // ⭐ 6/6 P0 hotfix — additionally gate on !sopActiveIncomplete. If the
    //   session was interrupted mid-crisis-SOP (e.g. A015: 學員打「我想自殺」
    //   進 Step 4, then disengaged), crisis-sop Fix 3 re-presents the current
    //   SOP step on kickoff. The A011 generic "look at history, continue
    //   prior thread" guidance would conflict ("不要重新起手式" vs crisis
    //   re-presenting the Step 4 phrasing). Crisis re-present wins (P0 safety).
    const sopActiveIncomplete = sessionState?.crisis_sop_state != null
      && typeof sessionState?.crisis_sop_state === 'object'
      && sessionState?.crisis_sop_complete !== true;
    if (resumeAcrossGap && isKickoff && !sopActiveIncomplete) {
      conditionalInjects.push(buildResumeGuidanceInject(gap_days));
      console.info('[session-resume][cross-gap-kickoff]', JSON.stringify({
        event: 'session_resume_guidance_injected',
        gap_days,
        session_day: sess.sessionDay,
        prior_turn_count: turnCount,
        // 鐵律 #2: no raw user text logged.
      }));
    } else if (resumeAcrossGap && isKickoff && sopActiveIncomplete) {
      console.info('[session-resume][cross-gap-kickoff-deferred-to-crisis]', JSON.stringify({
        event: 'session_resume_guidance_skipped_mid_sop',
        gap_days,
        sop_current_step: sessionState.crisis_sop_state.current_step,
      }));
    }

    // 7b — user_turn Sequential cascade
    //   ⭐ v5.2 第四塊 PR-b: skip when onboarding intercept took the turn
    //   (onboarding state machine is self-contained, no detector cascade needed).
    if (!onboardingTookTurn) {
      try {
        const r = await detectorRegistry.dispatch('user_turn', ctx);
        const out = collectDetectorOutput(r);
        conditionalInjects.push(...out.injects);
        detectorPatch = { ...detectorPatch, ...out.patch };
        mergeIncrements(out.user_profile_increments);
      } catch (e) {
        console.error('user_turn dispatch failed:', e.message);
      }
    }

    // 7c — soft-limit closure-guidance（PR-4c session_end）
    const closureHint = buildClosureHint({ turnCount });
    if (closureHint) conditionalInjects.push(closureHint);

    // ⭐ Step 7d — PR-23s4c task 7 — primary-only inject filter (crisis override).
    //   Per spec: 每 turn dynamic injection = primary_mode 對應 sub-prompts only;
    //   secondary / paused modes 不 inject (state 照寫給 transition-router).
    //   crisis as primary → 完整 inject; crisis 為 secondary (退出中) → 不 inject crisis SOP.
    //   Mode-gated handlers already self-filter (e.g. e3IntegrationRouterHandler
    //   returns handled=false unless primary_mode === integration). Architectural
    //   safety net: when primary_mode=crisis, suppress mode-toolbox injects to
    //   avoid SOP confusion (deep-signal-detector + crisis SOP inject win).
    //   Exception (per spec): Reframe Library conditional inject is signal-
    //   triggered + parallel with primary; PR-23s4c keeps the architecture
    //   minimal (no Reframe-suppress carve-out needed yet, body builds Step 7).
    const primaryModeForInject = (detectorPatch && detectorPatch.primary_mode)
      || sessionState.primary_mode || 'elicitation';
    if (primaryModeForInject === 'crisis') {
      // Crisis is primary — suppress mode-toolbox injects from non-crisis modes
      // that may have fired before primary flipped (handlers fire in priority
      // order; deep-signal at 20 may have flipped primary to crisis, then
      // elicitation at 30 may still inject because handler decision was made
      // before patch applied). Defensive filter on inject text.
      const SUPPRESS_PATTERNS = [
        /\[SYSTEM INJECT — Elicitation Router\]/,
        /\[SYSTEM INJECT — Top 1 Judge\]/,
        /\[SYSTEM INJECT — Integration Router\]/,
        /\[SYSTEM INJECT — Mode Transition Router\]/,
        /\[SYSTEM INJECT — Cascade Mode Validator\]/,
        /\[SYSTEM INJECT — Future Pacing Router\]/,
      ];
      const beforeCount = conditionalInjects.length;
      const filtered = conditionalInjects.filter(inj =>
        typeof inj !== 'string'
        || !SUPPRESS_PATTERNS.some(re => re.test(inj))
      );
      if (filtered.length < beforeCount) {
        console.info('[primary-only-inject][crisis-override]', JSON.stringify({
          event: 'crisis_suppress_non_crisis_injects',
          suppressed_count: beforeCount - filtered.length,
        }));
      }
      conditionalInjects.length = 0;
      conditionalInjects.push(...filtered);
    }

    // ⭐ v5.2 第二塊 PR-b — Cross-context handler case 3: detect student-initiated
    //   context swap intent (per spec §4.2). Inject reminder lock guidance.
    //   Skipped in crisis mode (orthogonal override per cached §3).
    // ⭐ v5.2 第五塊 — additive: 連續 swap turn 計數 + reset + escalate flag
    //   (spec §4.2「連續 3 turn 學員仍堅持換 context → escalate Vivi」). The
    //   case-3 marker埋的 alert 觸發 now lands here. Non-swap turn → reset 0
    //   (連續性). Crisis preserves count (don't reset / don't increment).
    // ⭐ 6/6 hotfix: skip when onboardingTookTurn — student hasn't picked an
    //   active_context yet so "swap" semantic is undefined, and studentRow's
    //   migration-029 default would yield a stale ctxNameForCcc.
    {
      const modeReadForCcc = readModeState(sessionState);
      const inCrisis = modeReadForCcc.primary_mode === 'crisis'
        || (Array.isArray(modeReadForCcc.active_modes) && modeReadForCcc.active_modes.includes('crisis'));
      const ctxForCcc = studentRow ? pickActiveContext(studentRow) : null;
      const ctxNameForCcc = ctxForCcc ? deriveContextNameForPhrasing(ctxForCcc) : null;
      const hasActiveContext = !!(ctxNameForCcc);
      const userText = typeof ctx?.user_response === 'string' ? ctx.user_response : '';
      // Only evaluate swap accounting when NOT in crisis AND active_context is set
      // AND not in onboarding (6/6 hotfix). No active_context = mid-onboarding /
      // un-provisioned → no "swap" semantics.
      if (!inCrisis && hasActiveContext && !onboardingTookTurn) {
        const swapDetected = detectCrossContextSwapIntent(userText);
        const prevSwapCount = Number(sessionState?.cross_context_swap_count) || 0;
        // Non-swap turn resets per spec §4.2 連續性 semantic.
        const newSwapCount = swapDetected ? prevSwapCount + 1 : 0;
        detectorPatch.cross_context_swap_count = newSwapCount;
        if (newSwapCount >= CROSS_CONTEXT_SWAP_THRESHOLD.consecutive_turns
            && prevSwapCount < CROSS_CONTEXT_SWAP_THRESHOLD.consecutive_turns) {
          // Set escalate flag once at threshold crossing (not every subsequent turn).
          detectorPatch.cross_context_swap_escalate = true;
          // [v5_2_cross_context][escalate] — dashboard / alert-rules pulls
          // session_state.cross_context_swap_count downstream (HITL Vivi review,
          // no email dispatch yet — wire-up是既有缺口, 同 Step 8 freeze).
          console.info('[v5_2_cross_context][escalate]', JSON.stringify({
            event: 'cross_context_swap_threshold_crossed',
            consecutive_turns: newSwapCount,
            threshold: CROSS_CONTEXT_SWAP_THRESHOLD.consecutive_turns,
            active_context_category: ctxForCcc?.category || null,
          }));
        }
        if (swapDetected) {
          const reminder = buildCrossContextReminderLockInject({
            contextName: ctxNameForCcc,
            studentWantedContext: '[他想換的]',
          });
          conditionalInjects.push(reminder);
          console.info('[v5_2_cross_context][case_3]', JSON.stringify({
            event: 'cross_context_swap_intent_detected',
            active_context_category: ctxForCcc?.category || null,
            consecutive_turns: newSwapCount,
            // 鐵律 #2: no raw user text in log.
          }));
        }
      }
    }

    // Step 8 — build system prompt array（cached prefix + dynamic）
    const stateForPrompt = { ...sessionState, ...detectorPatch };
    // ⭐ v5.2 第二塊 PR-a — derive active_context from studentRow (loaded at L869).
    //   Fallback gracefully when row absent (legacy student before migration 029)
    //   OR when activeContext fields are null (in-progress 不 break per spec §7.3).
    // ⭐ 6/6 hotfix: during onboarding (onboardingTookTurn=true) the onboarding
    //   sub-prompts (step-2/3 buildXxxInject) own the category anchor via the
    //   in-flight onboarding_step.picked_category. studentRow.active_context_*
    //   is still migration-029 default 1 — using it would re-introduce the
    //   "step 2 anchors 事業 regardless of pick" bug Vivi sandboxed. Suppress.
    const activeContext = (onboardingTookTurn || !studentRow)
      ? null
      : pickActiveContext(studentRow);
    const systemParam = buildSystemPromptArrayV5({
      sessionState: stateForPrompt,
      userProfile: userProfile || {},
      gapDays: gap_days,
      conditionalInjects,
      cachingEnabled,
      activeContext,
    });

    // Step 9 — Anthropic Sonnet call (with 429 backoff + 5xx 1-retry, 6/3 burst protection).
    //   429 全退 → callResult.ok=false reason='overload' → cleanup turn-level
    //   INSERT + 回 503 友善訊息. 其他 4xx / 5xx-after-retry → throw → 走原本 500 path.
    const callResult = await callAnthropicWithRetry(getAnthropic(), {
      model: MODEL,
      max_tokens: 700,
      system: systemParam,
      messages,
    });

    if (!callResult.ok && callResult.reason === 'overload') {
      // 6/3 Patrick — Anthropic 429 exhausted (Vivi burst protection spec).
      //   ⚠️ 純粹「這輪 turn 沒送出去」: 不寫 day_complete / takeaway_seeded /
      //      session_state — 上面 Step 11 之前就 return. user 重試還在同一輪 turn.
      //   Cleanup: roll back Step 6's user INSERT + questions_today bump
      //            so retry 不會 double-INSERT (frontend 也不會把 message commit
      //            進 state.conversation, 兩邊一起回到 turn 開始前的狀態).
      //   isNew session row: 不 set _succeeded → finally rollback 自己會 DELETE
      //                      (跟 A006 fix 同一條路徑).
      if (!isKickoff) {
        try {
          await sql`
            DELETE FROM messages WHERE id = (
              SELECT id FROM messages
               WHERE session_id = ${sessionId} AND role = 'user'
               ORDER BY id DESC LIMIT 1
            )
          `;
          await sql`
            UPDATE sessions SET questions_today = questions_today - 1, updated_at = NOW()
             WHERE id = ${sessionId}
          `;
        } catch (e) {
          // 非致命 — 重點是回 503, 讓 frontend 顯示友善訊息.
          console.error('[chat:overload] turn rollback failed (non-fatal):', e?.message || e);
        }
      }
      console.warn(`[chat:overload] Anthropic exhausted after ${callResult.attempts} attempts, returning 503`);
      return res.status(503).json({
        error: 'overload',
        message: '教練此刻太多人在對話、請 30 秒後再送一次。',
      });
    }

    const response = callResult.data;
    const rawContent = response.content[0].text;
    // ⭐ 6/7 P0 safety (Vivi A016) — Defense 2 deterministic backstop.
    //   Prompt rules (Defense 1, _phrasings.js CRISIS_OUTPUT_PROHIBITIONS
    //   embedded in Step 4 / Step 6 / active SI / cached §3) lower probability,
    //   but cannot guarantee zero「自殺」 emission from LLM improvisation.
    //   This scrubber is the guaranteed-deterministic last line: gated on
    //   inCrisis, replaces「自殺」 patterns with neutral noun phrases, logs
    //   structured event (鐵律 #2: no raw text).
    //   Production smoke (A016) caught AI emitting「你說『想自殺』」 after
    //   Step 6 reminder inject — this scrubber would have replaced it with
    //   「你說的這件事」 before persist + before student saw it.
    const crisisScrub = scrubCrisisAssistantOutput(rawContent, {
      inCrisis: isInCrisisState(stateForPrompt),
    });
    if (crisisScrub.scrubbed > 0) {
      console.info('[crisis][self-harm-word-scrubbed]', JSON.stringify({
        event: 'self_harm_word_scrubbed',
        scrubbed_count: crisisScrub.scrubbed,
        student_id: studentId,
        session_id: sessionId,
        crisis_in_progress: !!stateForPrompt?.crisis_in_progress,
        primary_mode: stateForPrompt?.primary_mode || null,
        sop_step: stateForPrompt?.crisis_sop_state?.current_step ?? null,
        // 鐵律 #2: 不 log 學員 / AI 原話, 只記事件 + count.
      }));
    }
    const content = crisisScrub.cleaned;
    const usage = response.usage || {};
    const durationMs = Date.now() - requestStart;

    // Step 10 — INSERT assistant message
    await sql`
      INSERT INTO messages (session_id, role, content, question_number)
      VALUES (${sessionId}, 'assistant', ${content}, ${turnCount})
    `;

    // Step 11 — state persist
    // v5.0 (spec 09 §12)：phase 推進 = dayPhasePatch (computed in Step 5b、
    // 天數驅動). checkAdvance no longer wired; advancePatch={}.

    // PR-4c-4c kickoff: persist only the AI opening as last_ai_question;
    // do NOT bump turn_count_this_session or last_user_response (sentinel is meta).
    const turnPatch = isKickoff
      ? { last_ai_question: content }
      : {
          turn_count_this_session: (sessionState.turn_count_this_session || 0) + 1,
          last_ai_question: content,
          last_user_response: userMessage.content,
          hard_limit_hit_this_session: turnCount >= HARD_LIMIT_TURNS,
        };

    // PR-4c-1b：fix 開場重複 bug — phase_1 turn 1 結束後 router_phase opening→elicitation
    const autoRouterPatch = maybeAutoTransitionRouterPhase({
      stateForPrompt, detectorPatch, advancePatch: {},
    }) || {};

    // ⭐ v5.1 Step 4 PR-23s4a — mode-tracker dual-write: mode keys merged into
    // fullPatch so they persist via updateState. modeStatePatch is computed in
    // Step 5c (read with router_phase fallback). detector handlers can later
    // override primary_mode (e.g. signal_cascade → crisis) via their own patch.
    const fullPatch = { ...modeStatePatch, ...detectorPatch, ...dayPhasePatch, ...turnPatch, ...autoRouterPatch };
    try {
      await updateState(sessionId, fullPatch);
    } catch (e) {
      console.error('updateState failed:', e.message);
    }

    // Step 11b — session_end 偵測（PR-4c：dayComplete + day_complete=TRUE 持久化）
    // PR-4c-4c: kickoff never triggers dayComplete — the AI shouldn't be
    // emitting closure markers on its own opening, and turnCount is 0.
    const dayComplete = isKickoff
      ? false
      : detectDayComplete({ content, turnCount, hardLimit: HARD_LIMIT_TURNS });
    if (dayComplete) {
      try {
        await sql`
          UPDATE sessions SET day_complete = TRUE, updated_at = NOW()
          WHERE id = ${sessionId}
        `;
      } catch (e) {
        console.error('day_complete UPDATE failed:', e.message);
      }
    }

    // Step 12 — user_profile lifecycle + chat_usage_log（fail-soft）
    try {
      await incrementUserProfileCounters(studentId, {
        gapDays: gap_days,
        isNewDay: isNew,
        // ⭐ §3 patch 6/4 (safety patch #23) — Cross-session passive death wish
        //   counter accumulated by E3 deep-signal handler this turn (0 when no
        //   detection). state-manager fail-opens on missing column so pre-
        //   migration runs don't break safety detection.
        passiveDwIncrement: userProfileIncrements.passive_death_wish_count || 0,
        // ⭐ v5.1 Step 5a — 5 cross-session signal counters (migration 026).
        //   Same fail-open pattern. Engine-1 emits these per-turn via signal detectors.
        signalIncrements: {
          external_locus_signals:          userProfileIncrements.external_locus_signals          || 0,
          passive_hope_signals:            userProfileIncrements.passive_hope_signals            || 0,
          frequency_illusion_signals:      userProfileIncrements.frequency_illusion_signals      || 0,
          conditional_worth_signals:       userProfileIncrements.conditional_worth_signals       || 0,
          negative_generalization_signals: userProfileIncrements.negative_generalization_signals || 0,
        },
      });
    } catch (e) {
      console.error('incrementUserProfileCounters failed:', e.message);
    }

    try {
      const dynamicChars = systemParam[systemParam.length - 1]?.text?.length || 0;
      await sql`
        INSERT INTO chat_usage_log
          (student_id, module, week, day, turn_count,
           caching_enabled, cache_creation, cache_read, uncached_input,
           output_tokens, duration_ms, damon_context_chars, dynamic_block_chars)
        VALUES
          (${studentId}, ${module}, ${parseInt(week) || 1}, ${day || 1}, ${turnCount},
           ${cachingEnabled},
           ${usage.cache_creation_input_tokens || 0},
           ${usage.cache_read_input_tokens || 0},
           ${usage.input_tokens || 0},
           ${usage.output_tokens || 0},
           ${durationMs}, 0, ${dynamicChars})
      `;
    } catch (e) {
      console.error('[chat_usage_log] insert failed:', e.message);
    }

    _succeeded = true;   // 5/28 Patrick (A006 rollback) — 走到這裡才算成功、finally 不會刪 row.
    // 5/29 Patrick — depthSignal (PRODUCT-TRUTH v2.3 §2.5 折衷 a):
    // 0..5 採集深度的 snapshot, 從 merged stateForPrompt + turnCount 算.
    // frontend 自己維持 watermark (走過不會倒退), 此處只回 snapshot.
    const depthSignal = computeDepthSignal(stateForPrompt, turnCount);
    // PR-23s4b hotfix (Vivi 6/4): response assembly extracted into pure helper
    // buildChatResponsePayload (testable, prevents recurring ReferenceError silent
    // breakage). Semantics:
    //   - phase = primary_mode (field name kept for backward compat)
    //   - phaseAdvanced = isNew OR mode-transition-this-turn (the v5.1 equivalent
    //     of v5.0 "phase just changed at cross-day boundary").
    //   - routerPhase = legacy mirror (still in fullPatch / sessionState fallback).
    return res.status(200).json(buildChatResponsePayload({
      content,
      turnCount,
      sessionId,
      stateForPrompt,
      fullPatch,
      priorSessionState: sessionState,
      detectorPatch,
      isNew,
      dayComplete,
      hardLimitTurns: HARD_LIMIT_TURNS,
      depthSignal,
    }));

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Server error' });
  } finally {
    // 5/28 Patrick (A006 case) — 殭屍 session row rollback.
    //   _succeeded=false + isNew row + sql 存在 → DELETE 本 turn 新建的 row.
    //   reuse 的 row 永遠不刪 (in-progress 對話絕不蒸發).
    //   402/409 early returns (PACING_LOCKED / PRIOR_FINALIZE_PENDING /
    //   TRIAL_UPGRADE_REQUIRED) 都在 _rollbackSessionId 被填之前 return → 不誤刪.
    //   決策邏輯抽到 lib/api/chat-rollback.js 純函式、由 chat-rollback.test.js 鎖.
    const outcome = await rollbackSessionIfNeeded({
      sql, sessionId: _rollbackSessionId, isNew: !!_rollbackSessionId, succeeded: _succeeded,
    });
    if (outcome === 'deleted') {
      console.warn(`[chat] rolled back newly-created session id=${_rollbackSessionId} after downstream failure (A006 fix)`);
    } else if (outcome.startsWith('delete-failed:')) {
      console.error(`[chat] CRITICAL: failed to rollback session id=${_rollbackSessionId}: ${outcome.slice('delete-failed:'.length)}`);
    }
  }
}

// ════════════════════════════════════════════════════════════════
// generateDamonNote / generateNotebookPage — v4.0 收尾生成（PR-4b 原樣保留）
// api/finalize-day.js 仍 import generateDamonNote；v5.0 對接 user_profile_evolution
// 的改寫排在 PR-4c。本段不參與 v5.0 orchestration、只是 finalize-day 的依賴。
// ════════════════════════════════════════════════════════════════

// v4.0 Phase 5.0c：conditional Damon Note 欄位 helper。
function buildDamonNoteConditionalFields(week, day) {
  const parts = [];

  if (week === 1) {
    parts.push(`【Scope 證據】（Week 1 採集、Week 3 Day 3 調用）
記錄學員在 2A confirm + evidence_script 之間說出的具體事件原文。
格式：
- 確立特質：[學員自己說出的詞、如：愛 / 毅力 / 負責任]
- 具體事件：
  事件 1：[原文]
  事件 2：[原文]
- 這些事件、Week 3 Day 3「打開 Scope」時直接調用、不重採。`);
  }

  if (week === 2 && day === 3) {
    parts.push(`【賦予新角色狀態】（Week 2 Day 3 採集、Week 3 持續沿用）
- 是否完成：是 / 否（學員是否打出「它答應了」/「它說好」/「它願意」）
- 給阻力的新角色名稱：[原文、如「真實雷達」]
- 卡點處理紀錄：[原文、如有「它好像還在猶豫」]`);
  }

  if (week === 3 && day === 3) {
    parts.push(`【確定類別 + Scope】（Week 3 Day 3 採集）
- 確定類別：[學員自己說出的詞、如：愛 / 毅力 / 負責任]
- Scope 證據庫：
  事件 1：[原文]
  事件 2：[原文]
- 五種核心類別參考（DAMON_CORE 末段）僅 AI 卡住時兜底、不替學員選`);
  }

  if (week === 3 && day === 4) {
    parts.push(`【Transfer 結果】（Week 3 Day 4 採集）
- 新 SC 句：[原文]
- 評分變化：[Day 1 分數] → [Day 4 分數]
- 時間軸渲染後學員的感受：[原文]`);
  }

  if (week === 3 && day === 5) {
    parts.push(`【微證據 + 反例預演結果】（Week 3 Day 5 採集）
- 微證據（至少 3 個）：
  證據 1：[原文]
  證據 2：[原文]
  證據 3：[原文]
- 反例預演中學員描述「新身份如何面對挫折」：[原文]`);
  }

  if (week === 3 && day === 6) {
    parts.push(`【宣言】（Week 3 Day 6 採集）
- 宣言完整句：「我是一個___的人。我不需要用___來___、因為我本來就___。」（學員填好的原文）
- 最後問句「你現在是誰？」的學員回答：[原文]`);
  }

  return parts.length === 0 ? '' : '\n\n' + parts.join('\n\n');
}

/**
 * v5.2 Damon Note system-prompt template (errata PR-a, verbatim 對齊 spec
 * §1.1-§1.5 / §8.1 / §9.1). Pure string returned by this function — the
 * (week, day) parameters only inject the per-session conditional fields via
 * buildDamonNoteConditionalFields; the rest of the template is byte-stable.
 *
 * Regex-locked headers (絕不可改字, finalize-day + chat.js 抓取):
 *   【關鍵句】 / 【明天的入口】 / 【SC 觀察】
 * Other headers may evolve (no regex dependency).
 *
 * Why a function not a const: the template embeds week/day-conditional
 * fields. The rest of the body is stable so test sync-gates that grep
 * verbatim spec text still pass against any caller's output.
 *
 * @param {number} week  1..3
 * @param {number} day   1..21
 * @returns {string}
 */
export function buildDamonNoteTemplateV52(week, day) {
  return `你是 Damon Cart、一個 Self Concept 教練。
你剛完成了一段和學員的對話。
請用教練的視角寫下今天的教練筆記 (v5.2 template).

⚠️ 系統前置 section (AI 不需自己輸出, 從【今天的模式】 寫起):
---
【active_context】 — 由系統從 DB 注入
【sc_step_when_generated】 — null placeholder (七步 errata ship 後接 logic)
---

格式 (嚴格按照、每個標題獨立一行):

【今天的模式】
學員今天反覆出現的詞或主題 (2-3 句). 事件層觀察、不評判.

【關鍵句】
今天學員說出來最重要的一句話 (用學員原話、加引號).
⚠️「被＿＿」結構 (被愛、被選擇、被需要、被看見、被接住) 不要直接寫成關鍵句——要寫學員後面那句話、或寫教練 mirror 的版本.
⚠️ v34 守則五優先:如果學員今天結尾「主動留下」了一個字 / 句 (在 AI 拋「你想留下什麼?哪怕一個字也好」之後)、那個學員主動留的字就是【關鍵句】首選素材.

【Mode 軌跡】 (取代 Layer 1-5, 對齊 v5.2 mode 框架)
今天 active_modes 軌跡 (用 → 串).
例:「elicitation 走完、進 identity_anchoring 觸發、return elicitation」
- 寫實際走過的 Mode 序列.
- 若 Step 5a 完成、可加 signal_flags 觸發摘要.
- 不寫「今天走到 Layer X」, 不寫「在『___』這裡停住了」.

【SC 觀察】 (Vivi 6/4 雙性質 framing, 教練的觀察、不給學員看)

  段 1: Damon 體系命名 sensory-grounded (不緩衝、直接命名)
    - 學員 surface 了什麼具體行為 / 句子、對應 Damon 體系哪個概念.
    - 例:「學員今天 surface 補償邏輯 (去紐約是補償伴侶出差的限制)、
          對應 The Bargain (交易幻覺)。
          紅線 23 觸發場景.」
    - 例:「學員 surface 完美主義表述
          (『追求極致狀態會耗竭致死』+『但還是很想追求完全的自由』)、
          對應 Perfectionism Trap (紅線 25).」

  段 2: 假設性推測 (維持 v3.3 風格、用「可能 / 猜想」緩衝)
    - 學員的潛在 SC 結構.
    - 用「學員可能是一個 X」「猜想 Y」緩衝詞.
    - 不下絕對判決.
    - 例:「猜想學員可能是一個深度相信『自由是我本質』的人、
          但同時可能帶著一個隱性信念:『完全自由需要條件齊備才算數.』」

  規則:
  - 緩衝詞區分 (§1.5):
    ❌ 行為命名不緩衝 (學員 surface 的具體事實 + Damon 體系對應名稱).
    ✅ SC 推測緩衝 (學員的內在結構、用「可能 / 猜想」).
    ✅ 心理結構 / 家庭關係推測: 保留緩衝 (體系不做心理分析).
    ❌ Damon 體系命名概念: 不緩衝、直接命名.
  - ⚠️ PR-4c-4e gender-neutral:用「學員」、不假設性別、不寫「她/他」.

【應 invoke 但未 invoke 的技術】 (v5.2 新增, 給 Vivi review AI behavior, 不給學員)
對照 v5.1 Damon Reframe Library 11 個 R-series + Mode-Tool 對映表, 列今天本該 invoke 但 AI 沒 invoke 的技術.

例:
- 「學員 surface 補償邏輯、應 invoke 紅線 23 Bargain 挑戰、未發生」
- 「學員 surface『我就是那個源頭』、R1 Reclaim Source 應強化、僅 echo」
- 「學員 surface 顧小孩 vs 自由內在 part 對立、R12 Hero's Welcome 應觸發、未發生」

4-step 寫法 (§1.4):
- 步驟 1: 識別學員 surface 的 Damon 體系訊號 (外部控制點 / The Bargain /
          Perfectionism Trap / Strategy vs Quality 等).
- 步驟 2: 對應應 invoke 的 v5.1 spec 元素 (紅線 22-25 / R-series Reframe Library /
          Mode-Tool 對映表).
- 步驟 3: 對照實際 AI 行為 — 教練實際 invoke 了哪些? 沒 invoke 但應該 invoke 的?
- 步驟 4: 寫入本 section, 列明 spec 對應位置 (如「紅線 23」「R1 Reclaim Source」
          「R12 Hero's Welcome step 3」). 不評判 AI、只記錄差距.

⚠️ Step 4-11 ship 前許多 R-series 還沒 ship, 本 section 會 show「等 Step N 完成」.
   Step 4-11 完成後本 section 真實 reveal AI 行為 vs spec gap.

【還沒碰到的】 (v3.3 維持 header, v5.2 規則 update)
- 暗示 Day 2+ 入口.
- v5.2 規則 update:
  ❌ 不用「學員繞過去了」「學員沒進去」 (這是 v3.3 framing、AI 在做心理分析).
  ✅ 改用「今天 surface 但未深入的入口」 (對齊 Damon 體系 sober 描述).

【明天的入口】
一個具體的問句、明天可以直接問學員的那種. 用教練的語氣.
⚠️ 必須是「主動發問」而不是「回問記憶」 (不要寫「你還記得嗎」「昨天我們停在哪」).

【Day 1-N 採集追蹤】 (重命名取代【Day 1-6 採集追蹤】, 對應 21 天 program)
- 今天觸發的 Mode: active_modes 軌跡.
- 今天 surface 的 Damon 體系概念: 命名清單.
- 今天 invoke 的 R-series: Reframe Library 使用清單.
- Top 1 / Top 2 / Top 3 quality candidates 演進: 對齊 cascade mode.
- 明天可繼續的: 從最有能量的詞 / 還沒採集的 quality.
- 廢除「工具一二三四 / 2A 2B 2C」分類.${buildDamonNoteConditionalFields(week, day)}

注意:
- 簡短有力、總長度上限 1000 字 (Week 3 整合日含完整宣言 + 三週素材、可寬到 1200 字).
- 不給答案、不重寫信念.

═══════════════════════════════════════════════════════════════════
【Damon 體系命名清單】(§1.3 — AI 對應使用、直接命名不緩衝)

Locus / Source:
- External Locus of Control (外部控制點)
- Reclaim Source (收回源頭、R1)
- Internal Source (內在源頭、來自 Damon 親口)

Trap Values 識別:
- The Bargain (交易幻覺、紅線 23)
- Perfectionism Trap (完美主義陷阱、紅線 25)
- Frequency Illusion (頻率錯覺、紅線 22)
- Self-worth Fiction (自我價值虛構、紅線 7)
- 副產品陷阱 (Byproduct Trap、紅線 24)
- Landmine Value (陷阱價值觀、引擎 2 黑名單)
- 證明自己 / 自我重要性 (errata v0.2 Tier 2)

Quality Status:
- Ambiguous Quality (模糊特質)
- Strategy vs Quality 區分 (引擎 2 dim 4)
- Behavior to Identity (行為轉特質、R2)
- Slip into Unconscious (身份滑入潛意識、R7)

Reframe Names (全部 11 個 R-series):
R1 Reclaim Source (收回源頭)
R2 Behavior to Identity (行為轉特質)
R3 失敗作為 Feedback / Golden Information (黃金情報)
R4 金錢 as Fuel
R5 Away From → Toward (從遠離到迎向)
R6 第一感知位置回歸
R7 Slip into Unconscious (身份滑入潛意識)
R8 T.O.T.E. Framework (errata v0.2)
R9 As-If Frame (彷彿框架、errata v0.2)
R10 Memento Mori (等待即是凋零、errata v0.2、⚠️ crisis disable)
R12 Hero's Welcome (英雄式歡迎 5 步驟 SOP、errata v0.2)

Tools (v5.1 IP):
IP #1 Scope Overlap (範圍重疊、亞洲文化柔軟拆解核心)
IP #2 東方文化柔軟拆解
IP #3 三向歸類
IP #4 5 層撥開技術
IP #5 NLP Amnesia 主動整合

Mode 名:
elicitation / identity_anchoring / integration / cascade / future_pacing / crisis

Tier 1-3 補充概念:
- Diamond Essence (鑽石本質、errata v0.3)
- Chief Validation Officer (首席驗證官、errata v0.3)
- Care Less List (少關注清單、errata v0.3)
- Good Enough for Now (目前已經足夠好、errata v0.2 / R7_C)
- 科學家精神 vs 受審判的犯人 (errata v0.2 / R3_C)
- Bias towards Action (行動偏好、errata v0.3)
- Memento Mori 等待即是凋零 (errata v0.2 / R10)
- 包含所有問題的感恩 (errata v0.3 / R7_D)
- 影子自我 (errata v0.3 / Hero's Welcome step 2 變體)
- 百萬分之一可能性 (errata v0.3)

Damon 親口高頻 metaphor:
- 鑽石本質 (Diamond Essence)
- 合金化比喻 (Alloy Metaphor、反例整合用)
- 魔鬼氈效應 (Velcro Effect、Submodality 操作、v5.1 不直接做)
- 忠誠士兵 (Loyal Soldier、Hero's Welcome step 2)
- 將軍走進防空洞 (Hero's Welcome step 1)
- Elizabeth Gilbert 寫東西 vs 寫精彩 (R7_C Good Enough)
═══════════════════════════════════════════════════════════════════

【⛔ 廢除詞嚴禁出現】 (v5.2 explicit guard, §1.1 廢除清單)
這些詞已廢, 任何段落都不能出現:
- ❌ Layer 1-5 / L1 / L2 / L3 / L4 / L5 / 「走到 Layer X」 (v3.3 廢, 用 Mode 軌跡).
- ❌ 工具一 / 工具二 / 工具三 / 工具四 (v3.3 廢).
- ❌ 2A SC 池 / 2B Reactive 池 / 2C Belief 池 (v3.3 廢).
- ❌ Cathy Q5 確認 (v3.3 cohort-specific, v5.1 不在).
- ❌ 「學員繞過去了」/「學員沒進去」 (心理分析 framing 廢).
- ❌ 「需要 X 才能 Y」 處方語氣 (體系不對學員下處方).
- ❌ 親密關係 / 家庭結構 / 童年深入推測 (體系明確 caveat、不做心理分析).

【緩衝詞分流規則】 (§1.5)
❌ 不緩衝 (直接命名):
- 學員 surface 的具體行為事實 (例:「學員去紐約的決定 surface 為補償邏輯」).
- Damon 體系命名概念 (例:「對應 The Bargain (交易幻覺、紅線 23)」、「對應 Perfectionism Trap」).
- 學員自己 surface 的句式 (例:「『追求極致狀態會耗竭致死』」).
- 應 invoke 但未 invoke 的技術 (例:「R1 Reclaim Source 應強化、僅 echo」, 不寫「可能應該 R1」).

✅ 緩衝 (用「可能 / 猜想」):
- 學員的潛在 SC 結構 (例:「猜想學員可能是一個深度相信『自由是我本質』的人」).
- 學員的家庭關係 / 心理結構 / 童年陰影推測 — 體系明確 caveat, 緩衝且不深入.
- 「學員的 SC 就是 X」 型 absolute statement 不可用, 改寫成「猜想學員的 SC 結構可能包含 X」.

注意:
- 條件欄位 (Scope 證據 / 賦予新角色狀態 / 確定類別 + Scope / Transfer 結果 /
  微證據 + 反例預演結果 / 宣言) 只在對應 week/day 採集、其他 day 不出現該欄位、
  不要寫「本日不採集」之類佔位字.`;
}

/**
 * 6/8 Vivi v5.2 errata PR-b — generateDamonNote 的 system prompt 吃主對話那份
 * 既有 cached prefix (對齊 spec §4).
 *
 * Shape 必須跟 buildSystemPromptArrayV5 的 cached prefix 段 byte-identical
 * (text=s.content, breakpoint 在 lastIdx) — 否則 cache 不共享、甚至 thrash.
 * 主對話呼叫的 cached prefix 已 warm; Damon Note 用同一組 CACHED_PREFIX_SECTIONS、
 * 同順序、同 breakpoint 構法 + 同 model → 直接 cache-read 命中、0.1× 計費、
 * 不算 TPM (Vivi 6/3 burst protection 量產實質容量 +5-10×).
 *
 * caching ON:  [cached_1, cached_2, cached_3, cached_4(breakpoint), template]
 * caching OFF: [{ text: 4 段 cached content + template (merged) }]
 *
 * 為什麼不重用 buildSystemPromptArrayV5: 主對話的 builder 把 buildDynamicContext
 * (sessionState / userProfile / gapDays / activeContext / conditionalInjects)
 * 也擠進 dynamic block; Damon Note 的 dynamic block 是 template (v5.2 PR-a 內容),
 * 跟主對話的 dynamic 語意完全不同. 共用 cached-prefix 構法 + 各自獨立的 dynamic
 * 區段, 是「兩個函式 mirror cached prefix shape」 的最小耦合做法.
 *
 * @param {object} args
 * @param {boolean} [args.cachingEnabled=false]  從 flags.PROMPT_CACHING 決定
 * @param {number}  args.week   for buildDamonNoteTemplateV52 conditional fields
 * @param {number}  args.day    for buildDamonNoteTemplateV52 conditional fields
 * @returns {Array<{type:'text', text:string, cache_control?:object}>}
 */
export function buildDamonNoteSystemArray({ cachingEnabled = false, week, day } = {}) {
  const templateText = buildDamonNoteTemplateV52(week, day);

  if (!cachingEnabled) {
    // caching OFF: 全部併成單一 text block (mirror buildSystemPromptArrayV5 OFF path).
    const merged = CACHED_PREFIX_SECTIONS.map(s => s.content).join('\n\n')
      + '\n\n' + templateText;
    return [{ type: 'text', text: merged }];
  }

  // caching ON: 4 cached + breakpoint@last + 1 template dynamic.
  // ⚠️ 這段 map 必須跟 buildSystemPromptArrayV5 的 cached prefix loop 逐字一致
  // (text = s.content, cache_control 只在 lastIdx), 否則 cache 不共享.
  const lastIdx = CACHED_PREFIX_SECTIONS.length - 1;
  const arr = CACHED_PREFIX_SECTIONS.map((s, i) => {
    const block = { type: 'text', text: s.content };
    if (i === lastIdx) block.cache_control = { type: 'ephemeral' };
    return block;
  });
  arr.push({ type: 'text', text: templateText });
  return arr;
}

// v34 hotfix 4：generateDamonNote 加 export、讓 api/finalize-day.js 共用。
// 6/7 Vivi — 新增 wasCrisis (default false) → 傳給 generateNotebookPage 切犀利/溫和.
//   finalize-day.js 用 lib/api/crisis-session-flag.js 從 session_state 算好再傳.
// 6/8 Vivi — v5.2 errata PR-a: template v5.2 化 (見 buildDamonNoteTemplateV52).
// 6/8 Vivi — v5.2 errata PR-b: system prompt 改吃 cached prefix (buildDamonNoteSystemArray).
//   ⚠️ 不動 generateNotebookPage (PR-d 才處理「我看見的」犀利卡).
//   ⚠️ 不動 3 個 regex-locked header: 【關鍵句】/ 【明天的入口】/【SC 觀察】.
export async function generateDamonNote(sql, sessionId, module, week, day, wasCrisis = false) {
  try {
    const messages = await sql`
      SELECT role, content FROM messages
      WHERE session_id = ${sessionId} AND role IN ('user', 'assistant')
      ORDER BY created_at ASC
    `;
    if (messages.length < 2) return null;

    const moduleLabel = module === 'self' ? '自我關係' : module === 'money' ? '金錢關係' : '伴侶關係';
    // PR-4c-green Vivi 5/24 polish: user-facing「Damon」 → 「教練」.
    // 內部識別碼保留 (table damon_notes / col damon_note / fn generateDamonNote /
    // 「Damon Cart」 persona — that's the methodology brand the coach reads by).
    // Sonnet's persona stays「Damon Cart」 since it doesn't echo in output;
    // but the note's own naming + 「Damon 語氣」 vernacular flips to「教練」.
    const conversationText = messages.map(m =>
      `${m.role === 'user' ? '【學員】' : '【教練】'} ${m.content}`
    ).join('\n\n');

    // 6/8 Vivi v5.2 errata PR-b — 讀 cachingEnabled 從同一個 flag 來源 (主對話用的).
    //   loadFeatureFlags 自有 30s in-memory cache + env fallback + 內部 try/catch
    //   → safe to call; PROMPT_CACHING default ON (跟主對話對齊).
    //   fail-safe: 任何讀取失敗 default to ON (保 cache 共享 + Vivi 6/3 burst protection).
    let cachingEnabled = true;
    try {
      const flags = await loadFeatureFlags(sql);
      cachingEnabled = flags?.PROMPT_CACHING !== false;
    } catch (e) {
      console.warn('[generateDamonNote] loadFeatureFlags failed (default ON):', e?.message || e);
    }

    const response = await getAnthropic().messages.create({
        model: MODEL,
        max_tokens: 1500,
        // 6/8 Vivi v5.2 errata PR-b — system: cached prefix (4 段) + v5.2 template.
        // Same model + same cached bytes + same breakpoint → cache-share with
        // main chat handler's buildSystemPromptArrayV5 cached prefix (~5000 tokens
        // saved per Damon Note call). Template content (v5.2 errata PR-a verbatim)
        // is byte-stable across calls except for (week, day)-conditional fields.
        system: buildDamonNoteSystemArray({ cachingEnabled, week, day }),
        messages: [{
          role: 'user',
          // P5 (PR-4c-green): v5 canonical unit is sessionDay (1..21); the prior
          // 「第 N 週，第 N 天」 framing is a v4 holdover. Week is still derivable but
          // not surfaced in the daily prompt header — keeps the note's mental
          // model aligned with the new 21-day rhythm.
          content: `模組：${moduleLabel}，Day ${day}（共 21 天）。\n\n${conversationText}\n\n請寫下今天的教練筆記。`
        }]
    });

    const aiBody = response.content[0].text;

    const studentRow = await sql`SELECT student_id FROM sessions WHERE id = ${sessionId} LIMIT 1`;
    const studentIdOfSession = studentRow[0]?.student_id;
    if (!studentIdOfSession) {
      console.warn('generateDamonNote: student_id not found for sessionId=' + sessionId);
      return null;
    }

    // PR-4c-4e — fetch preferred_name for the notebook-page Vivi-warm prompt
    // 6/8 Vivi — 同 query 順手撈 active_context_* 給 §8 anchor 前置注入.
    //   讀失敗 → fallback null placeholder ("(未設定)") + log; 不擋整支生成.
    let preferredName = null;
    let activeContextCategory = null;
    let activeContextName = null;
    let activeContextDefinition = null;
    try {
      const pr = await sql`
        SELECT preferred_name,
               active_context_category, active_context_name, active_context_definition
          FROM students WHERE student_id = ${studentIdOfSession} LIMIT 1
      `;
      if (pr.length > 0) {
        if (pr[0].preferred_name) preferredName = pr[0].preferred_name;
        activeContextCategory   = pr[0].active_context_category   ?? null;
        activeContextName       = pr[0].active_context_name       ?? null;
        activeContextDefinition = pr[0].active_context_definition ?? null;
      }
    } catch (e) { console.warn('[generateDamonNote] student row lookup failed:', e.message); }

    // ⭐ 6/8 Vivi v5.2 errata §8.1 + §9.1 — 前置注入 anchor + hook placeholder.
    //   為什麼前置 (不 trust AI 重複輸出): anchor 是事實層, 來自 students 表;
    //   每次都從 DB 讀, 不讓 AI 改寫 / 漏掉 / 寫錯 category. sc_step_when_generated
    //   是 null placeholder, 沒 logic, 七步 errata ship 後另一個 PR 才接 logic.
    //   位置:在 AI body 最前面, 在【關鍵句】之前. 用 `---` 分隔 (spec §8.1 / §9.1
    //   verbatim 格式). `---` 也是 scrubber 的 section terminator → 即使這兩個
    //   section 被 scrubber 擋 (它們都在 FORBIDDEN_SECTION_MARKERS 內), `---`
    //   仍幫忙界定本段結束.
    const activeContextAnchor =
      `---\n`
      + `【active_context】\n`
      + `category: ${activeContextCategory ?? '(未設定)'}\n`
      + `name: ${activeContextName ?? '(未設定)'}\n`
      + `definition: ${activeContextDefinition ?? '(未設定)'}\n`
      + `---\n`;
    const scStepPlaceholder =
      `---\n`
      + `【sc_step_when_generated】\n`
      + `step: null  # placeholder、七步 errata ship 後實作 logic\n`
      + `evidence_focus: null  # placeholder、七步 errata ship 後實作 logic\n`
      + `---\n`;
    // AI body might or might not echo these (prompt told it to skip);
    // strip any echoed prefix to avoid duplicates, then prepend canonical ones.
    let bodyMinusAnchors = aiBody;
    bodyMinusAnchors = bodyMinusAnchors.replace(
      /^\s*【active_context】[\s\S]*?(?=\n【(?!active_context】|sc_step_when_generated】))/m,
      '',
    );
    bodyMinusAnchors = bodyMinusAnchors.replace(
      /^\s*【sc_step_when_generated】[\s\S]*?(?=\n【(?!sc_step_when_generated】))/m,
      '',
    );
    bodyMinusAnchors = bodyMinusAnchors.replace(/^\s+/, '');
    const fullNote = `${activeContextAnchor}\n${scStepPlaceholder}\n${bodyMinusAnchors}`;

    // Regex extraction — UNCHANGED (3 locked headers preserved).
    const keyPhraseMatch = fullNote.match(/【關鍵句】\s*\n([\s\S]*?)(?=\n【|$)/);
    const tomorrowMatch = fullNote.match(/【明天的入口】\s*\n([\s\S]*?)(?=\n【|$)/);
    const keyPhrase = keyPhraseMatch ? keyPhraseMatch[1].trim() : '';
    const tomorrowEntry = tomorrowMatch ? tomorrowMatch[1].trim() : '';
    const publicNote = keyPhrase
      ? `今天你說了一句很重要的話：\n${keyPhrase}\n\n明天我們從這裡繼續——\n${tomorrowEntry}`
      : '';

    await sql`
      INSERT INTO damon_notes (student_id, module, week, day, note_text, is_week_summary, template_version)
      VALUES (${studentIdOfSession}, ${module}, ${week}, ${day}, ${fullNote}, false, 'v5.2')
      ON CONFLICT (student_id, module, week, day, is_week_summary)
      DO UPDATE SET note_text = EXCLUDED.note_text, template_version = 'v5.2', updated_at = NOW()
    `;

    await sql`
      UPDATE sessions
      SET damon_note = ${fullNote}, updated_at = NOW()
      WHERE id = ${sessionId}
    `;

    await sql`
      UPDATE sessions
      SET damon_note_public = ${publicNote}, updated_at = NOW()
      WHERE id = ${sessionId}
    `;

    const scMatch = fullNote.match(/【SC 觀察】\s*\n([\s\S]*?)(?=\n【|$)/);
    const todaySCHypothesis = scMatch ? scMatch[1].trim() : '';

    let yesterdaySCHypothesis = null;
    try {
      const prevSession = await sql`
        SELECT note_text FROM damon_notes
        WHERE student_id = ${studentIdOfSession}
          AND module = ${module}
          AND is_week_summary = false
          AND (week < ${week} OR (week = ${week} AND day < ${day}))
        ORDER BY week DESC, day DESC
        LIMIT 1
      `;
      if (prevSession.length > 0) {
        const prevSCMatch = prevSession[0].note_text?.match(/【SC 觀察】\s*\n([\s\S]*?)(?=\n【|$)/);
        yesterdaySCHypothesis = prevSCMatch ? prevSCMatch[1].trim() : null;
      }
    } catch (e) {
      console.warn('Yesterday SC hypothesis lookup failed:', e.message);
    }

    const notebookPage = await generateNotebookPage(sql, sessionId, module, fullNote, yesterdaySCHypothesis, preferredName, wasCrisis);

    return { fullNote, publicNote, notebookPage, todaySCHypothesis };
  } catch (e) {
    console.error('Damon Note error:', e);
    return null;
  }
}

export async function generateNotebookPage(sql, sessionId, module, fullNote, yesterdaySCHypothesis, preferredName = null, wasCrisis = false) {
  try {
    const moduleLabel = module === 'self' ? '自我關係' : module === 'money' ? '金錢關係' : '伴侶關係';
    // PR-4c-4e — preferredName is a warm hook the prompt can use sparingly.
    // The page is addressed to the student in 第二人稱「你」, with {preferredName}
    // appearing 0-1 times for warmth — NOT a SaaS 「歡迎回來」 greeting and not at the top.
    const nameHint = preferredName
      ? `學員的稱呼是「${preferredName}」。整篇 0-1 次自然帶過(如「${preferredName}、今天你說了…」)— 不放開頭、不重複、寫信感不是寒暄。`
      : `學員沒提供稱呼。整篇用「你」、不用「她/他」、不用「學員」。`;

    // ⭐ 6/7 Vivi — 「我看見的」section 分犀利 / 溫和兩版.
    //   crisis 場 (wasCrisis=true) → 溫和版 (原 80字 緩衝版本) — 學員剛脆弱過,
    //     不該回敬一句利的「身份規則」.
    //   非 crisis 場 → 犀利版 (Patrick 6/7 spec) — 直接點破 SC 觀察那條
    //     「身份規則 / 隱性信念」, 學員自己的詞當刀, 加「不舒服=工具」框架.
    //   Default false (caller forgot 傳值): treat as non-crisis (sharp). This
    //     is balanced against finalize-day.js sending the actual flag from
    //     sessionTouchedCrisis(), which itself fail-safes to gentle. Two
    //     layers of bias: helper biases to gentle on ambiguity; caller default
    //     is sharp. Net effect: only well-formed non-crisis sessions get sharp.
    const seeingSection = wasCrisis
      ? `✦ 我看見的(一個假設)

- 把後端 SC 觀察寫成「你可能是 X」的猜想語氣、不要「她可能是」
- 緩衝詞必加:可能、可能不是、猜想
- 結尾必加:邀請你 sit with 一句具體的話
  - 不要用通用的「你自己怎麼看?」
  - 用具體的「— 這只是猜想。但我想問你——『[今天你說過的一句話]』、你聽到這句話、有什麼感覺?」
- 約 80 字
- ⚠️ 本場次曾觸發 crisis SOP, 學員剛脆弱過. 此段保持溫和緩衝、不要犀利點破身份規則。`
      : `✦ 我看見的(一個假設)

- 直接點破後端【SC 觀察】最核心那條「身份規則 / 隱性信念」——這段就是要犀利、
  要讓學員「被說中」的那一下。不要磨成安全的表層觀察。
  反例(太溫、不要):「你可能是個習慣付出的人。」
  正解(夠利、要這樣):「你可能不是在關係裡找位置——你是在用『被需要』
  換一張『我有資格存在』的入場券。不照顧人的時候,你不太確定自己是誰。」
- 用學員自己今天的詞當刀(他自己說的「廢人」「愧疚」這類原話),讓尖銳是
  「他自己的」、不是 AI 外加的評斷。
- 這是「假設」不是判決:框成「我猜想 / 一個假設」一次就好,不要層層堆
  「可能、可能不是、或許」把力道稀釋掉。
- 不評價、不替他修正信念——點破,然後把它留在他面前。
- 不舒服 = 工具(必加一句、約這個意思):
  「如果這句讓你心裡一震、或者很想反駁——別急著推開。那個不舒服就是線索。
   回來看看:是哪一句、哪個字讓你不舒服?那裡,往往就是還沒被你看見的自己。」
- 結尾邀請 sit with 一句具體的話:
  「——這只是一個假設。但我想問你——『[今天你說過的一句話]』、
   你聽到自己說這句話、有什麼感覺?」
- 約 120-160 字, 要有「醍醐灌頂」的一下, 寧可短而利、不要長而鈍。`;

    // Rule 5 length cap: sharp section is longer → bump cap. Crisis/gentle keeps the original 350.
    const totalLengthCap = wasCrisis ? 350 : 430;

    const response = await getAnthropic().messages.create({
        model: MODEL,
        max_tokens: 800,
        system: `你是 Vivi 教練。
把今天的學員觀察(後端 Damon Note)改寫成「私人筆記本一頁」、給學員看(學員會直接讀這頁)。
這頁是 Vivi 教練「寫給這個學員的私信」、第二人稱「你」、有溫度但不雞湯。

⚠️ 人稱 / 性別(PR-4c-4e 拍板):
- 整篇用「你」、不寫「她」「他」「她/他」雙視角。
- 不假設學員的性別、不用代詞猜性別。
- ${nameHint}

格式(嚴格按照):

[主敘事段、無標題、開頭即敘事]
- 第二人稱「你」(「今天你說了…」「我聽著你…」「你停了一下、那裡有什麼?」)
- 含學員今天反覆出現的詞(自然帶過、不列點)
- 含關鍵句(用學員原話加引號)
- 含「還沒碰到的」(用「但你繞過去了」「你沒進去」這種敘事帶出)
- 含「層次」描述(「你碰到了一個層次的邊」、不直接寫 Layer 1-5、不寫「工具一/二/三/四」)
- 約 200 字

${seeingSection}

✦ 明天

「我會帶你回到一個問題——
[後端 Damon Note 抽出來的「明天的入口」問句、一字不改]」
- 約 30 字

— V

【嚴格規則】
1. 不簽 Damon 名字、不寫「Damon Cart」
2. 用 Vivi 風格:短句、留白、不雞湯
3. SC 觀察用「可能」「猜想」緩衝、不斷定 (本規則僅 wasCrisis=溫和場適用; 犀利場走上面 ✦ 段內指引: 一次「猜想/假設」標記即可、不重複堆疊)
4. 不寫禁用詞(加油、你已經很努力了、擁抱自己、成為更好的自己、跟著做就會、立刻改變人生)
5. 簡短有力、總長度不超過 ${totalLengthCap} 字
6. 不替你「修正」信念、只讓信念被看見
7. SC 觀察是假設、不是判斷 (犀利 ≠ 下判決;是精準點破 + 留給他)
8. 如果有「昨天的 SC 假設」(yesterdaySCHypothesis)、今天的「我看見的」要 reference、寫成「進化感」、不重複昨天的話、要精煉
9. 如果今天 Damon Note 有「教練給的正面身份候選」(如「為朋友、為公司付出的你、也是你」)、必須保留進敘事末段
10. ⚠️ 學員會直接讀這頁:禁止出現任何 Damon Note section 名稱(【SC 觀察】 / 【深度層次】 / 【還沒碰到的】 / 【明天的入口】 / 【採集追蹤】 / 【關鍵句】 等)、禁止「工具一/二/三/四」、禁止「Layer 1-5 / L1-L5」、禁止「2A SC 池 / 2B Reactive 池 / 2C Belief 池」`,
        messages: [{
          role: 'user',
          content: `模組：${moduleLabel}

今天的後端 Damon Note：
${fullNote}

${yesterdaySCHypothesis ? `昨天的 SC 假設（要 reference、精煉、不重複）：
${yesterdaySCHypothesis}

` : ''}請寫今天的筆記本一頁、給學員看。`
        }]
    });

    const notebookPage = response.content[0].text;

    await sql`
      UPDATE sessions
      SET notebook_page = ${notebookPage}, updated_at = NOW()
      WHERE id = ${sessionId}
    `;

    return notebookPage;
  } catch (e) {
    console.error('Notebook page error:', e);
    return null;
  }
}
