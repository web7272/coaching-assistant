// lib/detector-handlers/engine-1-signals/s3-frequency-illusion.js
// S3 frequency_illusion_signals — Gap #5 + Gap #19 (頻率/成績單錯覺).
// 對齊 v51_engine_1_errata.md §A1 S3.

import {
  matchGroups, SCORE_DELTAS,
  SELF_CONTEXT_REGEX, FACT_INDICATOR_REGEX, QUALITY_STATUS_REGEX,
} from './_base.js';

export const SIGNAL = 'frequency_illusion';

// 4 groups per spec.
export const GROUPS = Object.freeze({
  group_a_score_card:       /(至少要|一定要|必須).{0,5}(百分之|%|頻率|時間)|(夠不夠|算不算)(平靜|自由|愛)|(每天|每次|每週).{0,5}(都要|得)/,
  group_b_passing_score:    /(及格|達標|過關)|(50%|百分之 ?50|一半|大部分)|(全部|百分之百|100%|24 小時|永遠).{0,3}(是|做到)/,
  // group_c: 「真正X的人(頻率)更高/多/常」 — loosened for natural phrasing
  //   (e.g. 「真正自由的人頻率要更高」, 「真的平靜的人頻率更高」).
  group_c_freq_comparison:  /(真正|真的).{0,8}的人.{0,8}更(高|多|常)|(只有|只是).{0,5}(有時候|偶爾)/,
  group_d_self_check:       /(今天|現在|這禮拜).{0,5}(我有沒有|我夠不夠)|(檢查|確認|看).{0,5}我是不是/,
});

// Asking ABOUT other people's frequency (not self) — exclude.
const ASKING_OTHERS_REGEX = /(他|她|他們).{0,5}(算不算|是不是|多少|頻率)/;

/**
 * Context filter (per spec):
 *   排除客觀頻率描述 / 詢問他人
 *   確認需身份判定 / quality status context (自我評估身份相對某 quality 的頻率)
 */
export function contextOK(text, prevTurns = []) {
  if (typeof text !== 'string' || text.length === 0) return false;
  if (FACT_INDICATOR_REGEX.test(text)) return false;
  if (ASKING_OTHERS_REGEX.test(text) && !SELF_CONTEXT_REGEX.test(text)) return false;
  const turnBlob = [text, ...(Array.isArray(prevTurns) ? prevTurns : [])].join(' ');
  if (!SELF_CONTEXT_REGEX.test(turnBlob)) return false;
  return QUALITY_STATUS_REGEX.test(turnBlob);
}

/**
 * Detect S3 frequency_illusion signals.
 *
 * @returns {{ hit:boolean, groups_matched?:string[], context_filter_blocked?:boolean, score_delta?:number }}
 */
export function detect(text, sessionState = {}, prevTurns = []) {
  const groupsHit = matchGroups(GROUPS, text);
  if (groupsHit.length === 0) return { hit: false };
  if (!contextOK(text, prevTurns)) {
    return { hit: false, context_filter_blocked: true, groups_matched: groupsHit };
  }
  // Flat scoring per spec (no intensity gradient).
  return {
    hit: true,
    groups_matched: groupsHit,
    score_delta: SCORE_DELTAS.frequency_illusion.every_hit,
  };
}
