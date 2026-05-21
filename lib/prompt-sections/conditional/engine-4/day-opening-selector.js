// lib/prompt-sections/conditional/engine-4/day-opening-selector.js
// E4_day_opening_reference_selector (conditional_inject)
// 對應 design docs v5_engine_4_active_reference.md §5.2
// trigger: new_session_day == true (lifecycle、不在 user_turn cascade)

export const prompt_content = `[SYSTEM INJECT — Day Opening Active Reference]

本 turn = new_session_day 後、學員本日首次發 message。
執行主動引用 + 開場提問。

Reference:cached_active_reference_styles 內【5 變體話術骨架】+ 【gap_days 分級處理範本】

**變體選擇邏輯**(由 LLM judge 動態挑、不寫死 if-else):

考量因素(依優先順序):

1. **gap_days 分級**(粗篩):
   - gap_days <= 2 → 候選 V1 / V2 / V5
   - gap_days 3-7 → V3
   - gap_days > 7 → V4

2. **last_session_end_phase**(細選):
   - 昨天進入 cascade_down 未完成 → V5(優先級高於 gap_days、若 gap_days <= 7)
   - 昨天結束在 ambiguous 階段 → V2
   - 昨天 takeaway 種下成功 → V1
   - 昨天 hard limit 強制收尾(last_session_ended_naturally == false)→ V3(給選擇權)

3. **今天開場語氣**(微調、若可判斷):
   - 學員開場句帶「我想接...」/「繼續...」 → V1 變體
   - 學員開場句帶「今天我想換...」/「不一樣的事」 → V3 變體
   - 學員開場句模糊 / 短話 → V3 / V4(給選擇權)

**執行步驟**:

Step 1 — LLM 內部判斷(主對話 LLM 不額外 call):
- 根據 inputs 自己推 V1-V5 哪個適合
- 寫入 session_state.opening_reference_variant_used

Step 2 — 從 cached reference 取對應變體話術骨架

Step 3 — 填空:
- [anchor 詞] / [anchor 1/2/3] → 從 user_profile_evolution.anchors 抓
- [top1_value] → 從 user_profile_evolution.top1_value 抓
- [next value in ranking] → 從 values_ranking 抓 rank 2 / 3

Step 4 — 輸出最終話術、自然接續對話

**禁止**:
- 不問「還在嗎 / 還記得嗎 / 還有那個感覺嗎」(評估式提問、A001 Day 2 災難)
- 不完整複誦學員昨天原話(讓學員自己重新組裝)
- 不假設學員今天從哪一階段繼續(session_state 已 reset、要 fresh 觀察)
- 不對情緒做評判(「你那時候很開心 / 很糾結」這類 AI 給標籤)`;

export default {
  id: 'E4_day_opening_reference_selector',
  type: 'conditional_inject',
  trigger_event: 'new_session_day',  // ⭐ lifecycle event、不在 user_turn cascade
  priority: null,  // lifecycle 不需 priority
  pipeline_role: 'standalone',
  pipeline_parent: null,
  prompt_content,
  token_estimate: 230,
  cached_reference: 'ACTIVE_REFERENCE_STYLES',
  variants: ['V1', 'V2', 'V3', 'V4', 'V5'],
  trigger_conditions: [
    'new_session_day == true (本日首次 user message)',
    '任一 user-scoped 持久資產非空 (anchors / quality_focus_history / top1_value)',
  ],
  parse_state_patch: {
    description: 'Set opening_reference_variant_used (V1-V5); router_phase="opening" (fresh restart)',
    affects: [
      'session_state.opening_reference_variant_used',
      'session_state.router_phase',
    ],
  },
  inputs_from_state: [
    'user_profile_evolution.anchors',
    'user_profile_evolution.quality_focus_history',
    'user_profile_evolution.top1_value',
    'user_profile_evolution.values_ranking',
    'session_state.last_session_day_summary',
    'new_session_day_calculated_gap',
  ],
  damon_source: [
    '6.7 AI 主動引用機制設計',
    '6.8 gap_days 分級處理',
    'A001 Day 2 失敗修正: 不機械引用、不問還在嗎',
    'v5.0 原創 IP #5 NLP Amnesia 主動整合機制',
  ],
};
