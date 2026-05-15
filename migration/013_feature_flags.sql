-- Migration 013: feature_flags + feature_flag_audit（v4.0 toggle）
-- 對齊：v4.0 Advisor Phase 1 + Patrick refine
-- 預設值：
--   PROMPT_CACHING = false（要 Patrick/Vivi 通過 guard 條件才翻 ON）
--   CONDITIONAL_REVERSE_EXAMPLES = true（不關、否則踩 A001 Bug 3/6/12）
--   DAMON_NOTE_SLIM = true（不關、否則跨 9 週 yesterdayNote 爆 8-15K tokens）

-- 1. 跑前狀態
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name='feature_flags') AS flags_exists,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name='feature_flag_audit') AS audit_exists;

-- 2. CREATE feature_flags
CREATE TABLE IF NOT EXISTS feature_flags (
  key             TEXT PRIMARY KEY,
  enabled         BOOLEAN NOT NULL,
  default_enabled BOOLEAN NOT NULL,
  description     TEXT,
  guard_warning   TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      TEXT
);

-- 3. CREATE feature_flag_audit
CREATE TABLE IF NOT EXISTS feature_flag_audit (
  id          BIGSERIAL PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  key         TEXT NOT NULL,
  old_value   BOOLEAN,
  new_value   BOOLEAN NOT NULL,
  changed_by  TEXT NOT NULL,
  reason      TEXT NOT NULL
);

-- 4. INSERT 三筆預設 flags（ON CONFLICT DO NOTHING、idempotent）
INSERT INTO feature_flags (key, enabled, default_enabled, description, guard_warning) VALUES
  ('PROMPT_CACHING', false, false,
   'Anthropic prompt caching、stable system prompt 區 ephemeral cache',
   '翻開前：(1) 過去 48h hit rate > 65% (2) 過去 48h hotfix < 2 次 (3) Patrick/Vivi review chat_usage_log 50 筆'),
  ('CONDITIONAL_REVERSE_EXAMPLES', true, true,
   'Regex trigger 命中時注入 A001 累積反例（情緒詞 / 慾望詞 / 抵抗 / 比喻不通）',
   '🛑 關掉 = 直接踩 A001 Bug 3/6/12 重複。除非確認 DAMON_CORE 完全 cover、否則不關。'),
  ('DAMON_NOTE_SLIM', true, true,
   'Rolling 7-day + key-field extraction、cap yesterdayNote ~2K tokens',
   '關掉 → 跨 9 週後 yesterdayNote 可能 8-15K tokens、cache 經濟翻盤。')
ON CONFLICT (key) DO NOTHING;

-- 5. 驗證
SELECT 'AFTER feature_flags' AS stage, key, enabled, default_enabled
FROM feature_flags
ORDER BY key;

SELECT 'AFTER audit columns' AS stage, column_name, data_type
FROM information_schema.columns
WHERE table_name='feature_flag_audit'
ORDER BY ordinal_position;

-- 預期：
--   feature_flags 3 row（CONDITIONAL_REVERSE_EXAMPLES=true / DAMON_NOTE_SLIM=true / PROMPT_CACHING=false）
--   feature_flag_audit 7 columns
