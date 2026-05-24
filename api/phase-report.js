// api/phase-report.js
// GET /api/phase-report?studentId=A001&module=self&phase=N    (N = 1..5)
// PR-4c-green P4. Per docs/v5-spec/engineering/09-green-ui-spec.md §5.5 + §8 + §10.
//
// Response shape:
//   { phaseId, name, roman, teaching, breakthrough, generatedAt, exists }
//
// Phase Report card (frontend §5.5) = fixed教學 (top) + generated 突破彙整 (bottom):
//   - teaching:     hard-coded distillation from PHASE_REPORT_TEACHINGS (spec §8)
//   - breakthrough: Sonnet-generated from this student's damon_notes, warm 第二
//                   人稱「你」, ~6-8 lines, includes student原話, ends forward-looking.
//                   Cached in user_profile_evolution.last_session_day_summary
//                   .phase_reports[phaseId] = { breakthrough, generatedAt }.
//                   Lock gate: phase report N must be unlocked given the
//                   student's current_phase (lib/api/phase-state.js mapping).
//
// Locked → 200 { ..., exists: false }; the frontend treats it as "not yet".

import { neon } from '@neondatabase/serverless';
import Anthropic from '@anthropic-ai/sdk';
import {
  getUserProfile, setLastSessionDaySummary,
} from '../lib/state/state-manager.js';
import {
  PHASE_REPORT_NAMES, PHASE_REPORT_ROMAN, PHASE_REPORT_TEACHINGS,
  isPhaseReportUnlocked,
} from '../lib/api/phase-state.js';
import {
  sanitizeStudentNote, containsForbiddenContent,
} from '../lib/api/student-note-safe.js';
// PR-4c-green Patrick 5/24 — shared coach-session gate (audience=coach branch).
import { guardCoachOr401 } from '../lib/auth/coach-session.js';
// PR-4c-green Auth rebuild stage 1d — student path reads sid from session cookie.
import { guardStudentOr401 } from '../lib/auth/student-session.js';

export const maxDuration = 30;
export const config = { maxDuration: 30 };

