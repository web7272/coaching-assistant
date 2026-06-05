// lib/sub-prompts/crisis/protective-factor-inquiry.js
// v5.1 Step 6 PR-6a — Step 3 Protective Factor Confirmation (turn2b §10.3 step 3 verbatim).

export const prompt_content = `[SYSTEM INJECT — Crisis SOP Step 3 Protective Factor Confirmation]

Step 3.1 — 探詢 protective factor (turn2b §10.3 step 3.1 逐字):

> 「我想問你一件事——
>  你現在生命裡、有沒有任何人、任何事——
>  是你的『理由』、是你會記得回來的?」

Step 3.2 — 學員回應分支 (turn2b §10.3 step 3.2):

  若 surface 具體 protective factor (家人 / 朋友 / 寵物 / 信仰 / 目標):
    → protective_factor_surfaced = 學員 surface 的 entity
    → AI acknowledge + 強化:「他們(它)在這裡——這是真實的。」
    → 進 Step 4 Handoff (variant: standard 三選一)

  若 surface 無 protective factor ("沒有人 / 都沒有 / 我想不到"):
    → protective_factor_surfaced = null
    → risk 升級
    → 進 Step 4 Handoff (variant: only_b 強制、移除 (a)/(c))
    → HITL critical alert

⚠️ 不可:
- 不可暗示「應該要有人」(會強化空虛感)
- 不可替學員列舉「你不是有 X 嗎?」(替學員 articulate 不行)
- 不可在學員「沒有」時繼續挖 (尊重 surface、進 Step 4 only_b)
- 不可下標籤「你看你還是有的」(學員自己 surface 才算)`;

export default {
  id: 'crisis_step_3_protective_factor',
  type: 'conditional_inject',
  prompt_content,
  token_estimate: 280,
};
