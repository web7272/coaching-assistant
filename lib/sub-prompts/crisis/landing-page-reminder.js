// lib/sub-prompts/crisis/landing-page-reminder.js
// v5.1 Step 6 PR-6a — Step 6 Landing Page 對齊 Reminder.
//
// Source: v51_section10_landing_page_errata.md §1.1 Patch 1 (verbatim, ⚠️ guard #1).
// Vivi 終審 landing errata — 變體 A/B/C 學員 facing phrasing 逐字、設計師端不改.

/**
 * 變體 A — Standard (首次 crisis 觸發、passive_death_wish_count == 1).
 * Landing errata §1.1 變體 A 逐字.
 */
export const VARIANT_A_STANDARD = `我想停在這裡、跟你說一件事——

你還記得 program 開始前、我們有提過嗎?
這個 program、不適合在重大事件中、或還在療癒中的人。
那時候的 reminder、現在更明確——

你剛才說的、值得有一個真正的諮商師 / 心理醫生陪你走。
不是 1925(那是緊急、24 小時)、是長期。

我可以陪你到今晚安全為止——但接下來、你需要的不是我。`;

/**
 * 變體 B — Cross-session 累積 (passive_death_wish_count >= 2).
 * Landing errata §1.1 變體 B 逐字.
 */
export const VARIANT_B_CUMULATIVE = `我必須再說一次——

過去幾次、你提過類似的。
這個程度、超出 program 設計的範圍。
Landing page 那時候提過、現在更明確——
你需要的是專業的諮商師 / 心理醫生、長期的陪伴。

不是 AI、不是 21 天 program、不是 1925 緊急專線——
是一個真正的人、會跟你長期工作。

我會陪你到今晚安全為止。但這個橋、我希望你走過去。`;

/**
 * 變體 C — 學員拒絕專業 resource.
 * Landing errata §1.1 變體 C 逐字.
 */
export const VARIANT_C_REFUSAL = `我聽到了。

我不會強推。
但我希望你聽見:
我不是諮商師、我也不能假裝我是。
我能做的、就是現在這個——陪你到今晚安全。

如果你某天願意找諮商師、那個門一直開著。`;

const SHARED_FORBIDDEN = `**禁止內容 (landing errata §1.1 逐字)**:
❌ 不可語氣帶責備 (「你應該找專業」 / 「你不該來這 program」)
❌ 不可暗示「我不會幫你」 (AI 仍會 Step 7 Safety Planning)
❌ 不可重複過 3 次 (M72 不糾纏、學員拒絕 → acknowledge、不糾纏)
❌ 不可在非 crisis context 主動 invoke landing page reminder (只在 crisis 觸發後 + Step 5 後)

**允許內容**:
✅ 直接、清楚的 product boundary 說明
✅ AI 自我 reposition (「我不是諮商師」)
✅ 過渡到 Step 7 Safety Planning 的橋接 (「我能做的、就是現在這個」)
✅ 留 door open (「那個門一直開著」)`;

/**
 * Select variant per landing errata §1.1 變體選擇邏輯.
 *
 * @param {object} args
 * @param {number} args.passive_death_wish_count
 * @param {boolean} args.professional_referral_refused — 學員 explicit 拒絕
 * @returns {string} 'A' | 'B' | 'C'
 */
export function selectReminderVariant({ passive_death_wish_count = 1, professional_referral_refused = false }) {
  if (professional_referral_refused) return 'C';
  if (passive_death_wish_count >= 2) return 'B';
  return 'A';
}

/**
 * Get Step 6 inject by variant key.
 *
 * @param {string} variant — 'A' | 'B' | 'C'
 * @returns {string}
 */
export function getReminderInject(variant) {
  let phrase;
  switch (variant) {
    case 'A': phrase = VARIANT_A_STANDARD; break;
    case 'B': phrase = VARIANT_B_CUMULATIVE; break;
    case 'C': phrase = VARIANT_C_REFUSAL; break;
    default:
      throw new Error(`getReminderInject: unknown variant ${variant}`);
  }
  return `[SYSTEM INJECT — Crisis SOP Step 6 Landing Page 對齊 Reminder (變體 ${variant}, Vivi 終審版)]

trigger 條件:
- crisis 觸發後 + Step 5 1925 完成後 必執行 (M71 — 跳過 = test fail).
- 變體 A: passive_death_wish_count == 1 (首次)
- 變體 B: passive_death_wish_count >= 2 (cross-session 累積)
- 變體 C: 學員 explicit 拒絕專業 resource
- (學員拒絕 → 變體 C → 不糾纏 acknowledge、進 Step 7)

⚠️ phrasing 為 Vivi 終審版逐字、設計師端不改:

> 「${phrase.split('\n').join('\n> ')}」

${SHARED_FORBIDDEN}

機制 (landing errata §1.1):
- landing_page_reminder_delivered = true 寫入 carry_forward.
- 完成後立即進 Step 7 Safety Planning (若 SI risk surface).
- reminder_offer_count <= 3 (M72 不糾纏 cap).
- Step 7 framing 改:「在 Vivi 聯絡你之前」 (不 implies AI 是 clinician).`;
}

export const REMINDER_VARIANTS_AVAILABLE = Object.freeze(['A', 'B', 'C']);

/**
 * Vivi-final snapshot exports — locked by test (guard #1: 學員 facing phrasing 不改).
 */
export const _vivi_terminal_segments = Object.freeze({
  VARIANT_A_STANDARD, VARIANT_B_CUMULATIVE, VARIANT_C_REFUSAL,
});

export default {
  id: 'crisis_step_6_landing_page_reminder',
  type: 'conditional_inject',
  selectReminderVariant,
  getReminderInject,
  token_estimate: 540,
  _vivi_terminal_segments,
};
