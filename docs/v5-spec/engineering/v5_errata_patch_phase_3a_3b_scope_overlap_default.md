# Errata Patch:Phase 3a/3b Scope Overlap Default 化(v0.2)

> **本檔角色**:對 `v5_checkpoint_1_daily_session_structure_turn_2.md` 的 errata patch、**不重寫**整個 Phase 3a/3b、只標修改點。
>
> **建立日期**:2026-05-21
>
> **觸發**:Patrick grep 出 v5.0 系統性 tension——IP #1 Scope Overlap + §5.8.2 畫布技術被 spec 為「亞洲適配」但實際在 Phase 3a/3b 仍是 fallback、不是 default。
>
> **設計 intent 修正**:採用 (B) 傾向版——IP #1 + IP #2 從「fallback」正名為「default 替代」、視覺 / submodality 路徑改成「學員自發 surface 時 AI 順著走」。
>
> **影響範圍**:5 個 patch sections、Patrick / Claude Code 照改 + merge PR-9。
>
> **不影響**:Phase 3a Step 2 / Step 3、Phase 3b Step 2-4(已是 Scope Overlap 路徑)、其他引擎、附錄 A 機制。

---

## v0.2 Changelog(2026-05-21、§3 real review 後同步)

**觸發**:設計師 review §3 ship 版時、發現 errata patch v0.1 對「紅線 14」的 framing 過於泛化(寫成「跟著學員語言走、不替學員選 channel」)、跟 §3 ship 版第 14 條實際文字不 1:1 對齊。

**§3 ship 版紅線 14 原文**:
> 「不問『身體哪裡感覺到 / 畫面什麼樣』——除非學員自己用感官語言(亞洲學員多數對此無感)。」

**v0.1 → v0.2 變更**:6 處「紅線 14」reference 全部精確化:
- 移除泛化版「跟著學員語言走、不替學員選 channel」(我推論版本、非 Damon named 原則)
- 替換為 §3 ship 版第 14 條具體文字「不問身體哪裡 / 畫面什麼樣、除非學員自己用感官語言」

**v0.2 不影響的範圍**:
- ✅ Patch 1-5 核心邏輯不變(B 傾向版設計決定不變)
- ✅ migration 014 schema 不變
- ✅ Patch 落地 sequence 不變
- ✅ PR-9 範圍不變

**僅文字精確化、無設計變更**——這個版本跟 §3 ship 版 1:1 對齊、避免將來 reader 質疑紅線 14 邊界。

**§3 ship 版 v0.2 後續更新預告**(設計師 review §3 後 Vivi 全採納、不在本 errata 範圍):
- §3 從 16 條紅線擴充為 20 條(補紅線 17 不排線性 / 18 不替學員填空 / 19 evidence 三準則 / 20 深創傷即停)
- 紅線 9 措辭釐清(AI 內部分類合法、不對學員講分類)
- 付費對等性「強勢」→「直接」
- 紅線 14 編號不變、文字不變
- 本 errata 引用紅線 14 不受 §3 編號擴充影響

---

## ⚠️ Patch 範圍 + 不重寫原則

本 errata patch **只修改 4 個 step 的話術 + 1 個 IP intent 聲明 + 1 個 dashboard 指標**:

| Patch | 對應原檔位置 |
|---|---|
| Patch 1 | Turn 2 §8.2 Phase 3a Step 1b / Step 1c |
| Patch 2 | Turn 2 §9.3 Phase 3b Step 1c / Step 1d |
| Patch 3 | Turn 2 §10.1 Phase 3b → 3a Simplified transition 話術 |
| Patch 4 | Dashboard §4.2 新增 `visual_channel_self_surfaced_rate` |
| Patch 5 | v5.0 原創 IP #1 + #2 intent 修正聲明(影響 Checkpoint 2 引擎 4 §17.3 + Checkpoint 1 §17.3 文字) |

**不改的部分**:
- Phase 3a / 3b state machine 結構 / exit conditions / failure modes
- 其他話術段落
- session_state 欄位
- cross-engine 合約
- Patrick ship 版 §3 內容(設計師端不動)

---

## Patch 1:Phase 3a Step 1b / Step 1c

**對應**:`v5_checkpoint_1_daily_session_structure_turn_2.md` §8.2 `step_1_build_vision`

