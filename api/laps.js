// api/laps.js
// Patrick 6/8 — GET /api/laps?from=&to=&key= read-only metrics endpoint.
//
// Mike weekly report 自助拉 LAPS 四數 (PRODUCT-TRUTH v2.7.1 §2.11 EP8 漏斗).
//
// Auth: passcode-gated via ?key=<ADMIN_TOKEN env>. Wrong / missing → 401.
//       (Mirrors lib/auth/require-admin.js but renames query param to ?key=
//        per Mike's spec.)
//
// Window: from inclusive → to exclusive, Asia/Taipei timezone.
//   YYYY-MM-DD only → 該日 00:00 +08. Default from = 本 ISO 週一 (台北) / to = NOW().
//
// 四數定義 (Mike 6/8):
//   L = leads 表 created_at 落窗口的 row count (任一 option 1/2/3 都算)
//       + by_option breakdown {opt1, opt2, opt3} 額外欄
//   A = students.day1_started_at 落窗口的 distinct student count
//       (migration 033 — chat.js 首則寫 write-if-null)
//   P = user_profile_evolution.export_prompt_generated_at 落窗口的 distinct count
//       (= Day-21 takeaway seeded; finalize-day.js markExportEmailed 在 Day 21
//        graduation 結業後戳記, 對齊 Mike「Day-21 takeaway seeded」 語意)
//   S = Stripe 付款成功 distinct count
//       ⚠️ Schema gap (6/8): api/stripe-webhook.js 目前只 UPDATE students.plan,
//          沒落任何 payment timestamp 表 / 欄. → 回 0 + S_note 標明待補.
//          SALES_OPEN=false 期間預期 0, 對齊 Patrick spec 「表找不到才回 0 + _note」.
//
// 鐵律:
//   #2 諮商保密: 只回計數, 絕不 select / 回 / log leads.answers / 任何 user text.
//   No LLM / 外部 API: 純 DB query.

import { neon } from '@neondatabase/serverless';
import { timingSafeEqual } from 'node:crypto';

export const maxDuration = 10;

// Test seam — inject mock sql.
let _sql = null;
export function _setSqlClient(client) { _sql = client; }
function getSql() {
  if (_sql) return _sql;
  return neon(process.env.DATABASE_URL);
}

// YYYY-MM-DD validator (4 digits / 2 / 2; rejects 2026-13-01 etc via JS Date check).
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Compare two strings in constant time. Returns false if either is empty or
 * lengths differ (without leaking via timing).
 * Pure helper, exported for testing.
 */
export function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length === 0 || b.length === 0) return false;
  // Pad to equal length to avoid throwing in timingSafeEqual; pad with NULL
  // and compare with timingSafeEqual, then also verify length matched.
  const len = Math.max(a.length, b.length);
  const bufA = Buffer.alloc(len, 0);
  const bufB = Buffer.alloc(len, 0);
  bufA.write(a);
  bufB.write(b);
  const eq = timingSafeEqual(bufA, bufB);
  return eq && a.length === b.length;
}

/**
 * Validate a YYYY-MM-DD string is real (e.g., rejects 2026-13-01).
 * Pure helper, exported for testing.
 */
