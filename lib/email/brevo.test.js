// lib/email/brevo.test.js
// PR-4c-green Auth rebuild stage 1f — Brevo real-send for sendMagicLink +
// existing sendExportEmail stub coverage preserved.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  sendMagicLink,
  sendExportEmail,
  sendGuideEmail,
  buildDailyCardHtml,
  buildDailyCardText,
  sendDailyCardEmail,
  buildMagicLinkHtml,
  buildMagicLinkText,   // 6/8 Patrick — plain-text 替代版
  buildGuideEmailHtml,
  buildGuideEmailText,  // 6/8 Patrick — plain-text 替代版
  escapeHtml,
  _setFetchFn,
  // 7/30 Vivi — seminar 上線 (問對問題 9/30 講座) 5 個 export
  buildSeminarConfirmationHtml,
  buildSeminarConfirmationText,
  sendSeminarConfirmation,
  addToSeminarList,
  createSeminarList,
} from './brevo.js';

let _savedKey;
beforeEach(() => {
  _savedKey = process.env.BREVO_API_KEY;
  delete process.env.BREVO_API_KEY;
  _setFetchFn(null);
});
afterEach(() => {
  if (_savedKey === undefined) delete process.env.BREVO_API_KEY;
  else process.env.BREVO_API_KEY = _savedKey;
  _setFetchFn(null);
});

// ═════════════════════════════════════════════════════════
// buildMagicLinkHtml (pure)
// ═════════════════════════════════════════════════════════

test('buildMagicLinkHtml: contains the link as button href + plain-text fallback', () => {
  const html = buildMagicLinkHtml('https://preview.example.com/auth?token=abc123');
  // Button anchor href
  assert.match(html, /href="https:\/\/preview\.example\.com\/auth\?token=abc123"/);
  // Plain-text fallback line
  assert.match(html, /如果按鈕沒反應/);
  // Login button label — 7/15 v11: 「登入」→「進入對話 →」 (Vivi 定稿)
  assert.match(html, />進入對話 →</);
});

// 🛑 PR-4c-green Auth rebuild 1g — Brevo click-tracking opt-out on the button.
// Without this attribute Brevo wraps the href in sendibt2.com/tr/cl/… which
// mangled the ?token=… URL → ERR_INVALID_REDIRECT (Vivi 5/24 bug).
test('🛑 buildMagicLinkHtml: login button carries clicktracking="off" (Brevo opt-out)', () => {
  const html = buildMagicLinkHtml('https://x/auth?token=abc');
  // The login button anchor must carry the attribute — exact text match so
  // a stray space / capitalization change shows up in the diff.
  assert.match(html, /<a href="https:\/\/x\/auth\?token=abc" clicktracking="off"/,
    'login button must have clicktracking="off" so Brevo skips redirect-wrapping');
});

test('🛑 buildMagicLinkHtml: plain-text fallback uses <span>, never wrapped <a>', () => {
  const html = buildMagicLinkHtml('https://x/auth?token=abc');
  // The fallback is intentionally a <span> (not an <a>) so Brevo can't wrap
  // it even if clicktracking opt-out ever stops working. Belt + suspenders.
  assert.match(html, /<span[^>]*>https:\/\/x\/auth\?token=abc<\/span>/);
});

