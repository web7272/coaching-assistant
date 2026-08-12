-- Migration 040: seminar_signups — 《問對問題》9/30 免費線上講座報名名單
-- 來源：Vivi 7/30「回CC-seminarPR綠燈」+「回CC-seminar上線決定」
--
-- 跟核心封測 / App 無關 — App 已下線、seminar 靜態頁 + 單一 endpoint.
--
-- 流程：
--   POST /api/subscribe {email, question, source}
--     source = 'hero' | 'signup'  (v12 HTML 兩個表單各自 hidden input 帶)
--     question = 使用者「你現在最想問的一個問題」的答案 (v12 form 必填)
--     → INSERT 一筆 + Brevo list add + 寄 confirmation email
--
-- 安全 / 設計：
--   - email 不去重 (UNIQUE) — 同一個人再送就再開一筆，之後做漏斗
--     分析 GROUP BY email 即可 (對齊 021_leads pattern).
--   - question TEXT — 開放題，長度不設上限 (前端 textarea 有 UX-level 節制).
--   - source TEXT — hero / signup，不設 CHECK 因為未來可能加更多入口.
--   - SERIAL id 不暴露前端; endpoint 永遠回 {ok:true} 或 303 (subscribe.js).
--
-- 跑這支前確認 migration 序號：上一支是 039 (sc_storyboard_history).

DO $$
BEGIN
  RAISE NOTICE '════ MIGRATION 040: seminar_signups (問對問題 9/30 講座報名) ════';
END $$;

CREATE TABLE IF NOT EXISTS seminar_signups (
  id         SERIAL PRIMARY KEY,
  email      TEXT NOT NULL,
  question   TEXT,                       -- 使用者「最想問的一個問題」
  source     TEXT NOT NULL,              -- 'hero' | 'signup'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Lookup by email — 之後做回訪 / 漏斗 / 重複報名分析用.
CREATE INDEX IF NOT EXISTS seminar_signups_email_idx ON seminar_signups (email);

-- ═══ VERIFY ═══ (after the DO block commits)
SELECT 'AFTER' AS stage, table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'seminar_signups'
 ORDER BY ordinal_position;
-- 預期：5 row — id integer NO nextval / email text NO / question text YES
--           / source text NO / created_at timestamptz NO (default now())

SELECT 'INDEXES' AS stage, indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'seminar_signups'
 ORDER BY indexname;
-- 預期：2 row — PK + email_idx
