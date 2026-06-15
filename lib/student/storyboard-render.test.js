// lib/student/storyboard-render.test.js
// v5.3 件3 PR-J4 — 頁 Y render helpers (pure) + verbatim story lock +
// sync-gate test against student.js + index.html shell test.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  STORYBOARD_STORY,
  STORYBOARD_STEP_META,
  escapeHTML,
  renderStoryNode,
  renderStoryHTML,
  renderStepBlockHTML,
  renderSideNavHTML,
  renderStoryboardBodyHTML,
  isStepEmpty,
} from './storyboard-render.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = join(__dirname, '..', '..');

// ═════════════════════════════════════════════════════════
// 🔴 VERBATIM story lock (Patrick 會逐行比 Vivi 6/11 定稿)
// ═════════════════════════════════════════════════════════

const VERBATIM_LINES = [
  '你一直覺得，現在的自己，好像不是全部的自己。',
  '有時候，是焦慮、煩躁、疲憊；有時候，是明明已經很努力，卻總事與願違達不到目標。有時候，是一直替別人著想，卻不知道什麼時候別人會轉過身替你想。你隱約知道，生命裡有一塊是空的，始終沒有被滿足。',
  '你開始懷疑：',
  '「是不是我不夠好？」',
  '「是不是我做得不夠多？」',
  '「什麼時候會輪到我？」',
  '這些說不清的匱乏感與不滿足，推著你往內看。',
  '於是，你開始：',
  // 1
  '你終於慢慢看清，自己真正缺的到底是什麼。也許是被理解、被愛、被重視；也許是自由、成就、認可；也許只是一直以來，都沒有好好照顧過自己。',
  '但你慢慢明白，匱乏的另一面，其實就是渴望。之所以會覺得缺，不是因為你太貪心，而是因為你的心裡，本來就真的想要。',
  '看清這件事還不夠。真正難的，是看見，並且承認自己的渴望。',
  // 2
  '承認「我就是想要這個」，發生在看見原來我是想要這個後面。',
  '對一個總是把自己放在最後、習慣壓抑需求的人來說，需要很大的勇氣。',
  '因為你可能早已習慣告訴自己：',
  '「沒關係。」',
  '「我不需要。」',
  '「先顧別人比較重要。」',
  '甚至，你連自己的渴望到底是什麼，都丟失了。這次，在這裡你決定把它找回來，因為你知道看見了、承認了，你才真正有了起點，才能繼續走下去。',
  '於是，你開始：',
  // 3
  '往自己的過去、情緒、反應與選擇裡挖掘。找出那些一直在默默替你做決定，卻從來沒有被說出口的模式與線索。你想找出證據你值得這個渴望。',
  '它在你耳邊低聲說：',
  '「你不配。」',
  '「你做不到。」',
  '「你以前沒有以後也不會有。」',
  '它想喝止你停下。它試圖把你拉回舒適圈。',
  '但這次你沒有逗留。',
  '你跨越了它，開始：',
  // 4
  '你不再用別人的標準定義自己，而是親口說出：',
  '「我是誰。」「我是．．．的人。」',
  '當你真正認領自己的身份，你才驚訝地發現，',
  '原來自己一直都擁有許多被你遺忘的力量。',
  '你只需要',
  // 5
  '那些你以為自己沒有的能力、特質、天賦與韌性，其實一直都在。',
  '只是過去的你，不曾允許自己相信，也不敢真正認領。',
  '故事還沒有結束。',
  '當你開始慢慢站穩，第二個阻力登場了。',
  '它比限制性信念更狡猾。因為它不阻止你，它威逼利誘你。',
  '它告訴你：',
  '「世界不是這樣運作的。」',
  '然後，它用不同的聲音，對不同的人說出同一件事。',
  // villain title 追求外在認可
  '對渴望被肯定的人，它說：',
  '「別人說你好，你才算好。」',
  '對渴望被愛的人，它說：',
  '「有人愛你，你才有價值。」',
  '對渴望成功的人，它說：',
  '「做出成績，你才值得被看見。」',
  '對渴望財富的人，它說：',
  '「帳戶裡的數字，就是你這個人的分數。」',
  '你慢慢聽懂了。',
  '它所有的話，其實都在做同一件事——',
  '偷偷把「我夠不夠好」的主權，從你手中拿走，交給別人、交給結果、交給外面的世界。',
  '但這一次，你看穿了。',
  '你一把拍開它。',
  // 6
  '我是誰。',
  '我夠不夠好。',
  '我值不值得。',
  '不再由任何人、任何成績、任何眼光來決定。',
  '而是由我自己定義。',
  '我的價值不跟任何人、事、物、環境、事件掛勾。',
  '於是，你走到了最後一步。',
  // 7
  '你親手為自己貼上新的身分。',
  '把它深深融入心裡，成為自己穩定的座標。',
  '最初那份自我懷疑的迷惘與不安，慢慢退去。',
  '因為你終於明白：',
  '你是誰，從來不是世界告訴你的。',
  '而是你願意相信，並親自認領的那個自己。',
  // final
  '你就是你的渴望',
];

