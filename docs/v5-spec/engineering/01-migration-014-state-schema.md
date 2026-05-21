# v5.0 Migration 014：State Schema 草案

**作者**：Patrick
**日期**：2026-05-20
**狀態**：草案 v0.1（給 Claude Code 落地）
**來源**：4 引擎 + Checkpoint 1 + Dashboard 全部 session_state / user_profile_evolution 欄位
**前置**：v4.0 migration 010-013 已 deploy（damon_notes / misses / usage_log / feature_flags）

---

## 0. 設計總綱

v5.0 state 分兩個 storage、對應 Cross-day reset policy 的核心判準：

```
session_state（per-session ephemeral）
  → sessions 表加 JSONB column `session_state`
  → 跨 day 部分 reset（transient 判決過程）
  → 學員努力產出的「過程狀態」、Day N+1 fresh

user_profile_evolution（cross-session persistent）
  → 新建 table、user_id PK
  → 跨 day / 跨 session 永不 reset
  → 學員努力產出的「資產」（starter kit、商業承諾）
```

**核心判準**（引擎 4 §3 Cross-day reset framework）：
- 學員努力產出的**資產** → user_profile_evolution（保留）
- 判決過程的 **transient state** → session_state（跨 day reset）

---

## 1. sessions 表延伸

```sql
-- v4.0 sessions 表已存在、加一個 JSONB column
ALTER TABLE sessions
  ADD COLUMN IF NOT EXISTS session_state JSONB NOT NULL DEFAULT '{}'::jsonb;

-- index for state queries (dashboard 監控用)
CREATE INDEX IF NOT EXISTS idx_sessions_state_phase
  ON sessions ((session_state->>'current_phase'));
```

### session_state 完整欄位（per-session、跨 day 依 policy reset）

| 欄位 | 型別 | 來源 | 跨 day reset? | 備註 |
|---|---|---|---|---|
| **引擎 1（對話偏離）** | | | | |
| cumulative_ppl_score | float 0-1 | E1 §3.1 | ✅ reset | 已 lock |
| consecutive_short_responses | int | E1 §3.2 | ✅ reset | |
| consecutive_offtopic_turns | int | E1 §3.3 | ✅ reset | |
| consecutive_vague_turns | int | E1 §3.4 | ✅ reset | |
| recent_specific_examples_count | int (rolling 5) | E1 §3.5 | ✅ reset | |
| bypassing_layer_progress | int 0-6 | E1 §3.7 | ✅ reset | |
| requires_typing_active | bool | E1 §3.8 | ✅ reset | |
| deviation_suspected_this_turn | bool | E1 §4.1 | per-turn | |
| triggered_signals | list | E1 §4.1 | per-turn | |
| explicit_protest_hit | bool | E1 §4.1 | per-turn | |
| deviation_handled_this_turn | str\|null | E1 sub | per-turn | |
| last_ai_question | str | 主框架 | per-turn | |
| last_user_response | str | 主框架 | per-turn | |
| handoff_triggered_count | int | A3 | ✅ reset | |
| **引擎 2（身份測試）** | | | | |
| current_quality_status | enum | E2 §3.1 | ⭐ **reset（errata）** | none/candidate/ambiguous/owned |
| current_quality_candidate_term | str\|null | E2 §3.2 | ✅ reset | |
| identity_test_evidence_count | int | E2 §3.3 | ✅ reset | |
| identity_sentence_pattern_hit | bool | E2 §3.4 | per-turn | |
| pattern_signal_hit | bool | E2 §3.5 | per-turn | |
| identity_signal_suspected_this_turn | bool | E2 §4.1 | per-turn | 補回漏欄位 |
| **引擎 3（中央路由器）** | | | | |
| router_phase | enum | E3 §3.1 | ⭐ **reset（errata）** | 7 enum |
| cascade_down_progress | object\|null | E3 §3.5 | ✅ reset | |
| deep_signal_flags | object | E3 §3.6 | ✅ reset | |
| opening_branch_handled | bool | E3 §3.7 | ✅ reset | |
| elicitation_mode_active | bool | E3 §3.8 | ⭐ **reset（errata）** | 引擎 3 owns 切換 |
| next_action | enum | E3 §6.3 | per-turn | 主框架消費 |
| **引擎 4（主動引用）** | | | | |
| opening_reference_variant_used | enum\|null | E4 §4.2 | ✅ reset | V1-V5 |
| takeaway_seeded_this_session | bool | E4 §4.3 | ✅ reset | |
| **Checkpoint 1（21 天結構）** | | | | |
| current_phase | enum (8) | CP1 §5.1 | ⚠️ **不 reset（exception）** | phase 進度是學員產出 |
| phase_progress | object | CP1 §5.2 | ⚠️ **不 reset（exception）** | phase 切換時 overwrite |
| integration_retention_mode_active | bool | CP1 §5.5 | ⚠️ **不 reset（exception）** | Day 8-21 模式 |
| build_vision_progress | object | CP1 §8.6 | ⚠️ **不 reset（exception）** | Phase 3a 進度 |
| self_concept_progress | object | CP1 §9.8 | ⚠️ **不 reset（exception）** | Phase 3b 進度 |
| counter_examples_list | list | CP1 Turn2 | ⚠️ **不 reset（exception）** | 反例 + 三向歸類結果 |
| mid_session_takeaway_count | int | CP1 §C.2.2 | ✅ reset | |
| **Dashboard（監控）** | | | | |
| amnesia_signal_this_session | bool | DB §2.2 | ✅ reset | |
| e1c_trigger_count_this_session | int | DB §2.3 | ✅ reset | |
| turn_count_this_session | int | DB §2.4 | ✅ reset | |
| hard_limit_hit_this_session | bool | DB §2.4 | ✅ reset | turn >= 40 |

