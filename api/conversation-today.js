// api/conversation-today.js
// GET /api/conversation-today?module=self
//
// PR-4c-green Patrick 5/25 (Day-4 實測 C2) — 對話到一半關視窗重開續上.
//
// 還原當天「尚未結束」(day_complete = FALSE) 的 conversation messages，
// 讓 student.js 在 state.conversation 為空時可以 fetch-before-kickoff、
// 不會在已開始的 session 上再 emit 起手式（v4 鬼打牆還魂）。
//
// 鐵則 1d (Patrick 5/24)：學員端點 studentId 一律從 session cookie 取、
// 完全忽略 client 傳的 ?studentId。本檔不收 studentId query 參數.
//
// Response shape (strict — 對應 student.js renderConversation 還原邏輯):
//   { hasInProgress: true,  messages: [{role:'user'|'assistant', content:string}], sessionId, day }
//   { hasInProgress: false, messages: [], sessionId: null, day: null }
//
//   day_complete = TRUE 的 session → hasInProgress: false (今天已結束、不還原)
//   完全沒有 session → hasInProgress: false (新的一天、走 kickoff)
//   day_complete = FALSE 但無 user/assistant message → hasInProgress: false (走 kickoff)

import { neon } from '@neondatabase/serverless';
import { guardStudentOr401 } from '../lib/auth/student-session.js';

// Test seam — inject a mock tag-template sql client.
let _sql = null;
export function _setSqlClient(client) { _sql = client; }
function getSql() {
  if (_sql) return _sql;
  return neon(process.env.DATABASE_URL);
}

export const maxDuration = 10;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  // 鐵則 1d — sid from cookie ONLY. Query studentId 完全忽略.
  const studentId = await guardStudentOr401(req, res);
  if (!studentId) return;

  const module = String(req.query?.module || 'self').trim();
  const today  = String(req.query?.today  || new Date().toLocaleDateString('sv')).trim();

  try {
    const sql = getSql();

    // 找今天尚未結束 (day_complete = FALSE) 的 session.
    // 一個學員一天最多一筆 session（schema 上有 UNIQUE on student_id+module+session_date）.
    const rows = await sql`
      SELECT id, day, day_complete
      FROM sessions
      WHERE student_id = ${studentId}
        AND module = ${module}
        AND session_date = ${today}
        AND day_complete = FALSE
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (rows.length === 0) {
      // 新的一天 / 今天已結束 → 沒有未完成 session 要還原.
      return res.status(200).json({
        hasInProgress: false, messages: [], sessionId: null, day: null,
      });
    }

    const sessionId = rows[0].id;
    const day = rows[0].day;

    // 取所有 user/assistant message、依時間排序 (system / closure / damon_note rows 排除).
    const messages = await sql`
      SELECT role, content
      FROM messages
      WHERE session_id = ${sessionId}
        AND role IN ('user', 'assistant')
      ORDER BY created_at ASC, question_number ASC, id ASC
    `;

    if (messages.length === 0) {
      // session row 存在但沒任何 user/assistant message → 視同新的一天、走 kickoff.
      return res.status(200).json({
        hasInProgress: false, messages: [], sessionId: null, day: null,
      });
    }

    // 只回 {role, content} — frontend appendMessage 只用這兩個 field.
    const cleanMessages = messages.map(m => ({ role: m.role, content: m.content }));

    return res.status(200).json({
      hasInProgress: true,
      messages: cleanMessages,
      sessionId,
      day,
    });
  } catch (e) {
    console.error('[conversation-today] error:', e);
    return res.status(500).json({ error: 'Server error' });
  }
}
