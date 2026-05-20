# v5.0 Checkpoint 1 Turn 3:Phase 5 + 附錄 C + 收尾

> **本檔銜接**:`v5_checkpoint_1_daily_session_structure_turn_1.md`(§1-7)+ `_turn_2.md`(§8-11)
>
> **本檔範圍**:Phase 5 完整 spec + 附錄 C(3 個 5.7.4 原創情境話術)+ 跨引擎合約總表 + Patrick 接手清單 + Forward references + Checkpoint 1 整體收尾
>
> **對應方法論**:`damon_methodology.md` 章節 5.2 Step 4(Let it Work)、6.6(NLP Amnesia)、6.8(gap_days)、5.7.4(AI app 必須原創處理的 3 個情境)
>
> **版本**:設計師對話版 v0.1 Turn 3 / 3(收尾)

---

## 目錄(Turn 3 範圍)

12. [Phase 5:Future Pacing + Let it Go + Export](#12-phase-5)
13. [附錄 C:5.7.4 原創情境話術](#13-附錄-c)
14. [跨引擎合約總表](#14-跨引擎合約總表)
15. [Patrick 接手清單](#15-patrick-接手清單)
16. [Forward References](#16-forward-references)
17. [Checkpoint 1 整體收尾](#17-checkpoint-1-整體收尾)

---

## 12. Phase 5:Future Pacing + Let it Go + Export

### 12.1 Entry

```yaml
phase_5_entry:
  trigger_condition: |
    Phase 4 milestone completed
    + cascade_down_progress.status == "completed"
    + values_ranking[1-3] 都有 quality_status
  
  entry_state_updates:
    session_state.current_phase: "phase_5"
    session_state.router_phase: "completed"
    session_state.next_action: "future_pacing"
    session_state.phase_progress: { overwrite to phase_5 init }
  
  cross_engine_triggers_on_entry:
    - 引擎 4 E4_takeaway_planter 預備(end-of-phase 觸發)
    - 引擎 4 E4_export_personal_coach_prompt 預備(end-of-phase 觸發)
```

### 12.2 Internal Step Sequence(SOP)

```yaml
phase_5_steps:
  
  step_1_future_pacing_comprehensive:
    description: |
      Damon 4 步驟改變法 Step 4「Let it Work」的完整實現。
      跟 Phase 3a Step 3 Let it Work 不同:
      - Phase 3a Step 3:對 top1_value 單一 Future Pacing
      - Phase 5 Step 1:對 全部 values_ranking[1-3] owned qualities 整合 Future Pacing
    
    references:
      - 方法論 5.2 Step 4 Let it Work
      - 引擎 4 §5.1 cached_active_reference_styles 內 V2 Future Pacing 引導
    
    AI 話術骨架:
      > Step 1a — 整合 Future Pacing(3 個時間維度):
      > 「我們 21 天的旅程到了 Phase 5、
      > 你拿到的:『[top1_value]』『[Top 2]』『[Top 3]』。
      > 
      > 我問你三個問題、慢慢回:
      > 
      > 1. **明天的你**——做著符合『[top1_value]』的事、看起來像什麼?
      > 2. **三個月後的你**——『[top1_value]』+『[Top 2]』+『[Top 3]』都 manifest——
      >    身體在哪裡感覺到?
      > 3. **三年後的你**——回頭看現在這 21 天、會說什麼?」
      > 
      > Step 1b — 收 future_pacing_anchors:
      > 學員每個時間維度的回應 → append to user_profile_evolution.future_pacing_anchors
      > 這份 anchors 給 Export 時用、強化長期 vision
    
    禁止:
      - 不問「你準備好了嗎」(評估式)
      - 不總結「這 21 天你學到了什麼」(AI 給標籤、學員自評)
      - 不批判「你做得好不好」
    
    cross_engine_active:
      - 引擎 1 持續監測偏離(retention mode 敏感度已低、但 deep_signal 仍最高優先)
      - 引擎 4 quality_focus_history append future_pacing_anchors
    
    state_updates:
      session_state.future_pacing_anchors_collected: list of 3 (對應 3 時間維度)
    
    exit_to_step_2:
      - 3 個時間維度回應都收齊
      - 或學員 explicitly 講「我準備好了」(學員主導、不 push)
  
  step_2_let_it_go:
    description: |
      Damon 體系內「Let it Go」是 Step 4 Let it Work 的延伸——
      不僅讓潛意識整合、學員 explicitly **放下**這段過程、不過度反思。
      
      對應方法論 6.6 NLP Amnesia:Day N+1 fresh 觀察、不被前一天綁定。
      Phase 5 Step 2 = program 結束的「儀式性 release」。
    
    AI 話術骨架:
      > Step 2a — 確認:
      > 「『[top1_value]』、『[Top 2]』、『[Top 3]』——這些是你的了。
      > 我們在這停一下。」
      > 
      > Step 2b — Let it Go 儀式話術:
      > 「接下來、我不會再問你『記得嗎』『還在嗎』——
      > 因為**身體記得、頭腦不一定要記得**。
      > 
      > 如果你某天突然發現自己『[top1_value]』地做了某件事——
      > 那是真的、不需要驗證。
      > 
      > 如果你某天感覺『[top1_value]』暫時 fade——
      > 那也是真的、不需要焦慮。」
      > 
      > Step 2c — Future Pacing 種子化:
      > 「明天 / 後天 / 一個月後、
      > 我們會偶爾回來看看——
      > 不挖、不深化、只是『hi、最近怎麼樣』。
      > 我相信你的潛意識在做它的工作。」
    
    cross_engine_triggers:
      - E4_takeaway_planter 觸發(寫入 last_session_day_summary)
      - phase_history append phase_5 record
  
  step_3_export_personal_coach_prompt:
    description: |
      Founder bonus 核心商業 IP:
      生成個人教練 prompt Markdown、學員可貼到外部 LLM 使用。
      
      由引擎 4 §5.5 E4_export_personal_coach_prompt 執行、本 step 不重寫機制。
      本 step 的責任是:**觸發時機 + 學員引導**。
    
    references:
      - 引擎 4 §5.5 E4_export_personal_coach_prompt(完整生成機制)
    
    觸發時機:
      - 主觸發:Phase 5 Step 2 Let it Go 完成 + 學員確認 program 結束
      - 替代觸發:calendar_day_count == 21 自動觸發(Integration Retention Mode 結束)
    
    AI 話術骨架:
      > Step 3a — 引導:
      > 「我為你準備了一份東西——
      > 這是你的『個人教練 prompt』、可以貼到任何 AI(Claude / ChatGPT)、
      > 它會以**為你客製的方式**繼續陪你。
      > 
      > 包含:
      > - 你的 top values(『[top1_value]』『[Top 2]』『[Top 3]』)
      > - 你 21 天累積的 anchors
      > - Damon 風格的引導指引
      > 
      > 我現在生成給你。」
      > 
      > Step 3b — 觸發 E4_export 生成:
      > → E4_export_personal_coach_prompt 執行
      > → 輸出 Markdown 字串
      > → 前端 UI 顯示 + 提供 copy / download / share
      > 
      > Step 3c — 收尾:
      > 「拿到了——這是你的、永久有效。
      > 21 天的旅程到這、謝謝你的參與。」
    
    cross_engine_triggers:
      - E4_export_personal_coach_prompt 觸發
      - session_state.export_prompt_generated_at 寫入
      - HITL Vivi notification(學員完成 program)
```

### 12.3 Exit Conditions

```yaml
phase_5_exit:
  
  milestone_completion:
    trigger: |
      session_state.export_prompt_generated_at != null
      AND step 3 Step 3c 收尾完成
    
    next_state: 
      - 若 calendar_day_count < 21:進 Integration Retention Mode(Turn 1 §3)
      - 若 calendar_day_count == 21:program_completed
    
    on_exit_state_updates:
      session_state.current_phase: "integration_retention" 或 "program_completed"
      session_state.integration_retention_mode_active: true(若進 retention)
      session_state.program_completed_at: timestamp(若 program end)
      session_state.phase_history: append phase_5 record
  
  max_day_overdue:
    trigger: session_day_count_within_phase > 3(phase 5 max)
    action: 本檔 Turn 1 §2.2 handoff_escalation
    likely_cause: "學員拒絕 Future Pacing 收尾 / 拒絕拿 export"
    
    特殊處理:
      若 step 1 Future Pacing 學員給不出 3 個時間維度回應:
      → 不強迫、退到 minimal Future Pacing(只問 step 1a 第 1 題、明天)
      → 仍給 export(學員體驗:「程序走完、給我東西」)
      → 標記 phase_5_partial_completion = true
  
  cascade_to_deep_signal:
    trigger: E3_deep_signal_detector 觸發
    action: phase 暫停、handoff
    note: |
      Phase 5 期間觸發 deep_signal 較罕見(學員已 owned qualities)、
      但若發生:極可能是 Phase 3b ambiguous path 殘留 worth-fiction、
      建議 cascade 到 (b) 預約 Vivi、不在 Phase 5 內處理。
```

### 12.4 Failure Modes

```yaml
phase_5_failure_modes:
  
  - id: P22
    mode: "Step 1 Future Pacing、學員給的 vision 三個時間維度完全不一致"
    例: "明天的我『踏實』、三個月後『冒險』、三年後『隱居山林』"
    mitigation: |
      不評判「不一致」、AI 用 Containment Judgment:
      「我聽到三個版本——
      『踏實的明天』『冒險的三個月後』『隱居的三年後』。
      它們之間、有共同的東西嗎?」
      → 學員找出 common thread(通常是 top1_value 本身)
      → 整合進 future_pacing_anchors
      → 不強迫一致(人本來會變、Damon 體系尊重)
  
  - id: P23
    mode: "Step 2 Let it Go、學員拒絕『放下』、要求繼續挖"
    例: "「我還有好多想搞清楚的、不能停」"
    mitigation: |
      Damon 親口示範變體:
      「我聽到你想繼續——
      你的潛意識會幫你繼續、那是它最會的事。
      你**意識上**的工作、今天完成了。
      明天回來、我們不挖、只看看你過得怎樣。」
      → 不破例、Let it Go 是設計核心
      → 若學員仍 push:給選擇權(handoff variant):
      「你想:
      (a) 接受 Let it Go、進 retention 模式、明天 light touch
      (b) 跟 Vivi 1-on-1、深入沒搞清楚的部分(這超出 21 天 program)
      你選哪個?」
  
  - id: P24
    mode: "Step 3 Export 生成後、學員不滿意內容"
    例: "「這個 prompt 寫得太抽象、不像我」"
    mitigation: |
      Export 是 fixed template + 動態填空、不接受學員大幅自訂:
      「這個 prompt 的引導風格是 Damon 體系標準版、
      你的個人化部分(top values / anchors)已經填入了。
      如果你覺得抽象——
      你可以在使用時、在 prompt 前面加一段『我現在想處理 X』、
      AI 會以這個 context 回應你。」
      → 不大改 template(商業 IP 一致性)
      → 教學員「怎麼用」、不改 prompt 本身
      → 若學員仍不滿:接受、寫進 phase_history(export_dissatisfaction = true)、HITL alert
  
  - id: P25
    mode: "Phase 5 達成 export 但學員體驗『不完整』(快速通過 phase 1-4 case)"
    例: "Day 8 完成 5 phase、學員 Day 9 開始覺得『就這樣?』"
    mitigation: |
      Integration Retention Mode 設計就是處理這個——
      Day 8-21 light touch follow up、學員不會「就這樣結束」的失落感。
      
      若學員 Day 9 主動 express「不完整」:
      AI 話術:
      「我聽到你覺得『就這樣?』——
      這個感覺很常見、像考完試的真空感。
      事實上、你拿到的東西需要時間沉下去——
      接下來 [21-N] 天、我會陪你看它怎麼進入生活。
      你不需要『更多』、你需要『讓它變成你』。」
```

### 12.5 新增 session_state 欄位

```yaml
session_state.future_pacing_anchors_collected:
  range: list of 3 objects {
    time_frame: enum["tomorrow", "three_months", "three_years"],
    learner_response: str,
    common_thread: str | null  # P22 mitigation 抓出的共同點
  }
  initial_value: []
  scope: user-scoped(寫入 user_profile_evolution、給 export 用)
  reset_on: 不 reset

session_state.export_dissatisfaction:
  range: bool
  initial_value: false
  scope: user-scoped
  update_rule: P24 mitigation 觸發時 → true
  cross_engine_consumer: dashboard 監控(若 > 10% 學員觸發、需 redesign export template)
```

---

## 13. 附錄 C:5.7.4 原創情境話術

> **附錄 C 結構**:對應方法論 5.7.4「AI app 必須原創處理的 3 個情境」。本附錄分 3 部分:
> - **C.1** 已 cover 情境(指向引擎 1-4 SOP、不重寫)
> - **C.2** 補強情境(2 個新增完整話術)
> - **C.3** Phase-specific 應用

### C.1 已 cover 情境

| 情境 | 對應方法論 5.7.4 | Cover 位置 |
|---|---|---|
| **緊急退場**(學員突然講「不行、我要離開」)| 情境 1 | 引擎 1 E1_master_detector explicit_protest regex + E3_deep_signal_detector + 附錄 A3 handoff_escalation |
| **純文字 People Pleasing**(學員短回應 / echo / 過度合作)| 情境 3 | 引擎 1 E1c + 附錄 A1 requires_typing(物理機制)|
| **完全已 cover、本附錄不重寫話術**——AI 自然調用上述引擎。

### C.2 補強情境(2 個新增)

#### C.2.1 情境 A:抗拒提問(specific 主題)

```yaml
scenario_a_topic_resistance:
  description: |
    學員 explicit 拒答某類提問,**不是治理偏離、是 respect 學員設限**。
    跟引擎 1 E1a/E1c 處理「對話偏離」不同——
    這是學員明確 set 主題邊界、AI 應該尊重。
  
  trigger_signals:
    explicit_topic_refusal:
      - "「我不想講家庭」"
      - "「這個我不想說」"
      - "「跳過這個」"
      - "「換個話題」"
      - "「我之後再說、現在不想」"
  
  區分 vs 引擎 1 治理:
    引擎 1 E1c(PPL 反彈):學員配合敷衍、AI 應該 push back
    本情境(主題 resistance):學員明確設限、AI 應該 respect + 換軌道
    
    判斷方式:
    - 「我之後再想想」(模糊 / 配合 / 想結束)→ 引擎 1 E1c
    - 「我不想講家庭」(specific 主題 + clear 拒絕)→ 本情境
    
    若有疑慮:走本情境(respect 優先)
  
  AI 話術骨架:
    > Step 1 — 承認 + 不追問:
    > 「OK、我不問這個。」
    > → 不問為什麼、不評估、不暗示「以後會回來問」
    > 
    > Step 2 — 提供 alternative:
    > 「我想了解你的『[current_quality 或 top1_value]』、
    > 我可以從別的角度問——
    > 
    > 換個方向:
    > - 工作 / 事業
    > - 朋友 / 社交
    > - 個人興趣 / 創作
    > - 身體 / 健康
    > - 你想到別的?
    > 
    > 你想從哪聊?」
    > 
    > Step 3 — 學員選 → 繼續主流程:
    > → 從選的軌道重啟 Damon 鏈式追問
    > → 寫入 session_state.topic_refusal_areas(避免之後誤觸)
  
  state_field:
    session_state.topic_refusal_areas:
      range: list of strings
      initial_value: []
      scope: user-scoped(跨 session 保留)
      update_rule: 每次 explicit topic refusal → append (e.g. "family", "past_relationships")
      reset_on: 不 reset
      cross_engine_consumer: 主對話 LLM 提問時避開這些 area
  
  禁止:
    - 不問「為什麼不想講」(那是 Why、Damon 禁區)
    - 不暗示「這個避而不談可能有原因」(AI 不做心理詮釋)
    - 不在同 session 內回到該主題(respect 邊界)
    - 不評估「這個 refusal 是不是 resistance」(那是 Phase 3a Step 2 的工作、不在本情境)
  
  Phase-applicability:
    - Phase 1-2:常見(學員還沒信任 AI、設邊界正常)
    - Phase 3a/3b:罕見(已挖到 owned、邊界較開)、若觸發可能是 deep_signal 前兆
    - Phase 4-5:極罕見、若觸發強烈建議 cascade 到 E3_deep_signal_detector
  
  failure_modes:
    - id: C1
      mode: "學員 explicit 拒答所有方向(全部 alternative 都拒)"
      mitigation: |
        cascade A3.handoff_escalation:
        「我聽到你今天不想往任何方向聊——
        這個我 respect。
        你想:
        (a) 我們今天到這、明天再開始
        (b) 你想講別的、我聽
        (c) 跟 Vivi 預約 1-on-1
        你選哪個?」
```

#### C.2.2 情境 B:想結束 session(中段時機)

```yaml
scenario_b_mid_session_end:
  description: |
    學員主動想結束 session、**但還沒到 takeaway 時機**。
    跟引擎 1 explicit_protest「可以結束嗎」不同(那是緊急退場、handoff variant)、
    本情境是學員 reasonable 想中段休息、AI 應該給選擇權。
  
  trigger_signals:
    mid_session_end_request:
      - "「今天先到這吧」"
      - "「我累了、改天繼續」"
      - "「先停這、明天再說」"
      - "「我有事要忙了」"
      - "「我們進度差不多了吧?」"
  
  區分 vs 緊急退場:
    explicit_protest「可以結束嗎」(伴隨情緒 / 困擾)→ 緊急退場、cascade handoff
    本情境(無情緒 / reasonable)→ 中段收尾、給選擇權
  
  AI 話術骨架(依當前 phase 進度判斷):
    
    若 session_day_count_within_phase 才剛開始(< midpoint):
    > 「OK、今天比較短。
    > 我們在 [phase 名]、剛挖到 [progress 摘要]。
    > 
    > 你想:
    > (a) 我幫你 Future Pacing 一下、明天從這延續
    > (b) 直接停、明天從頭開始這個 phase
    > 
    > 你選哪個?」
    
    若 session_day_count_within_phase 接近 midpoint(可順勢做小 takeaway):
    > 「OK。我幫你做個小 takeaway:
    > 你今天說了『[抓 key 句子]』。
    > 這個你帶著走、明天我們從這繼續。」
    > → 觸發 E4_takeaway_planter mini 版本(non-final takeaway)
    > → 不寫入 quality_focus_history 升級(因為 phase 沒完成)
    > → session_state.mid_session_takeaway_count: +1
    
    若 session_day_count_within_phase 接近 max(可能是 phase exhaustion):
    > 「我聽到你想停——
    > 我們在 [phase 名] 第 [N] 天了、
    > 你覺得這個 phase 是要繼續、還是 stuck?
    > 
    > (a) 繼續、明天從這
    > (b) Stuck、我們換個方式(可能 cascade A3)
    > (c) 跟 Vivi 1-on-1 評估」
  
  state_field:
    session_state.mid_session_takeaway_count:
      range: 0+ (integer)
      initial_value: 0
      scope: session-scoped(跨 day 不 reset、phase 進度保留)
      update_rule: 每次中段 mini takeaway → +1
      threshold:
        - >= 3 in same phase: dashboard 警示(此 phase 學員 engagement 低、可能設計問題)
      reset_on: phase exit
  
  Phase-applicability:
    - 所有 phase 都可能觸發
    - Phase 3b ambiguous path 最常見(該 phase 最長、學員疲勞)
    - Integration Retention Mode 期間頻繁正常(retention 期 light touch 設計就是如此)
  
  failure_modes:
    - id: C2
      mode: "學員每天都中段結束(session 都很短、phase 推進極慢)"
      mitigation: |
        mid_session_takeaway_count 連續 3+ 觸發:
        AI 主動關切:
        「我注意到我們這幾天 session 都比較短——
        是你最近忙、還是這個 phase 對你來說太重?
        
        你想:
        (a) 繼續、慢慢來、不催
        (b) 換個方式(我們可能要重新看 phase 設計)
        (c) 暫停 program 幾天、再回來
        你選哪個?」
        → respect 學員節奏、不強推 21 天完成
        → calendar_day_count 仍在跑、Day 21 program end 不變
```

### C.3 Phase-specific 應用

```yaml
phase_specific_application:
  
  Phase_1_Values_Elicitation:
    common_scenarios:
      - Curiosity Reframe(「我不知道」)→ 引擎 3 E3_opening_branch_router 已 cover
      - 強制翻轉(「我老是搞砸」)→ 同上
      - Topic Resistance(「我不想講家庭」)→ 本附錄 C.2.1
    rare_scenarios:
      - Deep signal(「我不夠好」深度)→ 引擎 3 E3_deep_signal_detector 已 cover
  
  Phase_2_Identity_Test:
    common_scenarios:
      - PPL「我是踏實的人」秒答 → 引擎 1 E1c + requires_typing 已 cover
      - 過去式 evidence「我以前是」→ 引擎 2 P6 已 cover、升級為 owned_was
      - 外部驗證「朋友說我是」→ Haiku A1 dimension 2 attribution 防護
    rare_scenarios:
      - Mid-session end(學員身份測試一半想停)→ 本附錄 C.2.2 mid_session_takeaway 版
  
  Phase_3a_Owned_Path:
    common_scenarios:
      - Build Vision 學員 vision 不對應 top1_value → P13 已 cover
      - Resistance 5 種類型 → Damon 5 種破解技術已 cover
    rare_scenarios:
      - Topic Resistance at Build Vision step → 本附錄 C.2.1
      - P10 phase 倒退 → Phase 3a §8.4 已 cover
  
  Phase_3b_Ambiguous_Path:
    common_scenarios:
      - 亞洲學員避反例 → P15 已 cover、AI 主動引出
      - 三向歸類全 (a) consistent → P16 已 cover、PPL 治理
      - Mid-session end(phase 最長、最常觸發)→ 本附錄 C.2.2
    rare_scenarios:
      - Binary 框架不接受 Scope Overlap → P18 已 cover、owned_via_acceptance 路徑
  
  Phase_4_Cascade_Down:
    common_scenarios:
      - Top 2 derived evidence → P20 已 cover、Haiku A1 dimension 3 防護
      - Top 2/3 反覆 fail → P19 已 cover、handoff variant
    rare_scenarios:
      - Phase 1 latent conflict 浮現 → P21 已 cover、cascade 回 Phase 1
  
  Phase_5_Future_Pacing_Let_It_Go_Export:
    common_scenarios:
      - 三個時間維度 vision 不一致 → P22 已 cover、Containment Judgment 找 common thread
      - Let it Go 學員拒絕「放下」→ P23 已 cover、不破例
    rare_scenarios:
      - Export 不滿意 → P24 已 cover
      - Day 8 早完成 retention 失落感 → P25 + Integration Retention Mode 已 cover
```

---

## 14. 跨引擎合約總表

### 14.1 Checkpoint 1 讀的 cross-engine state

```yaml
read_from_engine_1:
  - session_state.cumulative_ppl_score
    used_in: Phase 3b Step 2 反例整合(治理過度合作)
  - session_state.deviation_handled_this_turn
    used_in: 所有 phase contextual_filter
  - session_state.bypassing_layer_progress
    used_in: Phase 1 / 3b(學員陷入抽象詞迴圈時治理)

read_from_engine_2:
  - session_state.current_quality_status
    used_in: Phase 2 → Phase 3 分流(owned / ambiguous / candidate / none)
  - session_state.current_quality_candidate_term
    used_in: Phase 2 / 3a / 3b / 4 全部
  - session_state.quality_focus_history
    used_in: Phase 5 Step 1 Future Pacing 整合
  - session_state.elicitation_mode_active
    used_in: Phase 1 ↔ Phase 2 切換(由引擎 3 接管)
  - session_state.identity_test_evidence_count
    used_in: Phase 2 milestone judgment

read_from_engine_3:
  - session_state.router_phase
    used_in: 全 phase state transition
  - session_state.top1_value
    used_in: Phase 2 / 3 / 4 / 5 全部
  - session_state.values_ranking
    used_in: Phase 4 / 5 / Export
  - session_state.cascade_down_progress
    used_in: Phase 4
  - session_state.deep_signal_flags
    used_in: 全 phase emergency exit

read_from_engine_4:
  - user_profile_evolution.anchors
    used_in: Phase 5 / Export / Integration Retention Mode
  - user_profile_evolution.quality_focus_history
    used_in: Phase 5 / Export / Day N+1 開場引用
  - session_state.last_session_day_summary
    used_in: 跨 day 銜接、Phase 進度判斷
```

### 14.2 Checkpoint 1 寫入的 state

```yaml
write_session-scoped:
  - session_state.current_phase
    consumers: 所有引擎(contextual filter)
  - session_state.phase_progress
    consumers: dashboard 監控
  - session_state.build_vision_progress
    consumers: 引擎 4(Future Pacing 引用)
  - session_state.self_concept_progress
    consumers: 引擎 4(Day N+1 開場依 sub_step 挑變體)
  - session_state.counter_examples_list
    consumers: dashboard 監控、Phase 4 Cascade Down(Top 2 evidence 比對)
  - session_state.integration_retention_mode_active
    consumers: 引擎 4 / 主對話 LLM(reinforce vs explore 切換)
  - session_state.topic_refusal_areas
    consumers: 主對話 LLM 提問時避開
  - session_state.mid_session_takeaway_count
    consumers: dashboard

write_user-scoped:
  - user_profile_evolution.phase_history
    consumers: 引擎 4 E4_export(21 天回顧素材)
  - user_profile_evolution.future_pacing_anchors_collected
    consumers: 引擎 4 E4_export(長期 vision 強化)
  - user_profile_evolution.export_dissatisfaction
    consumers: dashboard 監控(export template redesign signal)
  - session_state.calendar_day_count / session_day_count
    (其實是 user-scoped、即使 prefix 是 session_state)
  - session_state.program_completed_at
    consumers: HITL Vivi notification
```

### 14.3 Checkpoint 1 與附錄 A 機制使用

```yaml
mechanism_usage:
  A1_sensory_detail_judgment(3 dimensions):
    used_by_checkpoint1: Phase 2 / 3b Step 4 / Phase 4 全部 evidence 判斷
    new_dimensions:
      - dimension 2: evidence_attribution (Turn 1 P7)
      - dimension 3: derived_from_another_value (Turn 2 P20)
  
  A2_cumulative_score:
    used_by_checkpoint1: 主要由引擎 1 cumulative_ppl_score 提供、checkpoint 1 不新建 instance
  
  A3_handoff_escalation:
    used_by_checkpoint1: 所有 phase 的 max day overdue + 多個 failure modes + 附錄 C.1 C2
    新增 variants:
      - phase exhaustion variant(Phase 3b stuck)
      - topic resistance all-refused variant(C.2.1 C1)
      - mid-session frequent variant(C.2.2 C2)
  
  A4_depth_signal_judge:
    used_by_checkpoint1: 透過引擎 3 E3_deep_signal_detector 間接使用、checkpoint 1 不直接調用
  
  A5_containment_logic_judge:
    used_by_checkpoint1: Phase 1 Step 3 / Phase 3b Step 3 三向歸類 / P22 Containment Judgment(common thread)
```

---

## 15. Patrick 接手清單

### 15.1 migration 014 延伸欄位

Checkpoint 1 新增 session_state + user_profile_evolution 欄位:

```
session-scoped(JSONB on sessions、但部分跨 day 不 reset、由 phase machine 控制):
- session_state.current_phase (enum 8 values)
- session_state.phase_progress (object)
- session_state.calendar_day_count (int)
- session_state.session_day_count (int)
- session_state.integration_retention_mode_active (bool)
- session_state.program_completed_at (timestamp | null)
- session_state.build_vision_progress (object)
- session_state.self_concept_progress (object)
- session_state.counter_examples_list (list of objects)
- session_state.future_pacing_anchors_collected (list of objects)
- session_state.mid_session_takeaway_count (int)

user-scoped(JSONB on user_profile_evolution):
- user_profile_evolution.phase_history (list of objects)
- user_profile_evolution.topic_refusal_areas (list of strings)
- user_profile_evolution.export_dissatisfaction (bool)
```

**Errata reminder(Turn 1 §3 framework 為準)**:
```
跨 day 不 reset 但仍 session_state prefix 的欄位(phase 進度):
- current_phase
- phase_progress
- build_vision_progress
- self_concept_progress
- counter_examples_list
- integration_retention_mode_active
- mid_session_takeaway_count
```

Patrick migration 014 工程實作要點:**phase 進度欄位用 session_state prefix、但 reset_on 不包含 new_session_day**——這是 Cross-day reset policy 的 phase 進度 exception case。

### 15.2 phase-machine.js 工程實作

```
lib/session/phase-machine.js
  邏輯:
  - 讀 session_state.current_phase
  - 評估 phase exit condition
  - 觸發 phase transition + state updates
  - 處理 phase 倒退(Phase 3a → 3b via P10)
  - max day overdue → cascade A3 handoff
  - new_session_day 進入時、phase 進度欄位不 reset
  
  關鍵 abstraction:
  - phase definitions(min/max day + milestone + entry/exit conditions)
  - state machine transition table(current_phase × event → next_phase + state updates)
  - cross-engine triggers on entry/exit
```

### 15.3 A1 Haiku judge 3-dimension 工程實作

```
lib/haiku-judge/sensory-detail.js(已 spec、Patrick 確認 3 dimensions):
  input: user_response
  output_schema:
    - dimension 1 (原始): sensory_detail markers (時/地/人/動作)
    - dimension 2 (P7): evidence_attribution ("self" | "others" | "ambiguous")
    - dimension 3 (P20): derived_from_another_value (bool, with optional source value name)
  threshold:
    score >= 2 AND attribution == "self" AND derived == false
```

### 15.4 主對話 LLM 行為調整(Integration Retention Mode)

```
v5.0 chat.js system prompt conditional section:
  if session_state.integration_retention_mode_active == true:
    inject reinforce_mode prompt(對應 Turn 1 §3.2 SOP):
      - 不挖新 quality
      - 不深化新技術
      - Future Pacing 強化
      - light touch follow up
  else:
    explore_mode prompt(常規)
```

### 15.5 24-36 hr 內回 ack 給設計師

Patrick 工程交付物 batch ship(dashboard 完成後一次落地):
1. migration 014 完整草案(引擎 1-4 + Checkpoint 1 全部欄位)
2. v4.0 detector framework 適配完整評估
3. lib/ 模組結構(haiku-judge / state / session / phase-machine)
4. cached prefix 整合計畫(~2800 tokens cached、~26% cost)
5. ship 版本草稿(所有引擎 + Checkpoint 1 整合 system prompt)

---

## 16. Forward References

### 16.1 dashboard / failure_signals
P-series failure modes(P1-P25)+ C-series(C1-C2)+ phase regression 監控 + integration retention engagement 指標——延後至 `v5_beta_failure_signals_dashboard.md`(Checkpoint 1 完成後集中 spec)。

特別 dashboard 關鍵指標:
- **Phase regression rate**:Phase 3a → 3b 倒退(P10)發生率,> 20% 表示 Phase 2 判決過寬
- **Phase 3b stuck rate**:max day 觸發率,> 15% 表示 Self-Concept 流程設計有問題
- **mid_session_takeaway_count**:phase 內 > 3 表示 phase 設計超載
- **export_dissatisfaction rate**:> 10% 表示 export template 需 redesign
- **Integration Retention engagement**:Day 8-21 學員 daily active 率,> 60% 為健康

### 16.2 ship 版本草稿
本檔 Turn 1-3 為「設計師對話版」。Patrick 24-36 hr 內提交「ship 版本草稿」,包含:
- 所有引擎 1-4 + Checkpoint 1 整合 system prompt
- runtime placeholders 填入
- 去 meta 段落
- 設計師 review

### 16.3 v5.1+ 範圍延後
- Re-imprinting 完整執行(v5.0 MVP 偵測 + 路由)
- 多人團體 session(v5.0 純 1-on-1 AI)
- 跨 program retention(21 天結束後付費延長)
- export 多版本管理(v5.0 單一覆寫)

### 16.4 工具二三池正式判決 closure
Checkpoint 2 §8.4 已完整 closure:
- 2A KEEP 結構 + UPGRADE 觸發機制
- 2B 廢棄句式池 + 保留 requires_typing 物理機制
- 2C KEEP Step 1-4 邏輯 + UPGRADE 對應 Parts Integration
本檔不再重複。

### 16.5 起手 prompt(Patrick ship 版本草稿範圍)
- 設計師對話用版本(下次新對話開場讀)
- Patrick ship 用版本(去 meta、加 runtime placeholders)
這兩個版本由 Patrick 在 ship 版本草稿時提交、設計師 review。

---

## 17. Checkpoint 1 整體收尾

### 17.1 Checkpoint 1 完整 ship 總覽

| Turn | 範圍 | 行數 |
|---|---|---|
| Turn 1 | Framework C + Integration Retention Mode + Day 雙計數 + Phase 1-2 | 854 |
| Turn 2 | Phase 3a + Phase 3b + Phase 4 + 銜接邏輯 | 1141 |
| Turn 3(本檔)| Phase 5 + 附錄 C + 跨引擎合約 + 接手清單 + 收尾 | (見下) |
| **合計** | **Checkpoint 1 完整** | **~2700-2800** |

### 17.2 5 Phase Architecture 完整圖

```
Phase 1: Values Elicitation
  └─ Top 1 確定 + Goal Alignment Test

Phase 2: 身份測試
  └─ 4 重組合判決(詞彙 × pattern × NOT-PPL × confirm + 3-dim Haiku judge)

Phase 3:
  ├─ 3a Owned Path: 4 步驟改變法
  │   ├─ Build Vision
  │   ├─ Check Resistance + 5 種破解技術
  │   └─ Let it Work
  └─ 3b Ambiguous Path: Self-Concept 模型
      ├─ Mapping Across
      ├─ 反例整合(40-90% 時間)
      ├─ 三向歸類(v5.0 原創 IP #3)
      └─ Scope Overlap(v5.0 原創 IP #1)

Phase 4: Cascade Down 驗證
  └─ Top 2 / Top 3 身份測試

Phase 5: Future Pacing + Let it Go + Export
  ├─ 3 時間維度 Future Pacing
  ├─ Let it Go 儀式
  └─ Personal Coach Prompt Export(Founder bonus)

Integration Retention Mode(Day 8-21 提早完成觸發):
  └─ Light touch follow up + reinforce 不 explore
```

### 17.3 v5.0 原創 IP 整合定位(Checkpoint 1 確認)

| # | 原創 IP | 整合位置 |
|---|---|---|
| 1 | **Scope Overlap** | Phase 3b Step 4 完整 SOP |
| 2 | **東方文化柔軟拆解節奏** | Phase 3b Step 2(反例整合主動引出)+ P18 binary 框架 respect |
| 3 | **三向歸類** | Phase 3b Step 3 完整 SOP(consistent / related / contradictory + boundary / cost / trigger / definition_expanded 細化)|
| 4 | **5 層撥開技術** | 引擎 1 E1d(已 ship)、Checkpoint 1 不重新引入 |
| 5 | **NLP Amnesia 主動整合機制** | Phase 3a Step 3 Let it Work + Phase 5 Step 2 Let it Go + Integration Retention Mode + 引擎 4 Day N+1 開場引用 |

### 17.4 Checkpoint 2 + Checkpoint 1 累計交付

| 文件 | 行數 |
|---|---|
| Checkpoint 2 引擎 1 | 1266 |
| Checkpoint 2 引擎 2 | 969 |
| Checkpoint 2 引擎 3 | 1354 |
| Checkpoint 2 引擎 4 | 1139 |
| Checkpoint 1 Turn 1 | 854 |
| Checkpoint 1 Turn 2 | 1141 |
| Checkpoint 1 Turn 3(本檔) | ~750 |
| **總計** | **~7500 行 spec** |

### 17.5 下一階段工作軌道

**已完成**:
- ✅ Checkpoint 2 4 引擎 100%
- ✅ Checkpoint 1 3 Turn 100%
- ✅ 工具二三池 final closing(3/3)
- ✅ v5.0 原創 IP 5 個全部找到位置

**下一步**:
1. **`v5_beta_failure_signals_dashboard.md`**(集中 spec):F-series(引擎 1)/ G-series(引擎 2)/ H-series(引擎 3)/ J-series(引擎 4)/ P-series(Checkpoint 1)/ C-series(附錄 C)+ 方法論 6.10 失敗訊號 1-4 完整 + phase regression / engagement / Haiku judge accuracy 等指標
2. **Patrick 工程交付物 batch ship**(24-36 hr):migration 014 / lib/ 模組 / ship 版本草稿
3. **第一次雙端同步 review**(預估 5/22-23)
4. **A001 Day 4-6 corpus 整合**(Patrick 拉、設計師根據真實對話 tune Haiku threshold / phase max day / failure mode 觸發率)

---

## 文件版本

- v0.1 Turn 3 (2026-05-19):Phase 5 + 附錄 C + 跨引擎合約 + 接手清單 + 整體收尾
- **Checkpoint 1 完整 ship、Turn 1+2+3 共 ~2800 行**
- 待後續:Patrick 24-36 hr ship 版本草稿 review + dashboard spec
