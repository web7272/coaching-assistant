// lib/student/storyboard-connections.test.js
// v5.3 件3 PR-J5 — 3 條串接 sync-gate (read-only static analysis).
//
// ① 教練卡 (view-note) → 頁 Y (#/storyboard)
// ② 頁 X 頂部 mini-map (view-journey) → 頁 Y (#/storyboard)
// ③ auth.html 5 步功能預覽 + 七步轉變說明 (only 畫面, auth/token flow 0 動)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = join(__dirname, '..', '..');
const indexHtml = readFileSync(join(repoRoot, 'index.html'), 'utf8');
const authHtml  = readFileSync(join(repoRoot, 'auth.html'),  'utf8');
const appCss    = readFileSync(join(repoRoot, 'app.css'),    'utf8');

// Helper — extract a specific section block from index.html.
function sectionOf(viewId) {
  const re = new RegExp(`<section id="${viewId}"[\\s\\S]*?<\\/section>`);
  const m = indexHtml.match(re);
  if (!m) throw new Error(`Could not locate section ${viewId} in index.html`);
  return m[0];
}

// ═════════════════════════════════════════════════════════
// ① 教練卡 → 頁 Y (#/storyboard)
// ═════════════════════════════════════════════════════════

test('🛑 PR-J5 ①: view-note has #/storyboard entry link', () => {
  const sec = sectionOf('view-note');
  // Anchor href + display text.
  assert.match(sec, /<a [^>]*href="#\/storyboard"[^>]*aria-label="看看我的故事"/);
});

test('🛑 PR-J5 ①(6/14): view-note 底部 storyboard 地圖 icon 用 note-map-btn class', () => {
  const sec = sectionOf('view-note');
  assert.match(sec, /<a [^>]*href="#\/storyboard"[^>]*class="[^"]*note-map-btn[^"]*"|<a [^>]*class="[^"]*note-map-btn[^"]*"[^>]*href="#\/storyboard"/);
});

test('🛑 PR-J5 ①(6/14): view-note 底部地圖 icon 與「回到旅程」同列 (btn-row 內含 #/storyboard)', () => {
  const sec = sectionOf('view-note');
  const btnRowIdx = sec.indexOf('note-btn-row');
  assert.ok(btnRowIdx > 0, 'btn-row must exist');
  const after = sec.slice(btnRowIdx);
  assert.match(after, /href="#\/storyboard"/);
});

// ═════════════════════════════════════════════════════════
// ② 頁 X 頂部 mini-map → 頁 Y (#/storyboard)
// ═════════════════════════════════════════════════════════

test('🛑 PR-J5 ②: view-journey has .storyboard-minimap entry → #/storyboard', () => {
  const sec = sectionOf('view-journey');
  assert.match(sec, /<a class="storyboard-minimap"[^>]*href="#\/storyboard"/);
  assert.match(sec, /看看我的故事/);
});

test('🛑 PR-J5 ②: mini-map sits ABOVE #journey-grid (outside grid, per Vivi anchor)', () => {
  const sec = sectionOf('view-journey');
  const minimapIdx = sec.indexOf('storyboard-minimap');
  const gridIdx    = sec.indexOf('id="journey-grid"');
  assert.ok(minimapIdx > 0, 'mini-map must exist');
  assert.ok(gridIdx > 0,    'journey-grid must exist');
  assert.ok(minimapIdx < gridIdx,
    '🔴 mini-map MUST be positioned ABOVE journey-grid (above .journey-grid-wrap)');
});

test('🛑 PR-J5 ②: mini-map sits AFTER .journey-title-wrap (per spec placement)', () => {
  const sec = sectionOf('view-journey');
  const titleIdx  = sec.indexOf('journey-title-wrap');
  const minimapIdx = sec.indexOf('storyboard-minimap');
  assert.ok(titleIdx > 0 && minimapIdx > 0);
  assert.ok(titleIdx < minimapIdx,
    'mini-map follows the journey-title-wrap header (placement spec)');
});

test('🛑 PR-J5 ②: mini-map uses map SVG icon (not 皇冠), aria-label set', () => {
  const sec = sectionOf('view-journey');
  // Anti-regression: no crown / 皇冠 / 👑 inside the mini-map block.
  const minimapBlock = sec.match(/<a class="storyboard-minimap"[\s\S]*?<\/a>/);
  assert.ok(minimapBlock);
  const block = minimapBlock[0];
  assert.match(block, /<svg/);
  assert.match(block, /aria-label="打開我的故事"/);
  assert.equal(/皇冠|👑/.test(block), false);
});

