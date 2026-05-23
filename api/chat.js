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
} from '../lib/session/day-boundary.js';
import { contextFor } from '../lib/session/phase-context.js';
import { checkAdvance } from '../lib/session/phase-advance.js';
import {
  updateState, getUserProfile, incrementUserProfileCounters,
} from '../lib/state/state-manager.js';

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
      PROMPT_CACHING: process.env.FEATURE_PROMPT_CACHING === 'true',
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
 *   { action: 'reuse',  sessionDay }       — there's an in-progress session, continue it
 *   { action: 'create', sessionDay }       — open a fresh Day-N row (calendar-day boundary
 *                                            OR self-paced post-finalize same-day)
 *   { action: 'locked', sessionDay }       — daily mode + last session already complete today,
 *                                            Day N+1 unlock waits for the next calendar day
 *
 * sessionDay derivation:
 *   reuse  → inProgress.day
 *   create → (userSessionDayCount || 0) + 1   — source of truth is the cross-session counter;
 *                                               works with scripts/advance_student_day.sql
 *                                               (which bumps session_day_count without
 *                                               creating sessions rows)
 *   locked → prior.day                       — informational
 *
 * @param {object} args
 * @param {{day?:number}|null} args.inProgress       — most-recent day_complete=FALSE row (or null)
 * @param {{day?:number,session_date?:Date|string}|null} args.prior  — most-recent row of any state
 * @param {'daily'|'self-paced'} args.pace
 * @param {string} args.sessionDate                  — today's 'YYYY-MM-DD'
 * @param {number} args.userSessionDayCount          — user_profile_evolution.session_day_count
 * @returns {{ action:'reuse'|'create'|'locked', sessionDay:number }}
 */
