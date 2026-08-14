// api/subscribe.js
// Seminar 報名 endpoint — Vivi 7/30《問對問題》9/30 免費線上講座.
//
// POST /api/subscribe { email, question, source }
//   Content-Types accepted (v12 HTML 兩個路徑都收):
//     multipart/form-data                 — JS fetch (new FormData(f))
//     application/x-www-form-urlencoded   — native form POST (無 JS 退回)
//     application/json                    — 保底 (未來如換 fetch header)
//
//   Side effects (三支獨立、任何一支失敗都不炸整個 endpoint):
//     1. Neon INSERT seminar_signups (migration/040).
//     2. Brevo addToSeminarList — SEMINAR_LIST_ID env 決定 list.
//     3. Brevo sendSeminarConfirmation — 寄 Vivi 定稿 confirmation email.
//
//   Response contract (v12 HTML 端 JS + native 兩條路徑都要對):
//     Accept: application/json  → 200 {ok:true}          (JS fetch path)
//     otherwise                 → 303 Location:/seminar/thanks (native form)
//
//   「永遠回 ok:true」envelope 對齊 request-link.js: 無效 email、Neon 失敗、
//   Brevo 失敗都不對外洩、endpoint 只對 method 錯誤 (405) 才拒絕.
//
// v12 HTML 是 Vivi 定稿 (視覺 / 文案 不動);其中 JS handler 用 FormData 送
// multipart，所以我在 endpoint 內 inline 一支 minimal RFC 7578 parser (只
// 支援 text fields，我們 3 個欄位都是 text)，避開 formidable / busboy 依賴.

import { neon } from '@neondatabase/serverless';
import { Buffer } from 'node:buffer';
import { addToSeminarList, sendSeminarConfirmation } from '../lib/email/brevo.js';

export const maxDuration = 10;

// ─── test seams ──────────────────────────────────────────────────────────
let _sql = null;
export function _setSqlClient(client) { _sql = client; }
function getSql() { return _sql || neon(process.env.DATABASE_URL); }

let _addToSeminarListFn = null;
let _sendSeminarConfirmationFn = null;
export function _setAddToSeminarListFn(fn) { _addToSeminarListFn = fn; }
export function _setSendSeminarConfirmationFn(fn) { _sendSeminarConfirmationFn = fn; }
function brevoAdd()  { return _addToSeminarListFn         || addToSeminarList; }
function brevoSend() { return _sendSeminarConfirmationFn  || sendSeminarConfirmation; }

// ─── base URL resolution (mirror api/auth/request-link.js) ───────────────
/** @returns {string} absolute base URL without trailing slash */
export function resolveBaseUrl() {
  const raw = process.env.APP_BASE_URL;
  if (raw && /^https?:\/\//.test(raw)) return raw.replace(/\/$/, '');
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'https://seeyourself.now';
}

// ─── body parsing ────────────────────────────────────────────────────────
/**
 * Read + parse the POST body. Vercel Node runtime auto-parses application/json
 * and application/x-www-form-urlencoded into `req.body` — those we pass through.
 * multipart/form-data is NOT auto-parsed; we stream + parse it below.
 */
export async function readBody(req) {
  const ct = String(req.headers['content-type'] || '').toLowerCase();
  if (req.body != null && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const buf = Buffer.concat(chunks);
  if (ct.startsWith('multipart/form-data')) return parseMultipart(buf, ct);
  if (ct.startsWith('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(buf.toString('utf8')));
  }
  if (ct.startsWith('application/json')) {
    try { return JSON.parse(buf.toString('utf8') || '{}'); } catch { return {}; }
  }
  return {};
}

/**
 * Minimal RFC 7578 multipart parser — text fields only, no file upload.
 * v12 HTML has 3 text fields (email / question textarea / source hidden), all
 * plain text, so we don't need general-purpose file / mixed / nested handling.
 * Preserves UTF-8 bytes by going through Buffer instead of native String.split.
 */
export function parseMultipart(buf, ct) {
  const m = /boundary=(?:"([^"]+)"|([^;\s]+))/.exec(ct);
  if (!m) return {};
  const boundary = '--' + (m[1] || m[2]);
  const body = buf.toString('binary');
  const parts = body.split(boundary);
  /** @type {Record<string, string>} */
  const result = {};
  for (const part of parts) {
    const nameMatch = /Content-Disposition:\s*form-data;\s*name="([^"]+)"/i.exec(part);
    if (!nameMatch) continue;
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) continue;
    let value = part.slice(headerEnd + 4);
    if (value.endsWith('\r\n')) value = value.slice(0, -2);
    result[nameMatch[1]] = Buffer.from(value, 'binary').toString('utf8');
  }
  return result;
}

