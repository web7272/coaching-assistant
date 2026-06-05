// lib/sub-prompts/crisis/acknowledge-variants.js
// v5.1 Step 6 PR-6a — Step 1 承認 + 不分析 reference.
//
// Source: turn2b §10.3 step_1 5 變體 (A / B / C-1 / C-2 / C-3) — phrasing ALREADY
// SHIPPED in deep-signal-detector.js via Patch 23 (PR-23a/b).
// 本檔 = SOP state machine reference shim (單一來源、不重複文案).

import {
  prompt_content as DSD_VARIANT_A_B,          // 變體 A trauma / 變體 B worth fiction
  prompt_content_passive_dw_strong as DSD_VARIANT_C_1,
  prompt_content_passive_dw_implicit as DSD_VARIANT_C_2,
  prompt_content_passive_dw_implicit_philosophical as DSD_VARIANT_C_2_PHILOSOPHICAL,
  prompt_content_passive_dw_repeat as DSD_VARIANT_C_3,
  prompt_content_passive_dw_freeze as DSD_VARIANT_C_4_FREEZE,
} from '../../prompt-sections/conditional/engine-3/deep-signal-detector.js';

/**
 * Get Step 1 inject by variant key.
 *   A / B → trauma or worth-fiction (deep-signal-detector main prompt_content).
 *   C-1 / C-2 / C-2_philosophical / C-3 / C-4_freeze → passive DW variants.
 *
 * @param {string} variant — 'A' | 'B' | 'C-1' | 'C-2' | 'C-2_philosophical' | 'C-3' | 'C-4_freeze'
 * @returns {string}
 */
export function getStep1Inject(variant) {
  switch (variant) {
    case 'A':
    case 'B':                  return DSD_VARIANT_A_B;
    case 'C-1':                return DSD_VARIANT_C_1;
    case 'C-2':                return DSD_VARIANT_C_2;
    case 'C-2_philosophical':  return DSD_VARIANT_C_2_PHILOSOPHICAL;
    case 'C-3':                return DSD_VARIANT_C_3;
    case 'C-4_freeze':         return DSD_VARIANT_C_4_FREEZE;
    default:
      throw new Error(`getStep1Inject: unknown variant ${variant}`);
  }
}

export const STEP_1_VARIANTS_AVAILABLE = Object.freeze([
  'A', 'B', 'C-1', 'C-2', 'C-2_philosophical', 'C-3', 'C-4_freeze',
]);