export function decideSessionAction({ inProgress, prior, pace, sessionDate, userSessionDayCount = 0 } = {}) {
  if (inProgress) {
    return { action: 'reuse', sessionDay: inProgress.day || 1 };
  }
  const priorDay = prior?.day || 0;
  const priorDateStr = normalizeDateString(prior?.session_date);
  if (pace === 'daily' && priorDateStr && priorDateStr === sessionDate) {
    return { action: 'locked', sessionDay: priorDay };
  }
  return { action: 'create', sessionDay: (userSessionDayCount || 0) + 1 };
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
async function loadOrCreateSession(sql, { studentId, module, sessionDate, sessionNotes, pace = 'daily', userSessionDayCount = 0 }) {
  // 1. Look for an in-progress session (day_complete=FALSE) — that's the current Day N being worked.
  const inProgressRows = await sql`
    SELECT id, day, questions_today, created_at, session_state
    FROM sessions
    WHERE student_id = ${studentId} AND module = ${module} AND day_complete = FALSE
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const inProgress = inProgressRows[0] || null;

  // 2. No in-progress — look up the most-recent prior row for carry-over + pace check
  let prior = null;
  if (!inProgress) {
    const priorRows = await sql`
      SELECT day, session_state, session_date
      FROM sessions
      WHERE student_id = ${studentId} AND module = ${module}
      ORDER BY created_at DESC
      LIMIT 1
    `;
    prior = priorRows[0] || null;
  }

  const decision = decideSessionAction({ inProgress, prior, pace, sessionDate, userSessionDayCount });

  if (decision.action === 'reuse') {
    return {
      sessionId:    inProgress.id,
      sessionDay:   decision.sessionDay,
      turnCount:    inProgress.questions_today || 0,
      sessionStart: new Date(inProgress.created_at),
      sessionState: inProgress.session_state || {},
      isNew:        false,
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
 * @returns {string}
 */
export function buildDynamicContext(sessionState = {}, userProfile = {}, gapDays = 0) {
  const phase = sessionState.current_phase || 'phase_1';
  const lines = ['━━━ 本場學員狀態（runtime、不快取）━━━'];

  const top1 = userProfile.top1_value || sessionState.top1_value || null;
  const anchors = Array.isArray(userProfile.anchors) ? userProfile.anchors : [];
  const ranking = Array.isArray(userProfile.values_ranking) ? userProfile.values_ranking : [];

  lines.push(`current_phase：${phase}`);
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

  // {{current_phase_context}} — PR-4c-1b：phase_1 router_phase-aware
  // (opening 變體含起手式 / elicitation 變體用鏈式追問、避免開場重複)
  const phaseCtx = contextFor(phase, sessionState.router_phase);
  if (phaseCtx) lines.push('\n' + phaseCtx);

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
}) {
  const dynamicText = buildDynamicContext(sessionState, userProfile, gapDays)
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
  for (const r of results || []) {
    if (!r || !r.ok || !r.result) continue;
    const out = r.result;
    if (out.patch && typeof out.patch === 'object') patch = { ...patch, ...out.patch };
    if (out.handled === true && typeof out.inject === 'string' && out.inject.length > 0) {
      injects.push(out.inject);
    }
  }
  return { injects, patch };
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
  if (stateForPrompt.current_phase !== 'phase_1') return null;
  if (stateForPrompt.router_phase !== 'opening') return null;
  // detector 或 phase-advance 已動過 router_phase → 尊重它、不覆寫
  if (detectorPatch && detectorPatch.router_phase != null) return null;
  if (advancePatch  && advancePatch.router_phase  != null) return null;
  return { router_phase: 'elicitation' };
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

  // Step 1 — parse（week/day 收下但 v5.0 不參與邏輯、僅過渡相容寫回 columns）
  const { messages: rawMessagesIn, studentId, module, week, day, sessionNotes, today } = req.body || {};
  if (!studentId || !module) {
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

  const sessionDate = today || new Date().toLocaleDateString('sv');
  const requestStart = Date.now();
  const now = new Date();

  try {
    // Step 3 — SQL + flags
    const sql = neon(process.env.DATABASE_URL);
    const flags = await loadFeatureFlags(sql);
    const cachingEnabled = flags.PROMPT_CACHING === true;

    // Step 4 — user profile + pace + new_session_day 偵測
    let userProfile = null;
    try {
      userProfile = await getUserProfile(studentId);
    } catch (e) {
      console.warn('getUserProfile failed:', e.message);
    }
    // PR-4c-4e — fetch pace from students table (defaults to 'daily' if not set)
    let pace = 'daily';
    try {
      const pr = await sql`SELECT pace FROM students WHERE student_id = ${studentId} LIMIT 1`;
      if (pr.length > 0 && pr[0].pace) pace = pr[0].pace;
    } catch (e) { console.warn('[chat] pace lookup failed:', e.message); }
    const { gap_days } = detectNewSessionDay(userProfile, now);

    // Step 5 — load / create today's session（PR-4c-4e: pace-aware + day_complete-aware）
    const sess = await loadOrCreateSession(sql, {
      studentId, module, sessionDate, sessionNotes,
      pace,
      userSessionDayCount: userProfile?.session_day_count || 0,
    });
    // PR-4c-4e — daily mode + last session already complete today → Day N+1 locked
    if (sess.pacingLocked) {
      return res.status(409).json({
        error:      'PACING_LOCKED',
        message:    '今天的對話已收尾、明天再回來。',
        sessionDay: sess.sessionDay,
      });
    }
    const { sessionId, sessionStart, isNew } = sess;
    let { turnCount, sessionState } = sess;

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
      user_profile: userProfile || {},
      anchors_top3: anchorsArr.slice(-3),
      last_3_turns: messages.slice(-6).map(m => m?.content || ''),
      // judges 留空 → detector handlers 用真實 Haiku judge（lib/haiku-judge/*）
      logMiss: (m) => console.warn('[detector miss]', JSON.stringify(m)),
    };

    const conditionalInjects = [];
    let detectorPatch = {};

    // 7a — new_session_day lifecycle（E4 day opening；handler 自己 gate 有無資產）
    if (isNew) {
      try {
        const r = await detectorRegistry.dispatch('new_session_day', ctx);
        const out = collectDetectorOutput(r);
        conditionalInjects.push(...out.injects);
        detectorPatch = { ...detectorPatch, ...out.patch };
      } catch (e) {
        console.error('new_session_day dispatch failed:', e.message);
      }
    }

    // 7b — user_turn Sequential cascade
    try {
      const r = await detectorRegistry.dispatch('user_turn', ctx);
      const out = collectDetectorOutput(r);
      conditionalInjects.push(...out.injects);
      detectorPatch = { ...detectorPatch, ...out.patch };
    } catch (e) {
      console.error('user_turn dispatch failed:', e.message);
    }

    // 7c — soft-limit closure-guidance（PR-4c session_end）
    const closureHint = buildClosureHint({ turnCount });
    if (closureHint) conditionalInjects.push(closureHint);

    // Step 8 — build system prompt array（cached prefix + dynamic）
    const stateForPrompt = { ...sessionState, ...detectorPatch };
    const systemParam = buildSystemPromptArrayV5({
      sessionState: stateForPrompt,
      userProfile: userProfile || {},
      gapDays: gap_days,
      conditionalInjects,
      cachingEnabled,
    });

    // Step 9 — Anthropic Sonnet call
    const response = await getAnthropic().messages.create({
      model: MODEL,
      max_tokens: 700,
      system: systemParam,
      messages,
    });
    const content = response.content[0].text;
    const usage = response.usage || {};
    const durationMs = Date.now() - requestStart;

    // Step 10 — INSERT assistant message
    await sql`
      INSERT INTO messages (session_id, role, content, question_number)
      VALUES (${sessionId}, 'assistant', ${content}, ${turnCount})
    `;

    // Step 11 — phase advance + state persist
    let advance = null;
    try {
      advance = checkAdvance(stateForPrompt);
    } catch (e) {
      console.error('checkAdvance failed:', e.message);
    }
    const advancePatch = advance ? advance.patch : {};

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
      stateForPrompt, detectorPatch, advancePatch,
    }) || {};

    const fullPatch = { ...detectorPatch, ...advancePatch, ...turnPatch, ...autoRouterPatch };
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
      await incrementUserProfileCounters(studentId, { gapDays: gap_days, isNewDay: isNew });
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

    return res.status(200).json({
      content,
      turnCount,
      sessionId,
      phase: advance ? advance.to : stateForPrompt.current_phase,
      routerPhase: fullPatch.router_phase || sessionState.router_phase || null,
      phaseAdvanced: !!advance,
      // PR-4c：session_end 寫活、frontend 依 dayComplete=true 觸發 §5.2 轉場 + POST /api/finalize-day
      dayComplete,
      notesGenerating: dayComplete,
      turnsLeft: Math.max(0, HARD_LIMIT_TURNS - turnCount),
    });

  } catch (error) {
    console.error('Server error:', error);
    return res.status(500).json({ error: 'Server error' });
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

// v34 hotfix 4：generateDamonNote 加 export、讓 api/finalize-day.js 共用。
export async function generateDamonNote(sql, sessionId, module, week, day) {
  try {
    const messages = await sql`
      SELECT role, content FROM messages
      WHERE session_id = ${sessionId} AND role IN ('user', 'assistant')
      ORDER BY created_at ASC
    `;
    if (messages.length < 2) return null;

    const moduleLabel = module === 'self' ? '自我關係' : module === 'money' ? '金錢關係' : '伴侶關係';
    const conversationText = messages.map(m =>
      `${m.role === 'user' ? '【學員】' : '【Damon】'} ${m.content}`
    ).join('\n\n');

    const response = await getAnthropic().messages.create({
        model: MODEL,
        max_tokens: 1500,
        system: `你是 Damon Cart、一個 Self Concept 教練。
你剛完成了一段和學員的對話。
請用教練的視角寫下今天的 Damon Note。

格式（嚴格按照、每個標題獨立一行、順序對齊 v3.3）：

【今天的模式】
學員今天反覆出現的詞或主題（2-3 句）。事件層的觀察。

【關鍵句】
今天學員說出來最重要的一句話（用學員原話、加引號）。
⚠️ 「被＿＿」結構（被愛、被選擇、被需要、被看見、被接住）不要直接寫成關鍵句——要寫學員後面那句話、或寫教練 mirror 的版本。
⚠️ v34 守則五優先：如果學員今天結尾「主動留下」了一個字 / 句（在 AI 拋「你想留下什麼？哪怕一個字也好」之後）、那個學員主動留的字就是【關鍵句】首選素材。

【深度層次】
今天最深走到哪裡（Layer 1-5）？
- Layer 1：行為敘述
- Layer 2：情緒
- Layer 3：身體感覺
- Layer 4：價值 / 渴望
- Layer 5：身份（Self Concept）

標記格式：「今天走到 Layer X。在『___』這裡停住了。」

【SC 觀察】（教練的假設性觀察、不給學員看）
- 學員目前的 Self Concept 可能是什麼？什麼信念可能在驅動學員？
- 用「可能」「假設」「猜想」緩衝詞、不寫斷定句
- 不寫「你的 SC 就是 X」、寫「學員可能是一個 X」
- ⚠️ PR-4c-4e gender-neutral：用「學員」、不假設性別、不寫「她/他」
- 這個 section 是給 Vivi 看的、不會直接 reveal 給學員

【還沒碰到的】
今天還有哪個地方值得繼續挖、但還沒碰到？
用「學員繞過去了」「學員沒進去」這種敘事描述、暗示 Day 2+ 可以接的入口。

【明天的入口】
一個具體的問句、明天可以直接問學員的那種。用 Damon 的語氣。
⚠️ 必須是「主動發問」而不是「回問記憶」（不要寫「你還記得嗎」「昨天我們停在哪」）。

⚠️ v34 工具二來源標籤分流（如果學員今天有用工具二）：
- 學員選 2A 句並 confirm → 那個填空詞 + confirm 後的延伸 → 寫進【關鍵句】候選（要過三條測試：朝向 vs 逃離 / 不依賴外部主體 / 身體確認）
- 學員選 2B 句 → 那個填空詞 + 觸發 #5「保護什麼」答覆 → 寫進【SC 觀察】、明確標註「（反應模式、不是 SC、是慣性）」
- 學員選 2C 句 → 那個填空詞 + 觸發 #6 Step2「來源」答覆 → 寫進【還沒碰到的】、明確標註「Week 2 信念入口、待 Step3 反例提問」

【Day 1-6 採集追蹤】（v34 守則七、每天 Damon Note 必寫）

今天用了哪些工具？
（工具一慾望 / 工具二 2A SC 池 / 工具二 2B Reactive 池 / 工具二 2C Belief 池 / 工具三自我關係 / 工具四不對勁 / 比喻路徑 / 畫面路徑 / 停頓觸發）

採集到哪些面向？
- 慾望（L1-L4）：學員說了什麼想要的
- 身份句（L5）：學員選 2A 哪一句、填什麼詞、confirm 結果
- 反應模式（2B）：學員選哪句、觸發 #5 答覆
- 信念表層（2C、Week 2）：學員選哪句、觸發 #6 Step2 答覆
- 自我關係 / 不對勁：學員說的喜歡 / 不喜歡 / 不像自己

走到哪個 Layer？（L1 / L2 / L3 / L4 / L5）

明天可以繼續的：
- 從最有能量的詞繼續
- 還有哪個面向沒採集到（隨意提示、不強制）${buildDamonNoteConditionalFields(week, day)}

注意：
- 簡短有力、總長度上限 800 字（Week 3 Day 6 整合日含完整宣言 + 三週素材、可寬到 1000 字）
- 不給答案、不重寫信念
- SC 觀察是假設不是判斷
- Cathy Q5 確認（Day 6 適用）：如果整週只挖到 1 個有能量的詞、就用那 1 個詞做整合、不勉強湊三個
- 條件欄位（Scope 證據 / 賦予新角色狀態 / 確定類別 + Scope / Transfer 結果 / 微證據 + 反例預演結果 / 宣言）只在對應 week/day 採集、其他 day 不出現該欄位、不要寫「本日不採集」之類佔位字`,
        messages: [{
          role: 'user',
          content: `模組：${moduleLabel}，第 ${week} 週，第 ${day} 天。\n\n${conversationText}\n\n請寫下今天的 Damon Note。`
        }]
    });

    const fullNote = response.content[0].text;

    const keyPhraseMatch = fullNote.match(/【關鍵句】\s*\n([\s\S]*?)(?=\n【|$)/);
    const tomorrowMatch = fullNote.match(/【明天的入口】\s*\n([\s\S]*?)(?=\n【|$)/);
    const keyPhrase = keyPhraseMatch ? keyPhraseMatch[1].trim() : '';
    const tomorrowEntry = tomorrowMatch ? tomorrowMatch[1].trim() : '';
    const publicNote = keyPhrase
      ? `今天你說了一句很重要的話：\n${keyPhrase}\n\n明天我們從這裡繼續——\n${tomorrowEntry}`
      : '';

    const studentRow = await sql`SELECT student_id FROM sessions WHERE id = ${sessionId} LIMIT 1`;
    const studentIdOfSession = studentRow[0]?.student_id;
    if (!studentIdOfSession) {
      console.warn('generateDamonNote: student_id not found for sessionId=' + sessionId);
      return null;
    }

    // PR-4c-4e — fetch preferred_name for the notebook-page Vivi-warm prompt
    let preferredName = null;
    try {
      const pr = await sql`SELECT preferred_name FROM students WHERE student_id = ${studentIdOfSession} LIMIT 1`;
      if (pr.length > 0 && pr[0].preferred_name) preferredName = pr[0].preferred_name;
    } catch (e) { console.warn('[generateDamonNote] preferred_name lookup failed:', e.message); }

    await sql`
      INSERT INTO damon_notes (student_id, module, week, day, note_text, is_week_summary)
      VALUES (${studentIdOfSession}, ${module}, ${week}, ${day}, ${fullNote}, false)
      ON CONFLICT (student_id, module, week, day, is_week_summary)
      DO UPDATE SET note_text = EXCLUDED.note_text, updated_at = NOW()
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

    const notebookPage = await generateNotebookPage(sql, sessionId, module, fullNote, yesterdaySCHypothesis, preferredName);

    return { fullNote, publicNote, notebookPage, todaySCHypothesis };
  } catch (e) {
    console.error('Damon Note error:', e);
    return null;
  }
}

