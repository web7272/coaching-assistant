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
