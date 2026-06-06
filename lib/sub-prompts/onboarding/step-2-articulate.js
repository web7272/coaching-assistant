// lib/sub-prompts/onboarding/step-2-articulate.js
// v5.2 第四塊 PR-a + 6/6 hotfix — Step 2 verbatim phrasing per spec §1.2 終審.
//
// 學員選好 category → 引導 articulate「想聚焦的是哪塊」.
// 學員回應 = active_context_name / definition 素材 (逐字、不重新詮釋).
//
// ⭐ 6/6 hotfix #1 (Vivi 沙盒 bug): step 2 anchor must follow in-flight
//    onboarding_step.picked_category, NOT students.active_context_category
//    (which is migration 029 default 1 during onboarding — would anchor 事業
//    regardless of student step-1 pick). buildStep2Inject(pickedCategory)
//    bakes the correct category label into the inject so the AI grounds on
//    the right category. chat.js separately suppresses the active-context
//    block when onboardingTookTurn=true so stale studentRow can't override.
//
// ⭐ 6/6 hotfix #2 (Vivi phrasing): 處理 → 探索 in 學員 vague re-prompt
//    fragments and the "想加多個" invitation. Internal "處理規則" headings
//    are system-side language and stay.

/**
 * v5.2 spec §1.2 verbatim 終審 — student-facing 2-line phrasing.
 *
 * ⭐ 6/6 hotfix v3 (Vivi 6/6 沙盒 #3): 原 spec §1.2「你想聚焦的是哪塊」太空泛、
 *    沒 acknowledge 學員 step 1 選的領域. 改成 2-line form 顯式 acknowledge:
 *      你選的是「{category_full_label}」。
 *
 *      想聚焦這裡面的哪一塊?
 *    {category_full_label} 來自 in-flight onboarding_step.picked_category.
 *    設計師 spec §1.2 step 2 需同步.
 *
 * @param {number|null|undefined} pickedCategory
 * @returns {string}
 */
export function buildStep2Phrasing(pickedCategory) {
  const label = categoryLabelFor(pickedCategory);
  return `你選的是「${label}」。

想聚焦這裡面的哪一塊?`;
}

// ─── Category labels (full label per spec §1.2 + migration 029) ──
//
// kept LOCAL to onboarding sub-prompts (self-contained spec phrasing) — same
// strings appear in step-1 STEP_1_PHRASING_VERBATIM and in CATEGORY_LABELS
// elsewhere. They mirror migration 029 enum 1..5.
const CATEGORY_LABELS_FULL = Object.freeze({
  1: '事業 / 工作 / 金錢',
  2: '親密關係(伴侶 / 戀愛)',
  3: '家庭(原生家庭 / 子女)',
  4: '健康 / 身體',
  5: '自我 / 內在狀態 / 心理',
});

/**
 * @param {number|null|undefined} pickedCategory
 * @returns {string} full label, or defensive fallback if category invalid.
 */
function categoryLabelFor(pickedCategory) {
  const c = Number(pickedCategory);
  if (Number.isFinite(c) && c >= 1 && c <= 5) return CATEGORY_LABELS_FULL[c];
  return '[step 1 學員所選 category]';
}

/**
 * Build the step-2 inject with the in-flight picked category baked in.
 *
 * @param {number} [pickedCategory] - 1..5 (from onboarding_step.picked_category)
 * @returns {string}
 */
export function buildStep2Inject(pickedCategory) {
  const label = categoryLabelFor(pickedCategory);
  const catNum = Number(pickedCategory);
  const catStr = (Number.isFinite(catNum) && catNum >= 1 && catNum <= 5) ? String(catNum) : '?';
  return `[SYSTEM INJECT — v5.2 Onboarding Step 2 · Articulate]

學員 step 1 已選 category ${catStr} (${label}) — 進 step 2 引導 articulate 想聚焦的具體範圍.

⚠️ 本 turn anchor: 「${label}」(in-flight onboarding_step.picked_category).
   students.active_context 此時尚未寫入 (step 3 confirm 後才寫). AI 後續 phrasing
   必須以「${label}」為 anchor、不得套用 students 表 default(預設 1 事業).

話術 (spec §1.2 verbatim + 6/6 v3 hotfix, Vivi 6/6 終審):

> ${buildStep2Phrasing(pickedCategory).split('\n').join('\n> ')}

⚠️ 處理規則:
- 學員 articulate 出來 → 逐字記下、不重新詮釋、不替學員改寫
- AI 不下標籤、不分析、不問為什麼想聚焦這塊
- 學員 articulate 完整句 (例「我跟先生的溝通」 / 「我在 startup 想升職」/「我的
  焦慮」) → step 3 confirm
- 學員 vague「不知道」/「都可以」 → 輕引「就你今天最想探索的那塊」, 再給空間
- 學員想加多個 → 邀請聚焦在「最想探索的那一塊」 (1 個, 21 天 program 範圍)

不可做:
❌ 不問「為什麼想聚焦這塊」 (那是 elicitation Mode 1 的工作, 不是 onboarding)
❌ 不替學員重新 phrase (學員自己的詞彙是 active_context_name 直接用)
❌ 不下評判「這個很重要 / 這個聽起來很沉重」 (中性 acknowledge)
❌ 不勸學員換 category (step 1 已定, 不回頭)

學員回應素材 → step_state.articulate_text = trim(學員話), 進 step 3 confirm.`;
}

// Backwards-compat static export (callers that don't know picked_category yet
// — defensively falls back to placeholder. Handler always calls buildStep2Inject
// with the real picked_category from prevState).
export const prompt_content = buildStep2Inject(null);

export default {
  id: 'v5_2_onboarding_step_2_articulate',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  prompt_content,
  buildStep2Inject,
  buildStep2Phrasing,
  token_estimate: 270,    // +30 for the category-anchor banner + 6/6 v3 longer phrasing
  source: 'v52_context_anchored_spec §1.2 verbatim (Vivi 6/5) + 6/6 hotfix (picked_category anchor + 探索) + 6/6 v3 (acknowledge picked category in phrasing)',
};
