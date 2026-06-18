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
  { no: '06', name_zh: '奪回主權', name_en: 'Reclaiming the Sovereignty' },
  { no: '07', name_zh: '新的身分',   name_en: 'Anchoring the Concept' },
]);

// ────────────────────────────────────────────────────────────────
// 過場引導句 — 步驟卡之間的銜接 (editorial, Vivi 6/14 v2 預覽認可方向; 文案待終審).
// CONNECTORS[i] = 第 (i+1) 步「之後」顯示的過場句; 第 7 步後無 (null).
// ────────────────────────────────────────────────────────────────
export const STORYBOARD_CONNECTORS = Object.freeze([
  '你慢慢看清，匱乏的另一面，其實是渴望。',
  '你動身往回挖記憶，但有個聲音說『你不配』。',
  '你開始找到證據，你能說出『我是誰』。',
  '戴上新眼鏡後，你開始看見以前看不見的東西。',
  '此時外在環境試圖告訴你，世界不是這樣運作。',
  '你堅守自己的主權，告訴世界，我決定『我是誰』。',
  null,
]);

// ────────────────────────────────────────────────────────────────
// Render: 頂部數字圓圈進度條 (取代舊側欄導覽).
// pip = <a href="#storyboard-step-NN"> → 純錨點跳轉, 無需 JS handler.
// filled / current / empty 三態; label「已點亮 N/7」.
// ────────────────────────────────────────────────────────────────
export function renderProgressBarHTML(steps = [], currentStep = null) {
  const pips = steps.map((s, i) => {
    const n = i + 1;
    const filled = s && s.state === 'filled';
    const cur = currentStep === n;
    const cls = 'storyboard-pip'
      + (filled ? ' storyboard-pip--filled' : '')
      + (cur ? ' storyboard-pip--current' : '');
    return `<a class="${cls}" href="#storyboard-step-${escapeHTML(s.no)}" `
      + `aria-label="跳到步驟 ${n} ${escapeHTML(s.name_zh || '')}">`
      + `<span class="storyboard-pip-num">${n}</span>`
      + `<span class="storyboard-pip-bar"></span></a>`;
  }).join('');
  const filledCount = steps.filter(s => s && s.state === 'filled').length;
  return `<div class="storyboard-progress" aria-label="七步進度">`
    + `<div class="storyboard-pips">${pips}</div>`
    + `<div class="storyboard-progress-label">已點亮 <b>${filledCount}</b>/7</div>`
    + `</div>`;
}


// ────────────────────────────────────────────────────────────────
// 🔴 VERBATIM story body — Vivi 6/14 終審逐字定稿 (文章版).
//
// ⚠️ DO NOT alter wording, punctuation, or order. Patrick 會逐行比.
// 6/14 改為文章段落格式:引號/步驟名 inline 在段落裡、步驟仍可點.
// Node kinds: 'para' (段落, seg 陣列) / 'tempt' (誘惑句) / 'final' (結尾).
// Seg kinds:  { t } 文字 / { q } inline 引號 / { step, label } 步驟連結 /
//             { vil } 反派名.
// ────────────────────────────────────────────────────────────────

