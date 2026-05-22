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

test('e4DayOpeningHandler: has anchors → handled', async () => {
  const r = await e4DayOpeningHandler({ user_profile: { anchors: ['某個錨點'] } });
  assert.equal(r.handled, true);
  assert.equal(r.patch.router_phase, 'opening');
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
