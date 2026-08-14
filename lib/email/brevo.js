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
        <tr><td style="text-align:center;font-size:15px;letter-spacing:.16em;color:#B58F5C;font-weight:700;">看見自己<div style="font-size:9px;letter-spacing:.32em;color:#9098A6;font-weight:600;margin-top:4px;">SEE YOURSELF</div></td></tr>
        <tr><td style="height:14px;"></td></tr>
        <tr><td style="text-align:center;">
          <div style="width:24px;height:0.5px;background:#D8B27F;margin:0 auto;"></div>
        </td></tr>
        <tr><td style="height:28px;"></td></tr>
        <tr><td style="font-size:15px;line-height:2;color:#2E333D;">
          你的登入連結來了。<br>
          為了保護你的帳號，連結 60 分鐘內有效。<br>
          點下面這顆按鈕，進入你的對話。
        </td></tr>
        <tr><td style="height:28px;"></td></tr>
        <tr><td align="center">
          <a href="${safeLink}" clicktracking="off" style="display:inline-block;padding:14px 36px;background:#2E333D;color:#FFFFFF;text-decoration:none;font-size:15px;letter-spacing:.06em;border-radius:12px;">進入對話 →</a>
        </td></tr>
        <tr><td style="height:24px;"></td></tr>
        <tr><td style="font-size:11px;color:#9098A6;line-height:1.7;">
          如果按鈕沒反應，把這行貼進瀏覽器：<br>
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
  return `看見自己

你的登入連結來了。
為了保護你的帳號，連結 60 分鐘內有效。
點下面這個連結，進入你的對話。

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
        <tr><td style="text-align:center;font-size:15px;letter-spacing:.16em;color:#B58F5C;font-weight:700;">看見自己<div style="font-size:9px;letter-spacing:.32em;color:#9098A6;font-weight:600;margin-top:4px;">SEE YOURSELF</div></td></tr>
        <tr><td style="height:14px;"></td></tr>
        <tr><td style="text-align:center;">
          <div style="width:24px;height:0.5px;background:#D8B27F;margin:0 auto;"></div>
        </td></tr>
        <tr><td style="height:28px;"></td></tr>
        <tr><td style="font-size:15px;line-height:2;color:#2E333D;">
          這是你的《價值觀挖掘練習》。<br>
          找一段安靜的時間，慢慢寫。<br>
          這會是你開始看見自己的第一步。
        </td></tr>
        <tr><td style="height:28px;"></td></tr>
        <tr><td align="center">
          <a href="${safe}" clicktracking="off" style="display:inline-block;padding:14px 36px;background:#2E333D;color:#FFFFFF;text-decoration:none;font-size:15px;letter-spacing:.06em;border-radius:12px;">下載練習 →</a>
        </td></tr>
        <tr><td style="height:24px;"></td></tr>
        <tr><td style="font-size:11px;color:#9098A6;line-height:1.7;">
          如果按鈕沒反應，把這行貼進瀏覽器：<br>
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
  return `看見自己

