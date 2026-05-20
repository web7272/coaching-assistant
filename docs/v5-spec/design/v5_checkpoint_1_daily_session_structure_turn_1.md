# v5.0 Checkpoint 1:21 天 Daily Session 結構

> **文件用途**:Checkpoint 1 完整交付。Patrick 工程端接此檔做 `lib/session/phase-machine.js` 工程實作 + 5 Phase 完整流程整合。
>
> **建立日期**:2026-05-19
>
> **對應方法論**:`damon_methodology.md` 章節 4.7(AI App Session Flow 完整藍圖)、6.1(v5.0 MVP 範圍)、6.6(NLP Amnesia 機制)、6.8(gap_days 分級處理)、5.2-5.4(4 步驟改變法 + Self-Concept 模型)、Damon Identity Shift 完整框架
>
> **對應 TODO**:`v5_next_actions.md` TODO 1 第二優先級「21 天 daily session 結構 spec(4.7 藍圖在 14-21 天彈性分布)」+ TODO 4「3 個原創情境話術」
>
> **版本**:設計師對話版(v0.1)Turn 1 / 3。
>
> **依賴關係**:依賴引擎 1+2+3+4 已 ship。本檔是引擎 1-4 的「流程整合層」、**選項 A 流程導向**(不重寫話術、指向引擎 1-4)。

---

## ⚠️ 範圍 + 寫法 Warning

**範圍**:
- ✅ 5 Phase 完整流程 spec(entry/exit conditions + state transitions + cross-engine triggers)
- ✅ 14-21 天彈性分布 framework(C 混合 + Integration Retention Mode)
- ✅ Day 定義(calendar day vs session day 雙計數)
- ✅ 3 個 5.7.4 原創情境話術(附錄 C)
- ✅ 跨 Phase 銜接 + 退場機制

**範圍排除**:
- ❌ 不重寫引擎 1-4 已 spec 的話術(指向引擎)
- ❌ 不重寫附錄 A 機制(指向引擎 1 / 引擎 3 附錄)
- ❌ 不重寫 dashboard 監控(forward to dashboard 檔)

**寫法**:選項 A 流程導向、每 phase **必須** spec:
- entry_condition(從上 phase 進入 trigger state)
- exit_condition(進下 phase trigger state)
- state_field_updates_on_entry / on_exit
- cross_engine_triggers(進入 phase 時 trigger 哪些引擎)
- 內部 step sequence(SOP)
- min_day / max_day(以 session_day_count 計算)
- failure_modes + handoff fallback

---

## 目錄(Turn 1 範圍)

