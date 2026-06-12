// api/admin/backfill-storyboard.js
// v5.3 件3 (6/12) — admin-gated backfill endpoint for 舊封測者頁Y.
//
// Wraps the VALIDATED core (scripts/backfill-storyboard.js exports
// backfillOneStudent + composeSignals + formatStudentReport; pure derivation
// in lib/api/sc-storyboard-backfill.js; LLM 走 lib/api/sc-storyboard-gen.js
// J2/J3 helper). 0 重寫推導 / 生成 — endpoint 只組 deps + 呼叫 core.
//
// Endpoints (single-file dispatch):
//   GET  /api/admin/backfill-storyboard                  — 列出 eligible 學員
//   POST /api/admin/backfill-storyboard?student=<id>[&commit=true]
//                                                       — backfill 單一學員
//
// Auth: requireAdmin (x-admin-token header == ADMIN_API_TOKEN env, 同
//   api/admin/cases.js pattern). 401 if absent/wrong.
//
// 🔴 安全鐵則:
//   1. dryRun 預設 true. 只 ?commit=true 才真寫 DB.
//   2. 對象限制: plan='plan_a' AND is_beta=TRUE AND (is_blocked IS NOT TRUE).
//      非 eligible → 400 STUDENT_NOT_ELIGIBLE (不浪費 LLM call, 防誤跑).
//   3. report / log 不含 raw 對話全文 — 沿用核心 (formatStudentReport 已鎖).
//   4. token 走 header (x-admin-token), 不放 URL query (require-admin 兩種
//      都認, 但 UI 走 header).
//
// maxDuration: 60 — 單一學員 ~5 步 × 2 生成 ≈ 10 次 LLM call. 10s 不夠.
//   一次只處理一個學員, batch 由前端 sequential 打 N 次 request 達成.

import { neon } from '@neondatabase/serverless';
import Anthropic from '@anthropic-ai/sdk';
import { requireAdmin } from '../../lib/auth/require-admin.js';
import { callAnthropicWithRetry } from '../../lib/api/anthropic-retry.js';
import {
  generateBrainState,
  generateSovereignAction,
} from '../../lib/api/sc-storyboard-gen.js';
import { backfillOneStudent } from '../../scripts/backfill-storyboard.js';

export const config = { maxDuration: 60 };

// Test seams (mirror api/admin/cases.js).
let _sql = null;
let _anthropic = null;
let _callAnthropic = null;
export function _setSqlClient(c)        { _sql = c; }
export function _setAnthropicClient(c)  { _anthropic = c; }
export function _setCallAnthropic(fn)   { _callAnthropic = fn; }
function getSql() {
  if (_sql) return _sql;
  return neon(process.env.DATABASE_URL);
}
function getAnthropic() {
  if (_anthropic) return _anthropic;
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}
function getCallAnthropic() {
  return _callAnthropic || callAnthropicWithRetry;
}

// ────────────────────────────────────────────────────────────────
// Eligible target list — plan_a + is_beta + 非 blocked. 對齊
// scripts/backfill-storyboard.js buildCliDeps listTargets.
// ────────────────────────────────────────────────────────────────
async function fetchEligibleList(sql) {
  const rows = await sql`
    SELECT student_id FROM students
     WHERE plan = 'plan_a'
       AND is_beta = TRUE
       AND (is_blocked IS NOT TRUE)
     ORDER BY student_id ASC
  `;
  return rows.map(r => r.student_id);
}

async function checkEligible(sql, studentId) {
  const rows = await sql`
    SELECT student_id FROM students
     WHERE student_id = ${studentId}
       AND plan = 'plan_a'
       AND is_beta = TRUE
       AND (is_blocked IS NOT TRUE)
     LIMIT 1
  `;
  return rows.length > 0;
}