這是你的《價值觀挖掘練習》。
找一段安靜的時間，慢慢寫。
這會是你開始看見自己的第一步。

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
        <tr><td style="text-align:center;font-size:15px;letter-spacing:.16em;color:#B58F5C;font-weight:700;">看見自己<div style="font-size:9px;letter-spacing:.32em;color:#9098A6;font-weight:600;margin-top:4px;">SEE YOURSELF</div></td></tr>
        <tr><td style="height:14px;"></td></tr>
        <tr><td style="text-align:center;"><div style="width:24px;height:0.5px;background:#D8B27F;margin:0 auto;"></div></td></tr>
        <tr><td style="height:22px;"></td></tr>
        <tr><td style="text-align:center;font-size:12px;letter-spacing:3px;color:#B58F5C;">身分解析卡</td></tr>
        <tr><td style="height:14px;"></td></tr>
        <tr><td style="text-align:center;font-size:13px;color:#5A6270;font-style:italic;">你今天的身分解析卡，長出來了。</td></tr>
        <tr><td style="height:22px;"></td></tr>
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
  return `看見自己

身分解析卡

你今天的身分解析卡，長出來了。

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

// ─── seminar 系列 (Vivi 7/30 · 問對問題 9/30 免費線上講座) ────────────
//
// 新增 5 個 export：
//   buildSeminarConfirmationHtml / buildSeminarConfirmationText
//   sendSeminarConfirmation      — 用 /v3/smtp/email (跟 sendMagicLink 同 endpoint)
//   addToSeminarList             — 用 /v3/contacts   (跟 email 不同 endpoint)
//   createSeminarList            — 用 /v3/contacts/lists  (setup 一次的 helper)
//
// Fallback contract 全片跟 sendMagicLink 對齊:
//   BREVO_API_KEY 缺 或 SEMINAR_LIST_ID 缺 或 Brevo 回非 2xx 或 網路炸 →
//   log `[brevo:fallback] seminar ...` + return { ok:true, stubbed:true, reason }
//   → 報名 endpoint 「永遠回 ok:true」的 envelope 不會被 email/list mgmt 拖垮.
//
// Vivi 定稿 (7/30, 8/14 刪「先想一件事」段 + sender 對齊 seminar@):
//   Subject: 「你報名了 · 問對問題講座 9/30」
//   內文 verbatim (全形標點、無「——」):
//     你報名成功了。9 月 30 日（三）· 台灣時間晚上 9:00 · 線上 · 90 分鐘。
//     開始前，我們會把講座連結再寄一次給你。
//   Button: 「加入行事曆 →」 → thanksUrl (那頁有 Google Calendar + .ics)
//   Masthead: 對齊 v11 (「看見自己 / SEE YOURSELF」古銅金 + 墨黑 CTA #2E333D).
//   Sender: 看見自己 <seminar@seeyourself.now> (SEMINAR_SENDER_EMAIL, 對齊
//     thanks 頁 + daily-report 三方一致, 避免「頁面/寄件人/白名單」不同地址).
//
// 8/14 Vivi: 刪掉「在那之前，你可以先想一件事:你最近最想問自己的一個問題...
//   把它帶來講座。」— 表單已經收過 question 欄, 再問一次等於沒讀他寫的.

const BREVO_CONTACTS_ENDPOINT      = 'https://api.brevo.com/v3/contacts';
const BREVO_CONTACTS_LISTS_ENDPOINT = 'https://api.brevo.com/v3/contacts/lists';

/**
 * Confirmation email HTML — 對齊 buildGuideEmailHtml 的墨黑鈕 / 古銅金 masthead.
 * clicktracking="off" 加在按鈕，跟 magic-link / guide 一致 (Brevo redirector 防禦).
 *
 * @param {string} thanksUrl  絕對 URL 到 /seminar/thanks (含 gcal + .ics)
 * @returns {string} html
 */
export function buildSeminarConfirmationHtml(thanksUrl) {
  const safe = escapeHtml(thanksUrl);
  return `<!DOCTYPE html>
<html lang="zh-TW">
<body style="margin:0;padding:0;background:#F8F8F8;font-family:'Noto Serif TC',Georgia,serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F8F8;padding:48px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border:0.5px solid #E6E6E6;border-radius:14px;padding:40px 32px;">
        <tr><td style="text-align:center;font-size:15px;letter-spacing:.16em;color:#B58F5C;font-weight:700;">看見自己<div style="font-size:9px;letter-spacing:.32em;color:#9098A6;font-weight:600;margin-top:4px;">SEE YOURSELF</div></td></tr>
        <tr><td style="height:14px;"></td></tr>
        <tr><td style="text-align:center;">
          <div style="width:24px;height:0.5px;background:#D8B27F;margin:0 auto;"></div>
        </td></tr>
        <tr><td style="height:22px;"></td></tr>
        <tr><td style="text-align:center;font-size:12px;letter-spacing:3px;color:#B58F5C;">問對問題 · 9/30 免費講座</td></tr>
        <tr><td style="height:22px;"></td></tr>
        <tr><td style="font-size:15px;line-height:2;color:#2E333D;">
          你報名成功了。9 月 30 日（三）· 台灣時間晚上 9:00 · 線上 · 90 分鐘。<br>
          開始前，我們會把講座連結再寄一次給你。
        </td></tr>
        <tr><td style="height:28px;"></td></tr>
        <tr><td align="center">
          <a href="${safe}" clicktracking="off" style="display:inline-block;padding:14px 36px;background:#2E333D;color:#FFFFFF;text-decoration:none;font-size:15px;letter-spacing:.06em;border-radius:12px;">加入行事曆 →</a>
        </td></tr>
        <tr><td style="height:24px;"></td></tr>
        <tr><td style="font-size:11px;color:#9098A6;line-height:1.7;">
          如果按鈕沒反應，把這行貼進瀏覽器：<br>
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
 * Plain-text mirror (multipart/alternative → 消 mail-tester MIME_HTML_ONLY).
 * @param {string} thanksUrl
 * @returns {string}
 */
