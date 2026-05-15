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
import Anthropic from '@anthropic-ai/sdk';
import { generateDamonNote } from './chat.js';

// v4.0 Phase 6: Anthropic SDK 用於 Day 6 per-week summary 生成
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Vercel Pro 預設 60s、明寫保險
// （Damon Note + Notebook 兩個 call ~15-25s、Phase 6 Day 6 多 1 個 summary call ~5-10s、加總仍 < 60s）
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

    // 取現有 session 狀態（幂等檢查 + Phase 6 需要 student_id）
    const sessionRows = await sql`
      SELECT id, student_id, damon_note_public, notebook_page, day_complete
      FROM sessions WHERE id = ${sessionId} LIMIT 1
    `;
    if (sessionRows.length === 0) {
      return res.status(404).json({ error: 'SESSION_NOT_FOUND' });
    }
    const existing = sessionRows[0];

    // v4.0 Phase 6.1: 幂等檢查改讀 damon_notes 表
    // （Phase 5.0c blocker 1 a 後 sessions.damon_note 不再寫、舊 check `existing.damon_note &&` 永遠 false、
    //  每次 finalize-day call 都重跑 generateDamonNote、浪費 Anthropic call。改 check damon_notes 表 + notebook_page。）
    const existingNote = await sql`
      SELECT 1 FROM damon_notes
      WHERE student_id = ${existing.student_id}
        AND module = ${module}
        AND week = ${parseInt(week)}
        AND day = ${parseInt(day)}
        AND is_week_summary = false
      LIMIT 1
    `;
    if (existingNote.length > 0 && existing.notebook_page) {
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

    // ============================================================
    // v4.0 Phase 6: Day 6 per-week summary 生成
    // - 跑完既有 Damon Note + Notebook 後、額外跑一個 summary call
    // - 寫進 damon_notes（is_week_summary=true）、跟 daily note (is_week_summary=false) UNIQUE 區分、可共存於 day=6
    // - fail-soft：summary 失敗不影響既有 day complete return
    // ============================================================
    if (parseInt(day) === 6) {
      try {
        await generateWeekSummary(sql, existing.student_id, module, parseInt(week));
      } catch (e) {
        console.error('[week-summary] generation failed (fail-soft、不阻塞 day complete):', e.message);
      }
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

// ════════════════════════════════════════════════════════════════
// v4.0 Phase 6: generateWeekSummary
// Day 6 跑完 Damon Note 後、撈該週 daily notes、Anthropic 濃縮成 per-week summary、寫進 damon_notes
// 對應 slim.js KEY_FIELDS_ALWAYS（關鍵句 / SC 觀察 / 還沒碰到的）+ 該週 conditional 欄位
// 跨週後 slim.js buildSlimDamonContext 讀 is_week_summary=true 那筆（不是 6 天 daily 全部）
// ════════════════════════════════════════════════════════════════
async function generateWeekSummary(sql, studentId, module, week) {
  // 1. 撈該週 daily Damon Note（is_week_summary=false）
  const weekDailyNotes = await sql`
    SELECT day, note_text FROM damon_notes
    WHERE student_id = ${studentId} AND module = ${module}
      AND week = ${week} AND is_week_summary = false
    ORDER BY day ASC
  `;

  if (weekDailyNotes.length === 0) {
    console.warn(`[week-summary] no daily notes for ${studentId} ${module} W${week}, skip`);
    return;
  }

  // 2. 該週採集的 conditional 欄位提醒（依 week 動態）
  let conditionalHint = '';
  if (week === 1) {
    conditionalHint = '【Scope 證據】（Week 1 採集的具體事件原文、Week 3 Day 3 調用）';
  } else if (week === 2) {
    conditionalHint = '【賦予新角色狀態】（Day 3 完成的整合：已答應 / 卡點 / 新角色名稱）';
  } else if (week === 3) {
    conditionalHint = `【確定類別 + Scope】（D3）
【Transfer 結果】（D4、新 SC 句 + 評分變化 + 時間軸渲染感受）
【微證據 + 反例預演結果】（D5）
【宣言】（D6、完整宣言句 + 「你現在是誰？」原文）`;
  }

  // 3. summary prompt（無 system、整段塞 user message、Advisor Phase 6 spec）
  const summaryPrompt = `以下是學員 ${module} 模組 Week ${week} 的 ${weekDailyNotes.length} 天 Damon Note。
請濃縮成 1 份 per-week summary、保留以下欄位（依該週採集情況）：

【關鍵句】本週最有能量的 1-2 句、原文加引號
【SC 觀察】本週 SC 輪廓、走到哪一層、反覆出現的詞（用「可能」「假設」「猜想」緩衝詞）
【還沒碰到的】下週入口

${conditionalHint}

要求：
- 不重複每天細節、不寫流水帳、只保留跨日連續性的脈絡
- 保留學員原話的引用（加引號）
- SC 觀察是假設、不是判斷
- 總長度 ~500-700 字（max_tokens 1024、~1500 tokens 中文）

該週 ${weekDailyNotes.length} 天 Damon Notes：

${weekDailyNotes.map(n => `[Day ${n.day}]\n${n.note_text}`).join('\n\n---\n\n')}`;

  // 4. Anthropic SDK call
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: summaryPrompt }],
  });
  const summaryText = response.content[0].text;

  // 5. INSERT INTO damon_notes (..., is_week_summary=true)
  // UNIQUE (student_id, module, week, day, is_week_summary)
  // day=6 可同時有 daily (is_week_summary=false) + summary (is_week_summary=true) 兩 row
  await sql`
    INSERT INTO damon_notes (student_id, module, week, day, note_text, is_week_summary)
    VALUES (${studentId}, ${module}, ${week}, 6, ${summaryText}, true)
    ON CONFLICT (student_id, module, week, day, is_week_summary)
    DO UPDATE SET note_text = EXCLUDED.note_text, updated_at = NOW()
  `;

  console.log(`[week-summary] generated for ${studentId} ${module} W${week} (${summaryText.length} chars)`);
}