// ────────────────────────────────────────────────────────────────
// Compose deps for backfillOneStudent. Same SQL shape as CLI's
// buildCliDeps — keep data-access inline here (not shared via helper) to
// keep this endpoint self-contained + easy to mock.
// ────────────────────────────────────────────────────────────────
function composeDeps({ sql, anthropic, callAnthropic, dryRun, log, report }) {
  const loadStudent = async (sid) => {
    const rows = await sql`
      SELECT student_id,
             active_context_category, active_context_name, active_context_definition,
             sc_journey_evidence, sc_journey_step, sc_storyboard
        FROM students
       WHERE student_id = ${sid}
       LIMIT 1
    `;
    return rows[0] || null;
  };
  const loadSessions = async (sid) => {
    const rows = await sql`
      SELECT id, day, session_state
        FROM sessions
       WHERE student_id = ${sid}
       ORDER BY day ASC, created_at ASC
    `;
    return rows;
  };
  const loadUpe = async (sid) => {
    const rows = await sql`
      SELECT active_context_session_summary, daily_takeaways
        FROM user_profile_evolution
       WHERE student_id = ${sid}
       LIMIT 1
    `;
    return rows[0] || null;
  };
  const writeBackfill = async (sid, payload) => {
    await sql`
      UPDATE students
         SET sc_journey_evidence = ${JSON.stringify(payload.sc_journey_evidence)}::jsonb,
             sc_journey_step     = ${payload.sc_journey_step},
             sc_storyboard       = ${JSON.stringify(payload.sc_storyboard)}::jsonb
       WHERE student_id = ${sid}
    `;
  };
  // 6/12 — opts spread LAST so caller (backfillOneStudent per-step capture)
  // can override default log for diagnostic null-reason capture.
  const genBrainState = (opts) => generateBrainState({
    anthropic, callAnthropicWithRetry: callAnthropic, log, ...opts,
  });
  const genSovereignAction = (opts) => generateSovereignAction({
    anthropic, callAnthropicWithRetry: callAnthropic, log, ...opts,
  });
  return {
    dryRun, log, report,
    loadStudent, loadSessions, loadUpe, writeBackfill,
    genBrainState, genSovereignAction,
  };
}

// ────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const method = (req.method || 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await requireAdmin(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const sql = getSql();

  try {
    if (method === 'GET') {
      // List eligible. No LLM, read-only, cheap.
      const list = await fetchEligibleList(sql);
      return res.status(200).json({
        ok: true,
        count: list.length,
        students: list,
      });
    }

    // POST — backfill one student.
    const studentId = String(req.query?.student || '').trim();
    if (!studentId) {
      return res.status(400).json({ error: 'STUDENT_REQUIRED' });
    }
    const commitRaw = String(req.query?.commit || '').toLowerCase();
    const dryRun = !(commitRaw === 'true' || commitRaw === '1');

    // Eligibility gate BEFORE running anything (0 LLM call wasted on rejected target).
    const eligible = await checkEligible(sql, studentId);
    if (!eligible) {
      return res.status(400).json({
        error: 'STUDENT_NOT_ELIGIBLE',
        detail: 'backfill 只對 plan_a + is_beta + 非 blocked 學員',
        student: studentId,
      });
    }

    const logs = [];
    const reports = [];
    const log = (m) => {
      logs.push(m);
      console.warn('[admin/backfill]', m);
    };
    const report = (b) => reports.push(b);

    const deps = composeDeps({
      sql,
      anthropic: getAnthropic(),
      callAnthropic: getCallAnthropic(),
      dryRun, log, report,
    });

    const result = await backfillOneStudent(studentId, deps);

    if (result?.skipped) {
      return res.status(404).json({
        ok: false,
        skipped: result.skipped,
        student: studentId,
      });
    }

    return res.status(200).json({
      ok: true,
      dryRun,
      student: studentId,
      committed: !!result?.committed,
      step: result?.derived?.step ?? null,
      report: reports.join('\n'),
    });
  } catch (err) {
    console.error('[admin/backfill] error:', err?.message || err);
    return res.status(500).json({
      error: 'backfill_failed',
      detail: err?.message || String(err),
    });
  }
}
