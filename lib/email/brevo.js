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
  // 6/2 Patrick — 色票全片從綠系 → 粉色 / 赤陶系 (對齊 Landing v1.7 + App brand
  //   transition 46a4681). Email 是 user 從 Landing 點完表單後第一個收到的
  //   brand touchpoint, 撞色 = 不專業.
  // 6/2 Patrick — TTL 文字「20 分鐘」→「60 分鐘」(backend TTL 早在 5/28 改成
  //   60、template 寫死沒同步, 用戶看「20」 以為過期、其實能用).
  return `<!DOCTYPE html>
<html lang="zh-TW">
<body style="margin:0;padding:0;background:#F8F8F8;font-family:'Noto Serif TC',Georgia,serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F8F8;padding:48px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border:0.5px solid #E6E6E6;border-radius:14px;padding:40px 32px;">
        <tr><td style="text-align:center;font-size:13px;letter-spacing:4px;color:#B58F5C;">21天身分重塑計畫</td></tr>
        <tr><td style="height:14px;"></td></tr>
        <tr><td style="text-align:center;">
          <div style="width:24px;height:0.5px;background:#D8B27F;margin:0 auto;"></div>
        </td></tr>
        <tr><td style="height:28px;"></td></tr>
        <tr><td style="font-size:15px;line-height:2;color:#2E333D;">
          登入連結 60 分鐘內有效，<br>
          點下面這顆按鈕進入對話。
        </td></tr>
        <tr><td style="height:28px;"></td></tr>
        <tr><td align="center">
          <a href="${safeLink}" clicktracking="off" style="display:inline-block;padding:14px 36px;background:#B58F5C;color:#FFFFFF;text-decoration:none;font-size:15px;letter-spacing:4px;border-radius:10px;">登入</a>
        </td></tr>
        <tr><td style="height:24px;"></td></tr>
        <tr><td style="font-size:11px;color:#9098A6;line-height:1.7;">
          如果按鈕沒反應，把這串貼進瀏覽器：<br>
          <span style="word-break:break-all;color:#5A6270;">${safeLink}</span>
        </td></tr>
        <tr><td style="height:28px;"></td></tr>
        <tr><td style="font-size:11px;font-style:italic;color:#9098A6;text-align:right;">看見自己團隊</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * 6/8 Patrick — plain-text 替代版 (mirror buildMagicLinkHtml 可見文字).
 *
 * Why: mail-tester (6/8) 報 MIME_HTML_ONLY: -0.1 — Brevo payload 只送 text/html,
 * 缺 text/plain → multipart/alternative 沒組起來. 加 textContent → Brevo
 * 把同一封信打成 multipart/alternative, 收件端能擇一 render → 消掉 score 扣分.
 *
 * 文案與 HTML 視覺文字一致 (mirror visible copy, 不自編). 連結是原始 URL,
 * 不包 <a>;沒 button concept 在 plain-text, 連結本身就是 call-to-action.
 *
 * @param {string} link  same URL as buildMagicLinkHtml's button href
 * @returns {string} plain-text body (no HTML tags, real newlines)
 */
export function buildMagicLinkText(link) {
  return `21天身分重塑計畫

登入連結 60 分鐘內有效，
點下面這個連結進入對話。

${link}