test('🛑 PR-J4 🔴 verbatim: every Vivi 6/11 line appears EXACTLY in STORYBOARD_STORY', () => {
  // Flatten all node text + quote lines into one searchable string.
  const all = STORYBOARD_STORY.map(n => {
    switch (n.kind) {
      case 'p':
      case 'final':         return n.text;
      case 'quote':
      case 'quote-villain': return n.lines.join('\n');
      case 'step':          return `${n.no}. ${n.name_zh}`;
      case 'villain-intro': return `${n.before}${n.name}${n.after}`;
      case 'villain-title': return n.name;
      case 'temptation':    return `${n.label}\n${n.quote}`;
      default:              return '';
    }
  }).join('\n');
  for (const line of VERBATIM_LINES) {
    assert.ok(all.includes(line),
      `🔴 verbatim: MISSING line: "${line}"`);
  }
});

test('🛑 PR-J4 🔴 verbatim: 7 step labels + 2 villain markers + final closing present', () => {
  const all = STORYBOARD_STORY.map(n => JSON.stringify(n)).join('\n');
  // 7 step labels (clickable in story).
  for (const name of ['發現匱乏', '承認渴望', '挖掘數據', '認領身份', '發現資源', '奪回主權', '新的身分']) {
    assert.ok(all.includes(name), `step label「${name}」 missing`);
  }
  // 2 villains.
  assert.ok(all.includes('限制性信念'),  '限制性信念 villain missing');
  assert.ok(all.includes('追求外在認可'), '追求外在認可 villain missing');
  // Final.
  assert.ok(all.includes('你就是你的渴望'), '結尾「你就是你的渴望」 missing');
});

test('🛑 PR-J4 🔴 verbatim: 4 temptations (limit-belief sub-quotes) exact text', () => {
  const temptations = STORYBOARD_STORY.filter(n => n.kind === 'temptation');
  assert.equal(temptations.length, 4);
  assert.deepEqual(temptations.map(t => t.quote), [
    '「別人說你好，你才算好。」',
    '「有人愛你，你才有價值。」',
    '「做出成績，你才值得被看見。」',
    '「帳戶裡的數字，就是你這個人的分數。」',
  ]);
});

// ═════════════════════════════════════════════════════════
// escapeHTML — XSS safety
// ═════════════════════════════════════════════════════════

