// lib/detector-handlers/engine-1-signals/s1-external-locus.js
// S1 external_locus_signals — Gap #1 + Gap #22 (控制權外包 / 受害者陳述).
// 對齊 v51_engine_1_errata.md §A1 S1.

import {
  matchGroups, classifyIntensity, SCORE_DELTAS, INTENSITY,
  SELF_CONTEXT_REGEX, FACT_INDICATOR_REGEX, EMOTION_VALUE_REGEX,
} from './_base.js';

export const SIGNAL = 'external_locus';

// 4 groups per spec.
export const GROUPS = Object.freeze({
  group_a_control_outsource: /我得.{0,10}(看|聽|靠).{0,10}(他|她|別人|大家|爸媽|家人)|(沒人|沒有人).{0,5}我就(沒|不能|無法)|都要看.{0,5}(臉色|意思|想法)|如果.{0,8}(不|沒)(選|愛|認可|喜歡|理我).{0,5}我就/,
  group_b_he_chose_other:    /(他|她|對方).{0,5}選(了)?(別人|誰|那個)|(我|又)(沒|不)被選|(我|又)(沒|不)被(看見|選擇|認可|愛|挑)|(我|又)是被(捨棄|拋棄|放棄)的/,
  group_c_waiting:           /(等|期待|希望).{0,5}(緣分|對的人|機會|老天)|(等|希望).{0,5}我才(能|會|可以)/,
  group_d_victim_statement:  /(他|她|他們|大家).{0,5}害我|(都是|因為).{0,8}所以我才|如果不是.{0,8}我就/,
});

/**
 * Context filter (per spec):
 *   排除事實陳述 / 詢問句 / 無 self-context 描述
 *   確認需 self-context + 情緒/value/自我評估 context
 *
 * @param {string} text
 * @param {string[]} prevTurns
 * @returns {boolean}
 */
export function contextOK(text, prevTurns = []) {
  if (typeof text !== 'string' || text.length === 0) return false;
  // Exclude fact-statement framing.
  if (FACT_INDICATOR_REGEX.test(text)) return false;
  const turnBlob = [text, ...(Array.isArray(prevTurns) ? prevTurns : [])].join(' ');
  if (!SELF_CONTEXT_REGEX.test(turnBlob)) return false;
  if (!EMOTION_VALUE_REGEX.test(turnBlob)) return false;
  return true;
}

/**
 * Detect S1 external_locus signals in a user turn.
 *
 * @param {string} text
 * @param {object} sessionState
 * @param {string[]} prevTurns - recent turns (for context window)
 * @returns {{
 *   hit: boolean,
 *   intensity?: 'weak'|'medium'|'strong',
 *   groups_matched?: string[],
 *   context_filter_blocked?: boolean,
 *   score_delta?: number,
 * }}
 */
export function detect(text, sessionState = {}, prevTurns = []) {
  const groupsHit = matchGroups(GROUPS, text);
  if (groupsHit.length === 0) return { hit: false };
  if (!contextOK(text, prevTurns)) {
    return { hit: false, context_filter_blocked: true, groups_matched: groupsHit };
  }
  const intensity = classifyIntensity(groupsHit, sessionState);
  const score_delta = SCORE_DELTAS.external_locus[intensity];
  return { hit: true, intensity, groups_matched: groupsHit, score_delta };
}
