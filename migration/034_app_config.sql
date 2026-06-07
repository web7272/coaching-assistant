-- Migration 034: app_config table — SQL 即時可改的設定 (Vivi 6/7 決策).
-- 來源: Patrick 6/7 spec — quota 改成 SQL 可即時改、預設 1000.
--
-- 動機:
--   原 033 的 DAY1_QUOTA env 改值要重部署. 衝量時 Vivi 想「一句 SQL 改名額、
--   TTL 過即時生效」, 所以 quota 改放在 DB 表裡, env 只當 fallback.
--
-- 設計:
--   通用 key/value 表 (不只 quota 用; 未來 sales_open / sales_url / ...
--   都可以放這). 後端讀取帶 30-60s in-memory TTL cache (lib/api/day1-quota.js
--   getQuota), 過 TTL 自動失效, 不用 invalidate.
--
-- 讀取優先序 (lib/api/day1-quota.js getQuota):
--   1. SELECT value FROM app_config WHERE key='monthly_day1_quota'  (帶 cache)
--   2. process.env.DAY1_QUOTA  (env fallback, 兼容 033 部署期間)
--   3. DEFAULT_DAY1_QUOTA = 1000  (硬編碼 fallback)
--
-- Vivi 改名額 (即時, 不需重部署):
--   INSERT INTO app_config (key, value) VALUES ('monthly_day1_quota', '500')
--   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
--
-- 跑這支前確認 migration 序號: 上一支是 033 (day1_quota).
--
-- ⚠️ DO NOT RUN AUTOMATICALLY. Vivi 跑 Neon console:
--   psql $DATABASE_URL -f migration/034_app_config.sql

DO $$
BEGIN
  RAISE NOTICE '════ MIGRATION 034: app_config (SQL-tunable settings) ════';
END $$;

-- ════════════════════════════════════════════════════════════════
-- 1. BEFORE snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_name='app_config') AS app_config_exists;

-- ════════════════════════════════════════════════════════════════
-- 2. app_config (idempotent)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS app_config (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default quota — ON CONFLICT DO NOTHING means re-running this migration
-- 不會覆蓋 Vivi 已調的值. 新環境 (第一次) 寫 '1000'; 既有環境 (Vivi 已改成
-- '500' 之類) 保留她的設定.
INSERT INTO app_config (key, value)
VALUES ('monthly_day1_quota', '1000')
ON CONFLICT (key) DO NOTHING;

-- ════════════════════════════════════════════════════════════════
-- 3. AFTER snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'AFTER' AS stage,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_name='app_config') AS app_config_exists;

SELECT 'APP_CONFIG ROWS' AS stage, key, value, updated_at
  FROM app_config
 ORDER BY key;
-- 預期: 至少 1 row ('monthly_day1_quota' = '1000' 若是新環境).

-- ════════════════════════════════════════════════════════════════
-- 4. Operational queries (commented; Vivi 可手動跑)
-- ════════════════════════════════════════════════════════════════
-- 改名額到 500 (即時生效, TTL ~30s):
-- INSERT INTO app_config (key, value)
-- VALUES ('monthly_day1_quota', '500')
-- ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
--
-- 查當前名額設定:
-- SELECT key, value, updated_at FROM app_config
--  WHERE key = 'monthly_day1_quota';
--
-- 刪掉 key 改成走 env / default (緊急 rollback):
-- DELETE FROM app_config WHERE key = 'monthly_day1_quota';