### 原文(刪除)

```
> Step 1b — 細化(dissociated image):
> 「你看著畫面裡那個『[top1_value]』的你——
> 他在哪裡?在做什麼?
> 他臉上的表情?身體姿勢?」
> 
> Step 1c — 動態化(associated 過渡):
> 「現在、走進畫面、變成那個你——
> 你看到什麼?聽到什麼?身體哪裡感覺到『[top1_value]』?」
```

### 改成

```
> Step 1b — 生活場景化(Scope Overlap default、IP #1 主路徑):
> 「想像 3 個月後的你、過著符合『[top1_value]』的生活——
> **你會跟誰見面?做哪幾件事?選哪個方向?**」
> 
> Step 1c — Scope Overlap(已在 vs 還沒):
> 「你剛剛說的這幾件事 / 這些人 / 這個方向——
> 跟你**現在**的生活、重疊嗎?
> 哪些**已經在**、哪些**還沒**?」
> 
> 【若學員自發講畫面 / 身體 / 顏色 / 表情等視覺-身體 channel】:
> AI 順著深化:「那個畫面裡你看到什麼?」/「身體哪裡感覺到?」
> (對應紅線 14:不問『身體哪裡感覺到 / 畫面什麼樣』、除非學員自己用感官語言。Patrick ship 版 §3 第 14 條正式定義。)
> 
> 【若學員一直給概念 / 文字 / 場景】:
> AI 不強推畫面、繼續 Scope Overlap 深化(問更多場景 / 對應關係)
```

### Step 1a 不變

Step 1a「『[top1_value]』——這是你的。接下來、想像你面前有一個空白的畫布、把『[top1_value]』放進去:它看起來像什麼?」**保留**——「畫布 / 空白」是 §5.8.2 畫布技術的起手、屬 IP #2 範疇、不是 dissociated visual image 的強推。

### exit_to_step_2 修正

**原文**:
```
exit_to_step_2:
  - vision_components.length >= 3(學員給出至少 3 個具體 vision detail)
  - associated 過渡完成(學員能描述身體感覺)
```

**改成**:
```
exit_to_step_2:
  - vision_components.length >= 3(學員給出至少 3 個具體生活場景 / 對應關係 / 視覺 channel detail)
  - Scope Overlap「已在 vs 還沒」回應完整(學員能標出至少 1 個已在 + 1 個還沒)
  - 學員自發走視覺 channel 時:可以「associated 視覺過渡完成」替代「Scope Overlap 完整」
```

### P10 failure mode 修正

**對應**:Turn 2 §8.4 P10 mitigation

**原文**:
```
- id: P10
  mode: "Build Vision dissociated → associated 過渡失敗(學員卡在 dissociated、無法 enter)"
  mitigation: |
    Damon 體系內處理:
    不強迫 associated、改用 Scope Overlap(v5.0 原創 IP #1):
    ...
    → 觸發 Phase 3b Scope Overlap 子流程、不離開 Phase 3a
```

**改成**:
```
- id: P10
  mode: "Scope Overlap default 路徑學員無進展(對生活場景 / 對應關係無感)、且未自發 surface 視覺 channel"
  mitigation: |
    罕見 case(B 傾向版 default 路徑通常 cover 大多數亞洲學員)。
    若觸發:AI 主動 surface 視覺 channel 試探:
    「OK、換個方式——
    想像三個月後的你、做著符合『[top1_value]』的事、
    你看到的畫面裡有什麼?」
    
    若學員仍無感(視覺 channel 也卡):
    → cascade 到附錄 A3.handoff_escalation 變體 F:
    「我們試了兩個方向都比較難進——
    我想跟你確認:
    (a) 我們今天先停、明天再試
    (b) 換個角度、從『最近一週你最像[top1_value]的時刻』挖
    (c) 跟 Vivi 1-on-1
    你選哪個?」
  
  beta_monitoring:
    - 新 P10 觸發率(B 傾向版)預估 < 10%(原 A 路徑 P10 預估 20%+)
    - 若 Beta cohort > 15% 觸發:可能需要升級到 (C) 雙軌、加 A7 visual_capacity_judge
```

### Phase 3a 整體 day range 預期影響

