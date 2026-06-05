// lib/detector-handlers/landmine-check.js
// v5.1 Step 5b (Vivi 6/4) — Top 1 Landmine Check helpers.
// 對齊 v51_engine_2_errata.md §A1+§A2.
//
// Top 1 Landmine = 學員講出來但實際是 trauma compensation / People Pleasing 殼,
//   not 真 quality. Damon 體系:Strategy 是「做什麼」, Quality 是「你是誰」.
//   Landmine values 通常 surface 為「被需要 / 被選擇 / 被認同」 等向外驗證型詞.
//
// 黑名單 tier 結構 (master-detector.QUALITY_TERMS.blacklist_tiers):
//   tier 1 absolute reject:     Status/Power/Self-worth/Fulfillment/Purpose/Meaning
//                               + 被需要/被選擇/被認同 → hard reject
//   tier 2 conditional:         安全感/開心/有意義/希望 → context guidance to Sonnet
//   tier 3 borderline + reframe: 自由/真實 → accept + reframe flag (R5 待 Step 7)
//
// State: session_state.landmine_value_check_result enum:
//   'pass'                          — 無 blacklist 命中, 通過
//   'tier1_rejected'                — tier 1 命中, 拒收 top1, deep-dig inject
//   'tier2_pending'                 — tier 2 命中, conditional guidance, Sonnet decide
//   'tier3_accepted_with_reframe'   — tier 3 命中, 接受 + reframe flag

import { masterDetector } from '../prompt-sections/conditional/engine-2/index.js';

export const LANDMINE_RESULT = Object.freeze({
  PASS:                          'pass',
  TIER1_REJECTED:                'tier1_rejected',
  TIER2_PENDING:                 'tier2_pending',
  TIER3_ACCEPTED_WITH_REFRAME:   'tier3_accepted_with_reframe',
});

/**
 * Classify a candidate term against the 3-tier blacklist.
 *
 * Used by engine-2 e2MasterHandler (when about to upgrade quality_status='owned')
 * and engine-3 e3Top1JudgeHandler (when Top 1 candidate emerges from values).
 *
 * @param {string|null|undefined} candidateTerm
 * @returns {{ tier: 'tier1'|'tier2'|'tier3'|null, term_matched: string|null, result: string }}
 */
export function classifyLandmine(candidateTerm) {
  if (typeof candidateTerm !== 'string' || candidateTerm.length === 0) {
    return { tier: null, term_matched: null, result: LANDMINE_RESULT.PASS };
  }
  const tiers = masterDetector.quality_terms.blacklist_tiers;
  // Check tiers in order (1 → 2 → 3).
  for (const term of tiers.tier1_absolute_reject) {
    if (candidateTerm.includes(term)) {
      return { tier: 'tier1', term_matched: term, result: LANDMINE_RESULT.TIER1_REJECTED };
    }
  }
  for (const term of tiers.tier2_conditional) {
    if (candidateTerm.includes(term)) {
      return { tier: 'tier2', term_matched: term, result: LANDMINE_RESULT.TIER2_PENDING };
    }
  }
  for (const term of tiers.tier3_borderline_with_reframe) {
    if (candidateTerm.includes(term)) {
      return { tier: 'tier3', term_matched: term, result: LANDMINE_RESULT.TIER3_ACCEPTED_WITH_REFRAME };
    }
  }
  return { tier: null, term_matched: null, result: LANDMINE_RESULT.PASS };
}

// ─────────────────────────────────────────────────────────
// Ship-able inject phrasing per v51 §A2 (spec gives full text — invocable now,
// completed Reframe Library R1/R2/R5 replaces Step 7).
// ─────────────────────────────────────────────────────────

/**
 * Tier 1 reject inject — student push-back phrasing per spec §A2.
 * Substitute the matched term into the template.
 *
 * @param {string} termMatched
 * @returns {string}
 */
export function buildTier1RejectInject(termMatched) {
  const term = termMatched || '這個詞';
  return `[SYSTEM INJECT — Landmine Check Tier 1 Reject]

候選 Top 1「${term}」命中 tier 1 absolute reject 名單 (Damon 體系視為 strategy, 不是 quality).
不寫 top1_value, inject deep-dig 引導.

學員 push-back 話術 (spec §A2 內含, ship-able 不依賴 Reframe Library):
> 「我聽到了。
> 但我必須直接跟你說——『${term}』這個東西、
> Damon 的體系裡、不是 quality、是 strategy。
> Strategy 是『做什麼』、quality 是『你是誰』。
>
> 讓我問你:你『${term}』時、感覺到的是什麼?那個感覺、是什麼?」

R1 深挖引導句 (spec §A2 內含, ship-able):
> 「『${term}』那個感覺、是從哪裡來的?是別人需要你給你的、還是你給出去的時候、自己感受到的?」

機制:
- 不寫 top1_value (state.landmine_value_check_result = 'tier1_rejected').
- 引導學員 surface「能給予的人」這類 underlying real quality.
- 學員若堅持「${term}」是 Top 1 (M_LM_1): 不收 owned, 標 ambiguous + handoff.

TODO(Step 7) — R1 Reframe Library 完整版接管.`;
}

