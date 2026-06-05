// lib/detector-handlers/engine-1-signals/s6-modal-operators.js
// v5.1 Step 7 PR-7b — S6 modal_operator_signals (External Locus 弱訊號 marker).
//
// Source: v51_errata_v02_damon_supplementary_tier1_tier2.md §5.3 (Patch 5.3).
//   Damon 親口: 「Modal Operators (應該/必須) 標示了心理地圖的邊界、
//                通常反映了外部影響而非真實價值」.
//
// 觸發:
//   - 應該 / 必須 / 一定要 / 不能不 / 不該 / 得(要)
//   - Self/value/identity context (我應該 / 我必須 / 我不該)
//   - 排除事實/客觀必要 (醫生說我必須吃藥 / 上班必須打卡)  ⚠️ Vivi 指定 guard #3
//
// 強度 → 行動:
//   weak → flag only (detected = true)
//   medium → R1 Reclaim Source (External Locus 變體)
//   strong → cascade 引擎 3
//
// 累積 cross-session: modal_operator_signals_count_cumulative >= 5 →
//   引擎 3 評估 External Locus pattern 確立.

import {
  matchGroups, INTENSITY, SCORE_DELTAS,
  SELF_CONTEXT_REGEX,
} from './_base.js';

export const SIGNAL = 'modal_operator';

/**
 * Modal-operator regex groups per Damon spec.
 *   group_a 應該 / 不該         (should / should-not — most common)
 *   group_b 必須 / 一定要       (must / have-to)
 *   group_c 不能 / 不能不        (must-not)
 *   group_d 得 / 得要 / 該      (have-to / ought-to)
 */
export const GROUPS = Object.freeze({
  group_a_should:     /應該|不該/,
  group_b_must:       /必須|一定要|非.{0,3}不可/,
  group_c_must_not:   /不能不|不能.{0,4}(不|沒)|沒辦法不/,
  group_d_have_to:    /(我|你|他|她|大家|自己).{0,4}得(要|去|做|是)|該(去|要|做|的時候)/,
});

/**
 * External-attribution markers — 「醫生說 / 老闆說 / 法律規定 / 公司規定」.
 * 出現於 modal operator 之前/同句 → 排除 (是描述他人立場、不是 self-judgment).
 *
 * Vivi 6/5 spec guard #3 — 「醫生說我必須吃藥」型必須排除.
 */
export const EXTERNAL_ATTRIBUTION_REGEX =
  /(醫生|護理師|老闆|主管|警察|法官|律師|教練|專家|教授|老師|爸|媽|爸媽|父母|家人|公婆|同事|長官).{0,8}(說|要求|規定|交代|叫|希望|讓|建議|認為|覺得|告訴|跟我說|跟我講)|(法律|法規|公司規定|學校規定|合約|條款)|(根據|依照|按照).{0,8}(法律|規定|條款|合約|醫囑|專業建議)/;

/**
 * Objective-requirement markers — institutional / situational necessity.
 *   「上班必須打卡」「考試必須準時」「報稅必須在期限」 → 排除.
 */
export const OBJECTIVE_REQUIREMENT_REGEX =
  /(上班|上學|上課|工作|考試|交稅|繳費|繳稅|報名|報到|報稅|遵守|出席|簽到|考勤|打卡|體檢|續約|續保|繳房租|繳水電|還款|簽約|搭機|登機|安檢|海關|入境|出境|落地簽).{0,8}(必須|得|要|應該|不能)|(駕照|身分證|健保卡|護照).{0,8}(必須|要|得|應該)/;

/**
 * Identity / value / self-judgment confirmation — strengthens modal operator
 * as inner critic (vs descriptive). At least one of these MUST co-occur:
 *   self pronoun + modal operator → self-judgment context.
 *   value-state + modal operator → identity-claim context.
 */
export const IDENTITY_VALUE_CONTEXT_REGEX =
  /(我|自己|我這|我這個|我這樣|自己這樣)/;

/**
 * Context filter per spec.
 *   排除: 描述性 (醫生說 / 老闆說) / 客觀必要 (上班必須打卡).
 *   確認: self/value/identity context.
 *
 * @param {string} text
 * @returns {boolean}
 */
export function contextOK(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  // Hard exclude — external attribution dominates the sentence.
  if (EXTERNAL_ATTRIBUTION_REGEX.test(text)) return false;
  // Hard exclude — objective situational necessity (上班/考試/etc).
  if (OBJECTIVE_REQUIREMENT_REGEX.test(text)) return false;
  // Require self/identity/value context — 我 / 自己 etc.
  if (!IDENTITY_VALUE_CONTEXT_REGEX.test(text)) return false;
  return true;
}

/**
 * Classify intensity per spec §5.3:
 *   weak   = single group hit
 *   medium = multiple groups OR same-sentence multi-group
 *   strong = medium + emotional density (cumulative_ppl_score >= 0.5) /
 *                       external_locus_session_count >= 3
 *
 * @param {string[]} groupHits
 * @param {object} sessionState
 * @returns {'weak'|'medium'|'strong'}
 */
export function classifyIntensity(groupHits, sessionState = {}) {
  if (!Array.isArray(groupHits) || groupHits.length === 0) return INTENSITY.WEAK;
  const ppl = Number(sessionState?.cumulative_ppl_score ?? 0);
  const s1Count = Number(sessionState?.external_locus_count_this_session ?? 0);
  if (groupHits.length >= 2) {
    if (ppl >= 0.5 || s1Count >= 3) return INTENSITY.STRONG;
    return INTENSITY.MEDIUM;
  }
  return INTENSITY.WEAK;
}

/**
 * Detect S6 modal_operator signals in a user turn.
 *
 * @param {string} text
 * @param {object} sessionState
 * @returns {{
 *   hit: boolean,
 *   intensity?: 'weak'|'medium'|'strong',
 *   groups_matched?: string[],
 *   context_filter_blocked?: boolean,
 *   context_filter_reason?: 'external_attribution'|'objective_requirement'|'no_self_context',
 *   score_delta?: number,
 * }}
 */
export function detect(text, sessionState = {}) {
  const groupsHit = matchGroups(GROUPS, text);
  if (groupsHit.length === 0) return { hit: false };
  // Diagnose which guard rejected — useful for Beta校準 false-positive analysis.
  if (EXTERNAL_ATTRIBUTION_REGEX.test(text)) {
    return {
      hit: false, context_filter_blocked: true,
      context_filter_reason: 'external_attribution',
      groups_matched: groupsHit,
    };
  }
  if (OBJECTIVE_REQUIREMENT_REGEX.test(text)) {
    return {
      hit: false, context_filter_blocked: true,
      context_filter_reason: 'objective_requirement',
      groups_matched: groupsHit,
    };
  }
  if (!IDENTITY_VALUE_CONTEXT_REGEX.test(text)) {
    return {
      hit: false, context_filter_blocked: true,
      context_filter_reason: 'no_self_context',
      groups_matched: groupsHit,
    };
  }
  const intensity = classifyIntensity(groupsHit, sessionState);
  const score_delta = SCORE_DELTAS.modal_operator[intensity];
  return { hit: true, intensity, groups_matched: groupsHit, score_delta };
}
