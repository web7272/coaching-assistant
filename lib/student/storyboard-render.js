// lib/student/storyboard-render.js
// v5.3 件3 PR-J4 — 頁 Y「我的人生旅途」 render helpers (pure functions).
//
// student.js inlines these (non-module SPA shell). The lib version here is
// the SOURCE OF TRUTH for unit tests + a sync-gate test asserts student.js
// carries byte-identical verbatim story + matching function signatures.
//
// 故事線 verbatim 來自 Vivi 6/11 終審定稿 `頁Y故事線-逐字定稿-Vivi.md`
// (一字不改;Patrick 逐行驗收).
// brain_state / sovereign_action 來自 /api/sc-storyboard 契約 (J1+J2+J3).
//
// Pure functions — return HTML strings. No DOM access, no global state.
// XSS-safe via escapeHTML on every dynamic insertion point.

// ────────────────────────────────────────────────────────────────
// XSS-safe escape.
// ────────────────────────────────────────────────────────────────

export function escapeHTML(s) {
  if (typeof s !== 'string') return '';
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ────────────────────────────────────────────────────────────────
// 7-step identity (mirror api/sc-storyboard.js SC_STORYBOARD_STEPS;
// duplicated here so render helpers stay self-contained pure JS — no
// import from server-side files).
// ────────────────────────────────────────────────────────────────

export const STORYBOARD_STEP_META = Object.freeze([
  { no: '01', name_zh: '發現匱乏',   name_en: 'The Void' },
  { no: '02', name_zh: '承認渴望',   name_en: 'The Longing' },
  { no: '03', name_zh: '挖掘數據',   name_en: 'Mining the Database' },
  { no: '04', name_zh: '認領身份',   name_en: 'Claiming the Identity' },
  { no: '05', name_zh: '發現資源',   name_en: 'Resource Retrieval' },
  { no: '06', name_zh: '奪回裁判權', name_en: 'Reclaiming the Sovereignty' },
  { no: '07', name_zh: '標籤定錨',   name_en: 'Anchoring the Concept' },
]);

// ────────────────────────────────────────────────────────────────
// 🔴 VERBATIM story body — Vivi 6/11 終審逐字定稿.
//
// ⚠️ DO NOT alter wording, punctuation, or order. Patrick 會逐行比.
// The structure encodes paragraph kind so rendering can differentiate
// visual style (regular paragraph / dialogue quote / villain title /
// temptation block / clickable step heading / final closing line).
// Plain text content is what gets reviewed for verbatim correctness.
// ────────────────────────────────────────────────────────────────

export const STORYBOARD_STORY = Object.freeze([
  { kind: 'p',     text: '你一直覺得，現在的自己，好像不是全部的自己。' },
  { kind: 'p',     text: '有時候，是焦慮、煩躁、疲憊；有時候，是明明已經很努力，卻總事與願違達不到目標。有時候，是一直替別人著想，卻不知道什麼時候別人會轉過身替你想。你隱約知道，生命裡有一塊是空的，始終沒有被滿足。' },
  { kind: 'p',     text: '你開始懷疑：' },
  { kind: 'quote', lines: ['「是不是我不夠好？」', '「是不是我做得不夠多？」', '「什麼時候會輪到我？」'] },
  { kind: 'p',     text: '這些說不清的匱乏感與不滿足，推著你往內看。' },
  { kind: 'p',     text: '於是，你開始：' },

  { kind: 'step',  no: 1, name_zh: '發現匱乏' },
  { kind: 'p',     text: '你終於慢慢看清，自己真正缺的到底是什麼。也許是被理解、被愛、被重視；也許是自由、成就、認可；也許只是一直以來，都沒有好好照顧過自己。' },
  { kind: 'p',     text: '但你慢慢明白，匱乏的另一面，其實就是渴望。之所以會覺得缺，不是因為你太貪心，而是因為你的心裡，本來就真的想要。' },
  { kind: 'p',     text: '看清這件事還不夠。真正難的，是看見，並且承認自己的渴望。' },

  { kind: 'step',  no: 2, name_zh: '承認渴望' },
  { kind: 'p',     text: '承認「我就是想要這個」，發生在看見原來我是想要這個後面。' },
  { kind: 'p',     text: '對一個總是把自己放在最後、習慣壓抑需求的人來說，需要很大的勇氣。' },
  { kind: 'p',     text: '因為你可能早已習慣告訴自己：' },
  { kind: 'quote', lines: ['「沒關係。」', '「我不需要。」', '「先顧別人比較重要。」'] },
  { kind: 'p',     text: '甚至，你連自己的渴望到底是什麼，都丟失了。這次，在這裡你決定把它找回來，因為你知道看見了、承認了，你才真正有了起點，才能繼續走下去。' },
  { kind: 'p',     text: '於是，你開始：' },

  { kind: 'step',  no: 3, name_zh: '挖掘數據' },
  { kind: 'p',     text: '往自己的過去、情緒、反應與選擇裡挖掘。找出那些一直在默默替你做決定，卻從來沒有被說出口的模式與線索。你想找出證據你值得這個渴望。' },
  { kind: 'villain-intro', before: '但就在這時，第一個阻力跳了出來——', name: '限制性信念', after: '。' },
  { kind: 'p',     text: '它在你耳邊低聲說：' },
  { kind: 'quote-villain', lines: ['「你不配。」', '「你做不到。」', '「你以前沒有以後也不會有。」'] },
  { kind: 'p',     text: '它想喝止你停下。它試圖把你拉回舒適圈。' },
  { kind: 'p',     text: '但這次你沒有逗留。' },
  { kind: 'p',     text: '你跨越了它，開始：' },

  { kind: 'step',  no: 4, name_zh: '認領身份' },
  { kind: 'p',     text: '你不再用別人的標準定義自己，而是親口說出：' },
  { kind: 'quote', lines: ['「我是誰。」「我是．．．的人。」'] },
  { kind: 'p',     text: '當你真正認領自己的身份，你才驚訝地發現，' },
  { kind: 'p',     text: '原來自己一直都擁有許多被你遺忘的力量。' },
  { kind: 'p',     text: '你只需要' },

  { kind: 'step',  no: 5, name_zh: '發現資源' },
  { kind: 'p',     text: '那些你以為自己沒有的能力、特質、天賦與韌性，其實一直都在。' },
  { kind: 'p',     text: '只是過去的你，不曾允許自己相信，也不敢真正認領。' },
  { kind: 'p',     text: '故事還沒有結束。' },
  { kind: 'p',     text: '當你開始慢慢站穩，第二個阻力登場了。' },
  { kind: 'p',     text: '它比限制性信念更狡猾。因為它不阻止你，它威逼利誘你。' },
  { kind: 'p',     text: '它告訴你：' },
  { kind: 'quote-villain', lines: ['「世界不是這樣運作的。」'] },
  { kind: 'p',     text: '然後，它用不同的聲音，對不同的人說出同一件事。' },

  { kind: 'villain-title', name: '追求外在認可' },
  { kind: 'temptation', label: '對渴望被肯定的人，它說：', quote: '「別人說你好，你才算好。」' },
  { kind: 'temptation', label: '對渴望被愛的人，它說：',   quote: '「有人愛你，你才有價值。」' },
  { kind: 'temptation', label: '對渴望成功的人，它說：',   quote: '「做出成績，你才值得被看見。」' },
  { kind: 'temptation', label: '對渴望財富的人，它說：',   quote: '「帳戶裡的數字，就是你這個人的分數。」' },

  { kind: 'p',     text: '你慢慢聽懂了。' },
  { kind: 'p',     text: '它所有的話，其實都在做同一件事——' },
  { kind: 'p',     text: '偷偷把「我夠不夠好」的裁判權，從你手中拿走，交給別人、交給結果、交給外面的世界。' },
  { kind: 'p',     text: '但這一次，你看穿了。' },
  { kind: 'p',     text: '你一把拍開它。' },

  { kind: 'step',  no: 6, name_zh: '奪回裁判權' },
  { kind: 'p',     text: '我是誰。' },
  { kind: 'p',     text: '我夠不夠好。' },
  { kind: 'p',     text: '我值不值得。' },
  { kind: 'p',     text: '不再由任何人、任何成績、任何眼光來決定。' },
  { kind: 'p',     text: '而是由我自己定義。' },
  { kind: 'p',     text: '我的價值不跟任何人、事、物、環境、事件掛勾。' },
  { kind: 'p',     text: '於是，你走到了最後一步。' },

  { kind: 'step',  no: 7, name_zh: '標籤定錨' },
  { kind: 'p',     text: '你親手為自己貼上新的標籤。' },
  { kind: 'p',     text: '把它深深融入心裡，成為自己穩定的座標。' },
  { kind: 'p',     text: '最初那份自我懷疑的迷惘與不安，慢慢退去。' },
  { kind: 'p',     text: '因為你終於明白：' },
  { kind: 'p',     text: '你是誰，從來不是世界告訴你的。' },
  { kind: 'p',     text: '而是你願意相信，並親自認領的那個自己。' },

  { kind: 'final', text: '你就是你的渴望' },
]);

// ────────────────────────────────────────────────────────────────
// Render: story line.
//
// Each `step` heading renders as a clickable link (`<a class="storyboard-step-link"
// href="#storyboard-step-N">N. name_zh</a>`) so taps from the story body jump
// to the corresponding step block below.
// ────────────────────────────────────────────────────────────────

export function renderStoryNode(node) {
  if (!node || typeof node !== 'object') return '';
  switch (node.kind) {
    case 'p':
      return `<p class="storyboard-p">${escapeHTML(node.text)}</p>`;
    case 'quote': {
      const inner = node.lines.map(l => escapeHTML(l)).join('<br>');
      return `<p class="storyboard-quote">${inner}</p>`;
    }
    case 'quote-villain': {
      const inner = node.lines.map(l => escapeHTML(l)).join('<br>');
      return `<p class="storyboard-quote storyboard-quote--villain">${inner}</p>`;
    }
    case 'step': {
      // 6/12 fix — href 補零對齊 block id (renderStepBlockHTML 用 noPad).
      // 不補零 → href=#storyboard-step-1 但 block id=#storyboard-step-01 → target null
      // → handler 沒攔住 → 落到 SPA router default → 跳 /entry (已登入則跳 21 天頁).
      // 可見文字保留 no (單位數) — 故事 verbatim 不動 (Vivi 6/11 「1. 發現匱乏」).
      const no = String(node.no);
      const noPad = no.padStart(2, '0');
      const name = escapeHTML(node.name_zh);
      return `<h3 class="storyboard-step-heading">`
        + `<a class="storyboard-step-link" href="#storyboard-step-${noPad}">`
        + `${no}. ${name}</a></h3>`;
    }
    case 'villain-intro': {
      // Inline villain name within a paragraph (e.g. "限制性信念" mid-sentence).
      return `<p class="storyboard-p">`
        + `${escapeHTML(node.before)}`
        + `<span class="storyboard-villain-name">${escapeHTML(node.name)}</span>`
        + `${escapeHTML(node.after)}</p>`;
    }
    case 'villain-title':
      return `<h4 class="storyboard-villain-title">${escapeHTML(node.name)}</h4>`;
    case 'temptation':
      return `<div class="storyboard-temptation">`
        + `<p class="storyboard-p">${escapeHTML(node.label)}</p>`
        + `<p class="storyboard-quote storyboard-quote--villain">${escapeHTML(node.quote)}</p>`
        + `</div>`;
    case 'final':
      return `<p class="storyboard-final">${escapeHTML(node.text)}</p>`;
    default:
      return '';
  }
}

export function renderStoryHTML(nodes = STORYBOARD_STORY) {
  return nodes.map(renderStoryNode).join('\n');
}

// ────────────────────────────────────────────────────────────────
// Render: one step block (header + 2 sections).
//
// step shape (from /api/sc-storyboard):
//   { no, name_zh, name_en, state, brain_state, sovereign_action }
//   brain_state = { description, quote|null } | null
//   sovereign_action = string | null
//
// Empty step ('empty' state OR brain_state+sovereign_action both null) →
// placeholder 「這塊土還沒走過」.
// brain_state.quote null → only description rendered (no empty quote box).
// ────────────────────────────────────────────────────────────────

const EMPTY_PLACEHOLDER = '這塊土還沒走過';

export function isStepEmpty(step) {
  if (!step) return true;
  if (step.state !== 'filled') return true;
  const bsDesc = step.brain_state && typeof step.brain_state.description === 'string'
    && step.brain_state.description.length > 0;
  const hasSa = typeof step.sovereign_action === 'string' && step.sovereign_action.length > 0;
  return !bsDesc && !hasSa;
}

export function renderStepBlockHTML(step, opts = {}) {
  if (!step || typeof step !== 'object') return '';
  const noPad = String(step.no || '01');
  // expandedDefault: open step 01 by default; allow override via opts.
  const isExpanded = (opts.expanded !== undefined)
    ? Boolean(opts.expanded)
    : (noPad === '01');
  const expanded = isExpanded ? 'true' : 'false';
  const hiddenAttr = isExpanded ? '' : ' hidden';

  const isEmpty = isStepEmpty(step);

  let bodyHTML;
  if (isEmpty) {
    bodyHTML = `<p class="storyboard-empty-placeholder">${escapeHTML(EMPTY_PLACEHOLDER)}</p>`;
  } else {
    const parts = [];
    if (step.brain_state && typeof step.brain_state.description === 'string'
        && step.brain_state.description.length > 0) {
      parts.push(`<section class="storyboard-section storyboard-section--brain">`
        + `<h5 class="storyboard-section-title">大腦現狀</h5>`
        + `<p class="storyboard-section-text">${escapeHTML(step.brain_state.description)}</p>`
        // quote rendered only when non-null (Patrick 紅線:quote null → 不硬顯示).
        + (typeof step.brain_state.quote === 'string' && step.brain_state.quote.length > 0
            ? `<blockquote class="storyboard-quote-callout">${escapeHTML(step.brain_state.quote)}</blockquote>`
            : '')
        + `</section>`);
    }
    if (typeof step.sovereign_action === 'string' && step.sovereign_action.length > 0) {
      parts.push(`<section class="storyboard-section storyboard-section--sovereign">`
        + `<h5 class="storyboard-section-title">主權建議</h5>`
        + `<p class="storyboard-section-text">${escapeHTML(step.sovereign_action)}</p>`
        + `</section>`);
    }
    bodyHTML = parts.join('\n');
  }

  return `<article id="storyboard-step-${noPad}" class="storyboard-step-block" data-step="${noPad}">`
    + `<button type="button" class="storyboard-step-toggle" aria-expanded="${expanded}" `
    + `aria-controls="storyboard-step-body-${noPad}">`
    + `<span class="storyboard-step-no">${escapeHTML(noPad)}</span>`
    + `<span class="storyboard-step-name-zh">${escapeHTML(step.name_zh || '')}</span>`
    + `<span class="storyboard-step-name-en">${escapeHTML(step.name_en || '')}</span>`
    + `</button>`
    + `<div id="storyboard-step-body-${noPad}" class="storyboard-step-body"${hiddenAttr}>`
    + `${bodyHTML}`
    + `</div></article>`;
}

// ────────────────────────────────────────────────────────────────
// Render: side nav (desktop 7-step sticky nav).
// ────────────────────────────────────────────────────────────────

export function renderSideNavHTML(steps = STORYBOARD_STEP_META, currentStep = null) {
  const items = steps.map((s, i) => {
    const noNum = i + 1;
    const isCurrent = (currentStep === noNum);
    const cls = isCurrent ? 'storyboard-nav-item storyboard-nav-item--current' : 'storyboard-nav-item';
    return `<a class="${cls}" href="#storyboard-step-${s.no}" data-step="${s.no}">`
      + `<span class="storyboard-nav-no">${escapeHTML(s.no)}</span>`
      + `<span class="storyboard-nav-name">${escapeHTML(s.name_zh)}</span>`
      + `</a>`;
  }).join('\n');
  return `<nav class="storyboard-side-nav" aria-label="七步導覽">${items}</nav>`;
}

// ────────────────────────────────────────────────────────────────
// Render: full body (story + nav + 7 step blocks).
//
// Input: response from /api/sc-storyboard.
// Output: HTML string for #storyboard-body container.
// ────────────────────────────────────────────────────────────────

export function renderStoryboardBodyHTML(apiResponse) {
  const safe = (apiResponse && typeof apiResponse === 'object') ? apiResponse : {};
  const steps = Array.isArray(safe.steps) && safe.steps.length === 7
    ? safe.steps
    : STORYBOARD_STEP_META.map(meta => ({
        no: meta.no, name_zh: meta.name_zh, name_en: meta.name_en,
        state: 'empty', brain_state: null, sovereign_action: null,
      }));
  const currentStep = Number.isInteger(safe.currentStep)
    && safe.currentStep >= 1 && safe.currentStep <= 7
    ? safe.currentStep : null;

  const storyHTML = renderStoryHTML();
  const navHTML   = renderSideNavHTML(STORYBOARD_STEP_META, currentStep);
  const stepsHTML = steps.map((step, i) => renderStepBlockHTML(step, {
    expanded: i === 0 ? true : false,
  })).join('\n');

  // 6/12 Vivi — 故事預設收起 (~14em, 約前 2 段). toggle 「展開更多」/「收起」.
  // 故事 verbatim 不動,只是外殼包一層 .storyboard-story-wrap--collapsed.
  return `<div class="storyboard-story-wrap storyboard-story-wrap--collapsed" id="storyboard-story-wrap">`
    + `<div class="storyboard-story" id="storyboard-story">${storyHTML}</div>`
    + `<button type="button" class="storyboard-story-toggle" `
    + `aria-expanded="false" aria-controls="storyboard-story">展開更多</button>`
    + `</div>`
    + `<div class="storyboard-layout">`
    + `${navHTML}`
    + `<div class="storyboard-steps" id="storyboard-steps">${stepsHTML}</div>`
    + `</div>`;
}
