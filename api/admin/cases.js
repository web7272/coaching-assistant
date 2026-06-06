// api/admin/cases.js
// Daniel 6/5 客服 ticketing — minimal admin API.
//
// Endpoints (single-file dispatch per existing repo convention; bracket-routing
// is not used elsewhere here, so we keep PATCH on the same path with case_id
// supplied via ?case_id= query param to mirror the GET filter shape):
//
//   POST   /api/admin/cases                        — create case, returns case_id
//   GET    /api/admin/cases?[student_id|status|email|case_id]  — list / filter
//   PATCH  /api/admin/cases?case_id=SY-...         — update status/notes/resolved_at
//
// Auth: requireAdmin (x-admin-token header OR ?token= query == ADMIN_TOKEN env).
//       Daniel client MUST send header `x-admin-token: <ADMIN_TOKEN>`
//       (NOT `Authorization: Bearer ...`, NOT ADMIN_API_TOKEN env).
//
// case_id format: SY-YYYYMMDD-NNN (台北時區 daily 流水, see lib/api/case-id.js).
//
// 🛑 鐵律 #2 諮商保密: cases 是 metadata only (email/subject/status/notes).
//    notes 由 Daniel 寫進去,不含學員原話 transcript. 之後若需要 transcript link,
//    用 case.student_id JOIN sessions — 本 endpoint 不做.

import { neon } from '@neondatabase/serverless';
import { requireAdmin } from '../../lib/auth/require-admin.js';
import {
  tryGenerateAndInsert,
  CASE_CATEGORIES, CASE_STATUSES,
} from '../../lib/api/case-id.js';

export const config = {
  maxDuration: 10,
};

// Test seam — inject mock sql.
let _sql = null;
export function _setSqlClient(client) { _sql = client; }
function getSql() {
  if (_sql) return _sql;
  return neon(process.env.DATABASE_URL);
}

// ─── Request parsing helpers ─────────────────────────────

function trimStr(v) {
  return typeof v === 'string' ? v.trim() : '';
}

function isValidCaseId(s) {
  // SY-YYYYMMDD-NNN — 8 digits, dash, ≥1 digit (we pad to 3 but accept longer).
  return typeof s === 'string' && /^SY-\d{8}-\d{3,}$/.test(s);
}

// ─── Method dispatch ─────────────────────────────────────

export default async function handler(req, res) {
  const method = req.method || 'GET';
  if (!['GET', 'POST', 'PATCH'].includes(method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Auth gate — same shape as feature-flag-toggle.js.
  const user = await requireAdmin(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  // ⚠️ getSql() is lazy — passed as a getter rather than the live client. This
  // lets pre-DB validation (400s) short-circuit without instantiating neon()
  // (which throws on malformed/missing DATABASE_URL even before any query
  // runs — would break test environments).
  try {
    if (method === 'POST')  return await handlePost(req, res, getSql);
    if (method === 'GET')   return await handleGet(req, res, getSql);
    if (method === 'PATCH') return await handlePatch(req, res, getSql);
  } catch (e) {
    console.error('[admin/cases] error:', e?.message || e);
    return res.status(500).json({ error: 'admin_cases_failed', detail: e?.message });
  }
}

// ─── POST — create case ──────────────────────────────────

async function handlePost(req, res, getSqlFn) {
  const body = req.body || {};
  const email = trimStr(body.email).toLowerCase();
  if (!email) {
    return res.status(400).json({ error: 'EMAIL_REQUIRED' });
  }
  // Permissive email shape check — defense, not validation. (Daniel's client
  // already verified the inbound message.)
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: 'EMAIL_INVALID', email });
  }

  // Category enum validation — default 'other' if missing; reject unknown enum.
  let category = trimStr(body.category) || 'other';
  if (!CASE_CATEGORIES.includes(category)) {
    return res.status(400).json({
      error: 'CATEGORY_INVALID',
      allowed: CASE_CATEGORIES,
      received: body.category,
    });
  }

  const row = {
    email,
    gmail_thread_id: trimStr(body.gmail_thread_id) || null,
    subject:         trimStr(body.subject) || null,
    student_id:      trimStr(body.student_id).toUpperCase() || null,
    category,
  };

  const sql = getSqlFn();
  const inserted = await tryGenerateAndInsert(sql, row);
  // Structured log — 鐵律 #2 no raw email body / subject (only hashes? for now
  // we emit the case_id + category enum + student_id; email is the conversation
  // partner per Daniel's workflow, surfaced to Vivi anyway via admin queries).
  console.info('[admin/cases][created]', JSON.stringify({
    event: 'case_created',
    case_id: inserted.case_id,
    category,
    student_id: row.student_id,
    attempts: inserted.attempts,
  }));
  return res.status(201).json({
    case_id: inserted.case_id,
    created_at: inserted.created_at,
  });
}

// ─── GET — list / filter ─────────────────────────────────

