-- Migration 014: v5.0 state schema
-- 對齊：docs/v5-spec/engineering/01-migration-014-state-schema.md
-- 內容：
--   (1) ALTER sessions ADD session_state JSONB（per-session ephemeral state）
--   (2) CREATE user_profile_evolution（cross-session persistent assets）
-- errata 5/21（PR-2）：
--   spec v0.1 寫 user_id INT REFERENCES students(id)
--   實際 students PK 是 student_id TEXT（格式 'A001'...）、沒有 students.id
--   → 對齊現實：student_id TEXT PRIMARY KEY REFERENCES students(student_id)
-- 前置：v4.0 migrations 010-013 已 deploy

-- 1. 跑前狀態
SELECT 'BEFORE' AS stage,
       (SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name='sessions' AND column_name='session_state') AS session_state_col_exists,
       (SELECT COUNT(*) FROM information_schema.tables
        WHERE table_schema='public' AND table_name='user_profile_evolution') AS upe_table_exists;

-- 2. ALTER sessions ADD session_state JSONB
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS session_state JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 3. Index for state queries（dashboard 監控用）
CREATE INDEX IF NOT EXISTS idx_sessions_state_phase
  ON sessions ((session_state->>'current_phase'));

-- 4. CREATE user_profile_evolution
CREATE TABLE IF NOT EXISTS user_profile_evolution (
  student_id  TEXT PRIMARY KEY REFERENCES students(student_id),

  -- 引擎 2：owned qualities 累積（starter kit 核心）
  anchors                JSONB DEFAULT '[]'::jsonb,
  quality_focus_history  JSONB DEFAULT '[]'::jsonb,

  -- 引擎 3：values 採集 + 排序
  values_collected_list  JSONB DEFAULT '[]'::jsonb,
  top1_value             TEXT,
  values_ranking         JSONB DEFAULT '[]'::jsonb,

  -- 引擎 4：跨 session 開場引用素材 + export
  last_session_day_summary    JSONB,
  export_prompt_generated_at  TIMESTAMPTZ,

  -- Checkpoint 1：program 進度 + 回顧素材
  phase_history         JSONB DEFAULT '[]'::jsonb,
  calendar_day_count    INT DEFAULT 0,
  session_day_count     INT DEFAULT 0,
  program_completed_at  TIMESTAMPTZ,
  topic_refusal_areas   JSONB DEFAULT '[]'::jsonb,

  -- Dashboard：失敗訊號跨 session 累積
  negative_takeaway_count          INT DEFAULT 0,
  consecutive_amnesia_sessions     INT DEFAULT 0,
  e1c_trigger_count_total          INT DEFAULT 0,
  consecutive_hard_limit_sessions  INT DEFAULT 0,

  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Index for completed programs
CREATE INDEX IF NOT EXISTS idx_upe_program_completed
  ON user_profile_evolution (program_completed_at);

-- 6. 驗證 sessions.session_state column
SELECT 'AFTER sessions.session_state' AS stage, column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name='sessions' AND column_name='session_state';

-- 7. 驗證 user_profile_evolution columns
SELECT 'AFTER user_profile_evolution columns' AS stage, column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name='user_profile_evolution'
ORDER BY ordinal_position;

-- 8. 驗證 indexes
SELECT 'AFTER indexes' AS stage, indexname, tablename
FROM pg_indexes
WHERE indexname IN ('idx_sessions_state_phase', 'idx_upe_program_completed');

-- 預期：
--   sessions.session_state 1 row（jsonb / default '{}'::jsonb / NOT NULL）
--   user_profile_evolution 18 columns（student_id PK + 16 spec cols + created_at + updated_at）
--   indexes 2 row（idx_sessions_state_phase + idx_upe_program_completed）
