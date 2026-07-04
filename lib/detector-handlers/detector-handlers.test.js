// lib/detector-handlers/detector-handlers.test.js
// 4 engine handler 聚合測試 — regex matchers + handler orchestration + registry wiring.
// Haiku judge 全部以 ctx.judges.* mock 注入（不打網路）。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { matchE1, e1MasterHandler, E1_DETECTOR } from './engine-1.js';
import { matchE2, runAggregator, e2MasterHandler, E2_DETECTOR } from './engine-2.js';
import {
  e3DeepSignalHandler, e3ElicitationRouterHandler, e3Top1JudgeHandler,
  e3ModeTransitionHandler, e3CascadeModeHandler, E3_DETECTORS,
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
    consecutive_vague_turns: 3,   // fable 6/26: 門檻 2->3
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

test('🛑 e3DeepSignalHandler: passive DW + count = 2 → C-3 repeat (errata v02 direct-1925, 廢三選一)', async () => {
  // currentCount=2 + 偵測 → newCount=3 → threshold 觸發 C-3 repeat variant
  const r = await e3DeepSignalHandler({
    session_state: {},
    user_response: '我不想再活了',
    user_profile: { passive_death_wish_count: 2 },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.deep_signal_flags.passive_dw_variant, 'repeat',
    'newCount=3 → C-3 repeat variant per PASSIVE_DW_ESCALATE_THRESHOLD');
  assert.equal(r.patch.deep_signal_flags.passive_dw_cross_session_count, 3);
  assert.match(r.inject, /Cumulative ≥ 2/);
  // errata v02: no deprecated mechanic in C-3 inject.
  assert.doesNotMatch(r.inject, /\(a\)先停在這[\s\S]*\(b\)我幫你預約/);
  assert.doesNotMatch(r.inject, /我幫你預約跟 Vivi/);
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

// ─── 6/6 v2 hotfix (Vivi 沙盒 #2) — ACTIVE SI explicit fast-path ─

test('🛑 6/6 v2: 「我想自殺」 → ACTIVE_SI_EXPLICIT fast-path → Step 4 high_risk direct-1925 + HITL', async () => {
  // Vivi 沙盒 #2 repro: pre-hotfix-v2「我想自殺」hit PASSIVE_STRONG → C-1 直問.
  // AI replied「你現在有沒有想要傷害自己的念頭?」 — 學員已明說自殺、再問荒謬.
  // v2 fix: route to STEP 4 HIGH_RISK fast-path, skip C-1 + Step 2 assessment.
  const r = await e3DeepSignalHandler({
    session_state: {}, user_response: '我想自殺',
    user_profile: { passive_death_wish_count: 0 },
  });
  assert.equal(r.handled, true);
  // Active SI flag set; signal kind = 'active_si_explicit'.
  assert.equal(r.patch.deep_signal_flags.active_si_explicit_detected, true);
  assert.equal(r.patch.deep_signal_flags.passive_dw_signal, 'active_si_explicit');
  assert.equal(r.patch.deep_signal_flags.passive_dw_variant, 'high_risk');
  // crisis_sop_state pre-initialized at Step 4 awaiting HANDOFF_ACK.
  assert.equal(r.patch.crisis_sop_state.current_step, 4);   // SOP_STEPS.STEP_4_HANDOFF
  assert.equal(r.patch.crisis_sop_state.awaiting, 'handoff_ack');
  assert.equal(r.patch.crisis_sop_state.si_answer, 'confirm',
    'active SI already declared — SI answer = confirm without asking');
  assert.equal(r.patch.crisis_sop_state.handoff_variant_used, 'high_risk');
  assert.equal(r.patch.crisis_sop_state.active_si_explicit, true);
  // HITL critical alert immediate.
  assert.equal(r.patch.hitl_critical_alert, true);
  // Inject = Step 4 high_risk direct-1925 phrasing (6/6 wording: comma punctuation + Taiwan framing).
  assert.match(r.inject, /Active SI Explicit/);
  assert.match(r.inject, /你現在最需要的,是一個真人在你旁邊/);
  assert.match(r.inject, /在台灣,可以打 1925/);
  assert.match(r.inject, /如果你不在台灣,請搜尋你所在地的緊急專線/);
  // ⚠️ Vivi 沙盒 absurdity case: AI must NOT ask the C-1 SI question.
  // We assert the POSITIVE form is absent — the inject DOES contain
  // 「❌ 不問「你現在有沒有想要傷害自己的念頭?」」 as a forbid-marker telling
  // the model NOT to use that phrasing. The positive C-1 directive form
  // 「我想直接問你:...」 (which is in prompt_content_passive_dw_strong) MUST
  // NOT appear here.
  assert.doesNotMatch(r.inject, /我想直接問你:你現在有沒有想要傷害自己的念頭/);
  assert.doesNotMatch(r.inject, /我想直接問你:你現在/);
  // No next-turn classifier (no si_confirm_pending — crisis-sop takes Step 4).
  assert.equal(r.patch.si_confirm_pending, false);
  // Count bumps for cross-session tracking.
  assert.deepEqual(r.user_profile_increments, { passive_death_wish_count: 1 });
});

test('🛑 6/6 v2: 「我要自殺」 / 「我要結束自己的生命」 / 「我要死」 → ACTIVE_SI fast-path', async () => {
  for (const text of ['我要自殺', '我要結束自己的生命', '我要死']) {
    const r = await e3DeepSignalHandler({
      session_state: {}, user_response: text,
      user_profile: { passive_death_wish_count: 0 },
    });
    assert.equal(r.patch.deep_signal_flags.active_si_explicit_detected, true,
      `${text} should hit ACTIVE_SI_EXPLICIT (first-person decided intent)`);
    assert.equal(r.patch.crisis_sop_state.handoff_variant_used, 'high_risk');
    // Assert positive C-1 directive form absent (negation marker in inject is OK).
    assert.doesNotMatch(r.inject, /我想直接問你:你現在/);
  }
});

test('🛑 6/6 v2: 「不想活」 → PASSIVE_STRONG → C-1 強訊號直問 (NOT fast-path, this path is correct)', async () => {
  // Vivi 沙盒 explicit boundary: passive ideation 「不想活」 should STAY in C-1 path.
  const r = await e3DeepSignalHandler({
    session_state: {}, user_response: '我不想活',
    user_profile: { passive_death_wish_count: 0 },
  });
  assert.equal(r.patch.deep_signal_flags.active_si_explicit_detected, undefined,
    '「不想活」 must NOT route through ACTIVE_SI fast-path');
  assert.equal(r.patch.deep_signal_flags.passive_dw_signal, 'strong');
  assert.equal(r.patch.deep_signal_flags.passive_dw_variant, 'strong');
  // C-1 direct SI question phrasing IS the right thing here.
  assert.match(r.inject, /Strong Signal/);
  assert.match(r.inject, /你現在有沒有想要傷害自己的念頭/);
  // No pre-initialized Step 4 state — let crisis-sop handle Step 1 → Step 2.
  assert.equal(r.patch.crisis_sop_state, undefined);
  // si_confirm_pending: true → next-turn classifier expected.
  assert.equal(r.patch.si_confirm_pending, true);
});

test('🛑 6/6 v2: 「我想死」 / 「活不下去」 → PASSIVE_STRONG (kept in passive, Vivi 6/6 v2 spec literal)', async () => {
  // Vivi 6/6 v2 spec keeps these in PASSIVE_STRONG ("想/要" distinction —
  // ACTIVE_SI is "要" form only for the bare 死 word).
  for (const text of ['我想死', '活不下去']) {
    const r = await e3DeepSignalHandler({
      session_state: {}, user_response: text,
      user_profile: { passive_death_wish_count: 0 },
    });
    assert.equal(r.patch.deep_signal_flags.active_si_explicit_detected, undefined,
      `${text} must stay in PASSIVE_STRONG (Vivi 6/6 v2 spec literal)`);
    assert.equal(r.patch.deep_signal_flags.passive_dw_signal, 'strong');
  }
});

test('🛑 6/6 v2: ACTIVE_SI + count >= 4 → FREEZE variant (cumulative crosses threshold)', async () => {
  // Pre-state count=4 + explicit fire → new_count=5 → freeze.
  const r = await e3DeepSignalHandler({
    session_state: {}, user_response: '我想自殺',
    user_profile: { passive_death_wish_count: 4 },
  });
  assert.equal(r.patch.deep_signal_flags.passive_dw_variant, 'freeze');
  assert.equal(r.patch.crisis_sop_state.handoff_variant_used, 'freeze');
  assert.equal(r.patch.passive_dw_frozen, true);
});

test('🛑 6/6 hotfix preserves TRAUMA path: 「我爸自殺」 → TRAUMA only (NOT PASSIVE_STRONG)', async () => {
  // Trauma marker without first-person ideation must STILL fall to TRAUMA path,
  // not be misclassified as active SI. This is the explicit non-regression case.
  const r = await e3DeepSignalHandler({
    session_state: {}, user_response: '我爸自殺走了',
    user_profile: { passive_death_wish_count: 0 },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.deep_signal_flags.trauma_marker_detected, true);
  assert.equal(r.patch.deep_signal_flags.passive_dw_detected, undefined,
    '親人自殺 trauma scene must NOT be misclassified as active SI');
  assert.equal(r.user_profile_increments, undefined,
    'pure trauma path emits no user_profile_increments');
});

test('🛑 6/6 hotfix preserves TRAUMA path: 「親人上吊」 → TRAUMA only (NOT PASSIVE_STRONG)', async () => {
  const r = await e3DeepSignalHandler({
    session_state: {}, user_response: '我有親人上吊',
    user_profile: { passive_death_wish_count: 0 },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.deep_signal_flags.trauma_marker_detected, true);
  assert.equal(r.patch.deep_signal_flags.passive_dw_detected, undefined);
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

test('🛑 errata v02: e3DeepSignalHandler (A6) si_confirm_pending + 「沒有」 → DENY → standard direct-1925', async () => {
  const r = await e3DeepSignalHandler({
    session_state: { si_confirm_pending: true, handoff_triggered_count: 1 },
    user_response: '沒有,我只是累',
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.si_confirm_pending, false, 'must clear pending after classifying');
  assert.equal(r.patch.si_confirm_result, 'deny');
  assert.equal(r.patch.handoff_triggered_count, 2);
  assert.match(r.inject, /SI Confirm.*Deny path/);
  // 6/6 wording-revised direct-1925 phrasing (口語 + Taiwan framing).
  assert.match(r.inject, /Step 4 standard direct-1925 phrasing/);
  assert.match(r.inject, /我想先停在這裡,不急著往下走/);
  assert.match(r.inject, /1925/);
  assert.doesNotMatch(r.inject, /\(a\)先停在這[\s\S]*\(b\)我幫你預約/);
  assert.doesNotMatch(r.inject, /我幫你預約跟 Vivi/);
  // DENY must not freeze the AI — student declined SI risk.
  assert.notEqual(r.patch.passive_dw_frozen, true);
});

test('🛑 errata v02: e3DeepSignalHandler (A6) si_confirm_pending + 「有」 → CONFIRM → high_risk direct-1925 + freeze + HITL', async () => {
  const r = await e3DeepSignalHandler({
    session_state: { si_confirm_pending: true, handoff_triggered_count: 1 },
    user_response: '有時候真的會這樣想',
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.si_confirm_pending, false);
  assert.equal(r.patch.si_confirm_result, 'confirm');
  assert.equal(r.patch.passive_dw_frozen, true, 'CONFIRM must freeze AI推進');
  assert.match(r.inject, /SI Confirm.*Confirm.*Ambiguous/);
  assert.match(r.inject, /high_risk direct-1925/);
  assert.match(r.inject, /你現在最需要的,是一個真人在你旁邊/);
  assert.match(r.inject, /1925/);
  // errata v02: no positive offer 「下一步、我幫你安排跟 Vivi 1-on-1」 (deprecated form).
  // (The negation section 「不可 offer『我幫你安排 Vivi 1-on-1』」 IS allowed —
  //  it's a forbid-marker telling the model NOT to use that phrasing.)
  assert.doesNotMatch(r.inject, /下一步、我幫你安排跟 Vivi 1-on-1/);
  assert.doesNotMatch(r.inject, /我幫你預約跟 Vivi/);
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

// ─── PR-23b: C-2 implicit_pending framing classifier (Vivi 6/4 折衷) ───

test('🛑 e3DeepSignalHandler (PR-23b): implicit_pending + 字面 → philosophical light 1925, no choice mechanic, no count++', async () => {
  const r = await e3DeepSignalHandler({
    session_state: {
      passive_dw_implicit_pending: true,
      handoff_triggered_count: 1,
    },
    user_response: '就是字面上的意思,沒有想死',
    user_profile: { passive_death_wish_count: 1 },   // already +1 from C-2 fire
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.passive_dw_implicit_pending, false, 'must clear pending');
  assert.equal(r.patch.passive_dw_implicit_result, 'philosophical');
  // Per Vivi 6/4 折衷: 不 +1, 不 handoff_triggered_count++.
  assert.equal(r.patch.handoff_triggered_count, undefined,
    'philosophical path 不 invoke handoff_triggered_count++');
  assert.equal(r.user_profile_increments, undefined,
    'philosophical path NO extra count (already +1 from C-2 fire)');
  assert.match(r.inject, /Philosophical Path/);
  assert.match(r.inject, /1925/);
  assert.match(r.inject, /了解、謝謝你跟我說清楚/);
  // No choice mechanic in light 1925 path (errata v02 廢三選一 anyway).
  assert.doesNotMatch(r.inject, /\(a\)先停在這[\s\S]*\(b\)我幫你預約[\s\S]*\(c\)/);
  assert.doesNotMatch(r.inject, /我幫你預約跟 Vivi/);
});

test('🛑 e3DeepSignalHandler (PR-23b): implicit_pending + 「真的不想活」 → escalate to C-1 + count++', async () => {
  const r = await e3DeepSignalHandler({
    session_state: {
      passive_dw_implicit_pending: true,
      handoff_triggered_count: 1,
    },
    user_response: '其實是真的不想活了',
    user_profile: { passive_death_wish_count: 1 },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.passive_dw_implicit_result, 'real');
  assert.equal(r.patch.deep_signal_flags.passive_dw_variant, 'strong',
    'real framing escalates to C-1 strong');
  assert.equal(r.patch.deep_signal_flags.passive_dw_cross_session_count, 2);
  assert.equal(r.patch.si_confirm_pending, true,
    'escalation sets si_confirm_pending for next-turn SI confirm classifier');
  assert.deepEqual(r.user_profile_increments, { passive_death_wish_count: 1 });
  assert.match(r.inject, /Strong Signal/);
});

test('🛑 e3DeepSignalHandler (PR-23b): implicit_pending + ambiguous → bias safety → escalate', async () => {
  const r = await e3DeepSignalHandler({
    session_state: {
      passive_dw_implicit_pending: true,
      handoff_triggered_count: 1,
    },
    user_response: '我也不確定欸',   // neither philosophical nor clearly real
    user_profile: { passive_death_wish_count: 1 },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.passive_dw_implicit_result, 'ambiguous');
  assert.equal(r.patch.deep_signal_flags.passive_dw_variant, 'strong',
    'ambiguous biases for safety — escalate (false negative = danger)');
  assert.equal(r.patch.si_confirm_pending, true);
});

test('🛑 e3DeepSignalHandler (PR-23b): implicit_pending + real also escalates count to freeze if >= 5', async () => {
  // currentCount=4 + escalation = newCount=5 → freeze variant
  const r = await e3DeepSignalHandler({
    session_state: {
      passive_dw_implicit_pending: true,
      handoff_triggered_count: 4,
    },
    user_response: '我真的不想活了',
    user_profile: { passive_death_wish_count: 4 },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.deep_signal_flags.passive_dw_variant, 'freeze');
  assert.equal(r.patch.passive_dw_frozen, true);
});

test('e3DeepSignalHandler (PR-23b): implicit_pending takes priority over fresh detection', async () => {
  // Even if text would match passive strong regex, classifier path runs (this turn = answer).
  const r = await e3DeepSignalHandler({
    session_state: { passive_dw_implicit_pending: true },
    user_response: '就是字面上的意思',   // philosophical answer
    user_profile: { passive_death_wish_count: 1 },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.passive_dw_implicit_result, 'philosophical');
  // No fresh passive_dw_detected from this turn.
  assert.equal(r.patch.deep_signal_flags, undefined);
});

// ─── Vivi-final copy assertions (PR-23b) ─────────────────

test('🛑 e3DeepSignalHandler (PR-23b copy): C-1 inject carries Vivi 6/4 verbatim text', async () => {
  const r = await e3DeepSignalHandler({
    session_state: {}, user_response: '我不想活了',
    user_profile: { passive_death_wish_count: 0 },
  });
  // Vivi 6/4 patch 原檔 C-1 承認段 (single block, integrates SI question).
  assert.match(r.inject, /我聽到了/);
  assert.match(r.inject, /你說的這個——我需要在這裡停一下、不繼續往下走/);
  assert.match(r.inject, /我想直接問你:你現在有沒有想要傷害自己的念頭/);
});

test('🛑 e3DeepSignalHandler (PR-23b copy): C-2 inject carries Vivi 6/4 verbatim text', async () => {
  const r = await e3DeepSignalHandler({
    session_state: {},
    user_response: '上天既然讓我活著、應該是有什麼事等待我去完成',
    last_3_turns: ['我覺得我活下去的動力越來越少', '不知道'],
    user_profile: { passive_death_wish_count: 0 },
  });
  // Vivi 6/4 patch 原檔 C-2 區分段.
  assert.match(r.inject, /我注意到你說/);
  assert.match(r.inject, /這句話對我來說很重/);
  assert.match(r.inject, /字面上的意思、還是你現在有一些很沉的感受在裡面/);
});

test('🛑 errata v02: C-3 inject 改 Step 4 cumulative direct-1925 (廢 Vivi 6/4 三選一)', async () => {
  const r = await e3DeepSignalHandler({
    session_state: {}, user_response: '我不想活了',
    user_profile: { passive_death_wish_count: 2 },     // newCount=3 → C-3
  });
  // 6/6 wording-revised Step 4.2 verbatim phrasing in C-3 prompt.
  assert.match(r.inject, /過去幾次,你提過類似的/);
  assert.match(r.inject, /我想先停在這裡,不急著往下走/);
  assert.match(r.inject, /在台灣,可以打 1925/);
  assert.match(r.inject, /你需要的,是真正的諮商師 \/ 心理醫生長期陪伴/);
  // Deprecated mechanic gone.
  assert.doesNotMatch(r.inject, /\(a\)先停在這/);
  assert.doesNotMatch(r.inject, /\(b\)我幫你預約跟 Vivi/);
  assert.doesNotMatch(r.inject, /\(c\)我們先回到日常/);
});

test('🛑 e3DeepSignalHandler: C-3 inject + 1925 主文案 (Vivi 6/6 wording 修訂, Taiwan-framed)', async () => {
  const r = await e3DeepSignalHandler({
    session_state: {}, user_response: '我不想活了',
    user_profile: { passive_death_wish_count: 2 },
  });
  // Vivi 6/6 終審 — 「安心專線」 (NOT 自殺防治專線) + Taiwan localization + fallback.
  assert.match(r.inject, /安心專線 1925/);
  assert.match(r.inject, /如果你不在台灣,請搜尋你所在地的緊急專線/);
});

test('🛑 e3DeepSignalHandler (PR-23b copy): 禁止段 6 條 (Vivi 6/4 verbatim)', async () => {
  const r = await e3DeepSignalHandler({
    session_state: {}, user_response: '我不想活了',
    user_profile: { passive_death_wish_count: 0 },
  });
  // 禁止段 6 條 — errata v02 updated: 第 4 條改為「不可 offer 預約」.
  assert.match(r.inject, /不可把 passive 訊號當「哲學表述 \/ 隱喻」滑過——A006 Day 1 教訓/);
  assert.match(r.inject, /不可在 passive 訊號 surface 後、繼續挖 values 找 Top 1/);
  assert.match(r.inject, /不可假設「學員講出來 = 已被處理」/);
  // errata v02: 廢「不可在累積觸發 ≥ 3 時、仍提供 (c) 選項」, replaced with 廢預約 1-on-1.
  assert.match(r.inject, /不可 offer「預約 Vivi 1-on-1」/);
  assert.match(r.inject, /errata v02 廢除、萬人規模不可行/);
  assert.match(r.inject, /passive_death_wish_count >= 5/);
  assert.match(r.inject, /不可給「想開一點」「往好處想」這類淺安撫/);
});

test('e3ElicitationRouterHandler: requires primary_mode=elicitation (PR-23s4b)', async () => {
  // PR-23s4b: handler keys off primary_mode. Setting non-elicitation primary_mode
  // means handler should skip even if text matches a branch trigger.
  const r = await e3ElicitationRouterHandler({
    session_state: { primary_mode: 'identity_anchoring', elicitation_mode_active: false },
    user_response: '我卡住了',
  });
  assert.equal(r.handled, false);
});

test('e3ElicitationRouterHandler: stuck branch → handled', async () => {
  const r = await e3ElicitationRouterHandler({
    session_state: { elicitation_mode_active: true }, user_response: '我完全卡住了不知道',
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.opening_branch_handled, true);
});

test('e3ElicitationRouterHandler: already handled → skip', async () => {
  const r = await e3ElicitationRouterHandler({
    session_state: { elicitation_mode_active: true, opening_branch_handled: true },
    user_response: '我卡住了',
  });
  assert.equal(r.handled, false);
});

test('e3Top1JudgeHandler: 3+ values, no top1, elicitation → handled', async () => {
  const r = await e3Top1JudgeHandler({
    session_state: {
      values_collected_list: ['a', 'b', 'c'],
      top1_value: null,
      router_phase: 'elicitation',
    },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.router_phase, 'top1_determination');
});

test('e3Top1JudgeHandler: top1 already set → not handled', async () => {
  const r = await e3Top1JudgeHandler({
    session_state: {
      values_collected_list: ['a', 'b', 'c'], top1_value: '勇敢', router_phase: 'elicitation',
    },
  });
  assert.equal(r.handled, false);
});

test('🛑 e3ModeTransitionHandler: identity_anchoring + owned + has Top 2/3 → transition to cascade (PR-23s4b)', async () => {
  const r = await e3ModeTransitionHandler({
    session_state: {
      primary_mode: 'identity_anchoring',
      active_modes: ['identity_anchoring'],
      paused_modes: [],
      current_quality_status: 'owned',
      values_ranking: [{ value: 'top1' }, { value: 'top2' }, { value: 'top3' }],
    },
  });
  assert.equal(r.handled, true);
  // PR-23s4b: writes mode transition, not next_action.
  assert.equal(r.patch.primary_mode, 'cascade');
  assert.ok(r.patch.active_modes.includes('cascade'));
  // mode-transition-logger emits an entry in mode_transition_log.
  assert.ok(Array.isArray(r.patch.mode_transition_log));
  assert.equal(r.patch.mode_transition_log.length, 1);
  assert.equal(r.patch.mode_transition_log[0].to_primary, 'cascade');
  assert.equal(r.patch.mode_transition_log[0].from_primary, 'identity_anchoring');
});

test('🛑 e3ModeTransitionHandler: identity_anchoring + ambiguous → transition to integration (PR-23s4b)', async () => {
  const r = await e3ModeTransitionHandler({
    session_state: {
      primary_mode: 'identity_anchoring',
      active_modes: ['identity_anchoring'],
      paused_modes: [],
      current_quality_status: 'ambiguous',
    },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.primary_mode, 'integration');
});

test('🛑 e3ModeTransitionHandler: identity_anchoring + owned_via_acceptance → cascade (transitions/ replacement)', async () => {
  // PR-23s4b: replaces transitions/phase-3b-to-4-acceptance.js path.
  const r = await e3ModeTransitionHandler({
    session_state: {
      primary_mode: 'identity_anchoring',
      active_modes: ['identity_anchoring'],
      paused_modes: [],
      current_quality_status: 'owned_via_acceptance',
    },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.primary_mode, 'cascade');
  assert.equal(r.patch.mode_transition_log[0].trigger_detail, 'owned_via_acceptance');
});

test('🛑 e3ModeTransitionHandler: cascade + completed → transition to future_pacing', async () => {
  const r = await e3ModeTransitionHandler({
    session_state: {
      primary_mode: 'cascade',
      active_modes: ['cascade'],
      paused_modes: [],
      cascade_down_progress: { status: 'completed' },
    },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.primary_mode, 'future_pacing');
  assert.equal(r.patch.mode_transition_log[0].trigger_type, 'natural_completion');
});

test('e3ModeTransitionHandler: not in governed mode → not handled', async () => {
  const r = await e3ModeTransitionHandler({
    session_state: {
      primary_mode: 'elicitation',
      active_modes: ['elicitation'],
      paused_modes: [],
      current_quality_status: 'owned',   // would have triggered in old status-router
    },
  });
  assert.equal(r.handled, false);
});

test('e3ModeTransitionHandler: identity_anchoring + candidate → not handled (stay)', async () => {
  const r = await e3ModeTransitionHandler({
    session_state: {
      primary_mode: 'identity_anchoring',
      active_modes: ['identity_anchoring'],
      paused_modes: [],
      current_quality_status: 'candidate',
    },
  });
  assert.equal(r.handled, false, 'candidate/none stays in identity_anchoring');
});

test('e3CascadeModeHandler: cascade_down phase → handled', async () => {
  const r = await e3CascadeModeHandler({ session_state: { router_phase: 'cascade_down' } });
  assert.equal(r.handled, true);
});

test('e3CascadeModeHandler: other phase → not handled', async () => {
  const r = await e3CascadeModeHandler({ session_state: { router_phase: 'elicitation' } });
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

test('ALL_DETECTORS: 14 detectors (E1 + 7×E3 + passive_hope + E2 + 4×E4) — PR-23s4c', () => {
  // PR-23s4c task 2 added integration-router + future-pacing-router (+2 to E3).
  // PR-23s4c task 4 added passive-hope-cascade (+1, between deep_signal and elicitation).
  assert.equal(ALL_DETECTORS.length, 14);
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

test('registerAllDetectors: registers all 14 into a registry without error (PR-23s4c)', () => {
  const reg = registerAllDetectors(new DetectorRegistry());
  assert.equal(reg.size(), 14);
});

test('registerAllDetectors: user_turn cascade ordered E1→E3→E2 by priority', () => {
  const reg = registerAllDetectors(new DetectorRegistry());
  const order = reg.listForEvent('user_turn').map(d => d.priority);
  const sorted = [...order].sort((a, b) => a - b);
  assert.deepEqual(order, sorted, 'cascade must be priority-ascending');
  assert.equal(order[0], 10);                          // E1 first
  assert.equal(order[order.length - 1], 70);           // E2 last
});

test('registerAllDetectors: E3_DETECTORS / E4_DETECTORS arrays are non-empty (PR-23s4c)', () => {
  assert.equal(E3_DETECTORS.length, 7);   // PR-23s4c: +integration-router +future-pacing-router
  assert.equal(E4_DETECTORS.length, 4);
});

// ═════════════════════════════════════════════════════════
// 🛑 PR-23s4c task 9 — Beta simulation regression tests.
// Focused subset of the 16 Beta sim scenarios per v51_engine_3_errata_v02.md:
// mode flow correctness / A006 passive_hope cascade / mode-aware logging /
// primary-only inject / read-time fallback.
// ═════════════════════════════════════════════════════════

import { passiveHopeCascadeHandler } from './passive-hope-cascade.js';
import { e3IntegrationRouterHandler, e3FuturePacingRouterHandler } from './engine-3.js';

test('🛑 sim A006-D1: passive_hope text + life-context + no other deep_signal → adjacent marked, no cascade yet', async () => {
  const r = await passiveHopeCascadeHandler({
    session_state: {
      primary_mode: 'elicitation',
      active_modes: ['elicitation'],
      paused_modes: [],
      deep_signal_flags: {},   // no other deep signal yet
    },
    user_response: '上天既然讓我活著、應該是有什麼事等待我去完成',
    last_3_turns: ['我活下去的動力越來越少', '不知道'],   // life-context
    user_profile: { passive_death_wish_count: 0 },
  });
  assert.equal(r.handled, true);
  // No deep signal yet + cross-session count 0 + same-session adjacent 0 → no cascade.
  assert.equal(r.patch.activity_death_adjacent, true);
  assert.equal(r.patch.activity_death_adjacent_count, 1);
  // Mode unchanged (not yet triggered crisis).
  assert.notEqual(r.patch.primary_mode, 'crisis');
});

test('🛑 sim A006-D1 escalated (Step 5a switch): S2 hit + death-adjacent + same-session adjacent ≥ 1 → cascade crisis', async () => {
  // Step 5a: passive-hope-cascade now uses engine-1 S2 detector.
  //   Text must match S2 GROUPS (等老天 / 等對的人 / 存在性 hope) AND have death-adjacent context.
  const r = await passiveHopeCascadeHandler({
    session_state: {
      primary_mode: 'elicitation',
      active_modes: ['elicitation'],
      paused_modes: [],
      deep_signal_flags: {},
      activity_death_adjacent_count: 1,
    },
    // S2 group_a (上天.讓我) + death-adjacent context turn = cascade per spec.
    user_response: '上天讓我活著吧',
    last_3_turns: ['不想活', '結束生命'],
    user_profile: { passive_death_wish_count: 0 },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.primary_mode, 'crisis');
  assert.equal(r.patch.crisis_in_progress, true);
  assert.equal(r.patch.passive_hope_cascade_triggered_this_session, true);
  assert.ok(Array.isArray(r.patch.mode_transition_log));
  assert.equal(r.patch.mode_transition_log[0].trigger_type, 'signal_cascade');
});

test('🛑 sim A006-D1 cross-session: S2 hit + death-adjacent + cross-session count ≥ 3 → immediate cascade', async () => {
  const r = await passiveHopeCascadeHandler({
    session_state: {
      primary_mode: 'elicitation',
      active_modes: ['elicitation'],
      paused_modes: [],
      deep_signal_flags: {},
    },
    user_response: '我想等老天安排',
    last_3_turns: ['活下去的動力', '此生'],
    user_profile: { passive_death_wish_count: 3 },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.primary_mode, 'crisis');
});

test('🛑 sim Step 5a: S2 hit but NO death-adjacent → passive-hope-cascade does NOT cascade (engine-1 light path takes over)', async () => {
  const r = await passiveHopeCascadeHandler({
    session_state: { primary_mode: 'elicitation', deep_signal_flags: {} },
    user_response: '我希望等對的人出現',     // S2 group_b
    last_3_turns: ['工作', '今天天氣不錯'],   // NO death-adjacent
    user_profile: { passive_death_wish_count: 0 },
  });
  // Step 5a: non-death-adjacent → handed off to engine-1 S2_LIGHT_INJECT path, cascade skipped.
  assert.equal(r.handled, false);
});

test('sim: passive_hope without life-context → 不升級 (Step 5a: S2 detects but no death-adjacent → no cascade)', async () => {
  const r = await passiveHopeCascadeHandler({
    session_state: { primary_mode: 'elicitation' },
    user_response: '我希望等緣分到來',         // S2 group_a (緣分)
    last_3_turns: ['今天天氣不錯', '工作很忙'],   // NO death-adjacent
    user_profile: { passive_death_wish_count: 0 },
  });
  // Step 5a: S2 hits but death_adjacent=false → engine-1 S2_LIGHT_INJECT path, cascade skipped.
  assert.equal(r.handled, false);
});

test('sim: passive_hope dedup vs deep-signal-detector (per spec 同 turn 同訊號只 count 一次)', async () => {
  // If deep-signal-detector already ran this turn (passive_dw_detected=true),
  // passive-hope-cascade must not double-count.
  const r = await passiveHopeCascadeHandler({
    session_state: {
      primary_mode: 'elicitation',
      deep_signal_flags: { passive_dw_detected: true },   // already counted
    },
    user_response: '我不想活了',
    user_profile: { passive_death_wish_count: 0 },
  });
  assert.equal(r.handled, false, 'must not fire when deep-signal already detected this turn');
});

test('🛑 sim A003 Day 3-5 Top 1 演進: surface 新方向 → 不算 failure (mode flexibility)', async () => {
  // v5.1 mode model: surface 新方向 in any mode = legal Top 1 evolution, not failure.
  // mode-transition-router should NOT auto-transition without explicit conditions.
  const r = await e3IntegrationRouterHandler({
    session_state: {
      primary_mode: 'integration',
      active_modes: ['integration'],
      paused_modes: [],
    },
    user_response: '我突然想到我真正想要的是「自由」',
  });
  // integration-router fires while in integration mode (inject only, no transition).
  assert.equal(r.handled, true);
  // Mode unchanged — surface 新方向 alone doesn't trigger transition (NLP判斷 TODO).
  // This test docs the current behavior: transitions are explicit, not surface-driven.
  assert.deepEqual(r.patch, {});
});

test('🛑 sim: integration mode fires integration-router inject, not future_pacing-router', async () => {
  const ctx = {
    session_state: { primary_mode: 'integration', active_modes: ['integration'], paused_modes: [] },
    user_response: '我覺得有時是有時不是',
  };
  const int_r = await e3IntegrationRouterHandler(ctx);
  const fp_r = await e3FuturePacingRouterHandler(ctx);
  assert.equal(int_r.handled, true, 'integration-router fires in integration mode');
  assert.equal(fp_r.handled, false, 'future-pacing-router does NOT fire in integration mode');
});

test('🛑 sim: future_pacing mode fires future-pacing-router, not integration-router', async () => {
  const ctx = {
    session_state: { primary_mode: 'future_pacing', active_modes: ['future_pacing'], paused_modes: [] },
    user_response: '我想三個月後的我會是什麼樣子',
  };
  const int_r = await e3IntegrationRouterHandler(ctx);
  const fp_r = await e3FuturePacingRouterHandler(ctx);
  assert.equal(int_r.handled, false);
  assert.equal(fp_r.handled, true);
  assert.match(fp_r.inject, /Future Pacing/);
});

test('🛑 sim: mode-aware logging — deep-signal handler emits signal_cascade transition entry', async () => {
  const r = await e3DeepSignalHandler({
    session_state: {
      primary_mode: 'elicitation', active_modes: ['elicitation'], paused_modes: [],
      mode_transition_log: [],
    },
    user_response: '我不想活了',
    user_profile: { passive_death_wish_count: 0 },
  });
  assert.equal(r.handled, true);
  // PR-23s4c task 3: signal_cascade transition entry emitted.
  assert.ok(Array.isArray(r.patch.mode_transition_log));
  assert.equal(r.patch.mode_transition_log[0].trigger_type, 'signal_cascade');
  assert.equal(r.patch.mode_transition_log[0].from_primary, 'elicitation');
  assert.equal(r.patch.mode_transition_log[0].to_primary, 'crisis');
  // mode-tracker writes active + paused.
  assert.deepEqual(r.patch.active_modes, ['crisis']);
  assert.deepEqual(r.patch.paused_modes, ['elicitation']);
  // crisis_state_carry_forward stub written (Step 6 完整 SOP 後升級).
  assert.ok(r.patch.crisis_state_carry_forward);
  assert.equal(r.patch.crisis_state_carry_forward.pending_step6_complete, true);
});

test('🛑 sim: read-time fallback — router_phase only, no primary_mode, derive correctly', async () => {
  // PR-23s4a: legacy session_state with only router_phase, no mode keys.
  // Handler should treat it as if in derived mode (e.g. cascade_down → cascade).
  const r = await e3CascadeModeHandler({
    session_state: {
      // No primary_mode; legacy router_phase only.
      router_phase: 'cascade_down',
    },
    user_response: '我是一個勇敢的人',
  });
  // readModeState fallback maps cascade_down → cascade → handler fires.
  assert.equal(r.handled, true);
});

// ═════════════════════════════════════════════════════════
// 🛑 fable 6/26 — detector-卡 patch (vague 門檻 + E2 stay 上限)
// ═════════════════════════════════════════════════════════

test('🛑 fable 6/26: vague 門檻 2->3 — consecutive_vague_turns=2 → 不觸發 cumulative_vague', () => {
  const r = matchE1('一段完全正常沒有偏離訊號的具體回答內容描述', {
    consecutive_vague_turns: 2,
  });
  assert.equal(r.triggered.includes('cumulative_vague'), false, '2 輪不再觸發(放寬後)');
  const r3 = matchE1('一段完全正常沒有偏離訊號的具體回答內容描述', {
    consecutive_vague_turns: 3,
  });
  assert.ok(r3.triggered.includes('cumulative_vague'), '3 輪才觸發');
});

test('🛑 fable 6/26: E2 同一 candidate 連 2 次 stay → 換角度 inject + counter', async () => {
  const base = { cumulative_ppl_score: 0.8, current_quality_candidate_term: '勇敢的' };
  const r1 = await e2MasterHandler({ session_state: { ...base }, user_response: '我是一個勇敢的人' });
  assert.equal(r1.patch.aggregation_result.recommended_sub_prompt, 'stay');
  assert.equal(r1.patch.consecutive_stay_count, 1);
  assert.equal(r1.patch.last_stay_candidate, '勇敢的');
  assert.equal(/換角度/.test(r1.inject), false, '第一次 stay 不出換角度');
  const r2 = await e2MasterHandler({
    session_state: { ...base, last_stay_candidate: '勇敢的', consecutive_stay_count: 1 },
    user_response: '我是一個勇敢的人',
  });
  assert.equal(r2.patch.consecutive_stay_count, 2);
  assert.match(r2.inject, /換角度/);
  assert.equal(r2.patch.e2_stay_angle_switch_this_turn, true);
});