看見自己團隊`;
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
    // 6/8 Patrick — plain-text 替代版 → multipart/alternative → 消 mail-tester
    //   MIME_HTML_ONLY (-0.1). Mirror HTML 可見文字, 連結原始 URL.
    textContent: buildMagicLinkText(link),
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

// ─── buildGuideEmailHtml + sendGuideEmail (Stage 0 漏斗 PDF 索取) ──────────
//
// Patrick 5/26 — 漏斗 Stage 0 lead-magnet. POST /api/request-guide stores the
// lead row + sends this email with a link to the《價值觀挖掘練習》 PDF
// served at /assets/guide/value-guide.pdf (Vivi + Damon's real version will
// replace that file at the same path).
//
// Same fallback contract as sendMagicLink: missing BREVO_API_KEY or any send
// failure → log `[brevo:fallback] <email>: <pdfUrl>` + return
// { ok:true, stubbed:true } so the funnel never breaks on email-provider hiccups.

/**
 * 暖短信 + 一顆「下載PDF」按鈕。Plain HTML (no external CSS/images) —
 * mirrors buildMagicLinkHtml. clicktracking="off" on the button so Brevo's
 * sendibt2.com redirector doesn't wrap the PDF URL (same defense as magic link).
 *
 * @param {string} pdfUrl
 * @returns {string} html
 */
export function buildGuideEmailHtml(pdfUrl) {
  const safe = escapeHtml(pdfUrl);
  // 6/2 Patrick — 色票全片從綠系 → 粉色 / 赤陶系 (對齊 Landing v1.7/8 +
  //   App brand transition + magic-link template dafb3dc). PDF email 是
  //   option 1/3 user 從 Landing 點完後收到的第一個 brand touchpoint, 撞色 =
  //   不專業.
  // 6/2 Patrick — Subject + body + 按鈕文字「指南」→「練習」(對齊
  //   Vivi 5/29 換真版 PDF 時的命名「《價值觀挖掘練習》」, e4ce6f0 之後檔名已是
  //   練習但 email 文案沒同步).
  return `<!DOCTYPE html>
<html lang="zh-TW">
<body style="margin:0;padding:0;background:#F8F8F8;font-family:'Noto Serif TC',Georgia,serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F8F8;padding:48px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border:0.5px solid #E6E6E6;border-radius:14px;padding:40px 32px;">
        <tr><td style="text-align:center;font-size:13px;letter-spacing:4px;color:#B58F5C;">21天身分重塑計畫</td></tr>
        <tr><td style="height:14px;"></td></tr>
        <tr><td style="text-align:center;">
          <div style="width:24px;height:0.5px;background:#D8B27F;margin:0 auto;"></div>
        </td></tr>
        <tr><td style="height:28px;"></td></tr>
        <tr><td style="font-size:15px;line-height:2;color:#2E333D;">
          這是你的《價值觀挖掘練習》PDF。
        </td></tr>
        <tr><td style="height:28px;"></td></tr>
        <tr><td align="center">
          <a href="${safe}" clicktracking="off" style="display:inline-block;padding:14px 36px;background:#B58F5C;color:#FFFFFF;text-decoration:none;font-size:15px;letter-spacing:4px;border-radius:10px;">下載PDF</a>
        </td></tr>
        <tr><td style="height:24px;"></td></tr>
        <tr><td style="font-size:11px;color:#9098A6;line-height:1.7;">
          如果按鈕沒反應，把這串貼進瀏覽器：<br>
          <span style="word-break:break-all;color:#5A6270;">${safe}</span>
        </td></tr>
        <tr><td style="height:28px;"></td></tr>
        <tr><td style="font-size:11px;font-style:italic;color:#9098A6;text-align:right;">看見自己團隊</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * 6/8 Patrick — plain-text 替代版 (mirror buildGuideEmailHtml 可見文字).
 * Same rationale as buildMagicLinkText: 消 mail-tester MIME_HTML_ONLY.
 *
 * @param {string} pdfUrl  same URL as buildGuideEmailHtml's button href
 * @returns {string} plain-text body (no HTML tags, real newlines)
 */
export function buildGuideEmailText(pdfUrl) {
  return `21天身分重塑計畫

這是你的《價值觀挖掘練習》PDF。

${pdfUrl}

看見自己團隊`;
}

/**
 * Send the PDF guide link via Brevo. Same fallback path as sendMagicLink —
 * any failure logs `[brevo:fallback]` + returns { ok:true, stubbed:true } so
 * the funnel keeps its「永遠回 ok:true」 envelope.
 *
 * @param {string} email
 * @param {string} pdfUrl   absolute URL to /assets/guide/value-guide.pdf
 * @returns {Promise<{ok: boolean, stubbed?: boolean, reason?: string, status?: number}>}
 */
