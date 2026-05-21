# v5.0 Claude Code Handoff Prompt（交付物 6/6）

**作者**：Patrick ｜ 2026-05-20
**用途**：給 Claude Code 的完整 v5.0 落地任務 brief
**前置**：交付物 1-5 + 設計師 8 文件（7587 行 spec + 925 行 dashboard）

---

## 0. 任務總綱（給 Claude Code）

```
你要把 See Yourself 的 coaching app 從 v4.0 升級到 v5.0。

v5.0 = Damon Cart 自我概念方法論的完整重寫：
- 4 個 prompt 引擎（對話偏離 / 身份測試 / 中央路由器 / 主動引用）
- 21 天 daily session 結構（5 Phase + Integration Retention Mode）
- 12 個 lib/ 模組 + 4 個 Haiku judge + 3 新 detector type
- 2 個新 storage（sessions.session_state + user_profile_evolution）

核心原則：v4.0 infra 保留（~70%）、prompt 結構全重寫（~100%）。
不是補丁、是「保留管線、換引擎」。

source of truth：
- 設計 spec：/employees/patrick/prompt-design/v5.0/（設計師 8 文件）
- 工程 spec：/employees/patrick/prompt-design/v5.0/engineering/（交付物 1-5）
```

---

## 1. 落地優先序

### P0 — 基礎建設（其他全依賴）

```
1. migration 014（交付物 1）
   - ALTER sessions ADD session_state JSONB
   - CREATE user_profile_evolution table
   - 手動跑 Neon console、verify

2. lib/state/state-manager.js
   - session_state JSONB CRUD（Postgres || merge、不整個覆寫）
   - user_profile_evolution upsert（ON CONFLICT DO UPDATE）

3. lib/session/day-boundary.js
   - new_session_day 偵測 + onNewSessionDay reset
   - RESET_FIELDS 白名單（交付物 1 §3、phase 進度欄位不在白名單）

4. lib/haiku-judge/_base.js
   - @anthropic-ai/sdk Haiku 4.5 client
   - structured output + 200ms timeout fallback
```

### P1 — 引擎核心

```
5. lib/haiku-judge/ 4 instances
   - sensory-detail.js（A1、3 dimension：markers + attribution + derived）
   - depth-signal.js（A4）
   - containment-logic.js（A5）
   - takeaway-sentiment.js（A6）

6. lib/state/ 3 機制
   - requires-typing.js（A1 物理防護）
   - cumulative-score.js（A2 通用模板 + ppl-score instance）
   - handoff-escalation.js（A3）

7. lib/session/phase-machine.js
   - current_phase（8 enum）↔ router_phase（7 enum）transition map
   - advancePhase + entry/exit conditions

8. lib/detector/registry.js（新建抽象）
   - 5 type：always_on_cached / conditional_inject / detector_only / pipeline / tool_call
   - Sequential cascade 觸發優先序（交付物 3 §2）
```

### P2 — Prompt + chat.js 重寫

```
9. lib/prompt-sections/cached/
   - damon-core-philosophy.js（交付物 5 §3、完整文字）
   - 5-layer-unwrap.js（搬引擎 1 §4.1）
   - 4-7-router.js（搬引擎 3 §4.1）
   - active-reference-styles.js（搬引擎 4 §5.1）

10. lib/prompt-sections/conditional/
    - engine-1/ ~ engine-4/ + checkpoint-1/（搬設計師 8 文件各 sub-prompt 話術）

11. api/chat.js v5.0 重寫
    - buildSystemPromptArray v5（cached prefix + dynamic + conditional）
    - cache_control breakpoint（交付物 4 §1）
    - detector registry 觸發鏈
    - Haiku judge orchestration
    - state-manager + phase-machine 整合

12. api/finalize-day.js 改寫（對接 user_profile_evolution）
13. admin-v5-metrics dashboard（failure_signals panels）
14. frontend：export prompt download UI + day boundary 處理
```

