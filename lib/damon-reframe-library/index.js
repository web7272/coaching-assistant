// lib/damon-reframe-library/index.js
// v5.1 Step 7 PR-7a — Damon Reframe Library R1-R7 集中 spec.
//
// 對齊 v51_damon_reframe_library.md (Vivi 6/4 採納邊界 §0).
// 每個 reframe = 一個 sub-module 暴露 {meta, variants, buildInject, shouldInvoke}.
//
// Step 7 採納邊界 (Vivi 6/4 product fit review、勝過原檔字面):
// ✅ 實作: R1-R7 本體 + §9 stacking 規則 (本檔 stacking.js)
// ⏸️ 暫留 (不實作、不留 dead code、只在本 index 註記):
//    R9 As-If Frame
//    R7_C Good Enough for Now    (errata v0.2 Patch 5.1)
//    R1_D 鑽石本質                (errata v0.3 Patch 2)
//    R1_E 首席驗證官               (errata v0.3 Patch 2)
//    R7_D 包含所有問題的感恩         (errata v0.3 Patch 3)
//    R8 Bias towards Action statement (errata v0.3 Patch 4)
//    elicitation 起手 V2 3-5 生活領域 (errata v0.3 Patch 7)
//    §3 鑽石本質 motivational statement
// ❌ 廢除 (絕不實作):
//    R10 Memento Mori (含一切共生 statement)
//    §3「百萬分之一可能性」 statement
//    Hero's Welcome 影子自我變體 (errata v0.3 Patch 5)
//
// 暫留項 Vivi 之後若採納再開新 PR、目前 library 不開放這些 slot.

import { R1, R1_VARIANTS } from './r1-reclaim-source.js';
import { R2, R2_VARIANTS } from './r2-behavior-to-identity.js';
import { R3, R3_VARIANTS } from './r3-failure-as-feedback.js';
import { R4 } from './r4-money-as-fuel.js';
import { R5 } from './r5-away-from-toward.js';
import { R6 } from './r6-first-position-return.js';
import { R7, R7_VARIANTS } from './r7-slip-into-unconscious.js';
import { R11 } from './r11-negative-generalization.js';

export { R1, R2, R3, R4, R5, R6, R7, R11 };
export { R1_VARIANTS, R2_VARIANTS, R3_VARIANTS, R7_VARIANTS };

/**
 * Reframe registry — driven lookup for stacking + invocation tracker.
 * Tier per library §1.3 — tier 1 必須會 / tier 2 重要 / tier 3 輔助.
 */
export const REFRAME_REGISTRY = Object.freeze({
  R1, R2, R3, R4, R5, R6, R7, R11,
});

/**
 * Tier-1 = 出現頻率最高、影響最廣.
 * Tier-2 = 特定 cohort / 情境.
 * Tier-3 = 個別 case 輔助.
 * R11 = negative_generalization、不在原 §1.3 tier 表 (integration mode 內專用).
 */
export const REFRAME_TIERS = Object.freeze({
  R1: 1, R2: 1, R7: 1,
  R5: 2, R6: 2,
  R3: 3, R4: 3,
  R11: 2,   // 內部分類、integration mode core reframe
});

/**
 * 暫留項 — Vivi 6/4 review 沒明確採納、設計師端不能 default 推進.
 * 這個 list 只是 documentation marker; 若有人誤觸 (e.g. lookup) → 顯式 throw 引導.
 * R10 / 影子變體 / 百萬分之一 永不出現 in this map — 廢除 = 從未進入 spec.
 */
export const RESERVED_NOT_SHIPPED = Object.freeze({
  R9:    { reason: '⏸️ 暫留 As-If Frame', source: 'errata v0.2 Patch 2' },
  R7_C:  { reason: '⏸️ 暫留 Good Enough for Now', source: 'errata v0.2 Patch 5.1' },
  R1_D:  { reason: '⏸️ 暫留 鑽石本質', source: 'errata v0.3 Patch 2' },
  R1_E:  { reason: '⏸️ 暫留 首席驗證官', source: 'errata v0.3 Patch 2' },
  R7_D:  { reason: '⏸️ 暫留 包含所有問題的感恩', source: 'errata v0.3 Patch 3' },
  R8_BIAS_ACTION: { reason: '⏸️ 暫留 R8 Bias towards Action statement', source: 'errata v0.3 Patch 4' },
  ELICITATION_OPENING_V2: { reason: '⏸️ 暫留 elicitation 起手 V2 3-5 生活領域', source: 'errata v0.3 Patch 7' },
  SECTION_3_DIAMOND_ESSENCE: { reason: '⏸️ 暫留 §3 鑽石本質 statement', source: 'errata v0.3 Patch 1' },
});

/**
 * Lookup gate — guards against accidental invoke of reserved/废除 reframes.
 *
 * @param {string} id — reframe id (e.g. 'R1', 'R2', ...)
 * @returns {object} the reframe module
 * @throws if id 是 reserved 暫留項 (引導開新 PR) 或 deprecated 廢除項
 */
export function getReframe(id) {
  if (REFRAME_REGISTRY[id]) return REFRAME_REGISTRY[id];
  if (RESERVED_NOT_SHIPPED[id]) {
    throw new Error(
      `[damon-reframe-library] ${id} is reserved (not shipped): `
      + `${RESERVED_NOT_SHIPPED[id].reason} — ${RESERVED_NOT_SHIPPED[id].source}. `
      + `Open a new PR if Vivi confirms adoption.`
    );
  }
  // R10 永遠 ❌ 廢除 — explicit guard prevents accidental future revival.
  if (id === 'R10') {
    throw new Error(
      '[damon-reframe-library] R10 Memento Mori is permanently deprecated '
      + '(Vivi 6/4 product fit review). Do not implement.'
    );
  }
  throw new Error(`[damon-reframe-library] Unknown reframe id: ${id}`);
}
