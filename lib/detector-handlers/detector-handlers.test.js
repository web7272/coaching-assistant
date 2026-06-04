// lib/detector-handlers/detector-handlers.test.js
// 4 engine handler 聚合測試 — regex matchers + handler orchestration + registry wiring.
// Haiku judge 全部以 ctx.judges.* mock 注入（不打網路）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchE1, e1MasterHandler, E1_DETECTOR } from './engine-1.js';
import { matchE2, runAggregator, e2MasterHandler, E2_DETECTOR } from './engine-2.js';
import {
  e3DeepSignalHandler, e3OpeningBranchHandler, e3Top1Handler,
  e3StatusRouterHandler, e3CascadeDownHandler, E3_DETECTORS,
} from './engine-3.js';
import {
  e4DayOpeningHandler, e4TakeawayHandler, e4CascadeRefHandler, e4ExportHandler, E4_DETECTORS,
} from './engine-4.js';
import { ALL_DETECTORS, registerAllDetectors } from './index.js';
import { DetectorRegistry } from '../detector/registry.js';
import { JudgeTimeoutError } from '../haiku-judge/_base.js';

// mock judges
const classifierMock = (out) => async () => out;
const sensoryMock = (score) => async () => ({ sensory_detail_score: score });
const depthMock = (score) => async () => ({ depth_judgment_score: score });
const throwTimeout = async () => { throw new JudgeTimeoutError(300, 200); };

// ═════════════════════════════════════════════════════════
// Engine 1 — matchE1 regex + master handler
// ═════════════════════════════════════════════════════════

test('matchE1: vague words trigger', () => {
  const r = matchE1('應該是吧');
  assert.ok(r.triggered.includes('vague_words'));
  assert.equal(r.explicit_protest, false);
});

test('matchE1: short compliance trigger', () => {
  assert.ok(matchE1('好').triggered.includes('short_compliance'));
});

test('matchE1: spiritual big words trigger', () => {
  assert.ok(matchE1('我感覺整個宇宙的能量都在流動').triggered.includes('spiritual_big_words'));
});

test('matchE1: explicit_protest sets the flag', () => {
  const r = matchE1('你又重複了、鬼打牆');
  assert.ok(r.triggered.includes('explicit_protest'));
  assert.equal(r.explicit_protest, true);
});

test('matchE1: cumulative-state signals from session_state', () => {
  const r = matchE1('一段完全正常沒有偏離訊號的具體回答內容描述', {
    consecutive_offtopic_turns: 1,
    consecutive_vague_turns: 2,
    cumulative_ppl_score: 0.7,
  });
  assert.ok(r.triggered.includes('cumulative_offtopic'));
  assert.ok(r.triggered.includes('cumulative_vague'));
  assert.ok(r.triggered.includes('cumulative_ppl'));
});

test('matchE1: clean long response → no trigger', () => {
  const r = matchE1('昨天下午我在公司會議室裡跟主管報告了專案進度的細節情況');
  assert.deepEqual(r.triggered, []);
});

test('e1MasterHandler: no trigger → handled false', async () => {
  const r = await e1MasterHandler({
    session_state: {},
    user_response: '昨天下午我在公司會議室跟主管報告了專案的細節進度',
  });
  assert.equal(r.handled, false);
});

test('e1MasterHandler: classifier none → not handled, patch still returned', async () => {
  const r = await e1MasterHandler({
    session_state: {},
    user_response: '應該是吧',
    judges: { subtypeClassifier: classifierMock({
      deviation_type: 'false_positive', confidence: 'low', evidence: [],
      arbitration_applied: false, recommended_sub_prompt: 'none',
    }) },
  });
  assert.equal(r.handled, false);
  assert.equal(r.patch.deviation_suspected_this_turn, true);
});

test('e1MasterHandler: classifier E1c → handled with inject + patch', async () => {
  const r = await e1MasterHandler({
    session_state: {},
    user_response: '對',
    judges: { subtypeClassifier: classifierMock({
      deviation_type: 'people_pleasing', confidence: 'high', evidence: ['compliance'],
      arbitration_applied: false, recommended_sub_prompt: 'E1c',
    }) },
  });
  assert.equal(r.handled, true);
  assert.ok(typeof r.inject === 'string' && r.inject.length > 0);
  assert.equal(r.patch.deviation_handled_this_turn, 'E1c');
});