---

## 2. 部署 sequence（7 步、給 Vivi 手動）

```
1. Vercel env verify ANTHROPIC_API_KEY（Haiku 4.5 同 key）
2. git push v5.0 branch（preview deploy、不直接 main）
3. Neon console 跑 migration 014（ALTER → CREATE → indexes）
4. Vercel preview deploy verify build pass
5. admin-v5-metrics verify failure_signals panels render
6. Admin reset A001 + Day 1 v5.0 重走
7. 21 天 + Cross-day reset 驗證（A001 個人重走）
```

---

## 3. 驗收測試（A001 v5.0 重走 checklist）

### Day 1（4 引擎基礎）
- [ ] 開場走 Values Elicitation（不是 v4.0 守則三）
- [ ] 鏈式追問用「擁有這個對你有什麼重要」（不問 Why）
- [ ] 講外部目標（如「等 APP 上架」）→ 觸發完美主義防護 / 後退球門挑戰
- [ ] 講身份詞「鑽石」單獨命中**不**升級（G2 防護、需伴隨身份句）
- [ ] confirm 走 A1 Haiku judge（self-evidence + ≥ 2 markers、不是「是」一字過關）

### Day 2-3（Cross-day reset + 主動引用）
- [ ] Day 2 開場非機械引用（5 變體之一、不是「那句話還在嗎」）
- [ ] Day 3 開場讀 user_profile 持久資產 + transient state 已 reset
- [ ] 學員抗議（「鬼打牆」「你重複了」）→ explicit_protest → handoff_escalation（不軟接續）
- [ ] takeaway sentiment 偵測（A6、negative 累積監控）

### 結構驗證
- [ ] phase-machine 推進正確（phase_1 → phase_2 → ...）
- [ ] cached prefix cache hit（chat_usage_log cached vs uncached）
- [ ] active state 穩態 < 1.5K dynamic
- [ ] 4 個 Haiku judge call 正常、latency < 300ms

### Integration Retention（若 A001 提早完成）
- [ ] Day 8 完成 5 phase → integration_retention_mode_active = true
- [ ] retention 期間 reinforce 不 explore（不挖新 quality）
- [ ] Day 21 export prompt 二次更新

---

## 4. 風險 + 注意（交付物 3 §5）

| 風險 | 緩解 |
|---|---|
| detector 觸發鏈順序錯 | registry 統一優先序、A001 重走逐項驗證 |
| phase 進度跨 day 誤 reset | RESET_FIELDS 白名單嚴格、phase 欄位不在內 |
| state JSONB race | Postgres `||` merge、不整個覆寫 |
| Haiku judge 超時 | 200ms timeout → 降級主對話 LLM inline judge |
| cached prefix 沒 hit | breakpoint 在段落 4 結尾、4 段落順序固定 |

---

## 5. 工程速度預估

```
P0 基礎建設：1-2 天
P1 引擎核心：2-3 天
P2 prompt + chat.js 重寫：3-4 天
─────────────────────
總計：6-8 天（單一 Claude Code）
可並行：開 2 worktree（P0+P1 / P2 prompt-sections）壓到 4-5 天
```

---

## 6. 給 Claude Code 的起手指示

```
1. 先讀設計師 8 文件（理解 spec source of truth）
2. 再讀交付物 1-5（工程 spec）
3. 從 P0 開始、嚴格按優先序
4. 每完成一個 lib 模組、寫 unit test（特別 day-boundary reset / phase-machine transition）
5. chat.js 重寫前、先把 lib/ 全部 ready + 跑通
6. 用 GitHub API verify PR state（不假設 push == merged，v4.0 教訓）
7. 卡住 / 不確定 spec → ping Patrick，不自己猜方法論
```

---

*— Claude Code handoff prompt v0.1 ｜ Patrick ｜ batch 6/6 完成 —*
*v5.0 工程交付物全部 ship、等 Vivi 給 Claude Code 落地*
