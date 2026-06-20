#!/usr/bin/env node
// scripts/regen-notebook-page.js
// Vivi 6/19 — 重生「前端學員教練卡」(notebook_page),套用新 prompt
//   (三類觀察:限制性信念 / away-from / 外部認可 織進犀利段)。
//
// ⚠️ 只重生「前端卡」:沿用 sessions.damon_note 既有的後端 Damon Note(不重生後端、
//    不再跑 note 生成 LLM),只重新呼叫 generateNotebookPage → 覆寫 sessions.notebook_page。
//    → 後端筆記 0 動;只有學員看到的卡換成新 prompt 的版本。
//
// wasCrisis 用 sessionTouchedCrisis(session_state) 推導(與 finalize-day 同一條)
//   → crisis 場仍走溫和版,不會把犀利點破落在剛脆弱過的學員身上。
//
// dryRun (預設):只列「會重生哪些 session」(meta:day / wasCrisis / 後端筆記長度),
//                不呼叫 generateNotebookPage、不寫 DB。raw 筆記 / 卡內容永不入 log。
// --commit:對每個 finalized day 呼叫 generateNotebookPage → 覆寫 notebook_page。
//
// 預設 --students=A025(Vivi 6/19 範圍鎖定)。

import { neon } from '@neondatabase/serverless';
import { generateNotebookPage } from '../api/chat.js';
import { sessionTouchedCrisis } from '../lib/api/crisis-session-flag.js';

export function parseArgs(argv) {
  const out = { students: [], module: 'self', commit: false, report: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--student='))       out.students.push(...a.slice(10).trim().split(/\s+/).filter(Boolean));
    else if (a.startsWith('--students=')) out.students.push(...a.slice(11).trim().split(/\s+/).filter(Boolean));
    else if (a.startsWith('--module='))   out.module = a.slice(9).trim() || 'self';
    else if (a === '--commit')            out.commit = true;
    else if (a.startsWith('--report='))   out.report = a.slice(9).trim();
    else if (a === '--help')              out.help = true;
  }
  if (out.students.length === 0) out.students = ['A025'];   // Vivi 6/19 default scope
  return out;
}

// Orchestrate one student (testable; deps injected).
export async function regenOneStudent(studentId, deps) {
  const {
    listSessions, loadStudentMeta, loadYesterdayHypothesis, regen,
    deriveWasCrisis, commit, module = 'self', log = () => {},
  } = deps;
  const sessions = await listSessions(studentId, module);
  const meta = await loadStudentMeta(studentId);
  const days = [];
  for (const s of sessions) {
    const wasCrisis = deriveWasCrisis(s.sessionState);
    const noteLen = typeof s.fullNote === 'string' ? s.fullNote.length : 0;
    if (!s.fullNote || noteLen === 0) {
      days.push({ day: s.day, skipped: 'no-backend-note', wasCrisis });
      continue;
    }
    if (commit) {
      const ysc = await loadYesterdayHypothesis(studentId, module, s.day);
      const page = await regen({
        sessionId: s.sessionId, module, fullNote: s.fullNote,
        yesterdaySCHypothesis: ysc, preferredName: meta.preferredName,
        wasCrisis, activeContextName: meta.activeContextName,
        activeContextDefinition: meta.activeContextDefinition,
      });
      const cardLen = typeof page === 'string' ? page.length : 0;
      days.push({ day: s.day, wasCrisis, noteLen, cardLen, committed: true });
      log(`[${studentId}] Day ${s.day} regenerated — wasCrisis=${wasCrisis} cardLen=${cardLen}`);
    } else {
      days.push({ day: s.day, wasCrisis, noteLen, committed: false });
      log(`[${studentId}] Day ${s.day} dryRun — wasCrisis=${wasCrisis} noteLen=${noteLen} (no write)`);
    }
  }
  return { studentId, module, days };
}

