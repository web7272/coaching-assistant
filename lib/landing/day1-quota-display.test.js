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

test('🛑 6/8 v4 landing: branch "remaining > threshold" → 質性「限量體驗 － 只陪真心想看見自己的人」 verbatim', () => {
  // 6/8 v4 (Vivi 看 v3 live 後): 質性文案改短 (D4b).
  assert.match(html, /限量體驗 － 只陪真心想看見自己的人/);
  // Anti-regression: 舊「第一階段限量 1,000 席…」 verbatim 已廢.
  assert.equal(/第一階段限量 1,000 席/.test(html), false,
    '6/8 v4: 舊 1,000 席 質性文案應已替換');
  assert.equal(/我們正在尋找這 1,000 位認真想看見自己的人/.test(html), false,
    '6/8 v4: 舊 1,000 位 質性文案應已廢');
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

// ─── 6/8 v4: position lock — #cta-scarcity 搬到卡外 (Vivi 看 v3 live 後) ──

test('🛑 6/8 v4 landing: #cta-scarcity 不再在 action 卡 (data-opt="3") 內', () => {
  // 6/8 v4 invert (was v3 "must be inside"): 整張動作卡之後、置中.
  const actionCard = html.match(
    /<div class="cta-card"[^>]*data-opt="3"[\s\S]*?<\/form>\s*<\/div>/,
  );
  assert.ok(actionCard, 'action card (data-opt="3") block must be locatable');
  assert.equal(/id="cta-scarcity"/.test(actionCard[0]), false,
    '#cta-scarcity 必須搬到 .cta-card 之外 (Patrick 6/8 v4 D4a)');
});

test('🛑 6/8 v4 landing: #cta-scarcity 在 .cta-card 之後 (卡外、下方)', () => {
  // Position lock: action card's closing </div> (just after </form></div>)
  // appears BEFORE the scarcity <p>, AND nothing else from inside the card
  // body sits between them. We use the unique anchor "data-opt=\"3\"" to
  // find the start, then check ordering of card-end vs scarcity element.
  const cardOpenIdx  = html.indexOf('<div class="cta-card" data-opt="3"');
  const scarcityIdx  = html.indexOf('id="cta-scarcity"');
  assert.ok(cardOpenIdx > 0, 'action card must exist');
  assert.ok(scarcityIdx > 0, '#cta-scarcity must exist');
  assert.ok(cardOpenIdx < scarcityIdx,
    `card open (${cardOpenIdx}) must precede #cta-scarcity (${scarcityIdx})`);
  // The action card's closing </div></div> sequence (ends with </form></div>
  // when the slice grabbed above ends) — verify scarcity falls AFTER the
  // first </form>\s*</div> after card-open.
  const afterCard = html.slice(cardOpenIdx);
  const closeRel  = afterCard.search(/<\/form>\s*<\/div>/);
  assert.ok(closeRel > 0, 'action card close must be locatable after open');
  const closeAbs  = cardOpenIdx + closeRel;
  assert.ok(closeAbs < scarcityIdx,
    `action card close (${closeAbs}) must precede #cta-scarcity (${scarcityIdx})`);
});

test('🛑 6/8 v4 landing: #cta-scarcity 仍在 .cta-pair grid 內 (寬度跟卡片對齊)', () => {
  // The scarcity element should sit between </div> (card close) and </div>
  // (cta-pair close). Verify by checking cta-pair's first close after
  // scarcity is the IMMEDIATE container.
  const ctaPairIdx  = html.indexOf('<div class="cta-pair">');
  const scarcityIdx = html.indexOf('id="cta-scarcity"');
  assert.ok(ctaPairIdx > 0, '.cta-pair must exist');
  assert.ok(ctaPairIdx < scarcityIdx,
    `.cta-pair open (${ctaPairIdx}) must precede scarcity`);
  // Verify the closing </header> comes AFTER scarcity — i.e., scarcity is
  // still inside the hero block.
  const headerCloseIdx = html.indexOf('</header>');
  assert.ok(scarcityIdx < headerCloseIdx,
    `#cta-scarcity (${scarcityIdx}) must come before </header> (${headerCloseIdx})`);
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

test('🛑 6/8 v2/v3 + C: action card data-opt="3" still exists with form + 3-question quiz + new button class/text', () => {
  const actionCard = html.match(
    /<div class="cta-card"[^>]*data-opt="3"[\s\S]*?<\/form>\s*<\/div>/,
  );
  assert.ok(actionCard, 'action card (data-opt="3") block must be locatable');
  assert.match(actionCard[0], /name="q1"/);
  assert.match(actionCard[0], /name="q2"/);
  assert.match(actionCard[0], /name="q3"/);
  assert.match(actionCard[0], /onsubmit="ctaSubmit\(event,\s*3\)"/);
  assert.match(actionCard[0], /立刻領取《價值觀挖掘練習PDF》＋免費解鎖 AI 教練體驗/);
  // C1/C2 — button class swap + text change.
  assert.match(actionCard[0], /class="cta-button"/);
  assert.match(actionCard[0], />開始看見自己</);
  // Arrow split into separate span for gap:9px flex layout.
  assert.match(actionCard[0], /<span aria-hidden="true">→<\/span>/);
});

// ─── 6/8 v4 D 段 — Vivi 看 v3 live 後微調 (Vivi 6/8) ────────────────

test('🛑 6/8 v4 hotfix-D1: cta-t-3 <br> 在《價值觀挖掘練習PDF》之後、＋之前 (Vivi 看 live 又調)', () => {
  // v4 (fa63c4b) 把 <br> 放在「立刻領取」後 → 行二「《...PDF》＋免費解鎖 AI 教練體驗」
  // 太長, 在 420px 卡內再 wrap 把「驗」擠成孤字. Hotfix 把 <br> 改到「＋」前:
  //   行一: 立刻領取《價值觀挖掘練習PDF》
  //   行二: ＋免費解鎖 AI 教練體驗
  // 產品名「價值觀挖掘練習」完整保留 (不簡寫成「價值觀練習」).
  assert.match(html,
    /<p class="cta-t" id="cta-t-3">立刻領取《價值觀挖掘練習PDF》<br>＋免費解鎖 AI 教練體驗<\/p>/);
  // Anti-regression: 舊「立刻領取<br>《...」 (v4 original) 已廢.
  assert.equal(/立刻領取<br>《價值觀/.test(html), false,
    'v4 原始 <br> 位置 (「立刻領取」後) 已移到「＋」前');
});

test('🛑 6/8 v4 hotfix-D1: .cta-t font-size 微降 (clamp(15px,2.4vw,17px)) — 防行一仍 wrap', () => {
  // Patrick fallback: clamp(16px,2.6vw,18px) → clamp(15px,2.4vw,17px), 確保
  // 行一在 420px 卡內各 viewport 都不再 wrap、無孤字.
  const rule = html.match(/\.cta-card \.cta-t\s*\{[^}]*\}/);
  assert.ok(rule, '.cta-t CSS rule must exist');
  assert.match(rule[0], /font-size\s*:\s*clamp\(15px\s*,\s*2\.4vw\s*,\s*17px\)/);
  // Anti-regression: 舊 18px 上限值已不存在於這條規則.
  assert.equal(/clamp\(16px\s*,\s*2\.6vw\s*,\s*18px\)/.test(rule[0]), false,
    '舊 .cta-t font-size (上限 18px) 已替換為 17px 上限');
});

test('🛑 6/8 v4-D2: cta-d-3 內文整段換 (verbatim「想像一下…我們陪你找回來。」)', () => {
  const actionCard = html.match(
    /<div class="cta-card"[^>]*data-opt="3"[\s\S]*?<\/form>\s*<\/div>/,
  );
  assert.ok(actionCard);
  // verbatim 完整字串 — Patrick 6/8 v4 spec.
  assert.match(actionCard[0],
    /<p class="cta-d" id="cta-d-3">想像一下,當你不再把能量耗在「或許、好像」上,而是清楚知道自己要去哪裡。當不再什麼都想抓住、什麼都不敢放,而是敢走到自己想要的人生。那個你一直都在。我們陪你找回來。<\/p>/);
  // Anti-regression: v3 舊內文「想自己來，這份 PDF 15 分鐘…」 已廢.
  assert.equal(/想自己來，這份 PDF 15 分鐘/.test(actionCard[0]), false,
    '6/8 v4-D2: v3 舊內文「想自己來…」 應已被取代');
  assert.equal(/把那個你真正想要的人生挖出來/.test(actionCard[0]), false,
    '6/8 v4-D2: v3 舊內文尾句 應已廢');
});

// ─── 6/8 設計師 C 段 — 按鈕細修 (粉色 + 文字 + subline) ─────────────

test('🛑 6/8 C1: action card 按鈕文字「開始看見自己」 (was「兩個都要」)', () => {
  const actionCard = html.match(
    /<div class="cta-card"[^>]*data-opt="3"[\s\S]*?<\/form>\s*<\/div>/,
  );
  assert.ok(actionCard);
  // Live 按鈕文字 = 「開始看見自己」, 沒有「兩個都要」 殘留.
  assert.equal(/>兩個都要</.test(actionCard[0]), false,
    'action card 不應再有「兩個都要」 (C1 已換成「開始看見自己」)');
  assert.match(actionCard[0], />開始看見自己</);
});

test('🛑 6/8 C2: button class = cta-button (was cta-go cta-go--btn 金漸層)', () => {
  const actionCard = html.match(
    /<div class="cta-card"[^>]*data-opt="3"[\s\S]*?<\/form>\s*<\/div>/,
  );
  assert.ok(actionCard);
  // 新 class.
  assert.match(actionCard[0], /<p class="cta-button" id="cta-go-3"/);
  // 舊 class 在 live action card 內已廢 (允許 <style> 區段 / HTML comment 仍提及).
  assert.equal(/class="cta-go cta-go--btn"/.test(actionCard[0]), false,
    'action card 內不應再有 class="cta-go cta-go--btn" 的 live 元素');
});

test('🛑 6/8 C2: .cta-button CSS rule = 設計師 verbatim (粉 #F3D8CE / #7A361F / flex gap 9)', () => {
  const rule = html.match(/\.cta-button\s*\{[^}]*\}/);
  assert.ok(rule, '.cta-button CSS rule must exist');
  assert.match(rule[0], /background\s*:\s*#F3D8CE/);
  assert.match(rule[0], /color\s*:\s*#7A361F/);
  assert.match(rule[0], /border-radius\s*:\s*12px/);
  assert.match(rule[0], /padding\s*:\s*15px\s+0/);
  assert.match(rule[0], /width\s*:\s*100%/);
  assert.match(rule[0], /font-size\s*:\s*16px/);
  assert.match(rule[0], /letter-spacing\s*:\s*\.8px/);
  assert.match(rule[0], /display\s*:\s*flex/);
  assert.match(rule[0], /align-items\s*:\s*center/);
  assert.match(rule[0], /justify-content\s*:\s*center/);
  assert.match(rule[0], /gap\s*:\s*9px/);
  // hover + active states.
  assert.match(html, /\.cta-button:hover\s*\{[^}]*background\s*:\s*#ECCABD[^}]*\}/);
  assert.match(html, /\.cta-button:active\s*\{[^}]*transform\s*:\s*scale\(\.98\)[^}]*\}/);
});

test('🛑 6/8 v4-D3: subline 改字 — 加《》 (verbatim「免費《領取PDF ＋ 體驗 Day 1》」)', () => {
  const actionCard = html.match(
    /<div class="cta-card"[^>]*data-opt="3"[\s\S]*?<\/form>\s*<\/div>/,
  );
  assert.ok(actionCard);
  // 6/8 v4 spec verbatim (含全形《》+ 全形「＋」 U+FF0B).
  assert.match(actionCard[0],
    /<span class="cta-subline">免費《領取PDF ＋ 體驗 Day 1》<\/span>/);
  // Anti-regression: v3 舊字串「免費領 PDF ＋ 體驗 Day 1」 (無《》) 已廢.
  assert.equal(/>免費領 PDF ＋ 體驗 Day 1</.test(actionCard[0]), false,
    'v3 舊 subline (無《》) 應已被取代');
});

test('🛑 6/8 C3: .cta-subline CSS rule = 設計師 verbatim (#B08968 + 12.5px + 置中)', () => {
  const rule = html.match(/\.cta-subline\s*\{[^}]*\}/);
  assert.ok(rule, '.cta-subline CSS rule must exist');
  assert.match(rule[0], /display\s*:\s*block/);
  assert.match(rule[0], /margin-top\s*:\s*10px/);
  assert.match(rule[0], /text-align\s*:\s*center/);
  assert.match(rule[0], /font-size\s*:\s*12\.5px/);
  assert.match(rule[0], /color\s*:\s*#B08968/);
  assert.match(rule[0], /letter-spacing\s*:\s*\.3px/);
});

test('🛑 6/8 v4 卡片堆疊 verbatim: 卡內 標題 → 內文 → 按鈕 → subline; 卡外 scarcity (下方)', () => {
  const actionCard = html.match(
    /<div class="cta-card"[^>]*data-opt="3"[\s\S]*?<\/form>\s*<\/div>/,
  );
  assert.ok(actionCard);
  // 卡內 4-way 鎖 (scarcity 已搬到卡外、不再算這個 slice).
  const titleIdx    = actionCard[0].indexOf('id="cta-t-3"');
  const descIdx     = actionCard[0].indexOf('id="cta-d-3"');
  const btnIdx      = actionCard[0].indexOf('class="cta-button"');
  const sublineIdx  = actionCard[0].indexOf('class="cta-subline"');
  assert.ok(titleIdx   > 0, '#cta-t-3 must exist');
  assert.ok(descIdx    > 0, '#cta-d-3 must exist');
  assert.ok(btnIdx     > 0, '.cta-button must exist');
  assert.ok(sublineIdx > 0, '.cta-subline must exist');
  assert.ok(titleIdx < descIdx,
    `title (${titleIdx}) must come before desc (${descIdx})`);
  assert.ok(descIdx < btnIdx,
    `desc (${descIdx}) must come before button (${btnIdx})`);
  assert.ok(btnIdx < sublineIdx,
    `button (${btnIdx}) must come before subline (${sublineIdx})`);

  // 卡外: scarcity 在 subline (即卡內最後一個元素) 之後.
  // Compare absolute positions in full html.
  const cardCloseIdx = html.indexOf('class="cta-subline"');
  const scarcityAbs  = html.indexOf('id="cta-scarcity"');
  assert.ok(cardCloseIdx > 0 && scarcityAbs > 0);
  assert.ok(cardCloseIdx < scarcityAbs,
    `subline (${cardCloseIdx}) must precede scarcity (${scarcityAbs}) — scarcity 在卡外、下方`);
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

// ─── 6/8 v6 — FAQ 兩改 + Quiz 精簡 + Quiz 2x2 (Vivi 拍板) ────────────

test('🛑 6/8 v6-A1: FAQ「這跟我自己找 AI 聊天有什麼不同？」 答案刪掉「，更不會記得你是誰」', () => {
  // 原句:「不會帶你去任何地方，更不會記得你是誰。」→ 新:「不會帶你去任何地方。」
  assert.match(html, /它不會帶你去任何地方。《看見自己》是反過來的/);
  assert.equal(/更不會記得你是誰/.test(html), false,
    'v6-A1: 「更不會記得你是誰」 已刪除');
});

test('🛑 6/8 v6-A2: FAQ「我要先想好要處理什麼主題嗎？」 整個 item 已刪除', () => {
  // 整個 <div class="item"> qq + aa 都刪 — 不能殘留 qq 也不能殘留 aa.
  assert.equal(/我要先想好要處理什麼主題/.test(html), false,
    'v6-A2: FAQ 題目「我要先想好要處理什麼主題嗎？」 整題已刪');
  assert.equal(/21 天你想問什麼都可以——這套方法的底層是自我概念/.test(html), false,
    'v6-A2: 該題答案 也應一併刪除');
});

test('🛑 6/8 v6-B-Q1: Q1 4 個 .cta-qo 改短句 (value = display)', () => {
  // value 與顯示文字一致改短; data-qkey="現況" / name="q1" 不變.
  const expected = [
    '職場探索者',
    '專業人士／小主管',
    '創業者／高階經理人',
    '轉向中的自由職業者',
  ];
  for (const v of expected) {
    // value 與顯示文字皆等於短句.
    const re = new RegExp(
      `<label class="cta-qo"><input type="radio" name="q1" data-qkey="現況" value="${v}">${v}</label>`,
    );
    assert.match(html, re, `Q1 missing exact label for: ${v}`);
  }
  // Anti-regression: 舊長值已廢.
  assert.equal(/value="剛入職場的探索者"/.test(html), false);
  assert.equal(/value="追求突破的職場專業人士／小主管"/.test(html), false);
  assert.equal(/value="帶領團隊的創業者／高階經理人"/.test(html), false);
  assert.equal(/value="正在尋求人生轉向的自由職業者"/.test(html), false);
});

test('🛑 6/8 v6-B-Q2: Q2 4 個 .cta-qo 改短句 (value = display)', () => {
  const expected = [
    'YouTube／社群／問 AI',
    '書籍／PDF 指南',
    '線上課程／工作坊',
    '1 對 1 諮商／教練',
  ];
  for (const v of expected) {
    const re = new RegExp(
      `<label class="cta-qo"><input type="radio" name="q2" data-qkey="過去嘗試" value="${v}">${v}</label>`,
    );
    assert.match(html, re, `Q2 missing exact label for: ${v}`);
  }
  // Anti-regression: 舊長值已廢.
  assert.equal(/value="看 YouTube／社群或問 AI"/.test(html), false);
  assert.equal(/value="閱讀書籍或下載 PDF 指南"/.test(html), false);
  assert.equal(/value="線上課程或實體工作坊"/.test(html), false);
  assert.equal(/value="預約過 1 對 1 諮商／教練／顧問"/.test(html), false);
});

test('🛑 6/8 v6-B-Q3: Q3 4 個 .cta-qo 改短句 (value = display)', () => {
  const expected = [
    '短暫啟發、很快回原點',
    '學到理論、不會應用',
    '被標籤化、沒有自己的地圖',
    '還沒觸動底層身份',
  ];
  for (const v of expected) {
    const re = new RegExp(
      `<label class="cta-qo"><input type="radio" name="q3" data-qkey="成效評估" value="${v}">${v}</label>`,
    );
    assert.match(html, re, `Q3 missing exact label for: ${v}`);
  }
  // Anti-regression: 舊長值已廢.
  assert.equal(/value="有短暫啟發，但很快回到原點"/.test(html), false);
  assert.equal(/value="學到理論，不知怎麼用在自己身上"/.test(html), false);
  assert.equal(/value="被標籤化，找不到自己的地圖"/.test(html), false);
  assert.equal(/value="還沒找到觸動底層身份的方法"/.test(html), false);
});

test('🛑 6/8 v6-C: .cta-q 2x2 grid CSS (was 直排 1 欄)', () => {
  // .cta-q 用 grid 2 欄, .cta-qt span 全寬, .cta-qo 預設 stretch 等高.
  const ctaQ = html.match(/\.cta-q\s*\{[^}]*\}/);
  assert.ok(ctaQ, '.cta-q rule must exist');
  assert.match(ctaQ[0], /display\s*:\s*grid/);
  assert.match(ctaQ[0], /grid-template-columns\s*:\s*1fr\s+1fr/);
  // .cta-qt spans 兩欄 (放題目用整列).
  const ctaQt = html.match(/\.cta-q \.cta-qt\s*\{[^}]*\}/);
  assert.ok(ctaQt);
  assert.match(ctaQt[0], /grid-column\s*:\s*1\s*\/\s*-1/);
  // 文字允許折行 (避免長選項被切).
  const ctaQo = html.match(/\.cta-qo\s*\{[\s\S]*?\}/);
  assert.ok(ctaQo);
  assert.match(ctaQo[0], /white-space\s*:\s*normal/);
  assert.equal(/white-space\s*:\s*nowrap/.test(ctaQo[0]), false,
    '.cta-qo must NOT use nowrap (避免長選項被切)');
  assert.equal(/overflow\s*:\s*hidden/.test(ctaQo[0]), false,
    '.cta-qo must NOT clip overflow');
});

test('🛑 6/8 v6-C: 窄螢幕 (≤600px) 退回單欄 (mobile fallback)', () => {
  // @media (max-width:600px) {.cta-q{grid-template-columns:1fr}} 或等效.
  assert.match(html,
    /@media\s*\(\s*max-width\s*:\s*600px\s*\)\s*\{[^}]*\.cta-q[^{]*\{[^}]*grid-template-columns\s*:\s*1fr[^}]*\}[^}]*\}/);
});