test('buildMagicLinkHtml: warm copy + 60-min expiry mention (TTL 20→60 5/28, 7/15 v11 masthead)', () => {
  const html = buildMagicLinkHtml('https://x/auth?token=z');
  assert.match(html, /60 分鐘內有效/);
  assert.equal(/20 分鐘內有效/.test(html), false, 'must not regress to「20 分鐘」 (backend TTL 已 60)');
  // 7/15 v11: masthead 標題「看見自己」 (verbatim signature) + 反向鎖舊「21天身分重塑計畫」
  assert.match(html, /color:#B58F5C;font-weight:700;">看見自己/);
  assert.doesNotMatch(html, /21天身分重塑計畫/);
});

// 🛑 6/2 Patrick — brand transition (Landing v1.7 對齊): email 色票全片粉/赤陶系,
// 任一舊綠 hex 出現 = regression. push 後 user 收信看到「綠色看見自己」 = brand 撕裂.
test('🛑 buildMagicLinkHtml: 6/26 brand transition — 無舊綠/粉赤陶 hex, 有新古銅金 hex', () => {
  const html = buildMagicLinkHtml('https://x/auth?token=z');
  // 舊綠 hex 完全消失 (8 個 token: bg / 邊線 / 標題 / 金分隔 / body / 按鈕 / 灰綠 / 深綠)
  for (const oldHex of ['#5DA873', '#3E9D5C', '#BFD7BA', '#FBF6EC',
                         '#E3B340', '#A7BCA4', '#6E8A6E', '#2C3A2C',
                         '#f7ebe5', '#E8C6B8', '#c66b4f', '#d6826a',
                         '#2d2422', '#9c8c87', '#6b5c57']) {
    assert.equal(html.includes(oldHex), false,
      `舊綠/粉赤陶 hex ${oldHex} 仍出現在 email template — brand transition 漏一處`);
  }
  // 新古銅金 hex 必須在 (身分重塑頁 4 個關鍵 token)
  for (const newHex of ['#F8F8F8', '#B58F5C', '#D8B27F', '#2E333D']) {
    assert.ok(html.includes(newHex),
      `新古銅金 hex ${newHex} 必須在 email template (對齊身分重塑頁)`);
  }
});

test('🛑 buildMagicLinkHtml: escapes link to prevent attribute breakout in mail clients', () => {
  // If a link ever contains a quote (shouldn't with our 64-hex token, but
  // defense-in-depth), the rendered href attr must not be broken out of.
  // The literal text「onclick=alert(1)」 may survive inside the escaped value
  // — that's fine, browsers only parse attributes outside quoted values.
  // What MUST NOT survive is the raw `"` that would close the href attr early.
  const malicious = 'https://x/auth?token=" onclick=alert(1) x="';
  const html = buildMagicLinkHtml(malicious);
  // The malicious raw quote must be escaped to &quot;
  assert.equal(html.includes(`href="${malicious}"`), false,
    'raw malicious link must NOT appear verbatim inside href attribute');
  assert.match(html, /&quot;/, 'quotes in the link must be escaped');
});

// ═════════════════════════════════════════════════════════
// sendMagicLink — fallback when BREVO_API_KEY unset
// ═════════════════════════════════════════════════════════

test('🛑 sendMagicLink: no BREVO_API_KEY → fallback (ok:true, stubbed, never calls fetch)', async () => {
  delete process.env.BREVO_API_KEY;
  let fetchCalled = false;
  _setFetchFn(async () => { fetchCalled = true; return { ok: true, status: 200, text: async () => '' }; });
  const r = await sendMagicLink('vivi@example.com', 'https://x/auth?token=t');
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /BREVO_API_KEY/);
  assert.equal(fetchCalled, false, 'must not hit network when key is unset');
});

// ═════════════════════════════════════════════════════════
// sendMagicLink — real send (mocked fetch)
// ═════════════════════════════════════════════════════════

test('🛑 sendMagicLink: with BREVO_API_KEY → POSTs to Brevo endpoint with correct shape', async () => {
  process.env.BREVO_API_KEY = 'fake-key-for-test';
  let captured = null;
  _setFetchFn(async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 201, text: async () => '' };
  });
  const r = await sendMagicLink('vivi@example.com', 'https://preview.example.com/auth?token=abc');
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, undefined, 'real send returns no stubbed flag');
  assert.equal(r.status, 201);

  // URL
  assert.equal(captured.url, 'https://api.brevo.com/v3/smtp/email');
  // Method + headers
  assert.equal(captured.opts.method, 'POST');
  assert.equal(captured.opts.headers['api-key'], 'fake-key-for-test');
  assert.equal(captured.opts.headers['content-type'], 'application/json');
  assert.equal(captured.opts.headers['accept'], 'application/json');
  // Body
  const body = JSON.parse(captured.opts.body);
  assert.equal(body.sender.email, 'help@seeyourself.now', 'sender email per Patrick spec');
  assert.equal(body.sender.name, '看見自己', 'sender display name per Patrick spec');
  assert.deepEqual(body.to, [{ email: 'vivi@example.com' }]);
  assert.equal(body.subject, '登入連結 · 看見自己');
  assert.match(body.htmlContent, /href="https:\/\/preview\.example\.com\/auth\?token=abc"/);
  assert.match(body.htmlContent, />進入對話 →</);
  // 🛑 6/8 Patrick — multipart/alternative: textContent must also be in payload.
  assert.equal(typeof body.textContent, 'string',
    'textContent must be a string (mail-tester MIME_HTML_ONLY fix)');
  assert.ok(body.textContent.length > 0, 'textContent must be non-empty');
  assert.ok(body.textContent.includes('https://preview.example.com/auth?token=abc'),
    'textContent must contain the raw magic-link URL');
});

// ═════════════════════════════════════════════════════════
// sendMagicLink — fallback on Brevo non-2xx
// ═════════════════════════════════════════════════════════

test('🛑 sendMagicLink: Brevo returns 5xx → fallback (ok:true so auth flow does NOT crash)', async () => {
  process.env.BREVO_API_KEY = 'fake-key-for-test';
  _setFetchFn(async () => ({
    ok: false, status: 502,
    text: async () => '<html>bad gateway</html>',
  }));
  const r = await sendMagicLink('a@b.com', 'https://x/auth?token=t');
  assert.equal(r.ok, true,
    'auth flow must not crash on email-provider trouble — fallback to log');
  assert.equal(r.stubbed, true);
  assert.equal(r.status, 502);
  assert.match(r.reason, /Brevo 502/);
});

