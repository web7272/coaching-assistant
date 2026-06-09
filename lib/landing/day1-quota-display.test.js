// lib/landing/day1-quota-display.test.js — Patrick 6/7 + 6/8 v2 sync-gate.
//
// The Day-1 quota display logic in landing.html is inline (vanilla DOM, no
// build step). This test runs against the raw file contents to verify the
// 3 required branches exist + 6/8 v2 funnel rules (no option-1 path on
// landing; #cta-quota-3 in info panel by id; new text wording).
//
// Pattern matches established "sentinel-marked inline mirror" approach.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const landingPath = join(__dirname, '..', '..', 'landing.html');
const html = readFileSync(landingPath, 'utf8');

// ─── Existence of the quota fetcher IIFE ──────────────────────────

test('🛑 6/7 landing: initDay1Quota IIFE exists', () => {
  assert.match(html, /async function initDay1Quota\s*\(/);
});

test('🛑 6/7 landing: fetches GET /api/day1-quota', () => {
  // Use the endpoint we defined in §3.
  assert.match(html, /fetch\(['"]\/api\/day1-quota['"]/);
});

test('🛑 6/7 landing: quota fetch sends credentials:omit (no PII)', () => {
  // No cookies on this endpoint — it's public, no PII.
  assert.match(html, /\/api\/day1-quota[^)]*credentials\s*:\s*['"]omit['"]/);
});

// ─── 3 branches: remaining > 0 / ≤ 0 / fail-open (6/8 v2 wording) ─────

test('🛑 6/8 v2 landing: branch "remaining > 0" → 「深度對話剩餘名額：N」', () => {
  // 6/8 v2 spec wording (was「本月剩餘 Day-1 名額」).
  assert.match(html, /深度對話剩餘名額/);
  // Anti-regression: old wording must not co-exist (避免文案二相人混淆).
  assert.equal(/本月剩餘 Day-1 名額/.test(html), false,
    '6/8 v2: old「本月剩餘 Day-1 名額」 wording must be gone');
});

test('🛑 6/8 v2 landing: branch "remaining ≤ 0" → bar 文字「深度對話名額已滿」', () => {
  // 6/8 v2: 不再 swap 已不存在的右卡標題;僅 bar 文字改.
  assert.match(html, /深度對話名額已滿/);
  // Anti-regression: old card-title-swap copy must not remain (info panel 沒這些
  // titleEl/descEl/goEl swap target 了).
  assert.equal(/本月 Day-1 名額已滿/.test(html), false,
    '6/8 v2: old「本月 Day-1 名額已滿」 wording must be gone (no card title swap)');
  assert.equal(/留 email[^<]*進候補/.test(html), false,
    '6/8 v2: old「留 email 進候補」 CTA-swap copy must be gone');
});

test('🛑 6/7 landing: branch "fetch 失敗" → fail-open (try/catch present)', () => {
  const iife = html.match(/async function initDay1Quota[\s\S]*?\}\)\(\)/);
  assert.ok(iife, 'initDay1Quota IIFE must be located');
  assert.match(iife[0], /try\s*\{[\s\S]*?\}\s*catch\s*\(/);
  // fail-open posture: catch must clear the quota element (no error UI shown).
  assert.match(iife[0], /catch[\s\S]*?quotaEl\.classList\.remove/);
});

test('🛑 6/8 v2 landing: IIFE locates quotaEl by id (not by .cta-card[data-opt="3"] descendant)', () => {
  // 6/8 v2 rewire: #cta-quota-3 moved OUT of the action card to the info
  // panel. JS must use document.getElementById('cta-quota-3') (or equivalent
  // root-level lookup) — NOT a card.querySelector inside data-opt=3.
  const iife = html.match(/async function initDay1Quota[\s\S]*?\}\)\(\)/);
  assert.ok(iife);
  // Positive: root-level id lookup present.
  assert.match(iife[0], /document\.getElementById\(\s*['"]cta-quota-3['"]\s*\)/);
  // Negative: no card-scoped descendant query for quotaEl/titleEl/descEl/goEl
  // (those swap targets no longer exist in v2).
  assert.equal(/card\.querySelector\(\s*['"]#cta-quota-3['"]\s*\)/.test(iife[0]), false,
    'quotaEl must not be looked up via card.querySelector (id is root-level now)');
  assert.equal(/titleEl|descEl|goEl/.test(iife[0]), false,
    'v2 IIFE must not reference titleEl/descEl/goEl (card-title swap removed)');
});

// ─── 6/8 v2 鐵: NO option-1 path on landing ─────────────────────

test('🛑 6/8 v2: landing has NO data-opt="1" element (option-1 整套移除)', () => {
  // PDF-only option-1 entry point removed from landing. Backend
  // /api/request-guide still accepts option=1, but landing never invokes it.
  assert.equal(/data-opt=["']1["']/.test(html), false,
    'landing must NOT carry any data-opt="1" anchor (option-1 path removed)');
});

test('🛑 6/8 v2: landing has NO ctaSubmit(event, 1) — option-1 form path removed', () => {
  // The only ctaSubmit call left on landing must be option 3.
  assert.equal(/ctaSubmit\(\s*event\s*,\s*1\s*\)/.test(html), false,
    'landing must NOT submit option=1 (path removed; backend untouched)');
  // option 3 still present.
  assert.match(html, /ctaSubmit\(\s*event\s*,\s*3\s*\)/);
});

// ─── 6/8 v2: action card structure (left card) ──────────────────

test('🛑 6/8 v2: action card data-opt="3" still exists with form + 3-question quiz', () => {
  const actionCard = html.match(
    /<div class="cta-card"[^>]*data-opt="3"[\s\S]*?<\/form>\s*<\/div>/,
  );
  assert.ok(actionCard, 'action card (data-opt="3") block must be locatable');
  // 3-question quiz intact.
  assert.match(actionCard[0], /name="q1"/);
  assert.match(actionCard[0], /name="q2"/);
  assert.match(actionCard[0], /name="q3"/);
  // ctaSubmit(event, 3) wired.
  assert.match(actionCard[0], /onsubmit="ctaSubmit\(event,\s*3\)"/);
  // 6/8 v2 new copy.
  assert.match(actionCard[0], /立刻領取《價值觀挖掘練習PDF》＋免費解鎖 AI 教練體驗/);
  // 6/8 v2 button styling on CTA.
  assert.match(actionCard[0], /class="cta-go cta-go--btn"/);
  // 6/8 v2 button text.
  assert.match(actionCard[0], />兩個都要</);
});

test('🛑 6/8 v2: info panel (right) has #cta-quota-3 + v2 copy + no form/button', () => {
  // Locate the info panel block. Anchor by the info-only id.
  const infoPanel = html.match(
    /<div class="cta-card alt info"[^>]*id="cta-info-panel"[\s\S]*?<\/div>\s*<\/div>/,
  );
  assert.ok(infoPanel, 'info panel block must be locatable');
  // Quota bar at top.
  assert.match(infoPanel[0], /id="cta-quota-3"/);
  // v2 copy snippet.
  assert.match(infoPanel[0], /模擬真實教練對話的方式，用 21 天對話陪你探索自己/);
  // No form / submit button / email input — pure info.
  assert.equal(/<form/.test(infoPanel[0]), false,
    'info panel must NOT contain a form');
  assert.equal(/type="email"/.test(infoPanel[0]), false,
    'info panel must NOT contain an email input');
  assert.equal(/type="submit"/.test(infoPanel[0]), false,
    'info panel must NOT contain a submit button');
});

// ─── 6/8 v2: hero header polish ─────────────────────────────────

test('🛑 6/8 v2 hero: h1 is 3 lines (br before glow span)', () => {
  // Vivi 6/8 v2 spec: 「他/她想要什麼」 on line 3 (extra <br> before glow span).
  assert.match(html,
    /<h1 class="htag">你照顧了所有人。<br>只剩一個人，你還沒問過<br><span class="glow">他\/她想要什麼<\/span>。<\/h1>/);
});

test('🛑 6/8 v2 hero: 「從這裡開始」cta-label 已移除', () => {
  // The cta-label paragraph + its dedicated CSS rule should be gone.
  assert.equal(/從這裡開始/.test(html), false);
  assert.equal(/\.cta-label\s*\{/.test(html), false,
    'orphan .cta-label CSS rule must also be removed');
});

test('🛑 6/8 v2 CSS: htag line-height 收緊 + brandmark margin 縮小', () => {
  // line-height range allowed: 1.3-1.45 per spec (1.55 → 1.35-1.4).
  const htagMatch = html.match(/\.htag\s*\{[^}]*line-height\s*:\s*([\d.]+)/);
  assert.ok(htagMatch, '.htag CSS rule must define line-height');
  const lh = parseFloat(htagMatch[1]);
  assert.ok(lh >= 1.30 && lh <= 1.45,
    `.htag line-height should be in [1.30, 1.45]; got ${lh}`);
  // brandmark bottom margin tighter than the previous 36px.
  const brandMatch = html.match(/\.brandmark\s*\{[^}]*margin\s*:\s*0\s+0\s+(\d+)px/);
  assert.ok(brandMatch, '.brandmark CSS rule must define margin');
  const bm = parseInt(brandMatch[1], 10);
  assert.ok(bm < 36,
    `.brandmark margin-bottom should be tighter than 36px; got ${bm}px`);
});

// ─── form submission still routes through /api/request-guide ─────

test('🛑 6/7 form action unchanged — ctaSubmit still calls /api/request-guide', () => {
  // The display logic must NOT change the form-submit target. Quota-full
  // case: form still submits, backend gate handles waitlist + PDF send.
  assert.match(html, /fetch\(['"]\/api\/request-guide['"]/);
});

test('🛑 6/7 + 6/8 v2: action card form has onsubmit="ctaSubmit(event, 3)" (option 3 is the only path)', () => {
  // 6/8 v2: option 3 is the ONLY form-submit path on landing.
  assert.match(html, /<form class="cta-form" onsubmit="ctaSubmit\(event,\s*3\)"/);
});

// ─── 6/8 v2 third batch (F): hlead 整段廢 + #story 上方收緊 + 金色 span ────

test('🛑 6/8 v2-F14: <p class="hlead"> 整段已移除', () => {
  assert.equal(/class=["']hlead["']/.test(html), false,
    'hlead element must be gone (Vivi 6/8 third batch)');
  // Old hlead copy must not survive elsewhere.
  assert.equal(/不是另一堂自我成長課/.test(html), false,
    'hlead copy「不是另一堂自我成長課」 must not remain');
  assert.equal(/被.*好問題.*陪伴的一段旅程/.test(html), false,
    'hlead copy「被好問題陪伴的一段旅程」 must not remain');
});

test('🛑 6/8 v2-F14: orphan .hlead CSS rule 一併移除', () => {
  assert.equal(/\.hlead\s*\{/.test(html), false,
    'orphan .hlead CSS rule must also be removed');
});

test('🛑 6/8 v2-F15: #story padding-top 收緊 (< 70px 預設 .scene padding)', () => {
  // Spec: 標題離上面卡片近一點. Vivi eyeball; CC 設 #story{padding-top:Npx}
  // where N < 70 (default .scene padding-top).
  const m = html.match(/#story\s*\{[^}]*padding-top\s*:\s*(\d+)px/);
  assert.ok(m, '#story rule must define padding-top override');
  const pt = parseInt(m[1], 10);
  assert.ok(pt < 70, `#story padding-top should be < 70px (default); got ${pt}px`);
});

test('🛑 6/8 v2-F16/F17: 3 phrases wrapped in <span class="gold"> inside #story', () => {
  // F16a: 真正想成為什麼樣的人
  assert.match(html, /<span class="gold">真正想成為什麼樣的人<\/span>/);
  // F16b: 每天陪在你身邊
  assert.match(html, /<span class="gold">每天陪在你身邊<\/span>/);
  // F17:  .seed contains 「一位最懂你的教練」 in gold (他→你 substitution).
  const seed = html.match(/<p class="seed">[\s\S]*?<\/p>/);
  assert.ok(seed, '.seed paragraph must be locatable');
  assert.match(seed[0], /<span class="gold">一位最懂你的教練<\/span>/);
});

test('🛑 6/8 v2-F17 anti-regression: 「一位最懂他的教練」 (他) 已換成「你」 inside .seed', () => {
  const seed = html.match(/<p class="seed">[\s\S]*?<\/p>/);
  assert.ok(seed, '.seed paragraph must be locatable');
  assert.equal(/一位最懂他的教練/.test(seed[0]), false,
    '.seed: 「一位最懂他的教練」 (他) must be substituted to 你');
});

// ─── 6/8 v2 third batch (G): section reorder + ctaJump + 4 mid-page CTA ──

test('🛑 6/8 v2-G18: <section id="vs"> appears BEFORE <section id="story">', () => {
  // Vivi: 先給利益/解答, 再講故事, 免得被滑走.
  const vsIdx    = html.indexOf('<section class="scene" id="vs">');
  const storyIdx = html.indexOf('<section class="scene" id="story">');
  assert.ok(vsIdx > 0, 'vs section must exist');
  assert.ok(storyIdx > 0, 'story section must exist');
  assert.ok(vsIdx < storyIdx,
    `#vs (idx ${vsIdx}) must come before #story (idx ${storyIdx})`);
});

test('🛑 6/8 v2-G19: ctaJump() 鎖 [data-opt="3"] action card (左卡 semantic) + comment 同步', () => {
  // ctaJump must select the action card by data-opt (position-agnostic);
  // since A-E only the LEFT card carries data-opt="3", this points to the
  // action card correctly. Test the selector + the updated comment.
  const fn = html.match(/window\.ctaJump\s*=\s*function[\s\S]*?\};/);
  assert.ok(fn, 'ctaJump function must exist');
  assert.match(fn[0], /\.cta-card\[data-opt=["']3["']\]/,
    'ctaJump must select via [data-opt="3"] (action card)');
  // Anti-regression: comment must NOT still say 「右卡」 (semantically wrong
  // after A-E moved option-3 to LEFT).
  const lead = html.match(/\/\/[^\n]*ctaJump[\s\S]{0,500}?window\.ctaJump/);
  assert.ok(lead, 'ctaJump comment block must be locatable');
  assert.equal(/跳回 Hero 右卡/.test(lead[0]), false,
    'ctaJump comment must not still say 「跳回 Hero 右卡」 (post A-E 已搬左卡)');
  assert.match(lead[0], /左卡|action card/,
    'ctaJump comment must reference 左卡 / action card semantic');
});

test('🛑 6/8 v2-G19: ctaJump still scrolls + opens + focuses first radio', () => {
  const fn = html.match(/window\.ctaJump\s*=\s*function[\s\S]*?\};/);
  assert.ok(fn);
  assert.match(fn[0], /scrollIntoView/);
  assert.match(fn[0], /classList\.add\(['"]open['"]\)/);
  assert.match(fn[0], /input\[type=radio\][\s\S]*?\.focus/);
});

test('🛑 6/8 v2-G20: 4 mid-page CTAs reading 「立刻領取 →」 (was 「免費體驗 Day 1 →」)', () => {
  // 4 occurrences of <a class="btn ghost" onclick="ctaJump()">立刻領取 →</a>.
  const matches = html.match(/<a class="btn ghost"[^>]*onclick="ctaJump\(\)"[^>]*>立刻領取 →<\/a>/g);
  assert.ok(matches, 'mid-page CTAs must exist');
  assert.equal(matches.length, 4,
    `expected exactly 4 ctaJump CTAs reading 「立刻領取 →」; found ${matches?.length ?? 0}`);
});

test('🛑 6/8 v2-G20 anti-regression: NO ctaJump CTA still reads 「免費體驗 Day 1 →」', () => {
  // FAQ copy can mention「免費體驗 Day 1」 freely; only the ctaJump anchor text
  // is locked to「立刻領取 →」.
  assert.equal(
    /<a class="btn ghost"[^>]*onclick="ctaJump\(\)"[^>]*>免費體驗 Day 1 →<\/a>/.test(html),
    false,
    'no btn-ghost ctaJump anchor may still read 「免費體驗 Day 1 →」');
});
