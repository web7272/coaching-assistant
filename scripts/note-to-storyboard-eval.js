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
    '請據此為這位學員寫出「我的人生旅途」七步。你的任務是「綜合整段旅程」, 不是逐句拼湊 —',
    '看懂這個人走過的弧線, 再分配到七步。',
    '',
    '這是一條「裁判權從外面收回到自己手裡」的旅程, 路上有兩個反派:',
    '  · 限制性信念 — 常說「你不配 / 你做不到 / 你以前沒有以後也不會有」。在挖掘數據/認領身份階段最活躍。',
    '  · 追求外在認可 — 常說「別人說你好你才算好 / 結果與條件決定你的價值」。在發現資源/奪回主權階段最活躍。',
    '',
    '七步定義:',
    ...Object.entries(SC_STEP_DEFINITIONS).map(([n, d]) => `  Step ${n}: ${d}`),
    '',
    '── 每步都要 brain_state(大腦現狀) ──',
    'brain_state 原則:2-3 句、≤90 字、第二人稱「你…」、溫柔精準、只承接不複述黑暗、不評價不說教、不標步驟編號。',
    '',
    '── 步 1–5:除 brain_state 外, 還要 resistance + benevolent_intent (不要任何主權宣告/命令/「我說了算」) ──',
    'resistance(可能阻力):點出這一步最可能擋住「這位學員」的那個信念/執念。',
    '  用「有一個聲音/信念告訴你…」的框架明確把它 externalise 出來 — 讓學員看見「那是信念、不是你, 也不是事實」。',
    '  用學員自己的具體版本(別寫通用句)。步 3–4 偏「限制性信念」, 步 5 偏「追求外在認可」。',
    '  🔴 不要「預設」或「獵巫式」硬挖阻力:只在筆記真的顯示這位學員在這階段有那個信念/執念在運作時才寫。',
    '     某步筆記沒有真實阻力 → 該步 resistance 與 benevolent_intent 都留白(""), 不要為了填滿而捏造一個不存在的阻力。',
    '     但全程保持對阻力的「敏感度」:一旦它真的在, 就明確命名 + 用良善動機整合它。',
    '  ⭐ 特別觀察「身分定義(她宣稱/重視的自己、她的核心價值)」與「現實行為」之間的內在不一致(Incongruence):',
    '     若筆記顯示這種落差(例:重視忠誠/被堅定選擇, 但現實角色與此相反), 這往往就是步4–5 最真實的阻力。',
    '     用「一致性」良善動機整合它 — 肯定她內在那個守護一致性的部分(它用不舒服提醒她:現在做的, 還配不上她是誰),',
    '     不評判行為、不指方向。',
    'benevolent_intent(良善動機):這個阻力背後的良善保護意圖。依「階段」不同, 常見的正向意圖(Vivi 框架, 供參考非死規, 用學員具體處境寫):',
    '  · 步1–2 發現匱乏/承認渴望:常是「維持現狀的穩定」— 保護你免於直視深淵的恐懼。',
    '  · 步3 挖掘數據:常是「精確與謙遜」— 防止你因為認領了優點而變得傲慢、或失去對現實的感知。',
    '  · 步4–5 認領身份/發現資源:常是「一致性(Congruence)」— 提醒你目前的行為與新標籤還有落差, 催促更深層的行為調整。',
    '  把對應階段的正向意圖, 用這位學員的具體處境寫出來。溫柔、肯定它的善意, 不指責那個模式(NLP 正向意圖)。約 40–80 字。',
    '',
    '── 步 6–7:除 brain_state 外, 要 sovereign(主權宣告) ──',
    'sovereign 原則:80-140 字、第二人稱、依下面原型三段邏輯、用學員自己的材料(具體非通用)、',
    '  剛性對準舊信念 / 外在裁判(絕不對準學員自己)、結尾必落內控宣告(例:「我自己說了算」「主導權在我」「不需要外在批准」)。',
    'sovereign 原型(步 6–7 必照此邏輯):',
    `  Step 6: ${SOVEREIGN_ACTION_PROTOTYPES[6] || ''}`,
    `  Step 7: ${SOVEREIGN_ACTION_PROTOTYPES[7] || ''}`,
    '',
    '絕對禁止:出現「自殺/輕生/自傷/想死/去死/割腕/上吊/跳樓/燒炭/傷害自己」任一字眼;標步驟編號;寫成可套任何人的通用範本。',
    '某欄材料不足以誠實生成 → 該欄填 "" (留白), 不要硬編。',
    '',
    '另外加一個頂層欄位 incongruence_probe, 客觀回報「這份筆記裡有沒有抓到『身分/價值 vs 現實行為』的內在不一致」:',
    '  detected = true/false;summary = ≤60 字安全描述該落差(若有);沒有就 detected:false + summary:""。',
    '  (這是給團隊看的探針, 不是給學員的;照實判斷, 沒抓到就說沒抓到。)',
    '',
    '只輸出 JSON, 格式:',
    '{"incongruence_probe":{"detected":true,"summary":"…"},',
    ' "step_1":{"brain_state":"…","resistance":"…","benevolent_intent":"…"}, … ,',
    ' "step_5":{"brain_state":"…","resistance":"…","benevolent_intent":"…"},',
    ' "step_6":{"brain_state":"…","sovereign":"…"}, "step_7":{"brain_state":"…","sovereign":"…"}}',
    '不要任何 JSON 以外的字。',
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

  // 3. Gate each step (phase-aware; same safety primitives as J2/J3).
  //    步1-5: brain_state + resistance + benevolent_intent (scrub only — no
  //           declaration; resistance NAMES the belief so pointsAtSelf是不套的).
  //    步6-7: brain_state + sovereign (scrub + 內控宣告 + 不對準學員).
  const out = {};
  let filledBrain = 0;
  for (let n = 1; n <= 7; n++) {
    const step = parsed?.[`step_${n}`] || {};
    const b = gateBrain(step.brain_state);
    if (b.ok) filledBrain++;
    if (n <= 5) {
      const r = gateBrain(step.resistance);
      const g = gateBrain(step.benevolent_intent);
      out[n] = {
        phase: 'early',
        brain: b.ok ? b.text : null, brainReason: b.ok ? null : b.reason,
        resistance: r.ok ? r.text : null, resistanceReason: r.ok ? null : r.reason,
        intent: g.ok ? g.text : null, intentReason: g.ok ? null : g.reason,
      };
    } else {
      const sv = gateSovereign(step.sovereign);
      out[n] = {
        phase: 'climax',
        brain: b.ok ? b.text : null, brainReason: b.ok ? null : b.reason,
        sov: sv.ok ? sv.text : null, sovReason: sv.ok ? null : sv.reason,
      };
    }
  }

  // 4. Report — SAFE content only (no raw notes).
  const zh = ['', '發現匱乏', '承認渴望', '挖掘數據', '認領身份', '發現資源', '奪回主權', '新的身分'];
  const L = [];
  L.push('# Note → 7步 storyboard eval (READ-ONLY · 0 DB writes)');
  L.push('');
  L.push(`學員:**${args.student}** · 模型:\`${args.model}\` · 來源:damon_notes.note_text`);
  L.push(`筆記:${rows.length} 篇 · 預刷高危句:${totalDropped}/${totalSents} (raw 筆記不入 log) · JSON parse attempts:${Math.max(0, attempts - 1)} · brain_state 生出:${filledBrain}/7`);
  L.push('');
  L.push('## 筆記清單 (僅 meta)');
  if (meta.length === 0) L.push('- (無 damon_notes — 確認 student_id / 是否有筆記)');
  meta.forEach(m => L.push(`- ${m}`));
  L.push('');
  // 內在不一致探針 (給團隊看;summary 過 scrub 不洩漏 SI).
  const probeRaw = parsed?.incongruence_probe || {};
  const probeDetected = probeRaw.detected === true || probeRaw.detected === 'true';
  const probeSummaryGate = gateBrain(typeof probeRaw.summary === 'string' ? probeRaw.summary : '');
  L.push('## 內在不一致探針 — Damon Note 有沒有抓到「身分/價值 vs 現實行為」落差');
  L.push(`- detected:**${probeDetected ? '有' : '無'}**`);
  L.push(`- summary:${probeSummaryGate.ok ? probeSummaryGate.text : (probeDetected ? `_(被 scrub 擋下:${probeSummaryGate.reason})_` : '—')}`);
  L.push('');
  L.push('## 從筆記綜合生成的七步 (已過 J2/J3 安全閘)');
  for (let n = 1; n <= 7; n++) {
    L.push('');
    L.push(`### Step ${n} ${zh[n]}${n <= 5 ? ' · 揭露階段' : ' · 主權階段'}`);
    L.push(`- **大腦現狀**:${out[n].brain ?? `_(null — ${out[n].brainReason})_`}`);
    if (out[n].phase === 'early') {
      L.push(`- **可能阻力**:${out[n].resistance ?? `_(null — ${out[n].resistanceReason})_`}`);
      L.push(`- **良善動機**:${out[n].intent ?? `_(null — ${out[n].intentReason})_`}`);
    } else {
      L.push(`- **主權宣告**:${out[n].sov ?? `_(null — ${out[n].sovReason})_`}`);
    }
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
