-- scripts/reset_student.sql
-- ════════════════════════════════════════════════════════════════
-- SINGLE-STUDENT clean reset — 把指定學員打回「全新、first-ever、Day 1」
--
-- 範圍：
--   v4 + v5 殘留全清：messages / sessions / damon_notes /
--     user_profile_evolution / chat_usage_log / prompt_engineering_misses
--   students 表進度 / 完成 / 升級欄位 reset 回初始
-- 保留：students(id, student_id, email, created_at) — 登入素材不動。
-- 不會動到：其他學員、其他資料表。
--
-- ⚠️ 不要用 migration/reset_database.sql（那支 TRUNCATE 所有人、清光全 students）。
--
-- HOW TO USE：
--   1. 改 DO 區塊內第一行 `v_sid text := 'A001';` 換要 reset 的 student_id
--   2. 改最後 STEP 2 SELECT 裡的 'A001' 對齊同樣 student_id（兩處 only）
--   3. 在 Neon SQL console 一次貼整支跑（DO block + 後續 SELECT）
--   4. 看 Messages 面板 [BEFORE]/[AFTER] counts + Result 面板 students row 確認
--   5. 若 AFTER 任一 count > 0、DO 內 RAISE EXCEPTION 會 rollback、不會半清狀態
--
-- 安全：所有 WHERE 都綁 v_sid（DO）或 'A001'（最後 SELECT）、不會誤動其他學員。
-- 原子性：DO block 整段所有 DELETE/UPDATE 在同一個 transaction、throw 就 rollback。
-- ════════════════════════════════════════════════════════════════

DO $$
DECLARE
  -- ★ 改這一行：要 reset 的學員 student_id ★
  v_sid text := 'A001';

  v_msg_before  int;  v_msg_after  int;
  v_sess_before int;  v_sess_after int;
  v_dn_before   int;  v_dn_after   int;
  v_upe_before  int;  v_upe_after  int;
  v_cul_before  int;  v_cul_after  int;
  v_pem_before  int;  v_pem_after  int;
  v_other_before int; v_other_after int;
