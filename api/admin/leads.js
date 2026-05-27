// api/admin/leads.js
// Patrick 5/26 — Daniel (客服 / lead 經營 agent) 查分群、出封測者每人進度.
// 對應「Patrick - 產品開發/Daniel建置藍圖-客服+Lead經營.md」§3.
//
// GET /api/admin/leads[?segment=<seg>]   coach-gated, 唯讀.
//
// Response: { leads: [{ email, segment, current_day, plan, is_beta, created_at }] }
//
// 分群規則：
//   ① pdf_lead     — leads 表有但 students 沒有 (PDF 索取但沒進試用).
//   ② trial_active — students.plan='trial' 且 created_at 在 24h 內.
//   ③ trial_lapsed — students.plan='trial' 且 created_at 超過 24h.
//   ④ purchased    — students.plan IN ('plan_a','plan_b').
//
// 🛑 安全 / 鐵律 #2 諮商保密：
//   只回上面那幾個欄位.絕不回 damon_note / damon_note_public / SC 觀察 / Layer.
//   只讀 (GET only)、不寫任何 row.

import { neon } from '@neondatabase/serverless';
import { guardCoachOr401 } from '../../lib/auth/coach-session.js';

export const maxDuration = 10;

// Test seam — inject mock sql.
let _sql = null;
export function _setSqlClient(client) { _sql = client; }
function getSql() {
  if (_sql) return _sql;
  return neon(process.env.DATABASE_URL);
}

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  // guardCoachOr401 回 boolean (內部已 res.status(401)).
  if (!(await guardCoachOr401(req, res))) return;

  try {
    const sql = getSql();
    // 兩支獨立 query — 失敗任一支整段炸 → catch → 500. 不分開 try (簡單)。
    const leads    = await sql`SELECT email, option, created_at FROM leads`;
    const students = await sql`
      SELECT student_id, email, plan, current_day, is_beta, created_at FROM students
    `;

    const studentByEmail = new Map();
    for (const s of students) {
      const key = String(s.email || '').toLowerCase().trim();
      if (key) studentByEmail.set(key, s);
    }

    const now = Date.now();
    const rows = [];

    // ① pdf_lead — 在 leads、未進 students.
    for (const l of leads) {
      const key = String(l.email || '').toLowerCase().trim();
      if (key && !studentByEmail.has(key)) {
        rows.push({
          email: l.email,
          segment: 'pdf_lead',
          current_day: null,
          plan: null,
          is_beta: false,
          created_at: l.created_at,
        });
      }
    }

    // ②③④ students 依 plan + 24h 視窗.
    for (const s of students) {
      let segment;
      if (s.plan === 'plan_a' || s.plan === 'plan_b') {
        segment = 'purchased';
      } else if (s.plan === 'trial') {
        const ageMs = now - new Date(s.created_at).getTime();
        segment = ageMs <= DAY_MS ? 'trial_active' : 'trial_lapsed';
      } else {
        segment = 'other';
      }
      rows.push({
        email: s.email,
        segment,
        current_day: s.current_day ?? null,
        plan: s.plan,
        is_beta: !!s.is_beta,
        created_at: s.created_at,
      });
    }

    // 可選過濾 ?segment=<seg>
    const want = typeof req.query?.segment === 'string' ? req.query.segment.trim() : '';
    const out = want ? rows.filter(r => r.segment === want) : rows;
    return res.status(200).json({ leads: out });
  } catch (e) {
    console.error('[admin/leads] error:', e?.message || e);
    return res.status(500).json({ error: 'admin_leads_failed' });
  }
}