export function isValidDateString(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  // Round-trip check: re-format and compare.
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ─── Auth: passcode via ?key= ─────────────────────────────────────
  const expected = process.env.ADMIN_TOKEN;
  const provided = typeof req.query?.key === 'string' ? req.query.key : '';
  if (!expected) {
    console.error('[laps] ADMIN_TOKEN env var not set — all requests will fail (Vercel dashboard 設定)');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!constantTimeEqual(expected, provided)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ─── Parse + validate from/to ─────────────────────────────────────
  const fromRaw = typeof req.query?.from === 'string' ? req.query.from.trim() : '';
  const toRaw   = typeof req.query?.to   === 'string' ? req.query.to.trim()   : '';
  if (fromRaw && !isValidDateString(fromRaw)) {
    return res.status(400).json({ error: 'INVALID_FROM', message: 'from must be YYYY-MM-DD' });
  }
  if (toRaw && !isValidDateString(toRaw)) {
    return res.status(400).json({ error: 'INVALID_TO', message: 'to must be YYYY-MM-DD' });
  }

  try {
    const sql = getSql();

    // ─── Build window (Asia/Taipei). ──────────────────────────────────
    //   - YYYY-MM-DD → ('YYYY-MM-DD'::date::timestamp AT TIME ZONE 'Asia/Taipei')
    //     = TIMESTAMPTZ at Taipei midnight (= UTC date-1 16:00:00).
    //   - Defaults: from = date_trunc('week', NOW() AT TIME ZONE 'Asia/Taipei')
    //                       AT TIME ZONE 'Asia/Taipei'  (ISO Monday)
    //               to   = NOW() (no truncation; current moment)
    //   - SELECT window also so we can echo back the resolved boundaries.
    //
    // We compute the window once via a single SELECT so the L/A/P queries below
    // can reference it as parameters consistently (and the response echoes the
    // exact resolved values).
    const winRows = await sql`
      SELECT
        ${fromRaw || null}::text AS from_str,
        ${toRaw   || null}::text AS to_str,
        CASE WHEN ${fromRaw || null}::text IS NULL
             THEN (date_trunc('week', NOW() AT TIME ZONE 'Asia/Taipei')
                   AT TIME ZONE 'Asia/Taipei')
             ELSE (${fromRaw || null}::text::date::timestamp
                   AT TIME ZONE 'Asia/Taipei')
        END AS from_tz,
        CASE WHEN ${toRaw || null}::text IS NULL
             THEN NOW()
             ELSE (${toRaw || null}::text::date::timestamp
                   AT TIME ZONE 'Asia/Taipei')
        END AS to_tz
    `;
    const fromTz = winRows?.[0]?.from_tz;
    const toTz   = winRows?.[0]?.to_tz;

    // ─── L: leads count + by-option breakdown ─────────────────────────
    //   Total = total row count; by_option uses CASE-aggregates so a single
    //   query returns all 4 numbers. 鐵律 #2: NO SELECT of leads.answers.
    const lRows = await sql`
      SELECT
        COUNT(*)::int AS l_total,
        SUM(CASE WHEN option = 1 THEN 1 ELSE 0 END)::int AS opt1,
        SUM(CASE WHEN option = 2 THEN 1 ELSE 0 END)::int AS opt2,
        SUM(CASE WHEN option = 3 THEN 1 ELSE 0 END)::int AS opt3
        FROM leads
       WHERE created_at >= ${fromTz}
         AND created_at <  ${toTz}
    `;
    const L         = lRows?.[0]?.l_total ?? 0;
    const L_opt1    = lRows?.[0]?.opt1    ?? 0;
    const L_opt2    = lRows?.[0]?.opt2    ?? 0;
    const L_opt3    = lRows?.[0]?.opt3    ?? 0;

    // ─── A: distinct students with day1_started_at in window ──────────
    const aRows = await sql`
      SELECT COUNT(DISTINCT student_id)::int AS a_count
        FROM students
       WHERE day1_started_at IS NOT NULL
         AND day1_started_at >= ${fromTz}
         AND day1_started_at <  ${toTz}
    `;
    const A = aRows?.[0]?.a_count ?? 0;

    // ─── P: distinct students with export_prompt_generated_at in window
    //   (= Day-21 takeaway seeded; finalize-day.js markExportEmailed)
    //   fail-soft on schema/column absence → 0 + P_note.
    let P = 0;
    let P_note = null;
    try {
      const pRows = await sql`
        SELECT COUNT(DISTINCT student_id)::int AS p_count
          FROM user_profile_evolution
         WHERE export_prompt_generated_at IS NOT NULL
           AND export_prompt_generated_at >= ${fromTz}
           AND export_prompt_generated_at <  ${toTz}
      `;
      P = pRows?.[0]?.p_count ?? 0;
    } catch (e) {
      // Column / table not yet present (defensive — migration was applied).
      P = 0;
      P_note = `export_prompt_generated_at lookup failed: ${e?.message?.slice(0, 120) || String(e).slice(0, 120)}`;
      console.warn('[laps] P lookup failed (fail-open with note):', e?.message || e);
    }

    // ─── S: distinct Stripe payment success in window ─────────────────
    //   ⚠️ Schema gap: api/stripe-webhook.js 目前只 UPDATE students.plan='plan_a',
    //   沒落 payment timestamp 表 / 欄. 無法用任何欄位 reliably filter by date
    //   window (students.updated_at 會被無關 PATCH 觸發, 不可靠).
    //   → 回 0 + S_note 標明來源未接好, 待補表後接.
    const S = 0;
    const S_note = 'stripe payment timestamp 未落表 — api/stripe-webhook.js 目前只 UPDATE students.plan, 未寫付款事件 timestamp; 待加 stripe_payments 表 (或 students.plan_upgraded_at 欄) 後可接';

    return res.status(200).json({
      ok: true,
      window: {
        from: fromTz instanceof Date ? fromTz.toISOString() : String(fromTz),
        to:   toTz   instanceof Date ? toTz.toISOString()   : String(toTz),
      },
      L, A, P, S,
      L_by_option: { opt1: L_opt1, opt2: L_opt2, opt3: L_opt3 },
      P_note,
      S_note,
    });
  } catch (e) {
    // Generic SQL failure — 500 (no data leak). 鐵律 #2: log structured event,
    // not raw user text (the only user data leads.answers — we never SELECTed it).
    console.error('[laps] error:', e?.message || e);
    return res.status(500).json({ error: 'SERVER_ERROR' });
  }
}
