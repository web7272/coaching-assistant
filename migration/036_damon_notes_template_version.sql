-- Migration 036: damon_notes.template_version (Vivi 6/8).
-- v52_damon_note_pipeline_errata PR-a §3.1 — 標 template 格式版本.
--
-- 動機 (Patrick 6/8): Damon Note template v5.2 化後, 歷史 damon_notes 仍是
-- v3.3 (Layer 1-5 / 工具一二三四 / 2A 2B 2C 池 / Cathy Q5). 不 backfill —
-- 但要分得出來哪些是新格式, 後台/分析可篩.
--
-- 新增:
--   damon_notes.template_version TEXT — 預設 'v3.3' (歷史值);
--                                     新生成寫 'v5.2' (api/chat.js generateDamonNote).
--
-- 跑這支前確認 migration 序號: 上一支是 035 (day1_completed_at).
--
-- ⚠️ DO NOT RUN AUTOMATICALLY. Vivi 跑 Neon console:
--   psql $DATABASE_URL -f migration/036_damon_notes_template_version.sql

DO $$
BEGIN
  RAISE NOTICE '════ MIGRATION 036: damon_notes.template_version ════';
END $$;

-- ════════════════════════════════════════════════════════════════
-- 1. BEFORE snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='damon_notes' AND column_name='template_version') AS col_exists;

-- ════════════════════════════════════════════════════════════════
-- 2. damon_notes.template_version column (idempotent)
-- ════════════════════════════════════════════════════════════════
-- DEFAULT 'v3.3' 套用到既有 rows (PostgreSQL ADD COLUMN ... DEFAULT
-- backfills existing). 之後 v5.2 寫入會明寫 'v5.2'.
ALTER TABLE damon_notes
  ADD COLUMN IF NOT EXISTS template_version TEXT DEFAULT 'v3.3';

-- CHECK constraint — 只允許已知版本字串 (避免 typo). Idempotent.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'damon_notes'::regclass
      AND conname = 'damon_notes_template_version_check'
  ) THEN
    ALTER TABLE damon_notes
      ADD CONSTRAINT damon_notes_template_version_check
      CHECK (template_version IN ('v3.3', 'v5.2'));
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════
-- 3. AFTER snapshot
-- ════════════════════════════════════════════════════════════════
SELECT 'AFTER' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='damon_notes' AND column_name='template_version') AS col_exists;

SELECT 'TEMPLATE VERSION DISTRIBUTION' AS stage,
       template_version, COUNT(*) AS notes_count
  FROM damon_notes
 GROUP BY template_version
 ORDER BY template_version;
-- 預期 (剛跑完): 全部 'v3.3' (DEFAULT backfill).
-- 上線後逐漸出現 'v5.2' rows.

-- ════════════════════════════════════════════════════════════════
-- 4. Operational queries (commented; Vivi / 後台分析可用)
-- ════════════════════════════════════════════════════════════════
-- 看某學員的 note 格式分布:
-- SELECT day, template_version, is_week_summary
--   FROM damon_notes
--  WHERE student_id = 'A006' AND module = 'self'
--  ORDER BY day;
--
-- 找 v3.3 (歷史 / 舊格式) note 數量:
-- SELECT COUNT(*) FROM damon_notes WHERE template_version = 'v3.3';
