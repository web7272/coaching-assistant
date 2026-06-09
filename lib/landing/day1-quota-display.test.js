// lib/landing/day1-quota-display.test.js
// Patrick 6/7 / 6/8 v2 / 6/8 v3 設計師 (止血線 + 首屏卸貨) sync-gate.
//
// The Day-1 scarcity display logic in landing.html is inline (vanilla DOM,
// no build step). This test runs against the raw file contents to verify:
//
//   • IIFE shape + endpoint contract (no PII).
//   • 3-branch threshold display: >threshold 質性 / ≤threshold 「只剩 N」 / ≤0 已滿.
//   • fail-open: fetch fails → 該行留空 (不擋頁、不顯示 0 或錯字).
//   • #cta-scarcity 在左 action 卡內、「兩個都要」按鈕之前 (位置鎖).
//   • 右資訊面板 (cta-info-panel) 整塊已移除 (首屏卸貨).
//   • 6/8 v2 funnel rules survive (no data-opt=1 path, no ctaSubmit option=1).
//   • Hero polish survives (h1 3-line, cta-label 廢, .htag line-height, etc.).
//   • F/G batch survives (hlead 廢, 3 gold spans, .seed 改字, section order,
//     ctaJump 指左卡, 4 mid-page CTAs 「立刻領取 →」).

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
  assert.match(html, /fetch\(['"]\/api\/day1-quota['"]/);
});

test('🛑 6/7 landing: quota fetch sends credentials:omit (no PII)', () => {
  assert.match(html, /\/api\/day1-quota[^)]*credentials\s*:\s*['"]omit['"]/);
});

// ─── 6/8 v3 設計師: 3-branch threshold display ──────────────────────

test('🛑 6/8 v3 landing: reads scarcity_threshold from response', () => {
  const iife = html.match(/async function initDay1Quota[\s\S]*?\}\)\(\)/);
  assert.ok(iife, 'initDay1Quota IIFE must be located');
  // Must Number()-cast and clamp >=0 (same defensive pattern as remaining).
  assert.match(iife[0], /scarcity_threshold/);
  assert.match(iife[0],
    /threshold\s*=\s*Math\.max\(\s*0\s*,\s*Number\([^)]*scarcity_threshold[^)]*\)\s*\|\|\s*0\s*\)/);
});

test('🛑 6/8 v3 landing: branch "remaining > threshold" → 質性 1000 席 verbatim', () => {
  // Verbatim Patrick 6/8 spec (逐字).
  assert.match(html,
    /第一階段限量 1,000 席,我們正在尋找這 1,000 位認真想看見自己的人。/);
});

test('🛑 6/8 v3 landing: branch "0 < remaining ≤ threshold" → 「只剩 N 個名額」 (N = remaining)', () => {
  const iife = html.match(/async function initDay1Quota[\s\S]*?\}\)\(\)/);
  assert.ok(iife);
  // 只剩 + remaining + 個名額 串接 (N 是動態 remaining 值).
  assert.match(iife[0], /['"]只剩 ['"]\s*\+\s*remaining\s*\+\s*['"] 個名額['"]/);
});