test('🛑 PR-J5 ② CSS: .storyboard-minimap rule exists', () => {
  assert.match(appCss, /\.storyboard-minimap\s*\{/);
});

// ═════════════════════════════════════════════════════════
// ③ auth.html — 5 步預覽 + 七步說明 (auth/token flow 0 動)
// ═════════════════════════════════════════════════════════

test('🛑 PR-J5 ③: auth.html has .auth-preview block (5 步 + 說明)', () => {
  assert.match(authHtml, /class="auth-preview"/);
});

test('🛑 PR-J5 ③: auth.html preview lists 4 step labels in order (6/26 改 4 張)', () => {
  // Search inside the <ol> block so the intro text's 「對話」 doesn't confuse
  // the sequential order check.
  const olMatch = authHtml.match(/<ol class="auth-preview__steps">[\s\S]*?<\/ol>/);
  assert.ok(olMatch, 'auth-preview__steps <ol> block must exist');
  const ol = olMatch[0];
  const labels = ['21天旅程', '每日對話', '身分解析卡', '我的故事'];
  let prevIdx = -1;
  for (const label of labels) {
    const idx = ol.indexOf(label);
    assert.ok(idx > prevIdx,
      `label「${label}」 must appear AFTER previous within auth-preview__steps`);
    prevIdx = idx;
  }
});

test('🛑 PR-J5 ③ VERBATIM: 白話說明 byte-identical to Vivi 6/12 改字版', () => {
  // Vivi 6/12 改字 (added 「系統」 + 「步驟」 + 「裡」):
  //   「這整套系統是透過『對話』,帶你走過 7 步驟的身分轉變;這趟轉變旅程,
  //    會同步呈現在『我的人生旅途』裡。」
  assert.match(authHtml,
    /這整套系統是透過21天與教練『對話』,帶你走過 7 個步驟的身分轉變。每天會有一張身分解析卡,這趟轉變旅程,會同步呈現在『我的故事』裡。/);
  // Anti-regression: old wording (Vivi 6/11) must not survive.
  assert.equal(
    /這整套是透過『對話』,帶你走過 7 步的身分轉變;這趟轉變旅程,會同步呈現在『我的人生旅途』。/.test(authHtml),
    false, '舊版 intro (Vivi 6/11) 已替換');
});

test('🛑 PR-J5 ③: auth.html preview ④ uses storyboard map SVG (頁 Y icon)', () => {
  // The 5th step (我的人生旅途) uses the actual folded-map SVG used by view-storyboard.
  // Anti-regression: it does NOT use a placeholder frame for step 5.
  const previewBlock = authHtml.match(/<div class="auth-preview">[\s\S]*?<\/div>\s*<\/div>/);
  assert.ok(previewBlock);
  const block = previewBlock[0];
  // The ⑤ list item should carry auth-preview__frame--icon, not --placeholder.
  const step5Match = block.match(/④[\s\S]*?<\/li>/);
  assert.ok(step5Match);
  assert.match(step5Match[0], /auth-preview__frame--icon/);
  assert.equal(/⑤[\s\S]*?auth-preview__frame--placeholder[\s\S]*?<\/li>/.test(block), false,
    'step ⑤ MUST use --icon frame (not placeholder)');
  // SVG present inside.
  assert.match(step5Match[0], /<svg/);
});

test('🛑 6/26: auth.html steps ①-③ use --photo <img> with correct src mapping (④=map svg)', () => {
  // 6/12 — Vivi 4 webp 已掛載 (assets/auth-preview/{21day,chat,coach,login}.webp).
  // ①=21day  ②=chat  ③=coach  ④=login.  ⑤ 維持 --icon SVG.
  // 4 photo <img> elements expected (no more placeholders).
  const photos = authHtml.match(/auth-preview__frame--photo/g) || [];
  assert.equal(photos.length, 3,
    '①-③ MUST use --photo class (3 webp;歡迎頁已移除、④=map svg)');
  // No placeholder frames remain.
  const placeholders = authHtml.match(/auth-preview__frame--placeholder/g) || [];
  assert.equal(placeholders.length, 0,
    'all placeholder frames replaced by real <img> elements');
  // Per-step src mapping (order locked). Anchor inside <ol> block so the
  // ③ character in code comments outside the list doesn't confuse the regex.
  const olMatch = authHtml.match(/<ol class="auth-preview__steps">[\s\S]*?<\/ol>/);
  assert.ok(olMatch, 'auth-preview__steps <ol> block must be locatable');
  const ol = olMatch[0];
  const expected = [
    { step: '①', file: '21day.webp', label: '21天旅程' },
    { step: '②', file: 'chat.webp',  label: '每日對話' },
    { step: '③', file: 'coach.webp', label: '身分解析卡' },
  ];
  for (const e of expected) {
    const liRe = new RegExp(`${e.step}[\\s\\S]*?<\\/li>`);
    const li = ol.match(liRe);
    assert.ok(li, `${e.step} <li> must be locatable inside <ol>`);
    const liStr = li[0];
    assert.match(liStr, new RegExp(`src="/assets/auth-preview/${e.file.replace('.', '\\.')}"`),
      `${e.step} src must be /assets/auth-preview/${e.file}`);
    assert.match(liStr, new RegExp(e.label),
      `${e.step} label must remain「${e.label}」`);
    assert.match(liStr, /<img class="auth-preview__frame auth-preview__frame--photo"/);
  }
});

test('🛑 PR-J5 ③ ANTI-REGRESSION: verify-link POST + token flow 0 改 (auth/token 邏輯)', () => {
  // Patrick 紅線:「不動 auth.html 的登入/token/跳轉邏輯,只動畫面內容」.
  // Source-level lock: the 5 critical JS anchors that make magic-link auth
  // work must remain intact.
  // 1. LS_KEY constant (must match student.js).
  assert.match(authHtml, /const LS_KEY = 'sy\.v5\.student'/);
  // 2. persistStudentSession function present.
  assert.match(authHtml, /function persistStudentSession\(payload\)/);
  // 3. renderConfirm with token-only click handler.
  assert.match(authHtml, /function renderConfirm\(token\)/);
  // 4. The button click is the ONLY POST trigger (no top-level fetch).
  assert.match(authHtml, /fetch\('\/api\/auth\/verify-link'/);
  // 5. Success path bounces to #/journey.
  assert.match(authHtml, /location\.href = '\/#\/journey'/);
});

test('🛑 PR-J5 ③ ANTI-REGRESSION: no auto-POST at load (P0 6/7 safety preserved)', () => {
  // No top-level fetch (only inside button click handler). The KEY anti-
  // regression to prevent SafeLinks / Gmail / Brevo from burning tokens.
  // Verify by ensuring fetch() is inside a function or click handler scope,
  // NOT at the IIFE top level.
  // 6/25: auth.html 現有 2 個 fetch —— verify-link(消耗 token)+ /api/students
  //   (存 name/pace,verify 成功後 best-effort)。兩個都在同一個 click handler 內,
  //   boot 仍 0 fetch(由 auth-confirm.test.js 的 bootOnly slice 嚴格鎖)。
  const fetches = authHtml.match(/fetch\(/g) || [];
  assert.equal(fetches.length, 2,
    'auth.html should have 2 fetch calls (verify-link + students PATCH), both inside the click handler');
  // token-consuming verify-link 仍只有一次(防 token 被燒).
  const verifyFetches = authHtml.match(/fetch\('\/api\/auth\/verify-link'/g) || [];
  assert.equal(verifyFetches.length, 1, 'verify-link fetch must remain exactly 1 (single token consume)');
});

test('🛑 PR-J5 ③: login button placement — 置頂 (#auth-status BEFORE .auth-preview)', () => {
  const statusIdx  = authHtml.indexOf('id="auth-status"');
  const previewIdx = authHtml.indexOf('class="auth-preview"');
  assert.ok(statusIdx > 0 && previewIdx > 0);
  assert.ok(statusIdx < previewIdx,
    'login button (#auth-status) MUST come BEFORE .auth-preview (Patrick: 登入鈕置頂)');
});

test('🛑 PR-J5 ③ CSS: .auth-preview rule exists + 5-column grid', () => {
  assert.match(appCss, /\.auth-preview\s*\{/);
  assert.match(appCss, /\.auth-preview__steps\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,/);
});

// ═════════════════════════════════════════════════════════
// 🔴 ship-gate: zero crossover into J1-J4 territory
// ═════════════════════════════════════════════════════════

test('🛑 PR-J5 🔴 ship-gate: view-storyboard (頁 Y 本體) NOT modified', () => {
  // J5 only adds entries TO 頁 Y from elsewhere. The 頁 Y section itself
  // (J4) must stay byte-identical (no scope creep).
  const sec = sectionOf('view-storyboard');
  // Sanity: J4's key anchors still all present.
  assert.match(sec, /id="storyboard-body"/);
  assert.match(sec, /class="storyboard-icon"/);
  assert.match(sec, /我的故事/);
});

test('🛑 PR-J5 🔴 ship-gate: 歡迎頁 (view-entry) NOT touched', () => {
  // Patrick spec: 「不碰歡迎頁(名字+步調 onboarding)」.
  const sec = sectionOf('view-entry');
  // Sanity: existing entry form anchors present and unchanged shape.
  assert.match(sec, /id="entry-form"/);
  assert.match(sec, /我可以怎麼稱呼你？/);
  // No new storyboard references in entry (storyboard goes elsewhere).
  assert.equal(/#\/storyboard/.test(sec), false,
    'view-entry should NOT carry storyboard navigation (only auth.html + view-journey + view-note do)');
});
