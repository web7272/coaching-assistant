# v5.0 引擎 3:4.7 中央路由器(Central Router)

> **文件用途**:Checkpoint 2 第三個交付件。Patrick 工程端接此檔做引擎 1+2+3 合併 schema 反推。
>
> **建立日期**:2026-05-19
>
> **對應方法論**:`damon_methodology.md` 章節 4.7(AI App Session Flow 完整藍圖)、3.4(Containment Judgment 與存在依賴測試)、4.3-4.6(Parts Integration 與 Resistance)、5.3(Re-imprinting 完整實戰手冊)、5.7.4(AI app 必須原創處理的 3 個情境)
>
> **對應 TODO**:`v5_next_actions.md` TODO 1 第一優先級 prompt 引擎 #3
>
> **版本**:設計師對話版(v0.1)。Patrick 24h 內提交 ship 版草稿。
>
> **依賴關係**:依賴引擎 1 的 `cumulative_ppl_score` + 引擎 2 的 `current_quality_status` / `quality_focus_history` / `elicitation_mode_active`。引擎 1+2 必須先 ship。

---

## ⚠️ 範圍 Warning

本檔範圍 = **B(pure decision tree)**:
- ✅ 接收引擎 2 輸出、做路由決策
- ✅ 特殊開場分支處理(「我卡住了 / 不知道」/「我不夠好」/「我老是搞砸」)
- ✅ Top 1 判定(values 排序 + 存在依賴測試 / Containment Judgment / Linear Thinking Error)
- ✅ Cascade Down 驗證觸發 + 執行
- ✅ Re-imprinting / Parts Integration **訊號偵測 + 路由**(不執行)
- ❌ 不包含 Build Vision / Self-Concept / Mapping Across / Scope Overlap / 三向歸類 / Re-imprinting 內部執行——這些屬於 **Checkpoint 1 21 天 daily session 結構** spec
- ❌ 不包含 AI 主動引用機制的引用方式——屬於引擎 4

---

## ⚠️ Sync Warning

本檔內嵌 `damon_methodology.md` 4.7 章節核心藍圖 + 3.4 Containment Judgment 摘要(見文末附錄 B)。若工程端文件版本不同步、以本檔內嵌為準。

---

## 目錄

