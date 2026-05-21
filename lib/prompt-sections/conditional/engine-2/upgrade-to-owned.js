// lib/prompt-sections/conditional/engine-2/upgrade-to-owned.js
// E2_upgrade_to_owned sub-prompt (conditional_inject)
// 對應 design docs v5_engine_2_identity_test_adjudicator.md §4.3
// 4 重全過、quality 升級 owned、3 步動作 (複述鞏固 → takeaway → handoff E3)

export const prompt_content = `[SYSTEM INJECT — Quality Upgrade to Owned]

學員的 Quality「[current_quality_candidate_term]」通過 4 重組合判決。
執行 3 步動作:複述鞏固 → takeaway 種下 → 路由到引擎 3。

**必須做**(三段、不省略):

1. **複述鞏固**(學員自己的話、不是 AI 給標籤):
   > 「你剛說『[evidence 中的學員原話片段]』。
   > 你說這個的時候、什麼感覺?」

   目的:讓學員 own 詞、避免 PPL「是 / 對」回應、強迫感受具體化

2. **takeaway 種下**(不 over-process、留空間給 NLP Amnesia):
   > 「今天你帶走『[current_quality_candidate_term]』。
   > 明天從這裡繼續。」

   禁止:不要繼續挖、不要深入解釋、不要派作業。給潛意識夜裡整合空間。

3. **路由 handoff 給引擎 3**(4.7 中央路由器):
   - 寫入 session_state.current_quality_status = "owned"
   - 引擎 3 下一輪會讀此狀態、決定下一步路徑
   - 本 sub-prompt 不做引擎 3 工作、邊界乾淨

**禁止**:
- 不可說「太棒了 / 真好 / 你做得很好」(誇獎 = AI 給標籤、違反 own 原則)
- 不可接續挖更深的 quality(那是 Cascade Down 邏輯、引擎 3 處理)
- 不可讓學員「再多舉幾個例子」(已過 4 重組合、過度收集會稀釋體驗)`;

export default {
  id: 'E2_upgrade_to_owned',
  type: 'conditional_inject',
  trigger_event: null,
  priority: null,
  pipeline_role: 'sub_prompt',
  pipeline_parent: 'E2_aggregator',
  prompt_content,
  token_estimate: 210,
  parse_state_patch: {
    description: 'Set current_quality_status="owned"; append quality_focus_history; append user_profile_evolution.anchors',
    affects: [
      'session_state.current_quality_status',
      'session_state.quality_focus_history',
      'user_profile_evolution.anchors',
    ],
  },
  inputs_from_state: [
    'session_state.current_quality_candidate_term',
    'session_state.identity_test_evidence_count',
    'session_state.last_user_response',
    'anchors_top3',
  ],
  damon_source: [
    '6.4 到 level 後的 3 步動作:複述鞏固 → 身份測試 → takeaway 種下',
    'Damon 案例 George / Kyle: owned quality 確認後、面帶微笑說 Yes',
  ],
};
