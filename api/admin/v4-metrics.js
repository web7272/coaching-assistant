// api/admin/v4-metrics.js
// v4.0 Phase 7：admin metrics endpoint
//
// 5 query + feature_flags 現況、餵給 /admin-v4-metrics.html dashboard。
// 對齊 Advisor Code Prompt Phase 7。

import { neon } from '@neondatabase/serverless';
import { requireAdmin } from '../../lib/auth/require-admin.js';

export const config = {
  maxDuration: 30,
};

export default async function handler(req, res) {
  const user = await requireAdmin(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  try {
    const sql = neon(process.env.DATABASE_URL);

    // Query 1: caching hit rate（過去 24h）
    const cachingStats = await sql`
      SELECT
        caching_enabled,
        COUNT(*) AS turns,
        ROUND(AVG(cache_read::numeric /
          NULLIF(cache_read + uncached_input, 0)) * 100, 1) AS hit_rate_pct,
        SUM(cache_creation) AS total_cache_writes,
        SUM(cache_read) AS total_cache_reads,
        SUM(uncached_input) AS total_uncached_input,
        ROUND((
          SUM(cache_creation) * 3.75 / 1000000.0 +
          SUM(cache_read)     * 0.30 / 1000000.0 +
          SUM(uncached_input) * 3.00 / 1000000.0 +
          SUM(output_tokens)  * 15.00 / 1000000.0
        )::numeric, 4) AS estimated_cost_usd,
        ROUND(AVG(duration_ms)::numeric, 0) AS avg_duration_ms
      FROM chat_usage_log
      WHERE created_at > NOW() - INTERVAL '24 hours'
      GROUP BY caching_enabled
    `;

    // Query 2: trigger 命中分類（過去 7 天）
    const triggerStats = await sql`
      SELECT detector, miss_type, COUNT(*) AS occurrences,
        COUNT(*) FILTER (WHERE reviewed_at IS NULL) AS unreviewed,
        COUNT(*) FILTER (WHERE review_verdict = 'true_miss') AS confirmed_misses,
        COUNT(*) FILTER (WHERE review_verdict = 'false_alarm') AS false_alarms,
        COUNT(*) FILTER (WHERE promoted_to_regex = true) AS promoted
      FROM prompt_engineering_misses
      WHERE created_at > NOW() - INTERVAL '7 days'
      GROUP BY detector, miss_type
      ORDER BY occurrences DESC
    `;

    // Query 3: 最近未 review 樣本（20 筆）
    const recentMisses = await sql`
      SELECT id, created_at, student_id, week, day, turn_count,
             detector, user_message, ai_response, triggers_hit
      FROM prompt_engineering_misses
      WHERE reviewed_at IS NULL
      ORDER BY created_at DESC
      LIMIT 20
    `;

    // Query 4: 高頻 leak 詞（regex 候補、未被既有 trigger 抓到的情緒/狀態詞）
    const leakWords = await sql`
      SELECT
        (REGEXP_MATCHES(user_message,
          '(茫然|迷茫|空虛|卡住|無力|孤單|困惑|不對勁|沒方向|找不到|失落|無感|麻木|心累|疲倦|抽離|抽空|提不起|沒勁|喘不過|窒息)', 'g'
        ))[1] AS word,
        COUNT(*) AS occurrences
      FROM prompt_engineering_misses
      WHERE detector = 'ai_asked_body_user_no_body'
        AND NOT ('emotion_state' = ANY(triggers_hit))
        AND created_at > NOW() - INTERVAL '14 days'
      GROUP BY word
      ORDER BY occurrences DESC
    `;

    // Query 5: damon context size per student × day（14 天）
    const damonSize = await sql`
      SELECT student_id, module, week, day,
        MAX(damon_context_chars) AS max_chars,
        ROUND(MAX(damon_context_chars) / 3.5) AS approx_max_tokens
      FROM chat_usage_log
      WHERE created_at > NOW() - INTERVAL '14 days'
      GROUP BY student_id, module, week, day
      ORDER BY student_id, module, week, day
    `;

    // feature flags 現況
    const flags = await sql`SELECT key, enabled, default_enabled, guard_warning FROM feature_flags ORDER BY key`;

    return res.status(200).json({
      cachingStats,
      triggerStats,
      recentMisses,
      leakWords,
      damonSize,
      flags,
    });

  } catch (e) {
    console.error('v4-metrics error:', e);
    return res.status(500).json({ error: 'SERVER_ERROR', message: e.message });
  }
}
