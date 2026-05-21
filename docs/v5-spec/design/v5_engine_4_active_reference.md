# v5.0 引擎 4:AI 主動引用機制(Active Reference Engine)

> **文件用途**:Checkpoint 2 第四個 / 最後交付件。Patrick 工程端接此檔做引擎 1+2+3+4 合併完整 ship。
>
> **建立日期**:2026-05-19
>
> **對應方法論**:`damon_methodology.md` 章節 6.7(AI 主動引用機制設計)、6.8(gap_days 分級處理)、6.9 #5(NLP Amnesia 主動整合機制、v5.0 原創 IP)、Damon「Future Pacing 隔天做」原則
>
> **對應 TODO**:`v5_next_actions.md` TODO 1 第一優先級 prompt 引擎 #4
>
> **版本**:設計師對話版(v0.1)。Patrick 24h 內提交 ship 版草稿。
>
> **依賴關係**:依賴引擎 1+2+3 全部已 ship。引擎 4 是引擎 1-3 的「**消費端**」——讀取 user-scoped 資產、生成主動引用 / takeaway / export。

---

## ⚠️ 範圍 Warning

本檔範圍包含:
- ✅ Day N+1 開場主動引用機制(5 變體 + LLM judge 動態挑)
- ✅ 跨 day reset framework(closed loop、最終一致決策)
- ✅ takeaway 種下機制(end-of-session + 跨 quality 升級)
- ✅ Cascade Down 後的引用方式(讀 values_ranking)
- ✅ E4_export_personal_coach_prompt(Founder bonus、Day 21 個人教練 prompt)

本檔範圍**不包含**:
- ❌ Build Vision / Self-Concept 內部執行(Checkpoint 1)
- ❌ Day 21 何時觸發 export 的流程整合(Checkpoint 1)
- ❌ Future Pacing 完整 SOP(屬 Checkpoint 1 Phase 5)——本檔只 spec 引用面、不 spec 執行面

---

## ⚠️ Errata(引擎 2 / 引擎 3 跨 day reset 修正)

本檔 §3「Cross-day reset policy(closed loop)」定義完整 framework 後、以下 3 個欄位的 v0.1 暫定「不 reset」**修正為 reset on new_session_day**:

| 欄位 | 原檔位置 | 修正 |
|---|---|---|
| `current_quality_status` | 引擎 2 §3.1 | `reset_on:` 追加 `new_session_day` |
| `router_phase` | 引擎 3 §3.1 | `reset_on:` 追加 `new_session_day` |
| `elicitation_mode_active` | 引擎 3 §3.8 | `reset_on:` 追加 `new_session_day` |

Patrick migration 014 草案直接以本檔 §3 framework 為準、不依賴引擎 2/3 原檔。

---

## 目錄

