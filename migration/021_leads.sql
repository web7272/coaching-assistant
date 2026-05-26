-- Migration 021: leads — 漏斗 Stage 0 PDF 索取 + 5 題黃金資料收集
-- 來源：Patrick 5/26「preview-1日漏斗最小測試版」spec Stage 0
--
-- 跟核心封測無關（新增端點 + 新表、不動現有流程）。
--
-- 流程：
--   POST /api/request-guide {email, option, answers?}
--     option 1 = 只下載 PDF（最常見、無 answers）
--     option 2 = 只試用（不下載 PDF、發 magic link 開試用、有 answers）
--     option 3 = 下載 + 試用（PDF + magic link、有 answers）
--   answers (jsonb, option 2/3 才填): { 現況, 渴望, 阻礙, 預算, 開放題 }
--     稱謂/pace 不在這收（稱謂 App 內暖場問、pace 付費後問）.
--
-- 安全 / 設計：
--   - email 不去重 (UNIQUE)、同一人多次索取 / 再來填 5 題都可重複 INSERT.
--     之後做 dedup / 漏斗追蹤、用 created_at + GROUP BY email 即可.
--   - answers JSONB、schema 鬆綁 (5 題之後可能再調題目).
--   - SERIAL id 不暴露給前端；endpoint 永遠回 {ok:true}.
--
-- 跑這支前確認 migration 序號：上一支是 020 (magic_link_tokens).

DO $$
BEGIN
  RAISE NOTICE '════ MIGRATION 021: leads (Stage 0 PDF 索取 / 黃金 5 題) ════';
END $$;

CREATE TABLE IF NOT EXISTS leads (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL,
  option     SMALLINT NOT NULL,        -- 1=只下載PDF, 2=只試用, 3=下載+試用
  answers    JSONB,                     -- {現況,渴望,阻礙,預算,開放題}（option 2/3）
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup by email — 之後做漏斗回訪 (「這個 email 之前下載過嗎」) 用.
CREATE INDEX IF NOT EXISTS leads_email_idx ON leads (email);

-- ═══ VERIFY ═══ (after the DO block commits)
SELECT 'AFTER' AS stage, table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'leads'
 ORDER BY ordinal_position;
-- 預期：5 row — id integer NO nextval / email text NO / option smallint NO
--           / answers jsonb YES / created_at timestamptz NO (default now())

SELECT 'INDEXES' AS stage, indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'leads'
 ORDER BY indexname;
-- 預期：2 row — PK + email_idx