test('🛑 sendMagicLink: Brevo returns 4xx → fallback (same behavior)', async () => {
  process.env.BREVO_API_KEY = 'fake-key-for-test';
  _setFetchFn(async () => ({
    ok: false, status: 401,
    text: async () => '{"message":"unauthorized"}',
  }));
  const r = await sendMagicLink('a@b.com', 'https://x/auth?token=t');
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /Brevo 401/);
});

// ═════════════════════════════════════════════════════════
// sendMagicLink — fallback on fetch throw (network down)
// ═════════════════════════════════════════════════════════

test('🛑 sendMagicLink: fetch throws → fallback (ok:true so auth flow does NOT crash)', async () => {
  process.env.BREVO_API_KEY = 'fake-key-for-test';
  _setFetchFn(async () => { throw new Error('ENOTFOUND api.brevo.com'); });
  const r = await sendMagicLink('a@b.com', 'https://x/auth?token=t');
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /ENOTFOUND/);
});

// ═════════════════════════════════════════════════════════
// sendExportEmail — existing stub behaviour preserved (separate task)
// ═════════════════════════════════════════════════════════

test('sendExportEmail: no BREVO_API_KEY → stubbed:true, ok:true, reason mentions BREVO_API_KEY', async () => {
  delete process.env.BREVO_API_KEY;
  const r = await sendExportEmail({
    toEmail: 'a001@example.com', studentId: 'A001',
    subject: 'x', markdownBody: '# 你的個人教練 prompt\n...',
  });
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /BREVO_API_KEY/);
});

test('sendExportEmail: BREVO_API_KEY set but not yet wired → still stubbed (follow-up task)', async () => {
  process.env.BREVO_API_KEY = 'fake-key-for-test';
  const r = await sendExportEmail({
    toEmail: 'a001@example.com', studentId: 'A001',
    subject: 'x', markdownBody: '# body',
  });
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /follow-up/);
});

test('sendExportEmail: missing toEmail → ok:false', async () => {
  const r = await sendExportEmail({ studentId: 'A001', markdownBody: 'body' });
  assert.equal(r.ok, false);
  assert.match(r.error, /toEmail/);
});

test('sendExportEmail: missing markdownBody → ok:false', async () => {
  const r = await sendExportEmail({ toEmail: 'x@y.com', studentId: 'A001' });
  assert.equal(r.ok, false);
  assert.match(r.error, /markdownBody/);
});

test('escapeHtml: encodes the 5 dangerous chars', () => {
  assert.equal(escapeHtml('<a href="x" foo=\'y\'>&'), '&lt;a href=&quot;x&quot; foo=&#39;y&#39;&gt;&amp;');
});

// ═════════════════════════════════════════════════════════
// buildGuideEmailHtml + sendGuideEmail (Stage 0 漏斗 PDF)
// ═════════════════════════════════════════════════════════

test('buildGuideEmailHtml: contains the PDF URL as button href + plain-text fallback', () => {
  const html = buildGuideEmailHtml('https://preview.example.com/assets/guide/value-guide.pdf');
  assert.match(html, /href="https:\/\/preview\.example\.com\/assets\/guide\/value-guide\.pdf"/);
  // 7/15 v11: 「下載PDF」 → 「下載練習 →」 (Vivi 定稿)
  assert.match(html, /下載練習 →/);
  assert.match(html, /如果按鈕沒反應/);
  // Subject-defining copy mentions the practice name.
  assert.match(html, /價值觀挖掘練習/);
});

// 🛑 6/2 Patrick — 防回退「指南」 / 舊綠 hex.
test('🛑 buildGuideEmailHtml: 命名 + brand transition (無「指南」 + 無舊綠/粉赤陶 hex)', () => {
  const html = buildGuideEmailHtml('https://x/assets/guide/value-guide.pdf');
  // 命名: 不能出現「指南」, 必須「練習」.
  assert.equal(/指南/.test(html), false, '不該出現「指南」 (已改名為「練習」)');
  assert.equal(/下載你的指南/.test(html), false, '按鈕文字不該回退「下載你的指南」');
  // 舊綠 hex 完全消失 (8 個 token 跟 magic-link template dafb3dc 同).
  for (const oldHex of ['#5DA873', '#3E9D5C', '#BFD7BA', '#FBF6EC',
                         '#E3B340', '#A7BCA4', '#6E8A6E', '#2C3A2C',
                         '#f7ebe5', '#E8C6B8', '#c66b4f', '#d6826a',
                         '#2d2422', '#9c8c87', '#6b5c57']) {
    assert.equal(html.includes(oldHex), false,
      `舊綠/粉赤陶 hex ${oldHex} 仍出現在 guide email — brand transition 漏一處`);
  }
  // 新古銅金 hex 必須在 (對齊身分重塑頁 + magic-link template).
  for (const newHex of ['#F8F8F8', '#B58F5C', '#D8B27F', '#2E333D']) {
    assert.ok(html.includes(newHex),
      `新古銅金 hex ${newHex} 必須在 guide email (對齊身分重塑頁)`);
  }
});

