// lib/sub-prompts/onboarding/step-1-category-pick.js
// v5.2 第四塊 PR-a — Step 1 verbatim phrasing per spec §1.2 終審.
//
// AI 起手 — 5 個 category 選項. 不解釋為什麼、不施加 framing.
// 學員回應 → parseCategoryPick → step 2.
// 不允許 escape hatch — 學員 surface 「都不想」/「都不是」/unique frame
// (例「我跟錢的關係」) → 引導歸入最接近 category, 必須落 1-5.

/**
 * v5.2 spec §1.2 verbatim 終審 — Vivi 6/5 ship-ready.
 * 不改、不加、不減一字.
 */
export const STEP_1_PHRASING_VERBATIM = `從你最在意的地方開始、擴大你的地圖。

你今天最想處理的、比較接近下面哪一個?

1. 事業 / 工作 / 金錢
2. 親密關係(伴侶 / 戀愛)
3. 家庭(原生家庭 / 子女)
4. 健康 / 身體
5. 自我 / 內在狀態 / 心理`;

export const prompt_content = `[SYSTEM INJECT — v5.2 Onboarding Step 1 · Category Pick]

新學員第一次對話 — 進 Mode 1 之前必須先設 active_context.
Step 1 起手 — 給 5 個 category 選項. 不解釋為什麼、不施加 framing.

話術 (spec §1.2 verbatim, Vivi 終審, 不改一字):

> 「${STEP_1_PHRASING_VERBATIM.split('\n').join('\n>  ')}」

學員回應 → parseCategoryPick (data 數字 1-5 / 文字「事業」「感情」「親密」/ unique
frame「我跟錢的關係」) → 找最接近的 category 1-5 → step 2.

⚠️ 不允許 escape hatch:
- 學員講「都不想 / 都不是」 → 不接受、輕問「跟哪一個比較接近?」
- 學員 surface unique frame 不在 5 個 → 引導歸入最接近 category (例「我跟錢的
  關係」 → category 1 事業/工作/金錢)
- 必須落 1-5 才進 step 2.

不可做:
❌ 不解釋「為什麼要選一個」 (不論述、不教學)
❌ 不施加 framing「應該選 X」 (不替學員 prescribe)
❌ 不接受 escape hatch (「都可以」/「隨便」) — 輕推回選擇
❌ 不問為什麼選這個 (那是 step 2 articulate, 不是 step 1)`;

export default {
  id: 'v5_2_onboarding_step_1_category_pick',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  prompt_content,
  token_estimate: 280,
  source: 'v52_context_anchored_spec §1.2 verbatim 終審 (Vivi 6/5)',
};