export async function sendGuideEmail(email, pdfUrl) {
  if (!process.env.BREVO_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn(`[brevo:fallback] ${email}: ${pdfUrl}`);
    return { ok: true, stubbed: true, reason: 'BREVO_API_KEY not configured' };
  }

  const payload = {
    sender:      { email: SENDER_EMAIL, name: SENDER_NAME },
    to:          [{ email }],
    subject:     '你的《價值觀挖掘練習》· 看見自己',
    htmlContent: buildGuideEmailHtml(pdfUrl),
    // 6/8 Patrick — plain-text 替代版 (multipart/alternative). 同 sendMagicLink.
    textContent: buildGuideEmailText(pdfUrl),
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
      console.error(`[brevo] guide email send failed: ${res.status} ${detail}`);
      // eslint-disable-next-line no-console
      console.warn(`[brevo:fallback] ${email}: ${pdfUrl}`);
      return { ok: true, stubbed: true, reason: `Brevo ${res.status}`, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[brevo] guide email send threw:', e?.message || e);
    // eslint-disable-next-line no-console
    console.warn(`[brevo:fallback] ${email}: ${pdfUrl}`);
    return { ok: true, stubbed: true, reason: e?.message || 'network error' };
  }
}

/**
 * Patrick 6/26 — Day1 完成寄「身分解析卡」email (文字版, 無按鈕/連結).
 *   cardText = safeNoteForStudent(notebook_page); escapeHtml + \n→<br>.
 */
export function buildDailyCardHtml(cardText) {
  const cardHtml = escapeHtml(cardText == null ? '' : String(cardText)).replace(/\n/g, '<br>');
  return `<!DOCTYPE html>
<html lang="zh-TW">
<body style="margin:0;padding:0;background:#F8F8F8;font-family:'Noto Serif TC',Georgia,serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F8F8;padding:48px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border:0.5px solid #E6E6E6;border-radius:14px;padding:40px 32px;">
        <tr><td style="text-align:center;font-size:13px;letter-spacing:4px;color:#B58F5C;">21天身分重塑計畫</td></tr>
        <tr><td style="height:14px;"></td></tr>
        <tr><td style="text-align:center;"><div style="width:24px;height:0.5px;background:#D8B27F;margin:0 auto;"></div></td></tr>
        <tr><td style="height:22px;"></td></tr>
        <tr><td style="text-align:center;font-size:12px;letter-spacing:3px;color:#B58F5C;">身分解析卡</td></tr>
        <tr><td style="height:18px;"></td></tr>
        <tr><td style="font-size:15px;line-height:2;color:#2E333D;">${cardHtml}</td></tr>
        <tr><td style="height:30px;"></td></tr>
        <tr><td style="font-size:11px;font-style:italic;color:#9098A6;text-align:right;">看見自己團隊</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

export function buildDailyCardText(cardText) {
  const body = cardText == null ? '' : String(cardText);
  return `21天身分重塑計畫

身分解析卡

${body}

看見自己團隊`;
}

export async function sendDailyCardEmail(email, cardText) {
  if (!process.env.BREVO_API_KEY) {
    console.warn(`[brevo:fallback] daily-card ${email}`);
    return { ok: true, stubbed: true, reason: 'BREVO_API_KEY not configured' };
  }
  const payload = {
    sender:      { email: SENDER_EMAIL, name: SENDER_NAME },
    to:          [{ email }],
    subject:     '你的身分解析卡 · 看見自己',
    htmlContent: buildDailyCardHtml(cardText),
    textContent: buildDailyCardText(cardText),
  };
  try {
    const res = await getFetch()(BREVO_ENDPOINT, {
      method: 'POST',
      headers: { 'accept': 'application/json', 'content-type': 'application/json', 'api-key': process.env.BREVO_API_KEY },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
      console.error(`[brevo] daily-card send failed: ${res.status} ${detail}`);
      console.warn(`[brevo:fallback] daily-card ${email}`);
      return { ok: true, stubbed: true, reason: `Brevo ${res.status}`, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    console.error('[brevo] daily-card send threw:', e?.message || e);
    console.warn(`[brevo:fallback] daily-card ${email}`);
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
  // ⚠️ 6/8 Patrick — when wiring this for real send, ALSO include `textContent`
  //   in the payload (mirror htmlContent's visible copy, plain markdown body
  //   probably works as-is) to avoid mail-tester MIME_HTML_ONLY (-0.1) score
  //   regression. See buildMagicLinkText / buildGuideEmailText for the pattern.
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
