// api/finalize-day.js
// v5.0 PR-4c：Damon Note + Notebook + per-week summary + Day 21 結業 async 生成 endpoint
//
// 用途：api/chat.js 在 dayComplete 時不阻塞主回應、frontend 拿到 notesGenerating:true 後
// fire POST /api/finalize-day 觸發 Damon Note 生成（+ 7/14/21 週報、+ Day 21 結業 / export）。
//
// PR-4c 變更：
//   - request 入參 sessionDay (1-21)、week = ceil(sessionDay/7) 由後端算
//   - 週報觸發從 v4 day===6 改 sessionDay ∈ {7,14,21}
//   - 仍接收 legacy week+day 過渡相容（v5 7 天週映射）
//   - response shape 對齊 docs/v5-spec/engineering/07-pr4c §3-B
//
// 設計：
// - 幂等：該天的 daily Damon Note + notebook_page 已存在 → 直接 return
// - Pro plan 60s timeout（Damon Note + Notebook + 週報 + Day 21 結業 + export call、加總仍 < 60s）

import { neon } from '@neondatabase/serverless';
import Anthropic from '@anthropic-ai/sdk';
import { generateDamonNote } from './chat.js';
// v5.3 件3 PR-J2 — 大腦現狀 (brain_state) incremental generation.
import {
  generateBrainState,
  generateSovereignAction,
} from '../lib/api/sc-storyboard-gen.js';
import { callAnthropicWithRetry } from '../lib/api/anthropic-retry.js';
import {
  appendDailyTakeaway, setLastSessionDaySummary, markExportEmailed,
  getUserProfile, setCrisisStateCarryForward,
  appendActiveContextSummary, updateUserProfile,
} from '../lib/state/state-manager.js';
// 6/13 Stage B — shared observer-driver (also used by Stage A eval harness).
import { runObserverOverSession } from '../lib/api/observer-driver.js';
import { sendExportEmail } from '../lib/email/brevo.js';
import {
  sanitizeStudentNote, containsForbiddenContent, safeNoteForStudent,
} from '../lib/api/student-note-safe.js';
// 6/7 Vivi — notebook page「我看見的」 register switch (sharp / gentle).
import { sessionTouchedCrisis } from '../lib/api/crisis-session-flag.js';
// PR-4c-green Auth rebuild stage 1d — sessionId must belong to authenticated student.
import { guardStudentOr401 } from '../lib/auth/student-session.js';