// Lazy Anthropic singleton — same pattern as chat.js / finalize-day.js
let _anthropic = null;
function getAnthropic() {
  if (_anthropic) return _anthropic;
  _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

const MODEL = 'claude-sonnet-4-6';

/**
 * Build the Sonnet system prompt for the 突破彙整 (lower half of the Phase
 * Report card). Pure helper, exported for testing.
 *
 * @param {number} phaseId   1..5
 * @param {string} phaseName
 * @param {string|null} preferredName
 * @returns {string}
 */
export function buildBreakthroughPrompt(phaseId, phaseName, preferredName) {
  const name = preferredName || '學員';
  return `你是 Vivi 教練。學員「${name}」剛完成 21 天「看見自己」旅程裡的 Phase ${phaseId}「${phaseName}」階段。
你的任務：寫一段「你的突破」——這 phase 的突破彙整、放在 Phase Report 卡的下半。

⚠️ 嚴格紅線（學員會直接讀這頁）：
- 全程第二人稱「你」（可少量用「${name}」增暖、別整段重複）、不寫「她/他」、不假設性別。
- 不問「Why」式問題（紅線 1）；用「擁有這個對你來說會帶來什麼」一類問句反映即可、別丟問題在這裡。
- 不寫任何 Damon Note section 名稱（【SC 觀察】/【深度層次】/【還沒碰到的】/【明天的入口】/【採集追蹤】/【關鍵句】 等）。
- 不寫「工具一/二/三/四」、不寫「Layer 1-5 / L1-L5」、不寫「2A/B/C 池」。
- 不寫「加油/你已經很努力了/擁抱自己/成為更好的自己/跟著做就會/立刻改變人生」。

格式要求：
- 約 6-8 行（一段或兩段、不列點）。
- 引用學員真實原話（加引號）至少一句、不要替學員重寫。
- 收尾用一句「往前」的句子——不下指令、不雞湯、平靜地指向下一步。

Phase ${phaseId}「${phaseName}」的觀察重點（供你寫作參考、不要直接列出來）：
${[
  '1. 學員從表層目標往下挖到核心價值觀的過程、停下來的那個詞。',
  '2. 學員從「我希望可以」走到「我是」的轉換、哪一句話確定了身份。',
  '3. 學員給出的反例、地圖如何從「永遠不能」鬆開的瞬間。',
  '4. 阻力的正向意圖被看見的時刻、內在從分裂走向同頻。',
  '5. 從意志力走到與價值對齊的時刻、放手帶著走的姿態。',
][phaseId - 1]}`;
}

/**
 * Build the user-message context for the Sonnet call from the student's
 * damon_notes. Pure helper.
 *
 * @param {Array<{week:number,day:number,note_text:string}>} damonNotes
 * @returns {string}
 */
export function buildBreakthroughUserMessage(damonNotes) {
  const rows = Array.isArray(damonNotes) ? damonNotes : [];
  if (rows.length === 0) {
    return `學員目前的 21 天 Damon Note 還很空——盡量從你能讀到的內容萃。若資料太少、寫一段 ~4 行的「你已經開始了」式短信、不要硬編未發生的事。`;
  }
  return rows
    .sort((a, b) => (a.day || 0) - (b.day || 0))
    .map(n => `[Day ${n.day}]\n${n.note_text || ''}`)
    .join('\n\n---\n\n');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const module    = String(req.query?.module    || 'self').trim();
  const phaseId   = parseInt(req.query?.phase);
  // PR-4c-green P5 — audience=coach returns the un-sanitized breakthrough so the
  // coach sees the full Sonnet output (parallel to /api/note?audience=coach behavior).
  // Default audience = student → sanitizer runs as before.
  const audience  = String(req.query?.audience  || 'student').trim();
  const isCoach   = audience === 'coach';
  if (!Number.isInteger(phaseId) || phaseId < 1 || phaseId > 5) {
    return res.status(400).json({ error: 'Invalid phase (1-5)' });
  }

  // PR-4c-green Auth rebuild stage 1d — studentId source split by audience:
  //   - coach: studentId from query (coach reviews any student); coach gate verifies role
  //   - student: studentId from SESSION COOKIE only; client-supplied query is ignored
  let studentId;
  if (isCoach) {
    if (!(await guardCoachOr401(req, res))) return;
    studentId = String(req.query?.studentId || '').trim();
    if (!studentId) return res.status(400).json({ error: 'Missing required query: studentId' });
  } else {
    studentId = await guardStudentOr401(req, res);
    if (!studentId) return;
  }

  const sql = neon(process.env.DATABASE_URL);

  try {
    // 1. Load profile + last session's current_phase
    const profile = (await getUserProfile(studentId)) || {};
    let currentPhase = null;
    try {
      const lr = await sql`
        SELECT session_state FROM sessions
        WHERE student_id = ${studentId} AND module = ${module}
        ORDER BY created_at DESC LIMIT 1
      `;
      currentPhase = lr[0]?.session_state?.current_phase || null;
    } catch (e) { console.warn('[phase-report] current_phase lookup failed:', e.message); }

    const name  = PHASE_REPORT_NAMES[phaseId - 1];
    const roman = PHASE_REPORT_ROMAN[phaseId - 1];
    const teaching = PHASE_REPORT_TEACHINGS[phaseId - 1];

    // 2. Lock gate — Phase Report N must be unlocked
    if (!isPhaseReportUnlocked(phaseId, currentPhase)) {
      return res.status(200).json({
        phaseId, name, roman,
        teaching: null, breakthrough: null, generatedAt: null,
        exists: false,
      });
    }

    // 3. Cache hit — phase_reports[N] already generated → return immediately
    //    Cached breakthrough is the post-sanitization (student-safe) version, written
    //    on first generation. For coach, return it as-is too — re-sanitization is a
    //    no-op on already-clean text; the un-sanitized raw is not persisted (by design,
    //    so a coach-only path can't leak forbidden content into the student cache).
    const cached = profile.last_session_day_summary?.phase_reports?.[String(phaseId)];
    if (cached?.breakthrough) {
      return res.status(200).json({
        phaseId, name, roman,
        teaching, breakthrough: cached.breakthrough, generatedAt: cached.generatedAt || null,
        exists: true,
      });
    }

    // 4. Generate via Sonnet — pull this student's damon_notes
    let damonNotes = [];
    try {
      damonNotes = await sql`
        SELECT week, day, note_text FROM damon_notes
        WHERE student_id = ${studentId} AND module = ${module} AND is_week_summary = FALSE
        ORDER BY day ASC
      `;
    } catch (e) { console.warn('[phase-report] damon_notes fetch failed:', e.message); }

    const system = buildBreakthroughPrompt(phaseId, name, profile.preferred_name || null);
    const userMsg = buildBreakthroughUserMessage(damonNotes);

    let breakthroughRaw = '';
    try {
      const resp = await getAnthropic().messages.create({
        model: MODEL,
        max_tokens: 700,
        system,
        messages: [{ role: 'user', content: userMsg }],
      });
      breakthroughRaw = resp.content?.[0]?.text || '';
    } catch (e) {
      console.error('[phase-report] Sonnet call failed:', e.message);
      // Fail-soft: return teaching only, exists:true so the page still renders
      return res.status(200).json({
        phaseId, name, roman,
        teaching, breakthrough: '（教練見證稍後送達。）', generatedAt: null,
        exists: true,
      });
    }

    // Defence-in-depth scrub — exactly like /api/note + finalize-day notebookPage
    if (containsForbiddenContent(breakthroughRaw)) {
      console.warn(`[phase-report B1] phase=${phaseId} student=${studentId} contained forbidden coach-internal content — sanitized at API boundary`);
    }
    const breakthrough = sanitizeStudentNote(breakthroughRaw);
    const generatedAt = new Date().toISOString();

    // 5. Cache the SANITIZED version — never persist the raw (defends against an
    //    accidental future audience=coach path leaking back into student cache).
    try {
      const existing = profile.last_session_day_summary?.phase_reports || {};
      const updated  = { ...existing, [String(phaseId)]: { breakthrough, generatedAt } };
      await setLastSessionDaySummary(studentId, { phase_reports: updated });
    } catch (e) {
      console.warn('[phase-report] cache write failed (fail-soft):', e.message);
    }

    // PR-4c-green P5 — coach gets the raw Sonnet output (full version of 教練見證);
    //    student gets the sanitized version. The cache (line 5) always stores sanitized.
    return res.status(200).json({
      phaseId, name, roman,
      teaching,
      breakthrough: isCoach ? breakthroughRaw : breakthrough,
      generatedAt,
      exists: true,
    });

  } catch (e) {
    console.error('[phase-report] error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
