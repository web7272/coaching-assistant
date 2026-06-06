// lib/sub-prompts/onboarding/step-3-confirm.js
// v5.2 第四塊 PR-a — Step 3 verbatim phrasing per spec §1.2 終審.
//
// AI reflects 學員 step 2 articulate → confirm 「這 21 天聚焦在『X』、對嗎?」
// confirm → 寫入 students + onboarded=TRUE → 進 Mode 1.
// 修正 → 回 step 2 重新 articulate.

/**
 * v5.2 spec §1.2 verbatim 終審 — Vivi 6/5 ship-ready.
 * {{articulate}} 由 chat.js / handler 替換為 step 2 學員 articulate 原文.
 */
export function buildStep3Phrasing(articulate) {
  const text = (typeof articulate === 'string' && articulate.trim().length > 0)
    ? articulate.trim() : '[step 2 學員 articulate]';
  return `好。
這 21 天、我們聚焦在『${text}』。

這樣對嗎?`;
}

export function buildPromptContent(articulate) {
  const phrasing = buildStep3Phrasing(articulate);
  return `[SYSTEM INJECT — v5.2 Onboarding Step 3 · Confirm]

學員已 step 2 articulate → step 3 confirm.

話術 (spec §1.2 verbatim, Vivi 終審):

> 「${phrasing.split('\n').join('\n>  ')}」

⚠️ 處理規則:
- 學員 confirm (「對 / 是 / 嗯 / 沒錯 / yes」) → 寫入 students.active_context_*
  + students.context_onboarded=TRUE + 清 onboarding_step → 進 Mode 1
  (第二塊 phrasing anchor 自動接管, 起手「在『${(typeof articulate === 'string' && articulate.trim().length > 0) ? articulate.trim() : '{name}'}』這塊、你想要什麼?」).
- 學員修正 (「不對 / 還要加 / 想改 / 應該是 ...」) → 回 step 2 重新 articulate.
- 學員 vague (「不知道」/「都可以」) → 輕推「目前這個版本對嗎?改不改都可以」.

不可做:
❌ 不解釋為什麼 21 天聚焦一塊 (不論述、保持輕)
❌ 不對 articulate 內容下評判 (中性 acknowledge)
❌ 不勸學員改 (學員 confirm 就 OK、修正就回 step 2)

寫入規則 (PR-b chat.js wire):
- active_context_category = onboarding_picked_category (1-5).
- active_context_name = step 2 articulate, trim, ≤30 字 (超過截斷或請學員精簡).
- active_context_definition = step 2 articulate 完整, trim, ≤200 字.
- context_onboarded = TRUE.
- session_state.onboarding_step = null (清除, 不再 intercept).`;
}

export default {
  id: 'v5_2_onboarding_step_3_confirm',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  buildStep3Phrasing,
  buildPromptContent,
  token_estimate: 320,
  source: 'v52_context_anchored_spec §1.2 verbatim 終審 (Vivi 6/5)',
};
