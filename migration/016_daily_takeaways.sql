-- Migration 016：PR-4c daily_takeaways（21 句詩素材）
-- 來源：docs/v5-spec/engineering/07-pr4c-ui-integration-and-data-contract.md §3-C
--
-- 用途：finalize-day 每天 append {day, term} 進此欄位、結業頁 §4.7 21 句詩讀此欄位、
--       對應 user_profile_evolution 已有的 last_session_day_summary.last_takeaway_term
--       （單筆「最後一天」） — daily_takeaways 是 21 天累積版。

-- 1. 跑前檢查
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name = 'user_profile_evolution'
          AND column_name = 'daily_takeaways') AS existing_count;

-- 2. 新增欄位
ALTER TABLE user_profile_evolution
  ADD COLUMN IF NOT EXISTS daily_takeaways JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 3. 跑後驗證
SELECT 'AFTER' AS stage, column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'user_profile_evolution'
  AND column_name = 'daily_takeaways';

-- 預期：1 row、jsonb、NOT NULL、default '[]'::jsonb
