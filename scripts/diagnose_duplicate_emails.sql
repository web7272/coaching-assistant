-- scripts/diagnose_duplicate_emails.sql
-- 唯讀診斷 — 回答「students 表有沒有同 email 重複 row」+「NULL email 的殭屍 row」。
-- 跑前看 → 決定要不要跑 migration 019（會自動清「空殭屍」、保留有資料的）。
--
-- 在 Neon SQL console 整支貼進去跑。不做任何 DELETE/UPDATE/INSERT。
--
-- 輸出 4 區塊：
--   1. 重複 email group（同 LOWER(TRIM(email)) 出現 >1 row）— 含 student_id 列表
--   2. 每個重複 student 的資料殘留 footprint（msg/sess/dn/upe）— migration 019 用來判定能不能安全刪
--   3. 空 / NULL email 的 student row（admin 預建殘留）— 跟學員入口不互斥、可保留
--   4. 全表 row 概觀（student_id / email / preferred_name / current_day / created_at）
-- ════════════════════════════════════════════════════════════════════════════

-- 1. 重複 email group
SELECT '=== 1. 重複 email group ===' AS section;
SELECT LOWER(TRIM(email)) AS email_key,
       count(*)            AS dup_count,
       array_agg(student_id ORDER BY student_id) AS student_ids
  FROM students
 WHERE email IS NOT NULL AND TRIM(email) <> ''
 GROUP BY LOWER(TRIM(email))
HAVING count(*) > 1
 ORDER BY dup_count DESC, email_key;
-- 預期：0 row = 沒有重複、可直接跑 migration 019
--      若有 row → 看下一區塊判斷 winner / loser

-- 2. 每個重複 student 的資料殘留 footprint
SELECT '=== 2. 重複 student 的資料 footprint ===' AS section;
WITH dup_students AS (
  SELECT s.student_id, LOWER(TRIM(s.email)) AS email_key, s.created_at
    FROM students s
   WHERE LOWER(TRIM(s.email)) IN (
     SELECT LOWER(TRIM(email))
       FROM students
      WHERE email IS NOT NULL AND TRIM(email) <> ''
      GROUP BY LOWER(TRIM(email))
     HAVING count(*) > 1
   )
)
SELECT
  d.student_id,
  d.email_key,
  d.created_at::date AS created_date,
  (SELECT count(*) FROM messages m JOIN sessions s ON s.id = m.session_id WHERE s.student_id = d.student_id) AS msg_count,
  (SELECT count(*) FROM sessions               WHERE student_id = d.student_id) AS sess_count,
  (SELECT count(*) FROM damon_notes            WHERE student_id = d.student_id) AS dn_count,
  (SELECT count(*) FROM user_profile_evolution WHERE student_id = d.student_id) AS upe_count,
  (SELECT count(*) FROM chat_usage_log         WHERE student_id = d.student_id) AS cul_count,
  (SELECT count(*) FROM prompt_engineering_misses WHERE student_id = d.student_id) AS pem_count
FROM dup_students d
ORDER BY d.email_key, d.student_id;
-- 解讀：
--   - 同 email_key 的 row、msg+sess+dn+upe+cul+pem 全 0 = 「空殭屍」、migration 019 會安全刪
--   - 任一 loser（非最小 student_id 那個）有資料 → migration 019 拒絕、要 Vivi 手動決定保留哪邊

-- 3. NULL / 空 email 的 student row（不影響、看一下而已）
SELECT '=== 3. NULL / 空 email row（不影響 unique index、可保留）===' AS section;
SELECT student_id, email, preferred_name, current_module, current_week, current_day, created_at::date AS created_date
  FROM students
 WHERE email IS NULL OR TRIM(email) = ''
 ORDER BY student_id;

-- 4. 全表 row 概觀
SELECT '=== 4. students 全表 概觀 ===' AS section;
SELECT student_id, email, preferred_name, pace, current_day,
       created_at::date AS created_date, updated_at::date AS updated_date
  FROM students
 ORDER BY student_id;
