-- scripts/advance_student_day.sql
-- ════════════════════════════════════════════════════════════════
-- 測試快轉：把指定學員跳到 v5 Day N，不必逐天走
--
-- 設定：
--   user_profile_evolution.session_day_count = N
--   user_profile_evolution.last_active_date  = NOW() - INTERVAL '1 day'
--                                              （= 昨天、讓 detectNewSessionDay 回 is_new_day=true）
--
-- 不動：sessions / messages / damon_notes — 仍是空的（跳過去後從 Day N 開新 session、
--      格子 D1..D(N-1) 在旅程上會是 future（沒 takeaway 也沒 notebook_page）；
--      點不開、屬正常）。journey.api 的 currentDay floor 會把它 max(1, N) 變 N。
--
-- HOW TO USE：
--   1. 改下方 v_sid + v_target_day 兩行
--   2. 在 Neon SQL console 一次貼整支跑
--   3. 看 Messages 面板 [BEFORE]/[AFTER] + Result 面板 student.preferred_name / pace
--   4. 開 /journey → 應該看到 Day N active-empty、點下去可進對話（chat.js 建新 session）
--
-- 跑完想還原 → 跑 scripts/reset_student.sql 把該學員打回 first-ever。
-- ════════════════════════════════════════════════════════════════

DO $$
DECLARE
  -- ★ 改這兩行 ★
  v_sid        text := 'A001';
  v_target_day int  := 7;       -- 想跳到 Day 7 / Day 14 / Day 21 等

  v_cnt_before  int;  v_cnt_after  int;
  v_lad_before  timestamptz;     v_lad_after  timestamptz;
BEGIN
  -- ── BEFORE
  SELECT session_day_count, last_active_date
    INTO v_cnt_before, v_lad_before
    FROM user_profile_evolution
   WHERE student_id = v_sid;

  RAISE NOTICE '════ ADVANCE: student_id=% → Day % ════', v_sid, v_target_day;
  RAISE NOTICE '[BEFORE] session_day_count=% last_active_date=%', v_cnt_before, v_lad_before;

  -- ── UPSERT — 不要假設 row 已存在
  INSERT INTO user_profile_evolution (student_id, session_day_count, last_active_date)
  VALUES (v_sid, v_target_day - 1, NOW() - INTERVAL '1 day')
  ON CONFLICT (student_id) DO UPDATE SET
    session_day_count = v_target_day - 1,
    last_active_date  = NOW() - INTERVAL '1 day',
    updated_at        = NOW();
  -- 注意：寫 N-1、不是 N。chat.js 第一次 chat 時 incrementUserProfileCounters
  --       會 isNewDay=true → +1 → 真正落到 N。

  -- ── AFTER
  SELECT session_day_count, last_active_date
    INTO v_cnt_after, v_lad_after
    FROM user_profile_evolution
   WHERE student_id = v_sid;
  RAISE NOTICE '[AFTER]  session_day_count=% last_active_date=%', v_cnt_after, v_lad_after;
  RAISE NOTICE '════ 跳到 Day % 完成、開 /journey 開始測 ════', v_target_day;

  IF v_cnt_after <> v_target_day - 1 THEN
    RAISE EXCEPTION '⚠️ advance 沒對齊：expected session_day_count=%、actual=%', v_target_day - 1, v_cnt_after;
  END IF;
END $$;

-- ═══ VERIFY：列出該學員當前資產（journey 會讀哪些）═══
-- ★ 改這一行（跟 DO 內 v_sid 對齊）★
SELECT student_id, preferred_name, pace,
       (SELECT session_day_count FROM user_profile_evolution WHERE student_id = 'A001') AS upe_session_day_count,
       (SELECT last_active_date  FROM user_profile_evolution WHERE student_id = 'A001') AS upe_last_active_date,
       (SELECT count(*) FROM sessions   WHERE student_id = 'A001') AS sessions_count,
       (SELECT count(*) FROM damon_notes WHERE student_id = 'A001') AS damon_notes_count
FROM students WHERE student_id = 'A001';
