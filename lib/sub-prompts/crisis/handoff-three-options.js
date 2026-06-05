// lib/sub-prompts/crisis/handoff-three-options.js
// v5.1 Step 6 PR-6a — Step 4 Handoff Escalation (turn2b §10.3 step 4 verbatim).
//
// 4.1 standard 三選一 (a/b/c)        — trauma / worth fiction / passive_dw 首次 + SI denied
// 4.2 remove_c (a/b only)             — passive_death_wish_count >= 3
// 4.3 only_b forced (b 強制 + 1925)  — SI confirm 有計畫 OR 無 protective factor
// 4.4 freeze                          — passive_death_wish_count >= 5 (Patch 23 C-4 已 ship)

const HANDOFF_4_1_STANDARD = `Step 4.1 — 標準三選一 (turn2b §10.3 step 4.1 逐字):

> 「你現在比較想要:
>  (a) 先停在這、不繼續挖、我們改聊輕一點的
>  (b) 我幫你預約跟 Vivi 1-on-1、有個真人陪你走這段
>  (c) 我們先回到日常、Future Pacing、過陣子再回來看
>  你選哪個都可以——我不繼續推進。」

trigger 條件: trauma / worth fiction / passive_dw 首次觸發 + SI denied / has protective factor.
choice 推進規則:
  (a) → §10.4 natural_completion (resume previous primary, light touch)
  (b) → §10.4 vivi_intervention (program pause, HITL Vivi notification)
  (c) → §10.4 daily_break (session end, carry_forward, passive_death_wish_count += 1)
所有 choice 完成後 → 進 Step 5 1925 (若 passive_dw / SI confirmed).`;

const HANDOFF_4_2_REMOVE_C = `Step 4.2 — 強制移除 (c) (turn2b §10.3 step 4.2 逐字):

trigger 條件: passive_death_wish_count >= 3 (cross-session 累積).

> 「你現在比較想要:
>  (a) 先停在這、不繼續挖、我們改聊輕一點的
>  (b) 我幫你預約跟 Vivi 1-on-1、有個真人陪你走這段
>  你選哪個都可以——我不繼續推進。」

機制:
- (c) 「繞回日常」= 否認問題、累積 >= 3 不再允許.
- passive_dw_escalated = true → flag Vivi dashboard.
- 對應 Step 1 C-3 變體 (PR-23b 已 ship).`;

const HANDOFF_4_3_ONLY_B = `Step 4.3 — 強制移除 (a)/(c)、只剩 (b) (turn2b §10.3 step 4.3 逐字):

trigger 條件: SI confirm 有計畫 (active_with_plan) OR 無 protective factor.

> 「我聽到了。
>  你現在最需要的、是一個真人在你旁邊——
>  我幫你預約跟 Vivi 1-on-1、今天就會聯絡你。
>
>  同時、台灣有個地方可以接住你:
>  **自殺防治專線 1925**(24 小時、免費)
>  你不需要『真的要做什麼』才能打。只是很重、打過去就可以。」

機制:
- 不給選擇權、強制走 (b) + 1925.
- HITL critical alert (即時、不等到 session 結束).
- handoff_choice 自動寫 'b'.
- 進 Step 6 Landing Page Reminder (跳 Step 5、1925 已在 4.3 內提供).`;

const HANDOFF_4_4_FREEZE = `Step 4.4 — Freeze (turn2b §10.3 step 4.4 逐字):

trigger 條件: passive_death_wish_count >= 5 (cross-session 累積).

> 「我看到你回來了。Vivi 知道你的狀況、她會直接聯絡你。」

⚠️ 此 phrasing 在學員「下次發 message」時 AI 第一句使用 (本 turn 已 freeze).

機制:
- 本 turn freeze AI 推進、強制轉介、HITL critical alert immediate.
- 對應 Step 1 C-4 freeze 變體 (PR-23b 已 ship, prompt_content_passive_dw_freeze).
- 完整 Step 1 C-4 phrasing 已含承認 + 強制 (b) + 1925 + 禁止段.`;

/**
 * Get Step 4 inject by variant.
 *
 * @param {string} variant — 'standard' | 'remove_c' | 'only_b' | 'freeze'
 * @returns {string}
 */
export function getHandoffInject(variant) {
  const header = `[SYSTEM INJECT — Crisis SOP Step 4 Handoff Escalation (${variant})]\n\n`;
  switch (variant) {
    case 'standard': return header + HANDOFF_4_1_STANDARD;
    case 'remove_c': return header + HANDOFF_4_2_REMOVE_C;
    case 'only_b':   return header + HANDOFF_4_3_ONLY_B;
    case 'freeze':   return header + HANDOFF_4_4_FREEZE;
    default:
      throw new Error(`getHandoffInject: unknown variant ${variant}`);
  }
}

export const HANDOFF_VARIANTS_AVAILABLE = Object.freeze([
  'standard', 'remove_c', 'only_b', 'freeze',
]);

export default {
  id: 'crisis_step_4_handoff_escalation',
  type: 'conditional_inject',
  getHandoffInject,
  token_estimate: 640,
};