1. [架構總覽](#1-架構總覽)
2. [Token Budget](#2-token-budget)
3. [Cross-day reset policy(closed loop)](#3-cross-day-reset-policy)
4. [Session State Fields](#4-session-state-fields)
5. [元件 spec](#5-元件-spec)
   - 5.1 cached_active_reference_styles(cached prefix)
   - 5.2 E4_day_opening_reference_selector(Day N+1 開場、5 變體)
   - 5.3 E4_takeaway_planter(end-of-session takeaway 種下)
   - 5.4 E4_cascade_down_reference(Cascade Down 後的引用)
   - 5.5 E4_export_personal_coach_prompt(Founder bonus)
6. [跨引擎合約](#6-跨引擎合約)
7. [Patrick 接手清單](#7-patrick-接手清單)
8. [Forward References](#8-forward-references)
9. [Checkpoint 2 收尾總結](#9-checkpoint-2-收尾總結)

---

## 1. 架構總覽

引擎 4 採 **cached prefix + 4 個子組件** 架構,沿用引擎 1+3 設計語言。

```
┌──────────────────────────────────────────────────────────────────┐
│ Layer 0: cached prefix(永久載入、~26% baseline cost)              │
│ ─ cached_active_reference_styles (~800 tokens)                   │
│   - Damon 引用風格原則(不機械、有方向性、不問「還在嗎」)            │
│   - 5 變體話術骨架完整定義                                          │
│   - gap_days 分級處理範本(對應方法論 6.8)                          │
│   - NLP Amnesia 主動整合機制邏輯(v5.0 原創 IP #5)                  │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ 4 個子組件(按觸發時機分、非互斥)                                     │
└──────────────────────────────────────────────────────────────────┘

子組件 1:E4_day_opening_reference_selector(~230 tokens)
   觸發:new_session_day == true、本日首次 user message
   動作:讀 user-scoped 持久資產、LLM judge 挑 5 變體之一、生成開場引用

子組件 2:E4_takeaway_planter(~200 tokens)
   觸發:end-of-session(soft/hard 上限 / 學員主動結束 / quality upgrade owned)
   動作:complete 3 步收尾(複述 → 身份測試 / 確認 / takeaway 種下)

子組件 3:E4_cascade_down_reference(~180 tokens)
   觸發:E3_cascade_down_validator 進入 Top 2 / Top 3 測試前
   動作:生成「Top 1 已 owned、現在看 Top 2」的過渡引用

子組件 4:E4_export_personal_coach_prompt(~250 tokens)
   觸發:Day 21(由 Checkpoint 1 觸發、本引擎只 spec 機制)
   動作:讀全部 user-scoped 資產、生成個人教練 prompt Markdown
```

### 設計原則

1. **消費端、不是判決端**:引擎 4 不做路由 / 不做分類、只「**讀資產 + 生成引用**」
2. **不機械、有方向性**:Day N+1 開場不問「還在嗎」(A001 Day 2 災難)、永遠帶方向
3. **NLP Amnesia + 主動引用並存**:user-scoped 資產保留(學員努力產出)+ session-scoped transient state reset(fresh 觀察判決過程)
4. **5 變體 + LLM judge 動態挑**:不寫死 template、依 gap_days + 昨天結束狀態 + 今天開場語氣動態挑
5. **export 是商業 IP 核心**:Founder bonus、Markdown 格式可貼到外部 LLM、含個人化資產 + Damon-style 風格指引

---

## 2. Token Budget

### Max simultaneous active state

| 元件 | type | tokens | 計入 active? |
|---|---|---|---|
| cached_active_reference_styles | always_on_cached | ~800 | ❌(cached prefix、~26% baseline cost) |
| E4_day_opening_reference_selector | conditional_inject | ~230 | ✅(僅 new_session_day 觸發) |
| E4_takeaway_planter | conditional_inject | ~200 | ✅(僅 end-of-session 觸發) |
| E4_cascade_down_reference | conditional_inject | ~180 | ✅(僅 Cascade Down 觸發) |
| E4_export_personal_coach_prompt | conditional_inject | ~250 | ✅(僅 Day 21 觸發、極稀觸發) |

**Max simultaneous active**:4 個子組件**完全互斥**(不同觸發時機)= **~250 tokens**(最大子組件)

### 引擎 1+2+3+4 同 turn 最壞情境

理論上限:E1(~270) + E2(~280) + E3(~280) + E4(~250)= ~1080 tokens

實際互斥概率**極高**:
- E4_day_opening 觸發 = new_session_day、E1 不會有偏離訊號累積、E2 不會有 quality 候選
- E4_takeaway_planter 觸發 = end-of-session、其他引擎已 fade out
- E4_cascade_down 觸發 = E3_cascade_down_validator 同 turn 觸發,但兩者**串聯**(E3 觸發 → E4 inject)、共享 E3 已載入的 cached context

→ **穩態 max simultaneous ~280-300** ✅ 遠低於 5-6K active state budget

### Cached prefix 累計(引擎 1+3+4)

| Cached | tokens | 引擎 |
|---|---|---|
| cached_5_layer_unwrap_reference | ~600 | 引擎 1 |
| cached_4_7_router_reference | ~1400 | 引擎 3 |
| cached_active_reference_styles | ~800 | 引擎 4 |
| **合計 cached** | **~2800** | ~26% baseline cost ≈ ~730 equivalent active |

---

## 3. Cross-day reset policy(closed loop)

> **本章節是 4 引擎跨 day 狀態 reset 的最終一致決策**。引擎 2 §3.1 / 引擎 3 §3.1 §3.8 v0.1 暫定狀態以本章節為準(見頂部 Errata)。

### 3.1 核心 framework

NLP Amnesia 機制(方法論 6.6)說「Day N+1 fresh 觀察」、AI 主動引用機制(方法論 6.7)說「Day N+1 引用昨天的詞」——**兩條不矛盾**,因為它們對「應該記住 vs 應該 fresh」的範圍不同。

**核心判準**:
- **學員努力產出的資產** → 跨 day **保留**(學員拿走的 starter kit、商業承諾)
- **判決過程的 transient state** → 跨 day **reset**(NLP Amnesia 要求 Day N+1 fresh)

### 3.2 完整欄位 reset 對照表

#### A. 跨 day **保留**(user-scoped、寫入 `user_profile_evolution`)

| 欄位 | 引擎來源 | 理由 |
|---|---|---|
| `user_profile_evolution.anchors` | E2 §3.6 | 學員 owned quality 累積(starter kit 核心) |
| `user_profile_evolution.quality_focus_history` | E2 §3.6 | quality 升級歷史(Day N+1 開場引用素材) |
| `user_profile_evolution.values_collected_list` | E3 §3.2 | values 採集累積 |
| `user_profile_evolution.top1_value` | E3 §3.3 | Top 1 確定後、不變 |
| `user_profile_evolution.values_ranking` | E3 §3.4 | 排序 Top 1-5(Cascade Down 後續使用) |

#### B. 跨 day **reset**(session-scoped、寫入 sessions JSONB)

| 欄位 | 引擎來源 | reset 理由 |
|---|---|---|
| `session_state.cumulative_ppl_score` | E1 §3.1 | 已 lock(不變) |
| `session_state.consecutive_short_responses` | E1 §3.2 | 已 lock |
| `session_state.consecutive_offtopic_turns` | E1 §3.3 | 已 lock |
| `session_state.consecutive_vague_turns` | E1 §3.4 | 已 lock |
| `session_state.bypassing_layer_progress` | E1 §3.7 | 已 lock |
| `session_state.requires_typing_active` | E1 §3.8 | 已 lock |
| `session_state.current_quality_status` | E2 §3.1 | ⭐ Errata:從 v0.1「不 reset」修正 |
| `session_state.current_quality_candidate_term` | E2 §3.2 | 對應 status reset |
| `session_state.identity_test_evidence_count` | E2 §3.3 | 已 lock |
| `session_state.router_phase` | E3 §3.1 | ⭐ Errata:從 v0.1「不 reset」修正 |
| `session_state.cascade_down_progress` | E3 §3.5 | 已 lock |
| `session_state.deep_signal_flags` | E3 §3.6 | 已 lock |
| `session_state.opening_branch_handled` | E3 §3.7 | 已 lock |
| `session_state.elicitation_mode_active` | E3 §3.8 | ⭐ Errata:從 v0.1「不 reset」修正 |
| `session_state.recent_specific_examples_count` | E1 §3.5 | 已 lock |
| `session_state.handoff_triggered_count` | A3 | 已 lock |

#### C. 跨 day **新增**(本檔引擎 4 自生)

見 §4 Session State Fields(引擎 4 自生欄位)。

### 3.3 new_session_day 定義 — Patrick 工程合約

```yaml
new_session_day:
  definition: |
    calendar day 已過 + 學員本日首次發 message
  
  examples:
    - 學員 Day 1 中午離開、晚上回來:同一 calendar day、不算 new day
    - 學員 Day 2 早上打開:calendar day 已過、算 new day
    - 學員 Day 5 打開、Day 2-4 都沒上來:算 new day、gap_days = 4
  
  gap_days_calculation: |
    對齊 calendar day(Day 2 - Day 1 = 1、Day 5 - Day 1 = 4)
  
  engineering_implementation: ⚙️ Patrick
    files_estimated:
      - "lib/session/day-boundary.js"
```

### 3.4 Day N+1 開場觸發鏈

```
new_session_day == true(本日首次 user message)
    ↓
觸發 E4_day_opening_reference_selector(本檔 §5.2)
    ↓
讀 user_profile_evolution.* 持久資產
    ↓
LLM judge 挑 5 變體之一(依 gap_days + 昨天結束狀態 + 今天開場語氣)
    ↓
生成開場引用 + 提問
    ↓
學員回應
    ↓
session_state.* transient state 已全 reset、引擎 1-3 從 fresh 重新評估
```

→ **NLP Amnesia 落地**:學員拿到引用、但 AI 不被前一天狀態鎖死。

---

## 4. Session State Fields

引擎 4 新增的 session_state 欄位。

### 4.1 last_session_day_summary

```yaml
session_state.last_session_day_summary:
  range: object {
    last_session_end_phase: str,  # 昨天 session 結束時的 router_phase
    last_quality_focus: str | null,  # 昨天主要挖的 quality
    last_takeaway_term: str | null,  # 昨天 takeaway 種下的 anchor
    last_session_ended_naturally: bool,  # true=自然完成 / false=hard limit 強制收尾
    gap_days: int  # 距今日的 calendar day 差
  }
  initial_value: null
  scope: user-scoped(寫入 user_profile_evolution、跨 session 保留)
  update_rule: |
    - 每個 session 結束時(E4_takeaway_planter 觸發)、寫入本 session summary
    - new_session_day 進入時、E4_day_opening_reference_selector 讀此欄位
  decay_per_turn: 0
  reset_on: 不 reset(跨 session 持續、但每次 session 結束時 overwrite)
```

### 4.2 opening_reference_variant_used

```yaml
session_state.opening_reference_variant_used:
  range: enum ["V1", "V2", "V3", "V4", "V5", null]
  initial_value: null
  scope: session-scoped
  update_rule: |
    E4_day_opening_reference_selector 觸發後、寫入使用的變體
  decay_per_turn: 0
  reset_on:
    - new_session_day
```

### 4.3 takeaway_seeded_this_session

```yaml
session_state.takeaway_seeded_this_session:
  range: bool
  initial_value: false
  scope: session-scoped
  update_rule: |
    - false → true:E4_takeaway_planter 完成執行
    - 避免 AI 在同一 session 內重複種 takeaway
  decay_per_turn: 0
  reset_on:
    - new_session_day
```

### 4.4 export_prompt_generated_at

```yaml
session_state.export_prompt_generated_at:
  range: timestamp | null
  initial_value: null
  scope: user-scoped
  update_rule: |
    - null → timestamp:E4_export_personal_coach_prompt 首次觸發、寫入時間
    - 學員可重複觸發 export(updating)、覆寫 timestamp
  decay_per_turn: 0
  reset_on: 不 reset
```

---

## 5. 元件 spec

### 5.1 cached_active_reference_styles(cached prefix)

```yaml
- id: cached_active_reference_styles
  type: always_on_cached
  cached_tokens: ~800
  purpose: |
    AI 主動引用機制完整風格指引 + 5 變體話術骨架 + gap_days 分級處理範本。
    永久 cached、被所有 E4 子組件引用、~26% baseline cost。
  
  reference_id: "ACTIVE_REFERENCE_STYLES"
  
  damon_alignment:
    - "6.7 AI 主動引用機制設計(A001 Day 2 修正)"
    - "6.8 gap_days 分級處理"
    - "6.9 #5 NLP Amnesia 主動整合機制(v5.0 原創 IP、Beta 驗證中)"
    - "Damon: Future Pacing 隔天做、不機械引用"
  
  content: |
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    【Damon 引用風格 3 大原則】
    
    1. **不機械**(不直接複誦昨天的詞):
       ❌「昨天你說你是發光的鑽石、那句話今天還在嗎?」(A001 Day 2 災難)
       ✅「『發光』。今天我們從這裡再深一點。」
    
    2. **有方向性**(永遠帶今天往哪走、不開放評估):
       ❌「那個感覺今天還在嗎?」(邀請評估、引發 PPL)
       ✅「今天我們從這裡繼續往更深處走。」
    
    3. **結合 Future Pacing**(把昨天的 quality 放進今天的具體場景):
       ✅「想像今天某個時刻、你做著符合『發光』的事——身體在哪裡感覺到?」
    
    禁區:
    - 不問「還在嗎 / 還有嗎 / 還記得嗎」(評估式提問)
    - 不重複學員昨天的完整原話(讓學員自己重新組裝)
    - 不假設學員今天從哪一階段繼續(session_state 已 reset、要 fresh 觀察)
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    【5 變體話術骨架完整定義】
    
    **變體 V1 — 方向性繼續**(預設、適用 gap_days ≤ 2 + 有 owned anchor)
    
    話術:
    > 「『[anchor 詞、抓 1-2 個字、不完整複誦]』。
    > 今天我們從這裡再深一點。
    > 你最近一次覺得自己『[anchor]』、是什麼時候?」
    
    觸發條件:
    - gap_days <= 2
    - last_session_day_summary.last_takeaway_term != null
    - last_session_day_summary.last_session_ended_naturally == true
    
    ━━━━━━━━━━━━━━━━━━━━━━━━
    
    **變體 V2 — Future Pacing 引導**(適用 gap_days ≤ 2 + 昨天進入 ambiguous)
    
    話術:
    > 「想像三個月後的你、做著符合『[anchor 或 top1_value]』的事——
    > 身體在哪裡感覺到?」
    
    觸發條件:
    - gap_days <= 2
    - last_session_day_summary.last_session_end_phase 進入 ambiguous 或 cascade_down
    - quality_focus_history 已有 ≥ 1 owned
    
    ━━━━━━━━━━━━━━━━━━━━━━━━
    
    **變體 V3 — Snapshot 給選擇權**(適用 gap_days 3-7)
    
    話術:
    > 「歡迎回來。
    > 上次你留下『[anchor 詞]』。
    > 今天你想接這個、還是有新的事?」
    
    觸發條件:
    - gap_days in [3, 7]
    
    Damon 對應:方法論 6.8 中等中斷處理
    
    ━━━━━━━━━━━━━━━━━━━━━━━━
    
    **變體 V4 — Full context 學員選**(適用 gap_days > 7)
    
    話術:
    > 「歡迎回來。
    > 我這邊還留著你之前的東西——
    > 包括『[anchor 1]』『[anchor 2]』『[anchor 3]』。
    > 今天你想從哪裡開始?」
    
    觸發條件:
    - gap_days > 7
    
    Damon 對應:方法論 6.8 顯著中斷處理
    
    抓 anchor 規則:從 quality_focus_history 抓最近 3 個 owned quality(時間倒序)
    
    ━━━━━━━━━━━━━━━━━━━━━━━━
    
    **變體 V5 — Cascade Down 提示**(適用昨天 router_phase == "cascade_down" 但未完成)
    
    話術:
    > 「『[top1_value]』昨天已經是你的。
    > 今天看看『[next value in ranking]』——
    > 你是一個『[next value]』的人嗎?」
    
    觸發條件:
    - last_session_day_summary.last_session_end_phase == "cascade_down"
    - cascade_down_progress 未 completed(雖然 session reset、但 user-scoped values_ranking 還在)
    
    特殊處理:V5 觸發後、E3_cascade_down_validator 同 turn 接手執行身份測試
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    【gap_days 分級處理範本】
    
    | gap_days | 範圍 | 主要變體 | 額外動作 |
    |---|---|---|---|
    | 0(同日)| 不算 new_session_day | N/A | 不觸發 E4_day_opening |
    | 1-2 | 正常生活打斷 | V1 / V2 / V5 | 不強調缺席 |
    | 3-7 | 中等中斷 | V3 | AI 主動 reminder、給選擇權 |
    | > 7 | 顯著中斷 | V4 | AI 把 profile snapshot 給學員看、選擇權都在學員 |
    
    核心原則:
    - AI 不假裝缺席沒發生
    - AI 不過度強調缺席(不批判、不道德 framing)
    - 缺席越長 → AI 給的上下文 anchor 越多、但選擇權都在學員
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    【NLP Amnesia 主動整合機制(v5.0 原創 IP #5、Beta 驗證中)】
    
    核心邏輯:
    - Day N session 結束:takeaway 種下「種子」(E4_takeaway_planter)
    - Day N → Day N+1 夜裡:潛意識在睡眠中自動整合(Damon NLP Amnesia 原理)
    - Day N+1 開場:AI 不問「整合完了嗎」、直接 Future Pacing 驗證(V2 變體)
    
    這個機制讓「整合」分散在多 day 進行、不在單一 session 完成。
    對應方法論 6.6「分階段整合」+ Damon「分次完成轉化」+ 21 天 daily session
    彈性 14-21 天範圍的設計核心。
    
    AI 必須意識到:
    - 學員 Day N+1 可能「不記得」昨天的具體 emotion(NLP Amnesia)
    - 但 quality 已在身體裡(Damon 原話:「他經歷了改變、但意識不到自己在做不同的事」)
    - AI 引用方式必須匹配這個「身體記得、頭腦不記得」的狀態
```

---

### 5.2 E4_day_opening_reference_selector(子組件 1)

```yaml
- id: E4_day_opening_reference_selector
  type: conditional_inject
  trigger_conditions:
    - new_session_day == true(本日首次 user message)
    - 任一 user-scoped 持久資產非空(anchors / quality_focus_history / top1_value)
  active_state_tokens: ~230
  
  inputs_from_profile:
    - user_profile_evolution.anchors
    - user_profile_evolution.quality_focus_history
    - user_profile_evolution.top1_value
    - user_profile_evolution.values_ranking
    - session_state.last_session_day_summary
    - new_session_day_calculated_gap: int  # Patrick 工程算出
  
  outputs_to_profile:
    session_state.opening_reference_variant_used: str (V1-V5)
    session_state.router_phase: "opening"(reset 後重新開始)
  
  damon_source:
    - "6.7 AI 主動引用機制設計"
    - "6.8 gap_days 分級處理"
    - "A001 Day 2 失敗修正:不機械引用、不問還在嗎"
    - "v5.0 原創 IP #5 NLP Amnesia 主動整合機制"
  
  prompt_content: |
    [SYSTEM INJECT — Day Opening Active Reference]
    
    本 turn = new_session_day 後、學員本日首次發 message。
    執行主動引用 + 開場提問。
    
    Reference:cached_active_reference_styles 內【5 變體話術骨架】+ 【gap_days 分級處理範本】
    
    **變體選擇邏輯**(由 LLM judge 動態挑、不寫死 if-else):
    
    考量因素(依優先順序):
    
    1. **gap_days 分級**(粗篩):
       - gap_days <= 2 → 候選 V1 / V2 / V5
       - gap_days 3-7 → V3
       - gap_days > 7 → V4
    
    2. **last_session_end_phase**(細選):
       - 昨天進入 cascade_down 未完成 → V5(優先級高於 gap_days、若 gap_days <= 7)
       - 昨天結束在 ambiguous 階段 → V2
       - 昨天 takeaway 種下成功 → V1
       - 昨天 hard limit 強制收尾(last_session_ended_naturally == false)→ V3(給選擇權)
    
    3. **今天開場語氣**(微調、若可判斷):
       - 學員開場句帶「我想接...」/「繼續...」 → V1 變體
       - 學員開場句帶「今天我想換...」/「不一樣的事」 → V3 變體
       - 學員開場句模糊 / 短話 → V3 / V4(給選擇權)
    
    **執行步驟**:
    
    Step 1 — LLM 內部判斷(主對話 LLM 不額外 call):
    - 根據 inputs 自己推 V1-V5 哪個適合
    - 寫入 session_state.opening_reference_variant_used
    
    Step 2 — 從 cached reference 取對應變體話術骨架
    
    Step 3 — 填空:
    - [anchor 詞] / [anchor 1/2/3] → 從 user_profile_evolution.anchors 抓
    - [top1_value] → 從 user_profile_evolution.top1_value 抓
    - [next value in ranking] → 從 values_ranking 抓 rank 2 / 3
    
    Step 4 — 輸出最終話術、自然接續對話
    
    **禁止**:
    - 不問「還在嗎 / 還記得嗎 / 還有那個感覺嗎」(評估式提問、A001 Day 2 災難)
    - 不完整複誦學員昨天原話(讓學員自己重新組裝)
    - 不假設學員今天從哪一階段繼續(session_state 已 reset、要 fresh 觀察)
    - 不對情緒做評判(「你那時候很開心 / 很糾結」這類 AI 給標籤)
  
  variable_filling_method: |
    Patrick 工程把 user_profile_evolution.* 全部餵進主 LLM context、
    主 LLM 讀 last_session_day_summary 自選變體、自填變數、生成最終話術。
  
  failure_modes:
    - id: J1
      mode: "LLM judge 選錯變體(例:V1 場景卻挑 V3)"
      mitigation: |
        Beta 階段監控 opening_reference_variant_used distribution、
        若 V3 / V4 觸發率過高(學員實際 gap_days 大多 <= 2 卻挑了給選擇權變體):
        修正 prompt_content 內變體選擇邏輯。
        v5.0 不預先 hedge、Beta 校準。
    - id: J2
      mode: "user_profile_evolution.anchors 為空(Day 1 學員第一個 new_session_day = Day 2)"
      mitigation: |
        Day 2 應該已有至少一個 anchor(Day 1 結束 takeaway 種下)。
        若仍為空:trigger_conditions 不滿足、本 inject 不觸發、走主對話 LLM 正常開場。
    - id: J3
      mode: "學員回應引用後說「我不想再講這個」"
      mitigation: |
        cascade 到附錄 A3.handoff_escalation:
        「OK。你想聊新的方向、還是先停在輕鬆的對話?
         你選哪個都可以。」
        不強推、保留學員退場權。
        若連續 3 個 new_session_day 都觸發 J3:HITL alert(學員可能不適配 21 天 flow)
```

---

### 5.3 E4_takeaway_planter(子組件 2)

```yaml
- id: E4_takeaway_planter
  type: conditional_inject
  trigger_conditions:
    任一即觸發(end-of-session 邏輯):
    - soft limit 25 turn 達到 + 學員同意收尾
    - hard limit 40 turn 達到(強制收尾)
    - 學員主動講「今天到這 / 我累了 / 先停這」
    - current_quality_status 升級 owned(在 session 中段、也要種 takeaway)
    - router_phase == "completed"(Cascade Down 全完成、session 自然結束)
  active_state_tokens: ~200
  
  inputs_from_profile:
    - session_state.current_quality_candidate_term
    - session_state.current_quality_status
    - session_state.takeaway_seeded_this_session
    - session_state.router_phase
    - anchors_top3
  
  outputs_to_profile:
    session_state.takeaway_seeded_this_session: true
    session_state.last_session_day_summary:
      last_session_end_phase: <current router_phase>
      last_quality_focus: <current_quality_candidate_term>
      last_takeaway_term: <抓 takeaway 種下的 anchor>
      last_session_ended_naturally: bool
      gap_days: 0(等下次 new_session_day 算)
    user_profile_evolution.quality_focus_history: append (if upgrade)
    user_profile_evolution.anchors: append (if upgrade)
  
  damon_source:
    - "6.4 到 level 後的 3 步動作:複述鞏固 → 身份測試 → takeaway 種下"
    - "Damon: 不 over-process、給潛意識空間"
    - "方法論 6.6 NLP Amnesia 機制配合"
  
  prompt_content: |
    [SYSTEM INJECT — Takeaway Planter]
    
    Session 結束 / quality 升級。執行 3 步收尾:
    複述鞏固 → 確認 → takeaway 種下。
    
    **必須做**(三段、不省略):
    
    Step 1 — 複述鞏固(學員自己的話):
    > 「你今天說了『[抓學員 session 內最具代表性的一句原話]』。
    > 這個你帶著走。」
    
    禁止:不用 AI 給的標籤、不重新詮釋學員的話
    
    Step 2 — 確認(分支):
    
    若 current_quality_status == "owned"(剛升級):
    > 「『[current_quality_candidate_term]』——這是你的。」
    
    若還在 candidate / ambiguous:
    > 「今天我們挖到『[current_quality_candidate_term]』。
    > 還在繼續、不是結束。」
    
    若 hard limit 強制收尾(沒挖到 level):
    > 「今天到這。明天我們從這裡繼續。」
    
    Step 3 — takeaway 種下:
    > 「明天從這裡繼續、現在不解釋、不延伸。」
    
    禁止:
    - 不繼續挖
    - 不深入解釋(給潛意識夜裡整合空間)
    - 不派作業(v5.0 MVP 範圍不做作業、跟方法論 6.1 對齊)
    
    **寫入 last_session_day_summary**:
    - last_session_end_phase = current router_phase
    - last_quality_focus = current_quality_candidate_term
    - last_takeaway_term = 從 Step 1 複述句抓 1-2 個字 anchor
    - last_session_ended_naturally:
      * hard limit 強制 → false
      * 學員主動 / quality upgrade / 自然完成 → true
    - gap_days = 0(等下次 new_session_day 算)
  
  variable_filling_method: |
    主 LLM 從 session 對話歷史抓最具代表性的學員原話、自填到複述句。
  
  failure_modes:
    - id: J4
      mode: "takeaway_seeded_this_session == true 但學員繼續打字"
      mitigation: |
        AI 不重新種 takeaway、自然回應:
        「我聽到了。明天我們從這裡繼續。」
        若學員強烈想繼續:評估剩餘 turn budget、決定是否破例
        (但 hard limit 40 turn 絕對不破例)
    - id: J5
      mode: "Step 1 複述句抓錯(抓到 PPL 配合句、不是真實 quality 句)"
      mitigation: |
        prompt_content 內 Step 1 強調「最具代表性」——
        Beta 階段監控、若複述句 = 短回應 / 配合詞、HITL alert。
```

---

### 5.4 E4_cascade_down_reference(子組件 3)

```yaml
- id: E4_cascade_down_reference
  type: conditional_inject
  trigger_conditions:
    - session_state.router_phase == "cascade_down"
    - cascade_down_progress.status == "testing"(即將測試 Top 2 / Top 3)
    - E3_cascade_down_validator 同 turn 觸發、本 inject 在 E3 之前 inject
  active_state_tokens: ~180
  
  inputs_from_profile:
    - session_state.top1_value
    - session_state.values_ranking
    - session_state.cascade_down_progress
    - session_state.quality_focus_history
  
  outputs_to_profile:
    (本 inject 不寫 state、只生成過渡引用、由 E3_cascade_down_validator 接手)
  
  damon_source:
    - "4.7 Cascade Down 驗證"
    - "Damon: 從 Top 1 owned 過渡到測試 Top 2 / Top 3"
  
  prompt_content: |
    [SYSTEM INJECT — Cascade Down Transition Reference]
    
    Top 1「[top1_value]」已 owned + Self-Concept 整合完成。
    即將測試 Top 2 / Top 3、先做引用過渡。
    
    本 inject 只生成 1-2 句過渡引用、然後 handoff 給 E3_cascade_down_validator 執行身份測試。
    
    **話術變體**(LLM 挑):
    
    變體 A — 首次進入 Cascade Down(測試 Top 2):
    > 「『[top1_value]』現在是你的。
    > 我們看看『[Top 2 value]』。」
    
    變體 B — Top 2 通過、測試 Top 3:
    > 「『[top1_value]』『[Top 2 value]』。
    > 還有『[Top 3 value]』。」
    
    變體 C — Cascade 過程跨 day(從 V5 開場後接手):
    > 「『[top1_value]』昨天已經是你的。
    > 今天我們看『[next value in ranking]』。」
    
    **禁止**:
    - 不解釋 Cascade Down 概念(學員不需要知道機制名)
    - 不問「你準備好嗎」(評估式)
    - 不重複 Top 1 的 evidence(已 owned、不需重新證明)
    
    Inject 結束、E3_cascade_down_validator 接手執行身份測試問句:
    > 「你是一個『[next value]』的人嗎?」
  
  variable_filling_method: |
    從 values_ranking 抓 Top 2 / Top 3 value 名稱、自填到變體話術。
  
  failure_modes:
    - id: J6
      mode: "values_ranking 不完整(只有 Top 1、沒 Top 2)"
      mitigation: |
        E3_cascade_down_validator H12 已處理:
        cascade_down_progress.status = "completed"、跳過本 inject。
```

---

### 5.5 E4_export_personal_coach_prompt(子組件 4 / Founder bonus)

```yaml
- id: E4_export_personal_coach_prompt
  type: conditional_inject
  trigger_conditions:
    - 由 Checkpoint 1 觸發(Day 21、本引擎只 spec 機制不 spec 觸發時機)
    - 學員 explicit 要求(設定中「下載我的個人教練 prompt」按鈕)
  active_state_tokens: ~250
  
  inputs_from_profile:
    - user_profile_evolution.top1_value
    - user_profile_evolution.values_ranking
    - user_profile_evolution.anchors
    - user_profile_evolution.quality_focus_history
    - user_profile_evolution.values_collected_list
  
  outputs_to_profile:
    session_state.export_prompt_generated_at: timestamp
    (生成的 Markdown 內容由前端 UI 處理顯示 + 提供下載按鈕)
  
  damon_source:
    - "v5.0 商業設計:Founder bonus、21 天結束學員拿走 starter kit"
    - "Damon Identity Shift 完整框架"
    - "v5.0 原創 IP 整合(Scope Overlap / 東方文化柔軟拆解 / 三向歸類 / 5 層撥開 / NLP Amnesia)"
  
  prompt_content: |
    [SYSTEM INJECT — Personal Coach Prompt Export]
    
    生成學員的個人教練 prompt Markdown、可貼到外部 LLM(Claude.ai / ChatGPT)使用。
    
    輸出格式為 Markdown、含 3 段:
    1. 個人化資產(動態填入)
    2. Damon-style 引導風格指引(fixed template、所有學員共用)
    3. 使用說明(如何在外部 LLM 用)
    
    **生成模板**:
    
    ```markdown
    # [學員姓名 / nickname] 的個人 Identity Coach Prompt
    
    > 21 天 Identity Shift 旅程的延續工具。
    > 把這段 prompt 複製貼到 Claude / ChatGPT / 任何 LLM、它就會以你的個人教練模式跟你對話。
    
    ---
    
    ## 第一段:你是誰(你的 owned identity)
    
    我的 Top 1 quality 是「[top1_value]」——
    這是我整段旅程的根、其他 quality 都在它裡面。
    
    我已經 owned 的 quality 是:
    [從 user_profile_evolution.anchors 列出全部、項目符號]
    - 「[anchor 1]」
    - 「[anchor 2]」
    - 「[anchor 3]」
    - ...
    
    我的 values 排序(從最大涵蓋到最具體):
    [從 values_ranking 列出 Top 1-5]
    1. [Top 1 value](核心)
    2. [Top 2 value]
    3. [Top 3 value]
    4. [Top 4 value]
    5. [Top 5 value]
    
    ---
    
    ## 第二段:對 AI 教練的引導風格指引(固定 template、Damon-style)
    
    請以下面這個風格跟我對話:
    
    1. **不要安慰我、不要鼓勵我**——我來找你不是要 validation。
    
    2. **用 Damon Cart 的方法**:
       - 不要問我「為什麼」(Why?)——問「這對我來說會帶來什麼」(What will that do for you?)
       - 我如果說「我不知道」、把它翻轉成「我想要知道什麼?」
       - 我如果說「我老是搞砸」、強制翻轉成「我真正想要的是什麼?」
       - 不要接受我模糊的回答(「應該是 / 大概 / 還好」)——push back、要具體事件
    
    3. **如果我說我是某個 quality**:
       - 不要直接相信、要我舉具體事件(時間、地點、跟誰、做了什麼)
       - 沒有具體事件、就是 candidate、不是 owned
       - 即使我說「對 / 是」、也不接受—— 要看我能不能 ground 在身體裡
    
    4. **如果我陷入大詞 / 抽象**(整合 / 完整 / 覺醒 / 一切是最好的安排):
       - 指認:「這個詞太大、抓不到」
       - 拉我到具體層次:「過去那個還沒 X 的我、現在在哪裡?」
    
    5. **永遠相信我的 parts 都有正向意圖**:
       - 我所有的阻力、都是過時的「日本兵」(還在執行舊命令、不知道戰爭結束了)
       - 不要叫我「打敗」某個 part、用 As-If Frame 給它新角色
    
    6. **不要 over-process**:
       - 我在 takeaway 後不繼續挖、給我潛意識整合空間
       - 隔天驗證、不當天追問
    
    ---
    
    ## 第三段:使用說明
    
    1. 把這整段 prompt 複製、貼到你選的 LLM(Claude.ai / ChatGPT / 其他)
    2. 在你的提問前面、可以開頭說「我現在想處理 [具體議題]」
    3. AI 會以上面的風格跟你對話、不會繞圈子、不會給你雞湯
    
    建議使用情境:
    - 你卡住、不知道下一步
    - 你有一個重要決定、想確認跟你的 values 對齊
    - 你想 deepen 某個已 owned quality
    - 你發現一個新的 candidate quality、想驗證
    
    不建議使用情境:
    - 嚴重情緒危機(找 Vivi 1-on-1)
    - 深創傷處理(找專業心理師)
    - 一般生活諮詢(用普通 LLM 即可、不需要這個 prompt)
    
    ---
    
    > 生成時間:[export_prompt_generated_at]
    > 21 天旅程: Day 1 - Day 21
    > 你的 starter kit、永久有效。
    ```
    
    **變數填空**:
    Patrick 工程把 user_profile_evolution.* 全部餵進、主 LLM 自填:
    - [學員姓名 / nickname]
    - [top1_value]
    - [anchor 1-N](從 anchors 列出全部)
    - [Top 1-5 value](從 values_ranking 抓)
    - [export_prompt_generated_at]
    
    第二段 + 第三段為 fixed template、不動。
    
    **禁止**:
    - 不修改第二段引導風格(這是商業 IP 核心、保持一致)
    - 不對學員具體議題給建議(export 是 prompt、不是 coaching session)
    - 不省略「不建議使用情境」(法律 / 安全 / 商業界線清楚)
  
  failure_modes:
    - id: J7
      mode: "user_profile_evolution 資產不完整(學員 21 天沒完成 / 中途退出)"
      mitigation: |
        若 top1_value == null 或 anchors 為空:
        - 觸發 partial export 模板:
          「你的 21 天旅程沒完整、但你帶走的這些是你的:
           [列出有的 anchors / values_collected_list]
           建議:跟 Vivi 1-on-1 評估是否重新走一遍」
        - 不生成 fixed template 引導風格(因 owned 不完整、prompt 會 misfire)
    - id: J8
      mode: "學員想多次 export(updating)"
      mitigation: |
        export_prompt_generated_at 覆寫、新版替代舊版。
        若學員想保留多個版本:前端 UI 處理、不在 prompt 範圍。
```

---

## 6. 跨引擎合約

### 6.1 引擎 4 讀其他引擎的 state

```yaml
read_from_engine_1:
  - 無直接讀取(引擎 4 是 end-of-pipeline 消費端、引擎 1 是入口)

read_from_engine_2:
  - session_state.current_quality_candidate_term (E4_takeaway_planter)
  - session_state.current_quality_status (E4_takeaway_planter)
  - quality_focus_history (E4_day_opening / E4_export)

read_from_engine_3:
  - session_state.router_phase (E4_takeaway_planter 判斷 session 是否自然結束)
  - session_state.top1_value (E4_export / E4_day_opening V2 / E4_cascade_down)
  - session_state.values_ranking (E4_cascade_down / E4_export)
  - session_state.cascade_down_progress (E4_cascade_down)
```

### 6.2 引擎 4 寫入給其他系統

```yaml
write_for_engine_2_3:
  - session_state.router_phase: "opening"
    (E4_day_opening_reference_selector 觸發後寫入、引擎 3 從 fresh 評估)
  
write_to_user_profile_evolution:
  - user_profile_evolution.quality_focus_history: append on quality upgrade
  - user_profile_evolution.anchors: append on quality upgrade
  - user_profile_evolution.last_session_day_summary: overwrite each session end

write_for_dashboard:
  - opening_reference_variant_used: 5 變體 distribution 監控
  - export_prompt_generated_at: 完成率 metric
```

### 6.3 引擎 4 與附錄 A 機制使用

```yaml
mechanism_usage:
  A3_handoff_escalation:
    used_by_E4: E4_day_opening_reference_selector J3 (學員拒絕引用)
  
  A4_depth_signal:
    used_by_E4: (不直接使用、引擎 3 已處理)
  
  A5_containment_logic:
    used_by_E4: (不直接使用、引擎 3 已處理)
```

---

## 7. Patrick 接手清單

### 7.1 migration 014 延伸欄位

引擎 4 新增 session_state + user-scoped 欄位:

```
session-scoped(JSONB on sessions):
- session_state.opening_reference_variant_used (enum string | null)
- session_state.takeaway_seeded_this_session (bool)

user-scoped(JSONB on user_profile_evolution):
- user_profile_evolution.last_session_day_summary (object)
- user_profile_evolution.export_prompt_generated_at (timestamp | null)
```

**Errata 修正(本檔 §3 framework 為準)**:
```
- 引擎 2 §3.1 current_quality_status: + reset_on: new_session_day
- 引擎 3 §3.1 router_phase: + reset_on: new_session_day
- 引擎 3 §3.8 elicitation_mode_active: + reset_on: new_session_day
```

### 7.2 new_session_day 工程實作

```
- lib/session/day-boundary.js
  邏輯:calendar day 已過 + 學員本日首次發 message
  輸出:new_session_day (bool) + gap_days (int)
```

### 7.3 cached prefix 整合

cached_active_reference_styles ~800 tokens 加入 v4.0 主 cached prefix:

```
v5.0 cached prefix 總覽(引擎 1+3+4):
- cached_5_layer_unwrap_reference (~600 tokens, 引擎 1)
- cached_4_7_router_reference (~1400 tokens, 引擎 3)
- cached_active_reference_styles (~800 tokens, 引擎 4)
合計 ~2800 tokens cached
~26% baseline cost ≈ ~730 equivalent active
```

### 7.4 E4_export Markdown 處理

- 前端 UI 提供「下載個人教練 prompt」按鈕
- 後端 E4_export_personal_coach_prompt 生成 Markdown 字串
- UI 顯示 + 提供 copy / download / share 三種方式

### 7.5 24h 內回 ack 給設計師

格式:
> 「收到引擎 4 markdown、Checkpoint 2 完整 ship、預估 X hr 內完成引擎 1-4 合併工程交付物」

---

## 8. Forward References

### 8.1 Checkpoint 1:21 天 daily session 結構
本檔 §5.5 E4_export 觸發時機(Day 21 何時觸發)屬於 Checkpoint 1 範圍。
另外 Future Pacing 完整 SOP(本檔 V2 變體只 spec 引用面)也屬 Checkpoint 1 Phase 5。

### 8.2 dashboard / failure_signals
J-series failure modes(J1-J8)+ opening_reference_variant_used distribution + export 完成率——延後至 `v5_beta_failure_signals_dashboard.md`(本檔完成後、引擎 1-4 + dashboard 集中 spec)。

特別注意 **J1 變體選擇 distribution 監控** + **J5 takeaway 複述句抓錯**——Beta 階段關鍵 quality 指標。

### 8.3 v5.0 原創 IP #5 NLP Amnesia 主動整合機制驗證
本檔 §5.1 cached reference 已將 NLP Amnesia 主動整合機制完整 spec。Beta 階段驗證指標:
- 學員 Day N+1 開場「忘了昨天說什麼」但身體記得(V2 Future Pacing 引導確認)
- quality_focus_history 在 21 天內穩定 append、不出現倒退
- 跨 day reset 後 router_phase 重啟、不卡死

驗證通過 → v5.0 原創 IP #5 從「Beta 驗證中」升級「已驗證」。

### 8.4 工具二三池正式判決(完整 closure)
本檔觸發 + 引擎 1-3 累積:

| 池 | 判決 | 依據 |
|---|---|---|
| **2A SC 池** | ✅ KEEP 結構 + UPGRADE 觸發機制 | 引擎 2 §8.4(confirm/evidence_script 繼承)|
| **2B Reactive 池** | ✅ KEEP requires_typing 物理機制 + 廢棄句式池 | 引擎 1 §4.6(2B requires_typing 繼承為 E1c PPL 防護)|
| **2C Belief 池** | ✅ KEEP Step 1-4 邏輯 + UPGRADE 對應 Parts Integration 切換 | 引擎 3 §4.1 cached reference 內【Parts Integration 切換條件】完整繼承 |

→ **工具二三池整體判決 3/3 完成**。

### 8.5 ship 版本草稿
本檔為「設計師對話版」。Patrick 24h 內提交「ship 版本草稿」、做以下調整:
- 去除「對設計師說明」meta 段落 + Errata 段落(以 migration 014 為準)
- 加入 runtime placeholder(`{{user_profile_snapshot}}` / `{{anchors_top3}}` / `{{quality_focus_history_summary}}` 等)
- 設計師 review 後正式 ship 進 v5.0 chat.js system prompt

---

## 9. Checkpoint 2 收尾總結

### 9.1 4 引擎完整交付

| # | 引擎 | 行數 | 對應 TODO 1 | 核心交付 |
|---|---|---|---|---|
| 1 | 對話偏離識別 | 1266 | #1 5.7 | 4 類偏離(off_topic / vague / PPL / bypassing)+ requires_typing 防護 |
| 2 | 身份測試判決 | 969 | #2 6.2 | 4 重組合(詞彙 × pattern × NOT-PPL × confirm)+ Quality 詞表 80+ |
| 3 | 4.7 中央路由器 | 1354 | #3 4.7 | pure decision tree(5 子路由器)+ Top 1 / Cascade Down / 深訊號 |
| 4 | AI 主動引用機制 | (本檔) | #4 6.7 | Day N+1 開場(5 變體)+ takeaway 種下 + export prompt |

**合計**:~4500+ 行 spec、4 引擎完整 ship。

### 9.2 設計語言成熟度

v5.0 vs v4.0 本質差異:

| 維度 | v4.0 | v5.0 |
|---|---|---|
| 架構 | prompt 怪獸疊加 | 三層 detector → classifier → sub-prompts + cached prefix |
| 跨引擎協作 | 各自為政 | state-as-API(cumulative_ppl_score → current_quality_status → router_phase) |
| Token efficiency | ~9.5K active | max simultaneous ~280-300、cached ~2800 |
| 機制重用 | 每個 feature 重新做 | 附錄 A 雙方合約(A1/A2/A3/A4/A5、5 個機制) |
| 失敗模式記錄 | 散落 | 每元件明確 failure_modes + Forward dashboard spec |

### 9.3 4 引擎 + 附錄 A 機制庫總覽

```
引擎 1 對話偏離識別
├ cached_5_layer_unwrap_reference (cached, ~600t)
├ E1_deviation_master_detector (detector_only)
├ E1_subtype_classifier
└ E1a/b/c/d sub-prompts
   └ E1c 用附錄 A1.requires_typing

引擎 2 身份測試判決
├ E2_identity_test_master_detector (detector_only)
├ E2_aggregator(4 重組合)
└ E2_upgrade/stay/continue sub-prompts
   └ 重 4 confirm 用附錄 A1.sensory_detail Haiku judge

引擎 3 4.7 中央路由器
├ cached_4_7_router_reference (cached, ~1400t)
├ E3_deep_signal_detector(最高優先)
├ E3_opening_branch_router
│   └ 分支 C 用附錄 A4.depth_signal Haiku judge
├ E3_top1_determination
│   └ Step 5 用附錄 A5.containment_logic Haiku judge
├ E3_status_router(4 條主路由)
└ E3_cascade_down_validator
   └ Haiku judge 用 A1 / A5

引擎 4 AI 主動引用機制
├ cached_active_reference_styles (cached, ~800t)
├ E4_day_opening_reference_selector(5 變體)
├ E4_takeaway_planter
├ E4_cascade_down_reference
└ E4_export_personal_coach_prompt(Founder bonus)

附錄 A 引擎機制庫(雙方合約):
├ A1 requires_typing (Haiku judge: sensory-detail.js)
├ A2 cumulative_score (通用模板)
├ A3 handoff_escalation (state + alert + branching)
├ A4 depth_signal_judge (Haiku: depth-signal.js)
└ A5 containment_logic_judge (Haiku: containment-logic.js)
```

### 9.4 工具二三池整體判決(closure)

| 池 | 判決 |
|---|---|
| 2A SC | ✅ KEEP 結構 + UPGRADE 觸發機制(4 重組合)|
| 2B Reactive | ✅ KEEP requires_typing 物理機制 + 廢棄句式池 |
| 2C Belief | ✅ KEEP Step 1-4 邏輯 + UPGRADE 對應 Parts Integration |

### 9.5 v5.0 原創 IP 整合狀態

| # | 原創 IP | 整合到引擎 |
|---|---|---|
| 1 | Scope Overlap | Forward to Checkpoint 1 Phase 2-3 |
| 2 | 東方文化柔軟拆解節奏 | 內隱於所有引擎(亞洲適配 quality 詞表 / failure mode mitigation)|
| 3 | 三向歸類 | Forward to Checkpoint 1 Phase 4 |
| 4 | 5 層撥開技術 | 引擎 1 E1d + cached_5_layer_unwrap_reference |
| 5 | NLP Amnesia 主動整合機制 | 引擎 4 §5.1 cached + §3 cross-day reset framework |

### 9.6 Checkpoint 2 → Checkpoint 1 銜接

下一個工作軌道:**Checkpoint 1(21 天 daily session 結構)**

- 引擎 4 §5.1 cached reference 內【gap_days 分級處理範本】= Checkpoint 1 的 retention 基底
- 引擎 3 cached reference 內【4.7 中央路由器藍圖】= Checkpoint 1 的 phase 流程定義
- 引擎 2 Quality 詞表 + 身份句結構 = Checkpoint 1 Phase 1 採集階段詞庫
- 引擎 1 4 類偏離治理 = Checkpoint 1 全 phase 通用

Checkpoint 1 spec 預估行數 ~2000-2500、是 v5.0 最大單一交付物、需要至少 3-4 個 turn。

---

## 文件版本

- v0.1 (2026-05-19):初版、設計師對話版、待 Patrick ship 版草稿
- **Checkpoint 2 完整收尾、4 引擎 100% ship**
