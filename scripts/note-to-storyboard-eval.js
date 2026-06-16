#!/usr/bin/env node
// scripts/note-to-storyboard-eval.js
// READ-ONLY eval — generate the 7-step SC storyboard FROM a student's Damon
// Notes (synthesised daily coach notes) instead of per-turn observer evidence,
// so we can compare quality. 0 DB writes.
//
// 🔴 A006-SI safety (defence-in-depth, never trusts a single layer):
//   1. PRE-SCRUB: every note sentence matching the high-risk denylist (or
//      containsForbiddenContent) is dropped BEFORE it reaches the LLM prompt —
//      the model never sees SI/dark lines.
//   2. POST-GATE: each generated brain_state / sovereign_action runs through the
//      SAME gates as J2/J3 (scrubBrainStateText = denylist + sanitize +
//      forbidden) + sovereign must end with an internal-control declaration and
//      must NOT point rigidity at the learner. Fail → null (留白).
//   3. Raw note_text is NEVER written to the report / logs — only the gated
//      output + enumerated meta (note count / dates / #pre-scrubbed sentences).
//   4. The workflow runs an additional SI leak-guard on the report file and
//      deletes it before rendering if any SI substring slips through.
//
// Usage: node scripts/note-to-storyboard-eval.js --student=A006
//          [--model=claude-sonnet-4-6] [--report=path]
// Env: DATABASE_URL, ANTHROPIC_API_KEY.

import { neon } from '@neondatabase/serverless';
import Anthropic from '@anthropic-ai/sdk';
import { callAnthropicWithRetry } from '../lib/api/anthropic-retry.js';
import {
  SC_STEP_DEFINITIONS,
  SC_STORYBOARD_HIGH_RISK_PATTERNS,
  SOVEREIGN_ACTION_PROTOTYPES,
  SELF_CONTROL_DECLARATION_PATTERNS,
  RIGIDITY_AT_SELF_PATTERNS,
  scrubBrainStateText,
} from '../lib/api/sc-storyboard-gen.js';
import { containsForbiddenContent } from '../lib/api/student-note-safe.js';

function parseArgs(argv) {
  const out = { student: 'A006', model: 'claude-sonnet-4-6', report: null };
  for (const a of argv.slice(2)) {
    if (a.startsWith('--student=')) out.student = a.slice(10).trim();
    else if (a.startsWith('--model=')) out.model = a.slice(8).trim();
    else if (a.startsWith('--report=')) out.report = a.slice(9).trim();
    else if (a === '--help') out.help = true;
  }
  return out;
}

export function isHighRisk(t) {
  return typeof t === 'string' && SC_STORYBOARD_HIGH_RISK_PATTERNS.some(p => p.test(t));
}
export function splitSentences(text) {
  if (typeof text !== 'string') return [];
  return text.split(/(?<=[。！？!?\n])/).map(s => s.trim()).filter(Boolean);
}
export function preScrubNote(text) {
  const sents = splitSentences(text);
  let dropped = 0;
  const kept = sents.filter(s => {
    if (isHighRisk(s) || containsForbiddenContent(s)) { dropped++; return false; }
    return true;
  });
  return { safe: kept.join(''), dropped, total: sents.length };
}
export function endsWithSelfControl(t) {
  if (typeof t !== 'string') return false;
  const tail = t.slice(-30);
  return SELF_CONTROL_DECLARATION_PATTERNS.some(p => p.test(tail));
}
export function pointsAtSelf(t) {
  return typeof t === 'string' && RIGIDITY_AT_SELF_PATTERNS.some(p => p.test(t));
}
export function gateBrain(raw) {
  const scrubbed = scrubBrainStateText(typeof raw === 'string' ? raw : '');
  if (!scrubbed) return { ok: false, reason: 'scrub-empty/forbidden' };
  return { ok: true, text: scrubbed };
}
export function gateSovereign(raw) {
  const scrubbed = scrubBrainStateText(typeof raw === 'string' ? raw : '');
  if (!scrubbed) return { ok: false, reason: 'scrub-empty/forbidden' };
  if (!endsWithSelfControl(scrubbed)) return { ok: false, reason: 'missing self-control declaration' };
  if (pointsAtSelf(scrubbed)) return { ok: false, reason: 'rigidity-at-self' };
  return { ok: true, text: scrubbed };
}