// ─── normalization ───────────────────────────────────────────────────────
export function normalizeEmail(raw) {
  if (typeof raw !== 'string') return '';
  return raw.trim().toLowerCase();
}

function cleanText(raw, maxLen) {
  if (typeof raw !== 'string') return '';
  return raw.trim().slice(0, maxLen);
}

// ─── response helpers ────────────────────────────────────────────────────
function wantsJson(req) {
  const accept = String(req.headers.accept || '').toLowerCase();
  return accept.includes('application/json');
}

/**
 * v12 HTML two paths:
 *   JS fetch (Accept: application/json)  → 200 {ok:true}
 *   native form POST                     → 303 Location:/seminar/thanks
 */
function respond(req, res) {
  if (wantsJson(req)) return res.status(200).json({ ok: true });
  res.setHeader('Location', '/seminar/thanks');
  return res.status(303).end();
}

// ─── handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  let body = {};
  try { body = await readBody(req); }
  catch (e) {
    // eslint-disable-next-line no-console
    console.error('[subscribe] body read failed:', e?.message || e);
  }

  const email    = normalizeEmail(body.email);
  const question = cleanText(body.question, 4000);
  const rawSource = cleanText(body.source, 40);
  const source    = rawSource || 'unknown';

  // Invalid email → still respond ok (attacker probing envelope).
  if (!email || !email.includes('@')) {
    return respond(req, res);
  }

  const thanksUrl = `${resolveBaseUrl()}/seminar/thanks`;

  // Three side effects, each independently protected. Promise.allSettled so
  // one failure never masks another — 名單失敗不吃確認信 (Vivi 8/14 確認).
  // 每個 branch 各自 try/catch + return 結果, 讓 post-mortem 看得到 stub.
  const [neonRes, listRes, mailRes] = await Promise.allSettled([
    (async () => {
      try {
        const sql = getSql();
        await sql`
          INSERT INTO seminar_signups (email, question, source)
          VALUES (${email}, ${question || null}, ${source})
        `;
        return { ok: true };
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('[subscribe] neon insert failed:', e?.message || e);
        return { ok: false, reason: e?.message || 'neon threw' };
      }
    })(),
    (async () => {
      try { return await brevoAdd()(email, { question, source }); }
      catch (e) {
        // eslint-disable-next-line no-console
        console.error('[subscribe] brevo list-add threw:', e?.message || e);
        return { ok: false, reason: e?.message || 'brevo add threw' };
      }
    })(),
    (async () => {
      try { return await brevoSend()(email, thanksUrl); }
      catch (e) {
        // eslint-disable-next-line no-console
        console.error('[subscribe] brevo confirm-email threw:', e?.message || e);
        return { ok: false, reason: e?.message || 'brevo send threw' };
      }
    })(),
  ]);

  // Vivi 8/14 診斷: Brevo logs 0 筆 + Vercel logs 靜默 = mailer 走 stub, API
  //   call 從沒發生 (env 缺 SEMINAR_LIST_ID / BREVO_API_KEY). 加聚合 stub log
  //   讓 Vercel dashboard grep [SUBSCRIBE:STUB] 直接看到 root cause.
  const stubs = [];
  const val = (r) => r.status === 'fulfilled' ? r.value : null;
  const lv = val(listRes);
  const mv = val(mailRes);
  if (lv && lv.stubbed) stubs.push(`list(${lv.reason || 'stubbed'})`);
  if (mv && mv.stubbed) stubs.push(`mail(${mv.reason || 'stubbed'})`);
  if (stubs.length) {
    // eslint-disable-next-line no-console
    console.error(
      `[SUBSCRIBE:STUB] ${email} — Brevo API not called: ${stubs.join(', ')}. `
      + `Check Vercel env: BREVO_API_KEY / SEMINAR_LIST_ID (production scope + redeploy).`,
    );
  }

  return respond(req, res);
}
