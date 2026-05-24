// lib/email/brevo.js
// Brevo (formerly Sendinblue) transactional email.
//
// Endpoint: POST https://api.brevo.com/v3/smtp/email
//   headers: api-key: BREVO_API_KEY, content-type: application/json,
//            accept: application/json
//   body:    { sender, to, subject, htmlContent }
//
// Fallback contract (per Patrick 5/24): if BREVO_API_KEY is missing OR the
// send fails for any reason, log `[brevo:fallback] <email>: <link>` and
// return { ok: true, stubbed: true, reason } so封測 can copy the link from
// Vercel stdout. The auth flow MUST NOT break on email-provider trouble.
//
// ⚠️ Brevo CLICK TRACKING is the dragon here (PR-4c-green Auth rebuild 1g).
// Brevo defaults to wrapping every <a href> in `sendibt2.com/tr/cl/...`
// redirector for click analytics. That broke the magic-link button (Vivi
// 5/24:「按鈕 → ERR_INVALID_REDIRECT」) because the long ?token=… URL got
// mangled by the redirector.
//
// Three layers of defense (most→least preferred):
//   1. Per-link opt-out HTML attribute — Brevo's documented escape hatch:
//      `<a href="..." clicktracking="off">` skips that specific link. We add
//      this on the magic-link button + plain-text fallback line. Covers our
//      use without requiring an account-level toggle.
//   2. Plain-text fallback line (`<span>` not `<a>`) — never wrapped because
//      it's not an anchor tag. Existing belt-and-suspenders.
//   3. Account-level toggle in Brevo dashboard — Vivi action (last resort):
//      Settings → Tracking Settings → Click Tracking → OFF (for the SMTP
//      sender used by transactional API). This kills all click tracking for
//      every transactional email, not just magic links. Only flip if (1) +
//      (2) somehow stop working in a future Brevo behavior change.
//
// sendExportEmail (Day 21 personal-coach-prompt export) is left as the prior
// stub — wiring it for real Brevo is a separate task (different template +
// markdown→html conversion is heavier).

const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email';
const SENDER_EMAIL = 'help@seeyourself.now';
const SENDER_NAME  = '看見自己';

// ─── test seam: inject a mock fetch (so the network never actually fires) ───
let _fetchFn = null;
/** @param {typeof globalThis.fetch | null} fn */
export function _setFetchFn(fn) { _fetchFn = fn; }
function getFetch() { return _fetchFn || globalThis.fetch; }

// ─── pure helper: build the magic-link email HTML ───────────────────────

/**
 * 暖短信 + 一顆登入按鈕。Plain HTML (no external CSS/images) so it renders
 * the same in Gmail / Outlook / Apple Mail without remote fetch warnings.
 *
 * ⚠️ The `clicktracking="off"` attribute on the login button is critical —
 *    it tells Brevo to skip wrapping this link in their click-tracking
 *    redirector (sendibt2.com/tr/cl/…). Without it the long ?token=… URL
 *    gets mangled and the user sees ERR_INVALID_REDIRECT (Vivi 5/24 bug).
 *    Pure helper, exported for testing.
 *
 * @param {string} link
 * @returns {string} html
 */