test('e1MasterHandler: explicit_protest bumps cumulative_ppl_score +0.30', async () => {
  const r = await e1MasterHandler({
    session_state: { cumulative_ppl_score: 0.2 },
    user_response: '可以跳過嗎',
    judges: { subtypeClassifier: classifierMock({
      deviation_type: 'people_pleasing', confidence: 'high', evidence: [],
      arbitration_applied: false, recommended_sub_prompt: 'E1c',
    }) },
  });
  assert.ok(Math.abs(r.patch.cumulative_ppl_score - 0.5) < 1e-9,
    `expected ~0.5, got ${r.patch.cumulative_ppl_score}`);
});

test('e1MasterHandler: classifier timeout → conservative fallback (not handled)', async () => {
  const misses = [];
  const r = await e1MasterHandler({
    session_state: {},
    user_response: '應該是吧',
    judges: { subtypeClassifier: throwTimeout },
    logMiss: (m) => misses.push(m),
  });
  assert.equal(r.handled, false);
  assert.equal(misses.length, 1);
  assert.equal(misses[0].miss_type, 'classifier_timeout');
});

// ═════════════════════════════════════════════════════════
// Engine 2 — matchE2 + aggregator + master handler
// ═════════════════════════════════════════════════════════

test('matchE2: identity sentence + quality term → suspected', () => {
  const r = matchE2('我是一個勇敢的人');
  assert.equal(r.suspected, true);
  assert.equal(r.identity_sentence_hit, true);
  assert.equal(r.candidate_term, '勇敢的');
});

test('matchE2: 鑽石 alone (no identity sentence) → not a candidate', () => {
  const r = matchE2('鑽石');
  assert.equal(r.candidate_term, null,
    '鑽石 requires_identity_sentence — bare mention is not a candidate');
});

test('matchE2: 鑽石 WITH identity sentence → candidate', () => {
  const r = matchE2('我是一個鑽石的人');
  assert.equal(r.candidate_term, '鑽石');
  assert.equal(r.suspected, true);
});

test('matchE2: blacklist term alone → not suspected', () => {
  const r = matchE2('我想成為成功的');
  assert.equal(r.suspected, false);
});

test('runAggregator: door 1 fails → continue', async () => {
  const r = await runAggregator(
    { session_state: {}, user_response: '嗯嗯' },
    { candidate_term: null, identity_sentence_hit: false },
  );
  assert.equal(r.doors_passed, 0);
  assert.equal(r.recommended_sub_prompt, 'continue');
});

test('runAggregator: door 2 fails (term, no pattern) → stay', async () => {
  const r = await runAggregator(
    { session_state: {}, user_response: '勇敢的' },
    { candidate_term: '勇敢的', identity_sentence_hit: false },
  );
  assert.equal(r.doors_passed, 1);
  assert.equal(r.recommended_sub_prompt, 'stay');
});

test('runAggregator: door 3 fails (PPL high) → stay', async () => {
  const r = await runAggregator(
    { session_state: { cumulative_ppl_score: 0.8 }, user_response: '我是一個勇敢的人' },
    { candidate_term: '勇敢的', identity_sentence_hit: true },
  );
  assert.equal(r.doors_passed, 2);
  assert.equal(r.recommended_sub_prompt, 'stay');
});

test('runAggregator: door 4 fails (sensory score < 2) → stay', async () => {
  const r = await runAggregator(
    {
      session_state: {}, user_response: '我是一個勇敢的人',
      judges: { sensoryDetail: sensoryMock(1) },
    },
    { candidate_term: '勇敢的', identity_sentence_hit: true },
  );
  assert.equal(r.doors_passed, 3);
  assert.equal(r.recommended_sub_prompt, 'stay');
});

test('runAggregator: all 4 doors pass → upgrade', async () => {
  const r = await runAggregator(
    {
      session_state: {}, user_response: '我是一個勇敢的人',
      judges: { sensoryDetail: sensoryMock(3) },
    },
    { candidate_term: '勇敢的', identity_sentence_hit: true },
  );
  assert.equal(r.doors_passed, 4);
  assert.deepEqual(r.passed_doors, ['lexical', 'pattern', 'not_ppl', 'confirm']);
  assert.equal(r.recommended_sub_prompt, 'upgrade');
});

