// lib/detector-handlers/engine-1-signals/s4-conditional-worth.js
// S4 conditional_worth_signals — Gap #2 + Gap #21 (交易框架 / 條件性自我價值).
// 對齊 v51_engine_1_errata.md §A1 S4.
//
// Intensity:
//   weak   = group_a (一般交易句式)
//   medium = group_b (我只能型)
//   strong = group_c (條件性完整) + integration mode active → routes integration-router

import {
  matchGroups, SCORE_DELTAS, INTENSITY,
  SELF_CONTEXT_REGEX, SELF_WORTH_REGEX,
} from './_base.js';

export const SIGNAL = 'conditional_worth';

// 3 groups per spec.
export const GROUPS = Object.freeze({
  group_a_trade_pattern:        /(我|只有).{0,5}(必須|得|要).{0,5}才(能|會|可以).{0,5}(被|得到)|(若|如果).{0,3}我.{0,5}(才|就)|(沒有|不).{0,5}我就不是/,
  group_b_i_can_only:           /(我|只).{0,5}(只能|只有).{0,5}(給|做|是)|(我哪裡|我什麼).{0,5}(不夠|不行|不好)|(我這個人|我這樣).{0,5}(就是|永遠)/,
  group_c_conditional_complete: /(五|多個|所有).{0,5}(面向|方面|事).{0,5}(都要|都得)|(完美|完整|圓滿).{0,5}才(是|算|算數)/,
});

// Concrete fact-strategy (e.g. 「我必須上班才有錢」) — should NOT trigger conditional_worth
// since it's a real strategy not a self-worth bargain.
const FACT_STRATEGY_REGEX = /(必須上班|必須工作).{0,5}才.{0,5}(有錢|拿薪水|養家)/;
// 「謝謝」「不好意思」「請」 — surface polite, exclude.
const POLITE_SURFACE_REGEX = /^(謝謝|不好意思|請|對不起).{0,10}$/;

/**
 * Context filter (per spec):
 *   排除事實 strategy (「我必須上班才有錢」) / 表面 polite
 *   確認需自我價值 / 配不配 context
 */
export function contextOK(text, prevTurns = []) {
  if (typeof text !== 'string' || text.length === 0) return false;
  if (FACT_STRATEGY_REGEX.test(text)) return false;
  if (POLITE_SURFACE_REGEX.test(text)) return false;
  const turnBlob = [text, ...(Array.isArray(prevTurns) ? prevTurns : [])].join(' ');
  if (!SELF_CONTEXT_REGEX.test(turnBlob)) return false;
  return SELF_WORTH_REGEX.test(turnBlob);
}

/**
 * Map S4 group → intensity per spec mapping (group_a weak / group_b medium /
 * group_c strong).
 */
function intensityFromGroups(groupsHit) {
  if (groupsHit.includes('group_c_conditional_complete')) return INTENSITY.STRONG;
  if (groupsHit.includes('group_b_i_can_only'))           return INTENSITY.MEDIUM;
  return INTENSITY.WEAK;
}

/**
 * Detect S4 conditional_worth signals.
 *
 * @returns {{ hit:boolean, intensity?:string, groups_matched?:string[], context_filter_blocked?:boolean, score_delta?:number }}
 */
export function detect(text, sessionState = {}, prevTurns = []) {
  const groupsHit = matchGroups(GROUPS, text);
  if (groupsHit.length === 0) return { hit: false };
  if (!contextOK(text, prevTurns)) {
    return { hit: false, context_filter_blocked: true, groups_matched: groupsHit };
  }
  // S4 uses flat +2 per hit (matches spec §A4 conditional_worth: 每次+2).
  const intensity = intensityFromGroups(groupsHit);
  return {
    hit: true,
    intensity,
    groups_matched: groupsHit,
    score_delta: SCORE_DELTAS.conditional_worth.every_hit,
  };
}