function buildSystem() {
  return [
    '你是 SC 陪伴者。你會收到一位學員的「每日教練筆記」(已綜合的敘事),',
    '請據此為這位學員寫出「我的人生旅途」七步,每步含 brain_state(大腦現狀)與 sovereign_action(主權建議)。',
    '你的任務是「綜合整段旅程」, 不是逐句拼湊 — 看懂這個人走過的弧線, 再分配到七步。',
    '',
    '七步定義:',
    ...Object.entries(SC_STEP_DEFINITIONS).map(([n, d]) => `  Step ${n}: ${d}`),
    '',
    'sovereign_action 每步原型 (必照此邏輯三段展開):',
    ...Object.entries(SOVEREIGN_ACTION_PROTOTYPES).map(([n, d]) => `  Step ${n}: ${d}`),
    '',
    'brain_state 原則:2-3 句、≤90 字、第二人稱「你…」、溫柔精準、只承接不複述黑暗、不評價不說教、不標步驟編號。',
    'sovereign_action 原則:80-140 字、第二人稱、依原型三段邏輯、用「這位學員」自己的材料(具體非通用)、',
    '  剛性對準舊信念 / 外在裁判(不對準學員自己)、結尾必落內控宣告(例:「我自己說了算」「主導權在我」「不需要外在批准」)。',
    '',
    '絕對禁止:出現「自殺/輕生/自傷/想死/去死/割腕/上吊/跳樓/燒炭/傷害自己」任一字眼;標步驟編號;寫成可套任何人的通用範本。',
    '若某步在筆記裡材料不足以誠實生成, 該步兩欄都填 "" (留白), 不要硬編。',
    '',
    '只輸出 JSON, 格式:{"step_1":{"brain_state":"...","sovereign_action":"..."}, …, "step_7":{…}}。不要任何 JSON 以外的字。',
  ].join('\n');
}
function buildUser(notesText, student) {
  return [
    `學員代號:${student}`,
    '',
    '以下是這位學員的每日教練筆記(已綜合敘事, 依時間排序):',
    '────────',
    notesText,
    '────────',
    '',
    '請據此產出七步 JSON。',
  ].join('\n');
}
export function parseJsonLoose(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log('node scripts/note-to-storyboard-eval.js --student=A006 [--model=claude-sonnet-4-6] [--report=path]');
    return;
  }
  if (!process.env.DATABASE_URL)      { console.error('❌ DATABASE_URL not set'); process.exit(1); }
  if (!process.env.ANTHROPIC_API_KEY) { console.error('❌ ANTHROPIC_API_KEY not set'); process.exit(1); }

  const sql = neon(process.env.DATABASE_URL);
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  // 1. Pull notes (READ-ONLY).
  const rows = await sql`
    SELECT week, day, note_text, is_week_summary
      FROM damon_notes
     WHERE student_id = ${args.student}
     ORDER BY week, day, is_week_summary`;

  const meta = [];
  let totalDropped = 0, totalSents = 0;
  const blocks = [];
  for (const r of rows) {
    const { safe, dropped, total } = preScrubNote(r.note_text || '');
    totalDropped += dropped; totalSents += total;
    meta.push(`W${r.week}D${r.day}${r.is_week_summary ? '(週結)' : ''}: ${total} 句, 預刷 ${dropped}, 留 ${total - dropped}`);
    if (safe.trim()) blocks.push(`【W${r.week} D${r.day}${r.is_week_summary ? ' 週結' : ''}】\n${safe}`);
  }
  const notesText = blocks.join('\n\n');

  // 2. Synthesise (one call; retry JSON parse up to 3x).
  let parsed = null, attempts = 0;
  if (notesText.trim().length > 0) {
    for (attempts = 1; attempts <= 3 && !parsed; attempts++) {
      const result = await callAnthropicWithRetry(anthropic, {
        model: args.model,
        max_tokens: 4000,
        system: buildSystem(),
        messages: [{ role: 'user', content: buildUser(notesText, args.student) }],
      });
      if (result?.ok && result.data?.content?.[0]?.text) {
        parsed = parseJsonLoose(result.data.content[0].text);
      }
    }
  }

  // 3. Gate each step (same gates as J2/J3).
  const out = {};
  let filled = 0;
  for (let n = 1; n <= 7; n++) {
    const step = parsed?.[`step_${n}`] || {};
    const b = gateBrain(step.brain_state);
    const s = gateSovereign(step.sovereign_action);
    out[n] = {
      brain: b.ok ? b.text : null, brainReason: b.ok ? null : b.reason,
      sov: s.ok ? s.text : null, sovReason: s.ok ? null : s.reason,
    };
    if (b.ok) filled++;
  }

  // 4. Report — SAFE content only (no raw notes).
  const zh = ['', '發現匱乏', '承認渴望', '挖掘數據', '認領身份', '發現資源', '奪回主權', '新的身分'];
  const L = [];
  L.push('# Note → 7步 storyboard eval (READ-ONLY · 0 DB writes)');
  L.push('');
  L.push(`學員:**${args.student}** · 模型:\`${args.model}\` · 來源:damon_notes.note_text`);
  L.push(`筆記:${rows.length} 篇 · 預刷高危句:${totalDropped}/${totalSents} (raw 筆記不入 log) · JSON parse attempts:${Math.max(0, attempts - 1)} · brain_state 生出:${filled}/7`);
  L.push('');
  L.push('## 筆記清單 (僅 meta)');
  if (meta.length === 0) L.push('- (無 damon_notes — 確認 student_id / 是否有筆記)');
  meta.forEach(m => L.push(`- ${m}`));
  L.push('');
  L.push('## 從筆記綜合生成的七步 (已過 J2/J3 安全閘)');
  for (let n = 1; n <= 7; n++) {
    L.push('');
    L.push(`### Step ${n} ${zh[n]}`);
    L.push(`- **大腦現狀**:${out[n].brain ?? `_(null — ${out[n].brainReason})_`}`);
    L.push(`- **主權建議**:${out[n].sov ?? `_(null — ${out[n].sovReason})_`}`);
  }
  const report = L.join('\n');

  console.log(report);
  if (args.report) {
    const fs = await import('node:fs');
    fs.writeFileSync(args.report, report + '\n', 'utf8');
  }
}

const invokedDirect = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`
        || import.meta.url === `file:///${process.argv[1].replace(/\\/g, '/')}`;
  } catch { return false; }
})();
if (invokedDirect) {
  main().catch(e => { console.error('eval failed:', e?.message || e); process.exit(1); });
}
