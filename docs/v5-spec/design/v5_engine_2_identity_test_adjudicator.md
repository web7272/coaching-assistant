# v5.0 引擎 2:身份測試判決引擎(Identity Test Adjudicator)

> **文件用途**:Checkpoint 2 第二個交付件。Patrick 工程端接此檔做 schema 反推延伸 + Sequential cascade 工程實作。
>
> **建立日期**:2026-05-19
>
> **對應方法論**:`damon_methodology.md` 章節 6.2(Level 出口機制 — 4 重組合判斷)、4.7(中央路由器藍圖)、1.4(Ambiguous Quality 重新定位)
>
> **對應 TODO**:`v5_next_actions.md` TODO 1 第一優先級 prompt 引擎 #2
>
> **版本**:設計師對話版(v0.1)。Patrick 24h 內提交 ship 版草稿。
>
> **依賴關係**:依賴引擎 1 的 `cumulative_ppl_score` + 附錄 A1.requires_typing + A1.sensory_detail Haiku judge。引擎 1 必須先 ship。

---

## ⚠️ 命名 reframe Warning

本檔**不採用** Robert Dilts 的 Logical Levels(L1-L5)框架——那是 v4.0 Cathy 改編版遺留、不是 Damon 純正術語。

本檔使用 Damon 體系內的 **Quality Status 三段判決**:
- **candidate**:學員偶然講出、未驗證
- **ambiguous**:身份測試「有時是 / sometimes / 偶爾」(對應方法論 1.4 Ambiguous Quality 定義)
- **owned**:確信特質(Certain Quality)、舉得出 ≥ 2 證據、Damon 身份測試通過

`damon_methodology.md` 6.2 章節用「L4-L5 候選詞」這個措辭是文件殘留、語意上對應「**Quality 形容詞 + 身份句結構**」——本檔以 Quality 詞表替代,不使用 L 級別命名。

---

## 目錄

