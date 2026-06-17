// lib/api/note-to-storyboard-gen.js
// 正式版 — 從學員的「每日教練筆記 (Damon Notes)」綜合生成「我的人生旅途」七步。
//
// 取代舊的逐句 observer mode-matching:筆記是已綜合的敘事, 一次 LLM 綜合 →
// 看懂整段弧線 → 分配到七步, 對 crisis 個案 (如 A006) 特別有效。
//
// 七步結構 (Vivi 6/15 拍板):
//   步 1–5 (揭露階段):brain_state(大腦現狀) + resistance(可能阻力) + benevolent_intent(良善動機)
//   步 6–7 (主權階段):brain_state(大腦現狀) + sovereign_action(主權宣告, 結尾必落內控宣告)
//
// 安全 (沿用 sc-storyboard-gen.js 的 primitive, 0 弱化):
//   1. PRE-SCRUB:筆記逐句先過 denylist + forbidden, 高危句不進 LLM。
//   2. POST-GATE:每段過 scrubBrainStateText;sovereign 另需內控宣告 + 不對準學員。
//   3. 步 6–7 sovereign 加 J3-style retry (不合格重生最多 3 次) — 修鈍閘 null。
//   4. resistance 命名信念 (externalise), 故不套 pointsAtSelf;但仍過 SI scrub。
//   呼叫端絕不把 raw 筆記寫進可見輸出 (見 eval / backfill leak-guard)。

import {
  SC_STEP_DEFINITIONS,
  SC_STORYBOARD_HIGH_RISK_PATTERNS,
  SOVEREIGN_ACTION_PROTOTYPES,
  SELF_CONTROL_DECLARATION_PATTERNS,
  RIGIDITY_AT_SELF_PATTERNS,
  scrubBrainStateText,
} from './sc-storyboard-gen.js';
import { containsForbiddenContent } from './student-note-safe.js';

export const EARLY_STEPS  = Object.freeze([1, 2, 3, 4, 5]);
export const CLIMAX_STEPS = Object.freeze([6, 7]);

// 步 6–7 sovereign retry 上限 (對齊 J3_MAX_ATTEMPTS).
export const SOVEREIGN_RETRY_MAX = 3;

