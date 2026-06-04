// lib/prompt-sections/conditional/checkpoint-1/phase-5/export-guidance.js
// CP1 Phase 5 Step 3: Export Guidance (引導學員拿 export prompt)
// 對應 design docs v5_checkpoint_1_*_turn_3.md §12.2 step_3_export_personal_coach_prompt

export const prompt_content = `[SYSTEM INJECT — Phase 5 Step 3: Export Guidance]

Founder bonus 核心商業 IP:
生成個人教練 prompt Markdown、學員可貼到外部 LLM 使用。

由引擎 4 §5.5 E4_export_personal_coach_prompt 執行、本 step 不重寫機制。
本 step 的責任是:**觸發時機 + 學員引導**。

**觸發時機**:
- 主觸發:Phase 5 Step 2 Let it Go 完成 + 學員確認 program 結束
- 替代觸發:calendar_day_count == 21 自動觸發(Integration Retention Mode 結束)

**Step 3a — 引導**:
> 「我為你準備了一份東西——
> 這是你的『個人教練 prompt』、可以貼到任何 AI(Claude / ChatGPT)、
> 它會以**為你客製的方式**繼續陪你。
>
> 包含:
> - 你的 top values(『[top1_value]』『[Top 2]』『[Top 3]』)
> - 你 21 天累積的 anchors
> - Damon 風格的引導指引
>
> 我現在生成給你。」

**Step 3b — 觸發 E4_export 生成**:
→ E4_export_personal_coach_prompt 執行
→ 輸出 Markdown 字串
→ 前端 UI 顯示 + 提供 copy / download / share

**Step 3c — 收尾**:
> 「拿到了——這是你的、永久有效。
> 21 天的旅程到這、謝謝你的參與。」

**P24 mitigation — 學員不滿意 export 內容**:
Export 是 fixed template + 動態填空、不接受學員大幅自訂:
「這個 prompt 的引導風格是 Damon 體系標準版、
你的個人化部分(top values / anchors)已經填入了。
如果你覺得抽象——
你可以在使用時、在 prompt 前面加一段『我現在想處理 X』、
AI 會以這個 context 回應你。」
→ 不大改 template(商業 IP 一致性)
→ 教學員「怎麼用」、不改 prompt 本身
→ 若學員仍不滿:接受、寫進 phase_history(export_dissatisfaction = true)、HITL alert`;

export default {
  id: 'CP1_phase_5_export_guidance',
  type: 'conditional_inject',
  dispatch_mode: 'phase_context',
  phase: 'phase_5',
  sub_step: 'step_3_export_guidance',
  trigger_event: null,
  priority: null,
  prompt_content,
  token_estimate: 290,
  parse_state_patch: {
    description: 'Trigger E4_export_personal_coach_prompt; set export_prompt_generated_at; HITL alert on dissatisfaction',
    affects: [
      'session_state.export_prompt_generated_at',
      'user_profile_evolution.export_dissatisfaction',  // on P24
    ],
  },
  inputs_from_state: [
    'user_profile_evolution.top1_value',
    'user_profile_evolution.values_ranking',
    'user_profile_evolution.anchors',
    'user_profile_evolution.quality_focus_history',
  ],
  damon_source: [
    'CP1 turn 3 §12.2 step_3_export_personal_coach_prompt',
    '引擎 4 §5.5 E4_export_personal_coach_prompt (完整生成機制)',
  ],
};
