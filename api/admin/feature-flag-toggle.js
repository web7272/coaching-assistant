// api/admin/feature-flag-toggle.js
// v4.0 Phase 7：feature flag toggle endpoint
//
// POST 翻 1 個 flag + 寫 audit log。
// 對齊 Advisor Code Prompt Phase 7。
//
// ⚠️ Cache 同步說明：
// chat.js 有 _flagsCache 30s in-memory cache、每個 Vercel serverless instance 一份。
// Toggle 後最多 30s instance 自然 reload。跨 instance 不需同步（Vercel routing 隨機）。
// Patrick 認為 acceptable、cluster 整體 30s 內 converge。

import { neon } from '@neondatabase/serverless';
import { requireAdmin } from '../../lib/auth/require-admin.js';

export const config = {
  maxDuration: 10,
};

const ALLOWED_KEYS = ['PROMPT_CACHING', 'CONDITIONAL_REVERSE_EXAMPLES', 'DAMON_NOTE_SLIM'];

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const user = await requireAdmin(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const { key, reason } = req.body || {};
  if (!ALLOWED_KEYS.includes(key)) {
    return res.status(400).json({
      error: 'INVALID_KEY',
      message: `key 必須是 ${ALLOWED_KEYS.join(' / ')} 其中之一（收到：${key}）`,
    });
  }
  if (!reason || String(reason).trim().length < 5) {
    return res.status(400).json({
      error: 'REASON_REQUIRED',
      message: 'reason 必須 >= 5 字、寫清楚翻 flag 的理由',
    });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);

    const oldRow = await sql`SELECT enabled FROM feature_flags WHERE key = ${key}`;
    if (oldRow.length === 0) {
      return res.status(404).json({ error: 'FLAG_NOT_FOUND', key });
    }
    const oldVal = oldRow[0].enabled;
    const newVal = !oldVal;

    await sql`
      UPDATE feature_flags
      SET enabled = ${newVal}, updated_at = NOW(), updated_by = ${user.email}
      WHERE key = ${key}
    `;
    await sql`
      INSERT INTO feature_flag_audit (key, old_value, new_value, changed_by, reason)
      VALUES (${key}, ${oldVal}, ${newVal}, ${user.email}, ${String(reason).trim()})
    `;

    return res.status(200).json({
      ok: true,
      key,
      oldVal,
      newVal,
      note: 'chat.js _flagsCache TTL 30s、最多 30 秒後 next chat call 看到新值。Vercel 多 instance 之間不同步、cluster 整體 30 秒內 converge。',
    });

  } catch (e) {
    console.error('feature-flag-toggle error:', e);
    return res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
}