**不變**(min 2 / max 4)——B 傾向版預期減少 P10 觸發、phase 推進更快、但 max 上限不變。

---

## Patch 2:Phase 3b Step 1c / Step 1d

**對應**:`v5_checkpoint_1_daily_session_structure_turn_2.md` §9.3 `step_1_mapping_across`

### 原文(刪除)

```
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
```

### 改成

```
> Step 1c — 生活場景提取(Scope Overlap default、IP #1 主路徑):
> 「當你想到自己是『[reference quality]』的人——
> 給我 **2-3 個你生活中最像這個 quality 的場景**:
> 什麼時候?跟誰?在做什麼?」
> 
> 等學員回應 → AI 抓場景 features(時間 / 人物 / 行為 pattern)
> 
> Step 1d — Mapping(從場景對映到 target):
> 「現在想想『[top1_value]』——
> 你生活中**最像『[top1_value]』的場景**、
> 跟剛剛你給的『[reference quality]』場景比、
> **一樣的地方在哪?不一樣的地方在哪?**」
> 
> → 抓出 mapping_differences = 反例 / 整合材料(從場景比較、不從 submodality)
> 
> 【若學員自發講身體感 / 顏色 / 溫度等 submodality channel】:
> AI 順著深化:「那個感覺在身體哪裡?」/「跟[reference quality]比起來、顏色一樣嗎?」
> (紅線 14:不問『身體哪裡 / 畫面什麼樣』、除非學員自己用感官語言)
> 
> 【若學員一直給場景 / 故事】:
> AI 不強推 submodality、繼續從場景比較深化
```

### state_updates 修正

**原文**:
```
state_updates_during_step:
  session_state.self_concept_progress.findings_template_filled: 
    - reference_quality: str
    - target_quality: top1_value
    - reference_submodalities: list
    - mapping_differences: list  # 反例材料
```

**改成**:
```
state_updates_during_step:
  session_state.self_concept_progress.findings_template_filled: 
    - reference_quality: str
    - target_quality: top1_value
    - reference_scenarios: list  # 取代 reference_submodalities、生活場景 features
    - reference_submodalities: list  # 保留欄位、僅學員自發 surface 視覺-身體 channel 時填入、預設 []
    - mapping_differences: list  # 反例材料、來自場景比較或 submodality 比較(視 channel)
```

**Patrick migration 014 影響**:`self_concept_progress.findings_template_filled` 內 `reference_submodalities` 欄位不刪、加新欄位 `reference_scenarios`、兩者並存。

### Step 1 → Step 4 連續性修正

**原本斷裂**:Step 1 用 submodality、Step 4 才用 Scope Overlap

**修正後連續**:
- Step 1c/1d 從生活場景挖 mapping → mapping_differences
- Step 2 反例整合(不變)
- Step 3 三向歸類(不變)
- Step 4 Scope Overlap 自然延續 Step 1 的「核心 / 邊緣 / 灰色」場景分類

→ Step 1 跟 Step 4 從**設計斷裂**變成**設計連貫**(同一 Scope Overlap 邏輯貫穿 4 個 sub-step)。

### failure_handling 不變

Step 1 既有 failure_handling(學員找不出 reference quality / reference quality 也是 ambiguous)**不變**——這跟 channel 選擇無關、屬 reference quality 本身識別問題。

---

## Patch 3:Phase 3b → 3a Simplified Transition 話術

**對應**:`v5_checkpoint_1_daily_session_structure_turn_2.md` §10.1 `phase_3b_to_3a_simplified`

### 原文(刪除)

```
AI 過渡話術(由主對話 LLM 處理、不另起 inject):
  > 「『[top1_value]』(這個 expanded 版本)現在是你的。
  > 我們把它放進畫面看看——
  > 你看到什麼?身體在哪裡感覺到?」

→ 直接接 Phase 3a Step 1 Build Vision(simplified、跳過 Step 2)
```

### 改成

