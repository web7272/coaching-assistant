// lib/prompt-sections/conditional/engine-3/elicitation-router.js
// E3_elicitation_router (Layer 2, conditional_inject) — elicitation mode 開場分流 + reframe
// 前身: opening-branch-router (PR-23s4b 改名 + 範圍擴).
//
// PR-23s4b 範圍擴 (per task 1 spec):
//   - 既有起手分流 (A curiosity / B 強制翻轉 / C 深度判斷) 維持
//   - 副產品挑戰 (對齊新紅線 24: 「開心/意義/目的/快樂/幸福/滿足」 = 副產品非 quality)
//   - Reframe Library 訊號分派 (留接口 — reframe 本體 Step 7 / PR-23s4c+)
//   - 強制翻轉 Away from → Toward (對齊核心世界觀 #3 Survival vs Thriving)

export const prompt_content = `[SYSTEM INJECT — Elicitation Router]

偵測到 elicitation mode 內的特殊分流訊號、執行 reframe 後回到標準 values elicitation。

Reference:cached_4_7_router_reference 內【特殊開場分支 reframe 範本】完整話術。

**分支選擇邏輯**:

若命中「卡住 / 不知道 / 沒方向 / 混亂」→ **分支 A:Curiosity Reframe**
若命中「老是 / 總是 / 永遠都」+ 負面動詞 → **分支 B:強制翻轉 (Away from → Toward)**
若命中「不夠好 / 不配 / 沒價值 / 沒用」→ **分支 C:深度判斷**
  → 呼叫附錄 A4.depth_signal_judge 評估
  → score 0-1:本 inject 繼續、走分支 C(淺、翻轉成正向)
  → score 2-3:重新路由到 E3_deep_signal_detector(優先級更高、本 inject 終止)
若命中「開心 / 意義 / 目的 / 快樂 / 幸福 / 滿足」當 quality → **分支 D:副產品挑戰**
  → 對齊紅線 24:這些是副產品、不是 quality
  → 鏈式追問挖出產生這些副產品的更深 quality

**執行話術**:
從 cached reference 取對應分支話術骨架、填入學員原話。
- 分支 D 話術:「『[副產品詞]』感覺很重要——但我想問:讓你『[副產品詞]』的、
  是什麼?那個讓你『[副產品詞]』的東西、才是我想挖的。」

**後續動作**:
- elicitation_branch_handled = true
- 下一 turn 進入標準 Damon 鏈式追問(values elicitation)
- 同一 session 不再觸發本 inject(除非 new_session_day reset)

**禁止**:
- 不問 Why(Damon 禁區、強制翻轉成 What)
- 不假設學員必須翻轉(若學員拒絕、cascade 到附錄 A3.handoff_escalation)
- 不對「不夠好」全部走分支 C——必須先 depth 判斷
- 不接受副產品當終點 quality(紅線 24)

[TODO(Step 7 / PR-23s4c+) — Reframe Library 接口]
  Damon 高頻 reframe pattern (紅線 22 / 24 / 25 + 4 reframe pattern) 觸發時、
  從 Reframe Library 取對應 pattern 填空 invoke. 目前是 placeholder。`;

export default {
  id: 'E3_elicitation_router',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  priority: 30,  // CASCADE_PRIORITY.E3_elicitation_router (PR-23s4b 維持原優先級 30)
  pipeline_role: 'standalone',
  pipeline_parent: null,
  prompt_content,
  token_estimate: 320,  // §3 patch 6/4 PR-23s4b: 260 → 320 (+副產品分支 D / Reframe TODO).
  cached_reference: 'ROUTER_4_7',  // 特殊開場分支 reframe 範本
  haiku_judge_used: 'A4_depth_signal',  // 分支 C
  // PR-23s4b: 加 D 副產品挑戰分支.
  branches: ['A_curiosity_reframe', 'B_force_flip', 'C_depth_judgment', 'D_byproduct_challenge'],
  trigger_conditions: [
    'session_state.primary_mode == "elicitation"',  // PR-23s4b: phase → mode
    'session_state.elicitation_branch_handled == false',  // PR-23s4b: opening_branch → elicitation_branch
    'E3_deep_signal_detector 未觸發 (優先級已過)',
    '任一觸發詞命中: 卡住/不知道/沒方向/混亂 OR 老是/總是/永遠都+負面動詞 OR 不夠好/不配/沒價值/沒用 OR 開心/意義/目的/快樂/幸福/滿足',
  ],
  parse_state_patch: {
    description: 'Set elicitation_branch_handled=true; primary_mode stays elicitation; depth_judgment_score on branch C',
    affects: [
      'session_state.elicitation_branch_handled',
      'session_state.primary_mode',                              // PR-23s4b: 不直接動, 只確認停在 elicitation
      'session_state.deep_signal_flags.depth_judgment_score',    // branch C
    ],
  },
  inputs_from_state: [
    'session_state.last_user_response',
    'session_state.elicitation_branch_handled',
    'session_state.primary_mode',                                // PR-23s4b
    'session_state.deep_signal_flags.depth_judgment_score',
  ],
  damon_source: [
    '4.7 章節特殊情境分支 (完整 3 分支處理 + PR-23s4b 加副產品分支 D)',
    'Damon Curiosity as Resource: "If you don\'t know what you want, then what you want is to find out what you want."',
    'Damon Why 禁區: 不問為什麼 / 強制翻轉成 What',
    'safety patch #23 紅線 24 (Vivi 6/4): 不接受副產品 (開心/意義/目的) 作為終點 quality',
  ],
};