/**
 * Tier 2 conditional guidance — language semantic判斷由 Sonnet 接管.
 * Per spec §A1: tier 2 命中 → 不硬拒, 改 conditional inject 一段 guidance.
 */
export function buildTier2GuidanceInject(termMatched) {
  const term = termMatched || '這個詞';
  return `[SYSTEM INJECT — Landmine Check Tier 2 Conditional Guidance]

候選 Top 1「${term}」命中 tier 2 conditional reject 名單.
語意判斷由主對話模型當下評估 (regex 判不動 — 兩面 context 判準如下).

判斷規則 (per spec §A1):
- 安全感:
   - 「我需要環境穩定」 (向外索求) → 拒, 深挖 (e.g. 「為什麼需要環境穩定?」 → underlying quality)
   - 「我是強大能 handle 變動的」 (本質強大) → 收 reframe 版 (Top 1 = 「能 handle 的」 / 「強大的」)
- 開心 / 快樂 / 幸福 / 滿足:
   - 副產品 (e.g. 「我希望可以開心」) → 拒, 深挖 「讓你開心的、是什麼?」
   - underlying「平靜中的喜悅」 (e.g. 「平靜的時候我會喜悅」) → 收
- 有意義 / 有用:
   - 向外索求 (e.g. 「我要做對社會有意義的事」) → 拒, 深挖
   - 本質 (e.g. 「我做的事自己感受到意義」) → 收
- 希望 (絕大多數拒):
   - 絕大多數情況 → 拒 + cascade S2 passive_hope (引擎 1 接管)
   - 罕見 underlying「我內在有不滅的希望感」 → 收 with caveat

行動:
- Sonnet 評估 context → 拒則進 deep-dig sequence; 收則寫 top1 + flag 'tier2_pending'
  (dashboard 觀察用).
- 若 Sonnet 不確定 → 預設拒, 安全 default.

TODO(Step 7) — R1/R5 Reframe Library 接管完整 reframe 版.`;
}

/**
 * Tier 3 reframe note — accept candidate but flag for reframe (R5 / R2 待 Step 7).
 */
export function buildTier3ReframeNote(termMatched) {
  const term = termMatched || '這個詞';
  return `[SYSTEM INJECT — Landmine Check Tier 3 Accept + Reframe]

候選 Top 1「${term}」命中 tier 3 borderline 名單. 收 + 強制 reframe.

Reframe (per spec §A1):
- 自由 → Freedom From (Away from) vs Freedom To (Toward).
  R5 Away from → Toward reframe TODO(Step 7).
  暫過渡: 「『自由』 是『離開某個束縛』, 還是『朝向某個你想要的樣子』?」
- 真實 Authenticity → Damon 推薦, 特殊優先, 直接 accept.

行動:
- 接受 Top 1 = 「${term}」.
- state.landmine_value_check_result = 'tier3_accepted_with_reframe'.
- inject 對應 reframe pattern (暫過渡, R5 Step 7 完整版接管).

TODO(Step 7) — R5 Reframe Library 完整 Away from → Toward 替換.`;
}

// ─────────────────────────────────────────────────────────
// Sustained-Landmine detector (M_LM_1) — 學員 push-back 堅持 Landmine 為 Top 1.
// ─────────────────────────────────────────────────────────

/**
 * After tier 1 reject, did the student push back insisting the Landmine is
 * still their Top 1? Triggers M_LM_1 path: 標 ambiguous + handoff.
 *
 * @param {string} text - student response after tier 1 reject
 * @returns {boolean}
 */
export function studentInsistsLandmine(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  // 1. Explicit insistence pattern (works without re-naming the Landmine term).
  if (/(我堅持|不要改|不要換|就是這個|我就是要|我要就是|還是要)/.test(text)) return true;
  // 2. Landmine term + insistence keyword (re-names the prior Landmine).
  const LANDMINE_TERM = /(被需要|被選擇|被認同|被肯定|被認可|成功|有意義|希望|被需求)/;
  const INSISTENCE   = /(就是|還是|真的|一定要|我覺得|我認為|堅持|想要|要)/;
  if (LANDMINE_TERM.test(text) && INSISTENCE.test(text)) return true;
  return false;
}