1. [架構總覽](#1-架構總覽)
2. [Token Budget](#2-token-budget)
3. [Session State Fields(自生欄位、延伸 migration 014)](#3-session-state-fields)
4. [元件 spec](#4-元件-spec)
   - 4.1 E2_identity_test_master_detector(Layer 1)
   - 4.2 E2_aggregator(Layer 2、4 重組合)
   - 4.3 E2_upgrade_to_owned(Sub-prompt — 4 重全過)
   - 4.4 E2_stay_candidate(Sub-prompt — 1-3 重過)
   - 4.5 E2_continue_elicitation(Sub-prompt — 0 重過)
5. [Quality 詞表 + 身份句結構](#5-quality-詞表--身份句結構)
6. [跨引擎合約(引擎 1 ↔ 引擎 2)](#6-跨引擎合約)
7. [Patrick 接手清單](#7-patrick-接手清單)
8. [Forward References](#8-forward-references)

---

## 1. 架構總覽

引擎 2 採 **4 重並行 aggregator 架構**(設計師 spec 視角)。Patrick 工程內部實作為 **Sequential cascade**——對 spec 0 影響。

```
┌──────────────────────────────────────────────────────────────┐
│ Layer 1: detector_only(每 turn 觸發、token 0)                  │
│ ─ E2_identity_test_master_detector                           │
│   檢查「本 turn 是否有可能是 Quality 候選 / 身份句出現」          │
└──────────────────────────────────────────────────────────────┘
                            │ if suspected
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ Layer 2: aggregator(僅觸發時、~280 tokens)                     │
│ ─ E2_aggregator(4 重組合判決)                                  │
│   重 1: 詞彙信號(regex + Quality 詞表)                          │
│   重 2: pattern 信號(停頓 / 單字級 / 第一人稱身份句)              │
│   重 3: NOT PPL(讀 cumulative_ppl_score < 0.6,繼承引擎 1)     │
│   重 4: confirm 通過(evidence_script + Haiku sensory judge)  │
│                                                              │
│   工程實作:Sequential cascade(詞彙 → pattern → PPL → confirm)│
│   任一 fail 就停、cost 省 ~70%                                  │
└──────────────────────────────────────────────────────────────┘
                            │ aggregation result
                            ▼
┌──────────────────────────────────────────────────────────────┐
│ Sub-prompts(任一觸發、互斥):                                   │
│ ─ E2_upgrade_to_owned(4 重全過、~210 tokens)                  │
│ ─ E2_stay_candidate(1-3 重過、~220 tokens)                    │
│ ─ E2_continue_elicitation(0 重過、~180 tokens)                │
└──────────────────────────────────────────────────────────────┘
                            │ output to engine 3 (4.7 router)
                            ▼
              session_state.current_quality_status:
                 candidate / ambiguous / owned
```

### 設計原則

1. **判決三段、不是升級階梯**:Quality Status candidate → ambiguous → owned 是 Damon 純正術語、不是 L-level
2. **繼承引擎 1 的 PPL 訊號**:重 4「NOT PPL」直接讀 `cumulative_ppl_score`、不重做(cross-engine state reuse)
3. **confirm 重用附錄 A1 Haiku judge**:`evidence_script` 收集材料、Haiku 4.5 判斷 sensory marker 數量(≥ 2 通過)
4. **三個出口、不是二元 pass/fail**:upgrade / stay / restart — 對應方法論 6.2「4 重都過 / 1-3 重過 / 0 過」三段
5. **接口乾淨**:輸出 `current_quality_status` 給引擎 3(4.7 中央路由器)消費

---

## 2. Token Budget

### Max simultaneous active state(任一 turn 的真實 token 佔用)

| 元件 | type | tokens | 計入 active? |
|---|---|---|---|
| E2_identity_test_master_detector | detector_only | ~140 | ❌(regex match、token 0) |
| E2_aggregator | conditional_inject | ~280 | ✅(僅觸發時、Patrick 可改 tool_call) |
| E2_upgrade_to_owned / stay / continue | conditional_inject | max 220 | ✅(任一觸發時、互斥) |

**Max simultaneous active**:aggregator(~280)**OR** sub-prompt(max ~220)二擇一 = **~280 tokens**

### 引擎 1 + 引擎 2 合計 max simultaneous

任一 turn 最壞情境:E1 sub-prompt(~270) + E2 aggregator(~280) **同時觸發** = ~550 active state

但實際情境互斥概率高:
- 引擎 1 觸發 = 對話偏離、Quality 詞極少出現 → 引擎 2 跳過機率高
- 引擎 2 觸發 = 學員給出 Quality 候選 + 身份句、cumulative_ppl_score 通常 < 0.6

→ 預估 P(E1 + E2 同 turn)~10%、預估**穩態 max simultaneous ~280-300**、遠低於 5-6K budget

---

## 3. Session State Fields

引擎 2 新增 / 延伸的 session_state 欄位。

### 3.1 current_quality_status

```yaml
session_state.current_quality_status:
  range: enum ["none", "candidate", "ambiguous", "owned"]
  initial_value: "none"
  scope: session-scoped(per-session ephemeral、JSONB on sessions table)
  update_rule: |
    - none → candidate:E2_aggregator 判 1-2 重通過 + 詞彙重命中
    - candidate → ambiguous:身份測試問「Are you a X person?」、學員答「有時 / 偶爾 / 還在練習」
    - candidate → owned:E2_aggregator 4 重全過(罕見、通常會先經 ambiguous)
    - ambiguous → owned:Self-Concept 模型(Mapping Across / Scope Overlap)完成 + 重新 4 重組合 4 重全過
    - any → none:跨 quality 切換、reset 為 none
  decay_per_turn: 0(無自然衰減、靠明確 transition)
  reset_on:
    - new_quality_focus_started   # 學員切換到挖另一個 quality
    - new_session_day(可選、視 retention 策略;預設不 reset、跨 day 帶過去)
  cross_engine_consumers:
    - 引擎 3(4.7 中央路由器):讀此欄位決定路徑
      - owned → 進 Step 2 Build Vision(極少)/ values 排序
      - ambiguous → 切換 Self-Concept 模型
      - candidate → 繼續挖
      - none → 繼續 values elicitation
```

### 3.2 current_quality_candidate_term

```yaml
session_state.current_quality_candidate_term:
  range: string (學員講出的 Quality 詞、原話保留)
  initial_value: null
  scope: session-scoped
  update_rule: |
    - E2_master_detector 偵測到詞彙命中 → 寫入學員原話詞
    - 例:學員講「我覺得我是一個發光的人」→ 寫入「發光」
    - 例:學員講「鑽石」→ 寫入「鑽石」(注意:鑽石本身不是標準 quality 詞、但 A001 corpus 顯示學員可創造自己的 anchor 詞)
  decay_per_turn: 0
  reset_on:
    - current_quality_status reset to none
    - new_session_day(可選)
```

### 3.3 identity_test_evidence_count

```yaml
session_state.identity_test_evidence_count:
  range: 0+ (integer)
  initial_value: 0
  scope: session-scoped
  update_rule: |
    每次學員回應 evidence_script 提問、Haiku judge 評估:
    - sensory_detail_score >= 2 → +1
    - sensory_detail_score < 2 → 不變(也不扣)
  decay_per_turn: 0
  reset_on:
    - current_quality_status reset
    - new_session_day
  threshold:
    - >= 2: 重 4 confirm 通過(對應方法論 6.2「舉得出 ≥ 2 具體證據」)
```

### 3.4 identity_sentence_pattern_hit

```yaml
session_state.identity_sentence_pattern_hit:
  range: bool
  initial_value: false
  scope: per-turn(每 turn reset、不累積)
  update_rule: |
    - true:本 turn user response 命中身份句結構 regex(見 §5.2)
    - false:本 turn 未命中
  decay_per_turn: N/A(per-turn 重置)
  reset_on:
    - every new user turn
```

### 3.5 pattern_signal_hit

```yaml
session_state.pattern_signal_hit:
  range: bool
  initial_value: false
  scope: per-turn
  update_rule: |
    重 2「pattern 信號」命中條件(任一成立即 true):
    - 回應前學員停頓(typing latency > 30s、若 Patrick 端可餵)
    - 單字級回答 + 是身份相關內容(不是 PPL 短回應)
    - 命中身份句結構(identity_sentence_pattern_hit == true)
  reset_on:
    - every new user turn
```

### 3.6 quality_focus_history

```yaml
session_state.quality_focus_history:
  range: list of objects
  initial_value: []
  scope: user-scoped(跨 session、寫入 user_profile_evolution.anchors)
  update_rule: |
    每次 quality_status 升級到 owned → append:
    {
      term: "[學員 quality 詞]",
      upgraded_to_owned_at: timestamp,
      session_day: int,
      evidence_examples: ["[學員舉的具體事例 1]", "[事例 2]"]
    }
  cross_session_purpose: |
    引擎 4(AI 主動引用機制)讀此 history、生成 Day N+1 開場
    「昨天你說了『[term]』」的引用內容。
  reset_on:
    - 永不 reset(跨 session retention 核心資產)
```

---

## 4. 元件 spec

### 4.1 E2_identity_test_master_detector(Layer 1)

```yaml
- id: E2_identity_test_master_detector
  type: detector_only
  layer: 1
  purpose: |
    每個 user turn 結束後檢查「本 turn 是否有可能是 Quality 候選詞或身份句出現」。
    本層只做二分判斷(有 / 沒有候選)、不做組合判決——組合判決交 E2_aggregator。
  
  trigger:
    regex_patterns:
      quality_terms:
        # 完整詞表見 §5.1
        # 涵蓋 ~80 個 Damon 體系 Quality 詞 + A001 corpus 自發詞
      identity_sentence_structures:
        # 8 個身份句結構、見 §5.2
        - "我是一個(.+?)的人"
        - "我是一個喜歡(.+?)的人"
        - "我是一個討厭(.+?)的人"
        - "我是一個感動時很(.+?)的人"
        - "我是一個認為(.+?)很重要的人"
        - "我這人(.+?)"
        - "我天生(.+?)"
        - "(.+?)是我這個人最重要的部分"
    
    cumulative_state_signals:
      identity_test_evidence_count: ">= 1"   # 累積 1 次以上、加強觸發概率
    
    contextual_filters:
      # 避免假陽性
      skip_if_active_deviation: |
        若 session_state.deviation_handled_this_turn != null(引擎 1 在處理偏離)
        → 引擎 2 跳過、不觸發
        理由:偏離治理中冒出 quality 詞通常是 PPL 假陽性、不該升級
  
  output:
    identity_signal_suspected: true | false
    triggered_quality_term: str | null   # 命中的詞、未命中為 null
    triggered_sentence_structure: str | null
    handoff_to: E2_aggregator (if identity_signal_suspected)
  
  active_state_tokens: ~140 (detector_only、不計入 active state 預算)
  
  inputs_from_profile:
    - session_state.last_user_response
    - session_state.deviation_handled_this_turn   # 引擎 1 旗標
    - session_state.identity_test_evidence_count
    - session_state.current_quality_status
  
  outputs_to_profile:
    - session_state.identity_signal_suspected_this_turn: bool
    - session_state.current_quality_candidate_term: str (if matched)
    - session_state.identity_sentence_pattern_hit: bool
  
  trigger_state_transition: false
  
  failure_modes:
    - id: G1
      mode: "PPL 假陽性:學員 echo AI 的提問詞、命中 quality 詞表"
      mitigation: |
        contextual_filters.skip_if_active_deviation 已過濾大部分。
        若仍漏網:E2_aggregator 重 3「NOT PPL」會擋(cumulative_ppl_score >= 0.6)。
    - id: G2
      mode: "學員講出非標準 quality 詞(如 A001 的『鑽石』)、regex 不命中"
      mitigation: |
        身份句結構 regex 同時偵測——學員講「我是一個發光的人」即使「發光」不在詞表、
        身份句結構命中、仍會觸發 aggregator。aggregator 內部用 LLM judge 擴展認定。
```

---

### 4.2 E2_aggregator(Layer 2、4 重組合判決)

```yaml
- id: E2_aggregator
  type: conditional_inject   # Patrick 可改 tool_call(Haiku 4.5)、對 prompt_content 無影響
  layer: 2
  triggered_by: E2_identity_test_master_detector → identity_signal_suspected: true
  active_state_tokens: ~280 (僅觸發時)
  
  inputs_from_profile:
    - session_state.last_ai_question
    - session_state.last_user_response
    - session_state.current_quality_candidate_term
    - session_state.identity_sentence_pattern_hit
    - session_state.identity_test_evidence_count
    - session_state.pattern_signal_hit
    - session_state.cumulative_ppl_score   # ⭐ 繼承引擎 1
    - session_state.current_quality_status
    - session_state.elicitation_mode_active
    - anchors_top3
  
  outputs_to_profile:
    aggregation_result:
      doors_passed: 0 | 1 | 2 | 3 | 4
      passed_doors: [list of "lexical" | "pattern" | "not_ppl" | "confirm"]
      failed_doors: [list]
      recommended_sub_prompt: "upgrade" | "stay" | "continue"
    session_state_updates:
      current_quality_status: per state machine rule
      identity_test_evidence_count: +1 if confirm passed
      quality_focus_history: append if upgrade to owned
  
  damon_source:
    - "6.2 4 重組合判斷"
    - "Damon 身份測試格式:『Are you a X person?』"
    - "Damon Lauren / George / Kyle 案例:評證 ≥ 2 具體事件 + sensory detail"
    - "1.4 Ambiguous Quality 定義:身份測試『有時是 / sometimes』回應"
  
  prompt_content: |
    [SYSTEM INJECT — Identity Test Aggregator]
    
    本輪偵測到可能的 Quality 候選 / 身份句。執行 4 重組合判決。
    
    工程實作為 Sequential cascade(任一 fail 就停、cost 省):
    順序:詞彙 → pattern → NOT PPL → confirm
    
    **重 1:詞彙信號(lexical)**
    
    判斷條件(任一即過):
    - session_state.current_quality_candidate_term 非 null(master_detector 已命中)
    - 學員回應包含 §5.1 Quality 詞表中的詞(中文 quality 形容詞或名詞化 quality)
    - 學員自創 anchor 詞(如「鑽石」「發光的人」)、但伴隨身份句結構出現
    
    過 → passed_doors += ["lexical"], continue to 重 2
    不過 → 0 doors passed → recommended_sub_prompt = "continue"、停止 cascade
    
    **重 2:pattern 信號(pattern)**
    
    判斷條件(任一即過):
    - identity_sentence_pattern_hit == true(命中 §5.2 身份句結構)
    - pattern_signal_hit == true(停頓 / 單字級身份相關回答)
    - 第一人稱身份句結構(「我是」「我這人」「我天生」開頭)
    
    過 → passed_doors += ["pattern"], continue to 重 3
    不過 → 1 door passed → recommended_sub_prompt = "stay"、停止 cascade
    
    **重 3:NOT People Pleasing(not_ppl)** — 繼承引擎 1
    
    判斷條件:
    - session_state.cumulative_ppl_score < 0.6
    - 且本 turn user response 不是純配合詞(不是「是」「對」「都可以」單獨回應)
    
    過 → passed_doors += ["not_ppl"], continue to 重 4
    不過 → 2 doors passed → recommended_sub_prompt = "stay"、停止 cascade
                          → 同時 cumulative_ppl_score 已高、警示這個 candidate 是 PPL 產物
    
    **重 4:confirm 通過(confirm)**
    
    這一重最貴、放最後。需要 AI 主動發起 Damon 身份測試 + Haiku judge 評估。
    
    Step 4a — AI 主動發起身份測試(若 current_quality_status == "candidate" 第一次):
    > 「這句話——不管誰問、什麼時候問、答案都一樣嗎?……那就是你的。」
    
    (對應 v4.0 工具二 2A confirm_script、Damon 身份測試格式中文落地版)
    
    Step 4b — AI 主動發起 evidence 收集:
    > 「好。你說你是一個[quality 詞]的人——把過去你做過、
    > 最能證明這點的一兩件具體的事情、說給我聽。」
    
    (對應 v4.0 工具二 2A evidence_script)
    
    Step 4c — Haiku judge 評估學員 evidence 回應(呼叫附錄 A1.sensory_detail judgment):
    - Haiku 4.5 tool_call inputs:user_response (last turn after evidence_script asked)
    - Haiku output:sensory_detail_score (0-4)
    - threshold:sensory_detail_score >= 2 即過
    
    過 → passed_doors += ["confirm"], aggregator 完成
        → identity_test_evidence_count += 1
        → 4 doors passed → recommended_sub_prompt = "upgrade"
    不過 → 3 doors passed → recommended_sub_prompt = "stay"
         → 但保留 candidate / ambiguous 狀態繼續挖
    
    **判決輸出**
    
    aggregation_result:
    {
      "doors_passed": 0-4,
      "passed_doors": [...],
      "failed_doors": [...],
      "recommended_sub_prompt": "upgrade" | "stay" | "continue"
    }
    
    Quality Status 狀態轉移規則:
    - 4 doors passed + current == "candidate" → owned
    - 4 doors passed + current == "ambiguous" → owned (Self-Concept 模型已完成轉化)
    - 1-3 doors passed + current == "none" → candidate
    - 1-3 doors passed + current == "candidate" + 學員講「有時 / 偶爾」→ ambiguous
    - 1-3 doors passed + current == "ambiguous" → 保持 ambiguous、進 Self-Concept 模型(引擎 3 路由)
    - 0 doors passed → none(繼續 values elicitation)
  
  failure_modes:
    - id: G3
      mode: "重 4 confirm 過、但 quality 詞是 PPL 假陽性殘留(重 3 應擋但漏)"
      mitigation: |
        Sequential cascade 順序保證重 3 在重 4 之前——若重 3 fail、根本走不到重 4。
        若重 3 過但實為 PPL:依賴下一 turn 引擎 1 cumulative_ppl_score 累積、
        下次此 quality 重檢時被擋。
    - id: G4
      mode: "學員 ambiguous 階段給出 evidence、但 evidence 是過去式『曾經』、不是現在"
      mitigation: |
        Haiku judge 判 sensory marker 數量、不判時態。
        但 prompt_content 內 evidence_script 已強調「最能證明這點的」(現在進行式 framing)。
        若學員仍給過去式 evidence:升級為 owned 但同時觸發 Beta 監控訊號
        (這個學員可能只是「曾經是」、不是「現在是」)。
    - id: G5
      mode: "重 1 lexical 詞表漏網(學員自創詞如『鑽石』)、aggregator 不觸發"
      mitigation: |
        master_detector 已有身份句結構 regex 作為 fallback——
        即使 quality 詞漏網、身份句結構命中仍會觸發 aggregator。
        aggregator 內部允許 LLM judge 擴展認定(prompt_content 重 1 第三條:
        「學員自創 anchor 詞、但伴隨身份句結構出現」)。
    - id: G6
      mode: "A001 Day 1『鑽石』類型錯誤升級"
      mitigation: |
        4 重組合本身就是為了防 A001 Day 1。
        重 1 詞彙過(『鑽石』伴隨身份句)、
        重 2 pattern 過(身份句結構命中)、
        重 3 NOT PPL 過(cumulative_ppl_score < 0.6)、
        但重 4 confirm:Haiku judge 學員 evidence 回應、
        若學員只給「我就覺得我像鑽石」這類無 sensory marker 回應、重 4 fail、
        candidate 不升級 → 進 §4.4 stay 路徑、繼續挖具體事件。
```

---

### 4.3 E2_upgrade_to_owned(Sub-prompt — 4 重全過)

```yaml
- id: E2_upgrade_to_owned
  type: conditional_inject
  triggered_by: E2_aggregator → recommended_sub_prompt == "upgrade"
  active_state_tokens: ~210
  
  inputs_from_profile:
    - session_state.current_quality_candidate_term
    - session_state.identity_test_evidence_count
    - session_state.last_user_response   # 學員的 evidence 回應
    - anchors_top3
  
  outputs_to_profile:
    session_state.current_quality_status: "owned"
    session_state.quality_focus_history: append {
      term: current_quality_candidate_term,
      upgraded_to_owned_at: now(),
      session_day: current_day,
      evidence_examples: [extracted from last_user_response]
    }
    user_profile_evolution.anchors: append current_quality_candidate_term
  
  damon_source:
    - "6.4 到 level 後的 3 步動作:複述鞏固 → 身份測試 → takeaway 種下"
    - "Damon 案例 George / Kyle:owned quality 確認後、面帶微笑說 Yes"
  
  prompt_content: |
    [SYSTEM INJECT — Quality Upgrade to Owned]
    
    學員的 Quality「[current_quality_candidate_term]」通過 4 重組合判決。
    執行 3 步動作:複述鞏固 → takeaway 種下 → 路由到引擎 3。
    
    **必須做**(三段、不省略):
    
    1. **複述鞏固**(學員自己的話、不是 AI 給標籤):
       > 「你剛說『[evidence 中的學員原話片段]』。
       > 你說這個的時候、什麼感覺?」
       
       目的:讓學員 own 詞、避免 PPL「是 / 對」回應、強迫感受具體化
    
    2. **takeaway 種下**(不 over-process、留空間給 NLP Amnesia):
       > 「今天你帶走『[current_quality_candidate_term]』。
       > 明天從這裡繼續。」
       
       禁止:不要繼續挖、不要深入解釋、不要派作業。給潛意識夜裡整合空間。
    
    3. **路由 handoff 給引擎 3**(4.7 中央路由器):
       - 寫入 session_state.current_quality_status = "owned"
       - 引擎 3 下一輪會讀此狀態、決定下一步路徑
       - 本 sub-prompt 不做引擎 3 工作、邊界乾淨
    
    **禁止**:
    - 不可說「太棒了 / 真好 / 你做得很好」(誇獎 = AI 給標籤、違反 own 原則)
    - 不可接續挖更深的 quality(那是 Cascade Down 邏輯、引擎 3 處理)
    - 不可讓學員「再多舉幾個例子」(已過 4 重組合、過度收集會稀釋體驗)
  
  variable_filling_method: |
    Patrick 工程把 last_user_response 餵進主 LLM context、
    主 LLM 從中抓 evidence 原話片段填入 [evidence 中的學員原話片段]。
  
  failure_modes:
    - id: G7
      mode: "升級 owned 後、學員下一 turn 開始 PPL(回頭加碼配合)"
      mitigation: |
        引擎 1 cumulative_ppl_score 會偵測。
        若 PPL 連續發生、引擎 3 路由時應降級回 ambiguous、重做 Self-Concept 模型。
        (本 sub-prompt 不處理、屬引擎 3 範圍)
    - id: G8
      mode: "takeaway 種下後學員仍要求繼續挖、AI 繼續挖違反『不 over-process』原則"
      mitigation: |
        prompt_content 已明說禁止。若學員 push:
        「我聽到了。明天從這裡繼續、今天到這。」
        (Damon 親口示範:不 over-process)
```

---

### 4.4 E2_stay_candidate(Sub-prompt — 1-3 重過)

```yaml
- id: E2_stay_candidate
  type: conditional_inject
  triggered_by: E2_aggregator → recommended_sub_prompt == "stay"
  active_state_tokens: ~220
  
  inputs_from_profile:
    - session_state.current_quality_candidate_term
    - session_state.current_quality_status
    - aggregation_result.passed_doors
    - aggregation_result.failed_doors
    - session_state.cumulative_ppl_score
    - session_state.last_user_response
  
  outputs_to_profile:
    session_state.current_quality_status: 
      - "candidate" if was "none"
      - "ambiguous" if was "candidate" AND 學員回應含「有時 / 偶爾 / 還在練習」
      - unchanged otherwise
    session_state.deviation_handled_this_turn: "E2_stay"   # 給引擎 1 知道引擎 2 在運作
  
  damon_source:
    - "6.2 1-3 重過 = 候選、繼續挖"
    - "1.4 Ambiguous Quality:身份測試『有時是』"
    - "Damon 對 ambiguous quality 的處理:不接受、繼續挖證據 or 進 Self-Concept 模型"
  
  prompt_content: |
    [SYSTEM INJECT — Stay in Candidate / Ambiguous]
    
    Quality 候選未通過 4 重組合(過 [N] 重、未過 [failed_doors])。
    依照失敗的「重」不同、執行不同補強動作:
    
    **若 failed_door == "lexical" 但其他過**(罕見、master_detector 不該觸發):
    跳過、回主流程
    
    **若 failed_door == "pattern"**:
    學員講出 quality 詞、但沒有身份句結構、沒有停頓。
    可能只是抽象提到、不是真實認領。
    
    動作:
    > 「你說到『[current_quality_candidate_term]』——
    > 用『我是一個___的人』這個句子試試看、你會怎麼填?」
    
    目的:引導學員自己組身份句、檢測認領強度
    
    **若 failed_door == "not_ppl"**:
    cumulative_ppl_score >= 0.6、這個 quality 候選有 PPL 嫌疑。
    
    動作:cascade 到引擎 1 E1c(PPL 治理)、不要在引擎 2 內處理。
    > 由引擎 1 處理 PPL 後、下一輪重新評估這個 quality 候選。
    
    **若 failed_door == "confirm"**(最常見):
    學員 evidence 回應不夠具體、sensory_detail_score < 2。
    
    動作(任選一個變體):
    
    變體 A — Damon Lucia 風格(首次 confirm fail):
    > 「我沒被說服。
    > 你說『[evidence 原話片段]』——我聽到了、但這還太抽象。
    > 給我一個具體時刻:什麼時候、跟誰、發生了什麼?」
    
    變體 B — 升級 ambiguous 確認(若學員自己講「有時 / 偶爾」):
    > 「我聽到你說『有時候是』。
    > 那這就不是『完全是』——是『有時是、有時不是』。
    > 我們先把這個放著、明天我們從這裡繼續往下挖。」
    
    (這個變體會把 current_quality_status 從 candidate 升級為 ambiguous、
     對應方法論 1.4 Ambiguous Quality 標準定義、引擎 3 會路由到 Self-Concept 模型)
    
    **禁止**:
    - 不可降級 quality 候選為 0(不要說「這不算」),保留 candidate / ambiguous
    - 不可在重 4 fail 時繼續加碼問新 evidence,給學員空間
    - 不可在重 3 fail(PPL)時自己治理、必須讓引擎 1 接手
  
  variable_filling_method: |
    [N] / [failed_doors] / [current_quality_candidate_term] / [evidence 原話片段] 
    全部由主 LLM 從 inputs 自填、無額外 LLM call。
  
  escalation_rules:
    - condition: "current_quality_status == 'candidate' 持續 ≥ 3 turn 沒升級也沒降級"
      action: |
        cascade 到引擎 3 4.7 中央路由器、判斷:
        (a) 換 quality 候選(這個 quality 不對)
        (b) 進 Self-Concept 模型(quality 對、但需要 Mapping Across)
        (c) 學員 PPL 嫌疑、回引擎 1
    - condition: "current_quality_status == 'ambiguous' 持續 ≥ 5 turn"
      action: "強制進 Self-Concept 模型(引擎 3 路由)、不再原地循環"
  
  failure_modes:
    - id: G9
      mode: "學員把『有時是』當『完全是』的客氣說法、其實是 owned"
      mitigation: |
        亞洲文化謙虛訊號偵測——若學員講「有時是」+ 同時舉得出 ≥ 2 具體 evidence:
        Haiku judge 可能仍判 confirm 過、整體判 owned。
        若 Haiku 判 confirm fail、保留 ambiguous、進 Self-Concept 模型——
        Self-Concept 模型內會強化 owned 認定、不會卡死。
    - id: G10
      mode: "candidate 卡在 3 turn 無進展、學員開始疲勞"
      mitigation: |
        escalation_rules 觸發引擎 3 路由、不在引擎 2 內無限循環。
        若引擎 3 也卡:cascade 到附錄 A3.handoff_escalation。
```

---

### 4.5 E2_continue_elicitation(Sub-prompt — 0 重過)

```yaml
- id: E2_continue_elicitation
  type: conditional_inject
  triggered_by: E2_aggregator → recommended_sub_prompt == "continue"
  active_state_tokens: ~180
  
  inputs_from_profile:
    - session_state.last_ai_question
    - session_state.last_user_response
    - session_state.current_quality_status
  
  outputs_to_profile:
    session_state.current_quality_status: unchanged
    session_state.identity_signal_suspected_this_turn: false   # reset
  
  damon_source:
    - "6.2 0 重過 = 繼續 values elicitation"
    - "Damon chain question 引擎:What will that do for you? / What's important?"
  
  prompt_content: |
    [SYSTEM INJECT — Continue Values Elicitation]
    
    本 turn 未偵測到有效 Quality 候選 / 身份句。
    回主流程的 Damon 鏈式追問引擎、不執行身份測試動作。
    
    **必須做**:
    - 不指認「沒有偵測到 quality」(會 break flow)
    - 自然接續上一個提問、用 Damon 核心鏈式追問:
      - 「What will that do for you?」/「這對你來說、會帶來什麼?」
      - 「What's important to you about that?」/「這個對你來說、為什麼重要?」
    - 維持 elicitation_mode_active == true 狀態
    
    **禁止**:
    - 不可直接問「Are you a X person?」(身份測試格式)、本 turn 沒到那個時機
    - 不可主動引入 Quality 詞表的詞、讓學員自己浮現
  
  failure_modes:
    - id: G11
      mode: "elicitation 階段拖太久、學員一直給不出 quality 候選"
      mitigation: |
        屬引擎 3 範圍(4.7 中央路由器判斷是否切換策略)、不在引擎 2 處理。
```

---

## 5. Quality 詞表 + 身份句結構

### 5.1 Quality 詞表(中文亞洲適配、~80 個)

> **生成路徑**:Damon vocabulary_glossary 英文 reference(~15)+ Scope Overlap quality 群(5)+ A001 corpus 自發詞(10)+ 設計師 expand 亞洲適配(50)= ~80 個
>
> **使用方式**:E2_master_detector 的 regex_patterns.quality_terms 從本詞表生成。Patrick 工程可直接複製成 JS array。
>
> **詞性偏好**:Quality 形容詞(形容人是什麼樣的)+ 動名詞 quality(描述 quality 的核心動作)。**不收**:外部驗證 trap 詞 / 副產品空泛詞 / self-discipline 框架詞。

#### 群 A:Damon 體系明確示範過的 Quality(已驗證、優先匹配)

```
好奇的、勇敢的、外向的、慷慨的、給予的、善良的、真實的、真誠的、
有愛的、有創造力的、有勇氣的、有智慧的、平靜的、自由的、外放的、開朗的
```

⚠️ **「給予的」「有愛的」標 high-priority match**——Kyle 案例經典 quality。

#### 群 B:亞洲文化適配的 Damon 同源 Quality(設計師 expand)

```
踏實的、穩定的、堅定的、認真的、用心的、專注的、投入的、
溫柔的、體貼的、有溫度的、有同理心的、會傾聽的、
有韌性的、能堅持的、有耐性的、能等待的、
誠實的、坦白的、表裡如一的、內外一致的、
獨立的、自主的、有主見的、敢做自己的、
有想像力的、有靈感的、會玩的、有童心的、
踏實活著的、好好生活的、好好愛自己的、遵循內心的
```

⚠️ **「內外一致的」「好好愛自己的」「遵循內心的」**——A001 corpus 直接採集、學員自發詞、不要改寫。

#### 群 C:行動類 Quality(描述 quality 透過什麼行動展現)

```
能做決定的、敢說不的、會設邊界的、會說出需要的、
願意嘗試的、敢冒險的、不怕失敗的、能重來的、
能放下的、能原諒的、能往前走的、能接受的、
能享受的、能感受的、能投入當下的、能慢下來的
```

#### 群 D:存在類 Quality(描述 quality 是一種存在狀態)

```
完整的、不缺什麼的、夠了的、安住的、
有方向的、有重心的、有根的、有家的、
能被看見的、能被愛的、能被需要的、能被信任的
```

⚠️ **「夠了的」「不缺什麼的」**:亞洲學員常見深層 quality、優先匹配。

#### 群 E:A001 corpus 自發詞(學員原話、特殊 anchor)

```
鑽石、發光、發光的人、充滿愛、充滿能量、充滿愛與能量、
篤定、自在、滿足、喜悅、
Use the best of me（英文混合、保留原話）、用全部的我、
為了讓鑽石發光、有好好愛自己的
```

⚠️ **「篤定」標 candidate-only flag**——A001 Day 2 PPL 風險詞、即使 4 重組合過、引擎 3 路由時要額外檢查 cumulative_ppl_score。

⚠️ **「鑽石」非標準 quality、但需要支援**——A001 Day 1 學員自創 anchor 詞、Day 2-3 變成 PPL 殘留物。處理規則:命中時 master_detector 必須伴隨身份句結構命中才觸發 aggregator(不允許單詞觸發)。

#### 🚨 黑名單(Damon 反對的假 quality、絕對不收進詞表)

```
❌ 外部驗證 trap:成功的(Status)、有權力的(Power)、有面子的(Pride)、被尊重的(Respect)、有 self-worth 的(假概念)
❌ 副產品空泛詞:有 fulfillment 的、有 purpose 的、有 meaning 的、有 confidence 的
❌ self-discipline 框架:自律的、能控制自己的、有紀律的(改用「專注的 / 投入的」)
❌ helping others 偽裝:幫助別人的(這是策略、不是 quality、改用「善良的 / 有愛的」)
```

→ 若學員自己講出黑名單詞、引擎 2 不接受為 quality candidate、由主對話 LLM 用 chain question 拆解(「這對你來說、會帶來什麼?」)、引導到背後真實 quality。這個邏輯由**引擎 3 / 主對話框架處理**、不在引擎 2 內。

---

### 5.2 身份句結構(8 個)

```yaml
identity_sentence_structures:
  # v4.0 已驗證 5 個
  - id: IS1
    regex: "我是一個(.+?)的人"
    example: "我是一個用心的人"
    source: v4.0 工具二 2A
  
  - id: IS2
    regex: "我是一個喜歡(.+?)的人"
    example: "我是一個喜歡踏實生活的人"
    source: v4.0 工具二 2A
  
  - id: IS3
    regex: "我是一個討厭(.+?)的人"
    example: "我是一個討厭虛偽的人"
    source: v4.0 工具二 2A
    note: "Damon 體系 quality 可以反向定義——『討厭 X』隱含對立 quality 的認領"
  
  - id: IS4
    regex: "我是一個感動時很(.+?)的人"
    example: "我是一個感動時很容易哭的人"
    source: v4.0 工具二 2A
    note: "情緒場景下的 quality、用於採集 Reactive Pattern"
  
  - id: IS5
    regex: "我是一個認為(.+?)很重要的人"
    example: "我是一個認為誠實很重要的人"
    source: v4.0 工具二 2A
    note: "Values-as-identity、跨越 values 與 quality 邊界"
  
  # 設計師擴展 3 個(亞洲文化適配)
  - id: IS6
    regex: "我這人(.+)"
    example: "我這人就是放不下"
    source: 設計師擴展、亞洲口語身份句
  
  - id: IS7
    regex: "我天生(.+)"
    example: "我天生就是會替人著想"
    source: 設計師擴展、本質性身份句
  
  - id: IS8
    regex: "(.+?)是我這個人最重要的部分"
    example: "踏實是我這個人最重要的部分"
    source: 設計師擴展、values-identity 連接句
```

**身份句結構命中時的處理**:

- 任一身份句結構命中 → `session_state.identity_sentence_pattern_hit = true`
- 命中時、master_detector 強制觸發 aggregator,即使 quality 詞表未命中(處理 A001 自創詞情境)
- aggregator 內部:重 1「lexical」可由身份句結構命中代償通過

---

## 6. 跨引擎合約

### 6.1 引擎 2 讀引擎 1 的 state

```yaml
read_from_engine_1:
  - session_state.cumulative_ppl_score
    used_in: E2_aggregator 重 3 (NOT PPL 判斷)
    threshold: < 0.6 即過
  
  - session_state.deviation_handled_this_turn
    used_in: E2_master_detector contextual_filters
    behavior: |
      若引擎 1 在處理偏離(非 null)、引擎 2 跳過、不觸發
      理由:偏離治理中冒出的 quality 通常是 PPL 假陽性
```

### 6.2 引擎 2 寫入給引擎 3 的 state

```yaml
write_for_engine_3:
  - session_state.current_quality_status
    values: "none" | "candidate" | "ambiguous" | "owned"
    used_by_engine_3: |
      4.7 中央路由器讀此狀態決定路徑:
      - "owned" → Build Vision / values 排序
      - "ambiguous" → 切換 Self-Concept 模型(Mapping Across / Scope Overlap)
      - "candidate" → 繼續挖 evidence
      - "none" → 繼續 values elicitation
  
  - session_state.current_quality_candidate_term
    used_by_engine_3: 路由動作時引用的 quality 詞
  
  - session_state.quality_focus_history
    used_by_engine_4: 主動引用機制 Day N+1 開場「昨天你說了『[term]』」
```

### 6.3 引擎 2 與附錄 A 機制使用

```yaml
mechanism_usage:
  A1_requires_typing:
    used_by_E2: |
      若重 4 confirm 連續 2 turn fail(學員給不出 sensory detail)、
      可選擇 cascade 到 A1.requires_typing 強制具體 evidence。
      (但通常 E2_stay_candidate 變體 A 已處理大部分情境、A1 為最後手段)
  
  A1_sensory_detail_judgment:
    used_by_E2: |
      E2_aggregator 重 4 confirm 步驟 4c 直接呼叫 A1.judgment(Haiku 4.5 tool_call)
      input: user_response (after evidence_script)
      output: sensory_detail_score (0-4)
      threshold: >= 2 通過
  
  A3_handoff_escalation:
    used_by_E2: |
      E2_stay_candidate escalation_rules:
      - candidate 持續 ≥ 3 turn 無進展 → cascade 引擎 3、若引擎 3 也卡 → A3
      - ambiguous 持續 ≥ 5 turn → 強制進 Self-Concept 模型、不走 A3
```

---

## 7. Patrick 接手清單

### 7.1 migration 014 延伸欄位

引擎 2 新增 session_state 欄位、加到引擎 1 的 migration 014 JSONB 草案:

```
- session_state.current_quality_status (enum string)
- session_state.current_quality_candidate_term (string | null)
- session_state.identity_test_evidence_count (int)
- session_state.identity_sentence_pattern_hit (bool, per-turn)
- session_state.pattern_signal_hit (bool, per-turn)
- session_state.identity_signal_suspected_this_turn (bool)
```

新增 user-scoped 欄位(寫入 `user_profile_evolution`):

```
- user_profile_evolution.anchors: list (append on quality upgrade to owned)
- user_profile_evolution.quality_focus_history: list of objects (跨 session)
```

### 7.2 v4.0 detector framework 適配延伸

- master_detector regex_patterns 直接套 §5.1 Quality 詞表 + §5.2 身份句結構
- aggregator Sequential cascade 工程實作(詞彙 → pattern → not_ppl → confirm)
- Haiku 4.5 tool_call:重 4 confirm 步驟 4c 呼叫附錄 A1.sensory_detail judgment

### 7.3 Cross-engine state reuse

確認引擎 1 跟引擎 2 都讀寫同一個 `session_state` JSONB column——不分割兩個欄位空間。引擎 2 讀 `cumulative_ppl_score`、寫 `current_quality_status`。

### 7.4 24h 內回 ack 給設計師

格式:
> 「收到引擎 2 markdown、預估 X 天落地、有 Y 個工程疑問如下:[...]」

---

## 8. Forward References

### 8.1 引擎 3:4.7 中央路由器邏輯
本檔 §4.3 / §4.4 / §6.2 多次提到「路由到引擎 3」、「進 Self-Concept 模型」、「Cascade Down」等——這些是引擎 3 範圍、不在引擎 2 處理:
- `current_quality_status == "owned"` 之後做什麼(Build Vision / values 排序 / Cascade Down 驗證)
- `current_quality_status == "ambiguous"` 切換 Self-Concept 模型的具體路徑
- Linear Thinking Error / Containment Judgment(values 排序階段、不是身份測試)
- 反例整合 / 三向歸類觸發時機

### 8.2 引擎 4:AI 主動引用機制
本檔 §3.6 `quality_focus_history` 欄位是引擎 4 的核心 input、但引用方式(機械 vs 有方向性、Day N+1 開場句法)在引擎 4 處理。

### 8.3 dashboard / failure_signals
G-series failure modes(G1-G11)的 dashboard 監控 / alert spec 延後至 `v5_beta_failure_signals_dashboard.md`(引擎 3-4 寫完後集中)。

特別注意 **G6 A001 Day 1「鑽石」類型錯誤升級**——這是 Beta 階段最重要的監控訊號之一,證明 4 重組合是否真的防住 PPL 假陽性。

### 8.4 工具二三池正式判決進度
本檔觸發:
- ✅ 2A confirm_script 直接繼承(E2_aggregator 重 4 step 4a)
- ✅ 2A evidence_script 直接繼承(E2_aggregator 重 4 step 4b)
- ✅ 2A 身份句結構 5 個直接繼承 + 設計師擴展 3 個(§5.2)
- 2A SC 池整體判決:**KEEP 結構、UPGRADE 觸發機制**(confirm 通過從「回答夠長」升級為「4 重組合 + Haiku sensory judge」)

引擎 3 寫完後做工具二 2C Belief 池正式判決(觸發 #6 Step 1-4)。引擎 4 寫完後做整體三池總結。

---

## 文件版本

- v0.1 (2026-05-19):初版、設計師對話版、待 Patrick ship 版草稿