export const STORYBOARD_STORY = Object.freeze([
  { kind: 'para', seg: [{ t: '你一直覺得，現在的自己，好像不是全部的自己。' }] },
  { kind: 'para', seg: [{ t: '有時候，是焦慮、煩躁、疲憊；有時候，是明明已經很努力，卻總事與願違達不到目標。有時候，是一直替別人著想，卻不知道什麼時候別人會轉過身替你想。你隱約知道，生命裡有一塊是空的，始終沒有被滿足。' }] },
  { kind: 'para', seg: [{ t: '你開始懷疑：' }, { q: '是不是我不夠好？' }, { q: '是不是我做得不夠多？' }, { q: '什麼時候會輪到我？' }] },
  { kind: 'para', seg: [{ t: '這些說不清的匱乏感與不滿足，推著你往內看。於是，你開始：' }, { step: 1, label: '1.發現匱乏' }, { t: '。你終於慢慢看清，自己真正缺的到底是什麼。也許是被理解、被愛、被重視；也許是自由、成就、認可；也許只是一直以來，都沒有好好照顧過自己。' }] },
  { kind: 'para', seg: [{ t: '但你慢慢明白，匱乏的另一面，其實就是渴望。之所以會覺得缺，不是因為你太貪心，而是因為你的心裡，本來就真的想要。看清這件事還不夠。真正難的，是看見，並且' }, { step: 2, label: '2.承認渴望' }, { t: '。' }] },
  { kind: 'para', seg: [{ t: '承認' }, { q: '我就是想要這個' }, { t: '之前，是先' }, { q: '看見' }, { t: '原來我是想要這個。對一個總是把自己放在最後、習慣壓抑需求的人來說，需要很大的勇氣。因為你可能早已習慣告訴自己：' }, { q: '沒關係。' }, { q: '我不需要。' }, { q: '先顧別人比較重要。' }] },
  { kind: 'para', seg: [{ t: '甚至，你連自己的渴望到底是什麼，都丟失了。這次，在這裡你決定把它找回來，因為你知道看見了、承認了，你才真正有了起點，才能繼續走下去。於是，你開始：' }, { step: 3, label: '3.挖掘數據' }, { t: '。' }] },
  { kind: 'para', seg: [{ t: '往自己的過去、情緒、反應與選擇裡挖掘。找出那些一直在默默替你做決定，卻從來沒有被說出口的模式與線索。你想找出證據你值得這個渴望。但就在這時，第一個阻力跳了出來——' }, { vil: '限制性信念' }, { t: '。' }] },
  { kind: 'para', seg: [{ t: '它在你耳邊低聲說：' }, { q: '你不配。' }, { q: '你做不到。' }, { q: '你以前沒有以後也不會有。' }, { t: '它想喝止你停下。它試圖把你拉回舒適圈。但這次你沒有逗留。你跨越了它，開始：' }, { step: 4, label: '4. 認領身份' }, { t: '。' }] },
  { kind: 'para', seg: [{ t: '你不再用別人的標準定義自己，而是親口說出：' }, { q: '我是誰。' }, { q: '我是．．．的人。' }, { t: '當你真正認領自己的身份，你才驚訝地發現，原來自己一直都擁有許多被你遺忘的力量。你只需要' }, { step: 5, label: '5. 發現資源' }, { t: '。' }] },
  { kind: 'para', seg: [{ t: '那些你以為自己沒有的能力、特質、天賦與韌性，其實一直都在。只是過去的你，不曾允許自己相信，也不敢真正認領。故事還沒有結束。當你開始慢慢站穩，第二個阻力登場了。它比限制性信念更狡猾。因為它不阻止你，它企圖給你洗腦。' }] },
  { kind: 'para', seg: [{ t: '它告訴你：' }, { q: '世界不是這樣運作的。' }, { t: '然後，它用不同的聲音，對不同的人說出同一件事 — ' }, { vil: '追求外在認可' }] },
  { kind: 'tempt', label: '對渴望被肯定的人，它說：', quote: '別人說你好，你才算好。' },
  { kind: 'tempt', label: '對渴望被愛的人，它說：', quote: '有人愛你，你才有價值。' },
  { kind: 'tempt', label: '對渴望成功的人，它說：', quote: '做出成績，你才值得被看見。' },
  { kind: 'tempt', label: '對渴望財富的人，它說：', quote: '帳戶裡的數字，就是你這個人的分數。' },
  { kind: 'para', seg: [{ t: '你慢慢聽懂了。它所有的話，其實都在做同一件事——偷偷把' }, { q: '我夠不夠好' }, { t: '的主權，從你手中拿走，交給別人、交給結果、交給外面的世界。但這一次，你看穿了。你一把拍開它' }, { step: 6, label: '奪回主權' }, { t: '。' }] },
  { kind: 'para', seg: [{ t: '我是誰。我夠不夠好。我值不值得。不再由任何人、任何成績、任何眼光來決定。' }] },
  { kind: 'para', seg: [{ t: '而是由我自己定義。我的價值不跟任何人、事、物、環境、事件掛勾。於是，你走到了最後一步。' }] },
  { kind: 'para', seg: [{ step: 7, label: '7. 新的身分' }, { t: '。你親手為自己貼上新的身分。把它深深融入心裡，成為自己穩定的座標。最初那份自我懷疑的迷惘與不安，慢慢退去。因為你終於明白：你是誰，從來不是世界告訴你的。而是你願意相信，並決定成為那個自己。' }] },
  { kind: 'final', text: '你決定活出全部的你。' },
]);

// ────────────────────────────────────────────────────────────────
// Render: story line.
//
// 6/14 文章版:para 渲染為 <p> 段落 + inline seg 解析 (renderStorySeg).
// tempt 為 label + 引號 inline; final 為粗體尾句.
// ────────────────────────────────────────────────────────────────

export function renderStoryNode(node) {
  if (!node || typeof node !== 'object') return '';
  switch (node.kind) {
    case 'para': {
      const inner = (Array.isArray(node.seg) ? node.seg : []).map(renderStorySeg).join('');
      return `<p class="storyboard-p">${inner}</p>`;
    }
    case 'tempt':
      return `<div class="storyboard-temptation">`
        + `<span class="storyboard-tempt-label">${escapeHTML(node.label)}</span>`
        + `<span class="storyboard-tempt-quote">「${escapeHTML(node.quote)}」</span>`
        + `</div>`;
    case 'final':
      return `<p class="storyboard-final">${escapeHTML(node.text)}</p>`;
    default:
      return '';
  }
}

