// api/finalize-day.js
// v5.0 PR-4c：Damon Note + Notebook + per-week summary + Day 21 結業 async 生成 endpoint
//
// 用途：api/chat.js 在 dayComplete 時不阻塞主回應、frontend 拿到 notesGenerating:true 後
// fire POST /api/finalize-day 觸發 Damon Note 生成（+ 7/14/21 週報、+ Day 21 結業 / export）。
//
// PR-4c 變更：
//   - request 入參 sessionDay (1-21)、week = ceil(sessionDay/7) 由後端算
//   - 週報觸發從 v4 day===6 改 sessionDay ∈ {7,14,21}
//   - 仍接收 legacy week+day 過渡相容（v5 7 天週映射）
//   - response shape 對齊 docs/v5-spec/engineering/07-pr4c §3-B
//
// 設計：
// - 幂等：該天的 daily Damon Note + notebook_page 已存在 → 直接 return
// - Pro plan 60s timeout（Damon Note + Notebook + 週報 + Day 21 結業 + export call、加總仍 < 60s）

import { neon } from '@neondatabase/serverless';
import Anthropic from '@anthropic-ai/sdk';
import { generateDamonNote } from './chat.js';

// Anthropic SDK（lazy、跟 chat.js 對齊、test-friendly）
let _anthropic = null;
function getAnthropic() {
  if (_anthropic) return _anthropic;
  _anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  return _anthropic;
}

// Vercel Pro 預設 60s、明寫保險
export const config = {
  maxDuration: 60,
};

// ════════════════════════════════════════════════════════════════
// PR-4c v5 day numbering — pure helpers（chat orchestration + tests 用）
// ════════════════════════════════════════════════════════════════

/**
 * Resolve sessionDay (1-21) from PR-4c request body.
 *   - PR-4c shape：{ sessionDay: number }（preferred）
 *   - legacy：    { week, day } → 映射 (week-1)*7 + day
 *
 * @param {object} body
 * @returns {number|null}  1..N（無上限、validation 由 caller 做）；null 表無法 resolve
 */
export function resolveSessionDay(body = {}) {
  const { sessionDay, week, day } = body || {};
  if (typeof sessionDay === 'number' && Number.isFinite(sessionDay) && sessionDay >= 1) {
    return Math.floor(sessionDay);
  }
  if (week != null && day != null) {
    const w = parseInt(week);
    const d = parseInt(day);
    if (Number.isFinite(w) && Number.isFinite(d) && w >= 1 && d >= 1) {
      return (w - 1) * 7 + d;
    }
  }
  return null;
}

/** v5：sessionDay → 1-indexed week (1,2,3). */
export function weekFromSessionDay(sessionDay) {
  return Math.ceil(sessionDay / 7);
}

/** 週報觸發點：sessionDay ∈ {7, 14, 21}（07 §3-B 拍板）。 */
export function isWeekBoundary(sessionDay) {
  return sessionDay === 7 || sessionDay === 14 || sessionDay === 21;
}

