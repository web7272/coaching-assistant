// api/finalize-day.js
// v34 hotfix 4 (Option C)：Day 6 收尾 Damon Note + Notebook async 生成 endpoint
//
// 用途：api/chat.js 在 dayComplete 時不再阻塞主回應、改由 frontend 拿到 notesGenerating: true 後
// fire POST /api/finalize-day 觸發實際的 Damon Note + Notebook 生成。
//
// 設計：
// - 幂等：如果該 session 已經有 damon_note、直接 return 既有結果、不重跑 Anthropic
// - Pro plan 60s timeout 容得下兩個 Sonnet 4.6 call（~15-25s）
// - 失敗時 frontend 可以 retry、學員下次打開該 Day 也可由前端 lazy 觸發

import { neon } from '@neondatabase/serverless';
import { generateDamonNote } from './chat.js';

// Vercel Pro 預設 60s、明寫保險（與 Anthropic 兩個 call 加總 ~15-25s 對齊）
export const config = {
  maxDuration: 60,
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sessionId, module, week, day } = req.body || {};
  if (!sessionId || !module || week == null || day == null) {
    return res.status(400).json({ error: 'Missing required fields: sessionId, module, week, day' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    // 取現有 session 狀態（幂等檢查）
    const sessionRows = await sql`
      SELECT id, damon_note, damon_note_public, notebook_page, day_complete
      FROM sessions WHERE id = ${sessionId} LIMIT 1
    `;
    if (sessionRows.length === 0) {
      return res.status(404).json({ error: 'SESSION_NOT_FOUND' });
    }
    const existing = sessionRows[0];

    // 幂等：已生成過、直接回現有
    if (existing.damon_note && existing.notebook_page) {
      return res.status(200).json({
        ok: true,
        alreadyDone: true,
        damonNotePublic: existing.damon_note_public,
        notebookPage: existing.notebook_page,
      });
    }

    // 雖然 chat.js 已經 set day_complete=TRUE，這層也保險一下（finalize 直接被呼叫的 case）
    if (!existing.day_complete) {
      await sql`UPDATE sessions SET day_complete = TRUE, updated_at = NOW() WHERE id = ${sessionId}`;
    }

    // 觸發完整生成（內含 Damon Note + yesterdaySCHypothesis lookup + Notebook page）
    const noteResult = await generateDamonNote(sql, sessionId, module, parseInt(week), parseInt(day));

    if (!noteResult) {
      return res.status(500).json({ error: 'NOTE_GENERATION_FAILED' });
    }

    return res.status(200).json({
      ok: true,
      alreadyDone: false,
      damonNotePublic: noteResult.publicNote,
      notebookPage: noteResult.notebookPage,
    });

  } catch (e) {
    console.error('finalize-day error:', e);
    return res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
}
