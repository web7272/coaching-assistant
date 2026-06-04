// lib/detector-handlers/engine-1-signals/engine-1-signals.test.js
// v5.1 Step 5a — Lock 5 signal detectors regex/context filter/intensity behavior.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SIGNAL_NAMES, INTENSITY, SCORE_DELTAS, THRESHOLDS,
} from './_base.js';
import * as s1 from './s1-external-locus.js';
import * as s2 from './s2-passive-hope.js';
import * as s3 from './s3-frequency-illusion.js';
import * as s4 from './s4-conditional-worth.js';
import * as s5 from './s5-negative-generalization.js';
import {
  detectAllSignals, S2_LIGHT_INJECT, S3_LIGHT_INJECT,
  S4_WEAK_INJECT, S5_INTEGRATION_INJECT,
} from './index.js';

// ─── constants ───────────────────────────────────────────

test('🛑 SIGNAL_NAMES: 5 v5.1 signals frozen', () => {
  assert.deepEqual([...SIGNAL_NAMES].sort(), [
    'conditional_worth', 'external_locus', 'frequency_illusion',
    'negative_generalization', 'passive_hope',
  ]);
});

test('SCORE_DELTAS + THRESHOLDS frozen + match v51 §A4 spec', () => {
  assert.equal(SCORE_DELTAS.external_locus.weak, 1);
  assert.equal(SCORE_DELTAS.external_locus.medium, 3);
  assert.equal(SCORE_DELTAS.external_locus.strong, 5);
  assert.equal(SCORE_DELTAS.passive_hope.strong_death_adjacent, 10);
  assert.equal(SCORE_DELTAS.frequency_illusion.every_hit, 2);
  assert.equal(THRESHOLDS.external_locus.session_r1_priority, 10);
  assert.equal(THRESHOLDS.external_locus.cumulative_hitl_alert, 20);
  assert.equal(THRESHOLDS.passive_hope.cumulative_e3_evaluate, 15);
  assert.equal(THRESHOLDS.frequency_illusion.session_r7_priority, 8);
  assert.equal(THRESHOLDS.conditional_worth.cumulative_bargain, 10);
  assert.equal(THRESHOLDS.negative_generalization.session_integration_deeper, 6);
  assert.equal(THRESHOLDS.negative_generalization.cumulative_hitl_alert, 12);
});

// ─── S1 external_locus ───────────────────────────────────

test('🛑 S1 group_a 控制權外包 (spec example) → hit', () => {
  const r = s1.detect('我得看他們的臉色才能說話, 我覺得很累', {}, []);
  assert.equal(r.hit, true);
  assert.ok(r.groups_matched.includes('group_a_control_outsource'));
});

test('🛑 S1 group_b 他選了別人 → hit', () => {
  const r = s1.detect('對方選了別人, 我又沒被選, 覺得很糟', {}, []);
  assert.equal(r.hit, true);
  assert.ok(r.groups_matched.includes('group_b_he_chose_other'));
});

test('🛑 S1 group_c 等待型 → hit', () => {
  const r = s1.detect('我等對的機會出現, 我才能出去, 覺得很無力', {}, []);
  assert.equal(r.hit, true);
  assert.ok(r.groups_matched.includes('group_c_waiting'));
});

test('🛑 S1 group_d 受害者陳述 → hit', () => {
  const r = s1.detect('都是他們害我, 我覺得很委屈', {}, []);
  assert.equal(r.hit, true);
  assert.ok(r.groups_matched.includes('group_d_victim_statement'));
});

test('🛑 S1 context filter: 事實陳述 (新聞報導風) → blocked', () => {
  const r = s1.detect('根據新聞報導, 我得看他臉色才有班可上', {}, []);
  assert.equal(r.hit, false);
  assert.equal(r.context_filter_blocked, true);
});

test('🛑 S1 intensity escalation: multi-group + PPL high → strong', () => {
  const r = s1.detect(
    '我得看別人的臉色才能說話, 對方選了別人, 我又是被拋棄的, 覺得很糟',
    { cumulative_ppl_score: 0.6 }, [],
  );
  assert.equal(r.hit, true);
  assert.equal(r.intensity, INTENSITY.STRONG);
});

// ─── S2 passive_hope ────────────────────────────────────

test('🛑 S2 group_a 等老天 → hit', () => {
  const r = s2.detect('我等老天安排吧, 自己也無能為力', {}, []);
  assert.equal(r.hit, true);
  assert.ok(r.groups_matched.includes('group_a_wait_heaven'));
});

test('🛑 S2 group_b 等對的人 → hit', () => {
  const r = s2.detect('我希望等對的人出現', {}, []);
  assert.equal(r.hit, true);
  assert.ok(r.groups_matched.includes('group_b_wait_person'));
});