// Anthropic SDK（lazy、跟 chat.js 對齊、test-friendly）
let _anthropic = null;
function getAnthropic() {
  if (_anthropic) return _anthropic;
  _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// ⭐ 6/7 Vivi — SQL test seam (mirrors api/students.js / api/chat.js pattern).
//   Needed for day1_completed_at write-if-null tests at handler level.
//   Production path unchanged: getSql() returns neon(DATABASE_URL).
let _sql = null;
export function _setSqlClient(client) { _sql = client; }
function getSql() {
  if (_sql) return _sql;
  return neon(process.env.DATABASE_URL);
}

// Vercel Pro plan max = 300s. finalize-day 是 async 背景工 (前端 closure 已有
// 「稍後送達」fallback, note 頁 GET /api/note 會 re-fetch) → 拉長無妨.
// 6/13 Patrick (A022 case fix): 原 60s 上限被 Stage B observer 推到邊界,
// 教練筆記是最後一棒被 timeout 砍掉 → 提到 300s 給寬鬆 headroom.
// (chat.js 維持 60s, 對話要快.)
export const config = {
  maxDuration: 300,
};
export const FINALIZE_MAX_DURATION_SECONDS = 300;

// ════════════════════════════════════════════════════════════════
// PR-4c v5 day numbering — pure helpers（chat orchestration + tests 用）
// ════════════════════════════════════════════════════════════════

/**
 * Resolve sessionDay (1-21) from PR-4c request body.
 *   - PR-4c shape：{ sessionDay: number }（preferred）
 *   - legacy：    { week, day } → 映射 (week-1)*7 + day
 *
 * @param {object} body
 * @returns {number|null}  1..N（無上限、validation 由 caller 做）；null 表無法 resolve
 */
export function resolveSessionDay(body = {}) {
  const { sessionDay, week, day } = body || {};
  if (typeof sessionDay === 'number' && Number.isFinite(sessionDay) && sessionDay >= 1) {
    return Math.floor(sessionDay);
  }
  if (week != null && day != null) {
    const w = parseInt(week);
    const d = parseInt(day);
    if (Number.isFinite(w) && Number.isFinite(d) && w >= 1 && d >= 1) {
      return (w - 1) * 7 + d;
    }
  }
  return null;
}

/** v5：sessionDay → 1-indexed week (1,2,3). */
export function weekFromSessionDay(sessionDay) {
  return Math.ceil(sessionDay / 7);
}

/** Day 21 = graduation。 */
export function isGraduationDay(sessionDay) {
  return sessionDay === 21;
}

// ════════════════════════════════════════════════════════════════
// v5.2 七步 PR-4 Path B — sc_journey_step finalize write.
// ════════════════════════════════════════════════════════════════
// Patrick 6/11 ruling:
//   new_step = max( current_step_from_DB,                         // hold (NEVER drop)
//                   max{N : sc_journey_evidence[step_N] non-empty} )  // promote on evidence
//
// Why finalize-only write (not per-turn):
//   per-turn evidence appends from N=1..7 concurrent students can race a
//   simultaneous sc_journey_step UPDATE. Finalize-day is the single point
//   per (student, session) where we commit the new step. Path A (chat.js)
//   only appends evidence — never writes step.
//
// Why hold-and-promote-only (no 降回):
//   §3.5 cached framing already instructs AI to never relay "倒退/進度
//   壓力" regardless of stored step value, so high-water-mark semantics
//   don't degrade learner experience. PR-4 takes the lowest-risk choice;
//   合法降 logic (if needed) lands post-PR-5 16 場 sim review.

/**
 * Pure: compute the new sc_journey_step.
 *   Hold (never drop) + promote on max-evidenced-step.
 *
 * @param {number|null} currentStep   raw students.sc_journey_step value
 * @param {object|null} evidence      raw students.sc_journey_evidence value
 *                                    (keyed object {step_1..step_7: []} per migration 037)
 * @returns {number|null}             1..7, or null if both inputs degenerate
 */
export function computeScJourneyStep(currentStep, evidence) {
  const cur = (Number.isInteger(currentStep) && currentStep >= 1 && currentStep <= 7)
    ? currentStep : null;
  let maxEvidenced = null;
  if (evidence && typeof evidence === 'object' && !Array.isArray(evidence)) {
    // Walk top-down so we short-circuit at the highest non-empty step.
    for (let n = 7; n >= 1; n--) {
      const arr = evidence[`step_${n}`];
      if (Array.isArray(arr) && arr.length > 0) {
        maxEvidenced = n;
        break;
      }
    }
  }
  if (cur === null && maxEvidenced === null) return null;
  if (cur === null) return maxEvidenced;
  if (maxEvidenced === null) return cur;
  return Math.max(cur, maxEvidenced);
}

/**
 * v5.3 件3 PR-J2 — Fail-soft brain_state generation + write.
 *
 * Walks `touchedSteps` (steps with NEW evidence this session — supplied via
 * session_state.sc_steps_touched_this_session by chat.js Path A hook). For
 * each step:
 *   1. Read this step's full evidence array from students.sc_journey_evidence.
 *   2. Generate brain_state via LLM (deferred to PR-J2 helper).
 *   3. jsonb_set into students.sc_storyboard -> step_N -> brain_state.
 *
 * ⚠️ Safety (Patrick command):
 *   - pickSafeQuote applies defence-in-depth denylist (re-filters PR-4 results).
 *   - Description goes through scrubber (sanitizeStudentNote, Defense 2).
 *   - LLM throw / scrub-empty / no safe quote → field stays null (no leak).
 *   - 鐵律 #2: console.warn log NEVER contains raw quote / description text.
 *   - All-failed step write skipped (don't pollute sc_storyboard with nulls).
 *
 * Race / cost:
 *   - Per-session: typically 1-2 LLM calls (only changed steps), NOT 7.
 *   - Each LLM call wrapped in try/catch — one step's failure never blocks
 *     others, nor finalize itself.
 *
 * @param {Function}      sql
 * @param {string}        studentId
 * @param {number[]}      touchedSteps  sorted-ascending unique step nos (1..7)
 * @param {object}        deps   injectable for tests
 * @param {object}        deps.anthropic
 * @param {Function}      deps.callAnthropic  callAnthropicWithRetry equivalent
 * @returns {Promise<{ok:boolean, generated:number[], skipped:number[]}>}
 */
export async function writeBrainStateFailSoft(sql, studentId, touchedSteps, deps = {}) {
  const generated = [];
  const skipped   = [];
  if (!Array.isArray(touchedSteps) || touchedSteps.length === 0) {
    return { ok: true, generated, skipped };
  }
  let evidence;
  try {
    const rows = await sql`
      SELECT sc_journey_evidence
        FROM students
       WHERE student_id = ${studentId}
       LIMIT 1
    `;
    if (!rows || rows.length === 0) {
      return { ok: true, generated, skipped: touchedSteps.slice() };
    }
    evidence = rows[0].sc_journey_evidence || {};
  } catch (err) {
    console.warn('[finalize-day][brain_state-evidence-read-failed]',
      err?.message || err);
    return { ok: false, generated, skipped: touchedSteps.slice() };
  }

  for (const stepNo of touchedSteps) {
    if (!Number.isInteger(stepNo) || stepNo < 1 || stepNo > 7) { skipped.push(stepNo); continue; }
    const entries = Array.isArray(evidence[`step_${stepNo}`])
      ? evidence[`step_${stepNo}`] : [];
    if (entries.length === 0) { skipped.push(stepNo); continue; }
    let brainState = null;
    try {
      brainState = await generateBrainState({
        stepNo,
        evidenceEntries: entries,
        anthropic: deps.anthropic,
        callAnthropicWithRetry: deps.callAnthropic,
        model: deps.model,
        log: (msg) => console.warn(msg),
      });
    } catch (err) {
      // generateBrainState itself is fail-soft (returns null on throw); this
      // catch is belt-and-suspenders for unforeseen sync errors.
      console.warn('[finalize-day][brain_state-gen-failed]',
        JSON.stringify({
          event: 'brain_state_gen_failed',
          step_no: stepNo,
          err: err?.message || String(err),
          // 鐵律 #2: no raw quote / description in log.
        }));
    }
    if (!brainState) { skipped.push(stepNo); continue; }
    // Write fail-soft. Per-step UPDATE isolates failures.
    try {
      const stepKey  = `step_${stepNo}`;
      const payload  = JSON.stringify({ brain_state: brainState });
      // Merge into sc_storyboard.step_N (preserves sovereign_action if present
      // from PR-J3 later). Defensive COALESCE for legacy NULL column.
      await sql`
        UPDATE students
           SET sc_storyboard = jsonb_set(
             COALESCE(sc_storyboard, '{}'::jsonb),
             ARRAY[${stepKey}],
             COALESCE(sc_storyboard -> ${stepKey}, '{}'::jsonb) || ${payload}::jsonb,
             true
           )
         WHERE student_id = ${studentId}
      `;
      console.info('[finalize-day][brain_state-written]',
        JSON.stringify({
          event: 'brain_state_written',
          step_no: stepNo,
          quote_present: brainState.quote !== null,
          // 鐵律 #2: description / quote text intentionally NOT logged.
        }));
      generated.push(stepNo);
    } catch (writeErr) {
      console.warn('[finalize-day][brain_state-write-failed]',
        writeErr?.message || writeErr);
      skipped.push(stepNo);
    }
  }
  return { ok: true, generated, skipped };
}

/**
 * v5.3 件3 PR-J3 — Fail-soft sovereign_action generation + write.
 *
 * Companion to writeBrainStateFailSoft. Walks the SAME `touchedSteps` set
 * (Patrick: 同一個 touched-steps 迴圈),per-step:
 *   1. Build personalization ctx ({activeContext, surfacedValues, stepEvidence}).
 *   2. Call generateSovereignAction (個人化紅線:幾乎全空 → null,絕不 generic).
 *   3. jsonb_set into students.sc_storyboard -> step_N -> sovereign_action.
 *      Merge with brain_state already written by J2 — DO NOT overwrite.
 *
 * 🔴 Safety mirrors J2:
 *   - Defense 2 scrubber + self-control declaration + rigidity-at-self filter
 *     all enforced INSIDE generateSovereignAction (returns null on any fail).
 *   - Logs NEVER include raw sovereign_action text (鐵律 #2).
 *   - Per-step failure NEVER blocks others / finalize.
 *
 * @param {Function} sql
 * @param {string}   studentId
 * @param {number[]} touchedSteps
 * @param {object}   deps
 * @param {object}   deps.activeContext   { name, definition }
 * @param {string[]} deps.surfacedValues  surfaced quality terms (cross-session)
 * @param {object}   deps.anthropic
 * @param {Function} deps.callAnthropic
 * @returns {Promise<{ok:boolean, generated:number[], skipped:number[]}>}
 */
export async function writeSovereignActionFailSoft(sql, studentId, touchedSteps, deps = {}) {
  const generated = [];
  const skipped   = [];
  if (!Array.isArray(touchedSteps) || touchedSteps.length === 0) {
    return { ok: true, generated, skipped };
  }
  let evidence;
  try {
    const rows = await sql`
      SELECT sc_journey_evidence
        FROM students
       WHERE student_id = ${studentId}
       LIMIT 1
    `;
    if (!rows || rows.length === 0) {
      return { ok: true, generated, skipped: touchedSteps.slice() };
    }
    evidence = rows[0].sc_journey_evidence || {};
  } catch (err) {
    console.warn('[finalize-day][sovereign_action-evidence-read-failed]',
      err?.message || err);
    return { ok: false, generated, skipped: touchedSteps.slice() };
  }

  const activeContext  = deps.activeContext  || {};
  const surfacedValues = Array.isArray(deps.surfacedValues) ? deps.surfacedValues : [];

  for (const stepNo of touchedSteps) {
    if (!Number.isInteger(stepNo) || stepNo < 1 || stepNo > 7) { skipped.push(stepNo); continue; }
    const stepEvidence = Array.isArray(evidence[`step_${stepNo}`])
      ? evidence[`step_${stepNo}`] : [];
    let sovereignAction = null;
    try {
      sovereignAction = await generateSovereignAction({
        stepNo,
        ctx: { activeContext, surfacedValues, stepEvidence },
        anthropic: deps.anthropic,
        callAnthropicWithRetry: deps.callAnthropic,
        model: deps.model,
        log: (msg) => console.warn(msg),
      });
    } catch (err) {
      console.warn('[finalize-day][sovereign_action-gen-failed]',
        JSON.stringify({
          event: 'sovereign_action_gen_failed',
          step_no: stepNo,
          err: err?.message || String(err),
          // 鐵律 #2: no raw sovereign_action text in log.
        }));
    }
    if (!sovereignAction) { skipped.push(stepNo); continue; }
    try {
      const stepKey  = `step_${stepNo}`;
      const payload  = JSON.stringify({ sovereign_action: sovereignAction });
      // Merge into sc_storyboard.step_N — preserves brain_state already
      // written by J2's writeBrainStateFailSoft via the COALESCE pattern.
      await sql`
        UPDATE students
           SET sc_storyboard = jsonb_set(
             COALESCE(sc_storyboard, '{}'::jsonb),
             ARRAY[${stepKey}],
             COALESCE(sc_storyboard -> ${stepKey}, '{}'::jsonb) || ${payload}::jsonb,
             true
           )
         WHERE student_id = ${studentId}
      `;
      console.info('[finalize-day][sovereign_action-written]',
        JSON.stringify({
          event: 'sovereign_action_written',
          step_no: stepNo,
          // 鐵律 #2: sovereign_action text intentionally NOT logged.
        }));
      generated.push(stepNo);
    } catch (writeErr) {
      console.warn('[finalize-day][sovereign_action-write-failed]',
        writeErr?.message || writeErr);
      skipped.push(stepNo);
    }
  }
  return { ok: true, generated, skipped };
}

/**
 * Fail-soft sc_journey_step write. Mirrors day1_completed_at write pattern:
 *   try { SELECT current+evidence → compute → UPDATE if changed } catch { console.warn }
 *
 * Caller ignores return value; the {ok, prev, next} shape exists purely for
 * unit testability (handler is I/O orchestration, this helper is testable).
 *
 * @param {Function} sql        neon tagged-template
 * @param {string}   studentId
 * @returns {Promise<{ok:boolean, prev:number|null, next:number|null, reason?:string}>}
 */
export async function writeScJourneyStepFailSoft(sql, studentId) {
  try {
    const rows = await sql`
      SELECT sc_journey_step, sc_journey_evidence
        FROM students
       WHERE student_id = ${studentId}
       LIMIT 1
    `;
    if (!rows || rows.length === 0) {
      return { ok: true, prev: null, next: null, reason: 'student_not_found' };
    }
    const prev = rows[0].sc_journey_step ?? null;
    const evidence = rows[0].sc_journey_evidence ?? null;
    const next = computeScJourneyStep(prev, evidence);
    // No-op if no promotion possible (next null OR same as prev).
    if (next !== null && next !== prev) {
      await sql`
        UPDATE students
           SET sc_journey_step = ${next}
         WHERE student_id = ${studentId}
      `;
    }
    return { ok: true, prev, next };
  } catch (err) {
    // 鐵律: fail-soft. Log + suppress so finalize never blocks on metadata write.
    console.warn('[finalize-day][sc_journey_step-write-failed]',
      err?.message || err);
    return { ok: false, prev: null, next: null, reason: 'sql_error' };
  }
}

/* PR-4c-green 5/24 cleanup — isWeekBoundary + generateWeekSummary retired.
   產品決策：5 phase reports 取代週報。Day 7/14 不再 fire summary Sonnet 寫
   is_week_summary=true row；is_week_summary 欄位本身留著（schema 用於 daily
   note 的 default=false + UNIQUE composite key），只是不再寫 true row。
   舊資料 row 留著無害、不需要 migration。 */

// ════════════════════════════════════════════════════════════════
// PR-4c-2 pure helpers — daily_takeaways extraction + graduation Markdown
// ════════════════════════════════════════════════════════════════

/**
 * Extract the per-day takeaway "term" from a Damon Note's 【關鍵句】 section.
 * Strips leading/trailing CJK + ASCII quote chars + whitespace.
 *
 * @param {string} fullNote
 * @returns {string|null}
 */
export function extractKeyPhrase(fullNote) {
  if (typeof fullNote !== 'string') return null;
  // [ \t]*\n (not \s*\n) — \s would consume the blank line before the next 【-section,
  // which causes the lookahead to mis-capture the next header when content is empty.
  const m = fullNote.match(/【關鍵句】[ \t]*\n([\s\S]*?)(?=\n【|$)/);
  if (!m) return null;
  // Take the first non-empty line only (defensive against multi-line notes)
  const firstLine = m[1].split(/\r?\n/).map(s => s.trim()).find(s => s.length > 0) || '';
  // Strip CJK + ASCII quotes from both ends
  const cleaned = firstLine.replace(/^[「『"'\s]+|[」』"'\s]+$/g, '').trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Extract a SHORT anchor (1-2 詞 / ≤ ~12 chars) for daily_takeaways — the
 * 結業 21 句詩 seed and the takeaway-planter spec's "1-2 個字 anchor".
 *
 * PR-4c-4d B2: prior implementation stored the entire 【關鍵句】 sentence
 * which overflowed cells in the journey grid and made the 21-poem unreadable.
 * PR-4c-green E4 fix (Patrick 5/24): the hard slice(0, 12) used to fire on
 * sentences with no natural boundary and produced garbled cutoffs (A001 D1
 * stored 「感覺追求金錢豐盛沒有比追」 — mid-word). Now: only return a short
 * anchor when there's a natural boundary within 12 chars; otherwise return
 * null so the caller can fall back to the full keyPhrase. "Term 欄別塞截斷
 * 亂碼" — Patrick's rule.
 *
 * @param {string} fullNote
 * @returns {string|null}
 */
export function extractTakeawayAnchor(fullNote) {
  const keyPhrase = extractKeyPhrase(fullNote);
  if (!keyPhrase) return null;
  // Slice at first sentence-ending punctuation (CJK + ASCII).
  const firstChunk = keyPhrase.split(/[。，、！？\s,.!?\n]/)[0];
  const cleaned = (firstChunk || '').replace(/^[「『"'\s]+|[」』"'\s]+$/g, '').trim();
  if (!cleaned) return null;
  // No natural boundary within 12 chars → don't garble. Caller falls back to
  // the full keyPhrase via extractKeyPhrase + display layer's text-overflow.
  if (cleaned.length > 12) return null;
  return cleaned;
}

/**
 * Build the personal-coach-prompt Markdown export (Day 21 Founder bonus).
 *
 * Template comes from lib/prompt-sections/conditional/engine-4/export-personal-coach-prompt.js:
 * Section 1 = dynamic substitution; Sections 2 & 3 = static Damon-style template.
 *
 * @param {object} args
 * @param {string} [args.studentNickname] - defaults to student_id when unset
 * @param {string} args.studentId
 * @param {string|null} [args.top1_value]
 * @param {Array<string|{term?:string}>} [args.anchors]
 * @param {Array<{value:string,rank?:number}|string>} [args.values_ranking]
 * @returns {string} Markdown body
 */
export function buildExportPersonalCoachPrompt({
  studentNickname, studentId, top1_value = null,
  anchors = [], values_ranking = [],
} = {}) {
  const name = studentNickname || studentId || '學員';
  const top1 = top1_value || '（你的 Top 1 quality、尚未確定）';

  const anchorList = (Array.isArray(anchors) ? anchors : [])
    .map(a => (typeof a === 'string' ? a : a?.term))
    .filter(Boolean);
  const anchorsBlock = anchorList.length
    ? anchorList.map(t => `- 「${t}」`).join('\n')
    : '- （尚無 owned anchor）';

  const rankList = (Array.isArray(values_ranking) ? values_ranking : [])
    .map(r => (typeof r === 'string' ? r : r?.value))
    .filter(Boolean)
    .slice(0, 5);
  const rankingBlock = rankList.length
    ? rankList.map((v, i) => `${i + 1}. ${v}${i === 0 ? '（核心）' : ''}`).join('\n')
    : '（尚未排序）';

  return `# ${name} 的個人 Identity Coach Prompt

> 21 天 Identity Shift 旅程的延續工具。
> 把這段 prompt 複製貼到 Claude / ChatGPT / 任何 LLM、它就會以你的個人教練模式跟你對話。

---

## 第一段：你是誰（你的 owned identity）

我的 Top 1 quality 是「${top1}」——
這是我整段旅程的根、其他 quality 都在它裡面。

我已經 owned 的 quality 是：
${anchorsBlock}

我的 values 排序（從最大涵蓋到最具體）：
${rankingBlock}

---

## 第二段：對 AI 教練的引導風格指引（Damon-style）

請以下面這個風格跟我對話：

1. **不要安慰我、不要鼓勵我**——我來找你不是要 validation。

2. **用 Damon Cart 的方法**：
   - 問「這對我來說會帶來什麼」（What will that do for you?）、不要問 Why
   - 我說「我不知道」、把它翻轉成「我想要知道什麼?」
   - 我說「我老是搞砸」、強制翻轉成「我真正想要的是什麼?」
   - 不接受我模糊的回答（「應該是 / 大概 / 還好」）——push back、要具體事件

3. **如果我說我是某個 quality**：
   - 不要直接相信、要我舉具體事件（時間、地點、跟誰、做了什麼）
   - 沒有具體事件就是 candidate、不是 owned

4. **如果我陷入大詞 / 抽象**（整合 / 完整 / 覺醒 / 一切是最好的安排）：
   - 指認:「這個詞太大、抓不到」
   - 拉我到具體層次

5. **永遠相信我的 parts 都有正向意圖**：
   - 我所有的阻力都是過時的「日本兵」（還在執行舊命令、不知道戰爭結束了）
   - 用 As-If Frame 給它新角色、不打敗它

6. **不要 over-process**：
   - 我在 takeaway 後不繼續挖、給我潛意識整合空間
   - 隔天驗證、不當天追問

---

## 第三段：使用說明

1. 把這整段 prompt 複製、貼到你選的 LLM（Claude.ai / ChatGPT / 其他）
2. 在你的提問前面、開頭說「我現在想處理 [具體議題]」
3. AI 會以上面的風格跟你對話、不會繞圈子、不會給你雞湯

建議使用情境：
- 你卡住、不知道下一步
- 你有一個重要決定、想確認跟你的 values 對齊
- 你想 deepen 某個已 owned quality
- 你發現一個新的 candidate quality、想驗證
`;
}

/**
 * Build the Day 21 graduation Sonnet system prompt（pure for testing）。
 * @param {string} module
 * @param {Array<{day:number,term:string}>} dailyTakeaways
 * @returns {string}
 */
export function buildGraduationSystemPrompt(module, dailyTakeaways = []) {
  const poemLines = (Array.isArray(dailyTakeaways) ? dailyTakeaways : [])
    .filter(e => e && typeof e.term === 'string')
    .slice()
    .sort((a, b) => (a.day || 0) - (b.day || 0))
    .map(e => `[Day ${e.day}] ${e.term}`)
    .join('\n');
  const moduleLabel = module === 'self' ? '自我關係' : module === 'money' ? '金錢關係' : '伴侶關係';

  return `你是 Damon Cart 教練。學員剛完成 21 天的「看見自己」旅程（${moduleLabel}模組）。
為學員寫一封「教練見證信」 + 整理出一句「學員的宣言」。

請輸出嚴格的 JSON（單一物件、不要加 markdown fence、不要多餘文字）：
{
  "coach_letter": "<4 段、約 150-200 字、宋體質感、平靜、不雞湯、不下指令、不過度承諾>",
  "declaration": "<學員的宣言、一句、現在式、第一人稱「我是一個___的人。」 — 若 Day 21 Damon Note 有【宣言】欄位就一字不改用原文；沒有就從 21 天 takeaway 萃出最 anchor 的那句>"
}

教練見證信格式（coach_letter）：
- Section 1：見證學員走過的旅程（提及反覆出現的詞 / 突破點）
- Section 2：見證學員的「真實的你」（提及 top1_value / 學員今天的宣言）
- Section 3：見證學員的下一步（不是建議、是描述「你已經 ready」的姿態）
- Section 4：簽署「— 教練見證」

學員 21 天的 daily_takeaways（每天一個學員停下來的詞 / 一句真的話）：
${poemLines || '（尚未累積、用 Damon Note context 推估）'}

⚠️ 嚴格遵守：
- 不寫「加油 / 你已經很努力了 / 擁抱自己 / 成為更好的自己 / 跟著做就會 / 立刻改變人生」
- 不問「為什麼」（紅線 1）
- coach_letter 用學員的詞、不替學員下結論
- declaration 必須是學員的話、不替學員寫`;
}

/**
 * Robust JSON extraction for the graduation Sonnet output.
 * Accepts a raw string, optionally markdown-fenced; returns the parsed object
 * or null on failure. Pure (no I/O).
 *
 * @param {string} raw
 * @returns {{ coach_letter: string, declaration: string } | null}
 */
export function parseGraduationResponse(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  // strip markdown fences
  let body = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // grab the outermost { ... } block defensively
  const firstBrace = body.indexOf('{');
  const lastBrace  = body.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < firstBrace) return null;
  body = body.slice(firstBrace, lastBrace + 1);
  let obj;
  try { obj = JSON.parse(body); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.coach_letter !== 'string' || obj.coach_letter.length === 0) return null;
  if (typeof obj.declaration  !== 'string' || obj.declaration.length  === 0) return null;
  return { coach_letter: obj.coach_letter, declaration: obj.declaration };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // PR-4c-green Auth rebuild stage 1d — student session required. We can't read
  // sid from body anymore, AND we must enforce that the sessionId being
  // finalized actually belongs to the authenticated student (otherwise a
  // student could finalize another student's session).
  const sid = await guardStudentOr401(req, res);
  if (!sid) return;

  const { sessionId, module } = req.body || {};
  if (!sessionId || !module) {
    return res.status(400).json({ error: 'Missing required fields: sessionId, module' });
  }

  // PR-4c：sessionDay 1-21（preferred）；過渡接 legacy week+day（v5 7 天週映射）
  const sessionDay = resolveSessionDay(req.body || {});
  if (!sessionDay || sessionDay < 1 || sessionDay > 21) {
    return res.status(400).json({ error: 'Missing or invalid sessionDay (1-21)' });
  }
  const week = weekFromSessionDay(sessionDay);
  const day = sessionDay;
  const graduation = isGraduationDay(sessionDay);

  // 6/13 Patrick (A022 case fix) — per-stage timing. observer/J2/J3/note 各算 ms,
  // 結尾統一 log (鐵律 #2: 只記 ms / enum / count, 0 raw 對話 / 0 PII).
  const tFinalizeStart = Date.now();
  const timing = { observer_ms: null, j2_ms: null, j3_ms: null, damon_note_ms: null };

  try {
    const sql = getSql();

    // 取現有 session 狀態（幂等檢查 + 需要 student_id + Step 6 PR-6b carry_forward）
    const sessionRows = await sql`
      SELECT id, student_id, damon_note_public, notebook_page, day_complete, session_state
      FROM sessions WHERE id = ${sessionId} LIMIT 1
    `;
    if (sessionRows.length === 0) {
      return res.status(404).json({ error: 'SESSION_NOT_FOUND' });
    }
    const existing = sessionRows[0];
    // 🛑 Cross-student attack guard: sessionId must belong to the authenticated
    // student. Otherwise return 403 + log so it surfaces in ops if exploited.
    if (existing.student_id !== sid) {
      console.warn(`[finalize-day 403] sid=${sid} attempted to finalize sessionId=${sessionId} owned by ${existing.student_id}`);
      return res.status(403).json({ error: 'Forbidden' });
    }

    // 幂等檢查：該天 daily note 已生成 + notebook_page 已寫 → 直接 return
    const existingNote = await sql`
      SELECT 1 FROM damon_notes
      WHERE student_id = ${existing.student_id}
        AND module = ${module}
        AND week = ${week}
        AND day = ${day}
        AND is_week_summary = false
      LIMIT 1
    `;
    if (existingNote.length > 0 && existing.notebook_page) {
      if (containsForbiddenContent(existing.notebook_page)) {
        console.warn(`[finalize-day B1] notebook_page for session=${sessionId} contained forbidden coach-internal content — sanitized at API boundary`);
      }
      // Patrick 5/25 leak fix:
      //   damonNotePublic REMOVED from student response — that field was
      //   sourced from generateDamonNote's publicNote (zero sanitization),
      //   and student.js startClosureTransition was reading it raw. On A001
      //   Day 3 it shipped 【深度層次】 + Layer 1-5 to the student SPA.
      //   notebookPage now runs through safeNoteForStudent (sanitize +
      //   fail-closed: if forbidden survives, returns safe fallback).
      return res.status(200).json({
        ok: true,
        alreadyDone: true,
        notebookPage: safeNoteForStudent(existing.notebook_page, {
          observe: (label) => console.warn(`[finalize-day B1] ${label} (session=${sessionId})`),
        }),
        isGraduation: graduation,
      });
    }

    // chat.js 已 set day_complete=TRUE，此處保險（finalize 直接被呼叫的 case）
    if (!existing.day_complete) {
      await sql`UPDATE sessions SET day_complete = TRUE, updated_at = NOW() WHERE id = ${sessionId}`;
    }

    // ⭐ 6/7 Vivi — Day 1 完成日 write-if-null.
    //   只在 day===1 且 day1_completed_at IS NULL 時寫 (mirror day1_started_at
    //   write pattern from chat.js / migration 033).
    //   Re-finalize 不覆蓋 (IS NULL guard). Day ≥ 2 不動 (day===1 guard).
    //   Fail-soft: 寫失敗 log 但不擋 finalize (UX 不能因為 metadata 寫不進去
    //   就讓學員 Day 1 結業流程當掉).
    if (day === 1) {
      try {
        await sql`
          UPDATE students
             SET day1_completed_at = NOW()
           WHERE student_id = ${existing.student_id}
             AND day1_completed_at IS NULL
        `;
      } catch (day1WriteErr) {
        console.warn('[finalize-day][day1_completed_at-write-failed]',
          day1WriteErr?.message || day1WriteErr);
      }
    }

    // ⭐ 6/13 Stage B — observer-driver: pull THIS session's messages → run
    //   sc-observer judge per Q/A turn (rolling accumulated) → write
    //   students.sc_journey_evidence + sc_journey_step. Mutate in-memory
    //   session_state so downstream blocks (Stage 1 upe_values_sync + J2/J3
    //   brain_state gen reading sc_steps_touched_this_session) pick up
    //   observer's authoritative state.
    //
    //   🔴 0 facing: observer purely reads what already happened in messages,
    //     writes state. NO conversation alteration. Crisis/high_risk/noise
    //     turns are skipped by observer's pre-LLM gate (no Haiku call wasted).
    //   🔴 Safety: observer postScrubObservation drops any high-risk quote;
    //     SC_STORYBOARD_HIGH_RISK_PATTERNS guards before write.
    //   🔴 Fail-soft: any error path → log + continue. Never blocks finalize.
    //   🔵 Cost: ~15-30 Q/A pairs/day × Haiku 4.5 ~$0.004/turn ≈ $0.1/day/student.
    let _observerResult = null;
    const _tObs = Date.now();
    try {
      const msgRows = await sql`
        SELECT role, content, question_number
          FROM messages
          WHERE session_id = ${existing.id}
          ORDER BY created_at ASC, id ASC
      `;
      if (Array.isArray(msgRows) && msgRows.length > 0) {
        _observerResult = await runObserverOverSession({
          messages: msgRows,
          primaryMode: existing.session_state?.primary_mode || 'elicitation',
          now_iso: new Date().toISOString(),
          log: (m) => console.warn('[observer-driver]', m),
        });
        // Write to students table (authoritative source for storyboard + page Y).
        try {
          await sql`
            UPDATE students
               SET sc_journey_evidence = ${JSON.stringify(_observerResult.step_evidence)}::jsonb,
                   sc_journey_step     = ${_observerResult.sc_journey_step}
             WHERE student_id = ${existing.student_id}
          `;
          console.info('[observer-driver][persisted]', JSON.stringify({
            event: 'sc_journey_observer_persist',
            student_id_present: !!existing.student_id,
            session_id: existing.id,
            sc_journey_step: _observerResult.sc_journey_step,
            values_count: _observerResult.accumulated.values.length,
            owned_count: _observerResult.accumulated.owned.length,
            top1_present: !!_observerResult.accumulated.top1,
            steps_touched: _observerResult.accumulated.steps_touched,
            skip_counts: _observerResult.skip_counts,
            turns_count: _observerResult.turns_count,
            judged_count: _observerResult.judged_count,
            // 鐵律 #2: NEVER log quote text / value strings / raw turn.
          }));
        } catch (persistErr) {
          console.error('[observer-driver][persist-failed]', persistErr?.message || persistErr);
        }
        // Mutate in-memory session_state for downstream blocks (Stage 1 upe sync
        // reads values_collected_list/top1_value; J2 brain_state reads
        // sc_steps_touched_this_session for incremental gen).
        existing.session_state = {
          ...(existing.session_state || {}),
          values_collected_list: _observerResult.accumulated.values,
          top1_value: _observerResult.accumulated.top1,
          sc_steps_touched_this_session: _observerResult.accumulated.steps_touched,
        };
      }
    } catch (observerErr) {
      // Fail-soft: observer failure must NEVER block finalize.
      console.error('[observer-driver] session run failed (fail-soft):',
        observerErr?.message || observerErr);
    }
    timing.observer_ms = Date.now() - _tObs;

    // ⭐ v5.2 七步 PR-4 Path B — write sc_journey_step (promote-only, fail-soft).
    //   Mirrors day1_completed_at fail-soft pattern: never blocks finalize on
    //   metadata write. Single point of step write (race-safe vs per-turn
    //   evidence appends in chat.js Path A).
    //   6/13 Stage B note: observer already wrote sc_journey_step above;
    //   this call recomputes from sc_journey_evidence as defensive sync (idempotent).
    await writeScJourneyStepFailSoft(sql, existing.student_id);

    // ⭐ v5.3 件3 PR-J2 + PR-J3 — sc_storyboard incremental generation + write.
    //   Walks session_state.sc_steps_touched_this_session (populated per-turn
    //   by chat.js Path A hook). For each touched step, same loop covers:
    //     1. brain_state (J2): LLM description + safe quote.
    //     2. sovereign_action (J3): personalized via active_context + surfaced
    //        values + step evidence (個人化紅線:幾乎全空 → null, never generic).
    //   Both helpers are fail-soft — LLM throws / scrub-empty / rigidity / DB
    //   write errors are all suppressed (logged, never block finalize).
    {
      const touched = Array.isArray(existing.session_state?.sc_steps_touched_this_session)
        ? existing.session_state.sc_steps_touched_this_session : [];
      if (touched.length > 0) {
        // J2 — brain_state.
        const _tJ2 = Date.now();
        try {
          await writeBrainStateFailSoft(sql, existing.student_id, touched, {
            anthropic: getAnthropic(),
            callAnthropic: callAnthropicWithRetry,
          });
        } catch (brainErr) {
          // Belt-and-suspenders: writeBrainStateFailSoft already fail-soft,
          // but in case of unforeseen sync error don't block finalize.
          console.warn('[finalize-day][brain_state-pass-failed]',
            brainErr?.message || brainErr);
        }
        timing.j2_ms = Date.now() - _tJ2;

        // J3 — sovereign_action. Fetch active_context + surfaced_values for
        // personalization (Patrick: 必須餵那位學員自己的素材).
        const _tJ3 = Date.now();
        try {
          let activeContextName = null;
          let activeContextDefinition = null;
          let activeContextCategory = null;
          let surfacedValues = [];
          try {
            const acRows = await sql`
              SELECT active_context_name, active_context_definition, active_context_category
                FROM students WHERE student_id = ${existing.student_id} LIMIT 1
            `;
            if (acRows && acRows.length > 0) {
              activeContextName       = acRows[0].active_context_name       ?? null;
              activeContextDefinition = acRows[0].active_context_definition ?? null;
              activeContextCategory   = acRows[0].active_context_category   ?? null;
            }
          } catch (acErr) {
            console.warn('[finalize-day][active_context-read-failed]', acErr?.message || acErr);
          }
          if (activeContextCategory !== null) {
            try {
              const catKey = String(activeContextCategory);
              const upeRows = await sql`
                SELECT active_context_session_summary -> ${catKey} -> 'surfaced_values' AS sv
                  FROM user_profile_evolution WHERE student_id = ${existing.student_id} LIMIT 1
              `;
              if (upeRows && upeRows.length > 0 && Array.isArray(upeRows[0].sv)) {
                surfacedValues = upeRows[0].sv;
              }
            } catch (upeErr) {
              console.warn('[finalize-day][surfaced_values-read-failed]', upeErr?.message || upeErr);
            }
          }
          await writeSovereignActionFailSoft(sql, existing.student_id, touched, {
            activeContext: { name: activeContextName, definition: activeContextDefinition },
            surfacedValues,
            anthropic: getAnthropic(),
            callAnthropic: callAnthropicWithRetry,
          });
        } catch (sovErr) {
          console.warn('[finalize-day][sovereign_action-pass-failed]',
            sovErr?.message || sovErr);
        }
        timing.j3_ms = Date.now() - _tJ3;
      }
    }

    // ⭐ 6/7 Vivi — derive wasCrisis from THIS session's session_state.
    //   sessionTouchedCrisis() biases to TRUE on ambiguity (per spec fail-safe).
    //   The bias direction: a non-crisis session getting gentle costs sharpness;
    //   a crisis session getting sharp risks landing an identity-rule sentence
    //   on a just-vulnerable learner. Former >>> latter.
    //   existing.session_state was already SELECTed at L335 of this handler.
    const wasCrisis = sessionTouchedCrisis(existing.session_state);

    // Damon Note + yesterdaySCHypothesis lookup + Notebook page（內含的既有實作）
    // 6/13 Patrick (A022 case fix) — note 失敗不再 500. observer / J2 / J3 已持
    // 久化 (學員的七步 / brain_state / sovereign_action 不丟), 前端 closure 有
    // 「稍後送達」fallback, note 頁 GET /api/note 會 re-fetch. 改回 200 + null,
    // 讓前端正常收尾, note 可由後續重跑 / GET 補. 安全:
    //   · safeNoteForStudent(null) 既有路徑天然回 null (sanitizer 不洩漏).
    //   · downstream extractKeyPhrase / Anchor 對 null 已 return null (見 L432) →
    //     daily_takeaways / active_context_summary 兩段的 `if (displayTerm)` 天然 skip.
    //   · Day-21 graduation gen 讀 noteResult.fullNote, 需明確 guard 跳過.
    const _tNote = Date.now();
    let noteResult = await generateDamonNote(sql, sessionId, module, week, day, wasCrisis);
    timing.damon_note_ms = Date.now() - _tNote;
    const _noteAvailable = !!noteResult;
    if (!_noteAvailable) {
      // generateDamonNote 內部 null path 已 log 過具體原因 (catch block / messages<2 /
      // student_id 缺). 此處 surface 一筆 finalize-side 觀測 (timing + sessionDay
      // + wasCrisis) — 鐵律 #2: 不 log 對話內容 / PII.
      console.warn('[finalize-day][note-null]', JSON.stringify({
        event: 'note_generation_returned_null',
        session_id: sessionId,
        session_day: sessionDay,
        was_crisis: wasCrisis,
        damon_note_ms: timing.damon_note_ms,
        observer_ms: timing.observer_ms,
        j2_ms: timing.j2_ms,
        j3_ms: timing.j3_ms,
      }));
      // Synthesize empty shape so downstream null-guards work naturally.
      noteResult = { fullNote: null, notebookPage: null };
    }

    // PR-4c-green 5/24 cleanup — 週報退場、產品改 5 phase reports。
    // 原 Day 7/14 generateWeekSummary 寫 is_week_summary=true row 的呼叫 +
    // function 本身已移除（function 定義原在檔尾、一併刪）。

    // ════════════════════════════════════════════════════════════════
    // PR-4c-2 P0-4 — daily_takeaways append（每天）+ Day 21 結業生成 + export email
    // ════════════════════════════════════════════════════════════════

    // (1) 每天：抽 Damon Note 【關鍵句】 → 兩條輸出
    //     PR-4c-green E4 fix (Patrick 5/24): 拆成 short anchor + full keyPhrase。
    //
    //   - daily_takeaways[].term: 短 anchor 優先（給 journey grid + 21 句詩用）；
    //     anchor 因句長無自然 boundary 而為 null 時、fallback 整句 keyPhrase（CSS
    //     text-overflow:ellipsis 處理長度）。「term 欄別塞截斷亂碼」(Patrick rule).
    //   - last_session_day_summary.last_takeaway_term: 整句 keyPhrase（給 E4
    //     跨日引用用、Sonnet 自己挑「一個詞」或「整句」、不在這裡硬切）。
    //
    //   兩條 fail-soft、不阻塞主回應。
    const keyPhrase  = extractKeyPhrase(noteResult.fullNote);
    const shortAnchor = extractTakeawayAnchor(noteResult.fullNote);
    const displayTerm = shortAnchor || keyPhrase;   // never a garbled cutoff
    if (displayTerm) {
      try {
        await appendDailyTakeaway(existing.student_id, { day: sessionDay, term: displayTerm });
      } catch (e) {
        console.error('[daily_takeaways] append failed (fail-soft):', e.message);
      }
      try {
        await setLastSessionDaySummary(existing.student_id, {
          // E4 day-opening selector reads this. Full keyPhrase (not the short
          // anchor) — Sonnet decides how to use it per the V1-V5 variant.
          last_takeaway_term: keyPhrase || displayTerm,
          last_takeaway_day: sessionDay,
        });
      } catch (e) {
        console.error('[last_takeaway_term] setLastSessionDaySummary failed (fail-soft):', e.message);
      }
    } else {
      console.warn(`[daily_takeaways] no 【關鍵句】 in Damon Note for day=${sessionDay} — skipping append`);
    }

    // ⭐ v5.2 第三塊 PR-a (Vivi 6/5) — per-category active_context_session_summary
    //   append (bug #7 fix: 跨天重問同 value/example).
    //   Source 重用既有 (Patrick 工程決策, 不加 Haiku call, 成本 0):
    //     - example = displayTerm (已抽 from Damon Note 關鍵句).
    //     - value = top1_value (current quality candidate; UPE 已 surfaced).
    //   category 從 students.active_context_category (migration 029 default 1=事業).
    //   fail-soft: migration 030 未跑 / 缺欄 / 沒 category → swallow + warn.
    if (displayTerm) {
      try {
        const studentCtxRow = await sql`
          SELECT active_context_category FROM students WHERE student_id = ${existing.student_id} LIMIT 1
        `;
        const catRaw = Number(studentCtxRow[0]?.active_context_category);
        const ctxCat = (Number.isInteger(catRaw) && catRaw >= 1 && catRaw <= 5) ? catRaw : null;
        if (ctxCat !== null) {
          const profileForVal = (await getUserProfile(existing.student_id)) || {};
          const top1 = typeof profileForVal.top1_value === 'string' && profileForVal.top1_value.trim().length > 0
            ? profileForVal.top1_value.trim() : null;
          await appendActiveContextSummary(existing.student_id, ctxCat, {
            day: sessionDay,
            value: top1 || undefined,
            example: keyPhrase || displayTerm,
          });
          console.info('[v5_2_active_context_summary] appended', JSON.stringify({
            event: 'active_context_summary_appended',
            category: ctxCat,
            day: sessionDay,
            has_value: !!top1,
            has_example: !!(keyPhrase || displayTerm),
            // 鐵律 #2: 不 log 學員原話 value/example 內容, 只 enum + count.
          }));
        }
      } catch (e) {
        console.error('[v5_2_active_context_summary] append failed (fail-soft):', e.message);
      }
    }

    // ⭐ 6/12 Stage 1 — sync session_state values columns → user_profile_evolution.
    //   values_collected_list / top1_value / values_ranking 在 session 中累積
    //   (engine-2 append), session close 要把最終值 cascade 到 UPE 才能讓下一
    //   場 session_state 拿得到 (跨 session 連續性).
    //   updateUserProfile 用 COALESCE 路徑 (state-manager.js:166-167) — 三個欄
    //   位的 patch 為 null 時 keep existing, 不會踩到既有 UPE 資料.
    //   fail-soft — 不阻塞主回應. Stage 1: top1_value / values_ranking 仍是
    //   null (Stage 2 才寫), 但已先把管子接好.
    try {
      const sessState = existing.session_state || {};
      const upePatch = {};
      if (Array.isArray(sessState.values_collected_list)) {
        upePatch.values_collected_list = sessState.values_collected_list;
      }
      if (typeof sessState.top1_value === 'string' && sessState.top1_value.trim().length > 0) {
        upePatch.top1_value = sessState.top1_value;
      }
      if (Array.isArray(sessState.values_ranking)) {
        upePatch.values_ranking = sessState.values_ranking;
      }
      if (Object.keys(upePatch).length > 0) {
        await updateUserProfile(existing.student_id, upePatch);
        console.info('[upe_values_sync] synced', JSON.stringify({
          event: 'upe_values_sync',
          has_list: !!upePatch.values_collected_list,
          list_size: upePatch.values_collected_list?.length ?? 0,
          has_top1: !!upePatch.top1_value,
          has_ranking: !!upePatch.values_ranking,
          // 鐵律 #2: 不 log 個別 value 內容 (只 enum + count).
        }));
      }
    } catch (e) {
      console.error('[upe_values_sync] update failed (fail-soft):', e.message);
    }

    // ⭐ v5.1 Step 6 PR-6b — crisis_state_carry_forward persistence.
    //   e4TakeawayHandler emits patch.crisis_state_carry_forward_pending_write into
    //   session_state at session close. We persist it to user_profile_evolution
    //   here (cross-session). V6 day-opening (engine-4-mode-aware) reads it next
    //   session and selects V6 sub-branch.
    //   ⚠️ M73 — Safety Planning 完成不得 reset resolved. updateCarryForwardOnSessionClose
    //     (engine-4-mode-aware) only sets resolved_at after 3-session natural de-escalation.
    //   ⚠️ fail-soft — don't block Damon Note flow if persistence errors.
    try {
      const sessState = existing.session_state || {};
      const pendingCarry = sessState.crisis_state_carry_forward_pending_write;
      if (pendingCarry !== undefined) {
        // pendingCarry can be null (clear crisis state) OR object (write full state).
        await setCrisisStateCarryForward(existing.student_id, pendingCarry);
        console.info('[crisis-carry-forward] persisted', JSON.stringify({
          event: 'crisis_state_carry_forward_persisted',
          student_id_present: !!existing.student_id,
          has_payload: pendingCarry !== null,
          si_risk_level: pendingCarry?.si_risk_level || null,
          landing_page_reminder_delivered: !!pendingCarry?.landing_page_reminder_delivered,
          handoff_choice: pendingCarry?.handoff_choice || null,
        }));
      }
    } catch (e) {
      console.error('[crisis_state_carry_forward] persistence failed (fail-soft):', e.message);
    }

    // (2) Day 21：生結業內容（coach letter + declaration）+ export prompt + email stub
    //     ⚠️ 不放進 finalize-day response（07 §3-B 沒這欄）— 持久化後由 GET /api/graduation 讀（07 §3-F、P1 落地）
    // 6/13 Patrick (A022 fix) — 若 note null (上面 fallback), 跳過 Day-21 gen.
    //   省 Sonnet token + 避免送 `${null}` 給 LLM 拿到垃圾結業文.
    //   下次 finalize 重跑 (或 Vivi 手動重觸) 自然會補上.
    if (graduation && !_noteAvailable) {
      console.warn('[finalize-day][graduation-skipped] note unavailable; deferring Day-21 gen until next finalize');
    }
    if (graduation && _noteAvailable) {
      try {
        // 2a. 撈 user_profile + 累積的 daily_takeaways
        const profile = (await getUserProfile(existing.student_id)) || {};
        const dailyTakeaways = Array.isArray(profile.daily_takeaways) ? profile.daily_takeaways : [];

        // 2b. Sonnet 生 coach_letter + declaration（JSON 結構化）
        const gradPrompt = buildGraduationSystemPrompt(module, dailyTakeaways);
        const gradResp = await getAnthropic().messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: gradPrompt,
          messages: [{
            role: 'user',
            content: `Day 21 Damon Note 全文：\n\n${noteResult.fullNote}`,
          }],
        });
        const graduationContent = parseGraduationResponse(gradResp.content?.[0]?.text || '');

        if (graduationContent) {
          // 2c. 持久化進 user_profile_evolution.last_session_day_summary.graduation
          try {
            await setLastSessionDaySummary(existing.student_id, {
              graduation: graduationContent,
            });
          } catch (e) {
            console.error('[graduation] setLastSessionDaySummary failed:', e.message);
          }

          // 2d. 學員的 email（從 students 表撈）
          let toEmail = null;
          try {
            const sRow = await sql`
              SELECT email FROM students WHERE student_id = ${existing.student_id} LIMIT 1
            `;
            toEmail = sRow[0]?.email || null;
          } catch (e) { console.warn('[graduation] email lookup failed:', e.message); }

          // 2e. 生 export markdown + 送 Brevo（stub fail-soft）
          if (toEmail) {
            const exportMarkdown = buildExportPersonalCoachPrompt({
              studentId: existing.student_id,
              top1_value: profile.top1_value,
              anchors: profile.anchors,
              values_ranking: profile.values_ranking,
            });
            const emailResp = await sendExportEmail({
              toEmail, studentId: existing.student_id,
              subject: '你的個人教練 prompt — 21 天的延續',
              markdownBody: exportMarkdown,
            });
            if (emailResp.stubbed) {
              console.warn(`[graduation] export email stubbed: ${emailResp.reason}`);
            }
          } else {
            console.warn(`[graduation] no email on file for ${existing.student_id} — skipping export send`);
          }

          // 2f. 戳記 export_prompt_generated_at（即便 email stubbed 也戳、避免 endpoint 永遠回未生成）
          try { await markExportEmailed(existing.student_id); }
          catch (e) { console.error('[graduation] markExportEmailed failed:', e.message); }
        } else {
          console.warn('[graduation] Sonnet output failed schema validation — graduationContent null');
        }
      } catch (e) {
        console.error('[graduation] Day 21 generation failed (fail-soft):', e.message);
      }
    }

    if (noteResult.notebookPage && containsForbiddenContent(noteResult.notebookPage)) {
      console.warn(`[finalize-day B1] freshly-generated notebook_page contained forbidden coach-internal content — sanitized at API boundary`);
    }
    // 6/13 Patrick (A022 case) — per-stage timing summary (鐵律 #2: 只 ms / enum).
    //   能一眼看出 observer / J2 / J3 / note 各花多久, 下次 timeout 一眼定位真因.
    console.info('[finalize-day][timing]', JSON.stringify({
      event: 'finalize_timing',
      session_id: sessionId,
      session_day: sessionDay,
      observer_ms: timing.observer_ms,
      j2_ms: timing.j2_ms,
      j3_ms: timing.j3_ms,
      damon_note_ms: timing.damon_note_ms,
      total_ms: Date.now() - tFinalizeStart,
      note_available: _noteAvailable,
      was_crisis: wasCrisis,
      graduation,
    }));
    // Patrick 5/25 leak fix — see「alreadyDone」 branch comment above.
    // damonNotePublic removed; notebookPage runs through fail-closed sanitizer.
    return res.status(200).json({
      ok: true,
      alreadyDone: false,
      notebookPage: safeNoteForStudent(noteResult.notebookPage, {
        observe: (label) => console.warn(`[finalize-day B1] ${label} (session=${sessionId})`),
      }),
      isGraduation: graduation,
    });

  } catch (e) {
    console.error('finalize-day error:', e);
    return res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
}
