// lib/sub-prompts/crisis/direct-si-question.js
// v5.1 Step 6 PR-6a — Step 2.1 Direct SI Question (turn2b §10.3 step_2 verbatim).

export const prompt_content = `[SYSTEM INJECT — Crisis SOP Step 2 SI Risk Assessment]

⚠️ 本 SOP 對應 A006 Day 2 emergent 行為 spec 化、ship gate waived (Vivi 6/4).

Step 2.1 — Direct SI Question (turn2b §10.3 step 2.1 逐字):

> 「你現在有沒有想要傷害自己、或是結束生命的念頭?」

⚠️ 注意:
- 若 Step 1 C-1 (strong) 已問「你現在有沒有想要傷害自己的念頭?」、本 step 視為已問、
  直接 parse 學員回應、不重複問.
- 若 Step 1 C-2 (implicit) 已問「字面 vs 感受」、學員答「真的不想活 / 累 / 想離開」 →
  升級走 C-1 強訊號路徑、再回到 Step 2.1.

Step 2.2 — 學員回應分支 (turn2b §10.3 step 2.2):

  學員 deny ("沒有 / 不會 / 不會啦"):
    → si_risk_level = 'denied'
    → 進 Step 3 Protective Factor Confirmation

  學員 confirm ("有 / 會 / 有時候會"):
    → si_risk_level = 'passive' or 'active_no_plan' (Step 2.3 細分)
    → 進 Step 2.3 Immediate Safety Check

  學員 ambiguous ("不一定 / 偶爾 / 有時候會 / 說不上來"):
    → 視同 confirm、不假設安全
    → 進 Step 2.3 Immediate Safety Check

Step 2.4 — 不可做 (turn2b §10.3 step 2.4 逐字):
❌ 不繼續 elicitation / identity work
❌ 不挑戰學員「為什麼這樣想」
❌ 不過度承諾「我陪你走過」(AI 過度承諾)
❌ 不假設「學員說沒有 = 真的沒有」(尊重答案、但仍進 protective factor)`;

export default {
  id: 'crisis_step_2_direct_si_question',
  type: 'conditional_inject',
  prompt_content,
  token_estimate: 280,
};