```
AI 過渡話術(由主對話 LLM 處理、不另起 inject):
  > 「『[top1_value]』(這個 expanded 版本)現在是你的。
  > 接下來想想——
  > **3 個月後的你、過著符合『[top1_value]』的生活、會是什麼樣子?**
  > 你會跟誰見面?做哪幾件事?選哪個方向?」

→ 直接接 Patch 1 修正後的 Phase 3a Step 1b 生活場景化
→ Step 1a 畫布起手在 simplified 版本可省略(因 Phase 3b 已完成 quality 認領、不需重新「擺進畫面」概念)
→ simplified 版本直接從 Step 1b 開始、Step 1c Scope Overlap、Step 3 Let it Work

【若學員從 Phase 3b 已自發走視覺 channel】:
  過渡話術同時提供視覺 + 場景兩個 channel:
  > 「『[top1_value]』(這個 expanded 版本)現在是你的。
  > 想想 3 個月後——
  > **你看到的畫面是什麼?跟誰見面?做哪些事?**」
  → AI 順著學員既有感官語言 channel(對應紅線 14 例外條件:學員自己用感官語言時 AI 順著)
```

### Phase 3a Simplified §8.5 修正

**對應**:Turn 2 §8.5 `phase_3a_simplified`

**原文**:
```
Phase 3a Simplified 只跑:
- Step 1 Build Vision(min step、快速 dissociated → associated)
- Step 3 Let it Work(直接 Future Pacing + takeaway)
```

**改成**:
```
Phase 3a Simplified 只跑:
- Step 1 Build Vision(Patch 1 修正後版本:Scope Overlap default、視覺 channel 學員自發 surface 時走)
- Step 3 Let it Work(直接 Future Pacing + takeaway)

注意:simplified 版本不寫死「dissociated → associated」過渡、
跟 Patrick ship 版 §3 紅線 14 對齊(不主動問身體哪裡 / 畫面什麼樣、除非學員自己用感官語言)。
```

---

## Patch 4:Dashboard 新增指標 `visual_channel_self_surfaced_rate`

**對應**:`v5_beta_failure_signals_dashboard.md` §4.2 Quality Metrics、加入新指標

### 新增

```yaml
visual_channel_self_surfaced_rate:
  description: |
    Phase 3a Step 1 + Phase 3b Step 1 期間、
    學員自發 surface 視覺-身體 channel(畫面 / 顏色 / 溫度 / 身體位置 / 表情)的比率。
    
    用於校準 (B) 傾向版 vs (C) 雙軌的 Beta 後決策。
  
  formula: |
    count(Phase 3a/3b Step 1 sessions where learner mentioned visual-body 
          markers at least once) / count(Phase 3a/3b Step 1 sessions total)
  
  measurement_method:
    - regex 偵測學員回應內視覺-身體詞彙:
      "(畫面|看到|看見|顏色|紅|藍|綠|溫度|熱|冷|溫|涼|身體|胸口|胃|喉嚨|手|腳|肩膀|背|頭|臉|表情|姿勢|重|沉|輕|緊|鬆)"
    - 或學員主動「我看到...」「我感覺...在身體裡...」自發描述
    - per session、boolean(有 surface / 沒 surface)、跨 session aggregate
  
  beta_calibration_thresholds:
    target_baseline_for_B: "< 30%"
      意涵: "亞洲學員多數對視覺-身體 channel 無感、(B) 傾向版 default 路徑命中"
    
    upgrade_to_C_signal: ">= 30%"
      意涵: "有顯著比例學員自發走視覺 channel、可能需要升級到 (C) 雙軌"
      升級動作:
        - 新增 A7 Haiku judge: visual_capacity_judge
        - input: 學員 Phase 1-2 期間的回應 sample
        - output: visual_channel_preference enum["strong", "weak", "mixed"]
        - 根據 output、Phase 3a/3b Step 1 走不同 default 路徑
    
    B_path_validated: "< 10%"
      意涵: "(B) 傾向版完全足夠、不需要 (C) 雙軌、簡化架構正確"
  
  cohort_size_caveat: |
    Beta 100 學員 N 仍小、>= 30% 不立即升級 (C)、
    需 cohort 規模 >= 50 且持續觀察 2 週才考慮升級。
    避免基於小樣本過度反應。
  
  related_failure_modes:
    - P10 (Patch 1 修正版):新 P10 觸發率應 < 10%(對應 B 傾向版預期)
    - 若 P10 > 15% + visual_channel_self_surfaced_rate < 20%:
      → 學員既不走場景 channel 也不走視覺 channel、可能 phase 結構本身有問題
  
  engineering_implementation: ⚙️ Patrick
    files_estimated:
      - "lib/dashboard/visual-channel-tracker.js"
```