test('runAggregator: door 4 judge timeout → conservative fail (stay)', async () => {
  const misses = [];
  const r = await runAggregator(
    {
      session_state: {}, user_response: '我是一個勇敢的人',
      judges: { sensoryDetail: throwTimeout },
      logMiss: (m) => misses.push(m),
    },
    { candidate_term: '勇敢的', identity_sentence_hit: true },
  );
  assert.equal(r.doors_passed, 3);
  assert.equal(r.recommended_sub_prompt, 'stay');
  assert.equal(misses[0].detector, 'E2_aggregator_door4');
});

test('e2MasterHandler: not suspected → handled false', async () => {
  const r = await e2MasterHandler({ session_state: {}, user_response: '嗯嗯好喔' });
  assert.equal(r.handled, false);
});

test('e2MasterHandler: 4 doors → owned + evidence count incremented', async () => {
  const r = await e2MasterHandler({
    session_state: { current_quality_status: 'candidate', identity_test_evidence_count: 1 },
    user_response: '我是一個勇敢的人',
    judges: { sensoryDetail: sensoryMock(4) },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.current_quality_status, 'owned');
  assert.equal(r.patch.identity_test_evidence_count, 2);
});

// ═════════════════════════════════════════════════════════
// Engine 3 — 5 sub-routers
// ═════════════════════════════════════════════════════════

test('e3DeepSignalHandler: trauma marker → handoff', async () => {
  const r = await e3DeepSignalHandler({
    session_state: {}, user_response: '我小時候被虐待',
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.router_phase, 'deep_signal_handoff');
  assert.equal(r.patch.deep_signal_flags.trauma_marker_detected, true);
  assert.equal(r.patch.handoff_triggered_count, 1);
});

test('e3DeepSignalHandler: worth-fiction + depth score >= 2 → handoff', async () => {
  const r = await e3DeepSignalHandler({
    session_state: {}, user_response: '我覺得我不夠好',
    judges: { depthSignal: depthMock(3) },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.deep_signal_flags.depth_judgment_score, 3);
});

test('e3DeepSignalHandler: worth-fiction + depth score < 2 → not handled', async () => {
  const r = await e3DeepSignalHandler({
    session_state: {}, user_response: '我覺得我不夠好',
    judges: { depthSignal: depthMock(1) },
  });
  assert.equal(r.handled, false);
});

test('e3DeepSignalHandler: depth judge timeout → escalate (conservative handoff)', async () => {
  const misses = [];
  const r = await e3DeepSignalHandler({
    session_state: {}, user_response: '我覺得我不夠好',
    judges: { depthSignal: throwTimeout },
    logMiss: (m) => misses.push(m),
  });
  assert.equal(r.handled, true, 'timeout should escalate, not silently drop');
  assert.equal(misses[0].detector, 'E3_deep_signal_A4');
});

test('e3DeepSignalHandler: neutral response → not handled', async () => {
  const r = await e3DeepSignalHandler({
    session_state: {}, user_response: '昨天我去公司開會',
  });
  assert.equal(r.handled, false);
});

// ═════════════════════════════════════════════════════════
// ⭐ §3 patch 6/4 (safety patch #23) — Passive Death Wish 偵測.
// A006 case-driven; spec docs/v5-spec/safety/patch_23_passive_death_wish.md.
// ═════════════════════════════════════════════════════════

test('🛑 e3DeepSignalHandler: passive DW 強訊號「不想活」→ C-1 variant + SI confirm pending', async () => {
  const r = await e3DeepSignalHandler({
    session_state: {},
    user_response: '我是真的不想活下去',
    user_profile: { passive_death_wish_count: 0 },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.deep_signal_flags.passive_dw_detected, true);
  assert.equal(r.patch.deep_signal_flags.passive_dw_signal, 'strong');
  assert.equal(r.patch.deep_signal_flags.passive_dw_variant, 'strong');
  assert.equal(r.patch.deep_signal_flags.passive_dw_cross_session_count, 1);
  assert.equal(r.patch.si_confirm_pending, true,
    'C-1 must set si_confirm_pending so next turn classifies deny/confirm');
  assert.equal(r.patch.passive_dw_implicit_pending, false);
  assert.equal(r.patch.passive_dw_frozen, false);
  assert.equal(r.patch.router_phase, 'deep_signal_handoff');
  assert.equal(r.patch.handoff_triggered_count, 1);
  assert.match(r.inject, /Passive Death Wish.*Strong Signal/);
  assert.match(r.inject, /1925/, 'C-1 inject must carry 1925 hotline copy');
  assert.deepEqual(r.user_profile_increments, { passive_death_wish_count: 1 });
});

test('🛑 e3DeepSignalHandler: passive DW 強訊號「希望生病瞬間離世」→ C-1', async () => {
  // A006 Day 3-4 surface 訊號
  const r = await e3DeepSignalHandler({
    session_state: {},
    user_response: '希望生病的時候瞬間死掉、不要拖',
    user_profile: { passive_death_wish_count: 1 },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.deep_signal_flags.passive_dw_signal, 'strong');
  assert.equal(r.patch.deep_signal_flags.passive_dw_variant, 'strong');
  assert.equal(r.patch.deep_signal_flags.passive_dw_cross_session_count, 2);
});

test('🛑 e3DeepSignalHandler: passive DW 隱性訊號「上天讓我活著」+ 本 session 有「活下去」 → C-2', async () => {
  // A006 Day 1 root cause case
  const r = await e3DeepSignalHandler({
    session_state: {},
    user_response: '上天既然讓我活著、應該是有什麼事等待我去完成',
    last_3_turns: [
      '我覺得我活下去的動力越來越少',  // support signal: 「活下去」
      '不知道',
      '上天既然讓我活著、應該是有什麼事等待我去完成',
    ],
    user_profile: { passive_death_wish_count: 0 },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.deep_signal_flags.passive_dw_signal, 'implicit');
  assert.equal(r.patch.deep_signal_flags.passive_dw_variant, 'implicit');
  assert.equal(r.patch.passive_dw_implicit_pending, true);
  assert.equal(r.patch.si_confirm_pending, false);
  assert.match(r.inject, /Passive Death Wish.*Implicit/);
  assert.match(r.inject, /字面.*感受|哲學.*位置/);
});

test('🛑 e3DeepSignalHandler: passive DW 隱性訊號但沒 support signal → 不 trigger handoff', async () => {
  // 同樣的隱性訊號, 但沒 surface「活下去 / 動力 / 意義」類詞 → 視為純哲學表述, 不 escalate.
  // Falls through to existing trauma/worth-fiction path → 「上天讓我活著」 不命中那些 → handled=false.
  const r = await e3DeepSignalHandler({
    session_state: {},
    user_response: '上天既然讓我活著、應該是有什麼事等待我去完成',
    last_3_turns: ['沒什麼特別的', '想想看'],   // 無 surface life signal
    user_profile: { passive_death_wish_count: 0 },
  });
  assert.equal(r.handled, false,
    '隱性訊號獨自不 trigger; 需配合 support signal (per spec C-2 區分哲學表述)');
});

test('🛑 e3DeepSignalHandler: passive DW + count = 2 → C-3 (移除三選一 (c))', async () => {
  // currentCount=2 + 偵測 → newCount=3 → threshold 觸發 C-3
  const r = await e3DeepSignalHandler({
    session_state: {},
    user_response: '我不想再活了',
    user_profile: { passive_death_wish_count: 2 },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.deep_signal_flags.passive_dw_variant, 'repeat',
    'newCount=3 → C-3 repeat variant per PASSIVE_DW_ESCALATE_THRESHOLD');
  assert.equal(r.patch.deep_signal_flags.passive_dw_cross_session_count, 3);
  assert.match(r.inject, /Cumulative ≥ 3/);
});

test('🛑 e3DeepSignalHandler: passive DW + count = 4 → C-4 freeze (>= 5)', async () => {
  // currentCount=4 + 偵測 → newCount=5 → freeze threshold
  const r = await e3DeepSignalHandler({
    session_state: {},
    user_response: '我希望快點走',
    user_profile: { passive_death_wish_count: 4 },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.deep_signal_flags.passive_dw_variant, 'freeze');
  assert.equal(r.patch.passive_dw_frozen, true);
  assert.equal(r.patch.deep_signal_flags.passive_dw_cross_session_count, 5);
  assert.match(r.inject, /FREEZE.*count >= 5/);
});

test('🛑 e3DeepSignalHandler: passive DW strong takes priority over trauma marker', async () => {
  // 同 turn 命中 passive strong + trauma → 走 passive strong (more critical, more specific).
  const r = await e3DeepSignalHandler({
    session_state: {},
    user_response: '我父母都是上吊自殺走的、我也不想活了',
    user_profile: { passive_death_wish_count: 0 },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.deep_signal_flags.passive_dw_detected, true,
    'passive DW wins precedence; trauma is captured in cross-session count');
  assert.equal(r.patch.deep_signal_flags.passive_dw_signal, 'strong');
});

test('🛑 e3DeepSignalHandler: trauma 加「上吊」 regex (safety patch #23)', async () => {
  // 「上吊」單獨命中 trauma regex (不含 passive DW words) → 走 variant A trauma handoff.
  const r = await e3DeepSignalHandler({
    session_state: {},
    user_response: '我父母都是上吊自殺走的',
    user_profile: { passive_death_wish_count: 0 },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.deep_signal_flags.trauma_marker_detected, true);
  // Pure trauma path: not classified as passive DW (no count bump).
  assert.equal(r.patch.deep_signal_flags.passive_dw_detected, undefined,
    'pure trauma marker without passive words must NOT bump passive DW counter');
  assert.equal(r.user_profile_increments, undefined,
    'pure trauma path emits no user_profile_increments');
});

test('e3DeepSignalHandler: passive DW user_profile missing → defaults to 0 count', async () => {
  // Pre-migration 024: column missing → ctx.user_profile.passive_death_wish_count undefined.
  const r = await e3DeepSignalHandler({
    session_state: {}, user_response: '我不想活了',
    // user_profile omitted entirely
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.deep_signal_flags.passive_dw_cross_session_count, 1);
  assert.equal(r.patch.deep_signal_flags.passive_dw_variant, 'strong');
});

// ─── A6 SI confirm transition classifier (TODO 任務3: Crisis Mode SOP) ───

test('🛑 e3DeepSignalHandler (A6): si_confirm_pending + 「沒有」 → DENY path → 三選一 + 1925', async () => {
  const r = await e3DeepSignalHandler({
    session_state: { si_confirm_pending: true, handoff_triggered_count: 1 },
    user_response: '沒有,我只是累',
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.si_confirm_pending, false, 'must clear pending after classifying');
  assert.equal(r.patch.si_confirm_result, 'deny');
  assert.equal(r.patch.handoff_triggered_count, 2);
  assert.match(r.inject, /SI Confirm.*Deny path/);
  assert.match(r.inject, /三選一|\(a\).*\(b\).*\(c\)/);
  assert.match(r.inject, /1925/);
  // DENY must not freeze the AI — student declined SI risk.
  assert.notEqual(r.patch.passive_dw_frozen, true);
});

test('🛑 e3DeepSignalHandler (A6): si_confirm_pending + 「有」 → CONFIRM path → only-(b) + freeze + HITL', async () => {
  const r = await e3DeepSignalHandler({
    session_state: { si_confirm_pending: true, handoff_triggered_count: 1 },
    user_response: '有時候真的會這樣想',
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.si_confirm_pending, false);
  assert.equal(r.patch.si_confirm_result, 'confirm');
  assert.equal(r.patch.passive_dw_frozen, true, 'CONFIRM must freeze AI推進');
  assert.match(r.inject, /SI Confirm.*Confirm.*Ambiguous/);
  assert.match(r.inject, /Vivi 1-on-1|only-\(b\)|交給 Vivi/);
  assert.match(r.inject, /1925/);
});

test('🛑 e3DeepSignalHandler (A6): si_confirm_pending + ambiguous → bias for safety = treat as CONFIRM', async () => {
  // Student gives vague answer that's neither clear deny nor clear confirm.
  // Spec A6: bias for safety, ambiguous = treat as confirmed.
  const r = await e3DeepSignalHandler({
    session_state: { si_confirm_pending: true, handoff_triggered_count: 1 },
    user_response: '我不知道',
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.si_confirm_result, 'ambiguous');
  assert.equal(r.patch.passive_dw_frozen, true,
    'ambiguous biases for safety — freeze (false negative = danger)');
});

test('🛑 e3DeepSignalHandler (A6): si_confirm_pending takes priority over fresh detection', async () => {
  // si_confirm_pending=true AND text matches passive DW strong regex →
  // classifier runs (this turn = student answering SI question), not fresh detection.
  const r = await e3DeepSignalHandler({
    session_state: { si_confirm_pending: true, handoff_triggered_count: 1 },
    user_response: '有,我有不想活的念頭',     // would normally trigger fresh strong + count++
    user_profile: { passive_death_wish_count: 0 },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.si_confirm_result, 'confirm');
  // No fresh passive_dw_detected (this is the classifier path, not fresh detect).
  assert.equal(r.patch.deep_signal_flags, undefined);
  // No counter increment from classifier path (the original C-1 turn already counted).
  assert.equal(r.user_profile_increments, undefined);
});

test('e3DeepSignalHandler (A6): si_confirm_pending=false + normal text → no classifier path', async () => {
  // Make sure classifier doesn't fire spuriously.
  const r = await e3DeepSignalHandler({
    session_state: { si_confirm_pending: false },
    user_response: '昨天我去公司開會',
  });
  assert.equal(r.handled, false);
});

test('e3OpeningBranchHandler: requires elicitation_mode_active', async () => {
  const r = await e3OpeningBranchHandler({
    session_state: { elicitation_mode_active: false }, user_response: '我卡住了',
  });
  assert.equal(r.handled, false);
});

test('e3OpeningBranchHandler: stuck branch → handled', async () => {
  const r = await e3OpeningBranchHandler({
    session_state: { elicitation_mode_active: true }, user_response: '我完全卡住了不知道',
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.opening_branch_handled, true);
});

test('e3OpeningBranchHandler: already handled → skip', async () => {
  const r = await e3OpeningBranchHandler({
    session_state: { elicitation_mode_active: true, opening_branch_handled: true },
    user_response: '我卡住了',
  });
  assert.equal(r.handled, false);
});

test('e3Top1Handler: 3+ values, no top1, elicitation → handled', async () => {
  const r = await e3Top1Handler({
    session_state: {
      values_collected_list: ['a', 'b', 'c'],
      top1_value: null,
      router_phase: 'elicitation',
    },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.router_phase, 'top1_determination');
});

test('e3Top1Handler: top1 already set → not handled', async () => {
  const r = await e3Top1Handler({
    session_state: {
      values_collected_list: ['a', 'b', 'c'], top1_value: '勇敢', router_phase: 'elicitation',
    },
  });
  assert.equal(r.handled, false);
});

test('e3StatusRouterHandler: identity_test_routing + owned → build_vision', async () => {
  const r = await e3StatusRouterHandler({
    session_state: { router_phase: 'identity_test_routing', current_quality_status: 'owned' },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.next_action, 'build_vision');
});

test('e3StatusRouterHandler: not in identity_test_routing → not handled', async () => {
  const r = await e3StatusRouterHandler({
    session_state: { router_phase: 'elicitation', current_quality_status: 'owned' },
  });
  assert.equal(r.handled, false);
});

test('e3CascadeDownHandler: cascade_down phase → handled', async () => {
  const r = await e3CascadeDownHandler({ session_state: { router_phase: 'cascade_down' } });
  assert.equal(r.handled, true);
});

test('e3CascadeDownHandler: other phase → not handled', async () => {
  const r = await e3CascadeDownHandler({ session_state: { router_phase: 'elicitation' } });
  assert.equal(r.handled, false);
});

// ═════════════════════════════════════════════════════════
// Engine 4 — 4 lifecycle handlers
// ═════════════════════════════════════════════════════════

test('e4DayOpeningHandler: no persistent assets (Day 1) → not handled', async () => {
  const r = await e4DayOpeningHandler({ user_profile: {} });
  assert.equal(r.handled, false);
});

test('e4DayOpeningHandler: has anchors → handled (router_phase=opening + day_opening_inject_active=true)', async () => {
  const r = await e4DayOpeningHandler({ user_profile: { anchors: ['某個錨點'] } });
  assert.equal(r.handled, true);
  assert.equal(r.patch.router_phase, 'opening');
  // PR-4c-green E4 fix — patch must also flip the flag that suppresses
  // phase_1.opening cold 起手式 in contextFor.
  assert.equal(r.patch.day_opening_inject_active, true,
    'E4 inject must signal phase-context to swap the opening variant');
});

// PR-4c-green bug 3 — Day 2+ fresh student fix
test('e4DayOpeningHandler: has daily_takeaways (Day N+1 fresh, no upgraded quality) → handled', async () => {
  const r = await e4DayOpeningHandler({
    user_profile: { daily_takeaways: [{ day: 1, term: '想停下來' }] },
  });
  assert.equal(r.handled, true, 'Day N+1 must fire E4 day-opening (not phase_1 起手式)');
  assert.equal(r.patch.router_phase, 'opening');
});

test('e4DayOpeningHandler: has last_session_day_summary.last_takeaway_term → handled', async () => {
  const r = await e4DayOpeningHandler({
    user_profile: { last_session_day_summary: { last_takeaway_term: '我想停' } },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.router_phase, 'opening');
});

test('e4DayOpeningHandler: daily_takeaways = [] still counts as Day 1 (not handled)', async () => {
  const r = await e4DayOpeningHandler({
    user_profile: { daily_takeaways: [], last_session_day_summary: {} },
  });
  assert.equal(r.handled, false);
});

test('e4TakeawayHandler: not yet seeded → handled', async () => {
  const r = await e4TakeawayHandler({ session_state: {} });
  assert.equal(r.handled, true);
  assert.equal(r.patch.takeaway_seeded_this_session, true);
});

test('e4TakeawayHandler: already seeded → not handled (no double seed)', async () => {
  const r = await e4TakeawayHandler({ session_state: { takeaway_seeded_this_session: true } });
  assert.equal(r.handled, false);
});

test('e4CascadeRefHandler: only fires in cascade_down', async () => {
  assert.equal((await e4CascadeRefHandler({ session_state: { router_phase: 'cascade_down' } })).handled, true);
  assert.equal((await e4CascadeRefHandler({ session_state: { router_phase: 'elicitation' } })).handled, false);
});

test('e4ExportHandler: always handled, stamps export_prompt_generated_at', async () => {
  const r = await e4ExportHandler({ session_state: {} });
  assert.equal(r.handled, true);
  assert.ok(r.patch.export_prompt_generated_at, 'export timestamp set');
});

// ═════════════════════════════════════════════════════════
// index.js — ALL_DETECTORS + registerAllDetectors
// ═════════════════════════════════════════════════════════

test('ALL_DETECTORS: 11 detectors (E1 + 5×E3 + E2 + 4×E4)', () => {
  assert.equal(ALL_DETECTORS.length, 11);
});

test('ALL_DETECTORS: E2 master carries skip_if', () => {
  const e2 = ALL_DETECTORS.find(d => d.id === E2_DETECTOR.id);
  assert.equal(typeof e2.skip_if, 'function');
});

test('ALL_DETECTORS: E1 priority 10 is lowest number (highest priority)', () => {
  assert.equal(E1_DETECTOR.priority, 10);
  const userTurn = ALL_DETECTORS.filter(d => d.trigger_event === 'user_turn');
  const priorities = userTurn.map(d => d.priority);
  assert.equal(Math.min(...priorities), 10);
});

test('registerAllDetectors: registers all 11 into a registry without error', () => {
  const reg = registerAllDetectors(new DetectorRegistry());
  assert.equal(reg.size(), 11);
});

test('registerAllDetectors: user_turn cascade ordered E1→E3→E2 by priority', () => {
  const reg = registerAllDetectors(new DetectorRegistry());
  const order = reg.listForEvent('user_turn').map(d => d.priority);
  const sorted = [...order].sort((a, b) => a - b);
  assert.deepEqual(order, sorted, 'cascade must be priority-ascending');
  assert.equal(order[0], 10);                          // E1 first
  assert.equal(order[order.length - 1], 70);           // E2 last
});

test('registerAllDetectors: E3_DETECTORS / E4_DETECTORS arrays are non-empty', () => {
  assert.equal(E3_DETECTORS.length, 5);
  assert.equal(E4_DETECTORS.length, 4);
});
