#!/usr/bin/env node
// scripts/backfill-storyboard-from-notes.js
// 正式版 — 用 Damon Notes 重生「我的人生旅途」七步 (取代逐句 observer 內容生成)。
//
// 只更新 sc_storyboard (內容);sc_journey_step / sc_journey_evidence 不動
//   (沿用既有 — currentStep 當「填到第幾步」的 cap, 保留進度語意)。
//
// dryRun (預設):只印 SAFE 報告 (meta + 已 gate 的七步內容 + 探針), raw 筆記不入 log。
// --commit:寫 prod sc_storyboard (gated 內容)。
//
// 安全沿用 note-to-storyboard-gen.js (pre-scrub + post-gate + sovereign retry)。
// 配套 workflow 另有 14-pattern SI leak-guard (S5)。

import { neon } from '@neondatabase/serverless';
import Anthropic from '@anthropic-ai/sdk';
import { callAnthropicWithRetry } from '../lib/api/anthropic-retry.js';
import {
  generateStoryboardFromNotes,
  buildScStoryboardFromGen,
} from '../lib/api/note-to-storyboard-gen.js';

export function parseArgs(argv) {
  const out = { students: [], commit: false, model: 'claude-sonnet-4-6', report: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--student='))       out.students.push(...a.slice(10).trim().split(/\s+/).filter(Boolean));
    else if (a.startsWith('--students=')) out.students.push(...a.slice(11).trim().split(/\s+/).filter(Boolean));
    else if (a === '--commit')            out.commit = true;
    else if (a.startsWith('--model='))    out.model = a.slice(8).trim();
    else if (a.startsWith('--report='))   out.report = a.slice(9).trim();
    else if (a === '--help')              out.help = true;
  }
  return out;
}

// Orchestrate one student (testable; deps injected).
//   deps: { loadStep(id)->int, pullNotes(id)->rows[], generate({notes,student})->genResult,
//           write(id, sb)->void, commit:bool, log }
export async function runOneStudentFromNotes(studentId, deps) {
  const { loadStep, pullNotes, generate, write, commit, log = () => {} } = deps;
  const currentStep = await loadStep(studentId);
  const notes = await pullNotes(studentId);
  const gen = await generate({ notes, student: studentId });
  const sb = buildScStoryboardFromGen(gen.steps, currentStep);
  const filled = Object.keys(sb).filter(k => sb[k].state === 'filled').length;
  if (commit) {
    await write(studentId, sb);
    log(`[${studentId}] committed sc_storyboard — currentStep=${currentStep} filled=${filled}/7`);
  } else {
    log(`[${studentId}] dryRun — currentStep=${currentStep} filled=${filled}/7 (no write)`);
  }
  return { studentId, currentStep, sb, gen, filled };
}

// SAFE per-student report (meta + gated content only; no raw notes).
export function formatFromNotesReport({ studentId, currentStep, sb, gen, filled }) {
  const zh = ['', '發現匱乏', '承認渴望', '挖掘數據', '認領身份', '發現資源', '奪回主權', '新的身分'];
  const L = [];
  L.push(`### ${studentId}`);
  const m = gen?.meta || {};
  L.push(`currentStep:${currentStep} · filled:${filled}/7 · 筆記:${m.noteCount ?? '?'} 篇 · 預刷:${m.totalDropped ?? '?'}/${m.totalSents ?? '?'}`);
  const probe = gen?.incongruence_probe || {};
  L.push(`內在不一致探針:${probe.detected ? '有' : '無'}${probe.summary ? ` — ${probe.summary}` : ''}`);
  for (let n = 1; n <= 7; n++) {
    const s = sb[`step_${n}`] || {};
    L.push(`- **Step ${n} ${zh[n]}** (${s.state})`);
    if (s.state !== 'filled') continue;
    L.push(`  · 大腦現狀:${s.brain_state?.description ?? '—'}`);
    if (n <= 5) {
      L.push(`  · 可能阻力:${s.resistance ?? '—'}`);
      L.push(`  · 良善動機:${s.benevolent_intent ?? '—'}`);
    } else {
      const reason = gen?.steps?.[n]?.sovereign_reason;
      L.push(`  · 主權宣告:${s.sovereign_action ?? `(null${reason ? ' — ' + reason : ''})`}`);
    }
  }
  return L.join('\n');
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || args.students.length === 0) {
    console.log('node scripts/backfill-storyboard-from-notes.js --students="A006" [--commit] [--model=…] [--report=path]');
    return;
  }
  if (!process.env.DATABASE_URL)      { console.error('❌ DATABASE_URL not set'); process.exit(1); }
  if (!process.env.ANTHROPIC_API_KEY) { console.error('❌ ANTHROPIC_API_KEY not set'); process.exit(1); }
  if (args.commit) {
    console.log('⚠️  --commit mode: this will UPDATE production sc_storyboard.');
    console.log('   Proceeding in 3s … (Ctrl-C to abort)');
    await new Promise(r => setTimeout(r, 3000));
  }
  const sql = neon(process.env.DATABASE_URL);
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  const deps = {
    loadStep: async (id) => {
      const rows = await sql`SELECT sc_journey_step FROM students WHERE student_id = ${id} LIMIT 1`;
      const v = rows[0]?.sc_journey_step;
      return Number.isInteger(v) ? v : 7;
    },
    pullNotes: async (id) => sql`
      SELECT week, day, note_text, is_week_summary
        FROM damon_notes WHERE student_id = ${id}
       ORDER BY week, day, is_week_summary`,
    generate: ({ notes, student }) => generateStoryboardFromNotes({
      notes, student, anthropic, callAnthropicWithRetry, model: args.model,
      log: (m) => console.warn(m),
    }),
    write: async (id, sb) => {
      await sql`UPDATE students SET sc_storyboard = ${JSON.stringify(sb)}::jsonb WHERE student_id = ${id}`;
    },
    commit: args.commit,
    log: (m) => console.log(m),
  };

  const blocks = [`# note→storyboard backfill (${args.commit ? 'COMMIT' : 'dry-run'})`, ''];
  for (const sid of args.students) {
    const clean = sid.replace(/[^A-Za-z0-9_]/g, '');
    if (!clean) continue;
    try {
      const res = await runOneStudentFromNotes(clean, deps);
      blocks.push(formatFromNotesReport(res));
      blocks.push('');
    } catch (e) {
      blocks.push(`### ${clean}\n❌ failed: ${e?.message || e}`);
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