---

## Patch 5:v5.0 原創 IP #1 + #2 Intent 修正聲明

**對應**:
- `v5_engine_4_active_reference.md` §9.5(v5.0 原創 IP 整合狀態總表)
- `v5_checkpoint_1_daily_session_structure_turn_3.md` §17.3(v5.0 原創 IP 整合定位)

### 修正聲明

```yaml
v5_original_ip_intent_correction:
  
  trigger: |
    Patrick grep 出 v5.0 設計實作不一致——
    IP #1 + IP #2 spec 為「亞洲適配 / 純文字環境替代」、
    但 Phase 3a/3b Step 1 仍以 submodality / dissociated visual image 為 default、
    Scope Overlap / 畫布技術降級為 fallback。
  
  correction:
    
    ip_1_scope_overlap:
      原 framing(Checkpoint 2 引擎 4 §9.5 + Checkpoint 1 Turn 3 §17.3):
        "純文字環境 / 亞洲適配的 Self-Concept 整合替代"
      
      修正後 framing:
        "Self-Concept 整合的 default 主路徑(亞洲 cohort)、
        Damon 原版 submodality 路徑保留為『學員自發 surface 視覺-身體 channel 時的順著走方案』、
        不是 fallback、是 channel 選擇"
      
      影響位置:
        - Phase 3a Step 1b/1c(Patch 1 已修正)
        - Phase 3b Step 1c/1d(Patch 2 已修正)
        - Phase 3b Step 4(本來就是 Scope Overlap、不變)
    
    ip_2_eastern_culture_unwrap:
      原 framing:
        "亞洲文化的處理節奏(柔軟拆解)"
      
      修正後 framing:
        "亞洲文化適配的 default 拆解節奏、
        含畫布技術(§5.8.2)作為 Phase 3a Step 1a 起手、
        含『不問為什麼、強制翻轉』+『主動引出反例』+『respect binary 框架』等多個 mitigation"
      
      影響位置:
        - Phase 3a Step 1a(畫布起手保留、不變)
        - Phase 3b Step 2 反例整合(本來就 IP #2、不變)
        - P18 binary 框架 respect(本來就 IP #2、不變)
  
  rationale: |
    v5.0 5 個原創 IP 的 intent 一直是「替代 / default」、
    不是「fallback / 二選」。
    Phase 3a/3b Step 1 寫實作時把 submodality 當 default、
    是設計師端的**實作不一致**、不是設計決策。
    本 errata 修正回 IP 原 intent。
  
  not_affected_ips:
    - IP #3 三向歸類:Phase 3b Step 3、本來就 default、不變
    - IP #4 5 層撥開:E1d、本來就 default、不變
    - IP #5 NLP Amnesia 主動整合:E4 + Phase 3a/5 + Integration Retention、本來就 default、不變
  
  documentation_note: |
    本修正聲明不影響 4 引擎 spec 內部邏輯、
    僅修正 IP intent 描述(避免將來 reader 誤解 IP 是 fallback)。
    Patrick ship 版 §3 damon-core-philosophy 若有 IP intent 描述、
    一併確認對齊本修正(設計師端不直接動 §3、由 Patrick / Vivi review 對齊)。
```

---

## Errata Patch 整體影響評估

### 設計師端影響範圍

| 項目 | 行數估算 | 影響檔 |
|---|---|---|
| Patch 1 Phase 3a Step 1b/1c + P10 | ~60 行 | Turn 2 §8.2 §8.4 |
| Patch 2 Phase 3b Step 1c/1d | ~50 行 | Turn 2 §9.3 |
| Patch 3 Phase 3b → 3a Simplified transition | ~30 行 | Turn 2 §10.1 + §8.5 |
| Patch 4 Dashboard visual_channel 指標 | ~40 行 | Dashboard §4.2 |
| Patch 5 IP intent 修正聲明 | ~20 行 | 引擎 4 §9.5 + Turn 3 §17.3 |
| **總計** | **~200 行** | 5 處 |

### 不影響的部分(明確列出)