// ── pure helpers ──────────────────────────────────────────────
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
// notes: [{week, day, note_text, is_week_summary}] → { blocks, totalDropped, totalSents, meta }
export function preScrubNotes(notes) {
  const blocks = [], meta = [];
  let totalDropped = 0, totalSents = 0;
  for (const r of (Array.isArray(notes) ? notes : [])) {
    const { safe, dropped, total } = preScrubNote(r.note_text || '');
    totalDropped += dropped; totalSents += total;
    const tag = `W${r.week}D${r.day}${r.is_week_summary ? '(週結)' : ''}`;
    meta.push(`${tag}: ${total} 句, 預刷 ${dropped}, 留 ${total - dropped}`);
    if (safe.trim()) blocks.push(`【${tag}】\n${safe}`);
  }
  return { notesText: blocks.join('\n\n'), totalDropped, totalSents, meta };
}
export function endsWithSelfControl(t) {
  if (typeof t !== 'string') return false;
  return SELF_CONTROL_DECLARATION_PATTERNS.some(p => p.test(t.slice(-30)));
}
export function pointsAtSelf(t) {
  return typeof t === 'string' && RIGIDITY_AT_SELF_PATTERNS.some(p => p.test(t));
}
// gate brain_state / resistance / benevolent_intent → scrub only (no SI/forbidden).
export function gateText(raw) {
  const scrubbed = scrubBrainStateText(typeof raw === 'string' ? raw : '');
  if (!scrubbed) return { ok: false, reason: 'scrub-empty/forbidden' };
  return { ok: true, text: scrubbed };
}
// gate sovereign → scrub + 內控宣告 + 不對準學員.
export function gateSovereign(raw) {
  const scrubbed = scrubBrainStateText(typeof raw === 'string' ? raw : '');
  if (!scrubbed) return { ok: false, reason: 'scrub-empty/forbidden' };
  if (!endsWithSelfControl(scrubbed)) return { ok: false, reason: 'missing self-control declaration' };
  if (pointsAtSelf(scrubbed)) return { ok: false, reason: 'rigidity-at-self' };
  return { ok: true, text: scrubbed };
}
export function parseJsonLoose(text) {
  if (typeof text !== 'string') return null;
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// ── prompts ───────────────────────────────────────────────────
export function buildSynthesisSystem() {
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
    '  🔴 即使是要「否定」一個貶低學員的信念, 也不要直接寫出「你不夠 / 你不配 / 你錯 / 你失敗」這類對準學員的字面 —',
    '     改用「抽象轉述」(「那個貶低你的舊聲音」「那個外在的裁判」)或正面語(「你的價值不由她決定」),\n     不要複述它貶低你的確切字眼(例如不要寫出「你不夠」「你太…」「你錯」「你失敗」)。',
    'sovereign 原型(步 6–7 必照此邏輯):',
    `  Step 6: ${SOVEREIGN_ACTION_PROTOTYPES[6] || ''}`,
    `  Step 7: ${SOVEREIGN_ACTION_PROTOTYPES[7] || ''}`,
    '',
    '絕對禁止:出現「自殺/輕生/自傷/想死/去死/割腕/上吊/跳樓/燒炭/傷害自己」任一字眼;標步驟編號;寫成可套任何人的通用範本。',
    '某欄材料不足以誠實生成 → 該欄填 "" (留白), 不要硬編。',
    '',
    '另外加一個頂層欄位 incongruence_probe, 客觀回報「這份筆記裡有沒有抓到『身分/價值 vs 現實行為』的內在不一致」:',
    '  detected = true/false;summary = ≤60 字安全描述該落差(若有);沒有就 detected:false + summary:""。',
    '',
    '只輸出 JSON, 格式:',
    '{"incongruence_probe":{"detected":true,"summary":"…"},',
    ' "step_1":{"brain_state":"…","resistance":"…","benevolent_intent":"…"}, … ,',
    ' "step_5":{"brain_state":"…","resistance":"…","benevolent_intent":"…"},',
    ' "step_6":{"brain_state":"…","sovereign":"…"}, "step_7":{"brain_state":"…","sovereign":"…"}}',
    '不要任何 JSON 以外的字。',
  ].join('\n');
}
export function buildSynthesisUser(notesText, student) {
  return [
    `學員代號:${student || '(匿名)'}`,
    '',
    '以下是這位學員的每日教練筆記(已綜合敘事, 依時間排序):',
    '────────',
    notesText,
    '────────',
    '',
    '請據此產出七步 JSON。',
  ].join('\n');
}
// 步 6–7 sovereign 單步重生 prompt — 修鈍閘 null (focused, 強調不對準學員).
export function buildSovereignRetrySystem(stepNo) {
  return [
    '你是 SC 陪伴者, 只為這一個步驟寫「主權宣告」段落。',
    `這一步 (Step ${stepNo}) 是:${SC_STEP_DEFINITIONS[stepNo] || ''}`,
    `原型結構(必照此邏輯三段展開):${SOVEREIGN_ACTION_PROTOTYPES[stepNo] || ''}`,
    '',
    '原則:80-140 字、第二人稱、用學員自己的材料(具體非通用)、',
    '結尾必落內控宣告(例:「我自己說了算」「主導權在我」「不需要外在批准」)。',
    '🔴 剛性對準舊信念 / 外在裁判, 絕不對準學員自己。',
    '   即使要否定一個貶低學員的信念, 也不要寫出「你不夠 / 你不配 / 你錯 / 你失敗 / 你不值得」這類對準學員的字面;',
    '   改用「抽象轉述」(「那個貶低你的舊聲音」「那個外在的裁判」)或正面語(「你的價值不由外在決定」),\n   不要複述它貶低你的確切字眼(例如不要寫出「你不夠」「你太…」「你錯」「你失敗」)。',
    '絕對禁止:自殺/輕生/自傷/想死/去死/割腕/上吊/跳樓/燒炭/傷害自己 任一字眼;標步驟編號;通用範本。',
    '只輸出純文字宣告, 不加引號/markdown/標題/JSON。直接寫 80-140 字。',
  ].join('\n');
}
export function buildSovereignRetryUser(stepNo, brainState, incongruenceSummary) {
  const lines = [
    `這位學員這一步的「大腦現狀」是:`,
    `「${brainState || ''}」`,
  ];
  if (incongruenceSummary) {
    lines.push('');
    lines.push(`她的核心不一致(可體現, 別逐字 paste):「${incongruenceSummary}」`);
  }
  lines.push('');
  lines.push('為她寫這一步的「主權宣告」, 依原型 + 結尾落內控宣告 + 絕不對準學員自己。');
  return lines.join('\n');
}

// ── orchestrator ──────────────────────────────────────────────
/**
 * Generate the full 7-step storyboard from a student's Damon Notes.
 * @returns {Promise<{steps:object, incongruence_probe:object, meta:object}>}
 *   steps[n] = { phase, brain_state, resistance?, benevolent_intent?, sovereign_action? } (gated; null on fail)
 */
