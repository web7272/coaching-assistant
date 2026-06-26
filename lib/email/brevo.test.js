// lib/email/brevo.test.js
// PR-4c-green Auth rebuild stage 1f — Brevo real-send for sendMagicLink +
// existing sendExportEmail stub coverage preserved.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  sendMagicLink,
  sendExportEmail,
  sendGuideEmail,
  buildMagicLinkHtml,
  buildMagicLinkText,   // 6/8 Patrick — plain-text 替代版
  buildGuideEmailHtml,
  buildGuideEmailText,  // 6/8 Patrick — plain-text 替代版
  escapeHtml,
  _setFetchFn,
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
  // Login button label (paper aesthetic, not「Sign in」 EN)
  assert.match(html, />登入</);
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

test('buildMagicLinkHtml: warm copy + 60-min expiry mention (TTL 20→60 5/28, copy 同步 6/2)', () => {
  const html = buildMagicLinkHtml('https://x/auth?token=z');
  assert.match(html, /60 分鐘內有效/);
  assert.equal(/20 分鐘內有效/.test(html), false, 'must not regress to「20 分鐘」 (backend TTL 已 60)');
  assert.match(html, /21天身分重塑計畫/);   // 產品名 (公司名 看見自己 在寄件人/署名)
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
  assert.match(body.htmlContent, />登入</);
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
  // 6/2 Patrick — 「指南」 → 「練習」 對齊 Vivi 5/29 換真版 PDF 命名.
  assert.match(html, /下載PDF/);
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

test('🛑 6/8 buildMagicLinkText: mirrors HTML visible copy (60 分鐘 / 21天身分重塑計畫 / 看見自己團隊)', () => {
  const txt = buildMagicLinkText('https://x/auth?token=z');
  // Visible copy from buildMagicLinkHtml.
  assert.match(txt, /21天身分重塑計畫/);
  assert.match(txt, /60 分鐘內有效/);
  assert.match(txt, /看見自己團隊/);
  // No 20-min regression (TTL 5/28 改成 60).
  assert.equal(/20 分鐘內有效/.test(txt), false);
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

test('🛑 6/8 buildGuideEmailText: no HTML tags + mirrors HTML visible copy', () => {
  const txt = buildGuideEmailText('https://x/assets/guide/value-guide.pdf');
  // No HTML tags.
  assert.equal(/<[a-zA-Z\/!][^>]*>/.test(txt), false);
  // Visible copy from buildGuideEmailHtml.
  assert.match(txt, /21天身分重塑計畫/);
  assert.match(txt, /這是你的《價值觀挖掘練習》PDF/);
  assert.match(txt, /看見自己團隊/);
  // 「指南」 → 「練習」 6/2 rename — must not regress.
  assert.equal(/指南/.test(txt), false, '不該回退「指南」 (已改名「練習」)');
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
