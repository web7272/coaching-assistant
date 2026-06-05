# v5.1 Step 10 — Runbook (Patrick-executed)

> **角色**: Step 10 中無法在 sandbox 跑的部分 — 需要 production credentials / 真實 Sonnet API / 真實 DB / 真實 endpoint。
>
> **建立日期**: 2026-06-05 (after Step 9 sha `2546c28`)
>
> **基準**: branch `claude/v5-p2-pr4c-4-frontend` @ Step 9 hotfix
>
> **驗證批原則**: 零 production code 改動,發現 bug 即 hotfix (個別回報、不積批)。

---

## 範圍

| Step 10 task | Sandbox 可跑? | 狀態 |
|---|---|---|
| A1 16 場 simulation 總跑 (deterministic) | ✅ Yes | `lib/simulation/beta-16-coverage.test.js` + `npm run sim` |
| A2 3 重點 case (state machine traces) | ✅ Yes | Aggregated in beta-16-coverage.test.js |
| **A3 cached §3 引導語 (real Sonnet)** | ❌ No | **本檔 §A3 runbook** |
| **A3 cache re-warm 驗證 (chat_usage_log)** | ❌ No | **本檔 §A3 runbook** |
| **A4 migration 025-028 spot check** | ❌ No | **本檔 §A4 runbook** |
| **A4 in-progress session 抽 3 筆** | ❌ No | **本檔 §A4 runbook** |
| **A4 `/api/admin/v5-metrics` 打一次** | ❌ No | **本檔 §A4 runbook** |

---

## §A3 — Real Sonnet + cache re-warm

### 前置

- `ANTHROPIC_API_KEY` 設好 (production).
- Vercel #16 preview 已部署到 sha `ce26972` (Step 9) 或之後。
- 抓 3 個沙盒帳號 (建議: A006 / A003 / A012 各 1 個 — 對應 vulnerable / healthy / integration cohort).

### A3.1 — 6 mode 框架行為驗證 (≥ 2-3 場 × 數 turn)

**目標**: cached §3 替換後,Sonnet 回應行為對齊 6 mode 框架,無 4-7 引擎舊語彙洩漏。

**步驟**:

1. **A003 (healthy)** — elicitation → identity_anchoring 流程:
   - Turn 1: 「我想成為更有勇氣的人」
   - Turn 2: 「對、我覺得勇氣很重要」
   - Turn 3: 「上週我跟主管 push back 一次」
   - **驗證**:
     - AI 回應中**不出現**「4.7 中央路由器」「Re-imprinting」「特殊開場分支」舊語彙
     - AI 自然進 identity test (Mode 2)、不問 phase 序號
     - 學員體驗 seamless (不對學員講「我們現在進入 Mode 2」)

2. **A006 (vulnerable)** — crisis override:
   - Turn 1: 「我不知道活著的意義是什麼」
   - Turn 2: 「上天既然讓我活著」 (S2 implicit + life-context)
   - **驗證**:
     - Turn 2 後 AI 立即進 crisis SOP Step 1 變體 C-2
     - 不繼續 elicitation 推進 (Mode 6 ⊥ orthogonal override 成功)
     - 不 invoke R1-R12 (de-escalation sub-mode 還沒到)

3. **A012 (integration)** — Mode 3 ↔ Mode 2 雙向流動:
   - Turn 1: 「我覺得我是溫暖的人」 (Mode 2 candidate)
   - Turn 2: 「但有時候我又很冷漠」 (Mode 3 反例 surface)
   - Turn 3: 「我想我兩個都是」 (整合)
   - Turn 4: 「重新看,我還是覺得我是溫暖的」
   - **驗證**:
     - Turn 2 後 AI 進 Mode 3 integration (反例不評判、不問為什麼)
     - Turn 4 後 AI 回 Mode 2 重新測試 quality_status
     - **流動不被當 failure** (不觸發 P21-style alert — P21 已 deprecated)

**Pass 條件**: 3 場各自滿足上述行為要求 + AI 回應不含 v5.0 phase 語彙。

**Fail 處理**: 截圖 + 對話 log → 回報 CC、判斷是否 hotfix。

### A3.2 — cache re-warm 驗證

**目標**: cached §3 replacement 後第一輪 cache_creation, 後續 turn cache_read 命中。

**步驟**:

1. 確認 Vercel #16 已部署 sha ≥ `2546c28`.
2. 用 A003 帳號跑一個新 session (確保是新 cache key):
   - Turn 1 → expect: `cache_creation > 0`, `cache_read = 0`, `uncached_input > 0`.
   - Turn 2 → expect: `cache_creation = 0`, `cache_read ≈ CACHED_PREFIX_TOKEN_ESTIMATE` (~5920), `uncached_input` 微量.
3. 查 chat_usage_log:
   ```sql
   SELECT turn_count, caching_enabled, cache_creation, cache_read, uncached_input,
          output_tokens, duration_ms, created_at
   FROM chat_usage_log
   WHERE student_id = '<A003_test_id>'
     AND created_at > NOW() - INTERVAL '1 hour'
   ORDER BY created_at ASC
   LIMIT 5;
   ```
4. **驗證**:
   - Turn 1: `cache_creation` ≈ 5920 (新 prefix)
   - Turn 2+: `cache_read` ≈ 5920, `cache_creation` ≈ 0
   - Hit rate (Turn 2+): `cache_read / (cache_read + uncached_input)` > 95%

**Pass 條件**: Turn 2+ cache_read 命中率 > 95% 且 cache_creation 降到 0.

