// lib/email/brevo.test.js
// PR-4c-green Auth rebuild stage 1f — Brevo real-send for sendMagicLink +
// existing sendExportEmail stub coverage preserved.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  sendMagicLink,
  sendExportEmail,
  buildMagicLinkHtml,
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

test('buildMagicLinkHtml: warm copy + 20-min expiry mention (per Patrick spec)', () => {
  const html = buildMagicLinkHtml('https://x/auth?token=z');
  assert.match(html, /只屬於這封信、20 分鐘內有效/);
  assert.match(html, /看見自己/);   // brand
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