test('🛑 buildGuideEmailHtml: button carries clicktracking="off" (Brevo opt-out)', () => {
  const html = buildGuideEmailHtml('https://x/assets/guide/value-guide.pdf');
  assert.match(html, /<a href="https:\/\/x\/assets\/guide\/value-guide\.pdf" clicktracking="off"/,
    'PDF button must have clicktracking="off" so Brevo skips redirect-wrapping');
});

test('buildGuideEmailHtml: escapes html-dangerous chars in the URL', () => {
  const html = buildGuideEmailHtml('https://x?<script>alert(1)</script>');
  assert.match(html, /&lt;script&gt;/);
  // The raw <script> tag must NOT appear unescaped anywhere
  assert.equal(/[^&]<script>/.test(html), false);
});

test('sendGuideEmail: no BREVO_API_KEY → stub fallback {ok:true, stubbed:true}', async () => {
  const r = await sendGuideEmail('a@b.co', 'https://x/assets/guide/value-guide.pdf');
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /BREVO_API_KEY/);
});

test('sendGuideEmail: with BREVO_API_KEY + successful fetch → {ok:true} (no stub)', async () => {
  process.env.BREVO_API_KEY = 'fake-key';
  const captured = [];
  _setFetchFn(async (url, init) => {
    captured.push({ url, init });
    return { ok: true, status: 201, text: async () => '' };
  });
  const r = await sendGuideEmail('a@b.co', 'https://x/assets/guide/value-guide.pdf');
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, undefined);
  // Brevo endpoint hit with the right shape.
  assert.equal(captured.length, 1);
  assert.match(captured[0].url, /api\.brevo\.com\/v3\/smtp\/email/);
  const body = JSON.parse(captured[0].init.body);
  assert.equal(body.to[0].email, 'a@b.co');
  assert.match(body.subject, /價值觀挖掘練習/);
  // 🛑 6/8 Patrick — multipart/alternative: textContent must also be in payload.
  assert.equal(typeof body.textContent, 'string');
  assert.ok(body.textContent.length > 0);
  assert.ok(body.textContent.includes('https://x/assets/guide/value-guide.pdf'),
    'textContent must contain the raw PDF URL');
});

test('sendGuideEmail: Brevo returns 4xx → stub fallback (funnel never breaks)', async () => {
  process.env.BREVO_API_KEY = 'fake-key';
  _setFetchFn(async () => ({ ok: false, status: 429, text: async () => 'rate limited' }));
  const r = await sendGuideEmail('a@b.co', 'https://x/assets/guide/value-guide.pdf');
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /429/);
});

test('sendGuideEmail: fetch throws → stub fallback', async () => {
  process.env.BREVO_API_KEY = 'fake-key';
  _setFetchFn(async () => { throw new Error('ECONNRESET'); });
  const r = await sendGuideEmail('a@b.co', 'https://x/assets/guide/value-guide.pdf');
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /ECONNRESET/);
});

// ═════════════════════════════════════════════════════════
// 🛑 6/8 Patrick — plain-text 替代版 (mail-tester MIME_HTML_ONLY fix)
// buildMagicLinkText + buildGuideEmailText: mirror HTML visible copy,
// no HTML tags, contains raw URL.
// ═════════════════════════════════════════════════════════

test('🛑 6/8 buildMagicLinkText: returns string with the raw link (no HTML wrap)', () => {
  const txt = buildMagicLinkText('https://preview.example.com/auth?token=abc123');
  assert.equal(typeof txt, 'string');
  assert.ok(txt.length > 0);
  assert.ok(txt.includes('https://preview.example.com/auth?token=abc123'),
    'plain-text must contain the raw URL');
});

test('🛑 6/8 buildMagicLinkText: no HTML tags (real plain-text, not html-wrapped)', () => {
  const txt = buildMagicLinkText('https://x/auth?token=abc');
  // No <tag> ... </tag> anywhere — strict plain-text.
  assert.equal(/<[a-zA-Z\/!][^>]*>/.test(txt), false,
    `plain-text must not contain ANY HTML tags. got: ${txt}`);
  // No HTML entity escaping either (plain-text doesn't need it).
  assert.equal(/&[a-zA-Z]+;|&#\d+;/.test(txt), false,
    'plain-text must not contain HTML entities (raw chars OK)');
});

