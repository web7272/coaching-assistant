// api/request-guide.js
// Patrick 5/26 — 漏斗 Stage 0：PDF 索取 + (option 2/3) 發 magic link 開試用.
// 對應 preview-1日漏斗最小測試版-spec.md Stage 0.
//
// POST /api/request-guide { email, option, answers? }
//   option 1 = 只下載 PDF         → 寄 PDF 連結
//   option 2 = 只試用              → 發 magic link (verify-link 會建 trial 學員)
//   option 3 = 下載 + 試用         → PDF + magic link 都寄
//   answers (option 2/3, optional) = { 現況, 渴望, 阻礙, 預算, 開放題 }
//
// 安全 / 設計：
//   - 永遠回 {ok:true} (跟 /api/auth/request-link 同一個安全信封、防 email 探測)
//   - lead INSERT fail-soft (table 還沒建也不擋寄信)
//   - sendGuideEmail / sendMagicLink 自己 fail-soft (有 fallback log 路徑)
//   - 稱謂 / pace 不在這收 — 稱謂 App 內暖場問、pace 付費後問.

import { neon } from '@neondatabase/serverless';
import { randomBytes, createHash } from 'node:crypto';
import { sendMagicLink, sendGuideEmail } from '../lib/email/brevo.js';
import { normalizeEmail } from '../lib/auth/student-helpers.js';
import { resolveBaseUrl } from './auth/request-link.js';

export const maxDuration = 10;

const TTL_MINUTES = 20;

// Test seam (injectable SQL client).
let _sql = null;
export function _setSqlClient(client) { _sql = client; }
function getSql() {
  if (_sql) return _sql;
  return neon(process.env.DATABASE_URL);
}

// Test seams (injectable email senders) — let tests assert which were called.
let _sendGuideFn = null;
let _sendMagicLinkFn = null;
export function _setSendGuideFn(fn) { _sendGuideFn = fn; }
export function _setSendMagicLinkFn(fn) { _sendMagicLinkFn = fn; }
function guideSender() { return _sendGuideFn || sendGuideEmail; }
function magicSender() { return _sendMagicLinkFn || sendMagicLink; }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const email   = normalizeEmail(req.body?.email);
  const optRaw  = Number(req.body?.option);
  const option  = (optRaw === 1 || optRaw === 2 || optRaw === 3) ? optRaw : 1;
  const answers = (req.body?.answers && typeof req.body.answers === 'object' && !Array.isArray(req.body.answers))
    ? req.body.answers
    : null;

  // Bad-shape input: still 200 ok:true (same envelope as /api/auth/request-link).
  if (!email) {
    console.warn('[request-guide] invalid email payload — returning ok:true anyway');
    return res.status(200).json({ ok: true });
  }

  const sql  = getSql();
  const base = resolveBaseUrl();

  // 1) 存 lead — fail-soft (leads 表還沒建 / Vivi 還沒跑 migration 也不擋寄信).
  try {
    await sql`
      INSERT INTO leads (email, option, answers)
      VALUES (${email}, ${option}, ${answers ? JSON.stringify(answers) : null}::jsonb)
    `;
  } catch (e) {
    console.warn('[request-guide] lead insert failed (table missing?):', e?.message || e);
  }

  // 2) 寄 PDF (option 1 & 3) — fail-soft 在 sendGuideEmail 內部已經有 fallback.
  if (option === 1 || option === 3) {
    try {
      await guideSender()(email, `${base}/assets/guide/value-guide.pdf`);
    } catch (e) {
      // sendGuideEmail 自己不會 throw (有 catch + fallback). 防禦在這層再兜一次.
      console.error('[request-guide] sendGuideEmail threw unexpectedly:', e?.message || e);
    }
  }

  // 3) option 2/3：發 magic link 開試用.
  //    verify-link 那端會 find-or-create 學員 (plan='trial' 是 students 表 default).
  if (option === 2 || option === 3) {
    try {
      const token     = randomBytes(32).toString('hex');
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const expiresAt = new Date(Date.now() + TTL_MINUTES * 60 * 1000).toISOString();
      // 稱謂 / pace 不在 Stage 0 收 → 傳 null (verify-link 已支援 null).
      await sql`
        INSERT INTO magic_link_tokens (token_hash, email, preferred_name, pace, expires_at)
        VALUES (${tokenHash}, ${email}, ${null}, ${null}, ${expiresAt})
      `;
      try {
        await magicSender()(email, `${base}/auth?token=${token}`);
      } catch (sendErr) {
        console.error('[request-guide] sendMagicLink threw unexpectedly:', sendErr?.message || sendErr);
      }
    } catch (e) {
      console.error('[request-guide] trial magic-link insert failed:', e?.message || e);
    }
  }

  return res.status(200).json({ ok: true });
}
