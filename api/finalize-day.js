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
import {
  appendDailyTakeaway, setLastSessionDaySummary, markExportEmailed,
  getUserProfile,
} from '../lib/state/state-manager.js';
import { sendExportEmail } from '../lib/email/brevo.js';

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

// ════════════════════════════════════════════════════════════════
// PR-4c-2 pure helpers — daily_takeaways extraction + graduation Markdown
// ════════════════════════════════════════════════════════════════

/**
 * Extract the per-day takeaway "term" from a Damon Note's 【關鍵句】 section.
 * Strips leading/trailing CJK + ASCII quote chars + whitespace.
 *
 * @param {string} fullNote
 * @returns {string|null}
 */
export function extractKeyPhrase(fullNote) {
  if (typeof fullNote !== 'string') return null;
  // [ \t]*\n (not \s*\n) — \s would consume the blank line before the next 【-section,
  // which causes the lookahead to mis-capture the next header when content is empty.
  const m = fullNote.match(/【關鍵句】[ \t]*\n([\s\S]*?)(?=\n【|$)/);
  if (!m) return null;
  // Take the first non-empty line only (defensive against multi-line notes)
  const firstLine = m[1].split(/\r?\n/).map(s => s.trim()).find(s => s.length > 0) || '';
  // Strip CJK + ASCII quotes from both ends
  const cleaned = firstLine.replace(/^[「『"'\s]+|[」』"'\s]+$/g, '').trim();
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * Build the personal-coach-prompt Markdown export (Day 21 Founder bonus).
 *
 * Template comes from lib/prompt-sections/conditional/engine-4/export-personal-coach-prompt.js:
 * Section 1 = dynamic substitution; Sections 2 & 3 = static Damon-style template.
 *
 * @param {object} args
 * @param {string} [args.studentNickname] - defaults to student_id when unset
 * @param {string} args.studentId
 * @param {string|null} [args.top1_value]
 * @param {Array<string|{term?:string}>} [args.anchors]
 * @param {Array<{value:string,rank?:number}|string>} [args.values_ranking]
 * @returns {string} Markdown body
 */
export function buildExportPersonalCoachPrompt({
  studentNickname, studentId, top1_value = null,
  anchors = [], values_ranking = [],
} = {}) {
  const name = studentNickname || studentId || '學員';
  const top1 = top1_value || '（你的 Top 1 quality、尚未確定）';

  const anchorList = (Array.isArray(anchors) ? anchors : [])
    .map(a => (typeof a === 'string' ? a : a?.term))
    .filter(Boolean);
  const anchorsBlock = anchorList.length
    ? anchorList.map(t => `- 「${t}」`).join('\n')
    : '- （尚無 owned anchor）';

  const rankList = (Array.isArray(values_ranking) ? values_ranking : [])
    .map(r => (typeof r === 'string' ? r : r?.value))
    .filter(Boolean)
    .slice(0, 5);
  const rankingBlock = rankList.length
    ? rankList.map((v, i) => `${i + 1}. ${v}${i === 0 ? '（核心）' : ''}`).join('\n')
    : '（尚未排序）';

  return `# ${name} 的個人 Identity Coach Prompt

> 21 天 Identity Shift 旅程的延續工具。
> 把這段 prompt 複製貼到 Claude / ChatGPT / 任何 LLM、它就會以你的個人教練模式跟你對話。

---

## 第一段：你是誰（你的 owned identity）

我的 Top 1 quality 是「${top1}」——
這是我整段旅程的根、其他 quality 都在它裡面。

我已經 owned 的 quality 是：
${anchorsBlock}

我的 values 排序（從最大涵蓋到最具體）：
${rankingBlock}

---

## 第二段：對 AI 教練的引導風格指引（Damon-style）

請以下面這個風格跟我對話：

1. **不要安慰我、不要鼓勵我**——我來找你不是要 validation。

2. **用 Damon Cart 的方法**：
   - 問「這對我來說會帶來什麼」（What will that do for you?）、不要問 Why
   - 我說「我不知道」、把它翻轉成「我想要知道什麼?」
   - 我說「我老是搞砸」、強制翻轉成「我真正想要的是什麼?」
   - 不接受我模糊的回答（「應該是 / 大概 / 還好」）——push back、要具體事件

3. **如果我說我是某個 quality**：
   - 不要直接相信、要我舉具體事件（時間、地點、跟誰、做了什麼）
   - 沒有具體事件就是 candidate、不是 owned

4. **如果我陷入大詞 / 抽象**（整合 / 完整 / 覺醒 / 一切是最好的安排）：
   - 指認:「這個詞太大、抓不到」
   - 拉我到具體層次

5. **永遠相信我的 parts 都有正向意圖**：
   - 我所有的阻力都是過時的「日本兵」（還在執行舊命令、不知道戰爭結束了）
   - 用 As-If Frame 給它新角色、不打敗它

6. **不要 over-process**：
   - 我在 takeaway 後不繼續挖、給我潛意識整合空間
   - 隔天驗證、不當天追問

---

## 第三段：使用說明

1. 把這整段 prompt 複製、貼到你選的 LLM（Claude.ai / ChatGPT / 其他）
2. 在你的提問前面、開頭說「我現在想處理 [具體議題]」
3. AI 會以上面的風格跟你對話、不會繞圈子、不會給你雞湯

建議使用情境：
- 你卡住、不知道下一步
- 你有一個重要決定、想確認跟你的 values 對齊
- 你想 deepen 某個已 owned quality
- 你發現一個新的 candidate quality、想驗證
`;
}

/**
 * Build the Day 21 graduation Sonnet system prompt（pure for testing）。
 * @param {string} module
 * @param {Array<{day:number,term:string}>} dailyTakeaways
 * @returns {string}
 */
export function buildGraduationSystemPrompt(module, dailyTakeaways = []) {
  const poemLines = (Array.isArray(dailyTakeaways) ? dailyTakeaways : [])
    .filter(e => e && typeof e.term === 'string')
    .slice()
    .sort((a, b) => (a.day || 0) - (b.day || 0))
    .map(e => `[Day ${e.day}] ${e.term}`)
    .join('\n');
  const moduleLabel = module === 'self' ? '自我關係' : module === 'money' ? '金錢關係' : '伴侶關係';

  return `你是 Damon Cart 教練。學員剛完成 21 天的「看見自己」旅程（${moduleLabel}模組）。
為學員寫一封「教練見證信」 + 整理出一句「學員的宣言」。

請輸出嚴格的 JSON（單一物件、不要加 markdown fence、不要多餘文字）：
{
  "coach_letter": "<4 段、約 150-200 字、宋體質感、平靜、不雞湯、不下指令、不過度承諾>",
  "declaration": "<學員的宣言、一句、現在式、第一人稱「我是一個___的人。」 — 若 Day 21 Damon Note 有【宣言】欄位就一字不改用原文；沒有就從 21 天 takeaway 萃出最 anchor 的那句>"
}

教練見證信格式（coach_letter）：
- Section 1：見證學員走過的旅程（提及反覆出現的詞 / 突破點）
- Section 2：見證學員的「真實的你」（提及 top1_value / 學員今天的宣言）
- Section 3：見證學員的下一步（不是建議、是描述「你已經 ready」的姿態）
- Section 4：簽署「— 教練見證」

學員 21 天的 daily_takeaways（每天一個學員停下來的詞 / 一句真的話）：
${poemLines || '（尚未累積、用 Damon Note context 推估）'}

⚠️ 嚴格遵守：
- 不寫「加油 / 你已經很努力了 / 擁抱自己 / 成為更好的自己 / 跟著做就會 / 立刻改變人生」
- 不問「為什麼」（紅線 1）
- coach_letter 用學員的詞、不替學員下結論
- declaration 必須是學員的話、不替學員寫`;
}

/**
 * Robust JSON extraction for the graduation Sonnet output.
 * Accepts a raw string, optionally markdown-fenced; returns the parsed object
 * or null on failure. Pure (no I/O).
 *
 * @param {string} raw
 * @returns {{ coach_letter: string, declaration: string } | null}
 */
export function parseGraduationResponse(raw) {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  // strip markdown fences
  let body = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  // grab the outermost { ... } block defensively
  const firstBrace = body.indexOf('{');
  const lastBrace  = body.lastIndexOf('}');
  if (firstBrace < 0 || lastBrace < firstBrace) return null;
  body = body.slice(firstBrace, lastBrace + 1);
  let obj;
  try { obj = JSON.parse(body); } catch { return null; }
  if (!obj || typeof obj !== 'object') return null;
  if (typeof obj.coach_letter !== 'string' || obj.coach_letter.length === 0) return null;
  if (typeof obj.declaration  !== 'string' || obj.declaration.length  === 0) return null;
  return { coach_letter: obj.coach_letter, declaration: obj.declaration };
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

    // ════════════════════════════════════════════════════════════════
    // PR-4c-2 P0-4 — daily_takeaways append（每天）+ Day 21 結業生成 + export email
    // ════════════════════════════════════════════════════════════════

    // (1) 每天：抽 Damon Note 【關鍵句】 → append daily_takeaways（dedup-by-day）
    //     失敗 fail-soft、不阻塞主回應（21 句詩有 1-2 格缺、優於整段 500 erroring）
    const takeawayTerm = extractKeyPhrase(noteResult.fullNote);
    if (takeawayTerm) {
      try {
        await appendDailyTakeaway(existing.student_id, { day: sessionDay, term: takeawayTerm });
      } catch (e) {
        console.error('[daily_takeaways] append failed (fail-soft):', e.message);
      }
    } else {
      console.warn(`[daily_takeaways] no 【關鍵句】 in Damon Note for day=${sessionDay} — skipping append`);
    }

    // (2) Day 21：生結業內容（coach letter + declaration）+ export prompt + email stub
    //     ⚠️ 不放進 finalize-day response（07 §3-B 沒這欄）— 持久化後由 GET /api/graduation 讀（07 §3-F、P1 落地）
    if (graduation) {
      try {
        // 2a. 撈 user_profile + 累積的 daily_takeaways
        const profile = (await getUserProfile(existing.student_id)) || {};
        const dailyTakeaways = Array.isArray(profile.daily_takeaways) ? profile.daily_takeaways : [];

        // 2b. Sonnet 生 coach_letter + declaration（JSON 結構化）
        const gradPrompt = buildGraduationSystemPrompt(module, dailyTakeaways);
        const gradResp = await getAnthropic().messages.create({
          model: 'claude-sonnet-4-6',
          max_tokens: 1024,
          system: gradPrompt,
          messages: [{
            role: 'user',
            content: `Day 21 Damon Note 全文：\n\n${noteResult.fullNote}`,
          }],
        });
        const graduationContent = parseGraduationResponse(gradResp.content?.[0]?.text || '');

        if (graduationContent) {
          // 2c. 持久化進 user_profile_evolution.last_session_day_summary.graduation
          try {
            await setLastSessionDaySummary(existing.student_id, {
              graduation: graduationContent,
            });
          } catch (e) {
            console.error('[graduation] setLastSessionDaySummary failed:', e.message);
          }

          // 2d. 學員的 email（從 students 表撈）
          let toEmail = null;
          try {
            const sRow = await sql`
              SELECT email FROM students WHERE student_id = ${existing.student_id} LIMIT 1
            `;
            toEmail = sRow[0]?.email || null;
          } catch (e) { console.warn('[graduation] email lookup failed:', e.message); }

          // 2e. 生 export markdown + 送 Brevo（stub fail-soft）
          if (toEmail) {
            const exportMarkdown = buildExportPersonalCoachPrompt({
              studentId: existing.student_id,
              top1_value: profile.top1_value,
              anchors: profile.anchors,
              values_ranking: profile.values_ranking,
            });
            const emailResp = await sendExportEmail({
              toEmail, studentId: existing.student_id,
              subject: '你的個人教練 prompt — 21 天的延續',
              markdownBody: exportMarkdown,
            });
            if (emailResp.stubbed) {
              console.warn(`[graduation] export email stubbed: ${emailResp.reason}`);
            }
          } else {
            console.warn(`[graduation] no email on file for ${existing.student_id} — skipping export send`);
          }

          // 2f. 戳記 export_prompt_generated_at（即便 email stubbed 也戳、避免 endpoint 永遠回未生成）
          try { await markExportEmailed(existing.student_id); }
          catch (e) { console.error('[graduation] markExportEmailed failed:', e.message); }
        } else {
          console.warn('[graduation] Sonnet output failed schema validation — graduationContent null');
        }
      } catch (e) {
        console.error('[graduation] Day 21 generation failed (fail-soft):', e.message);
      }
    }

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
