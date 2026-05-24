-- Migration 019: students UNIQUE on LOWER(email) WHERE email IS NOT NULL — self-cleaning
-- 來源：PR-4c-green Vivi A001 親測 bug 4 — 同一 email 沒有保證 resume 同一學員 row、
--      可能出現重複 row（admin 預建 + 學員入口 + 不同大小寫 / trailing space）。
--
-- 變動：
--   原 students.email TEXT（無 UNIQUE 約束）→ 加 partial UNIQUE INDEX on LOWER(TRIM(email))
--   只 cover email IS NOT NULL（NULL email 是 admin-pre-created 殘留、不算學員身分、
--   不該被 unique 連動互斥）
--
-- 加固（呼應 migration 018 self-cleaning 樣式、Patrick 風格）：
--   (a) 跑前 DIAGNOSE — 找出有重複 LOWER(email) 的 group、RAISE NOTICE 列出
--   (b) AUTO-CLEANUP — 對每個 duplicate group：「保留最低 student_id（最舊）+ 有實質資料
--       的 winner」、其他 row 若【完全沒有 FK 殘留】才安全 DELETE；任一 loser 有殘留就
--       RAISE EXCEPTION rollback（不替 Vivi 自動毀資料、列出待手動處理的 id）
--   (c) ADD UNIQUE INDEX — IF NOT EXISTS（idempotent）
--   (d) SANITY — 任何 group 仍重複 → RAISE EXCEPTION rollback
--
-- 全程在 DO block 內單一 transaction、失敗整體 rollback、不會半清狀態。

DO $$
DECLARE
  v_groups            INT;
  v_dup_row           RECORD;
  v_loser             RECORD;
  v_loser_has_data    BOOLEAN;
  v_loser_msg_cnt     INT;
  v_loser_sess_cnt    INT;
  v_loser_dn_cnt      INT;
  v_loser_upe_cnt     INT;
  v_loser_cul_cnt     INT;
  v_loser_pem_cnt     INT;
  v_safe_to_delete    BOOLEAN;
  v_deleted_losers    INT := 0;
  v_blocked_losers    TEXT := '';
  v_index_exists      BOOLEAN;
  v_post_duplicates   INT;
