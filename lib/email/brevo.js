// lib/email/brevo.js
// Brevo (formerly Sendinblue) email sender — PR-4c-2 stub.
//
// Status: STUB. The Brevo SDK is NOT installed and BREVO_API_KEY is NOT set.
// Vivi must do both before Day 21 export email actually leaves the server:
//   1. npm install @getbrevo/brevo
//   2. Set BREVO_API_KEY in Vercel env
//   3. Replace the TODO branch below with a real Brevo API call
//
// Current behaviour: every send() logs `[brevo:stub]` to console and returns
// `{ ok: true, stubbed: true, reason: <why> }`. The caller (finalize-day Day 21
// graduation) treats this as success — `export_prompt_generated_at` IS stamped
// so the flow doesn't block A001 preview testing. The flag surfaces the gap.

/**
 * Send the personal-coach-prompt export to a student's email.
 *
 * @param {object} args
 * @param {string} args.toEmail
 * @param {string} args.studentId
 * @param {string} args.subject
 * @param {string} args.markdownBody - the Markdown export prompt content
 * @returns {Promise<{ ok: boolean, stubbed?: boolean, reason?: string, error?: string }>}
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

  // ────────────────────────────────────────────────────────
  // TODO PR-4c-2 follow-up (Vivi): once @getbrevo/brevo is installed +
  // BREVO_API_KEY is set, replace this branch with:
  //
  //   import * as Brevo from '@getbrevo/brevo';
  //   const api = new Brevo.TransactionalEmailsApi();
  //   api.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, process.env.BREVO_API_KEY);
  //   await api.sendTransacEmail({
  //     to: [{ email: toEmail }],
  //     sender: { email: process.env.BREVO_FROM_EMAIL || 'no-reply@see-yourself.local',
  //               name: '看見自己' },
  //     subject: subject || '你的個人教練 prompt',
  //     htmlContent: `<pre style="white-space:pre-wrap;font-family:system-ui">${escapeHtml(markdownBody)}</pre>`,
  //   });
  //   return { ok: true };
  //
  // Until then, even with the API key set, we still no-op (SDK isn't installed).
  // ────────────────────────────────────────────────────────
  // eslint-disable-next-line no-console
  console.warn(
    `[brevo:todo] BREVO_API_KEY is set but @getbrevo/brevo SDK is not installed — `
    + `still stubbed for ${studentId}.`,
  );
  return { ok: true, stubbed: true, reason: '@getbrevo/brevo SDK not installed' };
}

/**
 * PR-4c-green Auth rebuild stage 1c — send the magic login link.
 *
 * Stage 3 (later) replaces the stub with a real Brevo TransactionalEmailsApi
 * call. Until then, the link is logged to Vercel stdout so封測 can copy it
 * from logs. Always returns { ok: true } so the caller's response shape stays
 * consistent regardless of email-existence (no leakage to attackers probing
 * which addresses are registered).
 *
 * @param {string} email — already normalized
 * @param {string} link  — full URL `${APP_BASE_URL}/auth?token=...`
 * @returns {Promise<{ ok: boolean, stubbed?: boolean, reason?: string }>}
 */
export async function sendMagicLink(email, link) {
  if (!process.env.BREVO_API_KEY) {
    // eslint-disable-next-line no-console
    console.warn(`[brevo:stub] magic link ${email}: ${link}`);
    return { ok: true, stubbed: true, reason: 'BREVO_API_KEY not configured' };
  }
  // TODO PR-4c-green stage 3: once BREVO_API_KEY + @getbrevo/brevo SDK are in,
  // send a transactional email:
  //   subject: '登入連結 · 看見自己'
  //   body:    '點下面這個連結登入（20 分鐘內有效）：<a href="${link}">${link}</a>'
  // eslint-disable-next-line no-console
  console.warn(`[brevo:todo] BREVO_API_KEY set but SDK not installed — magic link ${email}: ${link}`);
  return { ok: true, stubbed: true, reason: '@getbrevo/brevo SDK not installed' };
}

// Tiny helper kept here for the TODO snippet above. Not currently used.
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
