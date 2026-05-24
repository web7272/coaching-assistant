-- Migration 020: magic_link_tokens table — PR-4c-green Auth rebuild stage 1c
-- 來源：Patrick 5/24 ping 「Auth 重建：學員 magic link + 教練通行碼」
--
-- Token storage for the student magic-link login flow:
--   1. POST /api/auth/request-link {email, preferredName?, pace?}
--      → random token (crypto 32 bytes hex) → SHA-256 → INSERT this row →
--        sendMagicLink(email, link=${APP_BASE_URL}/auth?token=${token})
--      → 永遠回 {ok:true} (不洩漏 email 是否存在)
--   2. POST /api/auth/verify-link {token}
--      → SHA-256(token) → SELECT this row → check used_at IS NULL + expires_at > NOW()
--      → 標 used_at = NOW() (atomic UPDATE…RETURNING)
--      → find-or-create student by email → set student_session cookie
--      → 回 {studentId, module, currentDay, preferredName, pace}
--
-- 安全：
--   - 儲 SHA-256(token)、不存原始 token (DB dump 看不到能用的連結)
--   - PRIMARY KEY on token_hash → O(1) lookup + 防意外重複
--   - expires_at 20min from creation (verify-link 強制檢查)
--   - used_at 一次性 (重 play 會被 atomic UPDATE 擋掉)
--   - INDEX on email 給「同一信箱發太多連結」未來的 rate-limit 用
--   - 不存 ip / user-agent (PII 最少化)
--
-- 跑這支前確認 migration 序號：上一支是 019 (students_email_unique)。

DO $$
BEGIN
  RAISE NOTICE '════ MIGRATION 020: magic_link_tokens (auth rebuild stage 1c) ════';
END $$;

CREATE TABLE IF NOT EXISTS magic_link_tokens (
  token_hash      text        PRIMARY KEY,
  email           text        NOT NULL,
  preferred_name  text,
  pace            text,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- Lookup by email (future rate-limit: how many links sent to this email in last N minutes).
CREATE INDEX IF NOT EXISTS magic_link_tokens_email_idx
  ON magic_link_tokens (email);

-- Lookup by expiry — supports a future cron sweep that DELETEs expired+used rows.
-- (Not running such a sweep yet; the table will grow slowly during封測.)
CREATE INDEX IF NOT EXISTS magic_link_tokens_expires_at_idx
  ON magic_link_tokens (expires_at);

-- ═══ VERIFY ═══ (after the DO block commits)
SELECT 'AFTER' AS stage, table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'magic_link_tokens'
 ORDER BY ordinal_position;
-- 預期：6 row — token_hash text PK NO / email text NO / preferred_name text YES
--           / pace text YES / expires_at timestamptz NO / used_at timestamptz YES
--           / created_at timestamptz NO (default now())

SELECT 'INDEXES' AS stage, indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'magic_link_tokens'
 ORDER BY indexname;
-- 預期：3 row — PK + email_idx + expires_at_idx