BEGIN
  -- ───── BEFORE counts（殘留現況）─────
  SELECT count(*) INTO v_msg_before  FROM messages m
    JOIN sessions s ON s.id = m.session_id WHERE s.student_id = v_sid;
  SELECT count(*) INTO v_sess_before FROM sessions                  WHERE student_id = v_sid;
  SELECT count(*) INTO v_dn_before   FROM damon_notes               WHERE student_id = v_sid;
  SELECT count(*) INTO v_upe_before  FROM user_profile_evolution    WHERE student_id = v_sid;
  SELECT count(*) INTO v_cul_before  FROM chat_usage_log            WHERE student_id = v_sid;
  SELECT count(*) INTO v_pem_before  FROM prompt_engineering_misses WHERE student_id = v_sid;
  SELECT count(*) INTO v_other_before FROM students                 WHERE student_id <> v_sid;

  RAISE NOTICE '════ RESET START: student_id=% ════', v_sid;
  RAISE NOTICE '[BEFORE] messages=% sessions=% damon_notes=% user_profile=% chat_usage=% misses=% (others=%)',
    v_msg_before, v_sess_before, v_dn_before, v_upe_before, v_cul_before, v_pem_before, v_other_before;

  -- ───── DELETE 子表（FK direction：messages 必須在 sessions 前）─────
  DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE student_id = v_sid);
  DELETE FROM damon_notes               WHERE student_id = v_sid;   -- 含 is_week_summary=true 週報 row
  DELETE FROM chat_usage_log            WHERE student_id = v_sid;   -- v4 observability 殘留
  DELETE FROM prompt_engineering_misses WHERE student_id = v_sid;   -- 同上
  DELETE FROM sessions                  WHERE student_id = v_sid;   -- 含 session_state JSONB / day_complete / notebook_page / damon_note / damon_note_public
  DELETE FROM user_profile_evolution    WHERE student_id = v_sid;   -- 含 anchors / daily_takeaways / phase_history / values_* / counters / last_active_date — 首次 v5 chat 由 incrementUserProfileCounters upsert 重建

  -- ───── students：reset v4 進度/完成/升級欄位、保留 id/student_id/email/created_at ─────
  --   admin 後台用 current_module/current_week/current_day 算「Day N」、必清
  UPDATE students SET
    current_module              = 'self',
    current_week                = 1,
    current_day                 = 1,
    self_week_completed         = 0,
    money_week_completed        = 0,
    relationship_week_completed = 0,
    money_unlocked              = FALSE,
    relationship_unlocked       = FALSE,
    upgrade_deadline            = NULL,
    upgraded_at                 = NULL,
    upgrade_amount              = NULL,
    plan                        = 'trial',
    tier                        = 0,
    notes                       = NULL,
    updated_at                  = NOW()
  WHERE student_id = v_sid;

  -- ───── AFTER counts（驗證）─────
  SELECT count(*) INTO v_msg_after  FROM messages m
    JOIN sessions s ON s.id = m.session_id WHERE s.student_id = v_sid;
  SELECT count(*) INTO v_sess_after FROM sessions                  WHERE student_id = v_sid;
  SELECT count(*) INTO v_dn_after   FROM damon_notes               WHERE student_id = v_sid;
  SELECT count(*) INTO v_upe_after  FROM user_profile_evolution    WHERE student_id = v_sid;
  SELECT count(*) INTO v_cul_after  FROM chat_usage_log            WHERE student_id = v_sid;
  SELECT count(*) INTO v_pem_after  FROM prompt_engineering_misses WHERE student_id = v_sid;
  SELECT count(*) INTO v_other_after FROM students                 WHERE student_id <> v_sid;

  RAISE NOTICE '[AFTER]  messages=% sessions=% damon_notes=% user_profile=% chat_usage=% misses=% (others=%)',
    v_msg_after, v_sess_after, v_dn_after, v_upe_after, v_cul_after, v_pem_after, v_other_after;

  -- ───── 防呆 sanity checks（任一 fail 就 rollback 整段）─────
  IF v_msg_after + v_sess_after + v_dn_after + v_upe_after + v_cul_after + v_pem_after > 0 THEN
    RAISE EXCEPTION '⚠️ AFTER counts 不全為 0、reset 不乾淨。檢查 v_sid 拼字 + 權限 + FK。';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM students WHERE student_id = v_sid) THEN
    RAISE EXCEPTION '⚠️ students row for % 不見了——應該保留 row、只 reset 欄位。', v_sid;
  END IF;
  IF v_other_after <> v_other_before THEN
    RAISE EXCEPTION '⚠️ 其他學員 count 變了（% → %）——只 reset 一人、不該動到別人。', v_other_before, v_other_after;
  END IF;

  RAISE NOTICE '════ RESET DONE: % 已歸零、可開新 v5 session ════', v_sid;
END $$;

-- ═══════════════════════════════════════════════════════════
-- STEP 2：grid 視覺確認（複製到 Neon 結果面板用）
-- ★ 改這一行（跟 DO 內 v_sid 對齊）★
-- ═══════════════════════════════════════════════════════════
SELECT student_id, email, current_module, current_week, current_day,
       self_week_completed, money_week_completed, relationship_week_completed,
       money_unlocked, relationship_unlocked,
       plan, tier, upgrade_deadline, upgraded_at, upgrade_amount,
       notes, created_at, updated_at
FROM students WHERE student_id = 'A001';
-- 預期：
--   current_module='self' / current_week=1 / current_day=1
--   *_week_completed=0 / *_unlocked=false / upgrade_*=null
--   plan='trial' / tier=0 / notes=null
--   → 教練後台顯示「self ／ Week 1 ／ Day 1」= 真的乾淨（不是 Week 1 Day 4）