export function buildSeminarConfirmationText(thanksUrl) {
  return `看見自己

問對問題 · 9/30 免費講座

你報名成功了。9 月 30 日（三）· 台灣時間晚上 9:00 · 線上 · 90 分鐘。
開始前，我們會把講座連結再寄一次給你。

${thanksUrl}

看見自己團隊`;
}

/**
 * Send seminar confirmation via Brevo /v3/smtp/email — 同 sendMagicLink pattern.
 * Fallback: any failure → log + return { ok:true, stubbed:true } (不炸報名 flow).
 *
 * @param {string} email
 * @param {string} thanksUrl   絕對 URL 到 /seminar/thanks
 * @returns {Promise<{ok: boolean, stubbed?: boolean, reason?: string, status?: number}>}
 */
export async function sendSeminarConfirmation(email, thanksUrl) {
  if (!process.env.BREVO_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn(`[brevo:fallback] seminar-confirm ${email}: ${thanksUrl}`);
    return { ok: true, stubbed: true, reason: 'BREVO_API_KEY not configured' };
  }

  const payload = {
    sender:      { email: SEMINAR_SENDER_EMAIL, name: SENDER_NAME },
    to:          [{ email }],
    subject:     '你報名了 · 問對問題講座 9/30',
    htmlContent: buildSeminarConfirmationHtml(thanksUrl),
    textContent: buildSeminarConfirmationText(thanksUrl),
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
      console.error(`[brevo] seminar-confirm send failed: ${res.status} ${detail}`);
      // eslint-disable-next-line no-console
      console.warn(`[brevo:fallback] seminar-confirm ${email}: ${thanksUrl}`);
      return { ok: true, stubbed: true, reason: `Brevo ${res.status}`, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[brevo] seminar-confirm send threw:', e?.message || e);
    // eslint-disable-next-line no-console
    console.warn(`[brevo:fallback] seminar-confirm ${email}: ${thanksUrl}`);
    return { ok: true, stubbed: true, reason: e?.message || 'network error' };
  }
}

/**
 * Add a contact to the seminar list — POST /v3/contacts with updateEnabled:true,
 * so first time = create, subsequent = update attributes + keep list membership.
 *
 * SEMINAR_LIST_ID env var required. Missing → fallback stub (不炸報名 flow).
 * question / source stored as Brevo contact attributes for future segmentation.
 *
 * @param {string} email
 * @param {{ question?: string, source?: string }} [attrs]
 * @returns {Promise<{ok: boolean, stubbed?: boolean, reason?: string, status?: number}>}
 */
export async function addToSeminarList(email, attrs = {}) {
  if (!process.env.BREVO_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn(`[brevo:fallback] seminar-list add ${email}: BREVO_API_KEY missing`);
    return { ok: true, stubbed: true, reason: 'BREVO_API_KEY not configured' };
  }
  const listIdRaw = process.env.SEMINAR_LIST_ID;
  const listId    = Number.parseInt(listIdRaw || '', 10);
  if (!Number.isFinite(listId) || listId <= 0) {
    // eslint-disable-next-line no-console
    console.warn(`[brevo:fallback] seminar-list add ${email}: SEMINAR_LIST_ID missing (${listIdRaw ?? 'unset'})`);
    return { ok: true, stubbed: true, reason: 'SEMINAR_LIST_ID not configured' };
  }

  const payload = {
    email,
    attributes: {
      QUESTION: attrs.question || '',
      SOURCE:   attrs.source   || '',
    },
    listIds:       [listId],
    updateEnabled: true,
  };

  try {
    const res = await getFetch()(BREVO_CONTACTS_ENDPOINT, {
      method:  'POST',
      headers: {
        'accept':       'application/json',
        'content-type': 'application/json',
        'api-key':      process.env.BREVO_API_KEY,
      },
      body: JSON.stringify(payload),
    });
    // Brevo 回：201 created / 204 updated (both = success).
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
      // eslint-disable-next-line no-console
      console.error(`[brevo] seminar-list add failed: ${res.status} ${detail}`);
      // eslint-disable-next-line no-console
      console.warn(`[brevo:fallback] seminar-list add ${email}`);
      return { ok: true, stubbed: true, reason: `Brevo ${res.status}`, status: res.status };
    }
    return { ok: true, status: res.status };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[brevo] seminar-list add threw:', e?.message || e);
    // eslint-disable-next-line no-console
    console.warn(`[brevo:fallback] seminar-list add ${email}`);
    return { ok: true, stubbed: true, reason: e?.message || 'network error' };
  }
}

