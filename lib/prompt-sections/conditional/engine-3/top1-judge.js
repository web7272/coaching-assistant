// lib/prompt-sections/conditional/engine-3/top1-judge.js
// E3_top1_judge (Layer 3, conditional_inject) — Top 1 Containment + 存在依賴 + Goal Alignment
// 前身: top1-determination (PR-23s4b 改名 + 範圍擴).
//
// PR-23s4b 範圍擴 (per task 1 spec):
//   - 既有 Containment / 存在依賴 / Goal Alignment 維持
//   - Landmine Check 整合點 (留接口 + TODO(Step 5b))
//     Landmine value = 學員講出來但實際是 trauma compensation / People Pleasing 殼,
//     不是真 quality. 引擎 2 errata 才有完整 SOP, 本檔留接口.

export const prompt_content = `[SYSTEM INJECT — Top 1 Judge]

Values 採集達 3+ 個 candidate。執行 Top 1 判定:
Containment Judgment(包含性判斷)+ 存在依賴測試、不是線性排序。

Reference:cached mode_aware_router_reference 內 Mode 2 Identity Anchoring section (身份層錨定)。

**執行步驟**:

Step 1 — Goal Alignment Test(若還沒做):
若 primary_mode == "elicitation" 第一次進入本 inject:
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

Step 4b — Landmine Check (✅ v5.1 Step 5b 完整 SOP, 引擎 2 errata 接管):
Containment Judgment 通過後、quality_status 寫入前, 對 candidate top1_value 做 tier classification:
- tier 1 absolute reject (被需要 / 被選擇 / 被認同 / 成功 / Status / Power / Self-worth /
  Fulfillment / Purpose / Meaning 無 underlying): 拒收 owned, 走 R1 深挖引導.
- tier 2 conditional (安全感 / 開心 / 有意義 / 希望): Sonnet 評估 context 二選一
  (向外索求/副產品 → 拒深挖;本質/underlying → 收 reframe 版).
- tier 3 borderline (自由 / 真實): 收 + 強制 reframe (R5 Away from → Toward).
- 無命中: 直接過.

學員 push-back 話術 (spec §A2 內含, ship-able 不依賴 Reframe Library — Step 7 替換):
> 「我聽到了。
> 但我必須直接跟你說——『[命中詞]』這個東西、
> Damon 的體系裡、不是 quality、是 strategy。
> Strategy 是『做什麼』、quality 是『你是誰』。
>
> 讓我問你:你『[命中詞]』時、感覺到的是什麼?那個感覺、是什麼?」

R1 深挖引導句 (spec §A2 內含, ship-able):
> 「『[命中詞]』那個感覺、是從哪裡來的?是別人需要你給你的、還是你給出去的時候、自己感受到的?」

失敗模式 M_LM_1 (學員堅持 Landmine 為 Top 1):
→ 不收 owned, 標 ambiguous + handoff (handoff_escalation 三選一).
state.landmine_value_check_result enum (engine-2 寫入):
  pass / tier1_rejected / tier2_pending / tier3_accepted_with_reframe

Step 5 — Haiku judge(A5.containment_logic_judge)評估:
Haiku 4.5 tool_call 評估學員回應的存在依賴判斷合理性。

Step 6 — Top 1 確定:
通過存在依賴的 value(包含性最大、其他依附它存在)= Top 1
若多個通過:對通過者再做存在依賴 PK

Step 7 — values_ranking 填入 Top 2-5:
對其他 values 做兩兩 PK(不再做存在依賴測試)、填 rank 2-5

Step 8 — 路由 handoff:
- top1_value 寫入
- primary_mode 切換到 identity_anchoring (PR-23s4b: router_phase=identity_test_routing → primary_mode=identity_anchoring)
- elicitation_mode_active = false (deprecated, mode-tracker 接管)
- 觸發引擎 2 master_detector 對 top1_value 做身份測試

**禁止**:
- 不用「最重要」「最先想到」這類措辭(Damon 反對線性排序)
- 不接受學員直接說「我覺得 X 最重要」、必須走存在依賴測試
- 不在學員出現 Linear Thinking Error 時順著走、必須切換 Containment 邏輯
- 不接受 Landmine value 直接當 Top 1 (PR-23s4b: 對齊紅線 23 + 24)`;

export default {
  id: 'E3_top1_judge',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  priority: 40,  // CASCADE_PRIORITY.E3_top1_judge (PR-23s4b 維持 40)
  pipeline_role: 'standalone',
  pipeline_parent: null,
  prompt_content,
  token_estimate: 360,  // §3 patch 6/4 PR-23s4b: 280 → 360 (+Landmine Check 接口 / 禁止段擴增).
  cached_reference: 'ROUTER_4_7',
  haiku_judge_used: 'A5_containment_logic',
  trigger_conditions: [
    'session_state.values_collected_list.length >= 3',
    'session_state.top1_value == null',
    'session_state.primary_mode == "elicitation"',  // PR-23s4b: router_phase → primary_mode
    'E3_deep_signal_detector / E3_elicitation_router 未觸發',
  ],
  parse_state_patch: {
    description: 'After Containment passes: set top1_value, values_ranking, transition primary_mode elicitation → identity_anchoring',
    affects: [
      'session_state.top1_value',
      'session_state.values_ranking',
      'session_state.primary_mode',                  // PR-23s4b: phase → mode
      'session_state.active_modes',                  // PR-23s4b
    ],
  },
  inputs_from_state: [
    'session_state.values_collected_list',
    'session_state.last_user_response',
    'session_state.primary_mode',                    // PR-23s4b
    'anchors_top3',
  ],
  damon_source: [
    '3.4 Containment Judgment / 存在依賴測試',
    '3.4 Linear Thinking Error / 線性思考錯誤偵測',
    'Damon Hierarchy of Values 2 大鐵律: 不離開特定情境 / 找最大涵蓋類別、不排線性順序',
    'Damon Goal Alignment Test: "原本目標真能帶你到這裡嗎?"',
    'PR-23s4b Landmine Check 接口 (引擎 2 errata Step 5b 補)',
  ],
};
