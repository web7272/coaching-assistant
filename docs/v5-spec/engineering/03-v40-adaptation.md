# v5.0 vs v4.0 工程適配評估（交付物 3/6）

**作者**：Patrick ｜ 2026-05-20 ｜ 給 Claude Code 落地

---

## 0. 核心結論

v5.0 = **v4.0 infra ~70% 繼承 + prompt 結構 ~100% 重寫**。

不是全部從零、也不是補丁——是「**保留管線、換引擎**」。

---

## 1. v4.0 資產繼承度

| v4.0 資產 | 繼承度 | v5.0 處理 |
|---|---|---|
| Anthropic Prompt Caching（ephemeral）| ✅ 100% | 直接用、cached prefix 從 ~9.5K 換成 ~2800 tokens |
| @anthropic-ai/sdk | ✅ 100% | 直接用、+ Haiku 4.5 judge calls |
| migration 010-013（4 表）| ✅ 100% | 保留、+ migration 014（2 新 storage）|
| admin-v4-metrics dashboard | ⚠️ 50% | panel 框架繼承、指標換 v5.0 failure_signals |
| feature_flags toggle | ✅ 100% | + PROMPT_CACHING / INTEGRATION_RETENTION flags |
| Vercel maxDuration 60s | ✅ 100% | 直接用（Haiku judge 200ms 不影響）|
| finalize-day.js | ⚠️ 60% | per-day 結算邏輯繼承、改寫對接 user_profile_evolution |
| **chat.js buildSystemPromptArray** | ⚠️ 30% | 框架思路繼承、內容全重寫（4 引擎 + Checkpoint 1）|
| 守則三 L3 Scope 主路徑 | ❌ 0% | 作廢（v5.0 用 4.7 中央路由器）|
| Cathy 9 週手冊 inject | ❌ 0% | 作廢 |
| Day N 任務 hardcode | ❌ 0% | 作廢（v5.0 用 phase-machine milestone）|
| 工具二 2A/2B/2C 句式池 | ⚠️ 部分 | 2A confirm/evidence_script 繼承、句式池廢、2B requires_typing 機制繼承 |
| 觸發 #1-#10 / 五守則 | ❌ 0% | 作廢（v5.0 用引擎 1-4 + 附錄 A 機制）|

---

## 2. detector framework 新 type 抽象

v4.0 只有「regex match + inline inject」一種 detector。v5.0 需要 5 種 type：

| type | v4.0 有嗎 | v5.0 工程 |
|---|---|---|
| **always_on_cached** | ✅ 有（caching）| 直接用、cached prefix 段落 |
| **conditional_inject** | ✅ 有（v4.0 conditional injection）| 直接套、state 觸發後 inject |
| **detector_only** | ❌ 沒有 | **新建**：純 regex + state mutation、無 inject、token 0 |
| **pipeline** | ❌ 沒有 | **新建**：鏈式（detector → classifier → sub-inject）、引擎 1/2 用 |
| **tool_call** | ❌ 沒有 | **新建**：Haiku 4.5 獨立 call、structured output、4 個 judge |

### 新建抽象的工程位置

```javascript
// lib/detector/registry.js（新建）
// 統一 detector 註冊 + 觸發優先序
registerDetector({ id, type, trigger, priority, handler })

// 觸發順序（引擎間優先序）：
// 1. 引擎 1 master_detector（偏離治理最優先、deviation_handled flag）
// 2. 引擎 3 E3_deep_signal_detector（深訊號）
// 3. 引擎 3 其他子路由器（opening > top1 > status > cascade）
// 4. 引擎 2 master_detector（身份測試、但 deviation_handled 時跳過）
// 5. 引擎 4（new_session_day 開場 / phase 收尾）

// Sequential cascade：任一 fail / handled 就停、避免重複觸發
```

---

## 3. chat.js v5.0 重寫範圍

```
v4.0 chat.js（1773 行）：
  - buildSystemPromptArray（守則三 + Cathy + Day N 任務 + 觸發 #1-10）→ 全砍
  - caching 邏輯 → 保留
  - SDK call → 保留 + 加 Haiku judge

v5.0 chat.js（預估 ~1200-1500 行、比 v4.0 短）：
  - buildSystemPromptArray v5：
    [cached prefix: damon-core + 3 reference] (always_on)
    + [conditional inject: 依 detector registry 觸發的引擎段落]
    + [runtime placeholders: user_profile_snapshot / anchors_top3 / phase context]
  - detector registry 觸發鏈
  - Haiku judge orchestration
  - state-manager read/write
  - phase-machine advance
```

**為什麼 v5.0 比 v4.0 短**：邏輯外移到 lib/ 模組（detector / state / haiku-judge / session）、chat.js 只做 orchestration、不塞所有規則。這就是「prompt 怪獸 → 模組化」的工程體現。

---

## 4. 部署 sequence（給 Vivi、對齊 v4.0 7 步）

```
1. Vercel env：加 ANTHROPIC_API_KEY 確認 Haiku 4.5 access（同 key）
2. git push v5.0 branch（不直接上 main、先 preview deploy）
3. Neon console 跑 migration 014（ALTER sessions + CREATE user_profile_evolution + indexes）
4. Vercel preview deploy verify build pass
5. admin-v5-metrics dashboard verify（failure_signals panels）
6. Admin reset A001 + Day 1 v5.0 重走
7. 21 天 + Cross-day reset 驗證（A001 個人重走）
```

---

## 5. 風險 + 緩解

| 風險 | 緩解 |
|---|---|
| 4 個 Haiku judge 增加 latency | 各 200ms target、Sequential cascade 只在需要時 call、Vercel 60s 充足 |
| Haiku judge cost | 實算 ~$0.07 / Beta 100 學員 21 天、negligible |
| cached prefix ~2800 tokens 增量 | caching 後 ~26% = ~730 equivalent active、vs v4.0 ~5K 大幅降 |
| detector 觸發鏈順序錯 | registry 統一管理優先序 + Sequential cascade、A001 重走驗證 |
| phase 進度跨 day exception 漏 reset / 誤 reset | day-boundary.js 明確 RESET_FIELDS 白名單、phase 欄位不在白名單 |
| state JSONB race condition | state-manager 用 Postgres `||` merge、不整個覆寫 |

---

*— v4.0 適配評估 v0.1 ｜ Patrick ｜ batch 3/6 —*
