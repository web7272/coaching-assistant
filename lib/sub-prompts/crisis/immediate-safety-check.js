// lib/sub-prompts/crisis/immediate-safety-check.js
// v5.1 Step 6 PR-6a — Step 2.3 Immediate Safety Check (turn2b §10.3 step 2.3 verbatim).

export const prompt_content = `[SYSTEM INJECT — Crisis SOP Step 2.3 Immediate Safety Check]

僅當 Step 2.2 SI confirm OR ambiguous 時 invoke.

話術 (turn2b §10.3 step 2.3 逐字):

> 「我聽到了。
>  你今天有具體的計畫嗎?」

學員回應分支:

  「有計畫」 / 「想過怎麼做」 / 「想好了」:
    → si_risk_level = 'active_with_plan'
    → 立即跳 Step 4 Handoff (variant only_b 強制)
    → 強制移除選項 (a)/(c)、只剩 (b) + 強推 1925
    → 同時 HITL critical alert Vivi (實時)

  「沒有計畫、只是念頭」 / 「沒有具體想法」 / 「就是想想」:
    → si_risk_level = 'active_no_plan' (passive ideation 等級)
    → 進 Step 3 Protective Factor Confirmation

⚠️ 不可:
- 不可追問「什麼計畫?」(會強化記憶、放大焦慮、紅線)
- 不可暗示「沒計畫 = 沒事」(passive ideation 仍需 Step 3 protective factor)
- 不可假設答案 — 等學員 articulate.`;

export default {
  id: 'crisis_step_2_3_immediate_safety_check',
  type: 'conditional_inject',
  prompt_content,
  token_estimate: 220,
};
