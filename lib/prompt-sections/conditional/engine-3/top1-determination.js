// lib/prompt-sections/conditional/engine-3/top1-determination.js
// E3_top1_determination (Layer 3, conditional_inject) — Top 1 判定
// 對應 design docs v5_engine_3_central_router.md §4.4
// Damon source: 3.4 Containment Judgment / 存在依賴測試 / Linear Thinking Error

export const prompt_content = `[SYSTEM INJECT — Top 1 Determination]

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
- 不在學員出現 Linear Thinking Error 時順著走、必須切換 Containment 邏輯`;

export default {
  id: 'E3_top1_determination',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  priority: 40,  // CASCADE_PRIORITY.E3_top1_determination
  pipeline_role: 'standalone',
  pipeline_parent: null,
  prompt_content,
  token_estimate: 280,
  cached_reference: 'ROUTER_4_7',  // Top 1 判定 SOP
  haiku_judge_used: 'A5_containment_logic',  // Step 5
  trigger_conditions: [
    'session_state.values_collected_list.length >= 3',
    'session_state.top1_value == null',
    'session_state.router_phase in ["elicitation", "top1_determination"]',
    'E3_deep_signal_detector / E3_opening_branch_router 未觸發',
  ],
  parse_state_patch: {
    description: 'After Containment passes: set top1_value, values_ranking, router_phase=identity_test_routing, elicitation_mode_active=false',
    affects: [
      'session_state.top1_value',
      'session_state.values_ranking',
      'session_state.router_phase',
      'session_state.elicitation_mode_active',
    ],
  },
  inputs_from_state: [
    'session_state.values_collected_list',
    'session_state.last_user_response',
    'session_state.elicitation_mode_active',
    'anchors_top3',
  ],
  damon_source: [
    '3.4 Containment Judgment / 存在依賴測試',
    '3.4 Linear Thinking Error / 線性思考錯誤偵測',
    'Damon Hierarchy of Values 2 大鐵律: 不離開特定情境 / 找最大涵蓋類別、不排線性順序',
    'Damon Goal Alignment Test: "原本目標真能帶你到這裡嗎?"',
  ],
};