test('🛑 6/8 v3 landing: branch "remaining ≤ 0" → 「名額已滿」 + .full class', () => {
  const iife = html.match(/async function initDay1Quota[\s\S]*?\}\)\(\)/);
  assert.ok(iife);
  // Spec wording: 「名額已滿」 (沿用既有額滿措辭, shorter than v2「深度對話名額已滿」).
  assert.match(iife[0], /['"]名額已滿['"]/);
  // .full class added so red styling kicks in.
  assert.match(iife[0], /classList\.add\(['"]show['"],\s*['"]full['"]\)/);
});

test('🛑 6/8 v3 landing: fail-open → 留空 (textContent="" + classList remove)', () => {
  const iife = html.match(/async function initDay1Quota[\s\S]*?\}\)\(\)/);
  assert.ok(iife);
  // catch block must clear text and remove show/full classes (no error UI).
  const catchBlock = iife[0].match(/catch\s*\([^)]*\)\s*\{([\s\S]*?)\}\s*\}\)\(\)/);
  assert.ok(catchBlock, 'catch block must be locatable');
  assert.match(catchBlock[1], /classList\.remove\(['"]show['"],\s*['"]full['"]\)/);
  assert.match(catchBlock[1], /textContent\s*=\s*['"]['"]/);
});

test('🛑 6/8 v3 landing: IIFE locates element by id="cta-scarcity" (renamed from cta-quota-3)', () => {
  const iife = html.match(/async function initDay1Quota[\s\S]*?\}\)\(\)/);
  assert.ok(iife);
  assert.match(iife[0], /document\.getElementById\(\s*['"]cta-scarcity['"]\s*\)/);
  // Anti-regression: old card-scoped lookup and old id must NOT survive.
  assert.equal(/card\.querySelector\(\s*['"]#cta-quota/.test(iife[0]), false,
    'old card-scoped querySelector for #cta-quota must be gone');
  assert.equal(/getElementById\(\s*['"]cta-quota-3['"]\s*\)/.test(iife[0]), false,
    'old #cta-quota-3 id must NOT be referenced by IIFE');
});

// ─── 6/8 v3 anti-regression: old display logic removed ───────────────

test('🛑 6/8 v3 anti-regression: 舊「深度對話剩餘名額」 / 「深度對話名額已滿」 已廢', () => {
  // v2 直接顯示原始 remaining 數的邏輯廢, 由門檻三分支取代.
  const iife = html.match(/async function initDay1Quota[\s\S]*?\}\)\(\)/);
  assert.ok(iife);
  assert.equal(/深度對話剩餘名額/.test(iife[0]), false,
    'IIFE 不再使用「深度對話剩餘名額：N」 字串');
  assert.equal(/深度對話名額已滿/.test(iife[0]), false,
    'IIFE 不再使用「深度對話名額已滿」 字串');
});

// ─── 6/8 v3: position lock — #cta-scarcity 在左卡內、「兩個都要」上方 ──

test('🛑 6/8 v3 landing: #cta-scarcity 出現在左 action 卡 (data-opt="3") 內', () => {
  const actionCard = html.match(
    /<div class="cta-card"[^>]*data-opt="3"[\s\S]*?<\/form>\s*<\/div>/,
  );
  assert.ok(actionCard, 'action card (data-opt="3") block must be locatable');
  assert.match(actionCard[0], /id="cta-scarcity"/);
});

test('🛑 6/8 v3 landing: #cta-scarcity 在「兩個都要」(cta-go--btn) 按鈕之前 (推力最大時刻)', () => {
  const actionCard = html.match(
    /<div class="cta-card"[^>]*data-opt="3"[\s\S]*?<\/form>\s*<\/div>/,
  );
  assert.ok(actionCard);
  const scarcityIdx = actionCard[0].indexOf('id="cta-scarcity"');
  const btnIdx      = actionCard[0].indexOf('class="cta-go cta-go--btn"');
  assert.ok(scarcityIdx > 0, 'scarcity must exist in action card');
  assert.ok(btnIdx > 0,      '兩個都要 button must exist in action card');
  assert.ok(scarcityIdx < btnIdx,
    `#cta-scarcity (idx ${scarcityIdx}) must come before cta-go--btn (idx ${btnIdx})`);
});

// ─── 6/8 v3: 首屏卸貨 — right info panel removed ────────────────────

test('🛑 6/8 v3 landing: 右資訊面板 (cta-info-panel) 整塊已移除', () => {
  // The "<div class=\"cta-card alt info\" id=\"cta-info-panel\">…</div>" block
  // is gone. Comment notes are OK; the live DIV must not exist.
  assert.equal(/<div[^>]*id="cta-info-panel"/.test(html), false,
    'live <div id="cta-info-panel"> must be gone (首屏卸貨)');
  assert.equal(/<div[^>]*class="cta-card alt info"/.test(html), false,
    '<div class="cta-card alt info"> must be gone');
  // Old info-panel copy (verbatim spec snippet that was IN the panel) must
  // not survive on landing.
  assert.equal(
    /模擬真實教練對話的方式，用 21 天對話陪你探索自己/.test(html),
    false,
    'old info-panel copy must be gone (AI 教練說明已在 #story / 21天段)');
  assert.equal(
    /現正限量招募 1000 位 Day 1 免費體驗員/.test(html),
    false,
    'old info-panel copy「1000 位 Day 1 免費體驗員」 must be gone (在 #status)');
});

test('🛑 6/8 v3 landing: .cta-pair single-column layout (max-width 收窄)', () => {
  // grid-template-columns:1fr (1 column, was 1fr 1fr). max-width reduced
  // so the single action card doesn't sprawl full-width.
  const ctaPair = html.match(/\.cta-pair\s*\{[^}]*\}/);
  assert.ok(ctaPair, '.cta-pair CSS rule must exist');
  assert.match(ctaPair[0], /grid-template-columns\s*:\s*1fr(?!\s+1fr)/,
    '.cta-pair must be single column (1fr, not 1fr 1fr)');
  const mw = ctaPair[0].match(/max-width\s*:\s*(\d+)px/);
  assert.ok(mw, '.cta-pair must define max-width');
  const w = parseInt(mw[1], 10);
  assert.ok(w <= 500,
    `.cta-pair max-width should be ≤500px (single card, not sprawl); got ${w}px`);
});

// ─── 6/8 v2 鐵 (survives v3): NO option-1 path on landing ─────────

test('🛑 6/8 v2: landing has NO data-opt="1" element (option-1 整套移除)', () => {
  assert.equal(/data-opt=["']1["']/.test(html), false,
    'landing must NOT carry any data-opt="1" anchor (option-1 path removed)');
});

test('🛑 6/8 v2: landing has NO ctaSubmit(event, 1) — option-1 form path removed', () => {
  assert.equal(/ctaSubmit\(\s*event\s*,\s*1\s*\)/.test(html), false,
    'landing must NOT submit option=1 (path removed; backend untouched)');
  assert.match(html, /ctaSubmit\(\s*event\s*,\s*3\s*\)/);
});

// ─── 6/8 v2 / v3: action card structure (left card) ───────────────

test('🛑 6/8 v2/v3: action card data-opt="3" still exists with form + 3-question quiz', () => {
  const actionCard = html.match(
    /<div class="cta-card"[^>]*data-opt="3"[\s\S]*?<\/form>\s*<\/div>/,
  );
  assert.ok(actionCard, 'action card (data-opt="3") block must be locatable');
  assert.match(actionCard[0], /name="q1"/);
  assert.match(actionCard[0], /name="q2"/);
  assert.match(actionCard[0], /name="q3"/);
  assert.match(actionCard[0], /onsubmit="ctaSubmit\(event,\s*3\)"/);
  assert.match(actionCard[0], /立刻領取《價值觀挖掘練習PDF》＋免費解鎖 AI 教練體驗/);
  assert.match(actionCard[0], /class="cta-go cta-go--btn"/);
  assert.match(actionCard[0], />兩個都要</);
});

// ─── 6/8 v2 hero polish (survives v3) ────────────────────────────

test('🛑 6/8 v2 hero: h1 is 3 lines (br before glow span)', () => {
  assert.match(html,
    /<h1 class="htag">你照顧了所有人。<br>只剩一個人，你還沒問過<br><span class="glow">他\/她想要什麼<\/span>。<\/h1>/);
});

test('🛑 6/8 v2 hero: 「從這裡開始」cta-label 已移除', () => {
  assert.equal(/從這裡開始/.test(html), false);
  assert.equal(/\.cta-label\s*\{/.test(html), false,
    'orphan .cta-label CSS rule must also be removed');
});

test('🛑 6/8 v2 CSS: htag line-height 收緊 + brandmark margin 縮小', () => {
  const htagMatch = html.match(/\.htag\s*\{[^}]*line-height\s*:\s*([\d.]+)/);
  assert.ok(htagMatch);
  const lh = parseFloat(htagMatch[1]);
  assert.ok(lh >= 1.30 && lh <= 1.45, `.htag line-height should be in [1.30, 1.45]; got ${lh}`);
  const brandMatch = html.match(/\.brandmark\s*\{[^}]*margin\s*:\s*0\s+0\s+(\d+)px/);
  assert.ok(brandMatch);
  const bm = parseInt(brandMatch[1], 10);
  assert.ok(bm < 36, `.brandmark margin-bottom should be tighter than 36px; got ${bm}px`);
});

// ─── form submission still routes through /api/request-guide ──────

test('🛑 6/7 form action unchanged — ctaSubmit still calls /api/request-guide', () => {
  assert.match(html, /fetch\(['"]\/api\/request-guide['"]/);
});

test('🛑 6/7 + 6/8 v2: action card form has onsubmit="ctaSubmit(event, 3)" (option 3 only)', () => {
  assert.match(html, /<form class="cta-form" onsubmit="ctaSubmit\(event,\s*3\)"/);
});

// ─── 6/8 v2 F batch (survives v3): #story polish ──────────────────

test('🛑 6/8 v2-F14: <p class="hlead"> 整段已移除', () => {
  assert.equal(/class=["']hlead["']/.test(html), false);
  assert.equal(/不是另一堂自我成長課/.test(html), false);
});

test('🛑 6/8 v2-F14: orphan .hlead CSS rule 一併移除', () => {
  assert.equal(/\.hlead\s*\{/.test(html), false);
});

test('🛑 6/8 v2-F15: #story padding-top 收緊 (< 70px 預設 .scene padding)', () => {
  const m = html.match(/#story\s*\{[^}]*padding-top\s*:\s*(\d+)px/);
  assert.ok(m);
  const pt = parseInt(m[1], 10);
  assert.ok(pt < 70, `#story padding-top should be < 70px; got ${pt}px`);
});

test('🛑 6/8 v2-F16/F17: 3 phrases wrapped in <span class="gold"> inside #story', () => {
  assert.match(html, /<span class="gold">真正想成為什麼樣的人<\/span>/);
  assert.match(html, /<span class="gold">每天陪在你身邊<\/span>/);
  const seed = html.match(/<p class="seed">[\s\S]*?<\/p>/);
  assert.ok(seed);
  assert.match(seed[0], /<span class="gold">一位最懂你的教練<\/span>/);
});

test('🛑 6/8 v2-F17 anti-regression: 「一位最懂他的教練」 (他) 已換成「你」 inside .seed', () => {
  const seed = html.match(/<p class="seed">[\s\S]*?<\/p>/);
  assert.ok(seed);
  assert.equal(/一位最懂他的教練/.test(seed[0]), false);
});

// ─── 6/8 v2 G batch (survives v3): section reorder + ctaJump + CTAs ──

test('🛑 6/8 v2-G18: <section id="vs"> appears BEFORE <section id="story">', () => {
  const vsIdx    = html.indexOf('<section class="scene" id="vs">');
  const storyIdx = html.indexOf('<section class="scene" id="story">');
  assert.ok(vsIdx > 0);
  assert.ok(storyIdx > 0);
  assert.ok(vsIdx < storyIdx);
});

test('🛑 6/8 v2-G19: ctaJump() 鎖 [data-opt="3"] action card (左卡 semantic)', () => {
  const fn = html.match(/window\.ctaJump\s*=\s*function[\s\S]*?\};/);
  assert.ok(fn);
  assert.match(fn[0], /\.cta-card\[data-opt=["']3["']\]/);
  const lead = html.match(/\/\/[^\n]*ctaJump[\s\S]{0,500}?window\.ctaJump/);
  assert.ok(lead);
  assert.equal(/跳回 Hero 右卡/.test(lead[0]), false);
  assert.match(lead[0], /左卡|action card/);
});

test('🛑 6/8 v2-G19: ctaJump still scrolls + opens + focuses first radio', () => {
  const fn = html.match(/window\.ctaJump\s*=\s*function[\s\S]*?\};/);
  assert.ok(fn);
  assert.match(fn[0], /scrollIntoView/);
  assert.match(fn[0], /classList\.add\(['"]open['"]\)/);
  assert.match(fn[0], /input\[type=radio\][\s\S]*?\.focus/);
});

test('🛑 6/8 v2-G20: 4 mid-page CTAs reading 「立刻領取 →」', () => {
  const matches = html.match(/<a class="btn ghost"[^>]*onclick="ctaJump\(\)"[^>]*>立刻領取 →<\/a>/g);
  assert.ok(matches);
  assert.equal(matches.length, 4);
});

test('🛑 6/8 v2-G20 anti-regression: NO ctaJump CTA still reads 「免費體驗 Day 1 →」', () => {
  assert.equal(
    /<a class="btn ghost"[^>]*onclick="ctaJump\(\)"[^>]*>免費體驗 Day 1 →<\/a>/.test(html),
    false);
});