test('🛑 7/15 v11 buildMagicLinkText: mirrors HTML visible copy (60 分鐘 / 看見自己 / 看見自己團隊)', () => {
  const txt = buildMagicLinkText('https://x/auth?token=z');
  // Visible copy from buildMagicLinkHtml — 7/15 v11 品牌.
  assert.match(txt, /^看見自己\n/);   // 第一行 masthead
  assert.match(txt, /60 分鐘內有效/);
  assert.match(txt, /看見自己團隊/);   // 署名
  // No 20-min regression (TTL 5/28 改成 60).
  assert.equal(/20 分鐘內有效/.test(txt), false);
  // Anti-regression: 7/15 v11 舊品牌名清乾淨
  assert.doesNotMatch(txt, /21天身分重塑計畫/);
});

test('🛑 6/8 buildMagicLinkText: uses real newlines (not \\n literals)', () => {
  const txt = buildMagicLinkText('https://x/auth?token=t');
  assert.ok(txt.includes('\n'), 'plain-text must contain real newline chars');
  // No literal "\n" backslash-n appearing (that would mean a string-escape leak).
  assert.equal(/\\n/.test(txt), false);
});

test('🛑 6/8 buildGuideEmailText: returns string with the raw pdfUrl (no HTML wrap)', () => {
  const txt = buildGuideEmailText('https://preview.example.com/assets/guide/value-guide.pdf');
  assert.equal(typeof txt, 'string');
  assert.ok(txt.length > 0);
  assert.ok(txt.includes('https://preview.example.com/assets/guide/value-guide.pdf'),
    'plain-text must contain the raw PDF URL');
});

test('🛑 7/15 v11 buildGuideEmailText: no HTML tags + mirrors HTML visible copy', () => {
  const txt = buildGuideEmailText('https://x/assets/guide/value-guide.pdf');
  // No HTML tags.
  assert.equal(/<[a-zA-Z\/!][^>]*>/.test(txt), false);
  // Visible copy from buildGuideEmailHtml — 7/15 v11 定稿.
  assert.match(txt, /^看見自己\n/);   // 第一行 masthead
  assert.match(txt, /這是你的《價值觀挖掘練習》。/);   // 新版無 「PDF」 兩字, 加句號
  assert.match(txt, /找一段安靜的時間，慢慢寫。/);
  assert.match(txt, /看見自己團隊/);   // 署名
  // 「指南」 → 「練習」 6/2 rename — must not regress.
  assert.equal(/指南/.test(txt), false, '不該回退「指南」 (已改名「練習」)');
  // Anti-regression: 7/15 v11 舊品牌名清乾淨
  assert.doesNotMatch(txt, /21天身分重塑計畫/);
});

test('🛑 6/8 sendMagicLink no-key fallback unchanged (textContent added without breaking stub path)', async () => {
  // Anti-regression: plain-text addition must not break the fallback contract.
  delete process.env.BREVO_API_KEY;
  let fetchCalled = false;
  _setFetchFn(async () => { fetchCalled = true; return { ok: true, status: 200, text: async () => '' }; });
  const r = await sendMagicLink('vivi@example.com', 'https://x/auth?token=t');
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, true);
  assert.equal(fetchCalled, false);
});

test('🛑 6/8 sendGuideEmail no-key fallback unchanged', async () => {
  delete process.env.BREVO_API_KEY;
  let fetchCalled = false;
  _setFetchFn(async () => { fetchCalled = true; return { ok: true, status: 200, text: async () => '' }; });
  const r = await sendGuideEmail('a@b.co', 'https://x/assets/guide/value-guide.pdf');
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, true);
  assert.equal(fetchCalled, false);
});

// 0-diff don't-touch: HTML builders unchanged in content.
test('🛑 6/8 don\'t-touch: buildMagicLinkHtml content 0-diff (clicktracking="off" + 60 分鐘 + 古銅金 hex)', () => {
  // Sanity sample landmarks (full set covered by earlier sync-gates).
  const html = buildMagicLinkHtml('https://x/auth?token=abc');
  assert.match(html, /<a href="https:\/\/x\/auth\?token=abc" clicktracking="off"/);
  assert.match(html, /60 分鐘內有效/);
  assert.ok(html.includes('#B58F5C') && html.includes('#F8F8F8'));
});

test('🛑 6/8 don\'t-touch: buildGuideEmailHtml content 0-diff (clicktracking="off" + 練習 + 古銅金 hex)', () => {
  const html = buildGuideEmailHtml('https://x/assets/guide/value-guide.pdf');
  assert.match(html, /<a href="https:\/\/x\/assets\/guide\/value-guide\.pdf" clicktracking="off"/);
  assert.match(html, /價值觀挖掘練習/);
  assert.ok(html.includes('#B58F5C') && html.includes('#F8F8F8'));
});