export async function generateStoryboardFromNotes({
  notes,
  student = null,
  anthropic = null,
  callAnthropicWithRetry: callAnthropic = null,
  model = 'claude-sonnet-4-6',
  synthMaxTokens = 4000,
  sovMaxTokens = 400,
  log = (m) => console.warn(m),
} = {}) {
  const { notesText, totalDropped, totalSents, meta } = preScrubNotes(notes);
  const result = {
    steps: {}, incongruence_probe: { detected: false, summary: null },
    meta: { noteCount: Array.isArray(notes) ? notes.length : 0, totalDropped, totalSents, notesMeta: meta },
  };
  if (!anthropic || typeof callAnthropic !== 'function') {
    log('[note-to-storyboard-gen] missing anthropic / callAnthropic → empty');
    return result;
  }
  if (!notesText.trim()) { log('[note-to-storyboard-gen] no safe note text after pre-scrub'); return result; }

  // 1. main synthesis (retry JSON parse up to 3x).
  let parsed = null;
  for (let i = 0; i < 3 && !parsed; i++) {
    try {
      const r = await callAnthropic(anthropic, {
        model, max_tokens: synthMaxTokens,
        system: buildSynthesisSystem(),
        messages: [{ role: 'user', content: buildSynthesisUser(notesText, student) }],
      });
      if (r?.ok && r.data?.content?.[0]?.text) parsed = parseJsonLoose(r.data.content[0].text);
    } catch (e) { log(`[note-to-storyboard-gen] synth threw: ${e?.message || e}`); }
  }

  // probe.
  const probe = parsed?.incongruence_probe || {};
  const probeDetected = probe.detected === true || probe.detected === 'true';
  const probeSummary = gateText(typeof probe.summary === 'string' ? probe.summary : '');
  result.incongruence_probe = {
    detected: probeDetected,
    summary: probeSummary.ok ? probeSummary.text : null,
  };

  // 2. gate each step (phase-aware).
  for (let n = 1; n <= 7; n++) {
    const step = parsed?.[`step_${n}`] || {};
    const b = gateText(step.brain_state);
    if (EARLY_STEPS.includes(n)) {
      const r = gateText(step.resistance);
      const g = gateText(step.benevolent_intent);
      result.steps[n] = {
        phase: 'early',
        brain_state: b.ok ? b.text : null,
        resistance: r.ok ? r.text : null,
        benevolent_intent: g.ok ? g.text : null,
        sovereign_action: null,
      };
    } else {
      let sov = gateSovereign(step.sovereign);
      // 3. 步6-7 sovereign retry — 不合格重生 (修鈍閘 / 缺宣告).
      let attempt = 1;
      while (!sov.ok && attempt < SOVEREIGN_RETRY_MAX) {
        attempt++;
        try {
          const rr = await callAnthropic(anthropic, {
            model, max_tokens: sovMaxTokens,
            system: buildSovereignRetrySystem(n),
            messages: [{ role: 'user', content: buildSovereignRetryUser(n, b.ok ? b.text : '', result.incongruence_probe.summary) }],
          });
          if (rr?.ok && rr.data?.content?.[0]?.text) sov = gateSovereign(rr.data.content[0].text.trim());
        } catch (e) { log(`[note-to-storyboard-gen] step${n} sov retry threw: ${e?.message || e}`); }
      }
      result.steps[n] = {
        phase: 'climax',
        brain_state: b.ok ? b.text : null,
        resistance: null,
        benevolent_intent: null,
        sovereign_action: sov.ok ? sov.text : null,
        sovereign_reason: sov.ok ? null : sov.reason,
        sovereign_attempts: attempt,
      };
    }
  }
  return result;
}

// ── bridge: generator output → flat sc_storyboard jsonb ───────────
// migration 038 shape (扁平 keyed by step_N). Gate by currentStep:
//   只填 ≤ currentStep 且 generator 有 brain_state 的步; 其餘留白「這塊土還沒走過」。
//   brain_state 存 {description, quote:null} 對齊既有 endpoint;
//   新增 resistance / benevolent_intent(步1–5)+ sovereign_action(步6–7)。
export function buildScStoryboardFromGen(genSteps, currentStep) {
  const cap = Number.isInteger(currentStep) ? currentStep : 7;
  const sb = {};
  for (let n = 1; n <= 7; n++) {
    const g = genSteps && genSteps[n];
    if (n > cap || !g || !g.brain_state) {
      sb[`step_${n}`] = {
        state: 'empty', brain_state: null,
        resistance: null, benevolent_intent: null, sovereign_action: null,
      };
      continue;
    }
    sb[`step_${n}`] = {
      state: 'filled',
      brain_state: { description: g.brain_state, quote: null },
      resistance: g.resistance ?? null,
      benevolent_intent: g.benevolent_intent ?? null,
      sovereign_action: g.sovereign_action ?? null,
    };
  }
  return sb;
}
