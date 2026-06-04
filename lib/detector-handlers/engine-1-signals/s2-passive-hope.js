// lib/detector-handlers/engine-1-signals/s2-passive-hope.js
// S2 passive_hope_signals — Gap #7 + Gap #20 (等老天 / 等對的人 / 存在性 hope).
// 對齊 v51_engine_1_errata.md §A1 S2.
//
// ⚠️ context 含「活下去 / 死亡 / 結束生命」 → cascade 引擎 3 (passive-hope-cascade.js,
//    本檔 detect 標 death_adjacent=true, caller routes accordingly).
//    引擎 1 本檔不直接處理 death-adjacent escalation, 只 mark + 寫 state.

import {
  matchGroups, classifyIntensity, SCORE_DELTAS, INTENSITY,
  SELF_CONTEXT_REGEX, DEATH_ADJACENT_REGEX,
} from './_base.js';

export const SIGNAL = 'passive_hope';

// 3 groups per spec.
export const GROUPS = Object.freeze({
  group_a_wait_heaven:  /(等|希望|期待).{0,5}(老天|上天|天意|命運|緣分|機會)|(老天|上天).{0,5}(讓我|安排|留我|要我)|看看.{0,5}(緣分|機會|是不是)/,
  group_b_wait_person:  /(等|希望).{0,5}(對的人|那個人|有緣人|貴人)|(該來|該出現|時候到)/,
  group_c_existential:  /(總會|早晚|遲早).{0,5}(好起來|變好|改變|出現)|(只能|只好).{0,5}(等|希望|期待)/,
});

// Plan/wishing for OTHER people (not self), should be excluded.
// 「我希望我女兒考上」 — wishing for someone else.
const OTHER_TARGETED_HOPE_REGEX = /我希望.{0,10}(他|她|她們|他們|我.{0,3}(女兒|兒子|父母|爸|媽|弟弟|妹妹|朋友))/;
// Concrete planning markers — 「我打算 / 我計畫 / 我會去做」.
const CONCRETE_PLAN_REGEX = /(我打算|我計畫|我會去|我要去|我已經|我正在|我準備)/;

/**
 * Context filter (per spec):
 *   排除對他人 hope / 計畫性 wishing
 *   確認需 self future / agency 喪失 context (lack of agency / 等待 / 寄託)
 */
export function contextOK(text, prevTurns = []) {
  if (typeof text !== 'string' || text.length === 0) return false;
  if (OTHER_TARGETED_HOPE_REGEX.test(text)) return false;
  if (CONCRETE_PLAN_REGEX.test(text)) return false;
  const turnBlob = [text, ...(Array.isArray(prevTurns) ? prevTurns : [])].join(' ');
  return SELF_CONTEXT_REGEX.test(turnBlob);
}

/**
 * Is the death-adjacent context present? Used by caller to decide cascade vs.
 * light path.
 *
 * @param {string} text
 * @param {string[]} prevTurns
 * @returns {boolean}
 */
export function isDeathAdjacent(text, prevTurns = []) {
  const blob = [text, ...(Array.isArray(prevTurns) ? prevTurns : [])].join(' ');
  return DEATH_ADJACENT_REGEX.test(blob);
}

/**
 * Detect S2 passive_hope signals.
 *
 * @returns {{
 *   hit: boolean,
 *   intensity?: 'weak'|'medium'|'strong',
 *   groups_matched?: string[],
 *   context_filter_blocked?: boolean,
 *   death_adjacent?: boolean,
 *   score_delta?: number,
 * }}
 */
export function detect(text, sessionState = {}, prevTurns = []) {
  const groupsHit = matchGroups(GROUPS, text);
  if (groupsHit.length === 0) return { hit: false };
  if (!contextOK(text, prevTurns)) {
    return { hit: false, context_filter_blocked: true, groups_matched: groupsHit };
  }
  const deathAdjacent = isDeathAdjacent(text, prevTurns);
  let intensity = classifyIntensity(groupsHit, sessionState);
  // strong_death_adjacent — used by caller to immediately cascade.
  let score_delta;
  if (deathAdjacent) {
    // Per spec: weak+death-adjacent or any+death-adjacent = +10 immediate cascade weight.
    score_delta = SCORE_DELTAS.passive_hope.strong_death_adjacent;
    intensity = INTENSITY.STRONG;
  } else {
    score_delta = SCORE_DELTAS.passive_hope[intensity];
  }
  return {
    hit: true,
    intensity,
    groups_matched: groupsHit,
    death_adjacent: deathAdjacent,
    score_delta,
  };
}
