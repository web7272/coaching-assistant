# v5.0 Checkpoint 1 Turn 2:Phase 3a / 3b / 4

> **本檔銜接**:`v5_checkpoint_1_daily_session_structure_turn_1.md`(Turn 1 / 3)
>
> **本檔範圍**:Phase 3a(owned path)+ Phase 3b(ambiguous path)+ Phase 4(Cascade Down)+ 3a/3b 銜接邏輯
>
> **對應方法論**:`damon_methodology.md` 章節 5.2(4 步驟改變法)、5.4(Self-Concept 模型)、4.3-4.6(Parts Integration / Resistance)、5.5(Scope Overlap、v5.0 原創 IP #1)、6.3(三向歸類、v5.0 原創 IP #3)、5.7.6(東方文化柔軟拆解、v5.0 原創 IP #2)
>
> **版本**:設計師對話版 v0.1 Turn 2 / 3

---

## ⚠️ Turn 2 寫法 Warning

本檔遵循 Turn 1 確立的「**選項 A 流程導向**」:
- 每 phase / step 必須 spec:entry_condition / exit_condition / state_updates / cross_engine_triggers
- 話術部分**指向引擎 1-4 + 附錄 C**(Turn 3 spec)、不重寫
- Phase 3b 最複雜——必須 spec 4 個子 step:Mapping Across / 反例整合 / 三向歸類 / Scope Overlap

---

## 目錄(Turn 2 範圍)

8. [Phase 3a:Owned Path(4 步驟改變法)](#8-phase-3a)
9. [Phase 3b:Ambiguous Path(Self-Concept 模型)](#9-phase-3b)
10. [Phase 3a ↔ 3b 銜接邏輯](#10-phase-3a--3b-銜接邏輯)
11. [Phase 4:Cascade Down 驗證](#11-phase-4)

---

## 8. Phase 3a:Owned Path(4 步驟改變法)

### 8.1 Entry

```yaml
phase_3a_entry:
  trigger_condition: |
    Phase 2 milestone completed
    + current_quality_status == "owned"
    + top1_value 對應的 quality 通過 4 重組合判決
  
  alternative_entry: |
    Phase 3b 完成 + Top 1 升級 owned
    → 跳「Phase 3a simplified」(快速版、見 §10 銜接邏輯)
  
  entry_state_updates:
    session_state.current_phase: "phase_3a"
    session_state.router_phase: "build_vision_active"
    session_state.next_action: "build_vision"
    session_state.phase_progress: { overwrite to phase_3a init }
    session_state.build_vision_progress: {  # 新欄位、見 §8.6
      step: "step_1_build_vision",
      vision_components: [],
      resistance_detected: false
    }
  
  cross_engine_triggers_on_entry:
    - 主對話 LLM 切換到 Build Vision 模式(reinforce mode)
    - 引擎 1 持續監測偏離(但 elicitation_mode_active 已 false、敏感度降低)
    - 引擎 4 E4_takeaway_planter 預備觸發(end of Phase 3a)
```

### 8.2 Internal Step Sequence(SOP)

```yaml
phase_3a_steps:
  
  step_1_build_vision:
    description: |
      Damon 4 步驟改變法 Step 2:Build Vision
      建構 dissociated image(看見一個「擁有 top1_value 的自己」)
      不是 associated experience(避免過早身體沉浸)、
      先 dissociated(distance、可觀察)、再 associated(進入身體)。
    
    references:
      - 方法論 5.2 Step 2 Build Vision 完整 SOP
      - 引擎 3 §4.5 E3_status_router(owned 過渡話術已 ship)
    
    AI 話術骨架:
      > Step 1a — 起手(由引擎 3 過渡話術接續):
      > 「『[top1_value]』——這是你的。
      > 接下來、想像你面前有一個空白的畫布、
      > 把『[top1_value]』放進去:它看起來像什麼?」
      > 
      > Step 1b — 細化(dissociated image):
      > 「你看著畫面裡那個『[top1_value]』的你——
      > 他在哪裡?在做什麼?
      > 他臉上的表情?身體姿勢?」
      > 
      > Step 1c — 動態化(associated 過渡):
      > 「現在、走進畫面、變成那個你——
      > 你看到什麼?聽到什麼?身體哪裡感覺到『[top1_value]』?」
    
    禁止:
      - 不問「你想要什麼」(已過 elicitation 階段、Phase 1 處理過)
      - 不挖 evidence(已 owned、不需重新證明)
      - 不解釋 dissociated vs associated 概念(學員不需要知道機制名)
    
    cross_engine_active:
      - 引擎 1 監測「我做不到」/「我不夠好」訊號(E1d bypassing / E3_deep_signal cascade)
      - 引擎 4 quality_focus_history append(每次學員給 vision component)
    
    state_updates_during_step:
      session_state.build_vision_progress.vision_components: append 學員給的 vision detail
    
    exit_to_step_2:
      - vision_components.length >= 3(學員給出至少 3 個具體 vision detail)
      - associated 過渡完成(學員能描述身體感覺)
  
  step_2_check_resistance:
    description: |
      Damon 4 步驟改變法 Step 3:Check Resistance
      問:「**這個 vision 跟你身上某個 part 衝突嗎?**」
      若有 → Parts Integration 4 步處理(臨時叫、不離開 owned path)
      若沒有 → 跳 step 3 Let it Work
    
    references:
      - 方法論 5.2 Step 3 完整 SOP
      - 方法論 4.3-4.6 Parts Integration 5 種 resistance + 5 種破解技術
      - 引擎 3 cached_4_7_router_reference 內【Parts Integration 切換條件】
    
    AI 話術骨架:
      > Step 2a — 問 resistance:
      > 「現在你看著這個『[top1_value]』的你——
      > 身體裡有沒有任何地方、覺得『**等等、我不確定**』?」
      > 
      > Step 2b — 識別 resistance 類型(根據學員回應):
      >  
      > 若學員講「萬一失敗」/「之前試過都失敗」:
      >   → 害怕失敗 → Spectrum Reframe 破解
      >   話術:「如果你餘生都朝這個方向前進、每靠近一步都更『[top1_value]』、
      >        你會對此感到平靜嗎?」
      > 
      > 若學員講「我成功會變得不像我」/「成功讓我傲慢」:
      >   → 害怕成功代價 → Compatibility Check
      >   話術:「『[top1_value]』跟『[害怕變成的特質]』可以一起運作嗎?
      >        是不是越『[top1_value]』、越能避開『[害怕變成的特質]』?」
      > 
      > 若學員講「我成功家人會不開心」/「朋友會覺得我變了」:
      >   → 生態破壞 → Accepting Cost in Advance
      >   話術:「這些代價真實存在。你**有意識地**選擇承擔嗎?」
      > 
      > 若學員講「我不知道會發生什麼」/「我不敢」:
      >   → 害怕未知 → As-If Frame
      >   話術:「我們做個實驗、試試看『[top1_value]』的版本、
      >        如果不行、我們再回來。」
      > 
      > 若學員講「我就是不配」/「我不夠好」:
      >   → 創傷印記 / worth fiction
      >   → cascade 到引擎 3 E3_deep_signal_detector(最高優先級)
      >   → 不在本 step 處理、handoff_escalation
    
    cross_engine_active:
      - 引擎 3 E3_deep_signal_detector 持續監測(Re-imprinting 訊號最高優先)
      - 引擎 1 E1d bypassing 治理(若學員用大詞迴避)
    
    state_updates_during_step:
      session_state.build_vision_progress.resistance_detected: true | false
      session_state.build_vision_progress.resistance_type: enum (5 種)
    
    exit_to_step_3:
      - 無 resistance(學員確認 no part 反對)
      - 或 resistance 透過 4 個 break 技術之一處理完(Spectrum / Compatibility / Accepting / As-If)
      - 學員回 step 1 補強 vision(若 resistance 處理改變 vision)
  
  step_3_let_it_work:
    description: |
      Damon 4 步驟改變法 Step 4:Let it Work
      **不 over-process**——種下、不挖、信任潛意識整合。
      對應 NLP Amnesia 主動整合機制(v5.0 原創 IP #5)。
    
    references:
      - 方法論 5.2 Step 4 完整 SOP
      - 引擎 4 §5.1 cached_active_reference_styles 內 NLP Amnesia 主動整合機制
      - 引擎 4 §5.3 E4_takeaway_planter
    
    AI 話術骨架:
      > Step 3a — Future Pacing:
      > 「想像三個月後的你、做著符合『[top1_value]』的事——
      > 你看到什麼?身體在哪裡感覺到?」
      > 
      > Step 3b — takeaway 種下(由 E4_takeaway_planter 接手):
      > 「『[top1_value]』現在是你的。
      > 我們先停在這、不再挖。
      > 明天我們從這裡繼續。」
    
    禁止:
      - 不繼續挖(Damon「不 over-process」鐵律)
      - 不深入解釋(給潛意識夜裡整合空間)
      - 不派作業(v5.0 MVP 範圍)
      - 不評估「整合得好不好」(學員自評、AI 不下結論)
    
    cross_engine_triggers:
      - E4_takeaway_planter 觸發(寫入 last_session_day_summary)
      - 跨 day session_state transient 全 reset(本檔 Turn 1 §3)
    
    exit_to_phase_4:
      - Step 3b takeaway 種下完成
      - quality_focus_history append top1_value 為 owned anchor
      - phase_3a 完整完成
```

### 8.3 Exit Conditions

```yaml
phase_3a_exit:
  
  milestone_completion:
    trigger: |
      build_vision_progress.step == "step_3_let_it_work"
      AND takeaway_seeded_this_session == true
    
    next_phase: phase_4 (Cascade Down)
    
    on_exit_state_updates:
      session_state.current_phase: "phase_4"
      session_state.router_phase: "cascade_down"
      session_state.next_action: null  # 等 Cascade Down 內部驅動
      user_profile_evolution.quality_focus_history: append (top1_value upgrade to owned)
      session_state.phase_history: append phase_3a record
  
  max_day_overdue:
    trigger: session_day_count_within_phase > 4(phase 3a max)
    action: 本檔 Turn 1 §2.2 handoff_escalation
    likely_cause: "Build Vision step 1 vision 細化困難、或 step 2 resistance 處理不完"
  
  cascade_to_deep_signal:
    trigger: E3_deep_signal_detector 觸發(worth fiction 訊號最高優先)
    action: phase 暫停、handoff_escalation、學員選擇 (a)/(b)/(c)
    post_handoff:
      - 選 (a) 不繼續挖:phase 3a 暫停、進 takeaway 收尾、跨 day 重新評估
      - 選 (b) 預約 Vivi:program pause、HITL 介入
      - 選 (c) 跳到下一階段:強制進 Cascade Down(不完整、標記 partial completion)
  
  resistance_unsolvable:
    trigger: |
      step 2 resistance 5 種破解技術都無效
      OR 學員一直在 5 種 resistance 之間切換、無收斂
    action: cascade A3.handoff_escalation 變體 E:
      「『[top1_value]』的 vision 一直有 part 反對。
       我們有幾個選擇:
       (a) 我們暫停 vision、先回 takeaway、明天再試
       (b) 跟 Vivi 1-on-1 處理這個 resistance
       (c) 我們不強求 owned、走 ambiguous path 給這個 vision 更多時間
       你選哪個?」
```

### 8.4 Failure Modes

```yaml
phase_3a_failure_modes:
  
  - id: P10
    mode: "Build Vision dissociated → associated 過渡失敗(學員卡在 dissociated、無法 enter)"
    例: "「我看得到那個畫面、但我不覺得那是我」"
    mitigation: |
      Damon 體系內處理:
      不強迫 associated、改用 Scope Overlap(v5.0 原創 IP #1):
      「OK、那個畫面裡的他不是『現在的你』——
      但他跟你有 overlap 的地方嗎?
      哪個部分是你?」
      → 觸發 Phase 3b Scope Overlap 子流程(本檔 §9.5)、不離開 Phase 3a
      → 完成後返回 step 2 check resistance
  
  - id: P11
    mode: "Resistance 識別 5 種類型都不像、學員講出奇怪 resistance"
    例: "「我覺得我會被外星人盯上」(極端 case)"
    mitigation: |
      不歸 5 種、cascade A3.handoff_escalation:
      「我聽到了。這個 resistance 我沒看過、
      我想跟你確認:
      (a) 跟 Vivi 聊聊這個
      (b) 我們先放著、回到 vision 主體
      你選哪個?」
  
  - id: P12
    mode: "Step 3 Let it Work、學員 push 繼續挖『我還沒準備好結束』"
    mitigation: |
      Damon 親口示範:「我聽到了。明天從這裡繼續。今天到這。」
      重複 1 次、若學員仍 push:
      cascade A3 變體:「我聽到你想繼續、但我們設計上不過度挖、
                    給你潛意識空間。明天我們有完整時間、不會丟失。」
      不破例(NLP Amnesia 機制核心保護)。
  
  - id: P13
    mode: "Build Vision 學員給的 vision 跟 top1_value 不對應"
    例: "top1_value = 「踏實」、學員 vision 卻全是「冒險 / 自由」"
    mitigation: |
      AI 不評判「對不對」、用 Containment Judgment:
      「我聽到你 vision 裡有『冒險』『自由』——
      『冒險』『自由』跟『踏實』、它們互相包含嗎?
      還是『冒險』『自由』是『踏實』的另一面?」
      → 若學員確認 overlap → 繼續 vision(這是合法的 Scope Overlap)
      → 若學員確認 disconnect → top1_value 可能有誤、cascade 回 Phase 1 step 3
```

### 8.5 Phase 3a Simplified(若從 Phase 3b 跳入)

```yaml
phase_3a_simplified:
  trigger_condition: |
    Phase 3b 完成 + top1_value 從 ambiguous 升級 owned
  
  rationale: |
    Phase 3b 已經完整跑過 Self-Concept 模型(Mapping Across + 反例 + 三向歸類 + Scope Overlap)、
    學員對 top1_value 的內部認領已很深、不需要 full 4 步驟改變法。
    
    Phase 3a Simplified 只跑:
    - Step 1 Build Vision(min step、快速 dissociated → associated)
    - Step 3 Let it Work(直接 Future Pacing + takeaway)
    
    跳過 Step 2 Check Resistance:
    - Phase 3b 內已多次處理 resistance(反例整合、三向歸類本質都是 resistance 處理)
    - 此時再做 Check Resistance 會 over-process、違反 Damon 原則
  
  day_range:
    min: 1
    max: 2
  
  exit_conditions: 同 §8.3、但 simplified 完成更快
```

### 8.6 新增 session_state 欄位

```yaml
session_state.build_vision_progress:
  range: object {
    step: "step_1_build_vision" | "step_2_check_resistance" | "step_3_let_it_work",
    vision_components: list of strings,
    resistance_detected: bool,
    resistance_type: enum (5 種 resistance) | null,
    resistance_resolved: bool
  }
  initial_value: null
  scope: session-scoped(但跨 day 不 reset、phase 進度保留)
  update_rule: |
    Phase 3a entry 寫入初始值、step 內推進更新、phase exit reset
  reset_on:
    - phase_3a exit
    - new_phase entry
```

---

## 9. Phase 3b:Ambiguous Path(Self-Concept 模型)

### 9.1 Entry

```yaml
phase_3b_entry:
  trigger_condition: |
    Phase 2 milestone completed
    + current_quality_status == "ambiguous"
    + top1_value 對應的 quality 通過 4 重組合判決但 confirm 未完全(身份測試「有時是」)
  
  entry_state_updates:
    session_state.current_phase: "phase_3b"
    session_state.router_phase: "self_concept_active"
    session_state.next_action: "self_concept_model"
    session_state.self_concept_progress: {  # 新欄位、見 §9.8
      sub_step: "mapping_across",
      findings_template_filled: false,
      counter_examples_count: 0,
      triangulation_completed: false,
      scope_overlap_applied: false
    }
  
  cross_engine_triggers_on_entry:
    - 主對話 LLM 切換到 Self-Concept Model 模式
    - 引擎 1 持續監測偏離(E1d bypassing 治理在本 phase 高頻觸發)
    - 引擎 3 cached_4_7_router_reference 內【Parts Integration 切換條件】預備觸發(若 resistance)
```

### 9.2 Internal Step Sequence(SOP)

Phase 3b 是 v5.0 最複雜的 phase、4 個子 step 順序執行,**反例整合在 Mapping Across 之中**(非獨立 step):

```
Step 1: Mapping Across(找 reference quality + submodality 提取)
  ↓
Step 2: 反例整合(Mapping Across 的 40-90% 時間)
  ↓
Step 3: 三向歸類(v5.0 原創 IP #3、反例處理決策樹)
  ↓
Step 4: Scope Overlap(v5.0 原創 IP #1、純文字 / 亞洲適配替代)
  ↓
回 Phase 4(Cascade Down)或 Phase 3a simplified
```

---

### 9.3 Step 1:Mapping Across(找 reference quality)

```yaml
step_1_mapping_across:
  description: |
    Damon Self-Concept 模型核心動作:
    從學員已 owned 的另一個 quality 出發(reference quality)、
    對映到 ambiguous quality(target)、
    把 reference 的 submodality(內部表徵特徵)轉移過來。
  
  references:
    - 方法論 5.4 Mapping Across 完整 SOP
    - 方法論 Damon George / Kyle / Lauren 案例(找 reference quality 範本)
  
  AI 話術骨架:
    > Step 1a — 找 reference quality:
    > 「『[top1_value]』你說『有時是』。
    > 我想問你:**有沒有另一個你 100% 確定『是』的 quality?**
    > 不一定要相關、隨便講一個。」
    > 
    > Step 1b — 確認 reference quality 通過身份測試:
    > 「你是一個『[reference quality]』的人嗎?」
    > → 學員應快速答 Yes + 自然舉 evidence
    > → A1.sensory_detail Haiku judge 評估
    > → 若 < 2 markers:不是真 reference、重 step 1a
    > 
    > Step 1c — Submodality 提取(內部表徵特徵):
    > 「當你想到自己是『[reference quality]』的人——
    > 在身體哪裡感覺到?是什麼感覺?
    > 顏色?溫度?重量?動還是不動?」
    > 
    > 等學員回應 → AI 抓 submodality features(身體位置 / 質感 / 動態)
    > 
    > Step 1d — Mapping(對映到 target):
    > 「現在想想『[top1_value]』——
    > 它在你身體裡、跟『[reference quality]』比、
    > 一樣的地方在哪?不一樣的地方在哪?」
    > 
    > → 抓出差異 = 反例 / 整合材料
  
  cross_engine_active:
    - 引擎 2 對 reference quality 跑 4 重組合(快速確認 owned)
    - 引擎 1 E1d 監測(學員用大詞描述 submodality 時治理)
  
  state_updates_during_step:
    session_state.self_concept_progress.findings_template_filled: 
      - reference_quality: str
      - target_quality: top1_value
      - reference_submodalities: list
      - mapping_differences: list  # 反例材料
  
  exit_to_step_2:
    - findings_template_filled 完整
    - mapping_differences.length >= 1(至少 1 個反例浮現)
  
  failure_handling:
    - 學員找不出 reference quality:
        → 引導往生活角色挖:
        「換個方式:你在生活中、有哪個角色你絕對勝任?
        (爸爸 / 媽媽 / 朋友 / 同事 / 學生)」
        從角色挖到該角色背後的 quality
    - 學員給的 reference quality 經測試也是 ambiguous:
        → 換 reference 試、最多 3 次
        → 3 次都 ambiguous → cascade A3.handoff_escalation
```

---

### 9.4 Step 2:反例整合(40-90% 時間)

```yaml
step_2_counter_example_integration:
  description: |
    Damon Self-Concept 模型核心:
    Mapping Across 過程中、學員會自然冒出「反例」
    (「但我有時候會...」、「可是上次我...」)。
    反例整合是把這些反例**納入** quality、不是「克服」反例。
    Damon 親口示範:佔 Mapping Across 40-90% 時間。
  
  references:
    - 方法論 5.4 反例整合完整 SOP
    - 方法論 Damon「反例不是 bug、是 quality 的 boundary」原則
    - v5.0 原創 IP #2 東方文化柔軟拆解節奏(5.7.6)
  
  AI 話術骨架:
    > Step 2a — 識別反例(來自 step 1 mapping_differences、或學員自發講出):
    > 「你說『[反例 e.g. 上次面試前我緊張到睡不著]』——
    > 我想停在這個反例上。」
    > 
    > Step 2b — 詳細展開反例(不快速跳過):
    > 「告訴我多一點:那個時刻、你具體在做什麼?
    > 身體哪裡感覺到?那時你內心的對話是什麼?」
    > → 強迫具體化、不接受抽象回應(引擎 1 E1b vague 治理)
    > 
    > Step 2c — 重新 framing(用東方文化柔軟拆解 IP #2):
    > 「OK。那個緊張到睡不著的你——
    > 那也是你嗎?還是『另一個你』?
    > 不急著回答、慢慢看。」
    > 
    > Step 2d — 整合判決(進 step 3 三向歸類):
    > 「我們先把這個反例放著、不下定論——
    > 但我想分類一下:
    > 這個反例、你覺得它跟『[top1_value]』是:
    > (a) 一致的(只是『[top1_value]』的另一種樣子)
    > (b) 相關的(是『[top1_value]』的 boundary、不違反它)
    > (c) 矛盾的(根本不是『[top1_value]』、是個錯誤)
    > 你直覺哪個?」
    > 
    > → 三向歸類決策(進 step 3)
  
  cross_engine_active:
    - 引擎 1 E1d bypassing 治理(若學員用大詞迴避反例)
    - 引擎 1 E1c PPL 治理(若學員快速答「都是一致的」逃避反例)
  
  state_updates_during_step:
    session_state.self_concept_progress.counter_examples_count: +1 each
    session_state.counter_examples_list: append {
      example: str,
      detail_level: enum["abstract", "specific"],
      learner_initial_classification: enum["consistent", "related", "contradictory"] | null
    }
  
  exit_to_step_3:
    - 每個反例都進入 step 3 三向歸類處理
    - 反例累積 >= 1 即可進 step 3(不需湊到多)
  
  iteration:
    - step 3 處理完一個反例後、回 step 2a 看是否有新反例
    - 直到無新反例自然浮現 + 學員確認「沒有別的了」
  
  east_asian_adaptation_note: |
    亞洲學員傾向「過度合作 / 不講反例」(怕被覺得 PPL 反例)、
    AI 必須主動引出:
    「我覺得你太順了——
    告訴我一個你**沒做到**『[top1_value]』的具體時刻、
    一定有、想一下。」
```

---

### 9.5 Step 3:三向歸類(v5.0 原創 IP #3)

```yaml
step_3_three_way_triangulation:
  description: |
    v5.0 原創 IP #3:反例處理的決策樹
    不是 binary「是 / 不是」、是三向歸類:
    (a) Consistent — 反例是 quality 的另一種樣子(integration)
    (b) Related — 反例是 quality 的 boundary(coexistence)
    (c) Contradictory — 反例違反 quality(boundary clarification)
    
    每個反例都跑一遍三向歸類、output 決定 quality 的 expanded definition。
  
  references:
    - v5.0 原創 IP #3 完整 spec(待 verify、若方法論未明確列、本檔即 spec source)
    - Damon「反例不是錯誤、是 quality 的 boundary」延伸
  
  AI 話術骨架:
    > 
    > 從 step 2d 學員初步分類(a/b/c)、進入細化:
    > 
    > 路徑 (a) Consistent — 學員初步認為一致:
    > AI 話術:
    > 「你說這個反例是『[top1_value]』的另一面——
    > 那它具體怎麼是?
    > 給我一句話:『這個反例其實是我在 X、X 也是「[top1_value]」』。」
    > → 強迫學員用一句話 reframe、AI 不替學員想
    > → Haiku A5.containment_logic_judge 評估這個 reframe 是否合理
    > → 通過 → 反例 integrated、繼續下個反例
    > → 不通過 → 退回問:「再想想、這真的是『[top1_value]』嗎、還是是其他?」
    >          → 可能 cascade 到路徑 (b) 或 (c)
    > 
    > 路徑 (b) Related — 學員初步認為相關但不一致:
    > AI 話術:
    > 「你說這個反例不是『[top1_value]』、但相關——
    > 我想釐清:它是『[top1_value]』的什麼?
    > (1) 它的 boundary(我『[top1_value]』、但不到這個程度)
    > (2) 它的 cost(我『[top1_value]』、所以承擔這個代價)
    > (3) 它的 trigger(當 X 發生、我不『[top1_value]』、那是觸發、不是真我)」
    > → 學員選一個、AI 寫進 self_concept_progress
    > → 反例 contextualized、不需要 integrated 也不需要 reject
    > → 繼續下個反例
    > 
    > 路徑 (c) Contradictory — 學員初步認為矛盾:
    > AI 話術:
    > 「你說這個反例違反『[top1_value]』——
    > 我想停一下、確認:
    > 是這個反例**真的違反**『[top1_value]』、
    > 還是『[top1_value]』的定義不夠大?
    > 
    > 例:你的 top1_value 是『踏實』、反例是『去年我衝動辭職』——
    > 是『衝動辭職』違反『踏實』、
    > 還是『踏實』的定義太窄、應該包含『該行動時的決斷』?
    > 
    > 你覺得是哪個?」
    > 
    > → 學員回應分支:
    >   - 「定義太窄」→ expand quality definition、寫進 anchors
    >   - 「真的違反」→ 反例 rejected、寫進 negative_examples
    >     → 注意:rejected 多次(>= 3)= quality 認領可能有問題、cascade 回 Phase 1
  
  cross_engine_active:
    - A5.containment_logic_judge(路徑 (a) reframe 合理性評估)
    - 引擎 1 E1c PPL 治理(學員過度配合三向歸類、隨便選類別)
  
  state_updates_during_step:
    session_state.self_concept_progress.triangulation_results: append {
      counter_example: str,
      learner_initial_classification: enum,
      final_classification: enum["consistent", "boundary", "cost", "trigger", "rejected", "definition_expanded"],
      expanded_definition: str | null  # 若觸發 expand
    }
    session_state.counter_examples_list[i].learner_initial_classification: updated
  
  exit_to_step_4:
    - 所有 counter_examples_list 都跑完三向歸類
    - 學員確認無新反例
    - 或 session_day_count_within_phase 已接近 max(自然收尾)
  
  edge_cases:
    - 反例 rejected >= 3:
        quality 認領有問題、cascade A3 handoff:
        「我們已經 3 個反例都違反『[top1_value]』——
        這可能是我們選錯了 top value、想跟你確認:
        (a) 換另一個 value 試(回 Phase 1 step 3)
        (b) 我們繼續、可能它本來就是個 ambiguous quality
        你選哪個?」
    - 整 step 全部走路徑 (a):
        可能是 PPL 過度配合、引擎 1 E1c 警示、HITL alert
```

---

### 9.6 Step 4:Scope Overlap(v5.0 原創 IP #1)

```yaml
step_4_scope_overlap:
  description: |
    v5.0 原創 IP #1:純文字環境 / 亞洲適配的 Self-Concept 整合替代
    Damon 體系 Mapping Across 依賴非語言訊號(submodality 觸感 / 視覺)、
    在純文字環境難完整還原。
    Scope Overlap 用「概念重疊範圍」替代「身體 submodality」。
  
  references:
    - 方法論 5.5 Scope Overlap 完整 SOP
    - v5.0 原創 IP #1 spec
  
  AI 話術骨架:
    > Step 4a — 列出 quality 的「核心」「邊緣」「灰色地帶」:
    > 「我們花了時間挖『[top1_value]』+ 反例三向歸類——
    > 我幫你整理:
    > - 核心(你 100% 是的場景):[從 quality_focus_history 抓]
    > - 邊緣(有時是的場景):[從 counter_examples_list classified as boundary]
    > - 灰色(你還在思考的):[從 counter_examples_list classified as cost/trigger]
    > 
    > 看著這個 list、你覺得『[top1_value]』的 scope 是什麼?」
    > 
    > Step 4b — 確認 expanded quality definition:
    > → 學員給定義 / 邊界
    > → AI 反問驗證:「你說『[expanded definition]』——
    >              這個定義包不包含這個邊緣場景?」
    > → 學員確認 → quality definition 寫入 anchors
    > 
    > Step 4c — 重新做身份測試(關鍵):
    > 「現在用這個 expanded definition——
    > **你是一個『[top1_value]』(這個 expanded 版本)的人嗎?**」
    > → A1.sensory_detail Haiku judge 評估回應
    > → 通過(score >= 2 + answer addresses)→ top1_value 升級 owned
    > → 不通過 → 反例還沒處理完、回 step 2
    > 
    > Step 4d — owned 升級確認:
    > 學員快速答 Yes + evidence 自然舉得出 → top1_value 升級 owned
    > session_state.current_quality_status: "owned"
    > 進 §10 Phase 3a Simplified 銜接
  
  east_asian_adaptation:
    - 亞洲學員傾向「絕對 / 二元」框架(「我是 vs 我不是」)
    - Scope Overlap 強迫學員接受「灰色地帶 = 真實的 quality 範圍」
    - 對應 v5.0 原創 IP #2 東方文化柔軟拆解節奏
  
  cross_engine_active:
    - A1.sensory_detail Haiku judge(step 4c 重新身份測試)
    - 引擎 2 E2_aggregator 4 重組合最後一次判決
  
  state_updates_during_step:
    session_state.self_concept_progress.scope_overlap_applied: true
    user_profile_evolution.anchors: append expanded definition
    session_state.current_quality_status: "owned"(if step 4c passes)
  
  exit_to_phase_3a_simplified_or_phase_4:
    - top1_value 升級 owned → 進 Phase 3a Simplified(§8.5)、跑完 Build Vision + Let it Work
    - top1_value 仍 ambiguous → cascade A3 handoff:
        「『[top1_value]』我們花了 [N] 天、還是 ambiguous——
        我想跟你確認:
        (a) 我們接受它本來就是 ambiguous quality、進 Cascade Down 看 Top 2
        (b) 跟 Vivi 1-on-1 評估
        你選哪個?」
```

### 9.7 Exit Conditions

```yaml
phase_3b_exit:
  
  milestone_completion_owned:
    trigger: |
      Step 4 Scope Overlap 完成
      AND step 4c 重新身份測試通過
      AND current_quality_status == "owned"
    
    next_phase: phase_3a_simplified (見 §10 銜接邏輯)
    
    on_exit_state_updates:
      session_state.current_phase: "phase_3a"
      session_state.next_action: "build_vision_simplified"
      session_state.current_quality_status: "owned"
      user_profile_evolution.quality_focus_history: append
      session_state.phase_history: append phase_3b record
  
  milestone_completion_stays_ambiguous:
    trigger: |
      Phase 3b 4 個 step 都跑完
      AND current_quality_status 仍 "ambiguous"
      AND 學員選擇接受 ambiguous(handoff 變體 (a))
    
    next_phase: phase_4 (Cascade Down、Top 1 標記 owned_via_acceptance)
    
    on_exit_state_updates:
      session_state.current_quality_status: "owned_via_acceptance"  # 特殊狀態、不完整 owned
      session_state.next_action: null
      values_ranking[Top 1].quality_status: "owned_via_acceptance"
  
  max_day_overdue:
    trigger: session_day_count_within_phase > 8(phase 3b max、最長 phase)
    action: 本檔 Turn 1 §2.2 handoff_escalation
    likely_cause: "反例整合循環、三向歸類無收斂、Scope Overlap 未完成"
  
  cascade_to_deep_signal:
    trigger: E3_deep_signal_detector 觸發
    action: phase 暫停、handoff
    post_handoff:
      - 選 (a) 不繼續:Phase 3b 暫停、takeaway 收尾、跨 day 評估
      - 選 (b) Vivi:program pause
      - 選 (c) 跳:強制進 Phase 4、Top 1 標 owned_via_acceptance
```

### 9.8 新增 session_state 欄位

```yaml
session_state.self_concept_progress:
  range: object {
    sub_step: "mapping_across" | "counter_example_integration" | "triangulation" | "scope_overlap",
    findings_template_filled: bool,
    reference_quality: str | null,
    reference_submodalities: list,
    mapping_differences: list,
    counter_examples_count: int,
    triangulation_completed: bool,
    triangulation_results: list of objects,
    scope_overlap_applied: bool,
    expanded_definition: str | null
  }
  initial_value: null
  scope: session-scoped(但跨 day 不 reset、phase 進度保留)
  update_rule: |
    Phase 3b entry 寫入初始值、step 內推進更新、phase exit reset
  reset_on:
    - phase_3b exit
    - new_phase entry

session_state.counter_examples_list:
  range: list of objects {
    example: str,
    detail_level: enum,
    learner_initial_classification: enum | null,
    final_classification: enum | null
  }
  initial_value: []
  scope: session-scoped(跨 day 不 reset)
  reset_on:
    - phase_3b exit
    - new_quality_focus_started
```

### 9.9 Failure Modes

```yaml
phase_3b_failure_modes:
  
  - id: P14
    mode: "Step 1 reference quality 連續 3 次都 ambiguous"
    mitigation: |
      §9.3 已 cover——cascade A3.handoff_escalation。
      可能是學員整體 self-concept 都模糊、需要 Vivi 1-on-1。
  
  - id: P15
    mode: "Step 2 反例整合、學員主動避開反例(只講正面)"
    mitigation: |
      §9.4 東方文化適配段已 cover——AI 主動引出:
      「我覺得你太順了——告訴我一個你沒做到的具體時刻。」
      若學員仍堅持「我沒有反例」:
      → 引擎 1 E1c PPL 治理(這是過度合作)
      → 用 requires_typing 機制強制學員提供至少 1 個具體不夠 quality 的時刻
  
  - id: P16
    mode: "Step 3 三向歸類、學員所有反例都歸 (a) consistent"
    mitigation: |
      §9.5 edge_cases 已 cover:
      整 step 全部 (a) → 可能 PPL 過度配合、HITL alert、AI 不繼續推進。
      話術:
      「我注意到你所有反例都說『是 [top1_value] 的另一面』——
      我想 push back:有沒有真的是『不是』的時刻?
      我們需要一個 contradiction 才能定義邊界。」
  
  - id: P17
    mode: "Step 4c 重新身份測試、學員給的 evidence 仍是 reference quality 的、不是 target"
    例: "expanded definition 包含『斷捨離』、學員 evidence 是『我做過好幾次斷捨離』、但 quality 是『踏實』、不是『斷捨離本身』"
    mitigation: |
      Haiku A1 評估時加 dimension:evidence 是 quality target 還是 quality boundary?
      若 evidence 是 boundary 而非 target:
      → 重問:「這些 evidence 是『斷捨離』的、不是『踏實』本身的——
              給我一個你『踏實』(不限於斷捨離)的時刻。」
  
  - id: P18
    mode: "Scope Overlap 在亞洲學員身上不 work(學員堅持 binary 框架)"
    例: "學員「我就是是、就是不是、灰色地帶我不接受」"
    mitigation: |
      不強推 Scope Overlap、cascade A3:
      「我聽到你不接受灰色地帶——
      那我們可能要 accept top1_value 對你來說就是 ambiguous(有時是、有時不是)、
      不需要強迫 owned。
      你 ok 我們繼續往下走嗎?(進 Phase 4 Cascade Down)」
      → Top 1 標 owned_via_acceptance、繼續
      → 對應 P19 forward note:有些學員的 self-concept 結構本來就是 binary、
        Scope Overlap 對他們無效、要 respect。
```

---

## 10. Phase 3a ↔ 3b 銜接邏輯

### 10.1 Phase 3b → Phase 3a Simplified(常見路徑)

```yaml
phase_3b_to_3a_simplified:
  trigger: |
    Phase 3b Step 4 Scope Overlap 完成
    AND step 4c 重新身份測試通過
    AND current_quality_status: "ambiguous" → "owned"
  
  transition_state_updates:
    session_state.current_phase: "phase_3a"
    session_state.next_action: "build_vision_simplified"
    session_state.build_vision_progress: { init for simplified version }
    user_profile_evolution.quality_focus_history: append (top1_value upgrade)
  
  AI 過渡話術(由主對話 LLM 處理、不另起 inject):
    > 「『[top1_value]』(這個 expanded 版本)現在是你的。
    > 我們把它放進畫面看看——
    > 你看到什麼?身體在哪裡感覺到?」
  
  → 直接接 Phase 3a Step 1 Build Vision(simplified、跳過 Step 2)
```

### 10.2 Phase 3b → Phase 4(接受 ambiguous 路徑)

```yaml
phase_3b_to_4_acceptance:
  trigger: |
    Phase 3b Step 4 完成但 quality 仍 ambiguous
    + 學員選擇接受 ambiguous(handoff 變體 (a))
  
  transition_state_updates:
    session_state.current_phase: "phase_4"
    session_state.current_quality_status: "owned_via_acceptance"
    values_ranking[Top 1].quality_status: "owned_via_acceptance"
    session_state.router_phase: "cascade_down"
  
  AI 過渡話術:
    > 「『[top1_value]』我們確定它是 ambiguous——
    > 我們接受這個、不強迫 binary。
    > 現在看看『[Top 2 value]』——
    > 你是一個『[Top 2 value]』的人嗎?」
  
  → 直接接 Phase 4 Cascade Down
  
  side_effect:
    - Top 1 在 export 中標示「ambiguous quality (accepted)」、不是完全 owned
    - Phase 5 Future Pacing 時、用 ambiguous-aware 變體話術
      (「想像三個月後的你、有時是『[top1_value]』、有時不是——
       那個『有時是』的場景、會發生什麼?」)
```

### 10.3 Phase 3a → Phase 3b(罕見、Phase 3a 內 P10 觸發)

```yaml
phase_3a_to_3b_via_p10:
  trigger: |
    Phase 3a Step 1 P10 觸發
    (dissociated → associated 過渡失敗、學員「我看到那個畫面但不覺得是我」)
  
  rationale: |
    Phase 3a Step 1 Build Vision 假設學員已 owned top1_value、
    但 dissociated → associated 過渡失敗 = 學員實際上對 top1_value 還是 ambiguous
    (雖然 Phase 2 身份測試判定 owned、可能是 P6 過去式 evidence / P7 外部驗證殘留)
  
  transition_state_updates:
    session_state.current_phase: "phase_3b"
    session_state.current_quality_status: "ambiguous"  # 回退
    session_state.self_concept_progress: { init }
    session_state.next_action: "self_concept_model"
  
  AI 過渡話術:
    > 「OK、那個畫面裡的他不是『現在的你』——
    > 我想換個方式:
    > 我們先不 vision、先看看『[top1_value]』在你身上是什麼樣子。
    > **有沒有另一個你 100% 確定『是』的 quality?**」
  
  → 直接接 Phase 3b Step 1 Mapping Across
  
  note: |
    這個路徑是 phase 倒退、必須寫進 phase_history、
    給 Patrick dashboard 監控:
    - phase_3a_to_3b_regression_count(per session)
    - 若全體 Beta 學員 > 20% 發生此 regression、
      可能是 Phase 2 身份測試判決過寬、需 tune Haiku A1 threshold
```

### 10.4 銜接 state machine 總圖

```
Phase 2(身份測試)
   ├──── owned ────→ Phase 3a(full 4 步驟改變法)
   │                      │
   │                      ├── 正常完成 ────→ Phase 4
   │                      │
   │                      └── P10 觸發 ────→ Phase 3b ⟶ Phase 3a Simplified ⟶ Phase 4
   │
   └─ ambiguous ──→ Phase 3b(Self-Concept 模型)
                          │
                          ├── Scope Overlap 升級 owned ────→ Phase 3a Simplified ─→ Phase 4
                          │
                          └── 接受 ambiguous ─────────────→ Phase 4 (owned_via_acceptance)
```

---

## 11. Phase 4:Cascade Down 驗證

### 11.1 Entry

```yaml
phase_4_entry:
  trigger_condition: |
    Phase 3a 或 Phase 3b 完成
    + top1_value 已 owned(or owned_via_acceptance)
    + values_ranking 內有 Top 2 / Top 3
  
  entry_state_updates:
    session_state.current_phase: "phase_4"
    session_state.router_phase: "cascade_down"
    session_state.cascade_down_progress: {  # 引擎 3 §3.5 已定義
      value: values_ranking[Top 2].value,
      status: "testing",
      evidence_count: 0
    }
    session_state.phase_progress: { overwrite to phase_4 init }
  
  cross_engine_triggers_on_entry:
    - 引擎 3 E3_cascade_down_validator 啟動(已 ship)
    - 引擎 4 E4_cascade_down_reference 預備觸發(過渡引用)
```

### 11.2 Internal Step Sequence(SOP)

```yaml
phase_4_steps:
  
  step_1_top2_identity_test:
    description: |
      對 Top 2 做身份測試。
      已由引擎 3 §4.6 E3_cascade_down_validator + 引擎 4 §5.4 E4_cascade_down_reference 完整 spec。
      本 step 主要是「呼叫已 ship 的引擎邏輯、不重寫」。
    
    references:
      - 引擎 3 §4.6 E3_cascade_down_validator(完整 state machine)
      - 引擎 4 §5.4 E4_cascade_down_reference(過渡引用話術)
    
    AI 話術骨架(從引擎 4 §5.4 抓):
      > 變體 A — 首次進入 Cascade Down:
      > 「『[top1_value]』現在是你的。
      > 我們看看『[Top 2 value]』。」
      > 
      > 接著 E3_cascade_down_validator 接手:
      > 「你是一個『[Top 2 value]』的人嗎?」
    
    cross_engine_active:
      - E3_cascade_down_validator state machine 推進
      - A1.sensory_detail Haiku judge 評估 evidence(score >= 2 即過)
    
    exit:
      - Top 2 status → "passed" 或 "failed_need_self_concept"
  
  step_2_top2_branch:
    description: |
      根據 step 1 結果分支。
    
    分支:
      若 Top 2 passed:
        → 進 step 3(Top 3 測試、若有)
        → values_ranking[Top 2].quality_status: "owned" 或 "owned_via_cascade"
      
      若 Top 2 failed_need_self_concept:
        → cascade 到子 Self-Concept 模型(對 Top 2 跑 mini Phase 3b)
        → mini Self-Concept 用 Top 1 owned 作為 reference quality(節省時間)
        → mini Phase 3b 完成 → 回 step 1 重測 Top 2
        → mini Phase 3b 重複失敗 2 次 → handoff variant:
          「『[Top 2 value]』反覆不通過——
          我們有兩個選擇:
          (a) 接受 Top 2 是 ambiguous、不強推 owned、繼續看 Top 3
          (b) 暫停 Cascade Down、跟 Vivi 評估排序是否需要調整
          你選哪個?」
  
  step_3_top3_identity_test:
    description: |
      若 values_ranking 有 Top 3、重複 step 1-2 對 Top 3。
      若沒有 Top 3、跳 step 4。
    
    note: |
      Top 4 / Top 5 不做 Cascade Down——
      Damon 體系:Top 1-3 是核心、Top 4-5 是輔助、不需逐一身份測試。
      values_ranking[Top 4/5] 保留在 export、但 quality_status 為 "untested"
  
  step_4_cascade_completion:
    description: |
      Cascade Down 全部處理完(Top 1 owned + Top 2-3 處理完)、進 Phase 5。
    
    exit_to_phase_5:
      - cascade_down_progress.status == "completed"
      - router_phase: "completed"
      - 所有 values_ranking[1-3] 都有 quality_status
```

### 11.3 Exit Conditions

```yaml
phase_4_exit:
  
  milestone_completion:
    trigger: |
      cascade_down_progress.status == "completed"
      AND values_ranking[1-3] 都有 quality_status
    
    next_phase: phase_5
    
    on_exit_state_updates:
      session_state.current_phase: "phase_5"
      session_state.router_phase: "completed"
      session_state.phase_history: append phase_4 record
  
  max_day_overdue:
    trigger: session_day_count_within_phase > 4(phase 4 max)
    action: 本檔 Turn 1 §2.2 handoff_escalation
    likely_cause: "Top 2 或 Top 3 反覆不通過、mini Self-Concept 循環"
  
  cascade_to_deep_signal:
    trigger: E3_deep_signal_detector 觸發
    action: phase 暫停、handoff
  
  edge_case_single_value:
    trigger: values_ranking 只有 Top 1(無 Top 2-3)
    action: |
      引擎 3 §4.6 H12 已 cover——
      cascade_down_progress.status = "completed"、跳過 Cascade Down、直接進 Phase 5
      記錄:「『[top1_value]』是你的全部」(學員可能很 focused)
```

### 11.4 Failure Modes

```yaml
phase_4_failure_modes:
  
  - id: P19
    mode: "Top 2 反覆 failed、mini Self-Concept 也無效"
    mitigation: |
      §11.2 step 2 已 cover——handoff variant 給學員選擇:
      (a) 接受 ambiguous 繼續 / (b) 暫停評估排序
      連續觸發此 mitigation 2 次:強制 (b)、HITL alert Vivi。
  
  - id: P20
    mode: "Top 2 passed 但 evidence 全是 Top 1 derived(學員把 Top 1 evidence 套用)"
    例: "Top 1 = 踏實、Top 2 = 用心、學員 evidence「我踏實做事、所以用心」"
    mitigation: |
      Haiku A1 加 dimension:evidence 是否 derive from another value?
      若 yes:不算 Top 2 獨立 owned、要求學員給 Top 2 獨立 evidence。
      工程實作 Patrick spec、本檔不深入。
  
  - id: P21
    mode: "Top 3 跟 Top 1 矛盾(values 排序時的 latent conflict 浮現)"
    例: "Top 1 = 自由、Top 3 = 安全感"
    mitigation: |
      Containment Judgment 應在 Phase 1 已處理 latent conflict——
      若 Phase 4 才浮現:cascade 回 Phase 1 step 3 重新排序、HITL alert
      (代表 Phase 1 Containment Judgment 漏網、需 tune)
```

---

## Turn 2 收尾

### 本 Turn 完成範圍

✅ Phase 3a(owned path、4 步驟改變法)完整 spec  
✅ Phase 3b(ambiguous path、Self-Concept 模型 4 個子 step)完整 spec  
✅ Step 3 三向歸類(v5.0 原創 IP #3)詳細 SOP  
✅ Step 4 Scope Overlap(v5.0 原創 IP #1)詳細 SOP  
✅ Phase 3a ↔ 3b 銜接邏輯(3 個方向)+ state machine 總圖  
✅ Phase 4 Cascade Down 完整 spec  
✅ 13 failure modes(P10-P21、含 phase 倒退 P10 / PPL 過度配合 P16 / Top 2 derived evidence P20)  
✅ Phase 3a / 3b 新增 session_state 欄位(2 個 object 欄位 + 1 list)  
✅ Phase 3a Simplified 規格(從 Phase 3b 升級進入的快速版)  

### Turn 3 預告

- **Phase 5**(Future Pacing + Let it Go + Export Personal Coach Prompt)
- **附錄 C**:3 個 5.7.4 原創情境話術
  - C.1 已 cover 情境(指向引擎 1-4 SOP)
  - C.2 補強情境(2 個新增:抗拒提問 specific 主題 / 想結束 session 中段時機)
  - C.3 phase-specific 應用
- **跨引擎合約總表**(Checkpoint 1 ↔ 引擎 1-4 完整合約)
- **Patrick 接手清單**(migration 014 phase 欄位)
- **Forward references** + dashboard 整合
- **整體收尾**(Turn 1+2+3 合併為單一 markdown)

### 行數累計

| Turn | 行數 | 累計 |
|---|---|---|
| Turn 1 | 854 | 854 |
| Turn 2(本檔) | (見下) | ~1700 |
| Turn 3 (預估) | ~600-800 | ~2300-2500 |

→ 對齊 framing 預估 ~2000-2500 行 ✅

---

## 文件版本

- v0.1 Turn 2 (2026-05-19):Phase 3a / 3b / 4 完整 spec
- 銜接:Turn 1(Framework + Phase 1-2)+ Turn 2(本檔)+ Turn 3(後續)
