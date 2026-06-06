// lib/sub-prompts/onboarding/step-3-confirm.js
// v5.2 第四塊 PR-a + 6/6 hotfix — Step 3 verbatim phrasing per spec §1.2 終審.
//
// AI reflects 學員 step 2 articulate → confirm 「這 21 天聚焦在『X』、對嗎?」
// confirm → 寫入 students + onboarded=TRUE → 進 Mode 1.
// 修正 → 回 step 2 重新 articulate.
//
// ⭐ 6/6 hotfix (Vivi 沙盒 bug): buildPromptContent now accepts pickedCategory
//    so the system inject explicitly anchors AI on the in-flight category
//    (not stale students.active_context which is default 1 during onboarding).

// kept LOCAL to onboarding sub-prompts. Mirrors migration 029 + spec §1.2.
const CATEGORY_LABELS_FULL = Object.freeze({
  1: '事業 / 工作 / 金錢',
  2: '親密關係(伴侶 / 戀愛)',
  3: '家庭(原生家庭 / 子女)',
  4: '健康 / 身體',
  5: '自我 / 內在狀態 / 心理',
});

function categoryLabelFor(pickedCategory) {
  const c = Number(pickedCategory);
  if (Number.isFinite(c) && c >= 1 && c <= 5) return CATEGORY_LABELS_FULL[c];
  return '[step 1 學員所選 category]';
}

/**
 * v5.2 spec §1.2 verbatim 終審 — Vivi 6/5 ship-ready.
 * {{articulate}} 由 chat.js / handler 替換為 step 2 學員 articulate 原文.
 * Phrasing itself does NOT reference the category — it uses the articulate
 * text directly (學員 own words). picked_category surfaces in the surrounding
 * system inject for AI anchoring.
 */
export function buildStep3Phrasing(articulate) {
  const text = (typeof articulate === 'string' && articulate.trim().length > 0)
    ? articulate.trim() : '[step 2 學員 articulate]';
  return `好。
這 21 天、我們聚焦在『${text}』。

這樣對嗎?`;
}

/**
 * @param {string} articulate
 * @param {number} [pickedCategory] — 6/6 hotfix: anchor AI on the correct category
 * @returns {string}
 */
export function buildPromptContent(articulate, pickedCategory) {
  const phrasing = buildStep3Phrasing(articulate);
  const label = categoryLabelFor(pickedCategory);
  const catNum = Number(pickedCategory);
  const catStr = (Number.isFinite(catNum) && catNum >= 1 && catNum <= 5) ? String(catNum) : '?';
  const articulateForAnchor = (typeof articulate === 'string' && articulate.trim().length > 0)
    ? articulate.trim() : '{name}';
  return `[SYSTEM INJECT — v5.2 Onboarding Step 3 · Confirm]

學員 step 1 選 category ${catStr} (${label}) + step 2 articulate「${articulateForAnchor}」 → step 3 confirm.

⚠️ 本 turn anchor: 「${label}」(in-flight onboarding_step.picked_category).
   students.active_context 此時尚未寫入 — confirm 後 chat.js (PR-b) 才 atomic UPDATE.
   AI 不得套用 students 表 default(預設 1 事業)、必須以「${label}」為 anchor.

話術 (spec §1.2 verbatim, Vivi 終審):

> 「${phrasing.split('\n').join('\n>  ')}」

⚠️ 處理規則:
- 學員 confirm (「對 / 是 / 嗯 / 沒錯 / yes」) → 寫入 students.active_context_*
  + students.context_onboarded=TRUE + 清 onboarding_step → 進 Mode 1
  (第二塊 phrasing anchor 自動接管, 起手「在『${articulateForAnchor}』這塊、你想要什麼?」).
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
  token_estimate: 350,    // +30 for the category-anchor banner
  source: 'v52_context_anchored_spec §1.2 verbatim (Vivi 6/5) + 6/6 hotfix (picked_category anchor)',
};
