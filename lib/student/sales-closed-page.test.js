// lib/student/sales-closed-page.test.js
//
// 6/7 Vivi 商業模型 — verbatim copy + DOM structure lock for index.html's
// #/upgrade view. Two sub-sections must exist (sales-open dormant, sales-closed
// default). The thank-you copy is Vivi 6/7 終審 verbatim, 不改一字.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function readIndexHtml() {
  const here = dirname(fileURLToPath(import.meta.url));
  const path = join(here, '..', '..', 'index.html');
  return readFileSync(path, 'utf8');
}

// ─── DOM structure: both sub-sections must exist ───────────────────

test('🛑 6/7 #/upgrade: both sub-sections exist (sales-open + sales-closed)', () => {
  const html = readIndexHtml();
  assert.match(html, /id="upgrade-sales-open"/,
    'sales-open div must exist (NT$3,000 + Stripe payment page, dormant by default)');
  assert.match(html, /id="upgrade-sales-closed"/,
    'sales-closed div must exist (thank-you + opening-notification, default this wave)');
});

test('🛑 6/7 #/upgrade: both sub-sections start with hidden class (renderUpgradeCTA toggles)', () => {
  const html = readIndexHtml();
  // Capture each sub-div's opening tag and verify it includes "hidden".
  const openMatch   = html.match(/<div id="upgrade-sales-open"[^>]*>/);
  const closedMatch = html.match(/<div id="upgrade-sales-closed"[^>]*>/);
  assert.ok(openMatch,   'sales-open div not found');
  assert.ok(closedMatch, 'sales-closed div not found');
  assert.match(openMatch[0],   /\bhidden\b/, 'sales-open must start hidden');
  assert.match(closedMatch[0], /\bhidden\b/, 'sales-closed must start hidden');
});

test('🛑 6/7 #/upgrade sales-open: existing NT$3,000 + Stripe button preserved (dormant)', () => {
  const html = readIndexHtml();
  // These elements must still ship in DOM so SALES_OPEN=true revives without
  // code change (per Vivi spec: payment page 休眠, 不刪).
  assert.match(html, /NT\$3,000/, 'NT$3,000 price label preserved');
  assert.match(html, /id="upgrade-btn"/, 'Stripe checkout button preserved');
  assert.match(html, /id="upgrade-error"/, 'error banner preserved');
});

// ─── Verbatim copy (Vivi 6/7 終審, 不改一字) ───────────────────────

test('🛑 6/7 sales-closed page: Vivi verbatim copy — opening paragraphs', () => {
  const html = readIndexHtml();
  assert.match(html, /Day 1 結束了。/);
  assert.match(html, /你剛剛經歷的不是「免費試用」/);
  assert.match(html, /而是你第一次坐下來、跟一位教練、聊你自己。/);
  assert.match(html, /你在這 10–15 分鐘裡寫下的,我們收到了。/);
  assert.match(html, /它會留在那裡,等你接著走。/);
});

test('🛑 6/7 sales-closed page: Vivi verbatim copy — product positioning paragraph', () => {
  const html = readIndexHtml();
  assert.match(html, /《看見自己》還沒正式對外開放。/);
  assert.match(html, /為了確保每一份生成的「犀利剖析」/);
  assert.match(html, /都能精準對應你的生命脈絡,/);
  assert.match(html, /這套對話引擎需要極高的運算資源與細膩設計。/);
  assert.match(html, /我們暫時不打算對所有人開放。/);
  assert.match(html, /因為我們更在乎每一位參與者的轉變品質。/);
  assert.match(html, /第一個月,我們預計開放 100 位。/);
});

test('🛑 6/7 sales-closed page: Vivi verbatim copy — opening-notification paragraph', () => {
  const html = readIndexHtml();
  assert.match(html, /當這 100 個席位正式開賣時,/);
  assert.match(html, /入口會優先寄給已經完成 Day 1 對話的人——/);
  assert.match(html, /包括你。/);
  assert.match(html, /你會比所有人早一步收到通知,/);
  assert.match(html, /鎖定你的席位、接著走 Day 2 – 21。/);
});

test('🛑 6/7 sales-closed page: Vivi verbatim copy — closing signal paragraph', () => {
  const html = readIndexHtml();
  assert.match(html, /你已經發出了信號,而我們聽見了。/);
  assert.match(html, /我們會再聯絡你。敬請期待。/);
});

test('🛑 6/7 sales-closed page: 3 hairline dividers between sections (paper-card__divider style)', () => {
  const html = readIndexHtml();
  // Extract the sales-closed section and count dividers inside it.
  const startIdx = html.indexOf('id="upgrade-sales-closed"');
  assert.ok(startIdx > 0, 'sales-closed section must exist');
  const sectionEnd = html.indexOf('</section>', startIdx);
  const block = html.slice(startIdx, sectionEnd);
  // Vivi spec: 3 dividers between the 4 thought-blocks.
  const dividerCount = (block.match(/paper-card__divider/g) || []).length;
  assert.ok(dividerCount >= 3,
    `sales-closed must have >= 3 paper-card__divider hairlines (Vivi spec ⸻ marks); got ${dividerCount}`);
});

// ─── No Stripe button / checkout call inside sales-closed ──────────

test('🛑 6/7 sales-closed page: NO checkout button / NO /api/checkout reference (no payment surface)', () => {
  const html = readIndexHtml();
  const startIdx = html.indexOf('id="upgrade-sales-closed"');
  assert.ok(startIdx > 0);
  const sectionEnd = html.indexOf('</section>', startIdx);
  const block = html.slice(startIdx, sectionEnd);
  // Negative: no upgrade-btn, no /api/checkout reference, no NT$ price in the
  // closed-sales subsection.
  assert.doesNotMatch(block, /id="upgrade-btn"/,
    'sales-closed must NOT contain Stripe checkout button');
  assert.doesNotMatch(block, /\/api\/checkout/,
    'sales-closed must NOT reference /api/checkout endpoint');
  assert.doesNotMatch(block, /NT\$3,000/,
    'sales-closed must NOT show NT$3,000 price');
});

// ─── Anti-regression: ensure sales-open still has its bits ──────────

test('🛑 6/7 sales-open subsection: contains Stripe + NT$3,000 (dormant payment surface intact)', () => {
  const html = readIndexHtml();
  const startIdx = html.indexOf('id="upgrade-sales-open"');
  assert.ok(startIdx > 0);
  // Look ahead a bounded window; sales-closed comes after but we're scoping
  // to the OPEN div's inner content.
  const closeIdx = html.indexOf('id="upgrade-sales-closed"', startIdx);
  const block = html.slice(startIdx, closeIdx);
  assert.match(block, /NT\$3,000/);
  assert.match(block, /id="upgrade-btn"/);
  assert.match(block, /解鎖完整旅程/);
});
