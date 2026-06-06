// lib/sub-prompts/onboarding/step-2-articulate.js
// v5.2 第四塊 PR-a — Step 2 verbatim phrasing per spec §1.2 終審.
//
// 學員選好 category → 引導 articulate「想聚焦的是哪塊」.
// 學員回應 = active_context_name / definition 素材 (逐字、不重新詮釋).

/**
 * v5.2 spec §1.2 verbatim 終審 — Vivi 6/5 ship-ready.
 * 不改、不加、不減一字.
 */
export const STEP_2_PHRASING_VERBATIM = `你想聚焦的是哪塊`;

export const prompt_content = `[SYSTEM INJECT — v5.2 Onboarding Step 2 · Articulate]

學員已選好 category — 進 step 2 引導 articulate 想聚焦的具體範圍.

話術 (spec §1.2 verbatim, Vivi 終審):

> 「${STEP_2_PHRASING_VERBATIM}?」

⚠️ 處理規則:
- 學員 articulate 出來 → 逐字記下、不重新詮釋、不替學員改寫
- AI 不下標籤、不分析、不問為什麼想聚焦這塊
- 學員 articulate 完整句 (例「我跟先生的溝通」 / 「我在 startup 想升職」/「我的
  焦慮」) → step 3 confirm
- 學員 vague「不知道」/「都可以」 → 輕引「就你今天最想處理的那塊」, 再給空間
- 學員想加多個 → 邀請聚焦在「最想處理的那一塊」 (1 個, 21 天 program 範圍)

不可做:
❌ 不問「為什麼想聚焦這塊」 (那是 elicitation Mode 1 的工作, 不是 onboarding)
❌ 不替學員重新 phrase (學員自己的詞彙是 active_context_name 直接用)
❌ 不下評判「這個很重要 / 這個聽起來很沉重」 (中性 acknowledge)
❌ 不勸學員換 category (step 1 已定, 不回頭)

學員回應素材 → step_state.articulate_text = trim(學員話), 進 step 3 confirm.`;

export default {
  id: 'v5_2_onboarding_step_2_articulate',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  prompt_content,
  token_estimate: 220,
  source: 'v52_context_anchored_spec §1.2 verbatim 終審 (Vivi 6/5)',
};
