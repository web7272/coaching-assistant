#!/usr/bin/env node
// scripts/backfill-storyboard.js
// v5.3 件3 (6/12) — 舊封測者頁Y 一次性回填.
//
// ⚠️ 預設 dry-run: 只讀 + 推導 + LLM 生成 + 輸出報告. 絕不寫 DB.
//    真寫要明確 `--commit` flag (Vivi 在 prod 跑、CC/Patrick 不真跑).
//
// 流程 (per 學員):
//   1. 讀 sessions.session_state.reframe_invocation_history_in_session,
//      attach day, 攤平成 reframeHistory.
//   2. 讀 user_profile_evolution.active_context_session_summary[catKey]
//      → surfacedValues + surfacedExamples.
//   3. 讀 user_profile_evolution.daily_takeaways.
//   4. deriveScJourneyFromHistory(signals) → {evidence, step}
//      (純函式, 對齊 live 映射, 高危 quote → null).
//   5. 對 evidence[step_N] 非空的步, 走 generateBrainState (J2) +
//      generateSovereignAction (J3). 兩者 fail-soft (null on insufficient /
//      LLM throw / rigidity-at-self / 缺內控宣告 / scrub-empty).
//   6. dry-run: 把 evidence + 生成文字寫進報告檔. 不碰 DB.
//      --commit: UPDATE students SET sc_journey_evidence, sc_journey_step,
//                sc_storyboard = …
//
// 對象: plan='plan_a' AND is_beta=TRUE AND is_blocked IS NOT TRUE.
//   --student <id> 只跑一個人.
//
// 安全鐵則 (per Patrick 6/12):
//   · 走既有 J2/J3 helper, 絕不另寫生成邏輯 (safety 才一致).
//   · log / 報告 不含 raw 對話全文 (鐵律 #2). 只 step / type / quote
//     (anchor/surfaced/takeaway 來源) + LLM-生成-已-scrubbed 文字.
//   · idempotent: 預設覆蓋, log 提示.

import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { neon } from '@neondatabase/serverless';
import Anthropic from '@anthropic-ai/sdk';

import { callAnthropicWithRetry } from '../lib/api/anthropic-retry.js';
import { deriveScJourneyFromHistory } from '../lib/api/sc-storyboard-backfill.js';
import {
  generateBrainState,
  generateSovereignAction,
} from '../lib/api/sc-storyboard-gen.js';

// ────────────────────────────────────────────────────────────────
// CLI arg parsing.
// ────────────────────────────────────────────────────────────────
export function parseArgs(argv) {
  const args = {
    dryRun: true,
    studentId: null,
    reportPath: './backfill-report.txt',
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--commit')        args.dryRun = false;
    else if (a === '--dry-run')  args.dryRun = true;
    else if (a === '--student' && argv[i + 1]) {
      args.studentId = argv[i + 1]; i++;
    } else if (a === '--report' && argv[i + 1]) {
      args.reportPath = argv[i + 1]; i++;
    } else if (a === '--help' || a === '-h') {
      args.help = true;
    }
  }
  return args;
}

// ────────────────────────────────────────────────────────────────
// Pure: compose signals from raw rows.
//   - reframeHistory: flatten session_state.reframe_invocation_history_in_session,
//     attach day, sort by (day, original order).
//   - surfacedValues / Examples: from upe.active_context_session_summary[catKey].
//   - dailyTakeaways: from upe.daily_takeaways.
// ────────────────────────────────────────────────────────────────
export function composeSignals(studentRow, sessions, upe) {
  const activeContext = {
    name:       studentRow?.active_context_name       ?? null,
    definition: studentRow?.active_context_definition ?? null,
  };
  const catKey = studentRow?.active_context_category != null
    ? String(studentRow.active_context_category) : null;

  // Flatten reframe entries from all sessions, attach day.
  const reframeHistory = [];
  for (const s of (sessions || [])) {
    const day = Number.isInteger(s?.day) ? s.day : null;
    const list = Array.isArray(s?.session_state?.reframe_invocation_history_in_session)
      ? s.session_state.reframe_invocation_history_in_session : [];
    for (const e of list) {
      if (!e || typeof e !== 'object') continue;
      reframeHistory.push({
        reframe_id:               e.reframe_id ?? null,
        day,
        anchor_phrase_if_success: e.anchor_phrase_if_success ?? null,
        invoked_at:               e.invoked_at ?? null,
        session_id:               s.id ?? null,
      });
    }
  }

  // UPE buckets (may be missing).
  const upeSummary = upe?.active_context_session_summary || {};
  const bucket = (catKey && upeSummary[catKey]) ? upeSummary[catKey] : {};
  const surfacedValues   = Array.isArray(bucket.surfaced_values)   ? bucket.surfaced_values   : [];
  const surfacedExamples = Array.isArray(bucket.surfaced_examples) ? bucket.surfaced_examples : [];
  const dailyTakeaways   = Array.isArray(upe?.daily_takeaways)     ? upe.daily_takeaways      : [];

  return {
    activeContext,
    catKey,
    reframeHistory,
    surfacedValues,
    surfacedExamples,
    dailyTakeaways,
  };
}