async function handleGet(req, res, getSqlFn) {
  const studentIdFilter = trimStr(req.query?.student_id).toUpperCase();
  const statusFilter    = trimStr(req.query?.status);
  const emailFilter     = trimStr(req.query?.email).toLowerCase();
  const caseIdFilter    = trimStr(req.query?.case_id);
  const limit           = Math.min(500, Math.max(1, Number(req.query?.limit) || 100));

  if (statusFilter && !CASE_STATUSES.includes(statusFilter)) {
    return res.status(400).json({
      error: 'STATUS_INVALID',
      allowed: CASE_STATUSES,
      received: req.query.status,
    });
  }

  // Pull all rows ordered by created_at desc, then JS-filter (mirrors
  // api/admin/students.js pattern — admin endpoint, small dataset, avoids
  // dynamic SQL composition; cases table is indexed on student_id/status/email
  // so even at scale the SELECT is cheap).
  const sql = getSqlFn();
  const rows = await sql`
    SELECT case_id, email, gmail_thread_id, subject, student_id, category,
           status, notes, created_at, resolved_at
      FROM cases
     ORDER BY created_at DESC
     LIMIT ${limit}
  `;

  let filtered = rows;
  if (caseIdFilter) {
    filtered = filtered.filter(r => r.case_id === caseIdFilter);
  }
  if (studentIdFilter) {
    filtered = filtered.filter(r => (r.student_id || '').toUpperCase() === studentIdFilter);
  }
  if (emailFilter) {
    filtered = filtered.filter(r => (r.email || '').toLowerCase() === emailFilter);
  }
  if (statusFilter) {
    filtered = filtered.filter(r => r.status === statusFilter);
  }

  return res.status(200).json({ cases: filtered, count: filtered.length });
}

// ─── PATCH — update status / notes / resolved_at ─────────

async function handlePatch(req, res, getSqlFn) {
  const caseId = trimStr(req.query?.case_id);
  if (!caseId) {
    return res.status(400).json({ error: 'CASE_ID_REQUIRED' });
  }
  if (!isValidCaseId(caseId)) {
    return res.status(400).json({ error: 'CASE_ID_INVALID', received: caseId });
  }

  const body = req.body || {};
  const updates = {};

  if (body.status !== undefined) {
    const s = trimStr(body.status);
    if (!CASE_STATUSES.includes(s)) {
      return res.status(400).json({
        error: 'STATUS_INVALID',
        allowed: CASE_STATUSES,
        received: body.status,
      });
    }
    updates.status = s;
  }
  if (body.notes !== undefined) {
    updates.notes = typeof body.notes === 'string' ? body.notes : null;
  }
  if (body.resolved_at !== undefined) {
    // Accept ISO string or null. Server-time auto-fill happens below if status
    // → 'resolved' but caller didn't supply.
    if (body.resolved_at !== null) {
      const t = new Date(body.resolved_at);
      if (Number.isNaN(t.getTime())) {
        return res.status(400).json({ error: 'RESOLVED_AT_INVALID', received: body.resolved_at });
      }
      updates.resolved_at = t.toISOString();
    } else {
      updates.resolved_at = null;
    }
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'NO_FIELDS_TO_UPDATE' });
  }

  const sql = getSqlFn();

  // Auto-fill resolved_at when status transitions to 'resolved' and caller
  // didn't explicitly set it.
  const autoResolvedAt = updates.status === 'resolved'
    && updates.resolved_at === undefined;

  // Per-field update — keep SQL parameterized via separate UPDATE chains. neon
  // tagged-template doesn't support easy dynamic SET clauses, so we run one
  // UPDATE per supplied field. For 1-3 fields per PATCH this is trivial.
  // Atomicity within a single request is fine (no concurrent same-case PATCH
  // in Daniel workflow).
  let updatedRow = null;
  if (updates.status !== undefined) {
    const r = await sql`
      UPDATE cases
         SET status = ${updates.status}
       WHERE case_id = ${caseId}
       RETURNING case_id, email, gmail_thread_id, subject, student_id, category,
                 status, notes, created_at, resolved_at
    `;
    if (r.length === 0) return res.status(404).json({ error: 'CASE_NOT_FOUND', case_id: caseId });
    updatedRow = r[0];
  }
  if (updates.notes !== undefined) {
    const r = await sql`
      UPDATE cases SET notes = ${updates.notes}
       WHERE case_id = ${caseId}
       RETURNING case_id, email, gmail_thread_id, subject, student_id, category,
                 status, notes, created_at, resolved_at
    `;
    if (r.length === 0) return res.status(404).json({ error: 'CASE_NOT_FOUND', case_id: caseId });
    updatedRow = r[0];
  }
  if (updates.resolved_at !== undefined) {
    const r = await sql`
      UPDATE cases SET resolved_at = ${updates.resolved_at}
       WHERE case_id = ${caseId}
       RETURNING case_id, email, gmail_thread_id, subject, student_id, category,
                 status, notes, created_at, resolved_at
    `;
    if (r.length === 0) return res.status(404).json({ error: 'CASE_NOT_FOUND', case_id: caseId });
    updatedRow = r[0];
  }
  if (autoResolvedAt) {
    const r = await sql`
      UPDATE cases SET resolved_at = NOW()
       WHERE case_id = ${caseId} AND resolved_at IS NULL
       RETURNING case_id, email, gmail_thread_id, subject, student_id, category,
                 status, notes, created_at, resolved_at
    `;
    if (r.length > 0) updatedRow = r[0];
  }

  // 404 catch: if updates.status absent BUT all other paths returned 0 rows.
  if (!updatedRow) {
    // Last-resort SELECT to differentiate "no update" from "no case_id match".
    const exists = await sql`SELECT 1 FROM cases WHERE case_id = ${caseId}`;
    if (exists.length === 0) {
      return res.status(404).json({ error: 'CASE_NOT_FOUND', case_id: caseId });
    }
    const r = await sql`
      SELECT case_id, email, gmail_thread_id, subject, student_id, category,
             status, notes, created_at, resolved_at
        FROM cases WHERE case_id = ${caseId}
    `;
    updatedRow = r[0];
  }

  console.info('[admin/cases][updated]', JSON.stringify({
    event: 'case_updated',
    case_id: caseId,
    fields: Object.keys(updates),
    auto_resolved_at: autoResolvedAt,
  }));

  return res.status(200).json({ case: updatedRow });
}