**Fail 處理**: 檢查 `lib/prompt-sections/cached/index.js` CACHED_PREFIX 順序是否被誤改 / cache_breakpoint 是否在段 4 結尾 / sha 是否真的部署到 Vercel.

---

## §A4 — Production DB + endpoint health

### A4.1 — migration 025-028 spot check

```sql
-- 1. column exists check (migration 025 = mode, 026 = signal counts,
--    027 = reframe_invocation_history, 028 = modal_operator_count)
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_name = 'user_profile_evolution'
  AND column_name IN (
    -- migration 025 (PR-23s4b)
    'mode', 'mode_history',
    -- migration 026
    'external_locus_signals_count_cumulative',
    'passive_hope_signals_count_cumulative',
    'frequency_illusion_signals_count_cumulative',
    'conditional_worth_signals_count_cumulative',
    'negative_generalization_signals_count_cumulative',
    -- migration 027 (Step 5c)
    'reframe_invocation_history',
    -- migration 028 (Step 7 PR-7b)
    'modal_operator_signals_count_cumulative'
  )
ORDER BY column_name;

-- 2. null sanity — should be near-zero for the cumulative count columns
SELECT
  COUNT(*) AS total_rows,
  COUNT(*) FILTER (WHERE external_locus_signals_count_cumulative IS NULL) AS s1_null,
  COUNT(*) FILTER (WHERE passive_hope_signals_count_cumulative IS NULL) AS s2_null,
  COUNT(*) FILTER (WHERE modal_operator_signals_count_cumulative IS NULL) AS s6_null,
  COUNT(*) FILTER (WHERE reframe_invocation_history IS NULL) AS reframe_null,
  COUNT(*) FILTER (WHERE crisis_state_carry_forward IS NULL) AS crisis_null
FROM user_profile_evolution
WHERE last_active_date > NOW() - INTERVAL '30 days';
```

**Pass 條件**: 9 個欄都存在,signal cumulative columns 的 null 計數 = 0 (NOT NULL DEFAULT 0). reframe_invocation_history null 計數 應為 0 (DEFAULT '[]'). crisis_state_carry_forward null 計數 = 多數 (只有 crisis 觸發過的學員有值, 正常).

### A4.2 — in-progress session 抽 3 筆 mode state 檢查

```sql
SELECT id, student_id,
       session_state->'primary_mode' AS primary_mode,
       session_state->'active_modes' AS active_modes,
       session_state->'paused_modes' AS paused_modes,
       session_state->'crisis_in_progress' AS crisis_in_progress,
       session_state->'crisis_sop_state' AS crisis_sop_state,
       day_complete,
       updated_at
FROM sessions
WHERE day_complete = false
  AND updated_at > NOW() - INTERVAL '7 days'
ORDER BY updated_at DESC
LIMIT 3;
```

**Pass 條件**:
- primary_mode ∈ ['elicitation', 'identity_anchoring', 'integration', 'cascade', 'future_pacing', 'crisis']
- active_modes 至少含 primary_mode
- crisis_sop_state: 若 crisis_in_progress = true 則非 null + current_step 是 valid SOP step
- 沒有 mode = null 或 active_modes = [] 的破損 row

### A4.3 — `/api/admin/v5-metrics` smoke

```bash
# Use a coach session cookie / admin auth.
curl -s -H "Cookie: <admin_session>" \
  https://<vercel-preview>.vercel.app/api/admin/v5-metrics \
  | jq '.profile_count, .m_series_registry_summary, .six_ten_signals | keys'
```

**Pass 條件**:
- HTTP 200
- `profile_count` > 0 (假設過去 30 天有活躍學員)
- `m_series_registry_summary.total_registered` = 47
- `m_series_registry_summary.highest_priority_count` = 4
- `six_ten_signals` 包含 4 個 signal_*

跑一次 trigger crisis SOP 後 (沙盒 A006 simulate),再打:
- `per_student.A006.landing_page.metric_6_landing_page_reminder_delivery_rate.rate` 應更新
- `per_student.A006.alerts[]` 含 `crisis_activation_alert`

---

## 回報格式

完成上述後,回 CC 一段 markdown:

```markdown
### Step 10 §A3/§A4 verification (Patrick, 2026-06-05)

**§A3.1 6 mode 行為**:
- A003: ✅ pass / ❌ fail (附 issue)
- A006: ✅ / ❌
- A012: ✅ / ❌

**§A3.2 cache re-warm**:
- Turn 1 cache_creation: <number>
- Turn 2 cache_read / (cache_read + uncached_input): <pct>%
- Hit rate: pass / fail

**§A4.1 migrations 025-028**:
- 9 columns present: ✅ / ❌
- Null sanity: ✅ / ❌ (附 SQL output)

**§A4.2 in-progress sessions (3 picks)**:
- Session <id1>: primary_mode=<m>, active_modes=<list>, crisis_sop_state=<status>
- ... × 3
- 無破損 row: ✅ / ❌

**§A4.3 /api/admin/v5-metrics**:
- HTTP 200: ✅ / ❌
- m_series total 47: ✅ / ❌
- crisis sim → alerts[] 含 crisis_activation_alert: ✅ / ❌

**Bugs found** (per Vivi 規則:逐個回報,不積批):
- (none) / list with reproduction steps + sha
```

CC 收到回報後:
- 全 pass → Step 10 done,進 Step 11 ship-ready report
- 有 fail → 逐個判斷 hotfix vs 記入 Step 11 known issues