// ────────────────────────────────────────────────────────────────
// 6/12 — Reframe IDs 顯示順序 (對齊 REFRAME_STEP_MAP). 加 unmapped 桶
// 收殘:R8 / R11 等不映射的 (誠實列出, 不藏).
// ────────────────────────────────────────────────────────────────
const REFRAME_IDS_FOR_SUMMARY = ['R1', 'R1_E', 'R2', 'R3', 'R5', 'R6', 'R7', 'R12'];

// ────────────────────────────────────────────────────────────────
// Pure: signal-source summary — 開頭印每個學員的原始訊號數量 (Patrick
// 6/12 診斷需求). 一眼看出 step 3-7 空是「資料薄」 (reframe 0 筆) 還是
// 「有訊號沒被吃到」 (reframe N>0 但 evidence 還是空).
//
// ⚠️ 鐵律 #2: 只給數字 / reframe_id / 類型 — 絕不貼 raw 對話原文.
//   surfaced_values 列出 (本就是 quality term, 不是 raw 原文).
// ────────────────────────────────────────────────────────────────
export function summarizeSignals(signals) {
  if (!signals || typeof signals !== 'object') {
    return '  (signals 缺, 無法摘要)';
  }
  const reframeHistory   = Array.isArray(signals.reframeHistory)   ? signals.reframeHistory   : [];
  const surfacedValues   = Array.isArray(signals.surfacedValues)   ? signals.surfacedValues   : [];
  const surfacedExamples = Array.isArray(signals.surfacedExamples) ? signals.surfacedExamples : [];
  const dailyTakeaways   = Array.isArray(signals.dailyTakeaways)   ? signals.dailyTakeaways   : [];

  // Per-reframe_id breakdown.
  const counts = Object.create(null);
  let unmappedCount = 0;
  const unmappedIds = new Set();
  for (const e of reframeHistory) {
    if (!e || typeof e !== 'object' || typeof e.reframe_id !== 'string') continue;
    if (REFRAME_IDS_FOR_SUMMARY.includes(e.reframe_id)) {
      counts[e.reframe_id] = (counts[e.reframe_id] || 0) + 1;
    } else {
      unmappedCount++;
      unmappedIds.add(e.reframe_id);
    }
  }
  const breakdown = REFRAME_IDS_FOR_SUMMARY
    .map(id => `${id}×${counts[id] || 0}`).join(' ');
  const unmappedStr = unmappedCount > 0
    ? `  unmapped×${unmappedCount} (${[...unmappedIds].sort().join(',')})`
    : '';

  const lines = [];
  lines.push(`── signals summary ───────────────`);
  lines.push(`  reframe entries: ${reframeHistory.length} 筆`);
  lines.push(`    ${breakdown}${unmappedStr}`);
  lines.push(`  surfaced_examples: ${surfacedExamples.length} 筆`);
  // surfaced_values: 列出前 5 個 (它是 quality term, 不是 raw 原文 — 安全 + 診斷有用).
  const sv = surfacedValues.filter(v => typeof v === 'string' && v.length > 0);
  const svPreview = sv.slice(0, 5).join(', ');
  const svMoreStr = sv.length > 5 ? ` ... (+${sv.length - 5})` : '';
  lines.push(`  surfaced_values:   ${sv.length} 筆${sv.length > 0 ? ` (${svPreview}${svMoreStr})` : ''}`);
  lines.push(`  daily_takeaways:   ${dailyTakeaways.length} 筆`);
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────
// Pure: 從 captured logs 抽出 generate* 的 null 原因.
//   sc-storyboard-gen.js log lines 都已結構化 (e.g.
//   "[sc-storyboard-gen][sovereign_action] step N missing self-control declaration → null").
//   最後一條通常就是 fail-reason. 抓最後一條 + 修剪前綴.
// ────────────────────────────────────────────────────────────────
export function summarizeNullReason(logsArray) {
  if (!Array.isArray(logsArray) || logsArray.length === 0) return null;
  // Walk from end, find first line that mentions "→ null" or "threw" or "fail".
  for (let i = logsArray.length - 1; i >= 0; i--) {
    const line = String(logsArray[i] || '');
    if (/→\s*null|threw|fail-?soft|fail/.test(line)) {
      // Strip leading `[sc-storyboard-gen]` / `[sc-storyboard-gen][sovereign_action]` prefix.
      return line
        .replace(/^\[sc-storyboard-gen\](\[\w+\])?\s*/, '')
        .replace(/^step\s+\d+\s+/, '')          // 去掉 redundant "step N " (已在外層顯示)
        .trim();
    }
  }
  // Fallback: 沒命中 pattern, 回最後一條 (truncate 200 chars 防 raw text 漏入).
  return String(logsArray[logsArray.length - 1] || '').slice(0, 200);
}

// ────────────────────────────────────────────────────────────────
// Pure: format the per-student report block (Patrick reads this).
//   ⚠️ No raw conversation text — only step/type/quote (came from anchor/
//   surfaced/takeaway, never raw chat) + LLM-generated (already scrubbed) text.
//
//   6/12 diagnostic upgrade: + signals summary (top) + 確切 null 原因
//   (來自 generate* 已 log 的 reasons map). signals + reasons 都 optional
//   (向後相容, 沒給就走 generic 版).
// ────────────────────────────────────────────────────────────────
export function formatStudentReport({ studentId, signals, derived, generated, reasons }) {
  const lines = [];
  lines.push(`═══════════════════════════════════════════════════════════════`);
  lines.push(`student: ${studentId}`);
  lines.push(`sc_journey_step: ${derived.step ?? '(null)'}`);
  lines.push('');
  if (signals) {
    lines.push(summarizeSignals(signals));
    lines.push('');
  }
  const r = (reasons && typeof reasons === 'object') ? reasons : {};
  for (let n = 1; n <= 7; n++) {
    const entries = derived.evidence[`step_${n}`];
    const gen = generated[`step_${n}`];
    lines.push(`── step_${n} ─────────────────────`);
    if (!entries || entries.length === 0) {
      lines.push(`  evidence: (none — 留白)`);
      if (gen) lines.push(`  ⚠️ unexpected: gen present without evidence`);
      lines.push('');
      continue;
    }
    lines.push(`  evidence: ${entries.length} 筆`);
    entries.forEach((e, i) => {
      const q = (e.quote === null) ? '(null — quote dropped or missing)' : e.quote;
      lines.push(`    [${i}] type=${e.type}, quote=${q}`);
    });
    if (gen?.brain_state) {
      lines.push(`  brain_state.description: ${gen.brain_state.description}`);
      lines.push(`  brain_state.quote: ${gen.brain_state.quote ?? '(null)'}`);
    } else {
      const bsReason = r[`step_${n}.brain_state`];
      lines.push(`  brain_state: (null — ${bsReason || 'LLM fail / scrub-empty / no-safe-quote'})`);
    }
    if (gen?.sovereign_action) {
      lines.push(`  sovereign_action: ${gen.sovereign_action}`);
    } else {
      const saReason = r[`step_${n}.sovereign_action`];
      lines.push(`  sovereign_action: (null — ${saReason || 'insufficient personalization / rigidity-at-self / no internal-control declaration'})`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ────────────────────────────────────────────────────────────────
// Per-student: derive + generate + (commit OR report).
//
// Deps (injected for test-ability):
//   - loadStudent(studentId)  → row | null
//   - loadSessions(studentId) → sessions[]
//   - loadUpe(studentId)      → upe | null
//   - writeBackfill(studentId, payload) → void  (only called if !dryRun)
//   - genBrainState({stepNo, evidenceEntries})  → result | null
//   - genSovereignAction({stepNo, ctx})         → result | null
//   - log(msg) / report(block)
// ────────────────────────────────────────────────────────────────
export async function backfillOneStudent(studentId, deps) {
  const { loadStudent, loadSessions, loadUpe,
          writeBackfill, genBrainState, genSovereignAction,
          log, report, dryRun } = deps;

  const studentRow = await loadStudent(studentId);
  if (!studentRow) {
    log(`[skip] ${studentId} — student row not found`);
    return { studentId, skipped: 'not-found' };
  }

  const sessions = await loadSessions(studentId);
  const upe      = await loadUpe(studentId);

  const signals = composeSignals(studentRow, sessions, upe);
  const derived = deriveScJourneyFromHistory(signals);

  // For each populated step, call J2 + J3 (走既有 helper, 不另寫生成).
  // 6/12 — 每步包 capture-log: 把 generate* 內部 log 的「具體 null 原因」
  // 攔下塞進 reasons map, 之後給 formatStudentReport 印出 (Patrick 診斷需求).
  // generate* 仍正常 fail-soft (回 null), 邏輯 0 動.
  const generated = {};
  const reasons = {};
  for (let n = 1; n <= 7; n++) {
    const entries = derived.evidence[`step_${n}`];
    if (!entries || entries.length === 0) continue;
    let brainState = null;
    let sovereignAction = null;

    const bsLogs = [];
    const captureBs = (m) => { bsLogs.push(m); log(m); };
    try {
      brainState = await genBrainState({
        stepNo: n,
        evidenceEntries: entries,
        log: captureBs,  // ← caller-wins log (deps wrapper spread 順序保證)
      });
    } catch (err) {
      const m = `[${studentId}][step_${n}] brain_state threw: ${err?.message || err}`;
      bsLogs.push(m); log(m);
    }
    if (brainState === null) {
      reasons[`step_${n}.brain_state`] = summarizeNullReason(bsLogs);
    }

    const saLogs = [];
    const captureSa = (m) => { saLogs.push(m); log(m); };
    try {
      sovereignAction = await genSovereignAction({
        stepNo: n,
        ctx: {
          activeContext:  signals.activeContext,
          surfacedValues: signals.surfacedValues,
          stepEvidence:   entries,
        },
        log: captureSa,  // ← caller-wins log
      });
    } catch (err) {
      const m = `[${studentId}][step_${n}] sovereign_action threw: ${err?.message || err}`;
      saLogs.push(m); log(m);
    }
    if (sovereignAction === null) {
      reasons[`step_${n}.sovereign_action`] = summarizeNullReason(saLogs);
    }

    generated[`step_${n}`] = {
      brain_state:      brainState,
      sovereign_action: sovereignAction,
    };
  }

  // Compose sc_storyboard payload (per migration 038 shape: keyed by step_N).
  const steps = {};
  for (let n = 1; n <= 7; n++) {
    const entries = derived.evidence[`step_${n}`];
    const gen = generated[`step_${n}`];
    if (!entries || entries.length === 0) {
      steps[`step_${n}`] = { state: 'empty', brain_state: null, sovereign_action: null };
      continue;
    }
    steps[`step_${n}`] = {
      state: 'filled',
      brain_state:      gen?.brain_state      ?? null,
      sovereign_action: gen?.sovereign_action ?? null,
    };
  }
  const scStoryboard = { module: 'self', currentStep: derived.step, steps };

  // Output OR commit.
  if (dryRun) {
    report(formatStudentReport({ studentId, signals, derived, generated, reasons }));
  } else {
    log(`[${studentId}] writing — sc_journey_step=${derived.step} stepsWithEvidence=${Object.keys(steps).filter(k => steps[k].state === 'filled').length}`);
    await writeBackfill(studentId, {
      sc_journey_evidence: derived.evidence,
      sc_journey_step:     derived.step,
      sc_storyboard:       scStoryboard,
    });
  }

  return {
    studentId,
    derived,
    generated,
    committed: !dryRun,
  };
}

// ────────────────────────────────────────────────────────────────
// runBackfill — public entry. Deps injected for testability.
// ────────────────────────────────────────────────────────────────
export async function runBackfill(deps) {
  const { listTargets, log, report, dryRun } = deps;
  log(`[backfill] mode=${dryRun ? 'DRY-RUN' : 'COMMIT'}`);
  const targets = await listTargets();
  log(`[backfill] targets=${targets.length}`);
  if (dryRun) report(`backfill-storyboard report — generated ${new Date().toISOString()}\nmode=DRY-RUN, targets=${targets.length}\n`);

  const results = [];
  for (const studentId of targets) {
    try {
      const result = await backfillOneStudent(studentId, deps);
      results.push(result);
    } catch (err) {
      log(`[${studentId}] FAILED: ${err?.message || err}`);
      results.push({ studentId, error: String(err?.message || err) });
    }
  }
  log(`[backfill] done — processed=${results.length} ` +
      `errors=${results.filter(r => r.error).length}`);
  return results;
}

// ════════════════════════════════════════════════════════════════
// CLI wrapper (run only when invoked as script, not when imported).
// ════════════════════════════════════════════════════════════════

function loadDotenv() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}

function printUsage() {
  console.log(`Usage: node scripts/backfill-storyboard.js [options]

Default: DRY-RUN — read + derive + LLM generate + write a report file. NO DB writes.

Options:
  --commit               Actually write to DB. Vivi-only on prod (CC/Patrick never run this).
  --dry-run              Force dry-run (default).
  --student <id>         Run only for this student_id (e.g. A003).
  --report <path>        Path for the dry-run report (default: ./backfill-report.txt).
  --help, -h             Show this help.

Env:
  DATABASE_URL           Neon connection string.
  ANTHROPIC_API_KEY      Anthropic API key.

Examples:
  node scripts/backfill-storyboard.js --dry-run --student A003
  node scripts/backfill-storyboard.js --dry-run
  node scripts/backfill-storyboard.js --commit                     # Vivi runs this`);
}

// Build the real-DB / real-LLM deps for CLI execution.
function buildCliDeps({ sql, anthropic, args }) {
  const dryRun = args.dryRun;
  const callAnthropic = callAnthropicWithRetry;

  // Report buffer — only persisted at the end.
  const reportBuf = [];
  const log = (msg) => console.log(msg);
  const report = (block) => reportBuf.push(block);

  const listTargets = async () => {
    if (args.studentId) {
      // Single-student — still confirm they match the eligibility filter,
      // so we don't accidentally backfill a non-beta / blocked account.
      const rows = await sql`
        SELECT student_id FROM students
         WHERE student_id = ${args.studentId}
           AND plan = 'plan_a'
           AND is_beta = TRUE
           AND (is_blocked IS NOT TRUE)
        LIMIT 1
      `;
      return rows.map(r => r.student_id);
    }
    const rows = await sql`
      SELECT student_id FROM students
       WHERE plan = 'plan_a'
         AND is_beta = TRUE
         AND (is_blocked IS NOT TRUE)
       ORDER BY student_id ASC
    `;
    return rows.map(r => r.student_id);
  };

  const loadStudent = async (studentId) => {
    const rows = await sql`
      SELECT student_id,
             active_context_category, active_context_name, active_context_definition,
             sc_journey_evidence, sc_journey_step, sc_storyboard
        FROM students
       WHERE student_id = ${studentId}
       LIMIT 1
    `;
    return rows[0] || null;
  };

  const loadSessions = async (studentId) => {
    const rows = await sql`
      SELECT id, day, session_state
        FROM sessions
       WHERE student_id = ${studentId}
       ORDER BY day ASC, created_at ASC
    `;
    return rows;
  };

  const loadUpe = async (studentId) => {
    const rows = await sql`
      SELECT active_context_session_summary, daily_takeaways
        FROM user_profile_evolution
       WHERE student_id = ${studentId}
       LIMIT 1
    `;
    return rows[0] || null;
  };

  const writeBackfill = async (studentId, payload) => {
    await sql`
      UPDATE students
         SET sc_journey_evidence = ${JSON.stringify(payload.sc_journey_evidence)}::jsonb,
             sc_journey_step     = ${payload.sc_journey_step},
             sc_storyboard       = ${JSON.stringify(payload.sc_storyboard)}::jsonb
       WHERE student_id = ${studentId}
    `;
  };

  // 6/12 — opts spread LAST so caller-supplied log (per-step capture in
  // backfillOneStudent) overrides default. Required for diagnostic reasons map.
  const genBrainState = (opts) => generateBrainState({
    anthropic,
    callAnthropicWithRetry: callAnthropic,
    log,
    ...opts,
  });
  const genSovereignAction = (opts) => generateSovereignAction({
    anthropic,
    callAnthropicWithRetry: callAnthropic,
    log,
    ...opts,
  });

  return {
    dryRun, log, report, listTargets,
    loadStudent, loadSessions, loadUpe, writeBackfill,
    genBrainState, genSovereignAction,
    _flushReport: () => {
      if (!dryRun) return;
      const out = reportBuf.join('\n');
      mkdirSync(dirname(resolve(process.cwd(), args.reportPath)), { recursive: true });
      writeFileSync(resolve(process.cwd(), args.reportPath), out, 'utf8');
      console.log(`[backfill] dry-run report written → ${args.reportPath}`);
    },
  };
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printUsage(); return; }
  loadDotenv();
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL not set');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }
  if (!args.dryRun) {
    console.log('⚠️  --commit mode: this will UPDATE production rows.');
    console.log('   Vivi-only. CC/Patrick do not run this against prod.');
    console.log('   Proceeding in 3s … (Ctrl-C to abort)');
    await new Promise(r => setTimeout(r, 3000));
  }
  const sql = neon(process.env.DATABASE_URL);
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const deps = buildCliDeps({ sql, anthropic, args });
  await runBackfill(deps);
  deps._flushReport();
}

// Only run main() when invoked directly, not when imported.
// (Windows path needs file:// + decode handling.)
const invokedDirect = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`
        || import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`;
  } catch { return false; }
})();
if (invokedDirect) {
  main().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
  });
}