test('🛑 S2 group_c 存在性 → hit', () => {
  const r = s2.detect('我只好等, 總會好起來', {}, []);
  assert.equal(r.hit, true);
  assert.ok(r.groups_matched.includes('group_c_existential'));
});

test('🛑 S2 context filter: wishing for others (hits group_b but blocked) → no signal', () => {
  // text matches group_b 「等對的人 / 該來」 surface form but is wishing for SOMEONE ELSE.
  const r = s2.detect('我希望我女兒等對的人出現', {}, []);
  assert.equal(r.hit, false);
  // Filter blocked because OTHER_TARGETED_HOPE_REGEX matched.
  assert.equal(r.context_filter_blocked, true);
});

test('🛑 S2 context filter: concrete plan → blocked', () => {
  const r = s2.detect('我打算下週去面試新工作', {}, []);
  assert.equal(r.hit, false);
});

test('🛑 S2 death_adjacent flag: passive_hope + 「不想活」 context → death_adjacent=true', () => {
  const r = s2.detect(
    '我等老天安排吧',
    {},
    ['活下去的動力越來越少', '不想活'],
  );
  assert.equal(r.hit, true);
  assert.equal(r.death_adjacent, true);
  assert.equal(r.score_delta, 10);
  assert.equal(r.intensity, INTENSITY.STRONG);
});

test('S2 non-death context → death_adjacent=false', () => {
  const r = s2.detect('我等對的人出現', {}, ['今天工作很忙']);
  assert.equal(r.hit, true);
  assert.equal(r.death_adjacent, false);
});

// ─── S3 frequency_illusion ──────────────────────────────

test('🛑 S3 group_a 成績單 → hit', () => {
  const r = s3.detect('我至少要 80% 時間平靜才算平靜的人', {}, []);
  assert.equal(r.hit, true);
  assert.ok(r.groups_matched.includes('group_a_score_card'));
  assert.equal(r.score_delta, 2);
});

test('🛑 S3 group_b 及格分數 → hit', () => {
  const r = s3.detect('我要全部時間都是自由的, 才算自由的人', {}, []);
  assert.equal(r.hit, true);
});

test('🛑 S3 group_c 頻率比較 (spec example A003) → hit', () => {
  const r = s3.detect(
    '真正自由的人頻率要更高吧, 我這樣不算',
    {}, [],
  );
  assert.equal(r.hit, true);
  assert.ok(r.groups_matched.includes('group_c_freq_comparison'));
});

test('🛑 S3 context filter: 詢問他人頻率 → blocked', () => {
  const r = s3.detect('他算不算平靜的人, 多少頻率才算?', {}, []);
  assert.equal(r.hit, false);
});

// ─── S4 conditional_worth ────────────────────────────────

test('🛑 S4 group_a 交易句式 → hit + intensity=weak', () => {
  const r = s4.detect(
    '我必須完美才能被愛, 我配不上',     // spec-conformant: 必須X才能被Y + 自我價值 context
    {}, [],
  );
  assert.equal(r.hit, true);
  assert.equal(r.intensity, INTENSITY.WEAK);
  assert.ok(r.groups_matched.includes('group_a_trade_pattern'));
});

test('🛑 S4 group_b 我只能型 → hit + intensity=medium', () => {
  const r = s4.detect(
    '我哪裡不夠? 我這個人就是這樣, 不配被愛',
    {}, [],
  );
  assert.equal(r.hit, true);
  assert.equal(r.intensity, INTENSITY.MEDIUM);
});

test('🛑 S4 group_c 條件性完整 → hit + intensity=strong', () => {
  const r = s4.detect(
    '我得完整圓滿才算是值得的人', {}, [],
  );
  assert.equal(r.hit, true);
  assert.equal(r.intensity, INTENSITY.STRONG);
});

test('🛑 S4 context filter: 事實 strategy (「必須上班才有錢」) → blocked', () => {
  const r = s4.detect('我必須上班才有錢, 不上班就沒收入', {}, []);
  assert.equal(r.hit, false);
});

test('🛑 S4 context filter: 表面 polite → blocked', () => {
  const r = s4.detect('謝謝', {}, []);
  assert.equal(r.hit, false);
});

// ─── S5 negative_generalization ─────────────────────────

test('🛑 S5 group_a 「又」字 (spec Damon 特別點名) → hit', () => {
  const r = s5.detect('我又被忽略了, 又沒有人看見我', {}, []);
  assert.equal(r.hit, true);
  assert.ok(r.groups_matched.includes('group_a_repetition_freq'));
  assert.equal(r.you_word_present, true);
});

test('🛑 S5 group_b 過去式累積 → hit', () => {
  const r = s5.detect('我過去這幾年都是這樣, 以前也是', {}, []);
  assert.equal(r.hit, true);
});

test('🛑 S5 group_c 身份標籤化 → hit', () => {
  const r = s5.detect('我就是這種人, 永遠被忽略', {}, []);
  assert.equal(r.hit, true);
});

