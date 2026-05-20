# v5.0 Beta Failure Signals Dashboard

> **文件用途**:v5.0 Beta 階段監控 + HITL alert + A001 corpus 校準的完整 spec。**設計師端 spec 任務最後一份、收尾文件**。
>
> **建立日期**:2026-05-20
>
> **對應方法論**:`damon_methodology.md` 6.10(v5.0 必須監控的 4 個失敗訊號)、6.11(設計層級取捨)
>
> **對應 TODO**:`v5_next_actions.md` Beta 階段運維機制
>
> **版本**:設計師對話版 v0.1
>
> **依賴關係**:依賴引擎 1-4 + Checkpoint 1 全部已 ship。Dashboard 是「監控層」、不執行業務邏輯、只觀察 + alert。

---

## ⚠️ Scope Warning

本檔範圍:
- ✅ 6.10 失敗訊號 1-4 完整內嵌 + 工程實作 spec
- ✅ F/G/H/J/P/C series failure modes 集中追蹤(共 ~70 個 failure modes)
- ✅ Aggregate metrics + dashboard 視圖
- ✅ HITL alert rules(threshold + 何時 ping Vivi)
- ✅ A001 corpus 校準指引

本檔範圍排除:
- ❌ 不重寫 failure mode 本身邏輯(指向各引擎檔)
- ❌ 不寫前端 dashboard UI 細節(Patrick 工程範圍)
- ❌ 不寫 alert 通訊管道(Email / Slack / SMS、Patrick 選擇)

---

## 目錄

