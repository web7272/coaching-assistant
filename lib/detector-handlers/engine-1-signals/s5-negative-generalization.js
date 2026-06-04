// lib/detector-handlers/engine-1-signals/s5-negative-generalization.js
// S5 negative_generalization_signals — Gap #4 (重複頻率 / 過去式累積 / 身份標籤化).
// 對齊 v51_engine_1_errata.md §A1 S5.
//
// ⭐ 「又」字: Damon 特別點名為 negative generalization 的關鍵 trigger word.

import {
  matchGroups, SCORE_DELTAS, SELF_CONTEXT_REGEX,
} from './_base.js';

export const SIGNAL = 'negative_generalization';

// 3 groups per spec.
export const GROUPS = Object.freeze({
  // Damon 特別點名「又」字 — broaden beyond (被|沒|不|是) to cover natural phrasing
  //   like 「又遲到」「又錯了」「又失敗」. SPECIFIC_EVENT_REGEX context filter still
  //   excludes pure narration, but「又 + verb」 always indicates repetition perception.
  group_a_repetition_freq:    /又(被|沒|不|是|遲到|錯|失敗|搞砸|沒辦法|做錯|一次)|(每次|每一次).{0,5}(都|就)|(總是|永遠|一直).{0,5}(被|沒|不|是)|(從來|從沒).{0,5}(被|有過|過)|(很多次了|常常|經常)/,
  group_b_past_accumulated:   /(過去|這).{0,3}(年|月|這幾次|幾段).{0,5}都|(以前|之前).{0,5}(也|就)是/,
  group_c_identity_label:     /(我就是|我這種人|我這樣的人)|我永遠都|(被|是).{0,5}(那種|這種).{0,5}的人/,
});

// Positive generalization — exclude.
// 「我總是很努力」「我每次都贏」 (positive accumulation).
const POSITIVE_GEN_REGEX = /(總是|永遠|一直|每次).{0,5}(很|超|非常|都).{0,5}(努力|認真|贏|成功|快樂|好|棒)/;
// Specific event — 「我今天又遲到了」 narrating a single event, not generalization.
const SPECIFIC_EVENT_REGEX = /(今天|剛剛|現在|這次).{0,5}(發生|遲到|出錯|做錯)/;

/**
 * Context filter (per spec):
 *   排除 specific event 客觀描述 / 積極 generalization
 *   「又」字 Damon 特別點名 — 即便其他 filter 中性也要保留偵測, 除非 specific event 明確.
 */
export function contextOK(text, prevTurns = []) {
  if (typeof text !== 'string' || text.length === 0) return false;
  if (POSITIVE_GEN_REGEX.test(text)) return false;
  // 「又」字保留: 即便看似具體事件, 「又」反映重複感、值得偵測.
  if (SPECIFIC_EVENT_REGEX.test(text) && !/又/.test(text)) return false;
  const turnBlob = [text, ...(Array.isArray(prevTurns) ? prevTurns : [])].join(' ');
  return SELF_CONTEXT_REGEX.test(turnBlob);
}

/**
 * Detect S5 negative_generalization signals.
 *
 * @returns {{ hit:boolean, groups_matched?:string[], context_filter_blocked?:boolean, score_delta?:number, you_word_present?:boolean }}
 */
export function detect(text, sessionState = {}, prevTurns = []) {
  const groupsHit = matchGroups(GROUPS, text);
  if (groupsHit.length === 0) return { hit: false };
  if (!contextOK(text, prevTurns)) {
    return { hit: false, context_filter_blocked: true, groups_matched: groupsHit };
  }
  // Flat +2 per spec. Track 又-word presence — Damon 特別點名.
  const youWordPresent = /又/.test(text);
  return {
    hit: true,
    groups_matched: groupsHit,
    score_delta: SCORE_DELTAS.negative_generalization.every_hit,
    you_word_present: youWordPresent,
  };
}