const CARD = '你今天說的「不是我想要的」，藏著一個渴望。\n你想要的，是能自己決定方向。';
test('🛑 buildDailyCardHtml: 卡文進內文 + \n→<br> + 身分解析卡', () => {
  const h = buildDailyCardHtml(CARD);
  assert.match(h, /你今天說的/); assert.match(h, /藏著一個渴望。<br>/); assert.match(h, /身分解析卡/);
});
test('🛑 buildDailyCardHtml: 無按鈕/連結', () => {
  const h = buildDailyCardHtml(CARD); assert.equal(/<a /.test(h), false);
});
test('🛑 buildDailyCardHtml: 古銅金 hex + 看見自己團隊, 無舊赤陶', () => {
  const h = buildDailyCardHtml(CARD);
  for (const x of ['#F8F8F8','#B58F5C','#D8B27F','#2E333D']) assert.ok(h.includes(x));
  for (const x of ['#c66b4f','#f7ebe5','#d6826a']) assert.equal(h.includes(x), false);
  assert.match(h, /看見自己團隊/);
});
test('🛑 buildDailyCardHtml: escape 卡片內容', () => {
  assert.equal(/[^&]<script>/.test(buildDailyCardHtml('<script>x</script>')), false);
});
test('🛑 buildDailyCardText: 鏡像, 無 HTML tag, 無連結', () => {
  const t = buildDailyCardText(CARD);
  assert.match(t, /身分解析卡/); assert.match(t, /看見自己團隊/);
  assert.equal(/<[a-zA-Z\/!][^>]*>/.test(t), false); assert.equal(/https?:\/\//.test(t), false);
});
test('🛑 sendDailyCardEmail: no key → stub', async () => {
  const r = await sendDailyCardEmail('a@b.co', CARD);
  assert.equal(r.ok, true); assert.equal(r.stubbed, true); assert.match(r.reason, /BREVO_API_KEY/);
});
test('🛑 sendDailyCardEmail: with key → POST shape', async () => {
  process.env.BREVO_API_KEY='fake-key'; const cap=[];
  _setFetchFn(async (u,i)=>{cap.push({u,i});return{ok:true,status:201,text:async()=>''}});
  const r = await sendDailyCardEmail('a@b.co', CARD);
  assert.equal(r.ok,true); assert.equal(r.stubbed,undefined); assert.equal(cap.length,1);
  const b=JSON.parse(cap[0].i.body); assert.equal(b.to[0].email,'a@b.co'); assert.match(b.subject,/身分解析卡/);
  assert.equal(typeof b.textContent,'string'); assert.ok(b.textContent.length>0);
});
test('🛑 sendDailyCardEmail: 4xx/throw → stub', async () => {
  process.env.BREVO_API_KEY='fake-key';
  _setFetchFn(async()=>({ok:false,status:429,text:async()=>'r'}));
  let r=await sendDailyCardEmail('a@b.co',CARD); assert.equal(r.stubbed,true); assert.match(r.reason,/429/);
  _setFetchFn(async()=>{throw new Error('ECONNRESET')});
  r=await sendDailyCardEmail('a@b.co',CARD); assert.equal(r.stubbed,true); assert.match(r.reason,/ECONNRESET/);
});

// ═════════════════════════════════════════════════════════
// 7/30 Vivi — seminar 上線 (問對問題 9/30 免費線上講座)
//
// SEMINAR_LIST_ID env 需要獨立的 save/restore hooks — 疊在既有 hooks 之上,
// node:test 依定義順序執行,不會互相干擾.
// ═════════════════════════════════════════════════════════

let _savedSeminarListId;
beforeEach(() => {
  _savedSeminarListId = process.env.SEMINAR_LIST_ID;
  delete process.env.SEMINAR_LIST_ID;
});
afterEach(() => {
  if (_savedSeminarListId === undefined) delete process.env.SEMINAR_LIST_ID;
  else process.env.SEMINAR_LIST_ID = _savedSeminarListId;
});

const SEMINAR_THANKS_URL = 'https://preview.example.com/seminar/thanks';

// ─── buildSeminarConfirmationHtml (pure) ─────────────────

test('🛑 7/30 buildSeminarConfirmationHtml: Vivi 定稿 verbatim (3 行內文 + 主旨語意)', () => {
  const html = buildSeminarConfirmationHtml(SEMINAR_THANKS_URL);
  // Masthead 對齊 v11 (magic-link / guide) 古銅金 verbatim
  assert.match(html, /color:#B58F5C;font-weight:700;">看見自己/);
  assert.match(html, /SEE YOURSELF/);
  // Eyebrow「問對問題 · 9/30 免費講座」
  assert.match(html, /問對問題 · 9\/30 免費講座/);
  // 3 行內文 (Vivi 7/30 verbatim, 全形標點)
  assert.match(html, /你報名成功了。9 月 30 日（三）· 台灣時間晚上 9:00 · 線上 · 90 分鐘。/);
  assert.match(html, /開始前，我們會把講座連結再寄一次給你。/);
  assert.match(html, /在那之前，你可以先想一件事：你最近最想問自己的一個問題，是什麼？把它帶來講座。/);
  // 按鈕 verbatim「加入行事曆 →」+ 墨黑 CTA #2E333D
  assert.match(html, /background:#2E333D/);
  assert.match(html, />加入行事曆 →</);
  // 反向鎖:無舊品牌「21天身分重塑計畫」 / 無「——」破折號
  assert.doesNotMatch(html, /21天身分重塑計畫/);
  assert.equal(/——/.test(html), false, '無「——」破折號');
});

test('🛑 buildSeminarConfirmationHtml: button carries clicktracking="off" (Brevo redirector defense)', () => {
  const html = buildSeminarConfirmationHtml(SEMINAR_THANKS_URL);
  assert.match(html, /<a href="https:\/\/preview\.example\.com\/seminar\/thanks" clicktracking="off"/);
});

test('🛑 buildSeminarConfirmationHtml: escape URL (XSS defense in-mail-client)', () => {
  const html = buildSeminarConfirmationHtml('https://x/thanks?q=<script>');
  assert.equal(/[^&]<script>/.test(html), false);
});

test('🛑 buildSeminarConfirmationText: mirror (verbatim 3 行內文, 無 HTML tag, 無破折號)', () => {
  const t = buildSeminarConfirmationText(SEMINAR_THANKS_URL);
  assert.match(t, /^看見自己\n/);
  assert.match(t, /問對問題 · 9\/30 免費講座/);
  assert.match(t, /你報名成功了。9 月 30 日（三）· 台灣時間晚上 9:00 · 線上 · 90 分鐘。/);
  assert.match(t, /開始前，我們會把講座連結再寄一次給你。/);
  assert.match(t, /在那之前，你可以先想一件事：你最近最想問自己的一個問題，是什麼？把它帶來講座。/);
  assert.match(t, /看見自己團隊$/);
  assert.equal(/<[a-zA-Z/!][^>]*>/.test(t), false, '無 HTML tag');
  assert.equal(/——/.test(t), false, '無「——」破折號');
});

// ─── sendSeminarConfirmation (mailer) ────────────────────

test('🛑 sendSeminarConfirmation: no key → stub', async () => {
  const r = await sendSeminarConfirmation('a@b.co', SEMINAR_THANKS_URL);
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /BREVO_API_KEY/);
});

test('🛑 sendSeminarConfirmation: with key → POST /v3/smtp/email (subject / sender / textContent)', async () => {
  process.env.BREVO_API_KEY = 'fake-key';
  const cap = [];
  _setFetchFn(async (u, i) => { cap.push({ u, i }); return { ok: true, status: 201, text: async () => '' }; });
  const r = await sendSeminarConfirmation('a@b.co', SEMINAR_THANKS_URL);
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, undefined);
  assert.equal(cap.length, 1);
  assert.equal(cap[0].u, 'https://api.brevo.com/v3/smtp/email');
  const b = JSON.parse(cap[0].i.body);
  assert.equal(b.to[0].email, 'a@b.co');
  assert.equal(b.subject, '你報名了 · 問對問題講座 9/30');
  assert.equal(b.sender.email, 'help@seeyourself.now');
  assert.equal(b.sender.name, '看見自己');
  assert.equal(typeof b.textContent, 'string');
  assert.ok(b.textContent.length > 0, 'multipart/alternative — textContent 必要');
});

test('🛑 sendSeminarConfirmation: 4xx/throw → stub', async () => {
  process.env.BREVO_API_KEY = 'fake-key';
  _setFetchFn(async () => ({ ok: false, status: 429, text: async () => 'rate' }));
  let r = await sendSeminarConfirmation('a@b.co', SEMINAR_THANKS_URL);
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /429/);
  _setFetchFn(async () => { throw new Error('ECONNRESET'); });
  r = await sendSeminarConfirmation('a@b.co', SEMINAR_THANKS_URL);
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /ECONNRESET/);
});

