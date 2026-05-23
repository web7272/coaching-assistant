-- Migration 018: sessions UNIQUE → (student_id, module, day) — self-cleaning
-- 來源：PR-4c-4e self-paced 步調 — Day N finalize → Day N+1 同日解鎖、每個 day 仍 fresh row
--
-- 變動：
--   舊 UNIQUE(student_id, module, week, session_date) — v4 一個學員每日曆天一個 session
--   新 UNIQUE(student_id, module, day)                — v5 一個學員每個 day (1-21) 一個 row
--
-- 加固（PR-4c-4e hardening per Patrick）：
--   (a) 動態找含 session_date 的舊 UNIQUE 名字 EXECUTE DROP（不寫死、漏掉就 silently no-op 的風險解掉）
--   (b) 加新 UNIQUE 前先去重：每組 (student_id, module, day) 保留最新一筆
--       (created_at DESC、tie-break id DESC)、刪 loser session row + 其 messages
--       （messages.session_id FK 無 CASCADE、必須先刪 messages）
--   (c) ADD UNIQUE — 已存在就 skip（idempotent）
--   (d) sanity assertion：任何 group 仍有 >1 row → RAISE EXCEPTION rollback 整段
--
-- 全程在 DO block 內單一 transaction、失敗整體 rollback、不會半清狀態。

DO $$
DECLARE
  v_old_name              TEXT;
  v_old_dropped           INT := 0;
  v_duplicate_groups      INT;
  v_loser_sessions        INT;
  v_loser_messages        INT;
  v_new_already_exists    BOOLEAN;
  v_post_duplicates       INT;
BEGIN
  RAISE NOTICE '════ MIGRATION 018: sessions UNIQUE → (student_id, module, day) ════';

  -- ───── (a) DROP — find every UNIQUE on `sessions` whose column-set contains session_date,
  --              EXECUTE DROP by the discovered name (no hardcoded constraint identifier).
  FOR v_old_name IN
    SELECT con.conname
      FROM pg_constraint con
      JOIN pg_class      c   ON c.oid = con.conrelid
     WHERE c.relname = 'sessions'
       AND con.contype = 'u'
       AND EXISTS (
         SELECT 1
           FROM unnest(con.conkey) AS k(attnum)
           JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.attnum
          WHERE a.attname = 'session_date'
       )
  LOOP
    RAISE NOTICE '[drop] legacy unique constraint: %', v_old_name;
    EXECUTE 'ALTER TABLE sessions DROP CONSTRAINT ' || quote_ident(v_old_name);
    v_old_dropped := v_old_dropped + 1;
  END LOOP;
  RAISE NOTICE '[drop] removed % legacy session_date-bearing UNIQUE constraint(s)', v_old_dropped;

  -- ───── (b) DEDUP — count groups + materialize losers (rn>1 = older row per group)
  SELECT count(*) INTO v_duplicate_groups
    FROM (
      SELECT student_id, module, day
        FROM sessions
       GROUP BY student_id, module, day
       HAVING count(*) > 1
    ) g;
  RAISE NOTICE '[dedup] duplicate (student_id, module, day) groups: %', v_duplicate_groups;

  CREATE TEMP TABLE _mig018_losers ON COMMIT DROP AS
  SELECT id
    FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY student_id, module, day
          ORDER BY created_at DESC NULLS LAST, id DESC
        ) AS rn
        FROM sessions
    ) ranked
   WHERE rn > 1;

  SELECT count(*) INTO v_loser_sessions FROM _mig018_losers;
  SELECT count(*) INTO v_loser_messages
    FROM messages
   WHERE session_id IN (SELECT id FROM _mig018_losers);
  RAISE NOTICE '[dedup] losers: % session row(s) + % attached message row(s)',
               v_loser_sessions, v_loser_messages;

  IF v_loser_sessions > 0 THEN
    -- messages.session_id FK has no ON DELETE CASCADE — wipe attached messages first
    DELETE FROM messages WHERE session_id IN (SELECT id FROM _mig018_losers);
    DELETE FROM sessions WHERE id          IN (SELECT id FROM _mig018_losers);
    RAISE NOTICE '[dedup] deleted loser rows';
  END IF;

  -- ───── (c) ADD new UNIQUE — idempotent (skip if already present from a prior partial run)
  SELECT EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class      c ON c.oid = con.conrelid
     WHERE c.relname = 'sessions'
       AND con.contype = 'u'
       AND con.conname = 'sessions_student_id_module_day_key'
  ) INTO v_new_already_exists;

  IF v_new_already_exists THEN
    RAISE NOTICE '[add] sessions_student_id_module_day_key already exists — skip';
  ELSE
    ALTER TABLE sessions
      ADD CONSTRAINT sessions_student_id_module_day_key
      UNIQUE (student_id, module, day);
    RAISE NOTICE '[add] sessions_student_id_module_day_key created';
  END IF;

  -- ───── (d) SANITY — final assertion: no duplicates remain (defends against a dedup bug
  --              or a concurrent INSERT racing between dedup and ADD CONSTRAINT).
  SELECT count(*) INTO v_post_duplicates
    FROM (
      SELECT student_id, module, day
        FROM sessions
       GROUP BY student_id, module, day
       HAVING count(*) > 1
    ) g;
  IF v_post_duplicates > 0 THEN
    RAISE EXCEPTION 'migration 018: % duplicate group(s) remain after dedup — rollback', v_post_duplicates;
  END IF;

  RAISE NOTICE '════ MIGRATION 018 DONE ════';
END $$;

-- ═══ VERIFY ═══ (after the DO block commits — should show only the new UNIQUE)
SELECT 'AFTER' AS stage, conname, pg_get_constraintdef(oid) AS def
  FROM pg_constraint
 WHERE conrelid = 'sessions'::regclass AND contype = 'u'
 ORDER BY conname;
-- 預期：只有 sessions_student_id_module_day_key UNIQUE (student_id, module, day)