export function buildMagicLinkHtml(link) {
  // 連結走 escapeHtml 防 XSS in mail clients that render naively.
  const safeLink = escapeHtml(link);
  return `<!DOCTYPE html>
<html lang="zh-TW">
<body style="margin:0;padding:0;background:#FBF6EC;font-family:'Noto Serif TC',Georgia,serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FBF6EC;padding:48px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border:0.5px solid #BFD7BA;border-radius:14px;padding:40px 32px;">
        <tr><td style="text-align:center;font-size:13px;letter-spacing:4px;color:#5DA873;">看見自己</td></tr>
        <tr><td style="height:14px;"></td></tr>
        <tr><td style="text-align:center;">
          <div style="width:24px;height:0.5px;background:#E3B340;margin:0 auto;"></div>
        </td></tr>
        <tr><td style="height:28px;"></td></tr>
        <tr><td style="font-size:15px;line-height:2;color:#2C3A2C;">
          點下面這顆按鈕就能進來——<br>
          只屬於這封信、20 分鐘內有效。
        </td></tr>
        <tr><td style="height:28px;"></td></tr>
        <tr><td align="center">
          <a href="${safeLink}" clicktracking="off" style="display:inline-block;padding:14px 36px;background:#3E9D5C;color:#FFFFFF;text-decoration:none;font-size:15px;letter-spacing:4px;border-radius:10px;">登入</a>
        </td></tr>
        <tr><td style="height:24px;"></td></tr>
        <tr><td style="font-size:11px;color:#A7BCA4;line-height:1.7;">
          如果按鈕沒反應，把這串貼進瀏覽器：<br>
          <span style="word-break:break-all;color:#6E8A6E;">${safeLink}</span>
        </td></tr>
        <tr><td style="height:28px;"></td></tr>
        <tr><td style="font-size:11px;font-style:italic;color:#A7BCA4;text-align:right;">— 教練</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ─── sendMagicLink (real Brevo POST) ────────────────────────────────────

/**
 * PR-4c-green Auth rebuild stage 1c→1f — send the magic login link.
 *
 * Real send via Brevo API. Fallback to stdout log on any failure so the auth
 * flow never crashes mid-request (the magic-link table row is already stored;
 * worst case the student doesn't get the email but the link is recoverable
 * from Vercel logs).
 *
 * @param {string} email
 * @param {string} link
 * @returns {Promise<{ok: boolean, stubbed?: boolean, reason?: string, status?: number}>}
 */
export async function sendMagicLink(email, link) {
  if (!process.env.BREVO_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn(`[brevo:fallback] ${email}: ${link}`);
    return { ok: true, stubbed: true, reason: 'BREVO_API_KEY not configured' };
  }

  const payload = {
    sender:      { email: SENDER_EMAIL, name: SENDER_NAME },
    to:          [{ email }],
    subject:     '登入連結 · 看見自己',
    htmlContent: buildMagicLinkHtml(link),
  };

  try {
    const res = await getFetch()(BREVO_ENDPOINT, {
      method:  'POST',
      headers: {
        'accept':       'application/json',
        'content-type': 'application/json',
        'api-key':      process.env.BREVO_API_KEY,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
      // eslint-disable-next-line no-console
      console.error(`[brevo] magic-link send failed: ${res.status} ${detail}`);
      // eslint-disable-next-line no-console
      console.warn(`[brevo:fallback] ${email}: ${link}`);
      return { ok: true, stubbed: true, reason: `Brevo ${res.status}`, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[brevo] magic-link send threw:', e?.message || e);
    // eslint-disable-next-line no-console
    console.warn(`[brevo:fallback] ${email}: ${link}`);
    return { ok: true, stubbed: true, reason: e?.message || 'network error' };
  }
}

// ─── sendExportEmail (unchanged stub — separate follow-up task) ─────────

/**
 * Send the personal-coach-prompt export to a student's email.
 * Still stubbed — wiring this for real Brevo requires markdown→html and a
 * different sender flow; left as a follow-up task.
 */
export async function sendExportEmail({ toEmail, studentId, subject, markdownBody } = {}) {
  if (!toEmail || typeof toEmail !== 'string') {
    return { ok: false, error: 'sendExportEmail: toEmail required' };
  }
  if (!markdownBody || typeof markdownBody !== 'string') {
    return { ok: false, error: 'sendExportEmail: markdownBody required' };
  }

  if (!process.env.BREVO_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn(
      `[brevo:stub] BREVO_API_KEY not set — skipping export email for ${studentId} `
      + `(to=${toEmail}, subject="${subject || '個人教練 prompt'}", body length=${markdownBody.length} chars)`,
    );
    return { ok: true, stubbed: true, reason: 'BREVO_API_KEY not configured' };
  }

  // TODO follow-up: wire export email via the same Brevo fetch path as
  // sendMagicLink above, with markdown→html conversion + the right subject.
  // eslint-disable-next-line no-console
  console.warn(
    `[brevo:todo] export email not yet wired for real send — student ${studentId}, `
    + `to=${toEmail}, subject="${subject || '個人教練 prompt'}", body length=${markdownBody.length} chars`,
  );
  return { ok: true, stubbed: true, reason: 'export email not yet wired (follow-up task)' };
}

// ─── tiny html escape (used by buildMagicLinkHtml + future export) ──────

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