// ─── addToSeminarList (POST /v3/contacts) ────────────────

test('🛑 addToSeminarList: no key → stub', async () => {
  const r = await addToSeminarList('a@b.co', { question: 'q', source: 'hero' });
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /BREVO_API_KEY/);
});

test('🛑 addToSeminarList: no SEMINAR_LIST_ID → stub', async () => {
  process.env.BREVO_API_KEY = 'fake-key';
  // SEMINAR_LIST_ID cleared by beforeEach
  const r = await addToSeminarList('a@b.co', { question: 'q', source: 'hero' });
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /SEMINAR_LIST_ID/);
});

test('🛑 addToSeminarList: bad SEMINAR_LIST_ID (non-numeric) → stub', async () => {
  process.env.BREVO_API_KEY = 'fake-key';
  process.env.SEMINAR_LIST_ID = 'not-a-number';
  const r = await addToSeminarList('a@b.co', { question: 'q', source: 'hero' });
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /SEMINAR_LIST_ID/);
});

test('🛑 addToSeminarList: success → POST /v3/contacts with listIds + attributes + updateEnabled', async () => {
  process.env.BREVO_API_KEY = 'fake-key';
  process.env.SEMINAR_LIST_ID = '42';
  const cap = [];
  _setFetchFn(async (u, i) => { cap.push({ u, i }); return { ok: true, status: 201, text: async () => '' }; });
  const r = await addToSeminarList('a@b.co', { question: '為什麼？', source: 'hero' });
  assert.equal(r.ok, true);
  assert.equal(r.stubbed, undefined);
  assert.equal(cap.length, 1);
  assert.equal(cap[0].u, 'https://api.brevo.com/v3/contacts');
  const b = JSON.parse(cap[0].i.body);
  assert.equal(b.email, 'a@b.co');
  assert.deepEqual(b.listIds, [42]);
  assert.equal(b.updateEnabled, true);
  assert.equal(b.attributes.QUESTION, '為什麼？');
  assert.equal(b.attributes.SOURCE, 'hero');
});