test('🛑 PR-J4 escapeHTML: escapes 5 dangerous chars', () => {
  assert.equal(escapeHTML('<script>alert("x")</script>'),
    '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(escapeHTML(`a'b`),  'a&#39;b');
  assert.equal(escapeHTML('a&b'),  'a&amp;b');
  assert.equal(escapeHTML(null),   '');
  assert.equal(escapeHTML(42),     '');
});

test('🛑 PR-J4 escapeHTML: Chinese chars pass through unchanged', () => {
  assert.equal(escapeHTML('你一直覺得「我不夠好」'), '你一直覺得「我不夠好」');
});

// ═════════════════════════════════════════════════════════
// renderStoryNode + renderStoryHTML
// ═════════════════════════════════════════════════════════

test('🛑 PR-J4 renderStoryNode: p kind → <p>', () => {
  const html = renderStoryNode({ kind: 'p', text: '測試' });
  assert.match(html, /<p class="storyboard-p">測試<\/p>/);
});

test('🛑 PR-J4 renderStoryNode: quote → 多行 br-separated', () => {
  const html = renderStoryNode({ kind: 'quote', lines: ['A。', 'B。'] });
  assert.match(html, /<p class="storyboard-quote">A。<br>B。<\/p>/);
});

test('🛑 6/12 fix — renderStoryNode: step → href 補零 (#storyboard-step-0N), 可見文字單位數 (verbatim 不動)', () => {
  const html = renderStoryNode({ kind: 'step', no: 3, name_zh: '挖掘數據' });
  // href 補零 — 對齊 renderStepBlockHTML 的 id="storyboard-step-03".
  assert.match(html, /href="#storyboard-step-03"/);
  // Anti-regression: 舊版單位數 href 必須消失.
  assert.equal(/href="#storyboard-step-3"/.test(html), false,
    'href must NOT be unpadded (would mis-target block id and fall through to SPA router)');
  // 可見文字仍是 「3. 挖掘數據」 (故事 verbatim 不動 — Vivi 6/11 終審).
  assert.match(html, />3\. 挖掘數據</);
});

test('🛑 PR-J4 renderStoryNode: villain-intro inline span', () => {
  const html = renderStoryNode({
    kind: 'villain-intro', before: '前文——', name: '限制性信念', after: '。',
  });
  assert.match(html, /<span class="storyboard-villain-name">限制性信念<\/span>/);
});

test('🛑 PR-J4 renderStoryNode: villain-title heading', () => {
  const html = renderStoryNode({ kind: 'villain-title', name: '追求外在認可' });
  assert.match(html, /<h4 class="storyboard-villain-title">追求外在認可<\/h4>/);
});

test('🛑 PR-J4 renderStoryNode: temptation wraps label + villain quote', () => {
  const html = renderStoryNode({
    kind: 'temptation', label: '對渴望被愛的人，它說：', quote: '「有人愛你，你才有價值。」',
  });
  assert.match(html, /storyboard-temptation/);
  assert.match(html, /storyboard-quote--villain/);
});

test('🛑 PR-J4 renderStoryNode: final closing line distinct class', () => {
  const html = renderStoryNode({ kind: 'final', text: '你就是你的渴望' });
  assert.match(html, /<p class="storyboard-final">你就是你的渴望<\/p>/);
});

test('🛑 6/12 fix — renderStoryHTML: all 7 step links use PADDED href (對齊 block id)', () => {
  const html = renderStoryHTML();
  for (let n = 1; n <= 7; n++) {
    const padded = String(n).padStart(2, '0');
    assert.match(html, new RegExp(`href="#storyboard-step-${padded}"`),
      `step ${n} padded link missing`);
    // Anti-regression: any unpadded single-digit href would have mis-targeted.
    assert.equal(
      new RegExp(`href="#storyboard-step-${n}"(?![0-9])`).test(html), false,
      `step ${n} unpadded href present — would fall through to SPA router`);
  }
});

// ═════════════════════════════════════════════════════════
// renderStepBlockHTML — 2 sections + placeholder
// ═════════════════════════════════════════════════════════

test('🛑 PR-J4 renderStepBlock: empty step → 「這塊土還沒走過」 placeholder', () => {
  const html = renderStepBlockHTML({
    no: '02', name_zh: '承認渴望', name_en: 'The Longing',
    state: 'empty', brain_state: null, sovereign_action: null,
  });
  assert.match(html, /storyboard-empty-placeholder/);
  assert.match(html, /這塊土還沒走過/);
});

test('🛑 PR-J4 renderStepBlock: filled + brain_state with quote → both rendered', () => {
  const html = renderStepBlockHTML({
    no: '04', name_zh: '認領身份', name_en: 'Claiming the Identity',
    state: 'filled',
    brain_state: { description: '你開始說出「我是這樣的人」。', quote: '我是勇敢的人' },
    sovereign_action: '針對你的領域,你拿回主動權。我自己說了算。',
  });
  assert.match(html, /大腦現狀/);
  assert.match(html, /你開始說出/);
  assert.match(html, /<blockquote class="storyboard-quote-callout">我是勇敢的人<\/blockquote>/);
  assert.match(html, /主權建議/);
  assert.match(html, /我自己說了算/);
});

test('🛑 PR-J4 renderStepBlock: quote null → blockquote NOT rendered (no empty callout)', () => {
  const html = renderStepBlockHTML({
    no: '01', name_zh: '發現匱乏', name_en: 'The Void',
    state: 'filled',
    brain_state: { description: '那段日子,你心裡空了一塊。', quote: null },
    sovereign_action: '針對你的事業,你拿回。我自己說了算。',
  });
  assert.match(html, /那段日子/);
  assert.equal(/<blockquote/.test(html), false,
    'quote null → no <blockquote> element (留白, NOT empty callout)');
  assert.match(html, /主權建議/);
});

test('🛑 PR-J4 renderStepBlock: sovereign_action null → 主權建議 section omitted', () => {
  const html = renderStepBlockHTML({
    no: '01', name_zh: '發現匱乏', name_en: 'The Void',
    state: 'filled',
    brain_state: { description: '描述。', quote: null },
    sovereign_action: null,
  });
  assert.match(html, /大腦現狀/);
  assert.equal(/主權建議/.test(html), false);
});

test('🛑 PR-J4 renderStepBlock: anchor id = storyboard-step-N (matches story links)', () => {
  const html = renderStepBlockHTML({
    no: '05', name_zh: '發現資源', name_en: 'Resource Retrieval',
    state: 'empty', brain_state: null, sovereign_action: null,
  });
  assert.match(html, /id="storyboard-step-05"/);
});

test('🛑 PR-J4 renderStepBlock: aria-expanded + toggle button', () => {
  const html = renderStepBlockHTML({
    no: '03', name_zh: '挖掘數據', name_en: 'Mining the Database',
    state: 'empty', brain_state: null, sovereign_action: null,
  });
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /<button[^>]*class="storyboard-step-toggle"/);
});

test('🛑 PR-J4 renderStepBlock: step 01 expanded by default; others collapsed', () => {
  const html01 = renderStepBlockHTML({ no: '01', name_zh: 'A', name_en: 'B', state: 'empty', brain_state: null, sovereign_action: null });
  const html02 = renderStepBlockHTML({ no: '02', name_zh: 'A', name_en: 'B', state: 'empty', brain_state: null, sovereign_action: null });
  assert.match(html01, /aria-expanded="true"/);
  assert.match(html02, /aria-expanded="false"/);
});

test('🛑 PR-J4 isStepEmpty: classifies states correctly', () => {
  assert.equal(isStepEmpty(null), true);
  assert.equal(isStepEmpty({ state: 'empty' }), true);
  assert.equal(isStepEmpty({
    state: 'filled', brain_state: null, sovereign_action: null,
  }), true, 'filled but both null → still empty for render purposes');
  assert.equal(isStepEmpty({
    state: 'filled', brain_state: { description: 'x', quote: null }, sovereign_action: null,
  }), false);
  assert.equal(isStepEmpty({
    state: 'filled', brain_state: null, sovereign_action: 'x。我自己說了算。',
  }), false);
});

// ═════════════════════════════════════════════════════════
// renderSideNavHTML — desktop sticky nav
// ═════════════════════════════════════════════════════════

test('🛑 PR-J4 renderSideNav: 7 links pointing to step anchors', () => {
  const html = renderSideNavHTML();
  for (let n = 1; n <= 7; n++) {
    const padded = String(n).padStart(2, '0');
    assert.match(html, new RegExp(`href="#storyboard-step-${padded}"`));
  }
});

test('🛑 PR-J4 renderSideNav: currentStep adds storyboard-nav-item--current modifier', () => {
  const html = renderSideNavHTML(STORYBOARD_STEP_META, 4);
  assert.match(html, /storyboard-nav-item--current/);
});

// ═════════════════════════════════════════════════════════
// renderStoryboardBodyHTML — full integration
// ═════════════════════════════════════════════════════════

test('🛑 PR-J4 renderBody: complete API response → story + 7 blocks rendered', () => {
  const apiResp = {
    module: 'self',
    currentStep: 4,
    steps: [1, 2, 3, 4, 5, 6, 7].map(n => ({
      no: String(n).padStart(2, '0'),
      name_zh: STORYBOARD_STEP_META[n - 1].name_zh,
      name_en: STORYBOARD_STEP_META[n - 1].name_en,
      state: n <= 4 ? 'filled' : 'empty',
      brain_state: n <= 4 ? { description: `desc ${n}`, quote: n === 4 ? '勇敢' : null } : null,
      sovereign_action: n <= 4 ? `主權 ${n}。我自己說了算。` : null,
    })),
  };
  const html = renderStoryboardBodyHTML(apiResp);
  // Story present.
  assert.match(html, /你一直覺得，現在的自己/);
  assert.match(html, /你就是你的渴望/);
  // Progress bar + 7 step blocks present.
  assert.match(html, /storyboard-progress/);
  for (let n = 1; n <= 7; n++) {
    const padded = String(n).padStart(2, '0');
    assert.match(html, new RegExp(`id="storyboard-step-${padded}"`));
  }
  // Filled steps have content, empty have placeholder.
  assert.match(html, /desc 4/);
  assert.match(html, /我自己說了算/);
  assert.match(html, /這塊土還沒走過/);
});

test('🛑 PR-J4 renderBody: missing API response → 7 empty steps fallback', () => {
  const html = renderStoryboardBodyHTML(null);
  for (let n = 1; n <= 7; n++) {
    const padded = String(n).padStart(2, '0');
    assert.match(html, new RegExp(`id="storyboard-step-${padded}"`));
  }
  assert.match(html, /這塊土還沒走過/);
});

test('🛑 PR-J4 renderBody: XSS in API response → escaped', () => {
  const apiResp = {
    steps: [{
      no: '01', name_zh: '發現匱乏', name_en: 'The Void', state: 'filled',
      brain_state: { description: '<script>alert(1)</script>', quote: null },
      sovereign_action: null,
    }, ...Array.from({ length: 6 }, (_, i) => ({
      no: String(i + 2).padStart(2, '0'), name_zh: STORYBOARD_STEP_META[i + 1].name_zh,
      name_en: STORYBOARD_STEP_META[i + 1].name_en,
      state: 'empty', brain_state: null, sovereign_action: null,
    }))],
    currentStep: null,
  };
  const html = renderStoryboardBodyHTML(apiResp);
  assert.equal(/<script>alert/.test(html), false,
    'XSS: raw <script> must be escaped');
  assert.match(html, /&lt;script&gt;/);
});

// ═════════════════════════════════════════════════════════
// 🛑 sync-gate: student.js carries the verbatim story + helpers
// ═════════════════════════════════════════════════════════

const studentJsSrc = readFileSync(join(repoRoot, 'student.js'), 'utf8');
const indexHtml    = readFileSync(join(repoRoot, 'index.html'), 'utf8');

test('🛑 PR-J4 sync-gate: student.js contains verbatim opening line', () => {
  assert.ok(studentJsSrc.includes('你一直覺得，現在的自己，好像不是全部的自己。'),
    'student.js MUST inline the verbatim story opening');
});

test('🛑 PR-J4 sync-gate: student.js contains verbatim closing line', () => {
  assert.ok(studentJsSrc.includes('你就是你的渴望'),
    'student.js MUST inline the verbatim final closing');
});

test('🛑 PR-J4 sync-gate: student.js inlines 4 temptation verbatim', () => {
  const temptations = [
    '「別人說你好，你才算好。」',
    '「有人愛你，你才有價值。」',
    '「做出成績，你才值得被看見。」',
    '「帳戶裡的數字，就是你這個人的分數。」',
  ];
  for (const t of temptations) {
    assert.ok(studentJsSrc.includes(t), `temptation「${t}」 missing in student.js`);
  }
});

test('🛑 PR-J4 sync-gate: student.js carries 「這塊土還沒走過」 placeholder', () => {
  assert.ok(studentJsSrc.includes('這塊土還沒走過'),
    'empty-step placeholder text must be inlined');
});

test('🛑 PR-J4 sync-gate: student.js has storyboard route + renderStoryboard fn', () => {
  assert.match(studentJsSrc, /case 'storyboard'/);
  assert.match(studentJsSrc, /renderStoryboard/);
});

test('🛑 PR-J4 sync-gate: student.js fetches /api/sc-storyboard', () => {
  assert.match(studentJsSrc, /\/api\/sc-storyboard/);
});

// ═════════════════════════════════════════════════════════
// 🛑 sync-gate: index.html has view-storyboard section + map icon
// ═════════════════════════════════════════════════════════

test('🛑 PR-J4 sync-gate: index.html has <section id="view-storyboard">', () => {
  assert.match(indexHtml, /<section id="view-storyboard"[^>]*class="view/);
});

test('🛑 PR-J4 sync-gate: index.html storyboard header uses MAP icon (not crown)', () => {
  // The header must reference a map (icon, SVG class, or img src "map"/"compass"/路線).
  // Anti-regression: must NOT use 皇冠 / crown.
  const storyboardSection = indexHtml.match(
    /<section id="view-storyboard"[\s\S]*?<\/section>/);
  assert.ok(storyboardSection, 'view-storyboard section must be locatable');
  const sec = storyboardSection[0];
  assert.match(sec, /storyboard-icon|map|地圖|🗺/,
    'header must use map iconography (Patrick spec: 地圖 icon, NOT crown)');
  assert.equal(/crown|皇冠|👑/.test(sec), false,
    'no crown iconography in view-storyboard header');
});

test('🛑 PR-J4 sync-gate: index.html storyboard header carries 「你的 21 天旅途」 title', () => {
  const storyboardSection = indexHtml.match(
    /<section id="view-storyboard"[\s\S]*?<\/section>/);
  assert.ok(storyboardSection);
  assert.match(storyboardSection[0], /你的 21 天旅途/);
});

test('🛑 PR-J4 sync-gate: index.html storyboard has a body container for JS render', () => {
  const storyboardSection = indexHtml.match(
    /<section id="view-storyboard"[\s\S]*?<\/section>/);
  assert.ok(storyboardSection);
  assert.match(storyboardSection[0], /id="storyboard-body"/);
});

// ═════════════════════════════════════════════════════════
// 🛑 6/12 — Story link padding consistency (P0 fix: 點標籤跳回 21 天頁)
// ═════════════════════════════════════════════════════════

test('🛑 6/12 storylink consistency: 每個故事標籤 href 必須對得上 block id (防 SPA router fall-through)', () => {
  // Build a body with all 7 empty step blocks so we can verify every story link
  // hits a real id.
  const apiResp = {
    module: 'self',
    currentStep: null,
    steps: STORYBOARD_STEP_META.map(meta => ({
      no: meta.no, name_zh: meta.name_zh, name_en: meta.name_en,
      state: 'empty', brain_state: null, sovereign_action: null,
    })),
  };
  const html = renderStoryboardBodyHTML(apiResp);
  // Collect all story-step anchor hrefs.
  const linkHrefs = [...html.matchAll(
    /<a class="storyboard-step-link"[^>]*href="(#storyboard-step-\d+)"/g)
  ].map(m => m[1]);
  assert.equal(linkHrefs.length, 7,
    'story body must contain 7 clickable step links');
  // Every link must hit a real block id.
  for (const href of linkHrefs) {
    const id = href.slice(1);
    assert.match(html, new RegExp(`id="${id}"`),
      `story link href ${href} has no matching block id — clicking it falls through to SPA router → bounce to /entry/journey (6/12 P0)`);
  }
  // Progress-bar pip links also must hit real ids.
  const navHrefs = [...html.matchAll(
    /<a class="storyboard-pip[^"]*"[^>]*href="(#storyboard-step-\d+)"/g)
  ].map(m => m[1]);
  assert.equal(navHrefs.length, 7, 'progress bar must contain 7 pip links');
  for (const href of navHrefs) {
    assert.match(html, new RegExp(`id="${href.slice(1)}"`),
      `nav href ${href} has no matching block id`);
  }
});

// ═════════════════════════════════════════════════════════
// 🛑 6/12 Vivi — 故事可展開/收起 (預設收起 + 「展開更多」 toggle)
// ═════════════════════════════════════════════════════════

test('🛑 6/12 collapsible: 故事外層包 .storyboard-arc--collapsed (預設收起)', () => {
  const html = renderStoryboardBodyHTML(null);
  assert.match(html, /class="storyboard-arc storyboard-arc--collapsed"/,
    'wrap must default to arc--collapsed modifier');
  // 內層 .storyboard-story id 仍在 (handler 依賴此 id).
  assert.match(html, /<div class="storyboard-story" id="storyboard-story">/);
});

test('🛑 6/12 collapsible: toggle 是 <button> arc-toggle + aria-expanded=false + 標題/展開', () => {
  const html = renderStoryboardBodyHTML(null);
  // <button type="button"> a11y; 用 anchor 會被 SPA router 抓.
  assert.match(html, /<button type="button" class="storyboard-arc-toggle"/);
  // 預設 collapsed → aria-expanded false.
  assert.match(html, /class="storyboard-arc-toggle"[^>]*aria-expanded="false"/);
  // 對得到內層 story id.
  assert.match(html, /aria-controls="storyboard-story"/);
  // v2 標題 + 展開 peek.
  assert.match(html, /先看這趟旅程的故事線/);
  assert.match(html, /storyboard-arc-peek">展開</);
});

test('🛑 6/12 collapsible: 故事文字 verbatim 完全不變 (包裹外殼不改字)', () => {
  const html = renderStoryboardBodyHTML(null);
  // 開頭逐字、結尾逐字 — 包裹層不能改任一字.
  assert.match(html, /你一直覺得，現在的自己，好像不是全部的自己。/);
  assert.match(html, /你就是你的渴望/);
  // 7 個 step 標題仍全在.
  for (const name of ['發現匱乏', '承認渴望', '挖掘數據', '認領身份', '發現資源', '奪回主權', '新的身分']) {
    assert.ok(html.includes(name), `step label「${name}」 missing after wrap`);
  }
  // 4 誘惑 + 2 反派仍全在.
  assert.match(html, /別人說你好，你才算好/);
  assert.match(html, /帳戶裡的數字/);
  assert.match(html, /限制性信念/);
  assert.match(html, /追求外在認可/);
});

// ═════════════════════════════════════════════════════════
// 🛑 6/12 sync-gate: student.js inline 同步 (padded href + handler 防呆 + collapsible)
// ═════════════════════════════════════════════════════════

test('🛑 6/12 sync-gate: student.js inline renderStoryboardNode step case 用 noPad for href', () => {
  // padStart(2, '0') 對齊 block id; 可見文字仍是 no (單位數).
  assert.match(studentJsSrc, /no\.padStart\(2, '0'\)/,
    'student.js inline must use padStart for href padding');
  assert.match(studentJsSrc, /href="#storyboard-step-' \+ noPad/,
    'student.js inline step case must compose href with noPad (not no)');
});

test('🛑 6/12 sync-gate: handler MUST e.preventDefault() BEFORE target lookup', () => {
  // 防呆鎖 — 防 target null 時落到 SPA router default:
  //   if (!href.startsWith('#storyboard-step-')) return;
  //   e.preventDefault();              ← 必須在這
  //   const target = document.querySelector(href);
  const re = /if \(!href\.startsWith\('#storyboard-step-'\)\) return;[\s\S]{0,400}?e\.preventDefault\(\);[\s\S]{0,100}?const target = document\.querySelector\(href\)/;
  assert.match(studentJsSrc, re,
    'handler must call e.preventDefault() between the startsWith guard and the target lookup');
  // Anti-regression: 舊次序 (target lookup → return-null → preventDefault) 必不再出現.
  const oldRe = /const target = document\.querySelector\(href\);\s*if \(!target\) return;\s*e\.preventDefault\(\);/;
  assert.equal(oldRe.test(studentJsSrc), false,
    'old order (target lookup → return-before-preventDefault) must be gone (6/12 P0)');
});

// ═════════════════════════════════════════════════════════
// 🛑 6/12 Vivi — coach 端 opts (collapsible / expandAllSteps)
// ═════════════════════════════════════════════════════════

test('🛑 6/12 coach opts: collapsible=false → 去掉 --collapsed modifier + 不放 toggle button', () => {
  const html = renderStoryboardBodyHTML(null, { collapsible: false });
  // Wrap 仍在 (固定外殼), 但沒有 --collapsed modifier.
  assert.match(html, /class="storyboard-arc"/);
  assert.equal(/storyboard-arc--collapsed/.test(html), false,
    'coach mode: --collapsed modifier MUST be absent (故事直接全展開)');
  // Toggle button 完全沒出現 (coach 唯讀, 不需互動).
  assert.equal(/storyboard-arc-toggle/.test(html), false,
    'coach mode: 展開更多 toggle button MUST be absent');
  assert.equal(/展開更多/.test(html), false);
});

test('🛑 6/12 coach opts: collapsible=true (default) 仍與舊行為一致 (有 --collapsed + toggle)', () => {
  const a = renderStoryboardBodyHTML(null);  // default
  const b = renderStoryboardBodyHTML(null, {}); // explicit empty
  assert.match(a, /storyboard-arc--collapsed/);
  assert.match(a, /storyboard-arc-toggle[^>]*aria-expanded="false"/);
  assert.match(b, /storyboard-arc--collapsed/);
});

test('🛑 6/12 coach opts: expandAllSteps=true → 7 步 aria-expanded 全為 true (body 全不 hidden)', () => {
  const html = renderStoryboardBodyHTML(null, { expandAllSteps: true });
  // 7 步的 toggle button 全 aria-expanded=true.
  const expandedTrue = (html.match(/aria-expanded="true"/g) || []).length;
  assert.ok(expandedTrue >= 7,
    `expandAllSteps=true: 7 step blocks must all have aria-expanded=true (got ${expandedTrue})`);
  // 沒任何 false (排除 storyboard-arc-toggle, 但 collapsible=true 是 default 仍會放 toggle).
  // 為了精確檢, 直接 collapsible=false 再驗.
  const html2 = renderStoryboardBodyHTML(null, { expandAllSteps: true, collapsible: false });
  assert.equal(/aria-expanded="false"/.test(html2), false,
    'coach combo: 0 aria-expanded=false anywhere (all 7 steps open + no story toggle)');
});

test('🛑 6/12 coach opts: 默認 (沒傳 opts) — 只 step_01 expanded, 其餘 collapsed (student 不 regress)', () => {
  const html = renderStoryboardBodyHTML(null);
  const expandedTrue = (html.match(/aria-expanded="true"/g) || []).length;
  const expandedFalse = (html.match(/aria-expanded="false"/g) || []).length;
  // 1 step_01 + 1 story toggle (collapsible default true) 不會把這算進來
  // (story toggle 是 false, 不是 true). 所以 step_01 真 expand=1, 其他 6 步 + story toggle = 7 個 false.
  assert.equal(expandedTrue, 1,
    'default: only step_01 expanded → exactly 1 aria-expanded=true');
  assert.equal(expandedFalse, 7,
    'default: 6 step blocks collapsed + 1 story toggle = 7 aria-expanded=false');
});

test('🛑 6/12 coach opts: full happy combo (collapsible=false + expandAllSteps=true) — review-friendly markup', () => {
  const apiResp = {
    module: 'self',
    currentStep: 4,
    steps: [1, 2, 3, 4, 5, 6, 7].map(n => ({
      no: String(n).padStart(2, '0'),
      name_zh: STORYBOARD_STEP_META[n - 1].name_zh,
      name_en: STORYBOARD_STEP_META[n - 1].name_en,
      state: n <= 4 ? 'filled' : 'empty',
      brain_state: n <= 4 ? { description: `desc ${n}`, quote: null } : null,
      sovereign_action: n <= 4 ? `主權 ${n}。我自己說了算。` : null,
    })),
  };
  const html = renderStoryboardBodyHTML(apiResp, { collapsible: false, expandAllSteps: true });
  // Story 全展開 (沒 --collapsed, 沒 toggle).
  assert.equal(/storyboard-arc--collapsed|storyboard-arc-toggle/.test(html), false);
  // 7 步全展開.
  assert.equal((html.match(/aria-expanded="true"/g) || []).length, 7);
  // 故事 verbatim 仍在.
  assert.match(html, /你一直覺得，現在的自己/);
  assert.match(html, /你就是你的渴望/);
  // Filled steps render content.
  assert.match(html, /desc 4/);
  assert.match(html, /我自己說了算/);
  // Empty steps render placeholder.
  assert.match(html, /這塊土還沒走過/);
});

test('🛑 6/12 sync-gate: student.js inlines collapsible wrap + toggle markup', () => {
  assert.ok(studentJsSrc.includes('storyboard-arc--collapsed'),
    'student.js inline must wrap story in collapsible container (6/12)');
  assert.ok(studentJsSrc.includes('storyboard-arc-toggle'),
    'student.js inline must include arc toggle 標題');
  assert.ok(studentJsSrc.includes('先看這趟旅程的故事線'),
    'default toggle label「展開更多」 must be inlined');
  assert.ok(studentJsSrc.includes('收起'),
    'expanded toggle label「收起」 must be inlined');
  // Toggle handler must flip aria-expanded.
  assert.match(studentJsSrc, /storyToggle\.setAttribute\('aria-expanded'/,
    'inline handler must toggle aria-expanded on the story toggle button');
});