export async function generateNotebookPage(sql, sessionId, module, fullNote, yesterdaySCHypothesis, preferredName = null) {
  try {
    const moduleLabel = module === 'self' ? '自我關係' : module === 'money' ? '金錢關係' : '伴侶關係';
    // PR-4c-4e — preferredName is a warm hook the prompt can use sparingly.
    // The page is addressed to the student in 第二人稱「你」, with {preferredName}
    // appearing 0-1 times for warmth — NOT a SaaS 「歡迎回來」 greeting and not at the top.
    const nameHint = preferredName
      ? `學員的稱呼是「${preferredName}」。整篇 0-1 次自然帶過（如「${preferredName}、今天你說了…」）— 不放開頭、不重複、寫信感不是寒暄。`
      : `學員沒提供稱呼。整篇用「你」、不用「她/他」、不用「學員」。`;

    const response = await getAnthropic().messages.create({
        model: MODEL,
        max_tokens: 800,
        system: `你是 Vivi 教練。
把今天的學員觀察（後端 Damon Note）改寫成「私人筆記本一頁」、給學員看（學員會直接讀這頁）。
這頁是 Vivi 教練「寫給這個學員的私信」、第二人稱「你」、有溫度但不雞湯。

⚠️ 人稱 / 性別（PR-4c-4e 拍板）：
- 整篇用「你」、不寫「她」「他」「她/他」雙視角。
- 不假設學員的性別、不用代詞猜性別。
- ${nameHint}

格式（嚴格按照）：

[主敘事段、無標題、開頭即敘事]
- 第二人稱「你」(「今天你說了…」「我聽著你…」「你停了一下、那裡有什麼？」)
- 含學員今天反覆出現的詞（自然帶過、不列點）
- 含關鍵句（用學員原話加引號）
- 含「還沒碰到的」（用「但你繞過去了」「你沒進去」這種敘事帶出）
- 含「層次」描述（「你碰到了一個層次的邊」、不直接寫 Layer 1-5、不寫「工具一/二/三/四」）
- 約 200 字

✦ 我看見的（一個假設）

- 把後端 SC 觀察寫成「你可能是 X」的猜想語氣、不要「她可能是」
- 緩衝詞必加：可能、可能不是、猜想
- 結尾必加：邀請你 sit with 一句具體的話
  - 不要用通用的「你自己怎麼看？」
  - 用具體的「— 這只是猜想。但我想問你——『[今天你說過的一句話]』、你聽到這句話、有什麼感覺？」
- 約 80 字

✦ 明天

「我會帶你回到一個問題——
[後端 Damon Note 抽出來的「明天的入口」問句、一字不改]」
- 約 30 字

— V

【嚴格規則】
1. 不簽 Damon 名字、不寫「Damon Cart」
2. 用 Vivi 風格：短句、留白、不雞湯
3. SC 觀察用「可能」「猜想」緩衝、不斷定
4. 不寫禁用詞（加油、你已經很努力了、擁抱自己、成為更好的自己、跟著做就會、立刻改變人生）
5. 簡短有力、總長度不超過 350 字
6. 不替你「修正」信念、只讓信念被看見
7. SC 觀察是假設、不是判斷
8. 如果有「昨天的 SC 假設」（yesterdaySCHypothesis）、今天的「我看見的」要 reference、寫成「進化感」、不重複昨天的話、要精煉
9. 如果今天 Damon Note 有「教練給的正面身份候選」（如「為朋友、為公司付出的你、也是你」）、必須保留進敘事末段
10. ⚠️ 學員會直接讀這頁：禁止出現任何 Damon Note section 名稱（【SC 觀察】 / 【深度層次】 / 【還沒碰到的】 / 【明天的入口】 / 【採集追蹤】 / 【關鍵句】 等）、禁止「工具一/二/三/四」、禁止「Layer 1-5 / L1-L5」、禁止「2A SC 池 / 2B Reactive 池 / 2C Belief 池」`,
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