1. [整體架構](#1-整體架構)
2. [Framework C:14-21 天彈性分布](#2-framework-c)
3. [Integration Retention Mode](#3-integration-retention-mode)
4. [Day 定義:calendar vs session 雙計數](#4-day-定義)
5. [Session State Fields(Checkpoint 1 新增)](#5-session-state-fields)
6. [Phase 1:Values Elicitation](#6-phase-1values-elicitation)
7. [Phase 2:身份測試](#7-phase-2身份測試)

**Turn 2 範圍預告**:Phase 3(主幹整合雙 path)+ Phase 4(Cascade Down 驗證)
**Turn 3 範圍預告**:Phase 5(Future Pacing + Let it Go + Export)+ 附錄 C(3 個原創情境)+ 整體收尾

---

## 1. 整體架構

### 1.1 5 Phase + Integration Retention Mode 主架構

```
┌─────────────────────────────────────────────────────────────────┐
│ Phase 1: Values Elicitation                                     │
│ - 起手式 / 強制翻轉 / 鏈式追問                                     │
│ - Top 1 判定(Containment Judgment)                              │
│ - milestone: top1_value 確定 + Goal Alignment Test 通過          │
│ - day range: min 1 / max 4 session days                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 2: 身份測試                                                 │
│ - 對 Top 1 做 Damon 身份測試(confirm + evidence)                 │
│ - 4 重組合判決(詞彙 × pattern × NOT-PPL × confirm)               │
│ - milestone: current_quality_status 確定(owned / ambiguous)     │
│ - day range: min 1 / max 2 session days                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌──────────────────────────────┐  ┌──────────────────────────────┐
│ Phase 3a: owned path         │  │ Phase 3b: ambiguous path     │
│ 4 步驟改變法                  │  │ Self-Concept 模型             │
│ - Build Vision               │  │ - Mapping Across             │
│ - Resistance + Parts         │  │ - 反例整合(40-90%)            │
│ - Let it Work                │  │ - 三向歸類                    │
│ day range: min 2 / max 4     │  │ - Scope Overlap              │
└──────────────────────────────┘  │ day range: min 3 / max 8     │
              │                   └──────────────────────────────┘
              │                                 │
              │     若 ambiguous path 完成      │
              │     → Top 1 升級 owned          │
              │     → 也進 owned path simplified│
              └─────────────┬───────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 4: Cascade Down 驗證                                       │
│ - 對 Top 2 / Top 3 重新做身份測試                                  │
│ - 通過 → cascade 成功 / 失敗 → 對該 value 子 Self-Concept         │
│ - milestone: values_ranking 全部處理完                            │
│ - day range: min 2 / max 4 session days                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
┌─────────────────────────────────────────────────────────────────┐
│ Phase 5: Future Pacing + Let it Go + Export                     │
│ - Future Pacing(身體場景化)                                       │
│ - takeaway 完整收尾                                                │
│ - Personal Coach Prompt Export(E4_export 觸發)                  │
│ - milestone: export_prompt_generated_at != null                 │
│ - day range: min 2 / max 3 session days                         │
└─────────────────────────────────────────────────────────────────┘
                              ↓
        ┌─────────────────────────────────────────────┐
        │ 若 session_day_count < 21:                  │
        │ → 進入 Integration Retention Mode            │
        │                                             │
        │ Day 8-21(或更早完成→更晚):                  │
        │ - Light touch follow up(5-10 turn/day)     │
        │ - Future Pacing 強化                         │
        │ - 觀察 quality 在生活 manifest                │
        │ - 不挖新 quality、不深化新技術                 │
        │ - Day 21 final wrap-up + export 二次更新     │
        └─────────────────────────────────────────────┘
                              ↓
                        calendar_day == 21
                              ↓
                        program 結束
```

### 1.2 設計原則

1. **Framework C 混合**:每 phase 有 min/max session day + milestone、提早完成不強拉、延後 cascade handoff
2. **Integration Retention Mode**:對齊 Damon「Let it Work」+ NLP Amnesia + 商業承諾 21 天不破
3. **流程導向、不重複話術**:本檔每 step 指向引擎 1-4 / 附錄 C、不重寫話術
4. **State machine 嚴格定義**:每 phase 有 entry/exit + state updates + cross-engine triggers,Patrick 直接落 phase-machine.js
5. **退場機制完整**:每 phase 都有 failure mode + handoff_escalation 路徑

---

## 2. Framework C:14-21 天彈性分布

### 2.1 Day Range 總表

| Phase | min session days | max session days | milestone |
|---|---|---|---|
| 1 Values Elicitation | 1 | 4 | top1_value 確定 + Goal Alignment Test 通過 |
| 2 身份測試 | 1 | 2 | current_quality_status 確定(owned / ambiguous) |
| 3a owned path | 2 | 4 | 4 步驟改變法完成 |
| 3b ambiguous path | 3 | 8 | top1_value 升級 owned |
| 4 Cascade Down | 2 | 4 | values_ranking 全處理(Top 2/3 owned 或 standalone) |
| 5 Future Pacing + Export | 2 | 3 | export_prompt_generated_at != null |

**極端範圍**:
- 最快(全 owned path):1+1+2+2+2 = **8 session days**
- 最慢(全 ambiguous path):4+2+8+4+3 = **21 session days**
- 標準分布:**12-15 session days**(對應「14-21 天彈性」中位數)

### 2.2 超出 max day 處理

任一 phase **session_day_count 超過 max** 仍未達 milestone:

1. **首次超出 max**:cascade 到附錄 A3.handoff_escalation
   ```
   AI 過渡話術:
   「我們在 [phase 名] 已經 [N] 天了、但還沒到 [milestone]。
    我想跟你確認:
    (a) 我們繼續往前推、可能要延長 1-2 天
    (b) 我們先跳到下一步、留個未完成、之後再回來
    (c) 我們暫停、跟 Vivi 1-on-1 評估
    你選哪個?」
   ```

2. **連續 3 phase 都超出 max**:`failure_signal_4` 觸發(對應方法論 6.10 信號 4「hard 上限 40 turn 連續 3 場」延伸到 phase 級)、HITL alert Vivi

3. **第二次同 phase 超出 max(學員選 a 延長後又超)**:強制 cascade 到 (c) 1-on-1 評估

### 2.3 提早完成 max 內處理

若學員提早完成 phase milestone(e.g. Phase 1 day 2 完成):

- 立刻進入下一 phase、不強迫拉滿 max
- 對應方法論 6.1「Damon 案例證據:1 day session 可完成、不強迫對齊 21 天」

→ 若全部 5 phase 提早完成、進入 **Integration Retention Mode**(§3)。

---

## 3. Integration Retention Mode

### 3.1 觸發條件

```yaml
integration_retention_mode_trigger:
  - all 5 phase milestones 完成
  - export_prompt_generated_at != null
  - session_day_count < 21
```

### 3.2 模式內 AI 動作 SOP

```yaml
integration_retention_mode_behavior:
  per_day_action:
    turn_budget: 5-10 turn / day(soft limit、不強推)
    
    主要動作:
      1. 開場:E4_day_opening_reference_selector
         - 變體偏好 V1(方向性繼續)/ V2(Future Pacing 引導)
         - 不觸發 V3 / V4(那是中斷處理、本模式無中斷)
      
      2. 中段:Future Pacing 強化(主對話 LLM 執行)
         - 「想像 [X 個月 / 1 年 / 5 年] 後的你、做著符合『[top1_value]』的事——
            身體在哪裡感覺到?」
         - 「最近一週、你哪個具體時刻、最像『[owned quality]』?」
         - 「[owned quality 1] 跟 [owned quality 2] 在哪個場景同時 manifest?」
      
      3. 觀察:寫進 quality_focus_history
         - 每天 anchor 強化記錄(append)、不 overwrite
         - 學員生活中 quality manifest 證據累積
      
      4. 收尾:E4_takeaway_planter
         - takeaway 強度降低(reinforce 而非 deepen)
         - 不種新 anchor、不挖新 quality
  
  禁止動作:
    - 不挖新 quality(elicitation_mode_active 保持 false)
    - 不深化新技術(不啟動新一輪 Self-Concept / Parts Integration)
    - 不主動引入 cached 內未用過的概念
    - 不評估「整合得好不好」(交給學員自評)
  
  Day 21 final wrap-up:
    - E4_export_personal_coach_prompt 二次觸發(更新版)
    - 含 retention 期間新累積的 anchor / quality_focus_history
    - 完整 21 天回顧 + Future Pacing(1-5 年場景)
```

### 3.3 Integration Retention 期間特殊處理

```yaml
special_handling:
  - 學員講出新 quality candidate:
      AI 回應:「我聽到『[新 quality]』。
              這個是不是『[top1_value]』的另一面?
              還是 separate 的東西?」
      → 若是 Top 1 同源 → 寫進 anchors(強化、不獨立 owned)
      → 若 separate → 暫存、不啟動新 Self-Concept、Day 21 export 時納入考量
  
  - 學員講出新 challenge / 卡住:
      AI 回應:「我們有兩個選擇:
              (a) 用『[top1_value]』的視角看這個 challenge
              (b) 先把這個 challenge 放著、program 後再深入
              你選哪個?」
      → 選 (a):快速應用 owned quality 給 perspective、不啟動新 phase
      → 選 (b):承認 + 暫存、retention 模式不被打斷
  
  - 學員講出深創傷 / worth-fiction 訊號:
      → cascade 到引擎 3 E3_deep_signal_detector(最高優先)
      → 不在 retention 模式內處理、handoff_escalation
```

### 3.4 商業承諾對齊

```yaml
business_alignment:
  - 學員體驗:「我在 Day [N] 找到了我是誰、後 [21-N] 天 AI 陪我把它沉下去」
  - 對齊 Damon Step 4「Let it Work」(不 over-process、給潛意識整合空間)
  - 對齊 v5.0 原創 IP #5 NLP Amnesia 主動整合機制
  - 21 天 program 完整、商業承諾不破
  - export 二次更新 = 額外價值(學員 perceive 為 bonus)
```

---

## 4. Day 定義:calendar vs session 雙計數

### 4.1 雙計數 framework

```yaml
calendar_day_count:
  range: 1+ (integer)
  initial_value: 1
  scope: user-scoped
  update_rule: |
    每經過一個 calendar day 自動 +1(對齊系統時鐘)
    不依賴學員是否 active
  used_by:
    - 引擎 4 gap_days 計算
    - program 結束判斷(calendar_day_count == 21 → program end)
    - E4_day_opening_reference_selector 變體挑選

session_day_count:
  range: 1+ (integer)
  initial_value: 1
  scope: user-scoped
  update_rule: |
    僅在 new_session_day == true(學員本日首次發 message)時 +1
    學員 skip 整天 → 不 +1
  used_by:
    - phase milestone max day enforcement
    - Integration Retention Mode 觸發判斷
```

### 4.2 兩者關係範例

```
Day 1 (calendar=1, session=1):學員活躍、完成 Phase 1
Day 2 (calendar=2, session=2):學員活躍、Phase 2
Day 3 (calendar=3, session=2):學員 skip、session_day 不變
Day 4 (calendar=4, session=3):學員回來、Phase 3a 開始
Day 5 (calendar=5, session=4):學員活躍
...
Day 8 (calendar=8, session=7):假設 5 phase 完成、進 Integration Retention
Day 21 (calendar=21, session=?):program 結束(無論 session_day_count 多少)
```

### 4.3 phase enforcement 邏輯

```yaml
phase_max_day_check:
  formula: |
    若 current phase 內的 session_day_count_within_phase > phase.max_day
    → trigger handoff_escalation(本檔 §2.2)
  
  reasoning: |
    用 session_day_count 而非 calendar_day_count、
    避免懲罰學員 skip(cancel 整天不算 phase 進度延遲)
```

### 4.4 program end 邏輯

```yaml
program_end_trigger:
  primary: calendar_day_count == 21
  secondary: 學員主動結束(設定中「結束 program」按鈕)
  
  action_on_end:
    - E4_export_personal_coach_prompt 觸發(若還沒做過、首次生成;若做過、二次更新)
    - E4_takeaway_planter final 版本(整 21 天回顧)
    - HITL Vivi notification(學員完成 program)
    - 學員可選:延長 21 天(付費 v5.1+) / 結束
```

---

## 5. Session State Fields(Checkpoint 1 新增)

### 5.1 current_phase

```yaml
session_state.current_phase:
  range: enum ["phase_1", "phase_2", "phase_3a", "phase_3b", "phase_4", "phase_5", "integration_retention", "program_completed"]
  initial_value: "phase_1"
  scope: session-scoped(但跨 day 不 reset、跟 phase milestone 對齊)
  update_rule: |
    依 phase entry/exit conditions 推進(本檔 §6+)
    跨 day 不 reset(學員 Day N+1 繼續同 phase)
  decay_per_turn: 0
  reset_on:
    - program restart(罕見、Vivi 手動觸發)
  cross_engine_consumers:
    - 引擎 1-4 contextual filters(知道當前 phase 上下文)
    - dashboard 監控
```

### 5.2 phase_progress

```yaml
session_state.phase_progress:
  range: object {
    current_phase: str,
    session_day_count_within_phase: int,
    entered_at_calendar_day: int,
    entered_at_session_day: int,
    milestone_status: enum ["in_progress", "completed", "overdue"]
  }
  initial_value: { current_phase: "phase_1", session_day_count_within_phase: 1, ... }
  scope: session-scoped(跨 day 不 reset、phase 切換時 overwrite)
  update_rule: |
    - 每個 new_session_day(在同 phase 內)→ session_day_count_within_phase += 1
    - phase 切換時 overwrite 整個 object
    - session_day_count_within_phase > phase.max_day → milestone_status = "overdue"
```

### 5.3 phase_history

```yaml
session_state.phase_history:
  range: list of objects
  initial_value: []
  scope: user-scoped(寫入 user_profile_evolution)
  update_rule: |
    每次 phase 完成或退出時 append:
    {
      phase: str,
      entered_at_calendar_day: int,
      exited_at_calendar_day: int,
      session_days_used: int,
      exit_reason: enum ["milestone_completed", "handoff_redirect", "handoff_skipped", "stuck"],
      key_outcomes: list  # e.g. ["top1_value=踏實", "Goal Alignment passed"]
    }
  used_by:
    - 引擎 4 E4_export_personal_coach_prompt(21 天回顧素材)
    - dashboard 監控
```

### 5.4 calendar_day_count + session_day_count

```yaml
session_state.calendar_day_count:
  (定義見本檔 §4.1)
  scope: user-scoped

session_state.session_day_count:
  (定義見本檔 §4.1)
  scope: user-scoped
```

### 5.5 integration_retention_mode_active

```yaml
session_state.integration_retention_mode_active:
  range: bool
  initial_value: false
  scope: session-scoped(但跨 day 不 reset)
  update_rule: |
    - false → true:5 phase milestones 全完成 + session_day_count < 21
    - true → false:calendar_day_count == 21(program end)
  cross_engine_consumers:
    - 引擎 4 E4_day_opening_reference_selector(挑變體偏好 V1/V2)
    - 主對話 LLM 行為調整(reinforce 而非 explore)
```

### 5.6 program_completed_at

```yaml
session_state.program_completed_at:
  range: timestamp | null
  initial_value: null
  scope: user-scoped
  update_rule: |
    calendar_day_count == 21 OR 學員主動結束 → 寫入 timestamp
  reset_on: 不 reset
```

---

## 6. Phase 1:Values Elicitation

### 6.1 Entry

```yaml
phase_1_entry:
  trigger_condition: |
    program 啟動(學員首次 active session)
    OR program restart
  
  entry_state_updates:
    session_state.current_phase: "phase_1"
    session_state.calendar_day_count: 1
    session_state.session_day_count: 1
    session_state.phase_progress: {
      current_phase: "phase_1",
      session_day_count_within_phase: 1,
      entered_at_calendar_day: 1,
      entered_at_session_day: 1,
      milestone_status: "in_progress"
    }
    session_state.elicitation_mode_active: true
    session_state.router_phase: "opening"
    session_state.opening_branch_handled: false
  
  cross_engine_triggers_on_entry:
    - 引擎 3 E3_opening_branch_router(若學員開場觸發特殊分支)
    - 主對話 LLM 走 Damon Values Elicitation 起手式
```

### 6.2 Internal Step Sequence(SOP)

```yaml
phase_1_steps:
  
  step_1_opening:
    description: |
      第一個 user message 後、AI 執行 Values Elicitation 起手式。
      若觸發特殊開場(「我卡住了」/「我老是搞砸」/「我不夠好」)、
      由引擎 3 E3_opening_branch_router 處理 reframe、然後接 step 2。
    
    references:
      - 引擎 3 §4.3 E3_opening_branch_router(完整話術骨架)
      - cached_4_7_router_reference 內【特殊開場分支 reframe 範本】
    
    AI 起手式話術骨架(若無特殊開場):
      > 「我想先聽你說——
      > 你現在想要什麼?
      > 不是『不要什麼』、是你**真正想要**的東西。」
    
    exit_to_step_2:
      - 學員給出 1 個初步 want 描述
      - opening_branch_handled = true(若觸發特殊開場)
  
  step_2_chain_questioning:
    description: |
      Damon 鏈式追問引擎:What will that do for you? / What's important?
      目標:從初步 want 鏈式追問到 3-5 個 values
    
    AI 話術(主對話 LLM 即興、有引擎 1 偏離治理 guard rail):
      - 「[學員 want]——這對你來說、會帶來什麼?」
      - 「『[學員回應]』、這個對你來說、為什麼重要?」
      - 「沒有『[學員回應]』、會發生什麼?」
    
    禁止:
      - 不問 Why(Damon 禁區)
      - 不引導學員到特定 value(讓學員自己浮現)
      - 不接受模糊回答(引擎 1 E1b 處理)
    
    cross_engine_active:
      - 引擎 1 持續監測偏離(E1a-E1d)
      - 引擎 2 E2_master_detector 監聽 Quality 詞 / 身份句出現(本 step 通常不觸發、但 ready)
    
    exit_to_step_3:
      - session_state.values_collected_list.length >= 3
  
  step_3_top1_determination:
    description: |
      Values 採集達 3+ 後、進入 Top 1 判定。
      不用線性排序、用 Containment Judgment + 存在依賴測試。
    
    references:
      - 引擎 3 §4.4 E3_top1_determination(完整 8-step SOP)
      - 引擎 3 cached_4_7_router_reference 內【Top 1 判定 SOP】
    
    cross_engine_triggers:
      - E3_top1_determination 觸發(本 step 主動 inject)
      - A5.containment_logic_judge(Haiku)Step 5 評估
    
    exit_to_step_4:
      - session_state.top1_value != null
      - session_state.values_ranking 填入 Top 1-5
  
  step_4_goal_alignment_test:
    description: |
      Damon 經典 Goal Alignment Test:
      「原本目標真能帶你到這裡嗎?」
    
    AI 話術:
      > 「先停一下。
      > 你現在知道你的 values:[列 top 3]。
      > 回頭看你一開始想要的目標——
      > **這個目標真的能帶你到『[top1_value]』這裡嗎?**」
    
    分支:
      - 學員確認原目標仍對齊 → exit to phase 2
      - 學員改目標 → 短回 step 2 chain_questioning 重新校準、收集 new goal
      - 學員 PPL 配合「應該是吧」 → 引擎 1 E1c 接手治理
    
    exit_to_phase_2:
      - Goal Alignment 確認 / 新目標收集完
      - session_state.elicitation_mode_active = false
      - session_state.router_phase = "identity_test_routing"
```

### 6.3 Exit Conditions

```yaml
phase_1_exit:
  milestone_completion:
    primary: |
      session_state.top1_value != null
      AND Goal Alignment Test 完成
    
    on_exit_state_updates:
      session_state.current_phase: "phase_2"
      session_state.elicitation_mode_active: false
      session_state.router_phase: "identity_test_routing"
      session_state.phase_progress: { overwrite to phase_2 init }
      session_state.phase_history: append phase_1 record
    
    cross_engine_triggers_on_exit:
      - 引擎 2 E2_identity_test_master_detector 啟動(對 top1_value 做身份測試)
  
  max_day_overdue:
    trigger: session_day_count_within_phase > 4(phase 1 max)
    action: 本檔 §2.2 handoff_escalation(三選一)
  
  cascade_to_deep_signal:
    trigger: E3_deep_signal_detector 觸發
    action: phase 暫停、進入 deep_signal_handoff、學員選擇後可能 redirect 回 phase 1 或結束 program
```

### 6.4 Failure Modes

```yaml
phase_1_failure_modes:
  
  - id: P1
    mode: "學員給的初步 want 模糊到無法鏈式追問"
    例: "「我想要快樂」「我想要平靜」"
    mitigation: |
      引擎 1 E1d(bypassing)接手、5 層撥開技術應用、
      撥到具體事件後重啟鏈式追問。
  
  - id: P2
    mode: "values_collected_list 達 3+ 但學員的 values 互相矛盾"
    例: "「自由」+「安全」+「家人優先」三者不相容"
    mitigation: |
      Containment Judgment 設計就是解這個——
      存在依賴測試會找出哪個 value 包含其他、不假設 values 必須相容。
      若仍卡:cascade A3.handoff_escalation 三選一。
  
  - id: P3
    mode: "Goal Alignment Test 學員拒絕回答 / 模糊回答"
    mitigation: |
      引擎 1 E1c PPL 治理(若是配合)/ E1b 敷衍治理(若是模糊)、
      不在 phase 1 內無限循環、超出 max day 觸發 handoff。
  
  - id: P4
    mode: "step 3 Top 1 判定 Linear Thinking Error 持續無法切換 Containment 邏輯"
    mitigation: |
      引擎 3 §4.4 H7 已 cover——cascade A3.handoff_escalation 變體。
  
  - id: P5
    mode: "Phase 1 day 1 學員講出 spiritual_big_words『整合』『覺醒』直接 elicitation"
    mitigation: |
      引擎 2 E2_identity_test_master_detector 的 F2 防護:
      elicitation_mode_active + recent_specific_examples_count >= 2 才不判 bypassing。
      Phase 1 早期 recent_specific_examples 通常 < 2、bypassing 會被偵測、
      引擎 1 E1d 5 層撥開撥到具體事件。
```

---

## 7. Phase 2:身份測試

### 7.1 Entry

```yaml
phase_2_entry:
  trigger_condition: |
    Phase 1 milestone completed
    + top1_value != null
    + Goal Alignment Test 通過
  
  entry_state_updates:
    session_state.current_phase: "phase_2"
    session_state.elicitation_mode_active: false  # 已切換、不再採集
    session_state.router_phase: "identity_test_routing"
    session_state.current_quality_candidate_term: top1_value(主動填入,因為 phase 2 對 Top 1 做身份測試)
    session_state.phase_progress: { overwrite to phase_2 init }
  
  cross_engine_triggers_on_entry:
    - 引擎 2 E2_identity_test_master_detector ready
    - 引擎 2 E2_aggregator 觸發等待學員回應
    - 引擎 3 E3_status_router 預備消費 current_quality_status
```

### 7.2 Internal Step Sequence(SOP)

```yaml
phase_2_steps:
  
  step_1_initiate_identity_test:
    description: |
      AI 主動發起 Damon 身份測試問句、不等學員自己講身份句。
      這是 Phase 2 跟 Phase 1 的核心差別——
      Phase 1 是 elicitation(被動接學員 quality)、
      Phase 2 是 active test(AI 主動發問)。
    
    references:
      - 引擎 2 §4.2 E2_aggregator 重 4 step 4a / 4b(confirm + evidence)
    
    AI 話術:
      > Step 1a — confirm:
      > 「我們花了時間挖到『[top1_value]』。
      > 我想直接問你:
      > **你是一個『[top1_value]』的人嗎?**」
      > 
      > (等學員回應、約 3-5 turn 內)
      > 
      > Step 1b — evidence:
      > 「好。你說你是一個『[top1_value]』的人——
      > 把過去你做過、最能證明這點的一兩件具體的事情、說給我聽。」
    
    cross_engine_active:
      - 引擎 2 E2_aggregator 對學員回應做 4 重組合判決
      - A1.sensory_detail Haiku judge 評估 evidence 回應(>= 2 markers)
    
    exit_to_step_2:
      - 引擎 2 aggregation_result 輸出
      - current_quality_status 寫入(owned / ambiguous / candidate)
  
  step_2_classification:
    description: |
      根據引擎 2 判決結果、phase 2 分流到 phase 3a / phase 3b / cascade。
      本 step 不執行被路由到的內容、僅 handoff。
    
    references:
      - 引擎 3 §4.5 E3_status_router(主路由)
    
    分支:
      
      若 current_quality_status == "owned":
        → phase 2 milestone 完成
        → exit to phase 3a(owned path、4 步驟改變法)
      
      若 current_quality_status == "ambiguous":
        → phase 2 milestone 完成
        → exit to phase 3b(ambiguous path、Self-Concept 模型)
      
      若 current_quality_status == "candidate":
        → phase 2 milestone 未完成、繼續 step 1 收 evidence
        → 若 session_day_count_within_phase > 2(phase 2 max day):
            cascade handoff(本檔 §2.2)
      
      若 current_quality_status == "none"(極罕見):
        → top1_value 判斷可能有誤
        → cascade 回 Phase 1 step 3 重新做 Top 1 判定
        → 同時 HITL alert(這場 Phase 1 出口判斷有問題)
  
  step_3_phase_3_handoff:
    description: |
      phase 2 milestone 完成、handoff 到 phase 3a 或 3b。
      AI 過渡話術由 E3_status_router prompt_content 處理、本檔不重寫。
    
    references:
      - 引擎 3 §4.5 prompt_content(owned / ambiguous 過渡話術)
    
    exit_to_phase_3:
      - phase_progress 寫入 phase 2 退出記錄
      - phase_history append
      - current_phase 切到 "phase_3a" 或 "phase_3b"
```

### 7.3 Exit Conditions

```yaml
phase_2_exit:
  
  milestone_completion_owned:
    trigger: current_quality_status == "owned"
    next_phase: phase_3a (owned path、4 步驟改變法)
    on_exit_state_updates:
      session_state.current_phase: "phase_3a"
      session_state.next_action: "build_vision"
  
  milestone_completion_ambiguous:
    trigger: current_quality_status == "ambiguous"
    next_phase: phase_3b (ambiguous path、Self-Concept 模型)
    on_exit_state_updates:
      session_state.current_phase: "phase_3b"
      session_state.next_action: "self_concept_model"
  
  max_day_overdue:
    trigger: session_day_count_within_phase > 2
    action: 本檔 §2.2 handoff_escalation
    likely_cause: "current_quality_status stuck at 'candidate'、evidence 不夠"
    
    特殊處理:
      若 stuck 原因是 Haiku A1 持續 fail(學員 evidence sensory_detail_score < 2):
      → handoff 三選一變體 D:
         「我們花了 [N] 天確認『[top1_value]』、但 evidence 始終不夠具體。
          我想問你:
          (a) 換另一個 value 試試(回 Phase 1 重新 Top 1 判定)
          (b) 我們直接走 ambiguous path、不強迫 owned
          (c) 暫停跟 Vivi 1-on-1 評估
          你選哪個?」
  
  cascade_to_deep_signal:
    trigger: E3_deep_signal_detector 觸發
    action: phase 暫停、handoff、學員選擇後 redirect
  
  edge_case_no_quality:
    trigger: current_quality_status == "none"(top1_value 判斷錯誤)
    action: cascade 回 Phase 1 step 3、重新做 Top 1
    HITL_alert: true
```

### 7.4 Failure Modes

```yaml
phase_2_failure_modes:
  
  - id: P6
    mode: "學員快速答 Yes 但 evidence 都是過去式『曾經』"
    例: "「我以前是個踏實的人、但這幾年變了」"
    mitigation: |
      引擎 2 §4.2 G4 已 cover——升級 owned 但標 quality_status = "owned_was"、
      Phase 3a 走 4 步驟改變法時、Build Vision 強化「現在 + 未來」維度、
      不假設「現在已經 owned」。
  
  - id: P7
    mode: "學員給的 evidence 全部關於『他人怎麼看我』(外部驗證)"
    例: "「朋友都說我很踏實」「我老闆覺得我穩」"
    mitigation: |
      Haiku A1.sensory_detail 判斷時、應降低「他人視角 evidence」評分:
      - has_person_marker = true(但是他人、不是自己)
      - 內部評分:if all markers are about others → score - 1
      
      若 evidence 全部外部:E2_stay_candidate 變體 A 觸發、
      要求學員從**自己視角**舉具體事件、不接受他人視角。
      
      工程實作:Haiku A1 prompt 加強指引「區分 self-evidence vs others-evidence」。
  
  - id: P8
    mode: "Phase 2 day 1 直接 owned(學員強烈認領 + evidence 充足)"
    mitigation: |
      合法、phase 2 max day = 2 是上限、min day = 1 是下限。
      Day 1 直接 owned → phase 2 提早完成、進 phase 3a。
      不要刻意拖 phase 2 到 day 2。
  
  - id: P9
    mode: "學員 evidence 充足但身份測試 confirm 回答「不是」/「不完全是」"
    例: "AI 問「你是一個踏實的人嗎」、學員「不算是、我覺得我比較像在學習踏實的人」"
    mitigation: |
      這是合法的 ambiguous 自我認識、不應算 PPL 反彈。
      引擎 2 處理:
      - current_quality_status → "ambiguous"
      - 學員回應「在學習」這類措辭 → 寫進 anchors 但不 owned
      - 路由到 Phase 3b Self-Concept 模型
```

---

## Turn 1 收尾

### 本 Turn 完成範圍

✅ 整體架構 + 5 Phase + Integration Retention Mode 主架構  
✅ Framework C(min/max day + milestone)+ 超出 max / 提早完成處理  
✅ Integration Retention Mode 完整 SOP  
✅ Day 雙計數 framework(calendar + session)  
✅ Checkpoint 1 新增 session_state fields(6 個)  
✅ Phase 1 完整 spec(entry / 4 steps / exit / 5 failure modes)  
✅ Phase 2 完整 spec(entry / 3 steps / exit / 4 failure modes)  

### Turn 2 預告

- Phase 3a(owned path、4 步驟改變法)完整 spec
- Phase 3b(ambiguous path、Self-Concept 模型)完整 spec
- Phase 4(Cascade Down 驗證)完整 spec
- 跨 Phase 3a ↔ Phase 3b 銜接邏輯(若 ambiguous path 完成升級 owned、進 phase 3a simplified)

### Turn 3 預告

- Phase 5(Future Pacing + Let it Go + Export)完整 spec
- 附錄 C:3 個 5.7.4 原創情境話術
- 跨引擎合約總表
- Patrick 接手清單(migration 014 phase 欄位)
- Forward references + dashboard 整合

---

## 文件版本

- v0.1 Turn 1 (2026-05-19):Framework C + Integration Retention Mode + Phase 1-2
- 待後續:Turn 2 / Turn 3 完成後合併最終版