// Render one inline segment of a 'para' node.
//   { t }       → plain text
//   { q }       → inline quote 「…」 (no callout box — flows in the paragraph)
//   { step,label } → clickable inline step link (scrolls to #storyboard-step-0N)
//   { vil }     → villain name (inline emphasis)
export function renderStorySeg(seg) {
  if (!seg || typeof seg !== 'object') return '';
  if (typeof seg.t === 'string') return escapeHTML(seg.t);
  if (typeof seg.q === 'string') {
    return `<span class="storyboard-iquote">「${escapeHTML(seg.q)}」</span>`;
  }
  if (Number.isInteger(seg.step)) {
    const noPad = String(seg.step).padStart(2, '0');
    return `<a class="storyboard-step-link" href="#storyboard-step-${noPad}">${escapeHTML(seg.label || '')}</a>`;
  }
  if (typeof seg.vil === 'string') {
    return `<span class="storyboard-villain-name">${escapeHTML(seg.vil)}</span>`;
  }
  return '';
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
    // 6/15 S4 — 步1–5 (note-based): 可能阻力 + 良善動機.
    if (typeof step.resistance === 'string' && step.resistance.length > 0) {
      parts.push(`<section class="storyboard-section storyboard-section--resistance">`
        + `<h5 class="storyboard-section-title">可能阻力</h5>`
        + `<p class="storyboard-section-text">${escapeHTML(step.resistance)}</p>`
        + `</section>`);
    }
    if (typeof step.benevolent_intent === 'string' && step.benevolent_intent.length > 0) {
      parts.push(`<section class="storyboard-section storyboard-section--intent">`
        + `<h5 class="storyboard-section-title">良善動機</h5>`
        + `<p class="storyboard-section-text">${escapeHTML(step.benevolent_intent)}</p>`
        + `</section>`);
    }
    // 步6–7: 主權宣告 (was 主權建議).
    if (typeof step.sovereign_action === 'string' && step.sovereign_action.length > 0) {
      parts.push(`<section class="storyboard-section storyboard-section--sovereign">`
        + `<h5 class="storyboard-section-title">主權宣告</h5>`
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
    + `<span class="storyboard-step-peek">${isExpanded ? '收合' : '展開'}</span>`
    + `<svg class="storyboard-step-chev" viewBox="0 0 24 24" fill="none" `
    + `stroke="currentColor" stroke-width="2" aria-hidden="true">`
    + `<path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
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

/**
 * @param {object} apiResponse — /api/sc-storyboard 回傳.
 * @param {object} [opts]
 * @param {boolean} [opts.collapsible=true] — 故事預設收起 + 「展開更多」 toggle.
 *   Student 端 = 默認 true. Coach 端傳 false → 故事直接全展開, 不要 toggle
 *   (教練是審閱、不需互動;Patrick 6/12).
 * @param {boolean} [opts.expandAllSteps=false] — 7 步塊全展開 (aria-expanded=true,
 *   body 不 hidden). Student 默認 false (只開 step_01); coach 傳 true 直接全展開.
 */
export function renderStoryboardBodyHTML(apiResponse, opts = {}) {
  const collapsible    = opts.collapsible !== false; // default true (student)
  const expandAllSteps = !!opts.expandAllSteps;       // default false (student)

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
  const progressHTML = renderProgressBarHTML(steps, currentStep);
  const stepsHTML = steps.map((step, i) => {
    const block = renderStepBlockHTML(step, {
      expanded: expandAllSteps ? true : (i === 0),
    });
    const conn = STORYBOARD_CONNECTORS[i];
    const connHTML = conn
      ? `<div class="storyboard-connector" aria-hidden="true">`
        + `<span class="storyboard-connector-line"></span>`
        + `<span class="storyboard-connector-text">${escapeHTML(conn)}</span>`
        + `<span class="storyboard-connector-line"></span></div>`
      : '';
    return block + connHTML;
  }).join('\n');

  // 6/12 Vivi — 故事預設收起 (~14em, 約前 2 段). toggle 「展開更多」/「收起」.
  // 故事 verbatim 不動,只是外殼包一層 .storyboard-story-wrap--collapsed.
  // 6/12 coach — collapsible=false 時去掉 --collapsed modifier + 不放 toggle button.
  // 6/14 Vivi — 故事改 v2 arc card:標題「先看這趟旅程的故事線」在上 + chevron,
  // 預設收起,點 toggle 展開. coach (collapsible=false) → 不收起、無 toggle、全展開.
  const wrapClass = collapsible
    ? 'storyboard-arc storyboard-arc--collapsed'
    : 'storyboard-arc';
  const toggleHTML = collapsible
    ? `<button type="button" class="storyboard-arc-toggle" `
      + `aria-expanded="false" aria-controls="storyboard-story">`
      + `<span class="storyboard-arc-title">先看這趟旅程的故事線</span>`
      + `<span class="storyboard-arc-peek">展開</span>`
      + `<svg class="storyboard-arc-chev" viewBox="0 0 24 24" fill="none" `
      + `stroke="currentColor" stroke-width="2" aria-hidden="true">`
      + `<path d="M6 9l6 6 6-6" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      + `</button>`
    : '';
  return progressHTML
    + `<div class="${wrapClass}" id="storyboard-story-wrap">`
    + toggleHTML
    + `<div class="storyboard-arc-body">`
    + `<div class="storyboard-story" id="storyboard-story">${storyHTML}</div>`
    + `</div></div>`
    + `<div class="storyboard-steps" id="storyboard-steps">${stepsHTML}</div>`;
}