**reset 三分類**：
- ✅ reset：new_session_day 時清零（NLP Amnesia transient state）
- per-turn：every new user turn 重置（不跨 turn）
- ⚠️ 不 reset（exception）：phase 進度欄位、雖在 session_state 但跨 day 保留（學員努力產出）

---

## 2. user_profile_evolution 表（新建）

```sql
CREATE TABLE IF NOT EXISTS user_profile_evolution (
  user_id           INT PRIMARY KEY REFERENCES students(id),

  -- 引擎 2：owned qualities 累積（starter kit 核心）
  anchors                       JSONB DEFAULT '[]'::jsonb,
  quality_focus_history         JSONB DEFAULT '[]'::jsonb,

  -- 引擎 3：values 採集 + 排序
  values_collected_list         JSONB DEFAULT '[]'::jsonb,
  top1_value                    TEXT,
  values_ranking                JSONB DEFAULT '[]'::jsonb,

  -- 引擎 4：跨 session 開場引用素材 + export
  last_session_day_summary      JSONB,
  export_prompt_generated_at    TIMESTAMPTZ,

  -- Checkpoint 1：program 進度 + 回顧素材
  phase_history                 JSONB DEFAULT '[]'::jsonb,
  calendar_day_count            INT DEFAULT 0,
  session_day_count             INT DEFAULT 0,
  program_completed_at          TIMESTAMPTZ,
  topic_refusal_areas           JSONB DEFAULT '[]'::jsonb,

  -- Dashboard：失敗訊號跨 session 累積
  negative_takeaway_count        INT DEFAULT 0,
  consecutive_amnesia_sessions   INT DEFAULT 0,
  e1c_trigger_count_total        INT DEFAULT 0,
  consecutive_hard_limit_sessions INT DEFAULT 0,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_upe_program_completed
  ON user_profile_evolution (program_completed_at);
```

### user_profile_evolution 欄位語意

| 欄位 | 型別 | 來源 | 用途 |
|---|---|---|---|
| anchors | JSONB list | E2 | owned quality 累積、Day N+1 開場引用 |
| quality_focus_history | JSONB list | E2 | quality 升級歷史 [{term, upgraded_at, day, evidence}] |
| values_collected_list | JSONB list | E3 | values 採集累積 |
| top1_value | TEXT | E3 | Top 1（Containment Judgment 確定）|
| values_ranking | JSONB list | E3 | [{value, rank}] Top 1-5 |
| last_session_day_summary | JSONB | E4 | {last_end_phase, last_quality, last_takeaway, ended_naturally, gap_days} |
| export_prompt_generated_at | TIMESTAMPTZ | E4 | 個人教練 prompt 生成時間（Founder bonus）|
| phase_history | JSONB list | CP1 | [{phase, entered, exited, days_used, exit_reason, key_outcomes}] |
| calendar_day_count | INT | CP1 | calendar 天數（gap_days 計算）|
| session_day_count | INT | CP1 | active session 天數（phase enforcement）|
| program_completed_at | TIMESTAMPTZ | CP1 | calendar_day == 21 or 學員主動結束 |
| topic_refusal_areas | JSONB list | CP1 §C.2.1 | 學員拒談主題（避免誤觸）|
| negative_takeaway_count | INT | DB 信號 1 | 累積 3 = critical HITL |
| consecutive_amnesia_sessions | INT | DB 信號 2 | 連續 3 = high HITL |
| e1c_trigger_count_total | INT | DB 信號 3 | >= 5 = high HITL（prompt 對抗性 redesign）|
| consecutive_hard_limit_sessions | INT | DB 信號 4 | 連續 3 = high HITL（4 重組合過嚴）|