1. [Dashboard 整體架構](#1-dashboard-整體架構)
2. [方法論 6.10 失敗訊號 1-4 完整 spec](#2-方法論-610-失敗訊號-1-4-完整-spec)
3. [Failure Modes 集中追蹤](#3-failure-modes-集中追蹤)
4. [Aggregate Metrics(總體指標)](#4-aggregate-metrics)
5. [HITL Alert Rules](#5-hitl-alert-rules)
6. [A001 Corpus 校準指引](#6-a001-corpus-校準指引)
7. [Patrick 接手清單](#7-patrick-接手清單)
8. [收尾:設計師端 spec 100% 完成](#8-收尾)

---

## 1. Dashboard 整體架構

### 1.1 三層監控架構

```
┌──────────────────────────────────────────────────────────────────┐
│ Layer 1: Real-time signals(每 turn / 每 session 觸發)             │
│ - 6.10 失敗訊號 1-4 即時偵測                                        │
│ - F/G/H/J/P/C series failure modes 觸發計數                       │
│ - 即時 HITL alert(severity = high 立即 ping)                      │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ Layer 2: Per-student aggregate(每學員、跨 session)                 │
│ - phase 進度 / regression rate                                    │
│ - cumulative failure mode 觸發累積                                 │
│ - engagement metrics(active days / turn density)                 │
│ - Haiku judge accuracy / confidence distribution                 │
└──────────────────────────────────────────────────────────────────┘
                              ↓
┌──────────────────────────────────────────────────────────────────┐
│ Layer 3: Cohort-level analysis(Beta 全體、設計校準)                │
│ - failure mode 觸發率 distribution                                 │
│ - phase max day 超出率                                             │
│ - cross-engine state inconsistency rate                          │
│ - A001 corpus 校準輸入                                             │
└──────────────────────────────────────────────────────────────────┘
                              ↓
              ┌──────────────────────────────────┐
              ▼                                  ▼
        HITL Alert Vivi              Design Iteration(下版)
```

### 1.2 設計原則

1. **不執行業務邏輯**:Dashboard 只觀察 + alert、所有 mitigation 由引擎 1-4 / Checkpoint 1 處理
2. **多 layer 分離**:Real-time(緊急)/ Per-student(學員體驗)/ Cohort(設計校準)三層職責清楚
3. **HITL alert 不打擾**:嚴格 threshold + 去重邏輯、避免 Vivi 被淹沒
4. **A001 corpus 是 ground truth**:Beta 階段所有 threshold 校準回到 A001 真實對話

---

## 2. 方法論 6.10 失敗訊號 1-4 完整 spec

> 本節是 `damon_methodology.md` §6.10 失敗訊號 1-4 的完整工程實作 spec、內嵌全文 + 對應監控邏輯。

### 2.1 信號 1:Session Takeaway Tag 累積 Negative

```yaml
signal_1_negative_takeaway_accumulation:
  
  方法論原文: |
    累積 3 場 negative tag = 強制 escalation alert 給 Vivi
    → 不是 prompt 調整可解、是架構重審訊號
  
  設計根據: |
    A001 親測 Day 3 留下「無力」(反向轉化)
    = Damon 視角下「教練做錯了」的明確 indicator
  
  trigger_logic:
    每場 session 結束、E4_takeaway_planter 寫入 last_session_day_summary 時、
    Haiku judge 評估 takeaway 的「情緒方向」:
    
    judgment_method: Haiku_4.5_tool_call(新 instance、A6.takeaway_sentiment)
    output_schema:
      takeaway_sentiment: enum["positive", "neutral", "negative"]
      reasoning: str
      confidence: "high" | "medium" | "low"
    
    negative 判斷依據:
      - 學員結尾講「無力」「失望」「沒用」「卡住」「我做不到」
      - 學員結尾語氣明顯沮喪、收縮、放棄
      - 主動 fade out(學員自己快速結束、不等 AI takeaway 完成)
  
  alert_threshold:
    - 1 場 negative: 寫入 negative_takeaway_count、不 alert
    - 2 場 negative: per-student alert(設計師 review、不打擾 Vivi)
    - 3 場 negative: 強制 HITL alert Vivi(severity = critical)
  
  alert_action:
    - 不是「再 tune prompt」、是「**架構重審**」訊號
    - 學員可能需要轉介人類教練、program 結構可能需要 redesign
  
  state_field:
    user_profile_evolution.negative_takeaway_count:
      range: 0+ (integer)
      initial_value: 0
      update_rule: 每場 session Haiku judge 判 negative → +1
      reset_on: 不 reset(累積追蹤)
```

### 2.2 信號 2:NLP Amnesia 機制失敗

```yaml
signal_2_nlp_amnesia_failure:
  
  方法論原文: |
    學員連續 3 場開場「斷掉了」「忘記了」
    → NLP Amnesia 機制失敗訊號
    → 可能需要回退到當天 Future Pacing
  
  trigger_logic:
    每場 new_session_day 開場、E4_day_opening_reference_selector 觸發後、
    偵測學員首個回應是否命中「斷掉訊號」:
    
    regex_patterns:
      - "(斷掉|斷了|忘了|忘記了|沒印象|想不起來|腦袋空|失憶)"
      - "(那是誰|什麼東西|我有講過嗎|不記得有講)"
      - "「?」單一回應(學員看到引用但完全 disconnected)"
    
    state_field:
      session_state.amnesia_signal_this_session: bool(per-session、跨 day reset)
      user_profile_evolution.consecutive_amnesia_sessions: int(跨 session 累積)
    
    update_rule:
      - 本場開場命中 → consecutive_amnesia_sessions += 1
      - 本場開場未命中 → consecutive_amnesia_sessions reset 0
  
  alert_threshold:
    - 1 次:無 alert(可能正常忘記)
    - 2 次連續:設計師 review(查看 Day N+1 引用變體挑選是否錯誤)
    - 3 次連續:HITL alert Vivi(severity = high)
  
  alert_action:
    - 重新評估該學員 quality_focus_history 是否真的有 owned anchor
    - 可能需要回退到當天 Future Pacing(不跨 day、強化整合)
    - Beta 階段:若全體 > 15% 觸發、v5.0 原創 IP #5 NLP Amnesia 主動整合機制需驗證失敗、redesign
```

### 2.3 信號 3:People Pleasing 持續發生

```yaml
signal_3_persistent_people_pleasing:
  
  方法論原文: |
    學員 People Pleasing 持續發生(5.7 引擎觸發 ≥ 5 次)
    → AI 對抗性不足
    → 不是學員問題、是 prompt 對抗性需提升
  
  trigger_logic:
    引擎 1 E1c 觸發每次計數:
    
    state_field:
      user_profile_evolution.e1c_trigger_count_total: int(跨 session 累積)
      session_state.e1c_trigger_count_this_session: int(per session)
    
    update_rule:
      - E1c sub-prompt 每次 inject → e1c_trigger_count_total += 1
      - E1c sub-prompt 每次 inject → e1c_trigger_count_this_session += 1
  
  alert_threshold:
    - same session 內 e1c_trigger_count_this_session >= 3: dashboard 警示
    - cumulative e1c_trigger_count_total >= 5(跨 session): HITL alert Vivi(severity = high)
  
  alert_action:
    - 不是調整這個學員的 prompt、是**全體 prompt 對抗性 redesign**
    - Beta 階段:設計師 review E1c 話術強度、可能需要加重「我不喜歡這個答案」變體
    - 若多名學員都觸發:E1c PPL 治理整體 redesign
```

### 2.4 信號 4:Hard 上限 40 Turn 連續觸發

```yaml
signal_4_hard_limit_consecutive:
  
  方法論原文: |
    學員 hit hard 上限(40 turn)連續 3 場
    → level 出口判斷可能過嚴
    → 4 重組合需要調整
  
  trigger_logic:
    每場 session 結束、檢查 turn_count:
    
    state_field:
      session_state.turn_count_this_session: int
      session_state.hard_limit_hit_this_session: bool(turn_count >= 40)
      user_profile_evolution.consecutive_hard_limit_sessions: int
    
    update_rule:
      - turn_count >= 40 → hard_limit_hit_this_session = true → consecutive_hard_limit_sessions += 1
      - turn_count < 40 → consecutive_hard_limit_sessions reset 0
  
  alert_threshold:
    - 1 場:無 alert
    - 2 場連續:設計師 review(該學員 phase 進度評估)
    - 3 場連續:HITL alert Vivi(severity = high)
  
  alert_action:
    - 引擎 2 E2_aggregator 4 重組合可能過嚴
    - Beta 階段:tune Haiku A1 threshold(從 score >= 2 降到 >= 1?)
    - 或 tune phase max day(若是 phase 結構問題、不是 4 重組合問題)
    - 區分依據:
      - 學員每場都在做 Phase 2 身份測試 evidence 收集 → 4 重組合過嚴
      - 學員每場都在 Phase 3b ambiguous path 卡 → phase 結構問題
```

---

## 3. Failure Modes 集中追蹤

### 3.1 全體 failure modes 對照表

> 引擎 1-4 + Checkpoint 1 + 附錄 C 共 **~70 個** failure modes。本節集中列出每個 id + 觸發來源 + severity + alert action,**不重寫 mitigation**(指向原檔)。

#### F-series(引擎 1:對話偏離識別)

| ID | 觸發 | severity | alert |
|---|---|---|---|
| F1 | 亞洲內斂學員短話被 short_compliance 全打中 | low | 累積監控 |
| F2 | values elicitation 階段「自由」被 spiritual_big_words 命中 | low | 累積監控 |
| F3 | classifier 判 false_positive 但實為真偏離 | medium | per-student review |
| F4 | values elicitation 大詞誤判 bypassing | medium | per-student review |
| F5 | explicit_protest 命中但分類器仍誤分 | high | 即時 HITL |
| F6 | consecutive_offtopic_turns >= 3 | medium | per-student review |
| F7 | 重述變機械複誦引發 explicit_protest | medium | per-student review |
| F8 | 學員真的不知道、不是敷衍 | low | 累積監控 |
| F9 | E1b 變體 B 強度過高、break rapport | high | 即時 HITL |
| F10 | 亞洲內斂學員被判 PPL | medium | per-student review |
| F11 | 「我不喜歡這個答案」直譯到中文讀感過直 | low | Beta 校準 |
| F12 | requires_typing 執行不力、仍 PPL 內容 | medium | per-student review |

#### G-series(引擎 2:身份測試判決)

| ID | 觸發 | severity | alert |
|---|---|---|---|
| G1 | PPL 假陽性:學員 echo AI 命中 quality 詞表 | medium | per-student review |
| G2 | 學員講出非標準 quality 詞(如「鑽石」)、regex 不命中 | low | 監控、合法情境 |
| G3 | 重 4 confirm 過、但 quality 詞是 PPL 殘留 | medium | per-student review |
| G4 | ambiguous 階段 evidence 是過去式「曾經」 | medium | 標 owned_was、Beta 校準 |
| G5 | 重 1 lexical 詞表漏網 | low | Beta 校準 |
| G6 | A001 Day 1「鑽石」類型錯誤升級 | **critical** | **即時 HITL + Beta 校準核心**|

⭐ **G6 是 Beta 階段最重要的監控訊號**——4 重組合是否真防住 A001 Day 1 假陽性災難重演。

#### H-series(引擎 3:4.7 中央路由器)

| ID | 觸發 | severity | alert |
|---|---|---|---|
| H1 | 深訊號誤判(事實陳述被當深創傷) | low | 監控、handoff 可吸收 |
| H2 | 學員選擇後下一 turn 又冒出深訊號 | high | 即時 HITL |
| H3 | 亞洲學員深訊號偵測 recall 過低 | medium | **Beta 校準核心** |
| H4 | 學員拒絕 Curiosity Reframe | medium | per-student review |
| H5 | 分支 B 學員堅持「為什麼搞砸」 | low | 話術升級即可 |
| H6 | opening_branch_handled = true 後又「卡住」 | low | route 到 E1b |
| H7 | Linear Thinking Error 連續 2 次無法切換 | medium | per-student review |
| H8 | Goal Alignment Test 學員改目標 | medium | per-student review |
| H9 | Top 1 確定後學員反悔 | medium | 1 次允許、2 次 handoff |
| H10 | 引擎 2 status 與引擎 3 路由邏輯衝突 | high | 即時 HITL(cross-engine bug)|
| H11 | Top 2 失敗 → mini Self-Concept 也失敗 → 循環 | medium | retry 2 次後 stuck |
| H12 | values_ranking 只有 Top 1、無 Top 2-3 | low | 合法、跳 Cascade Down |

#### J-series(引擎 4:AI 主動引用機制)

| ID | 觸發 | severity | alert |
|---|---|---|---|
| J1 | LLM judge 選錯變體 | medium | Beta 校準 distribution 監控 |
| J2 | user_profile_evolution.anchors 為空(Day 2)| low | 不觸發 inject 即可 |
| J3 | 學員回應引用後「不想再講」 | medium | cascade A3、累積 3 次 HITL |
| J4 | takeaway_seeded_this_session = true 但學員繼續打字 | low | 自然回應 |
| J5 | Step 1 複述句抓錯(抓到 PPL 配合句)| high | 即時 HITL |
| J6 | values_ranking 不完整(只 Top 1)| low | 跳過、合法 |
| J7 | user_profile_evolution 資產不完整 | medium | partial export |
| J8 | 學員多次 export(updating)| low | 合法、覆寫 |

#### P-series(Checkpoint 1:21 天 daily session 結構)

| ID | 觸發 | severity | alert |
|---|---|---|---|
| P1 | 初步 want 模糊到無法鏈式追問 | low | E1d 接手 |
| P2 | values 互相矛盾 | medium | Containment Judgment 解 |
| P3 | Goal Alignment Test 學員拒答 | medium | E1c/E1b 治理 |
| P4 | Top 1 判定 Linear Thinking Error 持續無法切換 | medium | per-student review |
| P5 | Phase 1 day 1 spiritual_big_words | low | E1d 撥開 |
| P6 | 快速答 Yes 但 evidence 都過去式 | high | **標 owned_was、Beta 核心關注** |
| P7 | evidence 全部「他人說我是」(外部驗證) | **critical** | **A1 dimension 2 防護、Beta 核心** |
| P8 | Phase 2 day 1 直接 owned | low | 合法、不拖 |
| P9 | evidence 充足但回答「不算是」 | medium | 走 ambiguous、合法 |
| P10 | Build Vision dissociated → associated 過渡失敗 | medium | **phase 倒退路徑、Beta 核心** |
| P11 | Resistance 不歸 5 種類型 | medium | handoff A3 |
| P12 | Let it Work 學員 push 繼續挖 | medium | 不破例 |
| P13 | Build Vision 不對應 top1_value | medium | Containment Judgment 解 |
| P14 | reference quality 連續 3 次都 ambiguous | high | per-student review |
| P15 | 亞洲學員避反例(主動引出失敗)| medium | E1c + requires_typing |
| P16 | 三向歸類全 (a) consistent(PPL 配合) | high | HITL |
| P17 | Step 4c evidence 是 boundary 不是 target | medium | per-student review |
| P18 | Binary 框架不接受 Scope Overlap | medium | owned_via_acceptance |
| P19 | Top 2 反覆 failed | medium | handoff variant |
| P20 | Top 2 derived evidence(從 Top 1 套) | **critical** | **A1 dimension 3 防護、Beta 核心** |
| P21 | Phase 1 latent conflict Phase 4 才浮現 | high | cascade 回 Phase 1、HITL |
| P22 | 3 時間維度 vision 不一致 | low | Containment 找 common thread |
| P23 | Let it Go 學員拒絕「放下」 | medium | 不破例、handoff variant |
| P24 | Export 不滿意 | low | 累積 > 10% redesign |
| P25 | Day 8 早完成失落感 | low | Integration Retention 吸收 |

#### C-series(附錄 C 原創情境)

| ID | 觸發 | severity | alert |
|---|---|---|---|
| C1 | Topic resistance 所有 alternative 都拒 | medium | handoff A3 |
| C2 | Mid-session 連續 3 場觸發 | medium | per-student review |

### 3.2 Critical Failure Modes(Beta 階段核心關注)

從上表抽出 **6 個 critical / Beta 核心**(必須 dashboard top priority):

```yaml
critical_failure_modes:
  
  G6_diamond_false_positive:
    description: "A001 Day 1「鑽石」類型錯誤升級 owned"
    why_critical: "v5.0 設計核心驗證指標、4 重組合是否真擋住 A001 災難"
    monitoring:
      - 任何學員觸發 owned upgrade 但 4 重組合裡 confirm 重 evidence < 3 markers
      - 立即 HITL Vivi、freeze 該學員 session、設計師 review
    target: "Beta 100 學員、G6 觸發次數 = 0"
  
  P6_past_tense_evidence:
    description: "學員講「我以前是踏實」evidence 全過去式"
    why_critical: "owned vs owned_was 區分核心、影響 Phase 3a Build Vision 質量"
    monitoring:
      - Haiku A1 加 dimension(可選):tense_marker (past / present / future)
      - 標 owned_was 比率追蹤
    target: "owned_was 比率 < 20% / Beta cohort"
  
  P7_external_validation_evidence:
    description: "evidence 全部「他人說我是」"
    why_critical: "Damon 無人鼓掌測試核心、A1 dimension 2 防護驗證"
    monitoring:
      - Haiku A1 evidence_attribution = "others" 命中率
      - 觸發後 E2_stay_candidate 變體 A 是否成功要求 self-evidence
    target: "P7 mitigation 成功率 > 80%"
  
  P10_phase_3a_to_3b_regression:
    description: "Build Vision dissociated → associated 失敗、phase 倒退"
    why_critical: "Phase 2 身份測試判決準確性指標"
    monitoring:
      - phase_3a_to_3b_regression_count(per session)
      - Beta cohort 整體 regression rate
    target: "regression rate < 20%"
    redesign_trigger: ">= 20% → Phase 2 4 重組合 confirm threshold 過寬、需 tune"
  
  P20_top2_derived_evidence:
    description: "Top 2 evidence 是 Top 1 derived(『踏實做事所以用心』)"
    why_critical: "Cascade Down 獨立性驗證、A1 dimension 3 防護"
    monitoring:
      - Haiku A1 derived_from_another_value = true 命中率
      - Top 2 / Top 3 owned 是否真獨立
    target: "derived 觸發率 < 15% per Cascade Down"
  
  H3_asian_deep_signal_recall:
    description: "亞洲學員深訊號偵測 recall 過低"
    why_critical: "深創傷學員可能漏網、安全風險"
    monitoring:
      - deep_signal_flags 觸發率 / Beta cohort
      - HITL Vivi 反饋(學員實際是否有深創傷但 AI 漏偵)
    target: "深訊號觸發率 5-10%(過低 = 漏偵、過高 = 誤判)"
```

---

## 4. Aggregate Metrics

### 4.1 Engagement Metrics

```yaml
engagement_metrics:
  
  daily_active_rate:
    formula: |
      count(students with at least 1 message today) / total_beta_students
    target:
      - Phase 1-5: > 80% daily active
      - Integration Retention Mode: > 60% daily active
    alert: "全體 < 50% 連續 3 天 → Beta 整體有結構問題"
  
  session_duration:
    formula: per session、turn_count + minutes_active
    distribution:
      - mean turn_count per session: target 15-25(soft limit 25)
      - hard_limit_hit_rate: < 10%
      - mid_session_takeaway_rate: < 25%
  
  phase_completion_rate:
    formula: |
      count(students completed phase N within max day) / count(students entered phase N)
    target per phase:
      Phase 1: > 90%
      Phase 2: > 85%
      Phase 3a: > 80%
      Phase 3b: > 70%(最複雜、容忍度較高)
      Phase 4: > 85%
      Phase 5: > 95%
  
  integration_retention_engagement:
    description: "Day 8-21 提早完成學員的 retention 階段 engagement"
    formula: |
      count(retention days with at least 1 message) / total_retention_days
    target: > 60%
    alert: "< 40% 連續 5 天 → retention 機制設計問題、需 redesign"
```

### 4.2 Quality Metrics

```yaml
quality_metrics:
  
  owned_quality_per_student:
    formula: count(quality_focus_history with quality_status == "owned")
    target distribution:
      - Day 21:mean 2-3 owned / student、median 2
      - 過低(< 1):整體 4 重組合過嚴 / 過高(> 5):假陽性疑慮
  
  cascade_down_success_rate:
    formula: |
      count(Top 2 + Top 3 passed identity test directly) / count(entered Phase 4)
    target: > 70%
    sub-metric:
      mini_self_concept_required_rate: Top 2/3 fail 需 mini Self-Concept 的比率
      target: < 30%
  
  haiku_judge_accuracy:
    description: "Haiku A1/A4/A5 judge 輸出 vs 設計師 spot check"
    methodology:
      - 每週隨機抽 10 個 Haiku call 樣本
      - 設計師人工標記正確答案
      - 計算 accuracy
    target:
      A1 sensory_detail (3-dim): > 85%
      A4 depth_signal: > 80%
      A5 containment_logic: > 80%
    alert: "< 70% → Haiku prompt 需 redesign(Patrick 工程)"
  
  export_completion_rate:
    formula: count(export_prompt_generated_at != null) / count(reached Phase 5)
    target: > 95%
    export_dissatisfaction_rate:
      target: < 10%
      alert: "> 10% → export template redesign"
```

### 4.3 Cross-engine consistency metrics

```yaml
consistency_metrics:
  
  phase_regression_rate:
    P10: Phase 3a → 3b 倒退
    target: < 20%
    redesign_trigger: ">= 20% → Phase 2 4 重組合 confirm threshold 過寬"
  
  status_router_inconsistency:
    description: "引擎 2 current_quality_status 與引擎 3 路由邏輯衝突(H10)"
    target: 0 incidents
    severity: critical(immediate HITL + design review)
  
  state_field_orphan_rate:
    description: "session_state 寫入但無 consumer 讀取的欄位"
    methodology: Patrick 工程 log + 設計師 review
    target: < 5% orphan fields per migration
    note: "Beta 階段可能會發現某些欄位設計過度、可清理"
```

### 4.4 Time-based metrics

```yaml
time_metrics:
  
  average_program_completion_day:
    formula: mean(calendar_day_count when Phase 5 completed) per cohort
    target: 12-15 days(對應 14-21 天彈性中位數)
    distribution_check:
      - 過快(< 8):可能 phase 跳過過多、quality 不深
      - 過慢(> 18):可能 phase 3b stuck
  
  haiku_call_latency:
    target: p95 < 300ms(對應 §A1/A4/A5 latency_target 200ms × 50% buffer)
    alert: ">= 500ms → Patrick 工程優化"
  
  daily_message_distribution:
    description: "學員一天內 message 時間分布"
    purpose: 設計 Integration Retention Mode 主動 follow up 時機
    output: heatmap per cohort
```

---

## 5. HITL Alert Rules

### 5.1 Alert Severity Levels

```yaml
severity_levels:
  
  critical:
    description: "立即 ping Vivi、可能需要 freeze session"
    examples:
      - G6 鑽石假陽性升級
      - H10 cross-engine state inconsistency
      - 信號 1 第 3 場 negative takeaway
      - 信號 3 cumulative E1c >= 5
      - 信號 4 第 3 場 hard limit
    ping_method: 即時通知(Patrick 選通道:SMS / Slack DM / call)
    response_target: < 2 hr
  
  high:
    description: "ping Vivi、24hr 內 review"
    examples:
      - F5 explicit_protest 命中但分類器誤分
      - F9 E1b 強度過高 break rapport
      - H2 深訊號 cascade 連續觸發
      - J5 takeaway 複述抓 PPL 配合句
      - P14 reference quality 連 3 次 ambiguous
      - P16 三向歸類全 PPL 配合
      - P21 Phase 1 latent conflict 浮現
    ping_method: 每日彙整 alert(每天上午發前一天 high series)
    response_target: < 24 hr
  
  medium:
    description: "per-student review、設計師 batch 處理"
    examples: 多數 F/G/H/J/P series medium
    ping_method: 每週彙整 dashboard 報告
    response_target: < 1 week
  
  low:
    description: "累積監控、不打擾"
    examples: F1/F2/F8/F11、J2/J4/J6/J8 等
    ping_method: 月度設計 review
    response_target: 設計 iteration 時參考
```

### 5.2 Alert 去重邏輯

```yaml
deduplication_rules:
  
  same_student_same_failure_same_session:
    rule: "同 session 內、同學員、同 failure mode 觸發、只 alert 1 次"
    rationale: "避免一個 session 內反覆 alert(failure mode 可能 cascade 觸發)"
  
  same_failure_across_cohort_window:
    rule: |
      24 hr 內、cohort 整體同 failure mode 觸發 >= 3 次、
      合併成 1 個 cohort-level alert、不個別 ping
    rationale: "若是設計問題、不是個別學員問題、cohort-level review 更有效"
  
  critical_alert_no_dedup:
    rule: "critical 級別不去重、每次都 alert"
    rationale: "critical = 安全 / 設計核心問題、不能漏"
```

### 5.3 Vivi HITL 介入決策樹

```yaml
vivi_intervention_decision_tree:
  
  ▼ Critical alert received
    ├ G6 鑽石假陽性 → freeze session、設計師 review、24hr 內 fix
    ├ H10 cross-engine inconsistency → freeze session、Patrick 工程 fix
    ├ 信號 1 第 3 場 negative → 主動聯絡學員、評估轉介 1-on-1
    ├ 信號 3 E1c >= 5 → 不聯絡學員、全體 prompt 對抗性 redesign
    └ 信號 4 第 3 場 hard limit → 該學員 phase 結構評估、tune
  
  ▼ High alert daily digest received
    ├ 多名學員同類 → cohort-level 設計 review
    └ 單一學員多類 → 1-on-1 聯絡 + Vivi 評估
  
  ▼ Weekly dashboard review
    ├ Engagement < target → Integration Retention 機制 / phase 結構 review
    ├ Quality metrics 異常 → 4 重組合 / Haiku threshold tune
    └ Time metrics 異常 → phase max day 調整
```

---

## 6. A001 Corpus 校準指引

### 6.1 A001 Corpus 的角色

A001(Vivi 親測學員 #1)是 v5.0 設計的**ground truth**:
- Day 1 災難(「鑽石」假陽性升級)= v5.0 設計避免的核心 case
- Day 2 災難(NLP Amnesia 機制式引用「還在嗎」)= 引擎 4 設計避免的核心 case
- Day 3 災難(「無力」反向收尾)= 6.10 信號 1 來源
- A001 corpus Day 4-6 still incoming(Patrick 預估 5/20-22 拉到)

### 6.2 A001 Day 4-6 Corpus 拉到後校準清單

```yaml
calibration_after_a001_day_4_6:
  
  step_1_identify_messy_cases:
    描述: |
      設計師讀 Day 4-6 corpus、標出與 7 個 spec 文件預期不符的 messy case。
      重點關注:
      - 學員是否有 P6 過去式 evidence
      - 學員是否有 P7 外部驗證 evidence  
      - 學員是否有 P10 phase 倒退
      - 學員是否有 P15 避反例
      - 學員是否有 P16 三向歸類全配合
      - 學員是否有 H3 深訊號漏偵
  
  step_2_tune_haiku_thresholds:
    描述: |
      根據 A001 messy case、tune Haiku A1/A4/A5 threshold:
      
      A1 sensory_detail (3-dim):
        - 若 A001 真實 owned evidence 多次 score < 2(因為亞洲學員內斂)
          → 降 threshold 從 >= 2 到 >= 1.5(weighted)、或 add tolerance dimension
      
      A4 depth_signal:
        - 若 A001 「不夠好」場景 score 都 < 2 但實際是 medium 深度
          → 降 threshold 從 >= 2 到 >= 1.5
        - 或加 dimension:cultural_marker(亞洲文化內斂表達不直接 → 加權)
      
      A5 containment_logic:
        - 若 A001 Top 1 判定多次 unclear
          → 加 prompt 強化「直接問哪個包含哪個、不問順序」
  
  step_3_tune_phase_max_day:
    描述: |
      根據 A001 phase 推進速度、調整 phase max day:
      
      若 A001 Phase 1 通常 5 day 完成(超出 max 4):
        → max day 從 4 改 6
      若 A001 Phase 3b 通常 5 day 完成(在 max 8 內):
        → max day 維持 8、但 mean day 4 是健康 baseline
  
  step_4_tune_engine_1_regex:
    描述: |
      檢查 A001 真實對話中、哪些「應該觸發引擎 1」但沒觸發、或反之:
      
      - vague_words regex 漏(學員用 A001 特有的模糊詞但未被列入)→ 加 regex
      - spiritual_big_words regex 過(學員真實談 values 卻被誤判)→ 縮 regex
      - explicit_protest regex 缺(學員實際抗議句型未涵蓋)→ 加 regex
  
  step_5_validate_critical_failure_modes:
    描述: |
      確認 6 個 critical failure modes 在 A001 真實對話中是否會被正確觸發:
      
      G6 鑽石假陽性:Day 1 對話跑 v5.0 引擎、看 4 重組合是否真擋住
      P6 過去式 evidence:Day 2-3 對話、Haiku A1 是否正確標 owned_was
      P7 外部驗證:檢查是否有真實「朋友說我是」case、A1 dimension 2 觸發
      P10 phase 倒退:檢查是否有 Build Vision 卡 case
      P20 Top 2 derived:Day 5-6 若進 Cascade Down、A1 dimension 3 觸發
      H3 深訊號 recall:檢查 A001 是否有深訊號被漏偵
  
  step_6_update_quality_terms:
    描述: |
      A001 Day 4-6 學員可能講出新 quality 詞、加進 §5.1 Quality 詞表:
      - 群 E A001 corpus 補充新詞
      - 黑名單檢查:是否有新「假 quality」需要加進黑名單
```

### 6.3 校準後 ship 流程

```yaml
post_calibration_ship:
  
  1_designer_proposes_changes:
    輸出: "校準變更清單(regex / threshold / max day / 詞表)"
  
  2_patrick_engineering_review:
    工作: "工程實作可行性 + 影響範圍評估(會不會影響其他 engine)"
  
  3_a_b_test_consideration:
    描述: "Beta 階段每次校準是否需要 A/B test"
    decision: |
      - 小幅度 tune(threshold ± 0.5 / max day ± 1):直接 ship、不 A/B
      - 大幅度 redesign(整個 phase 結構 / 4 重組合改變):A/B test
        (Beta cohort 太小可能無法 A/B、可能需要 sequential rollout)
  
  4_redeploy_and_continue_beta:
    輸出: "Beta 校準完版本、繼續監控"
```

---

## 7. Patrick 接手清單

### 7.1 新增 session_state + user_profile_evolution 欄位

```
session-scoped:
- session_state.amnesia_signal_this_session (bool)
- session_state.e1c_trigger_count_this_session (int)
- session_state.turn_count_this_session (int)
- session_state.hard_limit_hit_this_session (bool)

user-scoped(寫入 user_profile_evolution):
- user_profile_evolution.negative_takeaway_count (int)
- user_profile_evolution.consecutive_amnesia_sessions (int)
- user_profile_evolution.e1c_trigger_count_total (int)
- user_profile_evolution.consecutive_hard_limit_sessions (int)
```

### 7.2 新增 Haiku judge instance:A6 takeaway_sentiment

```yaml
A6_takeaway_sentiment:
  purpose: "判斷 session takeaway 的情緒方向(positive/neutral/negative)"
  used_by: signal_1_negative_takeaway_accumulation
  method: Haiku_4.5_tool_call
  inputs: 
    - last_session_day_summary
    - last 5 user turns of session
  output_schema:
    takeaway_sentiment: enum["positive", "neutral", "negative"]
    reasoning: str
    confidence: "high" | "medium" | "low"
  latency_target: 200ms
  file: lib/haiku-judge/takeaway-sentiment.js
```

→ Patrick `lib/haiku-judge/` 模組共 **4 個 judge instances**:A1 / A4 / A5 / A6

### 7.3 Dashboard 工程實作 spec

```
工程實作項目:
1. Real-time signal detection layer
   - 每 turn / 每 session 觸發 6.10 信號 1-4 + critical failure modes 監控
2. Per-student aggregate layer
   - 每學員 daily summary、cumulative metrics
3. Cohort-level analysis layer
   - 每週 Beta cohort report
4. HITL alert routing
   - critical / high / medium / low 4 級
   - 通道:SMS / Slack / email(Patrick 選擇)
   - 去重邏輯實作(§5.2)
5. Vivi dashboard UI(前端)
   - 即時 alert feed
   - 學員列表 + per-student progress view
   - cohort metrics charts
```

### 7.4 Alert 通道實作(Patrick 選擇)

```
建議方案:
- Critical:SMS / phone call(立即 ping)
- High:Slack DM + 每日 morning digest email
- Medium:每週 dashboard email + Slack channel
- Low:月度設計 review 文件
```

### 7.5 24-36 hr 內 ack(整合 v5.0 全 spec)

Patrick 工程交付物 batch ship 範圍(對應前面工程觀察):

1. migration 014 完整草案(引擎 1-4 + Checkpoint 1 + Dashboard 全部欄位)
2. v4.0 detector framework 適配完整評估
3. lib/ 模組結構:
   - lib/haiku-judge/(4 instances:A1 / A4 / A5 / A6)
   - lib/state/(A1/A2/A3 機制)
   - lib/session/(day-boundary.js / phase-machine.js)
   - lib/dashboard/(real-time / aggregate / cohort layers)
4. cached prefix 整合計畫(~2800 tokens cached)
5. ship 版本草稿(去 meta、加 runtime placeholders)
6. dashboard 工程實作 + alert 通道

預估 ~20-25 hr 完整 ship。

---

## 8. 收尾:設計師端 spec 100% 完成

### 8.1 累計交付總覽(設計師端)

| # | 文件 | 行數 |
|---|---|---|
| 1 | Checkpoint 2 引擎 1 對話偏離識別 | 1266 |
| 2 | Checkpoint 2 引擎 2 身份測試判決 | 969 |
| 3 | Checkpoint 2 引擎 3 中央路由器 | 1354 |
| 4 | Checkpoint 2 引擎 4 主動引用 | 1139 |
| 5 | Checkpoint 1 Turn 1(Framework + Phase 1-2)| 854 |
| 6 | Checkpoint 1 Turn 2(Phase 3a/3b/4)| 1141 |
| 7 | Checkpoint 1 Turn 3(Phase 5 + 附錄 C)| 864 |
| 8 | Dashboard(本檔) | (見下) |
| **累計** | | **~8200 行 spec** |

### 8.2 v5.0 設計師端 spec 完整覆蓋

```
4 引擎(Checkpoint 2):
├ E1 對話偏離識別(off_topic / vague / PPL / bypassing)
├ E2 身份測試判決(4 重組合 + Quality 詞表 80+)
├ E3 中央路由器(5 子路由器 + Top 1 + Cascade Down + 深訊號)
└ E4 主動引用機制(Day N+1 5 變體 + takeaway + export)

5 Phase(Checkpoint 1):
├ Phase 1 Values Elicitation
├ Phase 2 身份測試
├ Phase 3a/3b 主幹整合雙 path
├ Phase 4 Cascade Down
└ Phase 5 Future Pacing + Let it Go + Export
+ Integration Retention Mode

附錄機制庫(雙方合約):
├ A1 requires_typing + sensory_detail Haiku judge(3 dimensions)
├ A2 cumulative_score(通用模板)
├ A3 handoff_escalation
├ A4 depth_signal Haiku judge
├ A5 containment_logic Haiku judge
└ A6 takeaway_sentiment Haiku judge

5 個 v5.0 原創 IP 全部整合定位:
├ IP #1 Scope Overlap → Phase 3b Step 4
├ IP #2 東方文化柔軟拆解 → Phase 3b Step 2 + P18 mitigation
├ IP #3 三向歸類 → Phase 3b Step 3
├ IP #4 5 層撥開 → E1d + cached_5_layer_unwrap_reference
└ IP #5 NLP Amnesia 主動整合 → E4 + Phase 3a/5 Let it Work/Let it Go + Integration Retention

工具二三池 final closing:
├ 2A KEEP 結構 + UPGRADE 觸發機制 ✅
├ 2B 廢棄句式池 + 保留 requires_typing ✅
└ 2C KEEP Step 1-4 + UPGRADE 對應 Parts Integration ✅

Dashboard 監控完整:
├ 6.10 信號 1-4 完整內嵌
├ ~70 個 failure modes 集中追蹤
├ 6 個 critical failure modes 標記
├ Aggregate metrics(engagement / quality / consistency / time)
├ HITL alert rules + 去重邏輯
└ A001 corpus 校準指引
```

### 8.3 v5.0 vs v4.0 本質差異(最終確認)

| 維度 | v4.0 | v5.0 |
|---|---|---|
| 架構 | prompt 怪獸疊加 | 三層 detector → classifier → sub-prompts + cached prefix |
| 跨引擎協作 | 各自為政 | state-as-API(7 個 cross-engine state pipes)|
| Token efficiency | ~9.5K active | max simultaneous ~280-300、cached ~2800 |
| 機制重用 | 每 feature 重做 | 附錄 A 6 機制(requires_typing / cumulative_score / handoff_escalation / 3 Haiku judges)|
| 失敗模式 | 散落 | ~70 個明確 ID + dashboard 集中監控 |
| 跨 day 狀態 | 全 reset | NLP Amnesia + 主動引用「judgment results 保留、transient state reset」 |
| 商業承諾對齊 | 21 天硬性 | Framework C 彈性 + Integration Retention Mode |

### 8.4 軌道切換:設計師主導 → Patrick 工程主導

```
設計師主導階段(已完成):
✅ Checkpoint 2(4 引擎)
✅ Checkpoint 1(21 天結構 + 附錄 C)
✅ Dashboard(本檔)
✅ 工具二三池 final closing
✅ v5.0 原創 IP 5/5 整合定位

接續軌道:Patrick 工程主導 + 設計師 review
1. Patrick batch 工程交付物(~20-25 hr):migration 014 / lib/ 模組 / ship 版本草稿
2. Patrick + Claude Code v5.0 落地(6-8 天)
3. 設計師 review Patrick ship 版本草稿(雙端同步)
4. A001 v5.0 重走(~5/30 開始)
5. A001 Day 4-6 corpus 校準(本檔 §6)
6. Beta 100 學員 onboard
7. Dashboard 監控 + HITL Vivi 介入
8. v5.1 設計 iteration(基於 Beta 數據)
```

### 8.5 設計師端結束 message

```
v5.0 設計師端 spec 任務 100% 完成。
~8200 行 spec、7 份文件、完整覆蓋:
- 4 引擎 + 5 Phase + 6 附錄機制 + 5 個原創 IP + ~70 個 failure modes + dashboard 監控

設計師接下來位置:
- Patrick ship 版本草稿 review(雙端同步)
- A001 v5.0 重走 + Day 4-6 校準
- Beta 100 學員啟動後、HITL alert response
- v5.1 設計 iteration

Patrick 工程主導階段開始。
```

---

## 文件版本

- v0.1 (2026-05-20):初版、設計師對話版、設計師端 spec 收尾
- **v5.0 設計師端 spec 100% 完成、累計 ~8200 行**