BEGIN
  RAISE NOTICE '════ MIGRATION 019: students UNIQUE on LOWER(email) ════';

  -- ───── (a) DIAGNOSE — find duplicate LOWER(email) groups (only where email IS NOT NULL)
  SELECT count(*) INTO v_groups
    FROM (
      SELECT LOWER(TRIM(email)) AS k
        FROM students
       WHERE email IS NOT NULL AND TRIM(email) <> ''
       GROUP BY LOWER(TRIM(email))
       HAVING count(*) > 1
    ) g;
  RAISE NOTICE '[diagnose] duplicate LOWER(email) groups: %', v_groups;

  IF v_groups > 0 THEN
    FOR v_dup_row IN
      SELECT LOWER(TRIM(email)) AS email_key,
             array_agg(student_id ORDER BY student_id) AS ids
        FROM students
       WHERE email IS NOT NULL AND TRIM(email) <> ''
       GROUP BY LOWER(TRIM(email))
      HAVING count(*) > 1
    LOOP
      RAISE NOTICE '[diagnose]   email=% has rows %', v_dup_row.email_key, v_dup_row.ids;
    END LOOP;
  END IF;

  -- ───── (b) AUTO-CLEANUP — for each group, keep the LOWEST student_id; delete others IFF
  --              they have ZERO data in messages / sessions / damon_notes / UPE /
  --              chat_usage_log / prompt_engineering_misses. Otherwise refuse + EXCEPTION.
  IF v_groups > 0 THEN
    FOR v_dup_row IN
      SELECT LOWER(TRIM(email)) AS email_key
        FROM students
       WHERE email IS NOT NULL AND TRIM(email) <> ''
       GROUP BY LOWER(TRIM(email))
      HAVING count(*) > 1
    LOOP
      -- iterate losers = every row in this group EXCEPT the one with the lowest student_id
      FOR v_loser IN
        SELECT student_id
          FROM students
         WHERE LOWER(TRIM(email)) = v_dup_row.email_key
         ORDER BY student_id
        OFFSET 1
      LOOP
        SELECT count(*) INTO v_loser_msg_cnt
          FROM messages m JOIN sessions s ON s.id = m.session_id
         WHERE s.student_id = v_loser.student_id;
        SELECT count(*) INTO v_loser_sess_cnt FROM sessions               WHERE student_id = v_loser.student_id;
        SELECT count(*) INTO v_loser_dn_cnt   FROM damon_notes            WHERE student_id = v_loser.student_id;
        SELECT count(*) INTO v_loser_upe_cnt  FROM user_profile_evolution WHERE student_id = v_loser.student_id;
        SELECT count(*) INTO v_loser_cul_cnt  FROM chat_usage_log         WHERE student_id = v_loser.student_id;
        SELECT count(*) INTO v_loser_pem_cnt  FROM prompt_engineering_misses WHERE student_id = v_loser.student_id;

        v_loser_has_data := (v_loser_msg_cnt + v_loser_sess_cnt + v_loser_dn_cnt
                          + v_loser_upe_cnt + v_loser_cul_cnt + v_loser_pem_cnt) > 0;

        IF v_loser_has_data THEN
          RAISE NOTICE '[cleanup] REFUSE delete % (email=%) — has data (msg=% sess=% dn=% upe=% cul=% pem=%)',
            v_loser.student_id, v_dup_row.email_key,
            v_loser_msg_cnt, v_loser_sess_cnt, v_loser_dn_cnt,
            v_loser_upe_cnt, v_loser_cul_cnt, v_loser_pem_cnt;
          v_blocked_losers := v_blocked_losers || v_loser.student_id || ' ';
        ELSE
          DELETE FROM students WHERE student_id = v_loser.student_id;
          v_deleted_losers := v_deleted_losers + 1;
          RAISE NOTICE '[cleanup] DELETED empty duplicate % (email=%)', v_loser.student_id, v_dup_row.email_key;
        END IF;
      END LOOP;
    END LOOP;

    IF v_blocked_losers <> '' THEN
      RAISE EXCEPTION 'migration 019: refused to auto-merge duplicate-email students with data — manual decision required for: % (rolled back)', v_blocked_losers;
    END IF;
    RAISE NOTICE '[cleanup] deleted % empty duplicate row(s)', v_deleted_losers;
  END IF;

  -- ───── (c) ADD UNIQUE PARTIAL INDEX — idempotent
  SELECT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename  = 'students'
       AND indexname  = 'students_email_lower_unique'
  ) INTO v_index_exists;

  IF v_index_exists THEN
    RAISE NOTICE '[add] students_email_lower_unique already exists — skip';
  ELSE
    CREATE UNIQUE INDEX students_email_lower_unique
      ON students (LOWER(TRIM(email)))
      WHERE email IS NOT NULL AND TRIM(email) <> '';
    RAISE NOTICE '[add] students_email_lower_unique created';
  END IF;

  -- ───── (d) SANITY — re-count duplicates after dedup + index
  SELECT count(*) INTO v_post_duplicates
    FROM (
      SELECT LOWER(TRIM(email)) AS k
        FROM students
       WHERE email IS NOT NULL AND TRIM(email) <> ''
       GROUP BY LOWER(TRIM(email))
       HAVING count(*) > 1
    ) g;
  IF v_post_duplicates > 0 THEN
    RAISE EXCEPTION 'migration 019: % duplicate group(s) remain — rollback', v_post_duplicates;
  END IF;

  RAISE NOTICE '════ MIGRATION 019 DONE ════';
END $$;

-- ═══ VERIFY ═══ (after the DO block commits)
SELECT 'AFTER' AS stage, indexname, indexdef
  FROM pg_indexes
 WHERE schemaname = 'public' AND tablename = 'students' AND indexname = 'students_email_lower_unique';
-- 預期：1 row: UNIQUE INDEX … ON students (lower(btrim(email))) WHERE … email IS NOT NULL …

-- Diagnostic — any duplicate emails left (should be 0 rows)
SELECT LOWER(TRIM(email)) AS email_key, array_agg(student_id ORDER BY student_id) AS ids
  FROM students
 WHERE email IS NOT NULL AND TRIM(email) <> ''
 GROUP BY LOWER(TRIM(email))
HAVING count(*) > 1;
