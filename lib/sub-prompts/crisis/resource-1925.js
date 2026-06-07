// lib/sub-prompts/crisis/resource-1925.js
// v5.1 Step 6 PR-6a + 6/6 wording 修訂 — Step 5 1925 Resource Offering.
//
// ⭐ 6/6 dedupe gate: AI-facing phrasing imported from _phrasings.js (single
//    source of truth). See ./_phrasings.js for the history & rationale.

import { STEP_5_1_HOTLINE_1925 } from './_phrasings.js';

const STEP_5_1_STANDARD = `Step 5.1 — 標準 1925 提供 (Vivi 6/6 終審, source: _phrasings.js):

> ${STEP_5_1_HOTLINE_1925.split('\n').join('\n> ')}

trigger: passive_death_wish 觸發 OR SI confirmed (denied + protective factor 路徑也可選性提供).`;

const STEP_5_2_DECLINED = `Step 5.2 — 學員拒絕 1925 (turn2b §10.3 step 5.2 逐字):

學員 surface「我不會打」/「我打過了沒用」/「我不需要」:

AI acknowledge、不強推:

> 「我聽到了。
>  1925 就在那裡、你不需要打。
>  但如果你某天想打、它都在。」

機制:
- 設 professional_referral_refused = true (cross-session carry_forward 欄, landing errata §2.2).
- 進 Step 6 Landing Page Reminder (variant C 觸發條件之一).
- 不重複提 1925 (M72 不糾纏).`;

const STEP_5_3_FORBIDDEN = `Step 5.3 — 不可做 (turn2b §10.3 step 5.3 逐字):

❌ 不重複強推 1925 (尊重學員決定)
❌ 不假設「不打 1925 = 不嚴重」
❌ 不質問「為什麼不打」`;

/**
 * Get Step 5 inject by sub-step.
 *
 * @param {string} substep — 'standard' | 'declined' | 'forbidden_summary'
 * @returns {string}
 */
export function getResource1925Inject(substep) {
  const header = `[SYSTEM INJECT — Crisis SOP Step 5 1925 Resource (${substep})]\n\n`;
  switch (substep) {
    case 'standard':         return header + STEP_5_1_STANDARD + '\n\n' + STEP_5_3_FORBIDDEN;
    case 'declined':         return header + STEP_5_2_DECLINED + '\n\n' + STEP_5_3_FORBIDDEN;
    case 'forbidden_summary':return header + STEP_5_3_FORBIDDEN;
    default:
      throw new Error(`getResource1925Inject: unknown substep ${substep}`);
  }
}

export const STEP_5_SUBSTEPS = Object.freeze(['standard', 'declined', 'forbidden_summary']);

export default {
  id: 'crisis_step_5_resource_1925',
  type: 'conditional_inject',
  getResource1925Inject,
  token_estimate: 360,
};
