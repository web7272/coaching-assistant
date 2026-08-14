// api/daily-signup-report.js
// Vercel Cron endpoint — 每日 21:00 台灣 (UTC 13:00, cron `0 13 * * *`) 寄
// 快報給 Vivi / Terry / support. Vivi 8/13 拍板.
//
// 目的:
//   1. Terry 也看得到報名進度, 團隊有參與感.
//   2. 每天累積聽眾的問題, 9/30 現場案例從裡面挑.
//
// 安全:
//   Vercel 對 crons 執行時自動加 `Authorization: Bearer <CRON_SECRET>`.
//   非 cron 來源 (無 header / 錯 secret) 一律 401. 手動觸發帶正確 secret 也可.
//   CRON_SECRET env 沒設 → 401 (fail-closed, 避免公開 endpoint).
//
// 資料源:
//   Neon seminar_signups. 「當天」以台北時區 (Asia/Taipei) 切日, 不用 UTC.
//   累計 = 全表 COUNT. 來源分佈 = source GROUP BY (加分項, 有做就好).
//
// 寄送:
//   Brevo. sender = seminar@seeyourself.now (不同於現有 help@).
//   Vivi 決定: 內文不列 email (只列 question 本文), 降低外流風險.
//   Subject verbatim「報名累計 N 人」— 手機通知列直接看數字.
//   沒人報名的日子照樣寄 (心跳訊號), 內文寫「今天 0 位」.

import { neon } from '@neondatabase/serverless';
import {
  buildDailyReportHtml,
  buildDailyReportText,
  sendDailyReport,
} from '../lib/email/brevo.js';

export const maxDuration = 15;

// Vivi 8/13 明列 3 個收件人. support 是 .now 不是 .com (.com 不是我們域名).
// 之後要加減用 env `SEMINAR_REPORT_RECIPIENTS` (comma-separated) 覆蓋.
const DEFAULT_RECIPIENTS = Object.freeze([
  'iamvivi@gmail.com',
  'terrylin1130@gmail.com',
  'support@seeyourself.now',
]);

// ─── test seams ─────────────────────────────────────────
let _sql = null;
export function _setSqlClient(client) { _sql = client; }
function getSql() { return _sql || neon(process.env.DATABASE_URL); }

let _sendFn = null;
export function _setSendDailyReportFn(fn) { _sendFn = fn; }
function sender() { return _sendFn || sendDailyReport; }

// ─── helpers ────────────────────────────────────────────
export function getRecipients() {
  const env = process.env.SEMINAR_REPORT_RECIPIENTS;
  if (env && env.trim()) {
    return env.split(',').map(s => s.trim()).filter(Boolean);
  }
  return [...DEFAULT_RECIPIENTS];
}

/**
 * Vercel cron: `Authorization: Bearer <CRON_SECRET>`. 若 env 缺 → 一律 401
 * (fail-closed, 避免公開 endpoint). 手動 curl 帶對 secret 也 OK.
 */
export function isAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = String(req.headers?.authorization || '');
  return auth === `Bearer ${secret}`;
}

// ─── handler ────────────────────────────────────────────
export default async function handler(req, res) {
  if (!isAuthorized(req)) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }

  try {
    const sql = getSql();
    // 三支 query 並行. 台北時區切日避免 UTC 錯位 (Vivi 明確要求).
    const [todayRows, totalRows, sourceRows] = await Promise.all([
      sql`SELECT question, source
          FROM seminar_signups
          WHERE (created_at AT TIME ZONE 'Asia/Taipei')::date
              = (now() AT TIME ZONE 'Asia/Taipei')::date
          ORDER BY created_at ASC`,
      sql`SELECT COUNT(*)::int AS n FROM seminar_signups`,
      sql`SELECT source, COUNT(*)::int AS n
          FROM seminar_signups
          GROUP BY source
          ORDER BY n DESC`,
    ]);

    const total      = totalRows[0]?.n ?? 0;
    const todayCount = todayRows.length;
    const todayItems = todayRows.map(r => ({
      question: String(r.question || ''),
      source:   String(r.source || ''),
    }));
    const sourceBreakdown = sourceRows.map(r => ({
      source: String(r.source || ''),
      n:      r.n,
    }));

    const subject = `報名累計 ${total} 人`;
    const html    = buildDailyReportHtml({ total, todayCount, todayItems, sourceBreakdown });
    const text    = buildDailyReportText({ total, todayCount, todayItems, sourceBreakdown });

    const recipients = getRecipients();
    const sendResult = await sender()({ recipients, subject, html, text });

    return res.status(200).json({
      ok: true,
      total,
      todayCount,
      recipientsCount: recipients.length,
      sendResult,
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error('[daily-signup-report] failed:', e?.message || e);
    return res.status(500).json({ ok: false, error: 'internal_error' });
  }
}