/** Day 21 = graduation。 */
export function isGraduationDay(sessionDay) {
  return sessionDay === 21;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { sessionId, module } = req.body || {};
  if (!sessionId || !module) {
    return res.status(400).json({ error: 'Missing required fields: sessionId, module' });
  }

  // PR-4c：sessionDay 1-21（preferred）；過渡接 legacy week+day（v5 7 天週映射）
  const sessionDay = resolveSessionDay(req.body || {});
  if (!sessionDay || sessionDay < 1 || sessionDay > 21) {
    return res.status(400).json({ error: 'Missing or invalid sessionDay (1-21)' });
  }
  const week = weekFromSessionDay(sessionDay);
  const day = sessionDay;
  const weekBoundary = isWeekBoundary(sessionDay);
  const graduation = isGraduationDay(sessionDay);

  try {
    const sql = neon(process.env.DATABASE_URL);

    // 取現有 session 狀態（幂等檢查 + 需要 student_id）
    const sessionRows = await sql`
      SELECT id, student_id, damon_note_public, notebook_page, day_complete
      FROM sessions WHERE id = ${sessionId} LIMIT 1
    `;
    if (sessionRows.length === 0) {
      return res.status(404).json({ error: 'SESSION_NOT_FOUND' });
    }
    const existing = sessionRows[0];

    // 幂等檢查：該天 daily note 已生成 + notebook_page 已寫 → 直接 return
    const existingNote = await sql`
      SELECT 1 FROM damon_notes
      WHERE student_id = ${existing.student_id}
        AND module = ${module}
        AND week = ${week}
        AND day = ${day}
        AND is_week_summary = false
      LIMIT 1
    `;
    if (existingNote.length > 0 && existing.notebook_page) {
      return res.status(200).json({
        ok: true,
        alreadyDone: true,
        damonNotePublic: existing.damon_note_public,
        notebookPage: existing.notebook_page,  // v4 index.html 過渡期仍讀（07 §3-B updated）
        isWeekBoundary: weekBoundary,
        isGraduation: graduation,
      });
    }

    // chat.js 已 set day_complete=TRUE，此處保險（finalize 直接被呼叫的 case）
    if (!existing.day_complete) {
      await sql`UPDATE sessions SET day_complete = TRUE, updated_at = NOW() WHERE id = ${sessionId}`;
    }

    // Damon Note + yesterdaySCHypothesis lookup + Notebook page（內含的既有實作）
    const noteResult = await generateDamonNote(sql, sessionId, module, week, day);
    if (!noteResult) {
      return res.status(500).json({ error: 'NOTE_GENERATION_FAILED' });
    }

    // ============================================================
    // PR-4c：週報觸發從 day===6 改 sessionDay ∈ {7, 14, 21}
    // - summary row 寫進 damon_notes（is_week_summary=true）
    // - UNIQUE (student_id, module, week, day, is_week_summary) → daily + summary 共存於同天
    // - fail-soft：summary 失敗不阻塞 daily return
    // ============================================================
    if (weekBoundary) {
      try {
        await generateWeekSummary(sql, existing.student_id, module, week, sessionDay);
      } catch (e) {
        console.error('[week-summary] generation failed (fail-soft):', e.message);
      }
    }

    // TODO PR-4c P0-4：sessionDay === 21 → 生結業內容 + export-personal-coach-prompt → email
    //                  finalize-day 每天 append daily_takeaways（user_profile_evolution）
    //                  本 PR (PR-4c-1) 範圍：只接通 v5 numbering + 週報邊界；
    //                  daily_takeaways + 結業 export 留 PR-4c-2（migration 016 之後）。

    return res.status(200).json({
      ok: true,
      alreadyDone: false,
      damonNotePublic: noteResult.publicNote,
      notebookPage: noteResult.notebookPage,  // v4 index.html 過渡期仍讀（07 §3-B updated）
      isWeekBoundary: weekBoundary,
      isGraduation: graduation,
    });

  } catch (e) {
    console.error('finalize-day error:', e);
    return res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
}

// ════════════════════════════════════════════════════════════════
// generateWeekSummary —
// 在 sessionDay ∈ {7,14,21} 邊界跑完 daily Damon Note 後、撈該週 daily notes、
// Anthropic 濃縮成 per-week summary、寫進 damon_notes (is_week_summary=true)。
//
// PR-4c 改動：
//   - summary row 的 `day` 欄位從 hardcoded 6 → summaryRowDay 參數（boundary 7/14/21）
//   - prompt 加一行「第一行給一個 ≤12 字主題短句」（07 §3-E：GET /api/week-report.title 來源）
// 對應 slim.js KEY_FIELDS_ALWAYS（關鍵句 / SC 觀察 / 還沒碰到的）+ 該週 conditional 欄位
// ════════════════════════════════════════════════════════════════
async function generateWeekSummary(sql, studentId, module, week, summaryRowDay) {
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

  // 2. 該週採集的 conditional 欄位提醒（依 week 動態、v4.0 6天週遺留語意；
  //    v5.0 Damon Note prompt 重新設計留未來 task、PR-4c 不改）
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

  // 3. summary prompt（PR-4c：第一行加主題短句、供 GET /api/week-report .title）
  const summaryPrompt = `以下是學員 ${module} 模組 Week ${week} 的 ${weekDailyNotes.length} 天 Damon Note。
請濃縮成 1 份 per-week summary。

⚠️ 格式：第一行請給一個 ≤12 字的主題短句（不加標點、無引號、單獨成行）、之後空一行、再開始 body。
範例第一行：「從不能停，到可以決定」

之後 body 保留以下欄位（依該週採集情況）：

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
  const response = await getAnthropic().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: summaryPrompt }],
  });
  const summaryText = response.content[0].text;

  // 5. INSERT INTO damon_notes (..., is_week_summary=true)
  // UNIQUE (student_id, module, week, day, is_week_summary)
  // 同天 daily (false) + summary (true) 兩 row 共存
  await sql`
    INSERT INTO damon_notes (student_id, module, week, day, note_text, is_week_summary)
    VALUES (${studentId}, ${module}, ${week}, ${summaryRowDay}, ${summaryText}, true)
    ON CONFLICT (student_id, module, week, day, is_week_summary)
    DO UPDATE SET note_text = EXCLUDED.note_text, updated_at = NOW()
  `;

  console.log(`[week-summary] generated for ${studentId} ${module} W${week} day=${summaryRowDay} (${summaryText.length} chars)`);
}
