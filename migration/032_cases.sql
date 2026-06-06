-- Migration 032: cases — 客服 ticket 表 (Daniel 6/5 request, Vivi 6/6 拍板).
-- 來源: Daniel 工作流 — 新客服信 → 判真 CS → POST /api/admin/cases 拿 case_id →
--        用 ack 模板直接寄(附 case_id) → full reply 進 Gmail Drafts 等 Vivi.
--
-- 跟核心封測無關 (admin-only ticketing, 不動 chat / sessions / damon_notes).
--
-- case_id 格式: SY-YYYYMMDD-NNN (Daniel 偏好).
--   YYYYMMDD: 台北時區
--   NNN: 該日流水 (001 起、3 位 padding)
--   生成 + UNIQUE constraint + app-layer retry-on-conflict (lib/api/case-id.js).
--
-- category enum: bug / login / progress / feedback / refund / other
-- status   enum: open / awaiting_vivi / resolved
--
-- 跑這支前確認 migration 序號: 上一支是 031 (students.context_onboarded).
--
-- ⚠️ DO NOT RUN AUTOMATICALLY. Vivi 跑 Neon console:
--   psql $DATABASE_URL -f migration/032_cases.sql

DO $$
BEGIN
  RAISE NOTICE '════ MIGRATION 032: cases (Daniel 客服 ticketing) ════';
END $$;

-- ════════════════════════════════════════════════════════════════
-- 1. BEFORE snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_name='cases') AS cases_table_exists;

-- ════════════════════════════════════════════════════════════════
-- 2. CREATE TABLE (idempotent IF NOT EXISTS)
-- ════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS cases (
  id              SERIAL PRIMARY KEY,
  case_id         TEXT NOT NULL UNIQUE,          -- SY-YYYYMMDD-NNN
  email           TEXT NOT NULL,
  gmail_thread_id TEXT,
  subject         TEXT,
  student_id      TEXT,                          -- 已知封測者帶、不強制 FK (客服可能非學員)
  category        TEXT NOT NULL DEFAULT 'other', -- bug/login/progress/feedback/refund/other
  status          TEXT NOT NULL DEFAULT 'open',  -- open/awaiting_vivi/resolved
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at     TIMESTAMPTZ
);

-- Idempotent CHECK constraints (catch via DO block — duplicate ADD throws else).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'cases'::regclass
      AND conname = 'cases_category_check'
  ) THEN
    ALTER TABLE cases
      ADD CONSTRAINT cases_category_check
      CHECK (category IN ('bug','login','progress','feedback','refund','other'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'cases'::regclass
      AND conname = 'cases_status_check'
  ) THEN
    ALTER TABLE cases
      ADD CONSTRAINT cases_status_check
      CHECK (status IN ('open','awaiting_vivi','resolved'));
  END IF;
END $$;

-- Indexes — common Daniel queries: by student_id (學員→case list), by status
-- (open 待處理 queue), by email (回信時找 thread).
CREATE INDEX IF NOT EXISTS idx_cases_student_id ON cases(student_id);
CREATE INDEX IF NOT EXISTS idx_cases_status     ON cases(status);
CREATE INDEX IF NOT EXISTS idx_cases_email      ON cases(email);

-- ════════════════════════════════════════════════════════════════
-- 3. AFTER snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'AFTER' AS stage, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'cases'
 ORDER BY ordinal_position;
-- 預期: 11 row (id/case_id/email/gmail_thread_id/subject/student_id/category/
--             status/notes/created_at/resolved_at)

SELECT 'CONSTRAINTS' AS stage, conname, contype
  FROM pg_constraint
 WHERE conrelid = 'cases'::regclass
 ORDER BY conname;
-- 預期: PK + UNIQUE(case_id) + 2 CHECKs (category + status)

SELECT 'INDEXES' AS stage, indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'cases'
 ORDER BY indexname;
-- 預期: 4 row (PK + UNIQUE(case_id) + 3 by-column indexes)

-- ════════════════════════════════════════════════════════════════
-- 4. Smoke test (commented — Vivi run manually if needed)
-- ════════════════════════════════════════════════════════════════
-- INSERT INTO cases (case_id, email, category) VALUES
--   ('SY-20260606-001', 'test@example.com', 'bug')
-- RETURNING case_id, status, created_at;
-- 預期: 1 row, status=open, created_at=NOW().
--
-- -- CHECK constraint test:
-- INSERT INTO cases (case_id, email, category) VALUES
--   ('SY-20260606-002', 'test@example.com', 'invalid_category');
-- 預期: ERROR — cases_category_check violation.
