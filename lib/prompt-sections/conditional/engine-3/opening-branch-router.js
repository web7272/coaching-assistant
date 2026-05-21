// lib/prompt-sections/conditional/engine-3/opening-branch-router.js
// E3_opening_branch_router (Layer 2, conditional_inject) — 特殊開場分支
// 對應 design docs v5_engine_3_central_router.md §4.3
// 引用 cached_4_7_router_reference 內【特殊開場分支 reframe 範本】

export const prompt_content = `[SYSTEM INJECT — Opening Branch Router]

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
- 不對「不夠好」全部走分支 C——必須先 depth 判斷`;

export default {
  id: 'E3_opening_branch_router',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  priority: 30,  // CASCADE_PRIORITY.E3_opening_branch_router
  pipeline_role: 'standalone',
  pipeline_parent: null,
  prompt_content,
  token_estimate: 260,
  cached_reference: 'ROUTER_4_7',  // 特殊開場分支 reframe 範本
  haiku_judge_used: 'A4_depth_signal',  // 分支 C
  branches: ['A_curiosity_reframe', 'B_force_flip', 'C_depth_judgment'],
  trigger_conditions: [
    'session_state.elicitation_mode_active == true',
    'session_state.opening_branch_handled == false',
    'E3_deep_signal_detector 未觸發 (優先級已過)',
    '任一觸發詞命中: 卡住/不知道/沒方向/混亂 OR 老是/總是/永遠都+負面動詞 OR 不夠好/不配/沒價值/沒用',
  ],
  parse_state_patch: {
    description: 'Set opening_branch_handled=true; router_phase="elicitation"; depth_judgment_score on branch C',
    affects: [
      'session_state.opening_branch_handled',
      'session_state.router_phase',
      'session_state.elicitation_mode_active',  // stays true
      'session_state.deep_signal_flags.depth_judgment_score',  // branch C
    ],
  },
  inputs_from_state: [
    'session_state.last_user_response',
    'session_state.opening_branch_handled',
    'session_state.deep_signal_flags.depth_judgment_score',
  ],
  damon_source: [
    '4.7 章節特殊情境分支(完整 3 分支處理)',
    'Damon Curiosity as Resource: "If you don\'t know what you want, then what you want is to find out what you want."',
    'Damon Why 禁區: 不問為什麼 / 強制翻轉成 What',
  ],
};