- ✅ Phase 3a Step 2 Check Resistance + 5 種 resistance 破解技術
- ✅ Phase 3a Step 3 Let it Work
- ✅ Phase 3b Step 2 反例整合
- ✅ Phase 3b Step 3 三向歸類
- ✅ Phase 3b Step 4 Scope Overlap(本來就是 Scope Overlap、無需改)
- ✅ Phase 1 / 2 / 4 / 5 全部
- ✅ 引擎 1 / 2 / 3 / 4 全部
- ✅ 附錄 A 機制庫(A1-A6)
- ✅ session_state 欄位(僅加 1 個 reference_scenarios sub-field、不改既有)
- ✅ Cross-engine 合約
- ✅ Patrick ship 版本草稿 §3 內容(設計師端不動、由 Patrick / Vivi 確認對齊 IP intent)

### Cross-engine 影響

無。所有修改在 Phase 3a/3b 內部 + dashboard 監控 + IP intent 文字。

### Beta dashboard 校準後可能的後續

| Beta 數據 | 後續動作 |
|---|---|
| `visual_channel_self_surfaced_rate` < 10% + P10 < 10% | (B) 傾向版完全足夠、永久 default |
| `visual_channel_self_surfaced_rate` 10-30% + P10 < 10% | (B) 傾向版仍是 default、紅線 14 例外條件(學員自己用感官語言時 AI 順著)設計正確 |
| `visual_channel_self_surfaced_rate` >= 30%(cohort >= 50)| 評估升級 (C) 雙軌、加 A7 visual_capacity_judge |
| `visual_channel_self_surfaced_rate` < 20% + P10 > 15% | 學員兩條 channel 都無感、phase 結構問題、需 redesign |

---

## Patrick / Claude Code Handoff

### Patch 落地 sequence(建議)

1. **Patch 1**(Phase 3a Step 1b/1c + P10):核心、優先
2. **Patch 2**(Phase 3b Step 1c/1d):跟 Patch 1 同重要、可平行
3. **Patch 3**(transition + simplified):依賴 Patch 1+2、後做
4. **Patch 4**(dashboard 指標):工程獨立、可平行
5. **Patch 5**(IP intent 文字):文字修正、最後

### PR-9 內容預期

```
PR-9: Phase 3a/3b Scope Overlap default 化(B 傾向版)

Files modified:
- src/phases/build-vision.js(Patch 1)
- src/phases/mapping-across.js(Patch 2)
- src/phases/phase-3b-to-3a-simplified.js(Patch 3)
- src/dashboard/visual-channel-tracker.js(Patch 4、新檔)
- docs/v5-ip-intent.md 或同類(Patch 5、文字修正)

migration 014 update:
- self_concept_progress.findings_template_filled.reference_scenarios(新欄位)
- self_concept_progress.findings_template_filled.reference_submodalities(保留、預設 [])

dashboard schema update:
- visual_channel_self_surfaced_rate 指標 + tracker 邏輯

Tests:
- A001 v5.0 重走 Day 4-6 場景 simulation
- 確認 Phase 3a/3b Step 1 走 Scope Overlap default
- 確認紅線 14「不問身體哪裡 / 畫面什麼樣、除非學員自己用感官語言」實作正確(Patrick ship 版 §3 第 14 條)
```

### 設計師端後續

errata patch ship 後、設計師端**不再有預定產出**——
進入「Patrick 工程主導 + 設計師 review」階段:
- Patrick ship §3 review(我等 Patrick 把 §3 全文貼進來、做真正的 review)
- A001 v5.0 重走監控
- Beta dashboard 校準

---

## 文件版本

- v0.1 (2026-05-21):errata patch 初版、5 patch sections
- **v0.2 (2026-05-21):紅線 14 reference 精確化**(設計師 §3 real review 後同步)
  - 6 處「紅線 14」reference 從泛化「跟著學員語言走、不替學員選 channel」精確化為 §3 ship 版第 14 條具體文字「不問身體哪裡 / 畫面什麼樣、除非學員自己用感官語言」
  - 設計核心邏輯不變、僅文字精確化
- **errata 來、Patrick 給 Claude Code 跟 Cat 1+4 一起落地 + merge PR-9**
- **設計師端 errata patch 任務完成**