/**
 * Setup helper — POST /v3/contacts/lists to create the seminar list.
 * Called ONCE (via api/admin/setup-seminar-list.js). Returns the new listId so
 * Vivi can store it as Vercel env `SEMINAR_LIST_ID`.
 *
 * folderId defaults to 1 (Brevo 帳號預設 folder，通常就是 id=1 的 "Contacts").
 * 若 Brevo 帳號的 default folder id 不是 1 → 這支會回 non-2xx，log 出 detail，
 * Vivi 可以從 Brevo dashboard 查 folder id 再手動改 setup 呼叫的 folderId 值.
 *
 * @param {string} name       list 名稱 (e.g. "問對問題 9/30 講座")
 * @param {number} [folderId] Brevo folder id (default 1)
 * @returns {Promise<{ok: boolean, listId?: number, stubbed?: boolean, reason?: string, status?: number, detail?: string}>}
 */
export async function createSeminarList(name, folderId = 1) {
  if (!process.env.BREVO_API_KEY) {
    return { ok: false, stubbed: true, reason: 'BREVO_API_KEY not configured' };
  }
  if (!name || typeof name !== 'string') {
    return { ok: false, reason: 'createSeminarList: name required' };
  }

  const payload = { name, folderId };

  try {
    const res = await getFetch()(BREVO_CONTACTS_LISTS_ENDPOINT, {
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
      try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
      // eslint-disable-next-line no-console
      console.error(`[brevo] createSeminarList failed: ${res.status} ${detail}`);
      return { ok: false, reason: `Brevo ${res.status}`, status: res.status, detail };
    }
    let body = null;
    try { body = await res.json(); } catch { /* ignore */ }
    const listId = body && Number.isFinite(body.id) ? body.id : undefined;
    return { ok: true, listId, status: res.status };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[brevo] createSeminarList threw:', e?.message || e);
    return { ok: false, reason: e?.message || 'network error' };
  }
}

// ─── daily-signup-report 系列 (Vivi 8/13 · 每日 21:00 台灣) ────────────
//
// 內部信給 Vivi/Terry/support: 累計人數 + 當日問題. Sender 用
// seminar@seeyourself.now (不同於現有 help@) — 需 Brevo dashboard 端
// verify (若 domain 已 DKIM 全域 verify 則自動 covered).
// Subject verbatim: 「報名累計 N 人」— Vivi 明確要求, 手機通知列直接看數字.
// 排版比照現有 email masthead (「看見自己」古銅金 + 墨黑) 但精簡 (內部信).
// Failure semantics: 失敗 return { ok:false, reason } (不是 subscribe 那種
// 「永遠 ok:true」— 內部信要看得到失敗, 讓 endpoint log 反映).

// SEMINAR_SENDER_EMAIL — 8/14 Vivi: seminar 系列 email (confirmation + daily
// report) 一律用 seminar@ 寄, 對齊 thanks 頁上寫的白名單地址. help@ 保留給
// magic-link / guide / daily-card (App 相關) 系列.
const SEMINAR_SENDER_EMAIL = 'seminar@seeyourself.now';

/**
 * @typedef {{ question: string, source: string }} DailyItem
 * @typedef {{ source: string, n: number }} SourceCount
 * @typedef {{ total: number, todayCount: number, todayItems?: DailyItem[], sourceBreakdown?: SourceCount[] }} DailyReportData
 */

/**
 * @param {DailyReportData} data
 * @returns {string} html
 */
export function buildDailyReportHtml(data) {
  const { total, todayCount, todayItems = [], sourceBreakdown = [] } = data;
  const questionsHtml = todayCount === 0
    ? '<p style="color:#9098A6;font-style:italic;margin:0;">今天 0 位。</p>'
    : '<ol style="margin:0;padding-left:22px;font-family:\'Noto Sans TC\',sans-serif;font-size:14px;">'
      + todayItems.map(it =>
          `<li style="margin-bottom:10px;line-height:1.75;color:#2E333D;">${escapeHtml(it.question || '(未填)')}</li>`
        ).join('')
      + '</ol>';
  const sourceHtml = sourceBreakdown.length === 0 ? '' :
    `<tr><td style="height:24px;"></td></tr>
     <tr><td style="border-top:1px solid #E6E6E6;padding-top:20px;">
       <div style="color:#9098A6;font-size:11px;letter-spacing:.16em;margin-bottom:12px;">來源分佈 · 累計</div>
       ${sourceBreakdown.map(s =>
         `<div style="color:#5A6270;font-size:13px;line-height:1.9;">${escapeHtml(s.source)} · <b style="color:#2E333D;font-weight:500;">${s.n}</b></div>`
       ).join('')}
     </td></tr>`;

  return `<!DOCTYPE html>
<html lang="zh-TW">
<body style="margin:0;padding:0;background:#F8F8F8;font-family:'Noto Serif TC',Georgia,serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F8F8F8;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#FFFFFF;border:0.5px solid #E6E6E6;border-radius:14px;padding:32px 28px;">
        <tr><td style="text-align:center;font-size:15px;letter-spacing:.16em;color:#B58F5C;font-weight:700;">看見自己<div style="font-size:9px;letter-spacing:.32em;color:#9098A6;font-weight:600;margin-top:4px;">SEE YOURSELF</div></td></tr>
        <tr><td style="height:14px;"></td></tr>
        <tr><td style="text-align:center;"><div style="width:24px;height:0.5px;background:#D8B27F;margin:0 auto;"></div></td></tr>
        <tr><td style="height:22px;"></td></tr>
        <tr><td style="text-align:center;font-size:12px;letter-spacing:3px;color:#B58F5C;">問對問題 · 9/30 每日快報</td></tr>
        <tr><td style="height:16px;"></td></tr>
        <tr><td style="text-align:center;font-family:'Noto Serif TC',serif;">
          <div style="font-size:34px;line-height:1.2;color:#2E333D;font-weight:500;">${total} <span style="font-size:15px;color:#9098A6;font-weight:400;">人累計</span></div>
          <div style="margin-top:8px;color:#5A6270;font-size:14px;font-family:'Noto Sans TC',sans-serif;">今日 +${todayCount}</div>
        </td></tr>
        <tr><td style="height:26px;"></td></tr>
        <tr><td style="border-top:1px solid #E6E6E6;padding-top:22px;">
          <div style="color:#9098A6;font-size:11px;letter-spacing:.16em;margin-bottom:14px;">今天的問題</div>
          ${questionsHtml}
        </td></tr>
        ${sourceHtml}
        <tr><td style="height:20px;"></td></tr>
        <tr><td style="font-size:11px;font-style:italic;color:#9098A6;text-align:right;">看見自己團隊 · 自動快報</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

/**
 * Plain-text mirror. Vivi 決定: 不列 email (降低外流風險), 只列問題本文.
 * @param {DailyReportData} data
 * @returns {string}
 */
export function buildDailyReportText(data) {
  const { total, todayCount, todayItems = [], sourceBreakdown = [] } = data;
  const lines = [
    '看見自己',
    '',
    '問對問題 · 9/30 每日快報',
    '',
    `累計 ${total} 人 · 今日 +${todayCount}`,
    '',
    '── 今天的問題 ──',
  ];
  if (todayCount === 0) {
    lines.push('今天 0 位。');
  } else {
    todayItems.forEach((it, i) => {
      lines.push(`${i + 1}. ${it.question || '(未填)'}`);
    });
  }
  if (sourceBreakdown.length) {
    lines.push('', '── 來源分佈 · 累計 ──');
    sourceBreakdown.forEach(s => lines.push(`${s.source} · ${s.n}`));
  }
  lines.push('', '看見自己團隊 · 自動快報');
  return lines.join('\n');
}

/**
 * Send daily report via Brevo. Sender = seminar@seeyourself.now.
 * Failure returns { ok:false, reason } — not「永遠 ok:true」pattern (內部信要看得到失敗).
 *
 * @param {{ recipients: string[], subject: string, html: string, text: string }} args
 * @returns {Promise<{ok: boolean, stubbed?: boolean, reason?: string, status?: number, count?: number, detail?: string}>}
 */
export async function sendDailyReport({ recipients, subject, html, text } = {}) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return { ok: false, reason: 'no recipients' };
  }
  if (!process.env.BREVO_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn(`[brevo:fallback] daily-report to ${recipients.join(',')}: BREVO_API_KEY missing`);
    return { ok: true, stubbed: true, reason: 'BREVO_API_KEY not configured', count: recipients.length };
  }

  const payload = {
    sender:      { email: SEMINAR_SENDER_EMAIL, name: SENDER_NAME },
    to:          recipients.map(email => ({ email })),
    subject,
    htmlContent: html,
    textContent: text,
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
      try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
      // eslint-disable-next-line no-console
      console.error(`[brevo] daily-report send failed: ${res.status} ${detail}`);
      return { ok: false, reason: `Brevo ${res.status}`, status: res.status, detail };
    }
    return { ok: true, status: res.status, count: recipients.length };
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[brevo] daily-report send threw:', e?.message || e);
    return { ok: false, reason: e?.message || 'network error' };
  }
}

// ─── tiny html escape (used by buildMagicLinkHtml + future export) ──────

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