test('🛑 addToSeminarList: missing attrs → empty strings (no crash)', async () => {
  process.env.BREVO_API_KEY = 'fake-key';
  process.env.SEMINAR_LIST_ID = '42';
  const cap = [];
  _setFetchFn(async (u, i) => { cap.push({ u, i }); return { ok: true, status: 204, text: async () => '' }; });
  await addToSeminarList('a@b.co');
  const b = JSON.parse(cap[0].i.body);
  assert.equal(b.attributes.QUESTION, '');
  assert.equal(b.attributes.SOURCE, '');
});

test('🛑 addToSeminarList: 4xx/throw → stub', async () => {
  process.env.BREVO_API_KEY = 'fake-key';
  process.env.SEMINAR_LIST_ID = '42';
  _setFetchFn(async () => ({ ok: false, status: 400, text: async () => 'bad' }));
  let r = await addToSeminarList('a@b.co', { question: 'q', source: 'hero' });
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /400/);
  _setFetchFn(async () => { throw new Error('EAI_AGAIN'); });
  r = await addToSeminarList('a@b.co', { question: 'q', source: 'hero' });
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /EAI_AGAIN/);
});

// ─── createSeminarList (setup helper, POST /v3/contacts/lists) ────

test('🛑 createSeminarList: no key → ok:false stubbed', async () => {
  const r = await createSeminarList('問對問題 9/30 講座');
  assert.equal(r.ok, false);
  assert.equal(r.stubbed, true);
  assert.match(r.reason, /BREVO_API_KEY/);
});

test('🛑 createSeminarList: empty name → ok:false with reason', async () => {
  process.env.BREVO_API_KEY = 'fake-key';
  const r = await createSeminarList('');
  assert.equal(r.ok, false);
  assert.match(r.reason, /name required/);
});

test('🛑 createSeminarList: success → returns listId (folderId defaults 1)', async () => {
  process.env.BREVO_API_KEY = 'fake-key';
  const cap = [];
  _setFetchFn(async (u, i) => {
    cap.push({ u, i });
    return {
      ok: true, status: 201,
      text: async () => '',
      json: async () => ({ id: 88 }),
    };
  });
  const r = await createSeminarList('問對問題 9/30 講座');
  assert.equal(r.ok, true);
  assert.equal(r.listId, 88);
  assert.equal(cap[0].u, 'https://api.brevo.com/v3/contacts/lists');
  const b = JSON.parse(cap[0].i.body);
  assert.equal(b.name, '問對問題 9/30 講座');
  assert.equal(b.folderId, 1);
});

test('🛑 createSeminarList: custom folderId honored', async () => {
  process.env.BREVO_API_KEY = 'fake-key';
  const cap = [];
  _setFetchFn(async (u, i) => {
    cap.push({ u, i });
    return { ok: true, status: 201, text: async () => '', json: async () => ({ id: 99 }) };
  });
  const r = await createSeminarList('X', 7);
  assert.equal(r.ok, true);
  const b = JSON.parse(cap[0].i.body);
  assert.equal(b.folderId, 7);
});

test('🛑 createSeminarList: 4xx → ok:false with detail (Vivi 可看 log 調整)', async () => {
  process.env.BREVO_API_KEY = 'fake-key';
  _setFetchFn(async () => ({ ok: false, status: 400, text: async () => 'invalid folderId' }));
  const r = await createSeminarList('X');
  assert.equal(r.ok, false);
  assert.match(r.reason, /400/);
  assert.match(r.detail, /invalid folderId/);
});

test('🛑 createSeminarList: throw → ok:false', async () => {
  process.env.BREVO_API_KEY = 'fake-key';
  _setFetchFn(async () => { throw new Error('ECONNRESET'); });
  const r = await createSeminarList('X');
  assert.equal(r.ok, false);
  assert.match(r.reason, /ECONNRESET/);
});
