// lib/sub-prompts/crisis/handoff-three-options.js
// v5.1 Step 6 PR-6a + 6/6 errata v02 — Step 4 Handoff Escalation.
//
// ⚠️ FILE NAME RETAINED for git history. Under errata v02 (Vivi 6/6), the
//    「三選一 (a)(b)(c)」 mechanic is 廢除. This file now exports 4 direct-1925
//    variants. The old name 「handoff-three-options」 is misleading but kept
//    so consumer imports don't churn.
//
// Background (Vivi 6/6 拍板):
//   - 「預約 Vivi 1-on-1」: 萬人規模不可行 — AI 不再 offer booking.
//   - 「ABC 三選一」: active SI / passive death wish 不該給選項 — 直接 1925.
//   - 留 「Vivi 主動聯絡」 (4.3b freeze) — capacity OK, 主動非 booking.
//
// Variants (errata v02 §10.3 step 4 逐字, 4 levels by SI risk + cross-session count):
//   4.1 standard          — trauma / worth fiction / passive_dw 首次
//   4.2 cumulative_2plus  — passive_death_wish_count >= 2 (was 3 under old REMOVE_C)
//   4.3 high_risk         — SI confirm + has_plan OR no protective factor
//   4.3b freeze           — passive_death_wish_count >= 5 (unchanged from 4.4)

// ─── Phrasings (single source of truth lives in _phrasings.js) ───
//
// ⭐ 6/6 dedupe gate (Vivi 6/6 終審): phrasings are NOT defined inline in this
//    file anymore — they're imported from _phrasings.js. Three consecutive
//    wording revisions (active SI fast-path / onboarding / 4917fee) shipped
//    inconsistent copies across 5 files; the dedupe + all-lib grep test is
//    the architectural fix.
//
// 6/6 wording 修訂 principles (話術定稿-crisis-去書面腔+1925台灣框.md):
//   1. 去「很重」書面腔 → 口語.
//   2. 1925 一律框「台灣」+ 非台灣兜底句.
//   3. AI 不出現「自殺」字眼 → 「安心專線 / 緊急專線」.
import {
  HANDOFF_4_1_STANDARD_PHRASING,
  HANDOFF_4_2_CUMULATIVE_PHRASING,
  HANDOFF_4_3_HIGH_RISK_PHRASING,
  HANDOFF_4_3B_FREEZE_PHRASING,
} from './_phrasings.js';

// ─── Variant inject builders (System inject wrapping the verbatim phrasing) ──

const HANDOFF_4_1_STANDARD = `Step 4.1 — 標準直接 1925 (errata v02 §10.3 step 4.1 逐字):

> ${HANDOFF_4_1_STANDARD_PHRASING.split('\n').join('\n> ')}

trigger 條件: trauma / worth_fiction / passive_dw 首次觸發 + SI denied / has protective factor.

機制:
- 不給選擇權 — Step 4 不再「三選一」(errata v02 廢除).
- 不 offer 預約 Vivi 1-on-1 (萬人規模不可行).
- AI 講完此段 → Step 5 1925 (no-op、phrasing 已內含) → Step 6 landing reminder.`;

const HANDOFF_4_2_CUMULATIVE = `Step 4.2 — Cross-session 累積引導 (errata v02 §10.3 step 4.2 逐字):

> ${HANDOFF_4_2_CUMULATIVE_PHRASING.split('\n').join('\n> ')}

trigger 條件: passive_death_wish_count >= 2 (errata v02 由 3 降為 2).
變體變更:
- 原 REMOVE_C: 「移除 (c) 回到日常」 廢除 (沒有 abc 選擇).
- 新 CUMULATIVE: 直接 1925 + 諮商師 / 心理醫生 long-term framing.

機制:
- passive_dw_escalated = true → flag Vivi dashboard.
- 對應 Step 1 C-3 變體 (PR-23b 已 ship、不動).`;

const HANDOFF_4_3_HIGH_RISK = `Step 4.3 — High-risk 直接 1925 (errata v02 §10.3 step 4.3 逐字):

> ${HANDOFF_4_3_HIGH_RISK_PHRASING.split('\n').join('\n> ')}

trigger 條件: SI confirm + has_plan (active_with_plan) OR 無 protective factor.

機制:
- HITL critical alert (即時、不等到 session 結束).
- 「真人在你旁邊」 framing — 不指名 Vivi (4.3b freeze 才主動聯絡).
- 「不需要『真的打算做什麼』才能打」 verbatim 保留 — 學員 OK 也可以打.
- 進 Step 6 Landing Page Reminder (跳 Step 5、1925 已內含).`;

const HANDOFF_4_3B_FREEZE = `Step 4.3b — Freeze + Vivi 主動聯絡 (errata v02 §10.3 step 4.3b 逐字、原 4.4):

> 「${HANDOFF_4_3B_FREEZE_PHRASING}」

trigger 條件: passive_death_wish_count >= 5 (cross-session 累積、極端).
此 phrasing 在學員「下次發 message」時 AI 第一句使用 (本 turn 已 freeze).

機制:
- 本 turn freeze AI 推進、強制轉介、HITL critical alert immediate.
- 「Vivi 知道你的狀況、她會直接聯絡你」 — 主動聯絡, 承載量 OK (errata v02 KEEP).
- 對應 Step 1 C-4 freeze 變體 (PR-23b 已 ship, prompt_content_passive_dw_freeze).`;

/**
 * Get Step 4 inject by variant.
 *
 * @param {string} variant — see HANDOFF_VARIANTS_AVAILABLE
 * @returns {string}
 */
export function getHandoffInject(variant) {
  const header = `[SYSTEM INJECT — Crisis SOP Step 4 Handoff Direct-1925 (${variant})]\n\n`;
  switch (variant) {
    case 'standard':   return header + HANDOFF_4_1_STANDARD;
    case 'cumulative':
    case 'remove_c':   // back-compat alias, deprecated
      return header + HANDOFF_4_2_CUMULATIVE;
    case 'high_risk':
    case 'only_b':     // back-compat alias, deprecated
      return header + HANDOFF_4_3_HIGH_RISK;
    case 'freeze':     return header + HANDOFF_4_3B_FREEZE;
    default:
      throw new Error(`getHandoffInject: unknown variant ${variant}`);
  }
}

// ⭐ Variant enum (canonical names + deprecated aliases for back-compat).
export const HANDOFF_VARIANTS_AVAILABLE = Object.freeze([
  'standard', 'cumulative', 'high_risk', 'freeze',
]);

// ⭐ Verbatim phrasing exports for snapshot lock tests.
export const HANDOFF_PHRASINGS_VERBATIM = Object.freeze({
  standard:   HANDOFF_4_1_STANDARD_PHRASING,
  cumulative: HANDOFF_4_2_CUMULATIVE_PHRASING,
  high_risk:  HANDOFF_4_3_HIGH_RISK_PHRASING,
  freeze:     HANDOFF_4_3B_FREEZE_PHRASING,
});

export default {
  id: 'crisis_step_4_handoff_direct_1925',
  type: 'conditional_inject',
  getHandoffInject,
  HANDOFF_PHRASINGS_VERBATIM,
  token_estimate: 480,    // was 640 — phrasing leaner (no abc, no 預約)
  source: 'v51_section10_step4_handoff_errata_v02.md (Vivi 6/6 拍板)',
};