// SAFE per-student report (meta only; no note / card content — 鐵律 #2).
export function formatRegenReport({ studentId, module, days }) {
  const L = [`### ${studentId} · ${module}`];
  if (days.length === 0) { L.push('(無 finalized session)'); return L.join('\n'); }
  for (const d of days) {
    if (d.skipped) { L.push(`- Day ${d.day}: skipped (${d.skipped})`); continue; }
    L.push(d.committed
      ? `- Day ${d.day}: regenerated OK · wasCrisis=${d.wasCrisis} · backend-note ${d.noteLen} chars · new-card ${d.cardLen} chars`
      : `- Day ${d.day}: dry-run (would regen) · wasCrisis=${d.wasCrisis} · backend-note ${d.noteLen} chars`);
  }
  return L.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('node scripts/regen-notebook-page.js [--students="A025"] [--module=self] [--commit] [--report=path]');
    return;
  }
  if (!process.env.DATABASE_URL)      { console.error('DATABASE_URL not set'); process.exit(1); }
  if (!process.env.ANTHROPIC_API_KEY) { console.error('ANTHROPIC_API_KEY not set'); process.exit(1); }
  if (args.commit) {
    console.log('--commit mode: this will OVERWRITE production notebook_page (front card) — backend note untouched.');
    console.log('   Proceeding in 3s ... (Ctrl-C to abort)');
    await new Promise(r => setTimeout(r, 3000));
  }
  const sql = neon(process.env.DATABASE_URL);

  const deps = {
    module: args.module,
    commit: args.commit,
    deriveWasCrisis: sessionTouchedCrisis,
    listSessions: async (id, module) => {
      const rows = await sql`
        SELECT id AS session_id, day, damon_note, session_state
          FROM sessions
         WHERE student_id = ${id} AND module = ${module} AND damon_note IS NOT NULL
         ORDER BY day ASC`;
      return rows.map(r => ({
        sessionId: r.session_id, day: r.day,
        fullNote: r.damon_note, sessionState: r.session_state,
      }));
    },
    loadStudentMeta: async (id) => {
      const rows = await sql`
        SELECT preferred_name, active_context_name, active_context_definition
          FROM students WHERE student_id = ${id} LIMIT 1`;
      const r = rows[0] || {};
      return {
        preferredName: r.preferred_name ?? null,
        activeContextName: r.active_context_name ?? null,
        activeContextDefinition: r.active_context_definition ?? null,
      };
    },
    loadYesterdayHypothesis: async (id, module, day) => {
      const rows = await sql`
        SELECT note_text FROM damon_notes
         WHERE student_id = ${id} AND module = ${module} AND is_week_summary = false AND day < ${day}
         ORDER BY week DESC, day DESC LIMIT 1`;
      const m = rows[0]?.note_text?.match(/【SC 觀察】\s*\n([\s\S]*?)(?=\n【|$)/);
      return m ? m[1].trim() : null;
    },
    regen: ({ sessionId, module, fullNote, yesterdaySCHypothesis, preferredName,
              wasCrisis, activeContextName, activeContextDefinition }) =>
      generateNotebookPage(
        sql, sessionId, module, fullNote, yesterdaySCHypothesis,
        preferredName, wasCrisis, activeContextName, activeContextDefinition,
      ),
    log: (m) => console.log(m),
  };

  const blocks = [`# regen notebook_page (front card) — ${args.commit ? 'COMMIT' : 'dry-run'}`, ''];
  for (const sid of args.students) {
    const clean = sid.replace(/[^A-Za-z0-9_]/g, '');
    if (!clean) continue;
    try {
      const res = await regenOneStudent(clean, deps);
      blocks.push(formatRegenReport(res));
      blocks.push('');
    } catch (e) {
      blocks.push(`### ${clean}\nfailed: ${e?.message || e}`);
    }
  }
  const report = blocks.join('\n');
  console.log(report);
  if (args.report) { const fs = await import('node:fs'); fs.writeFileSync(args.report, report + '\n', 'utf8'); }
}

const invokedDirect = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`
        || import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`;
  } catch { return false; }
})();
if (invokedDirect) main().catch(e => { console.error('FATAL:', e?.message || e); process.exit(1); });
