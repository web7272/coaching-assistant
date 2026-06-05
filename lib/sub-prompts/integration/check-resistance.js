// lib/prompt-sections/conditional/checkpoint-1/phase-3a/check-resistance.js
// CP1 Phase 3a Step 2: Check Resistance (5 種 resistance × reframe)
// 對應 design docs v5_checkpoint_1_*_turn_2.md §8.2 step_2_check_resistance
// Damon source: 方法論 5.2 Step 3 + 4.3-4.6 Parts Integration 5 種 resistance

export const prompt_content = `[SYSTEM INJECT — Phase 3a Step 2: Check Resistance]

Damon 4 步驟改變法 Step 3:Check Resistance
問:「**這個 vision 跟你身上某個 part 衝突嗎?**」
若有 → Parts Integration 4 步處理(臨時叫、不離開 owned path)
若沒有 → 跳 step 3 Let it Work

**Step 2a — 問 resistance**:
> 「現在你看著這個『[top1_value]』的你——
> 有沒有任何一個聲音、覺得『**等等、我不確定**』?」

(Vivi 5/21 review: part-as-voice 替代 part-as-body-location、移除「身體裡」紅線 14 觸發)

**Step 2b — 識別 resistance 類型(根據學員回應)**:

若學員講「萬一失敗」/「之前試過都失敗」:
  → 害怕失敗 → Spectrum Reframe 破解
  話術:「如果你餘生都朝這個方向前進、每靠近一步都更『[top1_value]』、
       你會對此感到平靜嗎?」

若學員講「我成功會變得不像我」/「成功讓我傲慢」:
  → 害怕成功代價 → Compatibility Check
  話術:「『[top1_value]』跟『[害怕變成的特質]』可以一起運作嗎?
       是不是越『[top1_value]』、越能避開『[害怕變成的特質]』?」

若學員講「我成功家人會不開心」/「朋友會覺得我變了」:
  → 生態破壞 → Accepting Cost in Advance
  話術:「這些代價真實存在。你**有意識地**選擇承擔嗎?」

若學員講「我不知道會發生什麼」/「我不敢」:
  → 害怕未知 → As-If Frame
  話術:「我們做個實驗、試試看『[top1_value]』的版本、
       如果不行、我們再回來。」

若學員講「我就是不配」/「我不夠好」:
  → 創傷印記 / worth fiction
  → cascade 到引擎 3 E3_deep_signal_detector(最高優先級)
  → 不在本 step 處理、handoff_escalation

**Cross-engine active**:
- 引擎 3 E3_deep_signal_detector 持續監測(Re-imprinting 訊號最高優先)
- 引擎 1 E1d bypassing 治理(若學員用大詞迴避)

**State updates during step**:
session_state.build_vision_progress.resistance_detected: true | false
session_state.build_vision_progress.resistance_type: enum (5 種)

**Exit to Step 3**:
- 無 resistance(學員確認 no part 反對)
- 或 resistance 透過 4 個 break 技術之一處理完(Spectrum / Compatibility / Accepting / As-If)
- 學員回 step 1 補強 vision(若 resistance 處理改變 vision)`;

export default {
  id: 'CP1_phase_3a_check_resistance',
  type: 'conditional_inject',
  dispatch_mode: 'phase_context',
  phase: 'phase_3a',
  sub_step: 'step_2_check_resistance',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 380,
  resistance_types_to_breakers: {
    fear_of_failure:      'Spectrum Reframe',
    fear_of_success_cost: 'Compatibility Check',
    ecosystem_disruption: 'Accepting Cost in Advance',
    fear_of_unknown:      'As-If Frame',
    worth_fiction:        'cascade to E3_deep_signal_detector (not handled here)',
  },
  parse_state_patch: {
    description: 'Update build_vision_progress.resistance_detected + resistance_type; if worth_fiction → cascade E3 deep signal',
    affects: [
      'session_state.build_vision_progress',
      'session_state.deep_signal_flags',  // on worth_fiction cascade
    ],
  },
  inputs_from_state: [
    'session_state.top1_value',
    'session_state.last_user_response',
    'session_state.build_vision_progress',
  ],
  damon_source: [
    'CP1 turn 2 §8.2 step_2_check_resistance',
    '方法論 5.2 Step 3 完整 SOP',
    '方法論 4.3-4.6 Parts Integration 5 種 resistance + 5 種破解技術',
    '引擎 3 cached mode_aware_router_reference 內 Mode 3 Integration section (整合反例 + 良善動機挖掘)',
  ],
};
