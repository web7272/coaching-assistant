// api/conversation-today.js
// GET /api/conversation-today?module=self
//
// PR-4c-green Patrick 5/25 (Day-4 實測 C2) — 對話到一半關視窗重開續上.
// 5/29 Patrick (A008 case fix) — 不再用 session_date 做 strict equality 過濾;
//   原本 client 送 ?today=YYYY-MM-DD 跟 DB session_date 對不上 (client TZ 漂、
//   或 session_date 寫入時段邊界 race) → 整段對話「不見」. iphwang214 5/27 17:04-17:14
//   存了 17 句但 session_date='2026-05-28' (實際是 5/27), 用戶以為對話消失.
//   修法: 改成「該學員最近一筆 day_complete=FALSE」, 跨日仍能 restore.
//   學員若想「重新開始」 走 finalize-day 收尾 + journey 切下一天, 不該靠
//   日期過濾把昨天未完成的對話藏起來.
//
// 鐵則 1d (Patrick 5/24)：學員端點 studentId 一律從 session cookie 取、
// 完全忽略 client 傳的 ?studentId。本檔不收 studentId query 參數.
//
// Response shape (strict — 對應 student.js renderConversation 還原邏輯):
//   { hasInProgress: true,  messages: [{role:'user'|'assistant', content:string}], sessionId, day }
//   { hasInProgress: false, messages: [], sessionId: null, day: null }
//
//   最近一筆 day_complete = FALSE → hasInProgress: true (還原該 session messages)
//   完全沒有 day_complete=FALSE 的 session → hasInProgress: false (走 kickoff)
//   有 day_complete=FALSE 但無 user/assistant message → hasInProgress: false (走 kickoff)

import { neon } from '@neondatabase/serverless';
import { guardStudentOr401 } from '../lib/auth/student-session.js';
// 5/29 Patrick (Vivi access gate) — is_blocked 入口檢查.
// 6/13 Patrick (Vivi 政策反轉) — is_beta=true 凌駕一切 (self-heal 老自動鎖);
//   移除 30 天 window 自動鎖整段 (相關函式已從 access-gate.js 拆掉).
import { isBlocked, BLOCKED_RESPONSE } from '../lib/api/access-gate.js';

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
  // 5/29 Patrick — `today` query 不再被使用 (A008 fix, 見檔頭). 保留只為兼容
  // 接收 (student.js 還在送、之後 cleanup 一起拿掉、別貿然在這層 reject 觸發
  // 其他 edge case).
  void req.query?.today;

  try {
    const sql = getSql();

    // 5/29 Patrick — access gate: blocked → 403.
    // 6/13 Patrick (Vivi 政策反轉) — is_beta=true 凌駕 (含 self-heal 老自動鎖案例).
    //   撈一次 students 取 is_blocked / is_beta 給 gate 用. created_at 不再需要
    //   (window 已移除). isBetaPass=true → 跳過 isBlocked gate.
    try {
      const sr = await sql`
        SELECT is_blocked, is_beta FROM students
         WHERE student_id = ${studentId} LIMIT 1
      `;
      if (sr.length > 0) {
        const studentRow = sr[0];
        const isBetaPass = studentRow.is_beta === true;
        if (isBlocked(studentRow) && !isBetaPass) {
          return res.status(403).json(BLOCKED_RESPONSE);
        }
      }
    } catch (gateErr) {
      // Gate 自己 SQL 失敗 → fail-open (寧可放行 restore 也不誤鎖).
      console.warn('[conversation-today] access gate failed (fail-open):', gateErr?.message || gateErr);
    }

    // 5/29 Patrick (A008 case) — 找該學員最近一筆 day_complete=FALSE session,
    // 不再 strict equality 過濾 session_date. ORDER BY created_at DESC LIMIT 1
    // 保證跨日仍能 restore 真正未結束的對話 (iphwang214 5/27 那段就在這裡被找回).
    const rows = await sql`
      SELECT id, day, day_complete
      FROM sessions
      WHERE student_id = ${studentId}
        AND module = ${module}
        AND day_complete = FALSE
      ORDER BY created_at DESC
      LIMIT 1
    `;

    if (rows.length === 0) {
      // 沒有任何 day_complete=FALSE 的 session → 全新學員 / 全部都收尾過了 → 走 kickoff.
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