1. [架構總覽](#1-架構總覽)
2. [Token Budget](#2-token-budget)
3. [Session State Fields](#3-session-state-fields)
4. [元件 spec](#4-元件-spec)
   - 4.1 cached_4_7_router_reference(cached prefix)
   - 4.2 E3_opening_branch_router(Layer 1 — 特殊開場分支)
   - 4.3 E3_status_router(Layer 2 — 主路由 4 條路徑)
   - 4.4 E3_top1_determination(Layer 3 — Top 1 判定)
   - 4.5 E3_cascade_down_validator(Layer 4 — Cascade Down 驗證)
   - 4.6 E3_deep_signal_detector(Layer 5 — Re-imprinting / Parts 訊號)
5. [附錄 A 新增機制(雙方合約)](#5-附錄-a-新增機制)
6. [跨引擎合約](#6-跨引擎合約)
7. [Patrick 接手清單](#7-patrick-接手清單)
8. [Forward References](#8-forward-references)
9. [附錄 B:方法論 4.7 + 3.4 內嵌](#9-附錄-b)

---

## 1. 架構總覽

引擎 3 採 **cached prefix + 5 個互斥 conditional inject 子路由器** 架構,沿用引擎 1 cached_5_layer_unwrap_reference + 4 sub-prompts 設計語言。

```
┌──────────────────────────────────────────────────────────────────┐
│ Layer 0: cached prefix(永久載入、~26% baseline cost)              │
│ ─ cached_4_7_router_reference (~1400 tokens)                     │
│   - 4.7 中央路由器藍圖描述                                          │
│   - Top 1 存在依賴測試 SOP                                          │
│   - Cascade Down 驗證 SOP                                         │
│   - Re-imprinting 訊號清單(11 步驟 + 觸發訊號)                     │
│   - Parts Integration 切換條件(5 種 resistance 識別)               │
│   - 特殊開場分支 reframe 範本                                       │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ Layer 1-5: 5 個互斥 conditional inject 子路由器                    │
│ (任一觸發時 active、依優先順序判斷)                                  │
└──────────────────────────────────────────────────────────────────┘

優先順序(由上到下、命中即停):

┌──────────────────────────────────────────────────────────────────┐
│ 1. E3_deep_signal_detector(~240 tokens)                         │
│    深創傷 / Re-imprinting 訊號 → 路由到 handoff_escalation         │
│    最高優先級:深創傷不能被當「特殊開場」處理                          │
└──────────────────────────────────────────────────────────────────┘
                              │ 未命中
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ 2. E3_opening_branch_router(~260 tokens)                        │
│    僅 elicitation_mode_active==true 時觸發                       │
│    「我卡住了 / 不知道」/「我老是搞砸」/「我不夠好(淺)」reframe      │
└──────────────────────────────────────────────────────────────────┘
                              │ 未命中
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ 3. E3_top1_determination(~280 tokens)                           │
│    觸發條件:values 採集已有 3-5 個排序候選、                          │
│    需要決定 Top 1(用 Containment Judgment 而非線性排序)            │
└──────────────────────────────────────────────────────────────────┘
                              │ 未進入此階段
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ 4. E3_status_router(~220 tokens)                                │
│    主路由:讀引擎 2 current_quality_status、執行 4 條路由             │
│    - owned → Build Vision(Checkpoint 1 範圍、本引擎只 handoff)    │
│    - ambiguous → Self-Concept 模型(同上)                          │
│    - candidate → 繼續挖 evidence(本引擎 SOP)                      │
│    - none → 繼續 values elicitation(本引擎 SOP)                   │
└──────────────────────────────────────────────────────────────────┘
                              │ Top 1 已 owned 後
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ 5. E3_cascade_down_validator(~250 tokens)                       │
│    觸發條件:Top 1 quality 升級 owned + 完成 Self-Concept 整合       │
│    對 Top 2、Top 3 重新做身份測試(內部 Haiku judge、不觸發引擎 2)    │
└──────────────────────────────────────────────────────────────────┘
```

### 設計原則

1. **Pure decision tree**:引擎 3 只做路由、不執行 Build Vision / Mapping Across 等具體技術
2. **5 個子路由器互斥**:同 turn 最多一個 active、嚴格按優先順序判斷
3. **深創傷訊號最高優先**:不能被「特殊開場」分支吞掉
4. **`elicitation_mode_active` 是 turn count 的替代**:引擎 3 擁有此 flag 的切換邏輯
5. **Cascade Down 內部執行、不重新觸發引擎 2**:AI 主動發起身份測試 + Haiku judge,跟引擎 2 master_detector 平行
6. **附錄 A 擴充**:新增 A4(depth_signal_judge)、A5(containment_logic_judge)兩個 Haiku judge instances

---

## 2. Token Budget

### Max simultaneous active state(任一 turn 的真實 token 佔用)

| 元件 | type | tokens | 計入 active? |
|---|---|---|---|
| cached_4_7_router_reference | always_on_cached | ~1400 | ❌(cached prefix、~26% baseline cost) |
| E3_deep_signal_detector | conditional_inject | ~240 | ✅(僅觸發時、最高優先級) |
| E3_opening_branch_router | conditional_inject | ~260 | ✅(僅觸發時、互斥) |
| E3_top1_determination | conditional_inject | ~280 | ✅(僅觸發時、互斥) |
| E3_status_router | conditional_inject | ~220 | ✅(僅觸發時、互斥) |
| E3_cascade_down_validator | conditional_inject | ~250 | ✅(僅觸發時、互斥) |

**Max simultaneous active**(5 個互斥、任一 turn 最多 1 個):**~280 tokens**

### 引擎 1 + 2 + 3 同 turn 最壞情境

理論上限:E1(~270) + E2(~280) + E3(~280)= ~830 tokens(三引擎同 turn 全觸發)

實際情境**互斥概率極高**:
- E3_status_router 觸發 → 通常 E2 也剛完成判決、E1 通常不觸發(已過 cumulative_ppl_score < 0.6)
- E3_opening_branch_router 觸發 → elicitation_mode_active=true、E2 不會有 quality 候選、E1 通常不觸發

→ 穩態 max simultaneous ~280-300、**遠低於 5-6K active state budget**

### Cached prefix 累計

| Cached | tokens | 引擎 |
|---|---|---|
| cached_5_layer_unwrap_reference | ~600 | 引擎 1 |
| cached_4_7_router_reference | ~1400 | 引擎 3 |
| **合計 cached** | **~2000** | (~26% baseline cost ≈ ~520 equivalent active) |

---

## 3. Session State Fields

引擎 3 新增 / 延伸的 session_state 欄位。

### 3.1 router_phase

```yaml
session_state.router_phase:
  range: enum ["opening", "elicitation", "top1_determination", "identity_test_routing", "cascade_down", "deep_signal_handoff", "completed"]
  initial_value: "opening"
  scope: session-scoped(JSONB on sessions table)
  update_rule: |
    - opening → elicitation:特殊開場分支處理完、進入 values 採集
    - elicitation → top1_determination:values 採集達 ≥ 3 個 candidate、進入 Top 1 判定
    - top1_determination → identity_test_routing:Top 1 確定、觸發引擎 2 身份測試
    - identity_test_routing → cascade_down:Top 1 升級 owned + Self-Concept 整合完成
    - cascade_down → completed:Top 2 / Top 3 都通過 / 處理完
    - any → deep_signal_handoff:E3_deep_signal_detector 觸發
    - deep_signal_handoff → 任一(學員選擇 redirect / pause / continue)
  decay_per_turn: 0
  reset_on:
    - new_session_day(可選、預設不 reset、待引擎 4 NLP Amnesia 對齊 forward question 1)
```

### 3.2 values_collected_list

```yaml
session_state.values_collected_list:
  range: list of strings(values 採集到的 candidate)
  initial_value: []
  scope: user-scoped(寫入 user_profile_evolution、跨 session retention)
  update_rule: |
    Damon 鏈式追問過程中、每次學員講出明確 value 詞 → append
    最終目標:3-5 個 ranked values
  decay_per_turn: 0
  reset_on:
    - new_quality_focus_started
    - 永不跨 session reset(user_profile_evolution 範圍)
```

### 3.3 top1_value

```yaml
session_state.top1_value:
  range: string | null
  initial_value: null
  scope: user-scoped
  update_rule: |
    - null → string:E3_top1_determination 完成、Containment Judgment 確定 Top 1
    - string → string(different):罕見、Goal Alignment Test 後重排
  decay_per_turn: 0
  reset_on: 不 reset(跨 session 持續)
```

### 3.4 values_ranking

```yaml
session_state.values_ranking:
  range: list of objects [{value: str, rank: int}]
  initial_value: []
  scope: user-scoped
  update_rule: |
    Top 1 確定後、E3_top1_determination 額外做兩兩 PK 排序、填入 Top 2-5
    格式:[{value: "踏實", rank: 1}, {value: "自由", rank: 2}, ...]
  decay_per_turn: 0
  reset_on: 不 reset
```

### 3.5 cascade_down_progress

```yaml
session_state.cascade_down_progress:
  range: object {value: str, status: str, evidence_count: int}
  initial_value: null
  scope: session-scoped(Cascade Down 過程中追蹤)
  update_rule: |
    對 Top 2 / Top 3 做身份測試時、追蹤當前測試對象 + 狀態
    status: "testing" | "passed" | "failed_need_self_concept" | "completed"
  decay_per_turn: 0
  reset_on:
    - cascade_down_completed
    - new_session_day
```

### 3.6 deep_signal_flags

```yaml
session_state.deep_signal_flags:
  range: object
    {
      worth_fiction_detected: bool,  # 「我不夠好 / 不配 / 沒價值」
      trauma_marker_detected: bool,  # 具體創傷事件描述 + 情緒密度高
      parts_resistance_detected: bool,  # 5 種 resistance 訊號
      depth_judgment_score: 0-3,      # Haiku A4 judge 輸出
      # ⭐ safety patch #23 (Vivi 6/4 sign-off) — 新 4 欄
      passive_dw_detected: bool,            # passive DW 訊號 (per turn reset)
      passive_dw_signal: 'strong'|'implicit', # 命中類型 (per turn reset)
      passive_dw_variant: 'strong'|'implicit'|'repeat'|'freeze', # 變體 C-1/C-2/C-3/C-4
      passive_dw_cross_session_count: int   # mirror of user_profile_evolution
    }
  initial_value: {all false, score 0}
  scope: session-scoped
  update_rule: |
    E3_deep_signal_detector 每 turn 偵測、更新 flags
  decay_per_turn: 0
  reset_on:
    - deep_signal_handoff_resolved
    - new_session_day

# ⭐ safety patch #23 (Vivi 6/4 sign-off) — 新增 user_profile_evolution 欄
user_profile_evolution.passive_death_wish_count:
  range: int
  initial_value: 0
  scope: cross-session (program-scoped)
  update_rule: |
    E3_deep_signal_detector 命中 passive 強訊號 / 隱性 + support / 隱性後學員答 real
    → +1 per turn. 隱性後學員答「字面 / 哲學」 → 仍 +1 (觀察) per Vivi 6/4 折衷.
  decay_per_turn: 0
  reset_on: []  # 永不 reset, 跨 program 累積
  migration: migration/024_passive_death_wish_count.sql

# ⭐ safety patch #23 — A6 transition state (TODO 任務3 替 Crisis Mode SI SOP)
session_state.passive_dw_implicit_pending:
  range: bool
  initial_value: false
  scope: session-scoped
  update_rule: |
    - false → true: C-2 隱性訊號 fired, 等學員下 turn 答 framing.
    - true → false: 下 turn handler 走 implicit_pending classifier 後清.
  reset_on:
    - new_session_day

session_state.si_confirm_pending:
  range: bool
  initial_value: false
  scope: session-scoped
  update_rule: |
    - false → true: C-1 強訊號 / C-2 升級 fired, 等學員下 turn 答 SI 直問.
    - true → false: 下 turn handler 走 si_confirm classifier 後清.
  reset_on:
    - new_session_day

session_state.passive_dw_frozen:
  range: bool
  initial_value: false
  scope: session-scoped
  update_rule: |
    - false → true: C-4 freeze (count >= 5) OR SI confirm = confirm/ambiguous.
                    AI 不再給推進選項、強制 only-(b) + HITL alert Vivi.
  reset_on: []  # 一旦 freeze, 直到 Vivi 1-on-1 後手動清
```

### 3.7 opening_branch_handled

```yaml
session_state.opening_branch_handled:
  range: bool
  initial_value: false
  scope: session-scoped
  update_rule: |
    - false → true:E3_opening_branch_router 第一次觸發處理完
    - true → false:罕見、新 session 開場
  decay_per_turn: 0
  reset_on:
    - new_session_day
```

### 3.8 elicitation_mode_active(從引擎 2 接管切換邏輯)

> **重要變更**:引擎 2 §3.6 定義此欄位、但「由 4.7 中央路由器決定」的切換邏輯本檔接管。

```yaml
session_state.elicitation_mode_active:
  range: bool
  initial_value: true(session 開場預設採集模式)
  scope: session-scoped
  ownership: 引擎 3 擁有切換邏輯
  update_rule: |
    - true → false:同時滿足以下三條
      (a) values_collected_list >= 3
      (b) Goal Alignment Test 已執行(學員確認 / 改目標)
      (c) 進入 E3_top1_determination 階段(router_phase 切換)
    - false → true:罕見、跨天回退到採集(學員講出全新 quality candidate)
  reset_on:
    - new_session_day(可選、視 retention 策略;待引擎 4 對齊 forward question 1)
```

---

## 4. 元件 spec

### 4.1 cached_4_7_router_reference(cached prefix)

```yaml
- id: cached_4_7_router_reference
  type: always_on_cached
  cached_tokens: ~1400
  purpose: |
    4.7 中央路由器藍圖 + Top 1 判定 SOP + Cascade Down SOP +
    Re-imprinting 訊號清單 + Parts Integration 切換條件 + 開場 reframe 範本。
    永久 cached、被所有 E3 子路由器引用、~26% baseline cost。
  
  reference_id: "ROUTER_4_7"
  
  damon_alignment:
    - "4.7 章節整體藍圖(Challenge 7 驗證後完整版)"
    - "3.4 章節 Containment Judgment / 存在依賴測試"
    - "5.3 章節 Re-imprinting 11 步驟流程"
    - "4.3-4.6 章節 5 種 resistance + 5 種破解技術"
  
  content: |
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    【4.7 中央路由器藍圖】
    
    AI app 永遠的單一入口:Values Elicitation
    
    完整 session flow:
    
    [客戶開場] → [Values Elicitation 起手式]
    → [鏈式追問 What will that do for you?]
    → [拿到 3-5 個排序 values]
    → [Goal Alignment Test:「原本目標真能帶你到這裡嗎?」]
    → [🔀 身份測試 = 中央路由器]
        ├ 通過(owned) → 走 4 步驟改變法(Step 2 Build Vision → Step 3 → Step 4)
        └ 失敗(ambiguous / no) → 走 Self-Concept 模型
              ↓
              ⚠️ 只對 Top 1(包含性最大)做完整流程
              ↓
              [Top 1 完成] → [🔁 Cascade Down 驗證]
                  └ 對 Top 2 / Top 3 做身份測試
                      ├ 通過 → Cascade 成功
                      └ 失敗 → 對該 value 啟動新一輪
    
    過程中:
    - 遇阻力 → 臨時叫 Parts Integration
    - 遇深層創傷 → 切換 Re-imprinting(v5.0 MVP 偵測 + 路由、不執行)
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    【Top 1 判定:Containment Judgment / 存在依賴測試】
    
    Top 1 ≠「最先想到的」、≠「客戶說最重要的」
    Top 1 = **包含性最大的 value**(其他 values 必須依附它才能存在)
    
    存在依賴測試 SOP:
    
    Step 1 — 兩兩 PK:
    > 「在『[value A]』跟『[value B]』之間,如果只能保留一個,你選哪個?」
    
    Step 2 — 存在依賴提問:
    > 「沒有[輸的 value],[贏的 value] 還能存在嗎?」
    > 「沒有[贏的 value],[輸的 value] 還能存在嗎?」
    
    Step 3 — Linear Thinking Error 檢測:
    若學員回答「我必須先 X 才能 Y」/「沒有 X 就不可能 Y」:
    → 不是依存關係、是線性思考錯誤
    → AI 必須切換到 Containment Judgment 邏輯:
    > 「先後順序跟包含性不一樣。
    >  我問的是:這兩個哪個包含另一個?
    >  例如:『自由』裡面有沒有可能包含『安全感』?
    >  反過來『安全感』裡面有『自由』嗎?」
    
    Step 4 — 涵蓋判斷:
    通過存在依賴的 value 為候選 Top 1
    若多個 values 通過:對它們再做存在依賴 PK
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    【Cascade Down 驗證 SOP】
    
    觸發時機:
    - Top 1 quality 升級 owned + Self-Concept 整合完成(Mapping Across / Scope Overlap 完成)
    
    執行步驟:
    
    Step 1 — 對 Top 2 做身份測試:
    > AI 主動發起:「Are you a [Top 2 quality] person?」
    > 中文:「你是一個[Top 2 quality]的人嗎?」
    
    Step 2 — Haiku judge(A5.containment_logic_judge 或 A1.sensory_detail)評估:
    - 學員快速答 Yes + 有 sensory detail → 通過
    - 學員猶豫 / 「有時是」/ 無 evidence → 失敗
    
    Step 3 — 路由:
    - 通過 → 進 Top 3 測試(同流程)
    - 失敗 → 對 Top 2 啟動新一輪 Self-Concept 模型(路由到 Checkpoint 1 21 天 phase)
    
    Step 4 — 全部 Top 2-3 處理完:
    - router_phase = "completed"
    - 進入 takeaway 種下 + Future Pacing(引擎 4 範圍)
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    【Re-imprinting 訊號清單(MVP 偵測 + 路由、不執行)】
    
    觸發訊號(任一強訊號 + 1 個支持訊號即觸發):
    
    強訊號:
    - 具體創傷事件描述(童年虐待 / 失去親人 / 重大背叛 / 暴力 / 性創傷)
    - 「我不配 / 我不夠好 / 我沒價值」(self-worth fiction、且深度判斷 score >= 2)
    - 強烈情緒突發(哭泣、憤怒、解離)
    
    支持訊號:
    - 反覆觸及同一童年事件
    - 對應 Damon「身體裡有強烈無法講理的物理感覺」
    - Parts Integration 嘗試 3 次無效
    
    處理(v5.0 MVP):
    1. 不在 AI 內執行 Re-imprinting 11 步驟流程
    2. cascade 到附錄 A3.handoff_escalation
    3. 引導到「跟 Vivi 預約 1-on-1」/「下次再深入這個」/「先回到日常 Future Pacing」
    4. 觸發 failure_signal_alert(這個學員需要 human 教練 backup)
    
    完整 Re-imprinting 11 步驟流程(Damon 體系、AI 不執行、僅參考):
    1. 定位與抽離
    2. 辨識年幼自己的缺失資源
    3. 在成年身體中提取資源
    4. 結合並傳遞資源給自己
    5. 處理接收阻力
    6. 理解加害者
    7. 辨識加害者的缺失資源
    8. 傳遞資源給加害者
    9. 觀察場景的自動重構
    10. 帶著資源長大
    11. Future Pacing
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    【Parts Integration 切換條件(5 種 Resistance 識別)】
    
    Damon 5 種 Resistance 類型 + 對應破解技術(機動工具箱、不是僵化對應):
    
    1. **害怕失敗 / 害怕失望**
       訊號:「萬一我做不到怎麼辦」/「我之前試過都失敗」
       破解:**Spectrum Reframe(光譜重構)**
       話術:「如果你餘生都朝這個方向前進、每靠近一步都更 X、你會對此感到平靜嗎?」
    
    2. **害怕成功代價**(成功會帶來負面特質)
       訊號:「我成功了會變得不像我」/「成功會讓我變傲慢」
       破解:**Compatibility Check(邏輯包容測試)**
       話術:「成功跟[害怕變成的特質]可以一起運作嗎?是不是越成功越能[正向特質]?」
    
    3. **生態破壞 / 害怕讓人失望**
       訊號:「我成功會讓家人不開心」/「我朋友會覺得我變了」
       破解:**Accepting Cost in Advance(提前接受代價)**
       話術:「這些代價真實存在。你有意識地選擇承擔嗎?」
    
    4. **害怕未知 / 失控 / 不信任**
       訊號:「我不知道會發生什麼」/「我不敢」
       破解:**As-If Frame(實驗框架)**
       話術:「我們做個實驗、如果不行、我們把它們再分開。」
    
    5. **創傷印記 / 自我價值低落**
       訊號:「我就是不配」/「我就是個廢物」
       破解:**Re-imprinting**(MVP 路由到 handoff_escalation、不執行)
    
    切換 Parts Integration 4 步驟條件:
    - 偵測到 1-4 任一 resistance 訊號
    - cumulative_resistance_score >= 0.5(A2.cumulative_score 模板新 instance)
    - 上一 turn AI 提問被學員「我不知道 / 我不敢 / 我不行」這類 part-resistance 回應
    
    執行(v5.0 MVP):
    - 引擎 3 偵測 + 路由到 Checkpoint 1 21 天 Phase 4 反例整合模組
    - 不在引擎 3 內執行 4 步驟 Parts Integration
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    【特殊開場分支 reframe 範本】
    
    ⚠️ 僅 elicitation_mode_active == true + opening_branch_handled == false 時觸發
    
    分支 A — Curiosity Reframe(「我卡住了 / 不知道我要什麼」)
    
    觸發詞:「卡住」/「不知道」/「沒方向」/「混亂」
    
    Damon 原話:「If you don't know what you want, then what you want is to find out what you want.」
    
    中文話術:
    > 「OK。
    > 你不知道你想要什麼——
    > 那就把『**想要知道**』當成你今天想要的第一件事、可以嗎?
    > 從這裡我們有得挖。」
    
    Damon 邏輯:不知道 → 想知道 = 已經有 want
    
    分支 B — 強制翻轉(「我老是搞砸 X」/「我總是 Y」)
    
    觸發詞:「老是」/「總是」/「永遠都」+ 負面動詞(搞砸 / 失敗 / 卡)
    
    話術:
    > 「停一下。
    > 你說『老是搞砸[X]』——
    > 我現在不問你『為什麼搞砸』。
    > 我問:**你想要的是什麼?**——
    > 不是『不要搞砸』、是你**真正想要**的東西、用正向的話講。」
    
    禁止:不問 Why(Damon 禁區)、不順著「為什麼搞砸」追問
    
    分支 C — 深度判斷(「我不夠好 / 不配 / 沒價值」)
    
    觸發詞:「不夠好」/「不配」/「沒價值」/「沒用」+ 第一人稱身份句
    
    處理:
    1. 呼叫 A4.depth_signal_judge(Haiku 4.5)評估深度
    2. depth_judgment_score 0-1 → 淺(走標準 values elicitation 流程)
       話術:「我聽到你說『不夠好』。
            先放一下這個。我先問:你想要什麼?」
       (跟分支 B 邏輯相同、強制翻轉到正向)
    3. depth_judgment_score 2-3 → 深(cascade 到 E3_deep_signal_detector)
       不在 E3_opening_branch_router 內處理、路由出去
```

---

### 4.2 E3_deep_signal_detector(Layer 1 — 最高優先級)

```yaml
- id: E3_deep_signal_detector
  type: conditional_inject
  layer: 1
  priority: HIGHEST(任一其他 E3 子路由器之前判斷)
  active_state_tokens: ~240
  
  inputs_from_profile:
    - session_state.last_user_response
    - session_state.deep_signal_flags
    - session_state.cumulative_ppl_score
    - session_state.consecutive_short_responses
    - anchors_top3
  
  outputs_to_profile:
    session_state.deep_signal_flags:
      worth_fiction_detected: bool
      trauma_marker_detected: bool
      parts_resistance_detected: bool
      depth_judgment_score: 0-3 (from A4)
    session_state.router_phase: "deep_signal_handoff" (if triggered)
    session_state.handoff_triggered_count: +1
  
  damon_source:
    - "5.3 Re-imprinting 完整實戰手冊(觸發訊號 = AI 應該觸發 handoff 的時機)"
    - "5.6.2 caveat:對抗型 / 創傷型客戶必須有退場機制 / 轉介人類教練"
    - "方法論 6.1 v5.0 MVP 範圍:Re-imprinting 不做"
  
  trigger_conditions:
    強訊號(任一即觸發):
      - regex 命中具體創傷詞:"(虐待|遺棄|背叛|被打|被罵|霸凌|性侵|猥褻|暴力|親人過世|自殺|上吊)"
        # ⭐ safety patch #23 (Vivi 6/4): +上吊
      - A4.depth_signal_judge score >= 2(self-worth fiction 深度)
      - 強烈情緒突發 regex:"(哭|崩潰|受不了|喘不過氣|無法呼吸|腦袋空白|手抖)"
      # ⭐ safety patch #23 (Vivi 6/4 sign-off) — 新 passive DW 強訊號
      - PASSIVE_STRONG_REGEX:"(不想活|不想活下去|不想再活|不想繼續活|想結束生命|想離開這世界|希望.{0,5}死|希望.{0,5}離世|希望.{0,5}死亡|希望.{0,8}生病.{0,8}死|希望.{0,5}快點走|不會傷害自己.{0,5}希望)"
        # 命中 → variant C-1 (SI confirm) 或 C-3/C-4 if count >= 3/5
    
    支持訊號(配合強訊號加權):
      - 反覆觸及同一童年事件(同一時間 marker 出現 ≥ 3 次跨 turn)
      - 「身體裡很(緊 / 痛 / 沉 / 重 / 壓)」+ 無法描述具體事件
      - Parts Integration 訊號(see resistance signals 清單)觸發 ≥ 3 次無進展
      # ⭐ safety patch #23 (Vivi 6/4 sign-off) — 新 passive 隱性 + life signal 共現
      - PASSIVE_IMPLICIT_REGEX:"(上天.{0,5}讓我活著|上天.{0,5}留我|沒有什麼可留戀|此生.{0,5}無憾|此生.{0,5}無所眷念|此生.{0,5}已.{0,5}夠了|此生.{0,5}已活夠|每活一天.{0,5}就是多活一天|沒有人.{0,5}牽掛|無所眷念|我.{0,5}沒有.{0,5}想做的)"
        + SURFACE_LIFE_SIGNAL_REGEX:"(活下去|還想.{0,5}做|動力|意義|有想.{0,3}的|想完成|留下|留住|想活|還活)" 同 session last_3_turns 共現
        → variant C-2 (字面 vs 感受). 單獨命中 (無 support) 不 trigger handoff,
          視為純哲學表述 (區分由 last_3_turns 內 SURFACE_LIFE_SIGNAL 是否共現決定).
  
  # ⭐ safety patch #23 — 話術變體 C (Vivi 6/4 patch 原檔, verbatim 已 ship 在
  # lib/prompt-sections/conditional/engine-3/deep-signal-detector.js
  # prompt_content_passive_dw_{strong,implicit,implicit_philosophical,repeat,freeze}).
  # 行為流:
  #   1. 強訊號 → C-1 (承認 + 直問 SI). patch si_confirm_pending=true.
  #      下 turn handler classifyStudentSIResponse(text):
  #        deny → SI_DENY_INJECT (標準三選一 + 1925)
  #        confirm / ambiguous (bias safety) → SI_CONFIRM_INJECT (only-(b) + HITL + freeze)
  #   2. 隱性 + life signal → C-2 (區分字面 vs 感受). patch passive_dw_implicit_pending=true.
  #      下 turn handler classifyImplicitFraming(text):
  #        philosophical (字面 / 哲學) → C-2 light 1925 path (Vivi 6/4 折衷).
  #          不開三選一. count 不再 +1 (已 +1 from C-2 fire). dashboard 算 false positive.
  #        real (真的不想活) → escalate to C-1 (set si_confirm_pending, count++).
  #        ambiguous → bias safety → escalate to C-1.
  #   3. count >= 3 → C-3 (移除三選一 (c) 選項).
  #   4. count >= 5 → C-4 freeze (強制 only-(b) + HITL alert Vivi + AI 凍結推進).
  
  prompt_content: |
    [SYSTEM INJECT — Deep Signal Detected]
    
    偵測到深創傷 / 深層 worth-fiction 訊號。
    本 turn 不執行 values elicitation / 身份測試 / Self-Concept——
    執行 handoff_escalation(附錄 A3)、把判斷權交回學員。
    
    **必須做**(三段式):
    
    1. **承認 + 不分析**(降低學員 break rapport 風險):
       話術變體 A — trauma marker:
       > 「我聽到你說『[creating quote]』。
       > 這聽起來很重——
       > 我想停一下,不繼續追問。」
       
       話術變體 B — worth fiction(depth_judgment_score 2-3):
       > 「『[不夠好 / 不配 / 沒價值]』——
       > 這個感覺很真實、我聽到了。
       > 我想停一下,不繼續往下挖。」
    
    2. **handoff_escalation(附錄 A3)**:
       (三選一)
       > 「你現在比較想要:
       > (a)先停在這、不繼續挖、我們改聊輕一點的
       > (b)我幫你預約跟 Vivi 1-on-1、有個真人陪你走這段
       > (c)我們先回到日常、Future Pacing、過陣子再回來看
       > 你選哪個都可以——我不繼續推進。」
    
    3. **觸發 failure_signal_alert**:
       - 寫入 session_state.handoff_triggered_count: +1
       - 對應方法論 6.10 失敗訊號(本檔附錄外處理)
       - 標註此學員需要 human 教練 backup
    
    **禁止**:
    - 不可詢問創傷事件細節(會強化記憶、可能引發更深崩潰)
    - 不可進行 Re-imprinting 任一步驟(v5.0 MVP 範圍外)
    - 不可說「我們一起面對」/「我陪你走」(AI 過度承諾)
    - 不可繼續身份測試 / values elicitation 推進
  
  variable_filling_method: |
    Patrick 工程把 last_user_response 餵 prompt context、
    主 LLM 自填 [creating quote](學員原話片段)、[不夠好 / 不配 / 沒價值]
    (學員實際用的詞)。
  
  failure_modes:
    - id: H1
      mode: "深訊號誤判:學員講「我家人都死了」是事實陳述、不是深創傷觸發"
      mitigation: |
        強訊號 + 支持訊號雙重判斷——單純事實陳述通常無支持訊號(無情緒詞 + 無反覆觸及)。
        若仍誤判:handoff_escalation 三選一裡(a)選項「不繼續挖」對事實陳述也合適。
    - id: H2
      mode: "學員選 (c) 回到日常後、下一 turn 又冒出深訊號"
      mitigation: |
        E3_deep_signal_detector 每 turn 都會偵測、再次觸發 handoff。
        若連續 3 turn 觸發:強制改成只剩(b)1-on-1 預約選項。
    - id: H3
      mode: "亞洲學員不善表達情緒、深訊號偵測 recall 過低"
      mitigation: |
        Beta 階段監控訊號:depth_signal_flags 觸發率 < 5% session 是預期、
        但若 < 1% 可能 recall 太低、需要降低 depth_judgment_score 閾值。
        Forward reference: v5_beta_failure_signals_dashboard.md
    # ⭐ safety patch #23 (Vivi 6/4 sign-off) — H4 / H5 passive DW 失敗模式
    - id: H4
      mode: "Passive death wish 隱性訊號誤判(『此生無憾』可能是疲憊隱喻、不是 ideation)"
      例: "「我覺得我這輩子也夠了、好累」(完成感而非 passive ideation)"
      mitigation: |
        隱性訊號設計是「+ 配合至少一個支持訊號才觸發」(PASSIVE_IMPLICIT_REGEX
        + SURFACE_LIFE_SIGNAL_REGEX 同 session last_3_turns 共現).
        若仍誤判:變體 C-2 先 ask 學員確認字面 vs 感受、給糾正空間.
        學員確認「哲學 / 疲憊隱喻」(Vivi 2026-06-04 折衷裁決):
        → 不開三選一 handoff、但輕量提 1925 一句 + passive_death_wish_count 仍 +1(觀察)
        → 連續 3 次「哲學表述」、dashboard 標 caution(可能漏判)
      beta_monitoring:
        - 隱性訊號 false positive rate < 30%(學員糾正為哲學表述的比率)
        - 若 >= 30%:regex 過敏感、Beta 校準收緊
        - tracker: lib/dashboard/passive-death-wish-tracker.js computeFalsePositiveRate
    - id: H5
      mode: "Day 1 / 早期 session 漏接 passive 訊號、後續 session 才接(A006 真實 case)"
      例: "A006-D1「上天既然讓我活著」AI 短暫 probe 後繼續挖、Day 2 才 surface 直白 SI"
      mitigation: |
        隱性訊號 regex (PASSIVE_IMPLICIT_REGEX) + life signal 共現設計處理此事.
        若 Beta 仍發生:
        - 引擎 1 sensitivity 不足、漏抓 passive 訊號上游
        - dashboard `passive_death_wish_recall_rate` 監控
        - 若 recall < 70%:regex 擴充、HITL alert
      beta_monitoring:
        - Day 1 detected rate vs Day 2+ rate(Day 1 較低 = 漏抓)
        - target: 漏抓 = 0(理想)、Beta < 10% acceptable
        - > 15% → regex sensitivity audit
        - tracker: lib/dashboard/passive-death-wish-tracker.js computeDay1MissRate
```

---

### 4.3 E3_opening_branch_router(Layer 2 — 特殊開場分支)

```yaml
- id: E3_opening_branch_router
  type: conditional_inject
  layer: 2
  active_state_tokens: ~260
  
  trigger_conditions:
    - session_state.elicitation_mode_active == true
    - session_state.opening_branch_handled == false
    - 任一觸發詞命中(見 prompt_content)
    - E3_deep_signal_detector 未觸發(優先級已過)
  
  inputs_from_profile:
    - session_state.last_user_response
    - session_state.opening_branch_handled
    - session_state.deep_signal_flags.depth_judgment_score   # 分支 C 用
  
  outputs_to_profile:
    session_state.opening_branch_handled: true (after handling)
    session_state.router_phase: "elicitation" (after reframe)
    session_state.elicitation_mode_active: stays true
  
  damon_source:
    - "4.7 章節特殊情境分支(完整 3 分支處理)"
    - "Damon Curiosity as Resource:『If you don't know what you want, then what you want is to find out what you want.』"
    - "Damon Why 禁區:不問為什麼 / 強制翻轉成 What"
  
  prompt_content: |
    [SYSTEM INJECT — Opening Branch Router]
    
    偵測到特殊開場觸發詞、執行 reframe 後進入標準 values elicitation。
    
    Reference:cached_4_7_router_reference 內【特殊開場分支 reframe 範本】完整話術。
    
    **分支選擇邏輯**:
    
    若命中「卡住 / 不知道 / 沒方向 / 混亂」→ **分支 A:Curiosity Reframe**
    若命中「老是 / 總是 / 永遠都」+ 負面動詞 → **分支 B:強制翻轉**
    若命中「不夠好 / 不配 / 沒價值 / 沒用」→ **分支 C:深度判斷**
      → 呼叫附錄 A4.depth_signal_judge 評估
      → score 0-1:本 inject 繼續、走分支 C(淺、翻轉成正向)
      → score 2-3:重新路由到 E3_deep_signal_detector(優先級更高、本 inject 終止)
    
    **執行話術**:
    從 cached reference 取對應分支話術骨架、填入學員原話。
    
    **後續動作**:
    - opening_branch_handled = true
    - 下一 turn 進入標準 Damon 鏈式追問(values elicitation)
    - 同一 session 不再觸發本 inject(除非 new_session_day reset)
    
    **禁止**:
    - 不問 Why(Damon 禁區、強制翻轉成 What)
    - 不假設學員必須翻轉(若學員拒絕、cascade 到附錄 A3.handoff_escalation)
    - 不對「不夠好」全部走分支 C——必須先 depth 判斷
  
  variable_filling_method: |
    從 last_user_response 抓觸發詞 + 學員原話片段、主 LLM 自填到話術骨架。
  
  failure_modes:
    - id: H4
      mode: "學員拒絕 Curiosity Reframe、堅持『我就是真的不知道、不想想了』"
      mitigation: |
        cascade 到附錄 A3.handoff_escalation(三選一:
        (a)先聊輕的(b)預約 Vivi(c)Future Pacing)
        不強推、保留學員退場權。
    - id: H5
      mode: "分支 B 強制翻轉、學員堅持「我就是想知道為什麼搞砸」"
      mitigation: |
        Damon Why 禁區是核心規則、不可破例。
        話術升級:「我理解你想知道原因。
                  但『為什麼』不會帶你到你想去的地方。
                  我先問:**你想去哪?** 知道方向、原因會自己浮現。」
    - id: H6
      mode: "opening_branch_handled = true 後、學員下一 turn 又講『我又卡住了』"
      mitigation: |
        opening_branch_handled 不在 session 內 reset、
        但這時應路由到 E1b vague(引擎 1)、不重新走特殊開場。
        (學員 mid-session 講「卡住」= 對話偏離、不是 opening 訊號)
```

---

### 4.4 E3_top1_determination(Layer 3 — Top 1 判定)

```yaml
- id: E3_top1_determination
  type: conditional_inject
  layer: 3
  active_state_tokens: ~280
  
  trigger_conditions:
    - session_state.values_collected_list.length >= 3
    - session_state.top1_value == null
    - session_state.router_phase in ["elicitation", "top1_determination"]
    - E3_deep_signal_detector / E3_opening_branch_router 未觸發
  
  inputs_from_profile:
    - session_state.values_collected_list
    - session_state.last_user_response
    - session_state.elicitation_mode_active
    - anchors_top3
  
  outputs_to_profile:
    session_state.top1_value: str (after Containment Judgment passed)
    session_state.values_ranking: list (Top 1-5 排序)
    session_state.router_phase: "identity_test_routing" (after Top 1 確定)
    session_state.elicitation_mode_active: false (切換時機)
  
  damon_source:
    - "3.4 Containment Judgment / 存在依賴測試"
    - "3.4 Linear Thinking Error / 線性思考錯誤偵測"
    - "Damon Hierarchy of Values 2 大鐵律:不離開特定情境 / 找最大涵蓋類別、不排線性順序"
    - "Damon Goal Alignment Test:挖完 values 後問『原本目標真能帶你到這裡嗎?』"
  
  prompt_content: |
    [SYSTEM INJECT — Top 1 Determination]
    
    Values 採集達 3+ 個 candidate。執行 Top 1 判定:
    Containment Judgment(包含性判斷)+ 存在依賴測試、不是線性排序。
    
    Reference:cached_4_7_router_reference 內【Top 1 判定 SOP】完整流程。
    
    **執行步驟**:
    
    Step 1 — Goal Alignment Test(若還沒做):
    若 router_phase == "elicitation" 第一次進入本 inject:
    > 「先停一下。
    > 你現在知道你的 values:[列 values_collected_list]。
    > 回頭看你原本想要的目標——
    > **這個目標真的能帶你到『[values 摘要]』這裡嗎?**」
    
    根據學員回應:
    - 確認原目標仍對齊 → 進 Step 2
    - 改目標 → 收 new goal、可能要回 values elicitation 重排(罕見)
    
    Step 2 — 兩兩 PK:
    若 values_collected_list 有 N 個、執行 N-1 次兩兩 PK:
    > 「在『[value A]』跟『[value B]』之間、
    > 如果只能保留一個、你選哪個?」
    
    Step 3 — 存在依賴提問(對 PK 贏家做):
    > 「沒有『[輸的 value]』,『[贏的 value]』還能存在嗎?」
    > 「沒有『[贏的 value]』,『[輸的 value]』還能存在嗎?」
    
    Step 4 — Linear Thinking Error 偵測:
    若學員回答出現「必須先 X 才能 Y」/「沒有 X 就不可能 Y」:
    → Linear Thinking Error、切換到 Containment 邏輯:
    > 「先後順序跟包含性不一樣。
    > 我問的是:這兩個哪個**包含**另一個?
    > 例如:『[value A]』裡面有沒有可能**包含**『[value B]』?
    > 反過來『[value B]』裡面有『[value A]』嗎?」
    
    Step 5 — Haiku judge(A5.containment_logic_judge)評估:
    Haiku 4.5 tool_call 評估學員回應的存在依賴判斷合理性。
    
    Step 6 — Top 1 確定:
    通過存在依賴的 value(包含性最大、其他依附它存在)= Top 1
    若多個通過:對通過者再做存在依賴 PK
    
    Step 7 — values_ranking 填入 Top 2-5:
    對其他 values 做兩兩 PK(不再做存在依賴測試)、填 rank 2-5
    
    Step 8 — 路由 handoff:
    - top1_value 寫入
    - router_phase = "identity_test_routing"
    - elicitation_mode_active = false
    - 觸發引擎 2 master_detector 對 top1_value 做身份測試
    
    **禁止**:
    - 不用「最重要」「最先想到」這類措辭(Damon 反對線性排序)
    - 不接受學員直接說「我覺得 X 最重要」、必須走存在依賴測試
    - 不在學員出現 Linear Thinking Error 時順著走、必須切換 Containment 邏輯
  
  variable_filling_method: |
    主 LLM 從 values_collected_list 抓 value 詞、填入兩兩 PK / 存在依賴提問。
    Haiku A5 judgment 結果決定通過 / 不通過、不需主 LLM 判斷。
  
  failure_modes:
    - id: H7
      mode: "學員 Linear Thinking Error 連續 2 次無法切換到 Containment 邏輯"
      mitigation: |
        cascade 到附錄 A3.handoff_escalation 變體:
        「我們在排序上卡住。我想問你:
        (a)我幫你選一個我覺得最大涵蓋的、你看 ok 不 ok
        (b)我們先往下走、Top 1 之後再回來確認排序」
    - id: H8
      mode: "Goal Alignment Test 學員改目標、values 排序需要重做"
      mitigation: |
        若新目標跟舊 values 對應度高(Haiku judge):continue Step 2
        若新目標跟舊 values 對應度低(< 50%):router_phase 退回 "elicitation"、
        重新採集 values(罕見、但合法)
    - id: H9
      mode: "Top 1 確定後、學員下一 turn 反悔『我覺得 X 才應該是 Top 1』"
      mitigation: |
        允許反悔一次:重新做 Top 1 vs X 的存在依賴測試。
        反悔 2 次以上:cascade 到 A3.handoff_escalation
        (Top 1 不穩定 = 可能還沒挖到真實 values 層)
```

---

### 4.5 E3_status_router(Layer 4 — 主路由 4 條路徑)

```yaml
- id: E3_status_router
  type: conditional_inject
  layer: 4
  active_state_tokens: ~220
  
  trigger_conditions:
    - session_state.router_phase == "identity_test_routing"
    - 引擎 2 已輸出 current_quality_status(非 "none")
    - E3_deep_signal_detector / E3_opening_branch_router / E3_top1_determination 未觸發
  
  inputs_from_profile:
    - session_state.current_quality_status  # ⭐ 引擎 2 輸出
    - session_state.current_quality_candidate_term
    - session_state.top1_value
    - session_state.quality_focus_history
    - session_state.router_phase
  
  outputs_to_profile:
    session_state.router_phase: per routing decision
    session_state.next_action: enum ["build_vision", "self_concept_model", "continue_evidence", "values_elicitation"]
    handoff_target_module: str(給 Checkpoint 1 / 引擎 4 知道路由到哪)
  
  damon_source:
    - "4.7 中央路由器主路徑(身份測試後分流)"
    - "Damon: 4 步驟改變法 vs Self-Concept 模型分流邏輯"
  
  prompt_content: |
    [SYSTEM INJECT — Quality Status Router]
    
    讀取引擎 2 輸出 current_quality_status、執行 4 條路由。
    本 inject 不執行被路由到的目的地內容、僅做 handoff + AI 過渡話術。
    
    **路由邏輯**:
    
    若 current_quality_status == "owned":
    → **路由到 Build Vision**(4 步驟改變法 Step 2)
    
    AI 過渡話術:
    > 「『[current_quality_candidate_term]』——這是你的。
    > 接下來、想像你面前有一個空白的畫布、
    > 把『[current_quality_candidate_term]』放進去:它看起來像什麼?」
    
    寫入 next_action = "build_vision"
    handoff_target_module = "Checkpoint_1_Phase_2_BuildVision"
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    若 current_quality_status == "ambiguous":
    → **路由到 Self-Concept 模型**(Mapping Across / Scope Overlap)
    
    AI 過渡話術:
    > 「你說『[current_quality_candidate_term]』『有時是、有時不是』——
    > 我們先把這個放著、不強迫它變成『完全是』。
    > 從你**確定是**的另一個 quality 出發、回頭看這個。
    > [準備引擎 4 主動引用 + Checkpoint 1 Phase 2-3 啟動]」
    
    寫入 next_action = "self_concept_model"
    handoff_target_module = "Checkpoint_1_Phase_2_3_ScopeOverlap"
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    若 current_quality_status == "candidate":
    → **繼續挖 evidence**(引擎 2 stay 路徑、不離開引擎 3 範圍)
    
    AI 過渡話術:不需要——引擎 2 E2_stay_candidate 已處理。
    本 inject 僅確認 router_phase 維持、不主動發話。
    
    寫入 next_action = "continue_evidence"
    
    ━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    若 current_quality_status == "none":
    → **繼續 values elicitation**(回 Damon 鏈式追問)
    
    AI 過渡話術:不主動發話——讓主對話 LLM 自然續接鏈式追問。
    
    寫入 next_action = "values_elicitation"
    router_phase 退回 "elicitation"
    
    **禁止**:
    - 不執行被路由到的目的地內容(僅 handoff)
    - 不在過渡話術裡描述「接下來會發生什麼」(會破壞學員體驗、不是 Damon 風格)
  
  variable_filling_method: |
    從 inputs 自填 current_quality_candidate_term 進過渡話術。
  
  failure_modes:
    - id: H10
      mode: "引擎 2 輸出與引擎 3 路由邏輯衝突(例:status='owned' 但 top1_value 還沒確定)"
      mitigation: |
        前置檢查:若 top1_value == null + status == 'owned':
        → 路由回 E3_top1_determination(必須先確定 Top 1 才能進 Build Vision)
        這是 cross-engine consistency check、Patrick 工程實作時加 guard。
```

---

### 4.6 E3_cascade_down_validator(Layer 5 — Cascade Down)

```yaml
- id: E3_cascade_down_validator
  type: conditional_inject
  layer: 5
  active_state_tokens: ~250
  
  trigger_conditions:
    - session_state.router_phase == "cascade_down"
    - session_state.top1_value 已升級 owned
    - Self-Concept 整合完成(由 Checkpoint 1 模組標記 self_concept_integration_completed = true)
    - values_ranking 內有 Top 2 / Top 3(不只 Top 1)
  
  inputs_from_profile:
    - session_state.top1_value
    - session_state.values_ranking
    - session_state.cascade_down_progress
    - session_state.quality_focus_history
  
  outputs_to_profile:
    session_state.cascade_down_progress: per state machine
    session_state.router_phase: "completed" (after all Top 2-3 處理完)
    session_state.values_ranking[i].quality_status: per individual test
  
  damon_source:
    - "4.7 章節 Cascade Down 驗證"
    - "Damon: 對 Top 2 / Top 3 做身份測試、通過 → cascade 成功、失敗 → 新一輪 Self-Concept"
  
  prompt_content: |
    [SYSTEM INJECT — Cascade Down Validator]
    
    Top 1「[top1_value]」已 owned + Self-Concept 整合完成。
    執行 Cascade Down:對 Top 2、Top 3 重新做身份測試。
    
    Reference:cached_4_7_router_reference 內【Cascade Down 驗證 SOP】完整流程。
    
    **執行邏輯**(state machine):
    
    讀 cascade_down_progress.status:
    
    若 status == null(首次進入):
    → 設 progress.value = values_ranking[1].value(Top 2)
    → progress.status = "testing"
    → AI 主動發起身份測試:
    > 「現在『[top1_value]』是你了。
    > 我們看看『[Top 2 value]』:
    > **你是一個[Top 2 value]的人嗎?**」
    
    若 status == "testing":
    → 學員回應後、呼叫 A1.sensory_detail judgment 評估
    → score >= 2 → status = "passed",更新 values_ranking[Top 2].quality_status = "owned"
    → score < 2 → status = "failed_need_self_concept"、cascade 到 Checkpoint 1 Phase 2-3
    
    若 status == "passed":
    → 換 Top 3(若有):progress.value = Top 3、status = "testing"、重複
    → 若沒有 Top 3:status = "completed"、router_phase = "completed"
    
    若 status == "failed_need_self_concept":
    → handoff 到 Checkpoint 1 Phase 2-3 Self-Concept 模型(對該 value 新一輪整合)
    → Self-Concept 完成後回到本 inject、重新測試該 value
    
    若 status == "completed":
    → router_phase = "completed"
    → 觸發 takeaway 種下 + Future Pacing(引擎 4 範圍)
    
    **特殊處理**:
    
    Top 2 / Top 3 身份測試通過、但學員講「有時是」(ambiguous-like 回應):
    - 仍視為 Cascade 成功(因 Top 1 已 owned、cascade 邏輯傳遞)
    - 但寫入 values_ranking[i].quality_status = "owned_via_cascade"(標記、非完整 owned)
    - 若學員下次 session 重講「有時是」、回頭做新一輪 Self-Concept
    
    **禁止**:
    - 不對 Top 2 / Top 3 做完整 Self-Concept 流程除非身份測試失敗(浪費時間 + 違反 Damon 原則)
    - 不省略 Top 2 / Top 3 測試直接結案(這是 Cascade Down 的核心驗證、不能跳)
  
  variable_filling_method: |
    從 inputs 自填 top1_value / Top 2 value / Top 3 value 進話術。
  
  failure_modes:
    - id: H11
      mode: "Top 2 測試失敗 → 進 Self-Concept 模型 → 又失敗 → 無限循環"
      mitigation: |
        cascade_down_progress 加 retry_count 欄位:
        - 對同一 value 最多 retry 2 次
        - retry >= 2 仍失敗 → 標 quality_status = "stuck_ambiguous"、跳過此 value
        - 觸發 failure_signal_alert
    - id: H12
      mode: "values_ranking 只有 1 個 value(Top 1 = 唯一 value)、無 Top 2-3 可測"
      mitigation: |
        罕見、但合法。
        cascade_down_progress 直接 status = "completed"、router_phase = "completed"。
        記錄 takeaway:「『[top1_value]』是你的全部」(學員可能很 focused)。
```

---

## 5. 附錄 A 新增機制

> **延續引擎 1 附錄 A 雙方合約**。引擎 3 新增 2 個 Haiku judge instances。

### A4. depth_signal_judge

```yaml
depth_signal_judge:
  purpose: |
    判斷學員「我不夠好 / 不配 / 沒價值」這類 worth-fiction 訊號的深度。
    純文字環境代償 Damon 體系的「非語言訊號」(身體緊繃 / 哭泣 / 解離)。
  
  used_by:
    - E3_opening_branch_router 分支 C
    - E3_deep_signal_detector(交叉驗證)
  
  method: Haiku_4.5_tool_call
  inputs:
    - last_user_response
    - last_3_user_turns_context
    - session_state.anchors_top3
  
  output_schema:
    has_specific_event_marker: bool       # 是否伴隨具體事件
    emotional_intensity_estimate: 0-3     # 情緒強度
    repetition_pattern: bool              # 是否反覆觸及同一 worth 議題
    body_metaphor_present: bool           # 「身體緊 / 痛 / 沉」等隱喻
    depth_judgment_score: 0-3
      (
        0 = 表面陳述、可走標準 reframe
        1 = 中度、可走分支 C 強制翻轉
        2 = 深、應 cascade 到 E3_deep_signal_detector
        3 = 極深、立即 handoff_escalation 並建議預約 Vivi
      )
  
  threshold_for_deep_routing: "depth_judgment_score >= 2"
  latency_target: 200ms
  cost_estimate: "+$0.005-0.015 / 學員 / 21 天(觸發頻率 1-2 次/場)"
  
  engineering_implementation: ⚙️ Patrick
    files_estimated:
      - "lib/haiku-judge/depth-signal.js"
```

### A5. containment_logic_judge

```yaml
containment_logic_judge:
  purpose: |
    判斷學員對「存在依賴測試」/「Containment Judgment」回應的邏輯合理性。
    純文字環境代償 Damon 親自評估「客戶答案是否合於包含性邏輯」。
  
  used_by:
    - E3_top1_determination Step 5 / Step 6
    - E3_cascade_down_validator(可選備用)
  
  method: Haiku_4.5_tool_call
  inputs:
    - last_user_response
    - prior_ai_question(存在依賴提問內容)
    - values_being_compared(2 個 value 詞)
  
  output_schema:
    answer_addresses_containment: bool    # 學員是否回答「包含關係」(而非順序)
    linear_thinking_error_detected: bool  # 是否出現「必須先 X 才能 Y」
    containment_direction: enum ["A_contains_B", "B_contains_A", "interdependent", "unclear"]
    confidence: "high" | "medium" | "low"
  
  routing_logic:
    - linear_thinking_error_detected == true → 觸發 E3_top1_determination Step 4(切換 Containment 邏輯解釋)
    - containment_direction == "A_contains_B" + confidence high → A 通過存在依賴測試
    - containment_direction == "unclear" → 重新提問或 cascade A3
  
  latency_target: 200ms
  cost_estimate: "+$0.005-0.010 / 學員 / 21 天(觸發頻率 1-2 次/場)"
  
  engineering_implementation: ⚙️ Patrick
    files_estimated:
      - "lib/haiku-judge/containment-logic.js"
```

### Haiku Judge instances 總覽(引擎 1+2+3 累積)

```yaml
haiku_judge_instances:
  A1_sensory_detail:
    used_by: [E1c, E2_aggregator 重 4, E3_cascade_down_validator]
    file: "lib/haiku-judge/sensory-detail.js"
  
  A4_depth_signal:
    used_by: [E3_opening_branch_router 分支 C, E3_deep_signal_detector]
    file: "lib/haiku-judge/depth-signal.js"
  
  A5_containment_logic:
    used_by: [E3_top1_determination, E3_cascade_down_validator]
    file: "lib/haiku-judge/containment-logic.js"

cost_estimate_total:
  per_student_21_days: "+$0.02-0.05"
  beta_100_students: "+$2-5 total"
  → "negligible vs 主對話 Sonnet cost"
```

---

## 6. 跨引擎合約

### 6.1 引擎 3 讀引擎 1 的 state

```yaml
read_from_engine_1:
  - session_state.cumulative_ppl_score
    used_in: E3_deep_signal_detector(交叉檢查、高 PPL 時不冒進深路由)
  
  - session_state.deviation_handled_this_turn
    used_in: 所有 E3 子路由器 contextual_filter
    behavior: 若引擎 1 在處理偏離、E3 跳過該 turn
```

### 6.2 引擎 3 讀引擎 2 的 state

```yaml
read_from_engine_2:
  - session_state.current_quality_status  ⭐ 核心 input
    used_in: E3_status_router 4 條路由
  
  - session_state.current_quality_candidate_term
    used_in: E3_status_router 過渡話術變數填空
  
  - session_state.quality_focus_history
    used_in: E3_cascade_down_validator 確認哪些 quality 已被 owned
  
  - session_state.elicitation_mode_active
    used_in: E3_opening_branch_router 觸發條件
    ownership: 引擎 3 控制此 flag 切換邏輯(本檔 §3.8)
```

### 6.3 引擎 3 寫入給其他系統的 state

```yaml
write_for_engine_4_and_checkpoint1:
  - session_state.router_phase
    consumers: 引擎 4 / Checkpoint 1 模組
    behavior: 路由到正確 daily session phase
  
  - session_state.next_action
    consumers: 主對話 LLM 框架
    behavior: 決定下一個 turn 主對話走哪條路徑
  
  - session_state.top1_value
    consumers: 引擎 2(下一輪身份測試對象)、引擎 4(主動引用)
  
  - session_state.values_ranking
    consumers: Checkpoint 1 Phase 5 Cascade Down 觸發
  
  - session_state.deep_signal_flags
    consumers: dashboard / failure_signal monitoring
  
  - session_state.handoff_triggered_count(累積)
    consumers: 附錄 A3 + dashboard
```

### 6.4 引擎 3 與附錄 A 機制使用

```yaml
mechanism_usage:
  A1_sensory_detail:
    used_by_E3: E3_cascade_down_validator(Top 2 / Top 3 身份測試判斷)
  
  A3_handoff_escalation:
    used_by_E3: E3_deep_signal_detector / E3_opening_branch_router H4-H5 / E3_top1_determination H7
  
  A4_depth_signal: ⭐ 新增
    used_by_E3: E3_opening_branch_router 分支 C / E3_deep_signal_detector
  
  A5_containment_logic: ⭐ 新增
    used_by_E3: E3_top1_determination Step 5 / E3_cascade_down_validator(備用)
```

---

## 7. Patrick 接手清單

### 7.1 migration 014 延伸欄位

引擎 3 新增 session_state 欄位、加到引擎 1+2 合併的 migration 014 JSONB 草案:

```
session-scoped:
- session_state.router_phase (enum string)
- session_state.cascade_down_progress (object | null)
- session_state.deep_signal_flags (object)
- session_state.opening_branch_handled (bool)
- session_state.next_action (enum string)

user-scoped(寫入 user_profile_evolution):
- user_profile_evolution.values_collected_list (list of strings)
- user_profile_evolution.top1_value (string | null)
- user_profile_evolution.values_ranking (list of objects)
```

**補回引擎 2 漏的欄位**(forward question 2 ack):
```
- session_state.identity_signal_suspected_this_turn (bool)
```

### 7.2 v4.0 detector framework 適配延伸

- 5 個 E3 子路由器全部 conditional_inject、套 v4.0 framework
- 互斥觸發 + 優先順序判斷邏輯 = Sequential cascade(同引擎 2 預設)
- 觸發順序:E3_deep > E3_opening > E3_top1 > E3_status > E3_cascade

### 7.3 cached prefix 整合

- cached_4_7_router_reference ~1400 tokens 加入 v4.0 主 cached prefix
- 與 cached_5_layer_unwrap_reference (引擎 1、~600 tokens) 並列
- 合計 cached ~2000 tokens、~26% baseline cost ≈ ~520 equivalent active

### 7.4 附錄 A 新增工程實作

```
新增 Haiku judge files:
- lib/haiku-judge/depth-signal.js (A4)
- lib/haiku-judge/containment-logic.js (A5)

→ 加上引擎 1 已有的 lib/haiku-judge/sensory-detail.js
→ lib/haiku-judge/ 共 3 個 instances
```

### 7.5 forward question 1 對齊延後

跨 day reset 策略(`router_phase` / `current_quality_status` / `top1_value` / `elicitation_mode_active` 是否 reset)——本檔 v0.1 預設「不 reset」,**待引擎 4 NLP Amnesia 對齊一致決策**。

### 7.6 24h 內回 ack 給設計師

格式:
> 「收到引擎 3 markdown、預估 X 天落地、引擎 1+2+3 合併工程進度:[...]、有 Y 個工程疑問如下:[...]」

---

## 8. Forward References

### 8.1 引擎 4:AI 主動引用機制
本檔多次提到「路由到引擎 4」、「takeaway 種下 + Future Pacing(引擎 4 範圍)」、「主動引用 Day N+1 開場」——這些是引擎 4 範圍。

引擎 4 預期讀取:
- `session_state.router_phase == "completed"` → takeaway 種下
- `quality_focus_history` → Day N+1 開場引用
- `top1_value` / `values_ranking` → Cascade Down 後的引用方式

### 8.2 Checkpoint 1:21 天 daily session 結構
本檔 §4.5 / §4.6 多次提到「路由到 Checkpoint 1 Phase X」、「handoff_target_module」——這些是 Checkpoint 1 範圍:
- Build Vision 完整執行邏輯(Phase 2)
- Self-Concept 模型內部執行(Phase 2-3:Mapping Across / Scope Overlap)
- 反例整合 / 三向歸類(Phase 4)
- Future Pacing / Let it Go(Phase 5)

### 8.3 dashboard / failure_signals
H-series failure modes(H1-H12)+ deep_signal_flags 監控 + handoff_triggered_count 累積追蹤——延後至 `v5_beta_failure_signals_dashboard.md`(引擎 4 寫完後集中)。

特別注意 **H1 深訊號誤判** + **H3 亞洲學員深訊號 recall 過低**——這兩個是 Beta 階段最重要的 dashboard 監控訊號。

### 8.4 跨 day reset 策略對齊
本檔 §3.1 / §3.8 + 引擎 2 §3.1 / §3.6 都標 v0.1 暫定「不 reset」、待引擎 4 NLP Amnesia 一致決策。

### 8.5 工具二三池進度(引擎 3 觸發)
本檔觸發:
- ✅ 2C 觸發 #6 Step 1-4 對應到 E3 + Parts Integration 切換條件(§4.1 cached reference 內【Parts Integration 切換條件】完整繼承)
- 2A SC 句式池(引擎 2 已 KEEP+UPGRADE)維持
- 2B / 2C 完整正式判決等引擎 4 後集中

### 8.6 Re-imprinting v5.1+ 範圍
v5.0 MVP 偵測 + 路由、不執行。v5.1+ 若 Beta 階段證明需要、可以基於 cached_4_7_router_reference 內【Re-imprinting 訊號清單 + 11 步驟】展開實際執行 spec。

---

## 9. 附錄 B:方法論 4.7 + 3.4 內嵌

> **來源**:`damon_methodology.md` 章節 4.7(AI App Session Flow 完整藍圖)、3.4(Containment Judgment / Linear Thinking Error)。
>
> **內嵌理由**:Patrick 工程端讀到的方法論可能版本不同步、本檔自給自足。

### 4.7 章節核心摘要

(完整內容見 cached_4_7_router_reference §4.1、本附錄僅列關鍵句)

> Damon 真實 Session 架構:
> 1. 單一入口:Values Elicitation
> 2. 強制翻轉:負面表述 → As-If Frame 強制翻成正向目標
> 3. 中央路由器:身份測試是兩個模組之間的 switch
> 4. 進度保留:切換到 Self-Concept 時不丟棄前面工作
> 5. 嚴格 Top 1 判定:用「存在依賴測試」確認 Top 1 是包含性最大的 value
> 6. 只對 Top 1 完整跑:不對每個 ambiguous value 跑完整流程
> 7. 反例整合是核心動作:佔 Mapping Across 40-90% 時間
> 8. 機動切換:深層創傷 → Re-imprinting / 阻力 → Parts Integration

### 3.4 章節核心摘要

> Containment Judgment(涵蓋判斷):
> - 與 PK 關係:PK 是「形式」、涵蓋判斷是「標準」
> - 使用時機:客戶卡關 / 排線性錯誤時、AI 主動介入
>
> Linear Thinking Error(線性思考錯誤):
> - 定義:客戶把排序當「發生順序」(必須先 A 才能 B)
> - AI 偵測:「我必須先...才能...」「沒有 X 就不可能 Y」這類句型
> - 處理:立刻切換到涵蓋判斷邏輯
>
> Hierarchy of Values 2 大鐵律:
> 1. 永遠不離開特定情境
> 2. 不是排「先後順序」、是找「最大涵蓋類別」

---

## 文件版本

- v0.1 (2026-05-19):初版、設計師對話版、待 Patrick ship 版草稿
