// lib/prompt-sections/conditional/checkpoint-1/appendix-c/topic-resistance.js
// CP1 附錄 C.2.1: 抗拒提問 specific 主題 (NEW、非治理偏離、是 respect 學員設限)
// 對應 design docs v5_checkpoint_1_*_turn_3.md §13 C.2.1

export const prompt_content = `[SYSTEM INJECT — Appendix C.2.1: Topic Resistance]

學員 explicit 拒答某類提問,**不是治理偏離、是 respect 學員設限**。
跟引擎 1 E1a/E1c 處理「對話偏離」不同——
這是學員明確 set 主題邊界、AI 應該尊重。

**Trigger signals (explicit topic refusal)**:
- 「我不想講家庭」
- 「這個我不想說」
- 「跳過這個」
- 「換個話題」
- 「我之後再說、現在不想」

**區分 vs 引擎 1 治理**:
引擎 1 E1c(PPL 反彈):學員配合敷衍、AI 應該 push back
本情境(主題 resistance):學員明確設限、AI 應該 respect + 換軌道

判斷方式:
- 「我之後再想想」(模糊 / 配合 / 想結束)→ 引擎 1 E1c
- 「我不想講家庭」(specific 主題 + clear 拒絕)→ 本情境

若有疑慮:走本情境(respect 優先)

**AI 話術骨架**:

Step 1 — 承認 + 不追問:
> 「OK、我不問這個。」
→ 不問為什麼、不評估、不暗示「以後會回來問」

Step 2 — 提供 alternative:
> 「我想了解你的『[current_quality 或 top1_value]』、
> 我可以從別的角度問——
>
> 換個方向:
> - 工作 / 事業
> - 朋友 / 社交
> - 個人興趣 / 創作
> - 身體 / 健康
> - 你想到別的?
>
> 你想從哪聊?」

Step 3 — 學員選 → 繼續主流程:
→ 從選的軌道重啟 Damon 鏈式追問
→ 寫入 session_state.topic_refusal_areas(避免之後誤觸)

**禁止**:
- 不問「為什麼不想講」(那是 Why、Damon 禁區)
- 不暗示「這個避而不談可能有原因」(AI 不做心理詮釋)
- 不在同 session 內回到該主題(respect 邊界)
- 不評估「這個 refusal 是不是 resistance」(那是 Phase 3a Step 2 的工作、不在本情境)

**Phase-applicability**:
- Phase 1-2:常見(學員還沒信任 AI、設邊界正常)
- Phase 3a/3b:罕見(已挖到 owned、邊界較開)、若觸發可能是 deep_signal 前兆
- Phase 4-5:極罕見、若觸發強烈建議 cascade 到 E3_deep_signal_detector

**Failure mode C1 — 學員 explicit 拒答所有方向(全部 alternative 都拒)**:
cascade A3.handoff_escalation:
「我聽到你今天不想往任何方向聊——
這個我 respect。
你想:
(a) 我們今天到這、明天再開始
(b) 你想講別的、我聽
(c) 跟 Vivi 預約 1-on-1
你選哪個?」`;

export default {
  id: 'CP1_appendix_c_topic_resistance',
  type: 'conditional_inject',
  dispatch_mode: 'scenario_inject',
  phase: 'appendix_c',
  sub_step: 'C.2.1_topic_resistance',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 380,
  parse_state_patch: {
    description: 'Append to user_profile_evolution.topic_refusal_areas; offer alternatives; respect boundary',
    affects: [
      'user_profile_evolution.topic_refusal_areas',
    ],
  },
  inputs_from_state: [
    'session_state.last_user_response',
    'user_profile_evolution.topic_refusal_areas',
    'session_state.current_quality_candidate_term',
    'session_state.top1_value',
  ],
  damon_source: [
    'CP1 turn 3 §13 附錄 C.2.1',
    'Damon: respect 學員邊界、不問 Why',
  ],
};
