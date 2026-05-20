# v5.0 引擎 1:對話偏離識別引擎(Deviation Detector)

> **文件用途**:Checkpoint 2 第一個交付件。Patrick 工程端接此檔做 schema 反推 + v4.0 detector framework 適配評估。
>
> **建立日期**:2026-05-19
>
> **對應方法論**:`damon_methodology.md` 章節 5.7(對話技藝)、5.7.4(AI app 必須原創處理的 3 個情境)、5.7.5(5 層撥開技術)、5.7.7(付費對等性原則)、6.10(失敗訊號監控)
>
> **對應 TODO**:`v5_next_actions.md` TODO 1 第一優先級 prompt 引擎 #1
>
> **版本**:設計師對話版(v0.1)。Patrick 24h 內提交 ship 版草稿、設計師 review。

---

## ⚠️ Sync Warning

**本檔內嵌 `damon_methodology.md` Layer 6 章節 6.10 全文摘錄**(見文末附錄 B)。

若 Patrick 工程端讀到的 `damon_methodology.md` 版本停在 Layer 5、Layer 6 為 gap——**以本檔內嵌版本為準**。完整 Layer 6 內容在設計師端 project knowledge 已存在,後續會推送同步版本。

---

## 目錄

1. [架構總覽](#1-架構總覽)
2. [Token Budget](#2-token-budget)
3. [Session State Fields(自生欄位、給 migration 014)](#3-session-state-fields)
4. [元件 spec](#4-元件-spec)
   - 4.1 cached_5_layer_unwrap_reference(cached prefix)
   - 4.2 E1_deviation_master_detector(Layer 1)
   - 4.3 E1_subtype_classifier(Layer 2)
   - 4.4 E1a_off_topic(Sub-prompt)
   - 4.5 E1b_vague_response(Sub-prompt)
   - 4.6 E1c_people_pleasing(Sub-prompt + requires_typing)
   - 4.7 E1d_spiritual_bypassing(Sub-prompt + 5 層撥開應用)
5. [附錄 A:引擎機制庫(雙方合約)](#5-附錄-a引擎機制庫)
6. [Patrick 接手清單](#6-patrick-接手清單)
7. [Forward References](#7-forward-references)
8. [附錄 B:方法論 6.10 失敗訊號內嵌](#8-附錄-b方法論-610-失敗訊號內嵌)

---

## 1. 架構總覽

引擎 1 採**三層 detector → classifier → 4 sub-prompt** pipeline 架構,加 1 個永久 cached 5 層撥開技術 reference。

```
┌─────────────────────────────────────────────────────────────┐
│ Layer 0: always_on_cached                                   │
│ ─ cached_5_layer_unwrap_reference (~600 tokens)             │
│   被 E1d 引用、永久載入、~26% baseline cost                  │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 1: detector_only(每 turn 觸發、token 0)                │
│ ─ E1_deviation_master_detector                              │
│   regex + cumulative_state + explicit_protest 偵測          │
│   output: deviation_suspected (bool)                        │
└─────────────────────────────────────────────────────────────┘
                            │ if suspected
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ Layer 2: conditional_inject(僅觸發時、~250 tokens)            │
│ ─ E1_subtype_classifier                                     │
│   structured output 分類:E1a / E1b / E1c / E1d / false_pos  │
│   仲裁優先級:PPL > Bypassing > Vague > Off-topic            │
└─────────────────────────────────────────────────────────────┘
                            │ recommended_sub_prompt
                            ▼
┌────────────┬────────────┬────────────┬────────────┐
│ E1a        │ E1b        │ E1c        │ E1d        │
│ off_topic  │ vague      │ PPL        │ bypassing  │
│ ~210 tk    │ ~210 tk    │ ~245 tk    │ ~270 tk    │
│            │            │ +A1.req_   │ +cached    │
│            │            │  typing    │  5 層引用   │
└────────────┴────────────┴────────────┴────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│ 附錄 A:引擎機制庫(雙方合約、跨引擎共用)                     │
│ ─ A1 requires_typing(物理性 PPL 防護)                       │
│ ─ A2 cumulative_score(通用累積分數模板)                     │
│ ─ A3 handoff_escalation(把判斷權交回學員)                   │
└─────────────────────────────────────────────────────────────┘
```

### 設計原則

1. **detector / classifier / sub-prompt 職責分明**:detector 寧錯殺、classifier 精準分類、sub-prompt 只管處理動作
2. **不發明 Damon 體系外的話術**:除 v5.0 已驗證原創 IP(5 層撥開、東方文化柔軟拆解、Scope Overlap、三向歸類)外、所有話術用 Damon 親口示範句或 mirror 結構
3. **物理性防護優先於話術挑戰**:E1c 走 requires_typing 物理機制、不發明後設提問
4. **跨引擎機制收進附錄 A**:requires_typing / cumulative_score / handoff_escalation 寫一次、引擎 2-4 重用

---

## 2. Token Budget

### Max simultaneous active state(任一 turn 的真實 token 佔用)

| 元件 | type | tokens | 計入 active? |
|---|---|---|---|
| cached_5_layer_unwrap_reference | always_on_cached | ~600 | ❌(cached prefix、~26% baseline cost) |
| E1_deviation_master_detector | detector_only | ~150 | ❌(regex match、token 0) |
| E1_subtype_classifier | conditional_inject | ~250 | ✅(僅觸發時) |
| E1a / E1b / E1c / E1d | conditional_inject | max 270 | ✅(任一觸發時、互斥) |

**Max simultaneous active**:classifier(~250)**OR** sub-prompt(max ~270)二擇一 = **~270 tokens**

→ 遠低於 v5.0 工程約束(active state max ~5-6K)、引擎 2-4 還有大量空間。

### v4.0 → v5.0 對比

| | v4.0 | v5.0 引擎 1 |
|---|---|---|
| Active state | ~9.5K | ~270 + cached 600(equivalent ~225 caching on)|
| **Token efficiency** | baseline | **高一個量級** |

---

## 3. Session State Fields

引擎 1 新增的 session_state 欄位、給 Patrick 做 migration 014 草案用。所有欄位遵循 4 sub-field 格式(range / initial_value / update_rule / reset_on)。

### 3.1 cumulative_ppl_score

```yaml
session_state.cumulative_ppl_score:
  range: 0.0 - 1.0 (float)
  initial_value: 0.0
  update_rule: |
    事件 → 加分:
      - E1c classifier 判 PPL high confidence: +0.20
      - E1c classifier 判 PPL medium confidence: +0.10
      - explicit_protest regex 命中: +0.30
      - consecutive_short_responses >= 3 且本 turn 也是短回應: +0.15
      - 學員回應與 AI 提問詞彙重疊度 > 0.7 (echo): +0.10
      - level 出口 4 重組合中「NOT People Pleasing」這重沒通過: +0.15
    事件 → 不變:
      - false_positive 判定
    封頂 1.0、不超過。
  decay_per_turn: -0.05   # 每個 turn 無 PPL 訊號自然衰減
  reset_on:
    - identity_test_passed       # 4.7 中央路由器身份測試通過(學員給出 sensory detail 證據)
    - new_session_day            # 跨 day 重置(NLP Amnesia 機制配合)
    - explicit_protest_resolved  # AI 處理完抗議、學員確認方向
  alert_thresholds:
    - 0.6: classifier 觸發 PPL 判定門檻
    - 0.8: 強制 inject E1c sub-prompt(不靠 classifier)
    - 1.0: failure_signal_3 觸發(方法論 6.10)→ HITL alert
```

### 3.2 consecutive_short_responses

```yaml
session_state.consecutive_short_responses:
  range: 0+ (integer)
  initial_value: 0
  update_rule: |
    本 turn user response 字數 ≤ 5 → +1
    本 turn user response 字數 > 5 → reset 0
  decay_per_turn: 0
  reset_on:
    - response_length > 5
    - new_session_day
```

### 3.3 consecutive_offtopic_turns

```yaml
session_state.consecutive_offtopic_turns:
  range: 0+ (integer)
  initial_value: 0
  update_rule: |
    classifier 判 off_topic → +1
    classifier 判 其他類 或 false_positive → reset 0
  decay_per_turn: 0
  reset_on:
    - classifier_not_offtopic
    - new_session_day
```

### 3.4 consecutive_vague_turns

```yaml
session_state.consecutive_vague_turns:
  range: 0+ (integer)
  initial_value: 0
  update_rule: |
    classifier 判 vague → +1
    classifier 判 其他類 或 false_positive → reset 0
  decay_per_turn: 0
  reset_on:
    - classifier_not_vague
    - new_session_day
```

### 3.5 recent_specific_examples_count

```yaml
session_state.recent_specific_examples_count:
  range: 0+ (integer, rolling window 5 turn)
  initial_value: 0
  update_rule: |
    本 turn user response 包含具體事件(時 / 地 / 人 / 動作 ≥ 2 個 marker)→ +1
    Rolling window 為 last 5 user turns、超出 window 的 example 自動移出計數
  decay_per_turn: 0   # 用 rolling window 不用衰減
  reset_on:
    - new_session_day
```

### 3.6 elicitation_mode_active

```yaml
session_state.elicitation_mode_active:
  range: bool
  initial_value: true   # session 開場預設採集模式
  update_rule: |
    - true → false:level 出口 4 重組合通過(6.2 機制)+ 進入 Mapping Across / Scope Overlap 階段
    - false → true:跨天回退到新 values 提取(罕見)
  decay_per_turn: N/A
  reset_on:
    - 由 4.7 中央路由器決定(引擎 3 範圍、此處只標 dependency)
```

### 3.7 bypassing_layer_progress

```yaml
session_state.bypassing_layer_progress:
  range: 0-6 (integer)
  initial_value: 0
  update_rule: |
    - 每次 E1d inject 後 +1(動作執行後)
    - 學員給出 sensory detail markers >= 1 → reset 0(撥開成功)
    - progress >= 6 → cascade handoff、reset 0
  decay_per_turn: 0
  reset_on:
    - sensory_detail_received
    - handoff_escalation_triggered
    - new_session_day
    - consecutive_turns_without_E1d_trigger >= 3   # 連續 3 turn 無 bypassing 訊號、視為話題切換
```

### 3.8 requires_typing_active

```yaml
session_state.requires_typing_active:
  range: bool
  initial_value: false
  update_rule:
    - "false → true: 觸發條件成立(見附錄 A1)"
    - "true → false: 解除條件成立(見附錄 A1)"
  decay_per_turn: 0
  reset_on:
    - sensory_detail_evidence_received
    - new_session_day
    - explicit_protest_resolved
```

### 3.9 輔助欄位(由其他機制寫入)

以下欄位由 master_detector / classifier / 附錄 A 機制寫入、非引擎自治:

```yaml
session_state.deviation_suspected_this_turn: bool      # master_detector 寫入
session_state.triggered_signals: list                  # master_detector 寫入
session_state.explicit_protest_hit: bool               # master_detector 寫入
session_state.last_ai_question: str                    # 主對話框架維護
session_state.last_user_response: str                  # 主對話框架維護
session_state.deviation_handled_this_turn: str         # sub-prompt 寫入(E1a/b/c/d)
session_state.handoff_triggered_count: int             # 附錄 A3 寫入
anchors_top3: list                                     # 主 profile 維護、引擎只讀
```

---

## 4. 元件 spec

### 4.1 cached_5_layer_unwrap_reference(always_on_cached)

```yaml
- id: cached_5_layer_unwrap_technique_reference
  type: always_on_cached
  cached_tokens: ~600
  purpose: |
    5 層撥開技術完整定義、永久 cached、被 E1d 引用。
    這是 v5.0 原創 IP #4(Challenge 1 驗證)、用於處理 spiritual bypassing
    及任何學員過度抽象 / 靈性化的對話偏離。
  
  reference_id: "TECHNIQUE_5_LAYER_UNWRAP"
  
  damon_alignment:
    - "動作 1、4、5 對應 Damon 體系內已有手法(指認大詞 / 感官校準 / Meta Model 重複)"
    - "動作 2、3 為原創——區分『現在的我 / 還沒接受的我』+ Mirror 結構放回身體層次"
  
  content: |
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    【5 層撥開技術 — 完整動作定義】
    
    用於處理:學員陷入抽象詞 / 靈性化詞 / 大詞迴圈、無法落回具體經驗。
    
    撥開順序:從外層(理性化 / 靈性化)往內(身體經驗)走。
    不一定每次都跑完 5 層——對話偏離解除即停。
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    【動作 1:指認對方說話的「高度」】
    
    Damon 對應:✅ 已存在(指認跳到宏大詞彙、MTA 案例)
    
    觸發:首次偵測到 spiritual_big_words 或大詞 + 缺具體事件
    
    話術骨架:
    > 「我注意到你跳到了『[大詞]』。
    > 這個詞太大、我抓不到。
    > 我們在更具體一點的層次談——[拉回 specific question]」
    
    禁止:重複大詞接續追問(會強化抽象循環)
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    【動作 2:區分「現在的我」與「過去那個還沒接受的我」】⭐ 原創
    
    Damon 對應:❌ 沒找到對應手法
    
    觸發:動作 1 後學員仍以「現在的我已經想通了」框架繼續抽象
    
    話術骨架:
    > 「等一下——
    > 你說的『[抽象詞 e.g. 我已經接受]』是『現在的你』的版本。
    > 但讓我問:
    > **過去那個還沒接受的你**、他當時是怎麼想的?
    > 那個版本的你、現在在哪裡?」
    
    核心邏輯:把抽象的「完成式」拆回未完成的、有時間性的具體經驗
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    【動作 3:Mirror 結構(重複句式但放回身體層次)】⭐ 原創
    
    Damon 對應:❌ 沒找到對應手法
    
    觸發:動作 2 後學員給出時間性區分、但仍卡在認知層次
    
    話術骨架:
    > 「你說『[學員原句、抽象版]』——
    > 我把這句重講一次、但用身體的版本:
    > 『[同樣句式、但抽象詞替換為身體 / 感官 / 動作詞]』
    > 這個版本、你覺得哪個更接近你真實的狀態?」
    
    範例:
    學員:「我已經整合了那段創傷」
    Mirror:「你的胃 / 胸口 / 喉嚨、已經整合了那段創傷?」
    
    核心邏輯:用 Mirror 暴露「認知接受」與「身體承載」的落差
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    【動作 4:連結客戶剛剛的兩個現象(言行不一)】
    
    Damon 對應:✅ 已存在(感官校準、George 案例)
    
    觸發:動作 3 後學員口頭認同身體層次、但下一句又跳回抽象
    
    話術骨架:
    > 「我注意到兩件事:
    > 一分鐘前你說『[身體層次回應]』。
    > 現在你又跳回『[抽象詞]』。
    > 這兩個之間發生了什麼?」
    
    核心邏輯:把不一致顯化、學員自己看到、不是 AI 評判
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    【動作 5:現場 Mirror(用客戶語言反映給他看)】
    
    Damon 對應:✅ 已存在(Meta Model 重複)
    
    觸發:動作 4 後學員開始迴避或加速抽象化
    
    話術骨架:
    > 「我把你剛剛 3 句話排起來:
    > 1. [學員第一句、抽象]
    > 2. [學員第二句、抽象]
    > 3. [學員第三句、更抽象]
    > 你看到這個 pattern 了嗎?
    > 我們已經在『[大詞]』裡轉了幾圈、還沒落地。」
    
    核心邏輯:Meta Model 的「重複客戶語言」+ 排序顯化、強迫客戶看到自己的迴圈
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    【完成判準】
    
    任一動作後、若學員給出 ≥ 1 個 sensory detail marker
    (時 / 地 / 人 / 動作 / 身體部位 / 具體事件):
    → 撥開成功、離開 E1d、回主流程
    
    若 5 層全跑完仍無 sensory detail:
    → cascade 到 handoff_escalation(附錄 A3、把判斷權交回學員)
    → 同時觸發 failure_signal_alert(這條 cascade 比想像更深、學員可能不適合純文字環境)
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### 4.2 E1_deviation_master_detector(Layer 1)

```yaml
- id: E1_deviation_master_detector
  type: detector_only
  layer: 1
  purpose: |
    每個 user turn 結束後檢查「是否可能發生對話偏離」。
    本層只做二分判斷、不分類。寧錯殺、不放過——分類交 E1_subtype_classifier。
  
  trigger:
    regex_patterns:
      vague_words:
        - "(應該是|大概|可能|好像|也許|或許|算是)"
        - "(就是|嗯|蛤|喔|哦)$"
        - "(都可以|都一樣|都好|隨便|看你)"
      short_compliance:
        - "^(是|對|好|嗯|可以|沒錯|沒有|還好)[。!\\s]*$"
        - "^.{1,4}$"
      spiritual_big_words:
        - "(整合|完整|圓滿|覺醒|實現|命運|充實|豐盛)"
        - "(一切都是最好的安排|順其自然|放下|臣服)"
        - "(內在小孩|高我|宇宙|能量|頻率|顯化)"
      explicit_protest:   # ⭐ A001 Day 3 五次抗議血淚教訓、最高優先級
        - "(你又|重複|鬼打牆|聽不懂|已經講過|你沒在聽|我們在繞)"
        - "(我的媽呀|OMG|靠|搞什麼)"
        - "(可以跳過嗎|可以結束嗎|今天討論差不多了|我之後再想想)"
    
    cumulative_state_signals:
      consecutive_short_responses: ">= 2"
      consecutive_offtopic_turns: ">= 1"
      consecutive_vague_turns: ">= 2"
      cumulative_ppl_score: ">= 0.6"
    
    priority_override:
      explicit_protest_hit: |
        命中 explicit_protest 任一 pattern → 強制 cascade 到 classifier、
        不檢查 cumulative state、不檢查其他 regex。
        同時 cumulative_ppl_score += 0.30(在 classifier 觸發前)。
  
  output:
    deviation_suspected: true | false
    triggered_signals: [...]
    explicit_protest_hit: bool
    handoff_to: E1_subtype_classifier (if deviation_suspected)
  
  active_state_tokens: ~150 (detector_only、不計入 active state 預算)
  
  inputs_from_profile:
    - session_state.consecutive_short_responses
    - session_state.consecutive_offtopic_turns
    - session_state.consecutive_vague_turns
    - session_state.cumulative_ppl_score
    - session_state.last_ai_question
  
  outputs_to_profile:
    - session_state.deviation_suspected_this_turn: bool
    - session_state.triggered_signals: list
    - session_state.cumulative_ppl_score: +0.30 if explicit_protest_hit
  
  trigger_state_transition: false
  
  failure_modes:
    - id: F1
      mode: "亞洲內斂學員短話被 short_compliance 全打中"
      mitigation: "classifier 第 2 層用『有無具體名詞』再 filter"
    - id: F2
      mode: "values elicitation 階段學員講『自由』被 spiritual_big_words 命中"
      mitigation: "classifier 用 elicitation_mode_active + recent_specific_examples_count 放行"
```

---

### 4.3 E1_subtype_classifier(Layer 2)

```yaml
- id: E1_subtype_classifier
  type: conditional_inject   # Patrick ship 時可能改 tool_call(Haiku 4.5)、對 prompt_content 無影響
  layer: 2
  triggered_by: E1_deviation_master_detector → deviation_suspected: true
  active_state_tokens: ~250 (僅觸發時)
  
  inputs_from_profile:
    - session_state.last_ai_question
    - session_state.last_user_response
    - session_state.triggered_signals
    - session_state.explicit_protest_hit
    - session_state.elicitation_mode_active
    - session_state.recent_specific_examples_count
    - session_state.cumulative_ppl_score
    - session_state.consecutive_short_responses
    - session_state.consecutive_offtopic_turns
    - session_state.consecutive_vague_turns
    - anchors_top3
  
  outputs_to_profile:
    deviation_classification:
      deviation_type: "off_topic" | "vague" | "people_pleasing" | "bypassing" | "false_positive"
      confidence: "high" | "medium" | "low"
      evidence: [list]
      arbitration_applied: bool
      recommended_sub_prompt: "E1a" | "E1b" | "E1c" | "E1d" | "none"
    session_state_updates:
      cumulative_ppl_score: per update_rule
      consecutive_*_turns: per update_rule
  
  prompt_content: |
    [SYSTEM INJECT — Deviation Subtype Classifier]
    
    本輪偵測到可能的對話偏離。分類為以下 5 類之一:
    
    **explicit_protest_hit 優先處理**
    若 session_state.explicit_protest_hit == true、直接判定如下:
    - 命中「跳過 / 結束 / 我之後再想想」→ recommended_sub_prompt = E1c(PPL 反彈、用付費對等性原則處理)
    - 命中「你又 / 鬼打牆 / 沒在聽」→ recommended_sub_prompt = E1a(AI 自己偏離了、要 reset)
    - 命中情緒詞(媽呀 / OMG)→ 不歸 4 類、回 "none" 但 confidence = "high"、由主對話 LLM 自然回應(承認情緒)
    
    **E1a — off_topic**
    - 學員回應與 AI 上一輪提問詞彙重疊度低
    - 內容是故事細節(時/地/人具體)、不是針對提問的答覆
    - consecutive_offtopic_turns >= 1
    
    **E1b — vague**
    - 模糊詞命中、且缺少具體名詞 / 事件
    - F1 防護:亞洲內斂學員短話 + 具體名詞 ≠ 敷衍、判 false_positive
    
    **E1c — people_pleasing**
    觸發條件(至少 2 個成立):
    - 短配合回應(「是」「對」「好」單獨成句)
    - 回應與 AI 上一輪提問詞彙過度重疊(echo)
    - 連續 ≥ 3 turn 沒提出新內容 / 新詞彙
    - cumulative_ppl_score >= 0.6
    - 回應「太快、太順、太完整」——無自然停頓、無自我修正
    
    **E1d — bypassing**
    - Spiritual 大詞命中
    - 缺少具體事件支撐
    - F4 精準防護:elicitation_mode_active == true AND recent_specific_examples_count >= 2
      → values 大詞合法、判 false_positive
    
    **false_positive**
    - regex 命中但語意不構成偏離
    
    **仲裁規則(多類同時成立)**
    優先級:people_pleasing > bypassing > vague > off_topic
    理由:PPL 累積最危險會 cascade 整個 session;bypassing 影響後續 values 真實性;
    vague / off_topic 只影響當下 turn。
    
    輸出 structured JSON:
    {
      "deviation_type": "...",
      "confidence": "...",
      "evidence": [...],
      "arbitration_applied": bool,
      "recommended_sub_prompt": "E1a" | "E1b" | "E1c" | "E1d" | "none"
    }
  
  failure_modes:
    - id: F3
      mode: "classifier 判 false_positive 但實為真偏離"
      mitigation: "下輪 master_detector 再觸發、cumulative state 累積、第 2-3 次觸發 classifier 更傾向真陽性"
    - id: F4
      mode: "values elicitation 階段大詞誤判 bypassing"
      mitigation: "elicitation_mode_active + recent_specific_examples_count >= 2 → false_positive"
    - id: F5
      mode: "explicit_protest 命中但分類器仍誤分到無關類別"
      mitigation: "priority_override 寫在 prompt_content 開頭、強制檢查 explicit_protest_hit 旗標"
```

---

### 4.4 E1a_off_topic

```yaml
- id: E1a_off_topic
  type: conditional_inject
  triggered_by: E1_subtype_classifier → recommended_sub_prompt == "E1a"
  active_state_tokens: ~210
  
  inputs_from_profile:
    - session_state.last_ai_question
    - session_state.last_user_response
    - session_state.consecutive_offtopic_turns
    - anchors_top3
  
  outputs_to_profile:
    session_state.consecutive_offtopic_turns: +1
    session_state.deviation_handled_this_turn: "E1a"
  
  damon_source:
    - "5.7.3 情境 1 — Interrupting the Pattern"
    - "Damon MTA 案例原話:『你用了很多詞彙來繞圈子、但就是沒有觸及你的價值觀』"
    - "Damon 教學原話:『我理解這對你很重要、但我們不能走那條路』"
  
  prompt_content: |
    [SYSTEM INJECT — Off-topic Recovery]
    
    學員偏離主軸、陷入故事細節(getting into content)。
    執行 Interrupting the Pattern:**承認 + 重新導向**、不假裝沒看到。
    
    **必須做**:
    1. 承認(降低 break rapport 風險):「我理解這對你很重要」
    2. 明說偏離:「但我們有點偏離主軸了」/「但我們不能走那條路」
    3. 重新導向回原提問:重述 last_ai_question 的核心、不機械複誦
    
    **話術變體**:
    
    變體 A — 標準款:
    > 「我理解這對你很重要、但我注意到我們繞開了我剛問的東西。
    > 讓我再問一次:[重述 last_ai_question 的核心、用學員的詞重新組裝]」
    
    變體 B — Damon MTA 案例款(consecutive_offtopic_turns >= 2 時用):
    > 「你用了很多詞繞圈子、但還沒有真的回到我問的[核心詞]。
    > 我想再確認一次:[重述]?」
    
    變體 C — anchor 引用款(anchors_top3 非空時用):
    > 「我們剛在挖『[anchor]』、你卻跳到[偏離內容]。
    > 我把你拉回來——[重述 last_ai_question]」
    
    **禁止**:
    - 不可順著故事細節繼續追問
    - 不可說「你說得對、那讓我們...」(這是 A001 Day 3 軟接陷阱)
    - 不可道歉(「不好意思打斷你」會弱化權威性、違反付費對等性原則)
  
  failure_modes:
    - id: F6
      mode: "consecutive_offtopic_turns >= 3、學員持續偏離"
      mitigation: |
        cascade 到附錄 A3.handoff_escalation:
        把判斷權交回學員、避免無限拉扯
    - id: F7
      mode: "重述 last_ai_question 變成機械複誦、引發 explicit_protest"
      mitigation: |
        重述必須用學員自己的詞重新組裝(從 last_user_response 抓 1-2 個名詞)、
        不可逐字重複 last_ai_question 原文。
```

---

### 4.5 E1b_vague_response

```yaml
- id: E1b_vague_response
  type: conditional_inject
  triggered_by: E1_subtype_classifier → recommended_sub_prompt == "E1b"
  active_state_tokens: ~210
  
  inputs_from_profile:
    - session_state.last_user_response
    - session_state.consecutive_vague_turns
    - session_state.cumulative_ppl_score
  
  outputs_to_profile:
    session_state.consecutive_vague_turns: +1
    session_state.deviation_handled_this_turn: "E1b"
    session_state.cumulative_ppl_score: +0.10 if consecutive_vague_turns >= 2
  
  damon_source:
    - "5.7.3 情境 2 — Meta Model Challenge + 不一致指認"
    - "Damon Lucia 案例原話:『我不喜歡這個答案... 這個 not really 不是一個真實的答案』"
    - "Damon 教學原話:『我沒被說服... 告訴我更多、你的體驗是什麼』"
  
  prompt_content: |
    [SYSTEM INJECT — Vague Response Challenge]
    
    學員回應模糊(應該是 / 大概 / 好像)、缺少具體內容。
    執行 Meta Model Challenge:**直接表達不滿 + 強迫澄清**、不假裝接受。
    
    **必須做**:
    1. 直接表達不接受這個答案(付費對等性原則:可以說「我不喜歡這個答案」)
    2. 強迫具體化:要求學員給出**具體事件 / 感受 / 證據**
    3. 不允許用更模糊的詞繼續(「就是...啊」「反正就...」)
    
    **話術變體**:
    
    變體 A — Damon Lucia 案例款(首次觸發、consecutive_vague_turns == 1):
    > 「我沒被說服。
    > 『[引用學員模糊詞 e.g. 應該是吧]』不是一個真實的答案——
    > 告訴我更多、你的體驗到底是什麼?」
    
    變體 B — 強度提升款(consecutive_vague_turns >= 2):
    > 「我不喜歡這個答案。
    > 你已經連續兩次用『[模糊詞]』回我——
    > 是這個問題本身有問題、還是有什麼讓你不想回答?」
    
    變體 C — 具體化引導款(學員模糊但似乎卡在不知道怎麼表達):
    > 「我聽到『[模糊詞]』、但我需要更具體的東西。
    > 給我一個你最近的具體例子——什麼時候、在哪裡、跟誰、發生了什麼?」
    
    **禁止**:
    - 不可接受『大概是這樣吧』然後繼續下一個提問(A001 Day 1-3 的核心 bug)
    - 不可幫學員填空(『你的意思是 X 嗎?』會誘發 PPL)
    - 不可道歉式追問(『不好意思、可以再說一次嗎?』)
  
  escalation_rules:
    - condition: "consecutive_vague_turns >= 3 AND cumulative_ppl_score >= 0.6"
      action: "升級到 E1c(已不是單純敷衍、是 PPL pattern)"
    - condition: "consecutive_vague_turns >= 2 AND 學員回應包含 spiritual_big_words"
      action: "升級到 E1d(敷衍 + bypassing 雙觸發、按仲裁規則走 bypassing 優先級高)"
  
  failure_modes:
    - id: F8
      mode: "學員是真的不知道、不是敷衍"
      mitigation: |
        變體 C 已涵蓋這個情境——把『不知道怎麼表達』也視為合法 user state、
        用具體化引導(時/地/人/動作)幫學員 ground、不是繼續挑戰。
        Damon 體系內:『如果你不知道你想要什麼、那你想要的是知道你想要什麼』邏輯延伸。
    - id: F9
      mode: "變體 B 強度過高、學員 break rapport"
      mitigation: |
        若下輪偵測到 explicit_protest hit、立刻 cascade 到附錄 A3.handoff_escalation
        (承認 + 把選擇權交回)、避免拉扯。
```

---

### 4.6 E1c_people_pleasing

```yaml
- id: E1c_people_pleasing
  type: conditional_inject
  triggered_by: E1_subtype_classifier → recommended_sub_prompt == "E1c"
  active_state_tokens: ~245
  
  inputs_from_profile:
    - session_state.last_ai_question
    - session_state.last_user_response
    - session_state.cumulative_ppl_score
    - session_state.consecutive_short_responses
    - session_state.recent_specific_examples_count
    - session_state.requires_typing_active   # 見附錄 A1
    - anchors_top3
  
  outputs_to_profile:
    session_state.cumulative_ppl_score: per update_rule
    session_state.requires_typing_active: true (在達到觸發條件時)
    session_state.deviation_handled_this_turn: "E1c"
  
  damon_source:
    - "5.7.3 情境 2 — Damon Lucia 案例『我不喜歡這個答案』(同 E1b 出處、E1c 沿用 Damon 親口句)"
    - "5.7.3 情境 3 — Damon George 案例感官校準原則(內部 mental model、不外顯為提問)"
    - "5.7.7 付費對等性原則:更高警覺、付費 context 下 PPL 更強烈"
    - "v4 工具二 2B week2_day3_script.requires_typing 機制(學員親自打字物理性高 friction)"
  
  design_decision_note: |
    E1c 不發明新的「後設提問」(如『你是真的想到還是覺得我會想聽』)——
    這超出 Damon 體系。E1c 走「Damon 親口句反問 + 物理性 requires_typing 防護」路徑。
    Beta 階段若 E1c 防護不足、PPL 仍 cascade、觸發失敗訊號 3(6.10)→ HITL alert →
    再決定是否需要原創後設提問。v5.0 暫不冒這個風險。
  
  prompt_content: |
    [SYSTEM INJECT — People Pleasing Pattern Detected]
    
    學員出現過度合作 pattern——跨 turn 累積配合、缺乏新內容、cumulative_ppl_score 已達門檻。
    
    這不是單一 turn 模糊回應(那是 E1b)、是**累積的 pattern**。
    
    **付費對等性原則**:不允許客戶模糊退場、不允許用配合敷衍過關。
    用 Damon 親口示範句反問、不發明新的後設提問。
    
    **必須做**(三段式):
    
    1. **直接表達不接受**(Damon Lucia 風格、付費對等性最低底線):
       - 「我不喜歡這個答案」/「我沒被說服」
    
    2. **指認累積模式**(不指認當下這句、指認 pattern):
       - 「你已經連續[N] turn 給我[短回應 / 配合詞 / 重複我的詞]」
       - N 從 consecutive_short_responses 抓
    
    3. **要求具體事件回應**(轉移到 ground-able 提問、不繼續抽象):
       - 「給我一個你最近的具體時刻——什麼時候、跟誰、發生了什麼?」
    
    **話術變體**:
    
    變體 A — 短回應累積款(consecutive_short_responses >= 3):
    > 「我不喜歡這個答案。
    > 你已經連續三輪用『是』/『對』/『嗯』在回我——
    > 給我一個具體時刻、什麼時候、跟誰、發生了什麼?」
    
    變體 B — Echo 累積款(回應與提問詞彙重疊度高):
    > 「我沒被說服。
    > 你剛剛只是把我的問題用你的話重講一遍——
    > 我要的不是這個。給我一個你自己的具體例子。」
    
    變體 C — anchor 對齊款(anchors_top3 非空):
    > 「停一下。
    > 你之前說了『[anchor]』、但現在你給我的是『[短回應]』——
    > 這兩個對得起來嗎?
    > 還是『[短回應]』只是為了讓我們繼續往下走?」
    
    **禁止**:
    - 不可發明後設提問(如「你是真的想到還是覺得我會想聽」)——這超出 Damon 體系
    - 不可道歉式追問
    - 不可接受第二次短回應、必須升級到 requires_typing(附錄 A1)
    
    **🔒 強制動作:requires_typing 觸發**
    
    若本輪 inject E1c 後、**下一輪 user response 仍命中 short_compliance regex**:
    → 呼叫附錄 A1.requires_typing 機制
    → session_state.requires_typing_active = true
    → 下下輪 AI 提問必須帶 requires_typing 標記、學員必須打出指定具體內容才推進
  
  variable_filling_method: |
    Patrick 工程把 last_user_response / last 3 user turns / anchors_top3 放進主 LLM 的
    prompt context、主 LLM 自己讀自己填變數([N] / [短回應] / [anchor])、無額外 LLM call。
  
  escalation_rules:
    - condition: "E1c 觸發 3 次 in same session"
      action: |
        Vivi HITL alert(方法論 6.10 失敗訊號 3):
        「session [X] 的 [學員 ID] 在 [N] turn 內 PPL 觸發 3 次、
         可能是 prompt 對抗性不足、不是學員問題。」
    - condition: "requires_typing 失敗 2 次"
      action: "降級到附錄 A3.handoff_escalation、避免破壞 rapport"
  
  failure_modes:
    - id: F10
      mode: "E1c 對亞洲內斂學員過度敏感、把『個性短話』判 PPL"
      mitigation: |
        classifier 階段已過濾(F1)——E1c 觸發前提是 cumulative_ppl_score >= 0.6
        且至少 2 個 PPL 訊號成立、不是單純短話。
        若仍誤判:requires_typing 機制下、學員給出具體事件即解除、不會持續被卡。
    - id: F11
      mode: "Damon 親口句『我不喜歡這個答案』直譯到中文亞洲學員、可能讀感過於直白"
      mitigation: |
        允許 LLM 在保留語意強度前提下做語感調整、
        如:「這個答案我沒辦法接受」/「這個答案我得 push back」
        但禁止軟化到失去挑戰力(如:「可以再說一次嗎?」這種道歉式)
    - id: F12
      mode: "requires_typing 機制執行不力、學員打字但仍是 PPL 內容"
      mitigation: |
        requires_typing 解除條件不只是「打了字」、是「打了 ≥ 2 個 sensory detail markers」。
        無 marker 的長回應 = 視為 requires_typing 未滿足、繼續卡住。
        詳見附錄 A1.judgment(Haiku 4.5 tool_call 判斷)。
```

---

### 4.7 E1d_spiritual_bypassing

```yaml
- id: E1d_spiritual_bypassing
  type: conditional_inject
  triggered_by: E1_subtype_classifier → recommended_sub_prompt == "E1d"
  active_state_tokens: ~270
  
  inputs_from_profile:
    - session_state.last_user_response
    - session_state.bypassing_layer_progress
    - session_state.recent_specific_examples_count
    - session_state.elicitation_mode_active
    - anchors_top3
  
  outputs_to_profile:
    session_state.bypassing_layer_progress: incremented or reset
    session_state.deviation_handled_this_turn: "E1d"
    session_state.cumulative_ppl_score: -0.10 if sensory detail received (撥開成功小額 reward)
  
  damon_source:
    - "5.7.3 情境 4 Damon MTA 案例:『你跳到了諸如整合、完整、目標、實現這些詞』"
    - "5.7.5 v5.0 原創 IP #4:5 層撥開技術(已驗證原創)"
    - "Cached reference: TECHNIQUE_5_LAYER_UNWRAP(本檔 4.1)"
  
  prompt_content: |
    [SYSTEM INJECT — Spiritual Bypassing / Abstract Loop]
    
    學員陷入抽象詞 / 靈性化詞迴圈、無法落回具體經驗。
    
    執行 5 層撥開技術(完整定義見 cached reference: TECHNIQUE_5_LAYER_UNWRAP)。
    
    **動作選擇邏輯**:
    
    讀取 session_state.bypassing_layer_progress(當前撥開層次、initial = 0):
    
    - progress == 0:執行【動作 1:指認大詞高度】
      → 觸發後 progress = 1
    
    - progress == 1:檢查上輪回應
      - 學員給出時間性區分(過去/現在/未來)→ 跳【動作 3:Mirror 結構】、progress = 3
      - 學員仍以「現在的我已經...」框架抽象 → 執行【動作 2:時間區分】、progress = 2
      - 學員給 sensory detail → **撥開成功、清空 progress、回主流程**
    
    - progress == 2:執行【動作 3:Mirror 結構】、progress = 3
    
    - progress == 3:檢查上輪回應
      - 學員口頭認同身體層次 + 下句又抽象 → 執行【動作 4:連結言行不一】、progress = 4
      - 學員給 sensory detail → 撥開成功
      - 學員直接迴避 → 跳【動作 5:現場 Mirror】、progress = 5
    
    - progress == 4:執行【動作 4】、progress = 5
    
    - progress == 5:執行【動作 5:現場 Mirror】、progress = 6
    
    - progress >= 6:**5 層全跑完、學員仍抽象化**
      → cascade 到附錄 A3.handoff_escalation
      → 觸發 failure_signal_alert
      → 提案降頻、跨 day 再試
    
    **填空指引**:
    
    動作話術骨架在 cached reference、本次 inject 只需把骨架的 [變數] 替換:
    - [大詞] → 從 session_state.last_user_response 抓出最抽象的名詞
    - [學員原句、抽象版] → 從 last_user_response 抓主要句子
    - [同樣句式、但抽象詞替換為身體 / 感官 / 動作詞] → LLM 替換、保留句式不變
    - 動作 5 的 3 句話列表 → 從 last 3 user turns 抓
    
    **F4 精準防護(values elicitation 階段 safe path)**:
    
    若 session_state.elicitation_mode_active == true
    AND session_state.recent_specific_examples_count >= 2:
    → 不該觸發 E1d(classifier 應已判 false_positive)
    → 若仍走到 E1d:downgrade 到動作 1 only、不深入後續層級、保留 values 提取主軸
    
    **禁止**:
    - 不可跳層(progress 必須遞增、否則撥開失去 grounding 邏輯)
    - 不可同一輪同時執行多動作(每 turn 推進 1 層)
    - 不可用 spiritual 語言回應 spiritual 偏離(會強化迴圈)
  
  variable_filling_method: |
    Patrick 工程把 last_user_response / last 3 user turns 放進主 LLM 的
    prompt context、主 LLM 自己讀自己填變數、無額外 LLM call。
  
  failure_modes:
    - id: F13
      mode: "動作 2 / 3 對亞洲學員過於抽象、反而強化迴圈"
      mitigation: |
        動作 2「過去那個還沒接受的你」+ 動作 3「身體 Mirror」是原創、
        Beta 階段必須監控:若某類學員群體連續卡在 progress 2-3、
        證明動作 2-3 在亞洲環境失敗、需要 fallback 到動作 1 → 4 → 5 直跳。
        (Beta 驗證項、v5.0 不預先 hedge)
        Forward reference:dashboard 監控 spec 見 v5_beta_failure_signals_dashboard.md
    - id: F14
      mode: "values elicitation 階段誤觸 E1d(F4 失效)"
      mitigation: |
        prompt_content 內已有 downgrade 機制、即使誤觸也不會深入。
        若連續觸發:classifier 的 elicitation_mode_active 判斷有 bug、HITL alert。
    - id: F15
      mode: "progress 5 後仍抽象、handoff_escalation 失敗(學員仍配合)"
      mitigation: |
        cascade 到 E1c(PPL pattern)+ requires_typing 強制具體事件、
        從 bypassing 治理轉為 PPL 治理(這兩種偏離經常共病)
  
  cross_engine_interaction:
    - "E1d progress >= 3 但學員配合度高 → 可能共病 PPL、檢查 cumulative_ppl_score"
    - "若 ppl_score >= 0.6 且 bypassing_progress >= 3:cascade 到 E1c + 附錄 A1.requires_typing"
```

---

## 5. 附錄 A:引擎機制庫

> **格式說明**:雙方合約。設計師 spec 時呼叫「附錄 A.X」、不重寫邏輯。Patrick 工程實作 1 次、所有引擎共用。

### A1. requires_typing 機制

```yaml
requires_typing:
  purpose: |
    PPL 防護物理性機制——強迫學員打出含 sensory detail 的具體內容、
    不能用短回應 / 配合詞推進。
    繼承自 v4.0 工具二 2B week2_day3_script.requires_typing 機制。
  
  state_field:
    session_state.requires_typing_active:
      range: bool
      initial_value: false
      update_rule:
        - "false → true: 觸發條件成立"
        - "true → false: 解除條件成立"
      decay_per_turn: 0
      reset_on:
        - sensory_detail_evidence_received
        - new_session_day
        - explicit_protest_resolved
  
  trigger_conditions:
    - "E1c sub-prompt inject 後、下一輪 user response 仍命中 short_compliance regex"
    - "cumulative_ppl_score >= 0.8"
    - "(未來引擎可新增、例如 Scope Overlap 階段 ground-able evidence 收集)"
  
  blocking_logic:
    description: |
      requires_typing_active == true 時、AI 推進邏輯被阻斷:
      - AI 不可進入下個提問
      - AI 必須帶 requires_typing 標記、要求學員具體回應
      - 學員回應後、呼叫 A1.judgment 評估
      - judgment 通過 → 解除阻斷、繼續主流程
      - judgment 未通過 → 維持阻斷、再次要求(最多 2 次、超過 cascade 到 A3)
  
  judgment:
    method: Haiku_4.5_tool_call
    inputs:
      - user_response_last_turn
    output_schema:
      has_time_marker: bool
      has_location_marker: bool
      has_person_marker: bool
      has_action_marker: bool
      sensory_detail_score: 0-4 (count of markers)
    threshold_for_clearance: "sensory_detail_score >= 2"
    latency_target: 200ms
    cost_estimate: "+$0.01-0.03 / 學員 / 21 天(觸發頻率 0.5-1 次/場)"
  
  prompt_template_for_AI:
    description: |
      requires_typing_active == true 時、AI 提問必須套用此 template、
      不可用一般提問句式。
    template: |
      「我需要你親自打出來、不是『對』或『是』:
      [具體要求、例如『你昨天做了哪一件事、讓你覺得你是一個[anchor]的人?』]
      給我這件事的:時間、地點、那時你做了什麼動作。
      沒這三個東西、我們不往下走。」
  
  failure_handling:
    after_2_failed_attempts:
      action: "cascade 到 A3.handoff_escalation"
      reason: "避免無限拉扯破壞 rapport"
  
  engineering_implementation: ⚙️ Patrick
    files_estimated:
      - "lib/state/requires-typing.js (state mutation + blocking logic)"
      - "lib/haiku-judge/sensory-detail.js (Anthropic SDK + Haiku 4.5 + structured output)"
```

### A2. cumulative_score 機制(通用模板)

```yaml
cumulative_score:
  purpose: |
    跨 turn 累積判斷的通用機制。
    引擎用此模板定義自己的累積分數(如 cumulative_ppl_score、未來可能的
    cumulative_bypassing_score、cumulative_resistance_score 等)。
  
  template_structure:
    field_name: "session_state.cumulative_<dimension>_score"
    range: 0.0 - 1.0 (float)
    initial_value: 0.0
    update_rule_format: |
      事件 → 加分:[事件清單 + 加分幅度]
      事件 → 不變:[排除清單]
      封頂 1.0、不超過。
    decay_per_turn: "通常 -0.05/turn(無相關訊號時自然衰減)"
    reset_on:
      - "[引擎自定的 reset 條件、例如 identity_test_passed]"
      - new_session_day
    alert_thresholds:
      - 0.6: "classifier 觸發判定門檻"
      - 0.8: "強制 inject sub-prompt(繞過 classifier)"
      - 1.0: "HITL alert / failure_signal 觸發"
  
  current_instances:
    - cumulative_ppl_score: "E1c 使用、見本檔 3.1"
    - "(未來可擴充)"
  
  engineering_implementation: ⚙️ Patrick
    files_estimated:
      - "lib/state/cumulative-score.js (通用模板)"
      - "lib/state/instances/ppl-score.js (E1c 實例)"
```

### A3. handoff_escalation 機制

```yaml
handoff_escalation:
  purpose: |
    把判斷權交回學員的標準流程。
    用於各種「AI 已嘗試多次、學員仍卡住」的場景、
    避免無限拉扯破壞 rapport、同時收集 HITL 訊號。
  
  trigger_conditions:
    - "E1c requires_typing 連續失敗 2 次"
    - "E1d bypassing_layer_progress >= 6"
    - "E1a consecutive_offtopic_turns >= 3"
    - "(未來引擎可新增)"
  
  state_field:
    session_state.handoff_triggered_count:
      range: 0+ (integer)
      initial_value: 0
      update_rule: "每次 handoff_escalation 觸發 +1"
      decay_per_turn: 0
      reset_on:
        - new_session_day
  
  prompt_template_for_AI:
    description: |
      handoff_escalation 觸發時、AI 必須跳出當前治理動作、
      把選擇權明確交回學員、不繼續推進。
    template: |
      「我先停下來。
      我注意到我們在[偏離類型描述]、我已經試了[N]次、但好像沒推進。
      
      我想跟你確認一件事:
      [二選一 / 三選一具體選項]
      
      你選哪個都可以——我不繼續推進、等你決定。」
    
    example_variants:
      from_E1c_PPL_failure:
        two_choice: |
          「我需要你給我具體的事——但你給不出來。
          我想確認:
          (a)這個方向不對(不該繼續挖這個 anchor)
          (b)現在不是好時機(累了、想休息)
          你選哪個都可以。」
      
      from_E1d_bypassing_failure:
        two_choice: |
          「我們在『[大詞]』裡轉了 5 圈、還沒落到具體。
          我想確認:
          (a)這個主題對你來說只有抽象的版本、沒有具體經驗可以挖
          (b)有具體經驗、但現在不想說
          你選哪個都可以。」
  
  side_effects:
    - "session_state.handoff_triggered_count: +1"
    - "若 session 內 handoff_triggered_count >= 2 → HITL alert(這場 session 已多次推進失敗)"
    - "對應方法論 6.10 失敗訊號(見附錄 B)"
  
  post_handoff:
    if_student_chooses_redirect: "AI 接受、調整方向、不追問為什麼"
    if_student_chooses_pause: "AI 接受、引導 takeaway 收尾、不強推"
    if_student_silent_or_evades: "AI 不再推進、進入低強度收尾模式、保留 session 體面結束"
  
  engineering_implementation: ⚙️ Patrick
    files_estimated:
      - "lib/state/handoff-escalation.js (state mutation + alert trigger + branching)"
```

### 機制 × 引擎引用對照(目前狀態)

```yaml
mechanism_usage_map:
  A1_requires_typing:
    used_by: [E1c]
    future_potential: [Scope Overlap evidence collection, Layer 0 識別維度採集]
  
  A2_cumulative_score:
    used_by: [E1c (cumulative_ppl_score)]
    future_potential: [bypassing accumulated tracking, resistance tracking]
  
  A3_handoff_escalation:
    used_by: [E1a, E1c, E1d]
    future_potential: [所有「無限拉扯」場景的標準退出]
```

---

## 6. Patrick 接手清單

收到本檔 24h 內、Patrick 完成:

### 6.1 Schema 反推 → migration 014 草案

從本檔 §3 collect 所有 `session_state.*` 欄位、設計 JSONB column on user_profile_evolution table、或獨立 session_state table:

- `session_state.cumulative_ppl_score` (float, 0.0-1.0)
- `session_state.consecutive_short_responses` (int)
- `session_state.consecutive_offtopic_turns` (int)
- `session_state.consecutive_vague_turns` (int)
- `session_state.recent_specific_examples_count` (int, rolling window 5)
- `session_state.elicitation_mode_active` (bool)
- `session_state.bypassing_layer_progress` (int, 0-6)
- `session_state.requires_typing_active` (bool)
- `session_state.deviation_suspected_this_turn` (bool)
- `session_state.triggered_signals` (list)
- `session_state.explicit_protest_hit` (bool)
- `session_state.last_ai_question` (str)
- `session_state.last_user_response` (str)
- `session_state.deviation_handled_this_turn` (str | null)
- `session_state.handoff_triggered_count` (int)

### 6.2 v4.0 detector framework 適配評估

對比 v4.0 已有 detector / regex / conditional_injection framework、評估繼承度:

- master_detector regex patterns:v4.0 是否已有「模糊詞 / 短配合詞 / spiritual 大詞」regex?
- conditional_injection framework:v4.0 已存在、確認 inject 介面適配 4.x sub-prompt
- cached prefix integration:cached_5_layer_unwrap_reference 進入 v4.0 主 cached prefix 順序

### 6.3 附錄 A 機制工程實作 spec(給 Claude Code 寫)

- A1 requires_typing:`lib/state/requires-typing.js` + `lib/haiku-judge/sensory-detail.js`
- A2 cumulative_score:`lib/state/cumulative-score.js`(通用模板)+ `lib/state/instances/ppl-score.js`(E1c instance)
- A3 handoff_escalation:`lib/state/handoff-escalation.js`

### 6.4 24h 內回 ack 給設計師

格式:
> 「收到引擎 1 markdown、預估 X 天落地、有 Y 個工程疑問如下:[...]」

---

## 7. Forward References

本檔以下內容延後到專門檔處理:

### 7.1 dashboard 監控 / alert 機制
本檔 F-series failure_modes(F13/F14/F15)的監控規格、ALL HITL alert 觸發條件、handoff_triggered_count 累積追蹤——延後至 `v5_beta_failure_signals_dashboard.md`(引擎 2-4 寫完後集中 spec)。

### 7.2 ship 版本草稿
本檔為「設計師對話版」。Patrick 24h 內提交「ship 版本草稿」、做以下調整:
- 去除「對設計師說明」meta 段落
- 加入 runtime placeholder(`{{user_profile_snapshot}}` / `{{anchors_top3}}` 等)
- 設計師 review 後正式 ship 進 v5.0 chat.js system prompt

### 7.3 工具二三池正式判決
本檔已 partial 觸發:
- ✅ 2B Reactive 池「requires_typing 物理機制」繼承(E1c 用)
- ❌ 2B 句式池本身仍作廢
- 2A / 2C 正式判決等引擎 2-4 寫完再回頭做

### 7.4 引擎 2-4 sketch
- 引擎 2:Level 出口 4 重組合判斷(方法論 6.2)
- 引擎 3:4.7 中央路由器邏輯(方法論 4.7)
- 引擎 4:AI 主動引用機制的引用方式(方法論 6.7)

---

## 8. 附錄 B:方法論 6.10 失敗訊號內嵌

> **來源**:`damon_methodology.md` Layer 6 章節 6.10(行 3666-3688)。
>
> **內嵌理由**:Patrick 工程端讀到的 damon_methodology.md 可能停在 Layer 5、6.10 為 gap。本檔自給自足、不依賴 sync。

### 6.10 v5.0 必須監控的 4 個失敗訊號

> **設計根據**:A001 親測 Day 3 留下「無力」(反向轉化)= Damon 視角下「教練做錯了」的明確 indicator

```
信號 1:session takeaway tag 累積 negative
   累積 3 場 negative tag = 強制 escalation alert 給 Vivi
   → 不是 prompt 調整可解、是架構重審訊號

信號 2:學員連續 3 場開場「斷掉了」「忘記了」
   → NLP Amnesia 機制失敗訊號
   → 可能需要回退到當天 Future Pacing

信號 3:學員 People Pleasing 持續發生(5.7 引擎觸發 ≥ 5 次)
   → AI 對抗性不足
   → 不是學員問題、是 prompt 對抗性需提升

信號 4:學員 hit hard 上限(40 turn)連續 3 場
   → level 出口判斷可能過嚴
   → 4 重組合需要調整
```

### 引擎 1 對應的失敗訊號

| 失敗訊號 | 引擎 1 對應 trigger |
|---|---|
| 信號 3(PPL ≥ 5 次)| E1c 累積觸發 5 次 → HITL alert |
| (信號 1、2、4 由其他引擎 / dashboard 處理)| 見 forward reference 7.1 |

---

## 文件版本

- v0.1 (2026-05-19):初版、設計師對話版、待 Patrick ship 版草稿