---

## 3. Cross-day reset 工程邏輯

`lib/session/day-boundary.js` 偵測 new_session_day、執行 reset：

```javascript
// new_session_day = calendar day 已過 + 學員本日首次發 message
function onNewSessionDay(session_state, user_profile) {
  // 1. 計算 gap_days（calendar day 差）
  const gap_days = calcCalendarDayDiff(user_profile.last_active_date, today);

  // 2. reset transient state（✅ reset 類）
  const RESET_FIELDS = [
    'cumulative_ppl_score', 'consecutive_short_responses',
    'consecutive_offtopic_turns', 'consecutive_vague_turns',
    'recent_specific_examples_count', 'bypassing_layer_progress',
    'requires_typing_active', 'handoff_triggered_count',
    'current_quality_status',      // ⭐ errata
    'current_quality_candidate_term', 'identity_test_evidence_count',
    'router_phase',                // ⭐ errata
    'cascade_down_progress', 'deep_signal_flags', 'opening_branch_handled',
    'elicitation_mode_active',     // ⭐ errata（reset 為 true = 重新採集）
    'opening_reference_variant_used', 'takeaway_seeded_this_session',
    'mid_session_takeaway_count',
    'amnesia_signal_this_session', 'e1c_trigger_count_this_session',
    'turn_count_this_session', 'hard_limit_hit_this_session',
  ];
  RESET_FIELDS.forEach(f => session_state[f] = INITIAL_VALUES[f]);

  // 3. ⚠️ 不 reset 的 phase 進度 exception（保留）
  // current_phase / phase_progress / integration_retention_mode_active /
  // build_vision_progress / self_concept_progress / counter_examples_list
  // → 不動，跨 day 保留

  // 4. user_profile_evolution 全部不 reset（資產）
  user_profile.calendar_day_count += gap_days;  // 對齊 calendar
  // session_day_count 只在 active session 時 +1（不在這裡）

  return { session_state, gap_days };
}
```

**關鍵 errata**（引擎 2/3 v0.1 暫定「不 reset」改為「reset」）：
- current_quality_status → reset（Day N+1 fresh 觀察當前 quality）
- router_phase → reset（Day N+1 重走 opening、不被昨天卡的階段鎖死）
- elicitation_mode_active → reset 為 true（Day N+1 重新進採集模式、但讀 user_profile 持久資產做開場引用）

---

## 4. 跟 v4.0 既有 schema 的關係

| v4.0 table | v5.0 處理 |
|---|---|
| damon_notes（migration 010）| 保留、v5.0 改為「per-session 對話紀錄」、新欄位 quality 結構對齊 user_profile_evolution |
| prompt_engineering_misses（011）| 保留、v5.0 dashboard failure_modes 紀錄沿用 |
| chat_usage_log（012）| 保留、v5.0 加 Haiku judge call 計數 |
| feature_flags（013）| 保留、v5.0 加 PROMPT_CACHING / INTEGRATION_RETENTION flags |

→ v5.0 是「v4.0 infra + 2 個新 storage（sessions.session_state + user_profile_evolution）」、不是全部重建。

---

## 5. 給 Claude Code 的落地指示

1. migration 014 SQL 手動跑 Neon console（順序：ALTER sessions → CREATE user_profile_evolution → indexes）
2. `lib/session/state-manager.js`：session_state 讀寫 helper（getState / updateState / resetTransient）
3. `lib/session/day-boundary.js`：new_session_day 偵測 + onNewSessionDay reset
4. JSONB 操作用 Neon Postgres `jsonb_set` / `||` merge、避免整個 object 覆寫造成 race
5. user_profile_evolution upsert pattern（`INSERT ... ON CONFLICT (user_id) DO UPDATE`）

---

## 變更摘要

```
+ sessions.session_state JSONB（~35 session-scoped 欄位）
+ user_profile_evolution 表（16 user-scoped 欄位）
+ Cross-day reset policy 工程邏輯（lib/session/day-boundary.js）
+ errata：current_quality_status / router_phase / elicitation_mode_active 跨 day reset
+ phase 進度 6 欄位 exception（session_state 但不 reset）
```

---

*— migration 014 草案 v0.1 ｜ Patrick ｜ 2026-05-20 ｜ batch 工程交付物 1/6 —*