test('🛑 S5 context filter: 積極 generalization → blocked', () => {
  const r = s5.detect('我總是非常努力工作', {}, []);
  assert.equal(r.hit, false);
});

test('S5 「又」字保留 even when specific event present', () => {
  // 「又」字 Damon 特別點名 — 即便看似 specific event 仍偵測.
  const r = s5.detect('我今天又遲到了', {}, []);
  assert.equal(r.hit, true);
});

// ─── detectAllSignals aggregator ─────────────────────────

test('🛑 detectAllSignals: A003 Day 3 case「真正自由的人頻率要更高吧」 → S3 hit', () => {
  const out = detectAllSignals({
    text: '真正自由的人頻率要更高吧, 我這樣不算',
    sessionState: {},
    userProfile: {},
    prevTurns: [],
  });
  assert.equal(out.patch.frequency_illusion_detected, true);
  assert.equal(out.patch.frequency_illusion_count_this_session, 1);
  assert.equal(out.user_profile_increments.frequency_illusion_signals, 1);
  assert.ok(out.inject_hints.frequency_illusion);
});

test('🛑 detectAllSignals: A006 Day 1 case「上天既然讓我活著」+ death-adjacent → S2 + death_adjacent flag', () => {
  const out = detectAllSignals({
    text: '我等老天安排吧',
    sessionState: {},
    userProfile: {},
    prevTurns: ['活下去的動力', '不想活'],
  });
  assert.equal(out.patch.passive_hope_detected, true);
  assert.equal(out.inject_hints.passive_hope.death_adjacent, true);
  assert.equal(out.inject_hints.passive_hope.score_delta, 10);
});

test('🛑 detectAllSignals: per-signal cumulative threshold flag set when crossing', () => {
  const out = detectAllSignals({
    text: '我又被忽略了',
    sessionState: { negative_generalization_count_this_session: 5 },
    userProfile: { negative_generalization_signals_count_cumulative: 11 },
    prevTurns: [],
  });
  // session count 5 → +1 = 6 → integration_deeper flag.
  assert.equal(out.patch.s5_integration_deeper_flag, true);
  // cumulative 11 → +1 = 12 → hitl_alert flag.
  assert.equal(out.patch.s5_hitl_alert_flag, true);
});

test('detectAllSignals: external_locus session ≥ 10 → R1 priority flag', () => {
  const out = detectAllSignals({
    text: '我得看他臉色才能說話, 覺得很累',
    sessionState: { external_locus_count_this_session: 9 },
    userProfile: {},
    prevTurns: [],
  });
  assert.equal(out.patch.s1_r1_priority_flag, true);
});

test('detectAllSignals: external_locus cumulative ≥ 20 → HITL alert flag', () => {
  const out = detectAllSignals({
    text: '對方選了別人, 我又是被拋棄的, 覺得很糟',     // S1 group_b + group_d both hit
    sessionState: {},
    userProfile: { external_locus_signals_count_cumulative: 19 },
    prevTurns: [],
  });
  assert.equal(out.patch.s1_hitl_alert_flag, true);
});

test('🛑 detectAllSignals: no signal → empty patch, false detected flags', () => {
  const out = detectAllSignals({
    text: '今天天氣不錯, 我去公園散步了',
    sessionState: {},
    userProfile: {},
    prevTurns: [],
  });
  // All 5 detected flags should be false (set explicitly).
  for (const sig of SIGNAL_NAMES) {
    assert.equal(out.patch[`${sig}_detected`], false);
  }
  assert.deepEqual(out.user_profile_increments, {});
});

test('detectAllSignals: safe log payload — no raw student text', () => {
  const out = detectAllSignals({
    text: '我又被忽略了',
    sessionState: {},
    userProfile: {},
    prevTurns: [],
  });
  const log = out.logs[0];
  assert.equal(log.event, 'engine1_signal_detected');
  assert.equal(log.signal, 'negative_generalization');
  // SAFE: text not present in log payload.
  assert.equal(log.user_response, undefined);
});

// ─── Inject content (ship-able phrasing per spec §A3) ────

test('🛑 S2_LIGHT_INJECT contains spec-given phrasing「你在等什麼?」', () => {
  assert.match(S2_LIGHT_INJECT, /你在等什麼/);
});

test('🛑 S4_WEAK_INJECT contains 紅線 23 phrasing「這個交易是誰定的?」', () => {
  assert.match(S4_WEAK_INJECT, /這個交易是誰定的/);
});

test('🛑 S5_INTEGRATION_INJECT contains spec-given「這個『又』、我想停下來」', () => {
  assert.match(S5_INTEGRATION_INJECT, /這個『又』、我想停下來/);
});

test('S3_LIGHT_INJECT references 紅線 22 pattern', () => {
  assert.match(S3_LIGHT_INJECT, /『\[X\]』是身份、不是成績單/);
});
