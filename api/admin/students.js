// api/admin/students.js
// Patrick 5/29 — Daniel 客服 / Vivi 查學員即時狀態. 解 stale-snapshot 問題:
// 封測 9 人就 5/28 寫的快照 5/29 就過時 (Kylie 分到「還沒登入」 實際已走 Day 1).
//
// GET /api/admin/students[?email=…&student_id=…&status=…&is_beta=…&is_blocked=…]
//   coach-gated (同 /api/admin/leads), 唯讀, 純 DB query 不燒 LLM token.
//
// Response: { ok:true, count, students: [{ student_id, email, …, is_at_risk }] }
//
// 🛑 鐵則 #2 諮商保密:
//   絕不回 damon_note / damon_note_public / messages content / SC 觀察 / Layer.
//   只回 metadata + derived status. SELECT 不含敏感欄位 (test grep guard).

import { neon } from '@neondatabase/serverless';
// 5/30 Patrick — dual-auth: 教練 cookie OR ADMIN_API_TOKEN Bearer (Daniel Cowork).
// guardAdminOr401 cookie 路徑優先 early-return, 失敗 fallback Bearer + timing-safe compare.
// 範圍只開「唯讀 GET admin endpoint」 — 其他 admin endpoint 仍 cookie-only.
import { guardAdminOr401 } from '../../lib/api/admin-auth.js';
import {
  shapeStudentRow, applyStatusFilter, parseBoolQuery, STATUS_FILTERS,
} from '../../lib/api/admin-students.js';

export const maxDuration = 10;

// Test seam — inject mock sql.
let _sql = null;
export function _setSqlClient(client) { _sql = client; }
function getSql() {
  if (_sql) return _sql;
  return neon(process.env.DATABASE_URL);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const auth = await guardAdminOr401(req, res);
  if (!auth) return;
  // 5/30 Patrick — log Bearer auth 成功事件給追蹤頻率 (不 log token 本身).
  // cookie 路徑不 log 避免噪音 (browser 一頁 fetch 多次).
  if (auth.via === 'bearer') {
    console.info('[admin/students][bearer-auth]', JSON.stringify({
      event: 'admin_bearer_auth',
      endpoint: '/api/admin/students',
      ts: new Date().toISOString(),
    }));
  }

  // 5/29 Patrick — query 參數全部 client-side string、用 helper normalize.
  const emailFilter      = typeof req.query?.email === 'string' ? req.query.email.trim().toLowerCase() : '';
  const studentIdFilter  = typeof req.query?.student_id === 'string'
    ? req.query.student_id.trim().toUpperCase() : '';
  const statusFilter     = typeof req.query?.status === 'string' ? req.query.status.trim() : '';
  const isBetaFilter     = parseBoolQuery(req.query?.is_beta);
  const isBlockedFilter  = parseBoolQuery(req.query?.is_blocked);

  try {
    const sql = getSql();

    // 一條 query 撈所有 student + derived aggregates. 之後在 JS post-process
    // 套 status + is_beta + is_blocked + email/student_id filter (dataset ~1000+
    // 學員仍 <50KB, 簡單可審計, 避免 dynamic SQL 拼接 injection 風險).
    //
    // ⚠️ 時區: Asia/Taipei. NOW() AT TIME ZONE 'Asia/Taipei' 取台北日期, 跟
    // chat.js / journey.js 既有日界算法一致 (lib/session/day-boundary.js).
    // 'days_since' 用 ::date - ::date (calendar-day diff, 跨月份正確).
    //
    // 🛑 SELECT 只取 metadata. 絕不取 messages.content / damon_notes.note_text /
    // session_state details / SC 觀察 / Layer. test grep guard 鎖住.
    const rows = await sql`
      SELECT
        s.student_id,
        s.email,
        s.preferred_name,
        s.pace,
        s.is_beta,
        s.is_blocked,
        s.created_at,
        -- ⭐ v5.2 第一塊: active_context_* (Vivi 後台清單顯示 + 詳情頁編輯).
        s.active_context_category,
        s.active_context_name,
        s.active_context_definition,
        ((NOW() AT TIME ZONE 'Asia/Taipei')::date
         - (s.created_at AT TIME ZONE 'Asia/Taipei')::date)::int
          AS days_since_register,
        COALESCE(MAX(sess.day), 0) AS last_unlocked_day,
        MAX(sess.updated_at) AS last_session_at,
        CASE WHEN MAX(sess.updated_at) IS NULL THEN NULL
             ELSE ((NOW() AT TIME ZONE 'Asia/Taipei')::date
                   - (MAX(sess.updated_at) AT TIME ZONE 'Asia/Taipei')::date)::int
        END AS days_since_last_session,
        BOOL_OR(sess.day = 21 AND sess.day_complete = TRUE) AS finished_21,
        MAX(CASE WHEN sess.day = 21 AND sess.day_complete = TRUE
                 THEN sess.updated_at END) AS finished_at
      FROM students s
      LEFT JOIN sessions sess ON sess.student_id = s.student_id
      GROUP BY s.student_id, s.email, s.preferred_name, s.pace,
               s.is_beta, s.is_blocked, s.created_at,
               s.active_context_category, s.active_context_name, s.active_context_definition
      ORDER BY s.student_id
    `;

    // Shape + filter.
    let shaped = rows.map(shapeStudentRow).filter(Boolean);

    if (emailFilter) {
      shaped = shaped.filter(r => (r.email || '').toLowerCase() === emailFilter);
    }
    if (studentIdFilter) {
      shaped = shaped.filter(r => r.student_id === studentIdFilter);
    }
    if (isBetaFilter !== undefined) {
      shaped = shaped.filter(r => r.is_beta === isBetaFilter);
    }
    if (isBlockedFilter !== undefined) {
      shaped = shaped.filter(r => r.is_blocked === isBlockedFilter);
    }
    if (statusFilter) {
      // 未知 status string → applyStatusFilter 是 no-op (回原 rows).
      shaped = applyStatusFilter(shaped, statusFilter);
    }

    return res.status(200).json({
      ok: true,
      count: shaped.length,
      students: shaped,
    });
  } catch (e) {
    console.error('[admin/students] error:', e?.message || e);
    return res.status(500).json({ error: 'admin_students_failed' });
  }
}

// re-export shape for tests that want to assert filter names exist.
export { STATUS_FILTERS };
