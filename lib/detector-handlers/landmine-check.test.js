// lib/detector-handlers/landmine-check.test.js
// v5.1 Step 5b — Lock Landmine 3-tier classification + ship-able phrasing.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyLandmine, LANDMINE_RESULT,
  buildTier1RejectInject, buildTier2GuidanceInject, buildTier3ReframeNote,
  studentInsistsLandmine,
} from './landmine-check.js';
import { e2MasterHandler, runAggregator, matchE2 } from './engine-2.js';

// ─── classifyLandmine: 3 tier coverage ──────────────────

test('🛑 classifyLandmine: tier 1「被需要」 → tier1_rejected', () => {
  const r = classifyLandmine('被需要');
  assert.equal(r.tier, 'tier1');
  assert.equal(r.result, LANDMINE_RESULT.TIER1_REJECTED);
  assert.equal(r.term_matched, '被需要');
});

test('🛑 classifyLandmine: tier 1「被選擇」 / 「被認同」 / Status / Power → tier1', () => {
  for (const term of ['被選擇', '被認同', '成功的', '有權力的']) {
    const r = classifyLandmine(term);
    assert.equal(r.tier, 'tier1', `${term} should be tier1`);
  }
});

test('🛑 classifyLandmine: tier 1 v5.0 既有 regression preserved', () => {
  assert.equal(classifyLandmine('成功的').tier, 'tier1');
  assert.equal(classifyLandmine('有 self-worth 的').tier, 'tier1');
  assert.equal(classifyLandmine('自律的').tier, 'tier1');
  assert.equal(classifyLandmine('幫助別人的').tier, 'tier1');
});

test('🛑 classifyLandmine: tier 2「安全感」 → tier2_pending', () => {
  const r = classifyLandmine('安全感');
  assert.equal(r.tier, 'tier2');
  assert.equal(r.result, LANDMINE_RESULT.TIER2_PENDING);
});

test('🛑 classifyLandmine: tier 2「開心 / 快樂 / 幸福 / 滿足」 (副產品) → tier2', () => {
  for (const term of ['開心', '快樂', '幸福', '滿足']) {
    const r = classifyLandmine(term);
    assert.equal(r.tier, 'tier2', `${term} should be tier2 副產品`);
  }
});

test('🛑 classifyLandmine: tier 2「有意義」/「希望」 → tier2', () => {
  assert.equal(classifyLandmine('有意義').tier, 'tier2');
  assert.equal(classifyLandmine('希望').tier, 'tier2');
});

test('🛑 classifyLandmine: tier 3「自由」 → tier3_accepted_with_reframe', () => {
  const r = classifyLandmine('自由');
  assert.equal(r.tier, 'tier3');
  assert.equal(r.result, LANDMINE_RESULT.TIER3_ACCEPTED_WITH_REFRAME);
});

test('🛑 classifyLandmine: tier 3「真實」 / Authenticity → tier3', () => {
  assert.equal(classifyLandmine('真實').tier, 'tier3');
  assert.equal(classifyLandmine('Authenticity').tier, 'tier3');
});

test('🛑 classifyLandmine: 「勇敢的」 (legit Damon quality) → pass (no tier match)', () => {
  const r = classifyLandmine('勇敢的');
  assert.equal(r.tier, null);
  assert.equal(r.result, LANDMINE_RESULT.PASS);
});

test('classifyLandmine: null / empty → pass', () => {
  assert.equal(classifyLandmine(null).tier, null);
  assert.equal(classifyLandmine('').tier, null);
  assert.equal(classifyLandmine(undefined).tier, null);
});

// ─── Ship-able phrasing per spec §A2 ─────────────────────

test('🛑 buildTier1RejectInject: substitutes term + contains spec phrasing', () => {
  const inject = buildTier1RejectInject('被需要');
  assert.match(inject, /『被需要』/);
  assert.match(inject, /Damon 的體系裡、不是 quality、是 strategy/);
  assert.match(inject, /你『被需要』時、感覺到的是什麼/);
  // R1 深挖句也在
  assert.match(inject, /那個感覺、是從哪裡來的/);
});

test('🛑 buildTier2GuidanceInject: contains 4-面 context judgment guidance', () => {
  const inject = buildTier2GuidanceInject('開心');
  assert.match(inject, /「開心」/);   // template uses 「」 (CJK corner brackets)
  // 4 tier 2 詞的 context 判準 (line-by-line check; single regex with .* over
  // multiline content of 「 / 」 is fragile).
  assert.match(inject, /安全感/);
  assert.match(inject, /開心/);
  assert.match(inject, /快樂/);
  assert.match(inject, /幸福/);
  assert.match(inject, /滿足/);
  assert.match(inject, /有意義/);
  assert.match(inject, /希望/);
  assert.match(inject, /絕大多數拒/);
});

test('🛑 buildTier3ReframeNote: 自由 → Freedom From vs To framing', () => {
  const inject = buildTier3ReframeNote('自由');
  assert.match(inject, /『自由』/);
  assert.match(inject, /Freedom From.*Freedom To/s);
  assert.match(inject, /Away from.*Toward/s);
});

// ─── M_LM_1 — student insistence detector ────────────────

test('🛑 studentInsistsLandmine: 「我就是要被需要、就是這個」 → true', () => {
  assert.equal(studentInsistsLandmine('我就是要被需要、就是這個'), true);
});

test('🛑 studentInsistsLandmine: 「我堅持就是這個」 → true', () => {
  assert.equal(studentInsistsLandmine('我堅持就是這個 Top 1'), true);
});

test('studentInsistsLandmine: 普通澄清「啊不是、是別的」 → false', () => {
  assert.equal(studentInsistsLandmine('啊不是、是別的詞'), false);
});

// ─── E2 master handler integration: blacklist tier behavior ──

test('🛑 matchE2: tier 1 hard reject (legacy blacklist behavior preserved)', () => {
  const r = matchE2('我是一個被需要的人');
  // 被需要 in tier 1 → blacklist hit → suspected stays false unless other valid candidate.
  // Since "被需要" is the only quality-like term and it's blacklisted, suspected=false.
  assert.equal(r.suspected, false);
});

test('🛑 matchE2: tier 2「開心」 alone — blacklist (tier 1 alias) doesn\'t fire because tier 2 not in flat list', () => {
  // matchE2's flat `blacklist` is tier 1 only. 開心 (tier 2) doesn't hard-reject.
  // But「開心」 also isn't in quality_terms.{A,B,C,D,E} so no candidate_term.
  // Therefore suspected stays false (no positive match either).
  const r = matchE2('我覺得很開心');
  assert.equal(r.suspected, false);
});

test('🛑 matchE2: legitimate quality 「勇敢的」 → suspected=true (regression)', () => {
  const r = matchE2('我是一個勇敢的人');
  assert.equal(r.suspected, true);
  assert.equal(r.candidate_term, '勇敢的');
});

// ─── e2MasterHandler: Landmine Check integration at door 4 pass ──

const mockJudge = (overrides) => async () => ({
  has_time_marker: true, has_location_marker: true,
  has_person_marker: true, has_action_marker: true,
  sensory_detail_score: 4,
  evidence_attribution: 'self',
  derived_from_another_value: false,
  dim_4: false,
  ...overrides,
});

test('🛑 e2MasterHandler: door 4 pass + tier 1 candidate → reject upgrade, R1 reject inject', async () => {
  // Simulate state where candidate_term="被需要" already set (from prior turn).
  const r = await e2MasterHandler({
    session_state: {
      current_quality_candidate_term: '被需要',
      identity_sentence_pattern_hit: true,
      cumulative_ppl_score: 0.1,
    },
    user_response: '我這人從小就是這樣、昨天在家裡跟我媽收衣服', // IS6 identity sentence ('我這人') + sensory
    judges: { sensoryDetail: mockJudge() },
  });
  assert.equal(r.handled, true);
  // tier 1 → NOT owned even though door 4 passed.
  assert.notEqual(r.patch.current_quality_status, 'owned');
  assert.equal(r.patch.landmine_value_check_result, LANDMINE_RESULT.TIER1_REJECTED);
  // Inject contains tier 1 reject phrasing.
  assert.match(r.inject, /Landmine Check Tier 1 Reject/);
  assert.match(r.inject, /『被需要』/);
});

test('🛑 e2MasterHandler: dim_4=true → R2 reframe inject, NOT upgraded', async () => {
  const r = await e2MasterHandler({
    session_state: {
      current_quality_candidate_term: '溫暖的',
      identity_sentence_pattern_hit: true,
      cumulative_ppl_score: 0.1,
    },
    user_response: '我這人就是這樣、昨天溫暖待人因為我想要他們回報', // IS6 + strategy framing
    judges: { sensoryDetail: mockJudge({ dim_4: true }) },
  });
  assert.equal(r.handled, true);
  assert.notEqual(r.patch.current_quality_status, 'owned');
  assert.equal(r.patch.dim_4_triggered_this_turn, true);
  assert.match(r.inject, /Strategy vs Quality.*R2/s);
});

test('🛑 e2MasterHandler: door 4 pass + clean Damon quality → upgrade to owned, landmine pass', async () => {
  const r = await e2MasterHandler({
    session_state: {
      current_quality_candidate_term: '勇敢的',
      identity_sentence_pattern_hit: true,
      cumulative_ppl_score: 0.1,
    },
    user_response: '我這人從小就是這樣、昨天跟主管說了不',
    judges: { sensoryDetail: mockJudge() },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.current_quality_status, 'owned');
  assert.equal(r.patch.landmine_value_check_result, LANDMINE_RESULT.PASS);
});

test('🛑 e2MasterHandler: tier 3「自由」 → upgrade owned + reframe note appended', async () => {
  const r = await e2MasterHandler({
    session_state: {
      current_quality_candidate_term: '自由',
      identity_sentence_pattern_hit: true,
      cumulative_ppl_score: 0.1,
    },
    user_response: '我這人天生就是這樣、昨天自己選擇離開那個工作',
    judges: { sensoryDetail: mockJudge() },
  });
  assert.equal(r.handled, true);
  // tier 3 accepts owned (with reframe flag).
  assert.equal(r.patch.current_quality_status, 'owned');
  assert.equal(r.patch.landmine_value_check_result, LANDMINE_RESULT.TIER3_ACCEPTED_WITH_REFRAME);
  assert.match(r.inject, /Tier 3 Accept \+ Reframe/);
});

test('🛑 e2MasterHandler: M_LM_1 — prior tier1 + student insistence → ambiguous + handoff', async () => {
  const r = await e2MasterHandler({
    session_state: {
      current_quality_candidate_term: '被需要',
      identity_sentence_pattern_hit: true,
      cumulative_ppl_score: 0.1,
      landmine_value_check_result: LANDMINE_RESULT.TIER1_REJECTED,   // prior turn reject
    },
    // M_LM_1: identity sentence + insistence. Don't repeat Landmine term verbatim
    // (would trigger matchE2 blacklist block). Insistence reaches the handler
    // because matchE2 suspected via identity sentence.
    user_response: '我這人就是這樣、我堅持要這個',
    judges: { sensoryDetail: mockJudge() },
  });
  assert.equal(r.handled, true);
  assert.equal(r.patch.current_quality_status, 'ambiguous');
  assert.equal(r.patch.landmine_insistence_handoff, true);
  assert.match(r.inject, /M_LM_1.*handoff_escalation/s);
});

test('e2MasterHandler: dim_4 judge timeout → fail-open (per spec §A3, missing dim_4 → false)', async () => {
  // Judge returns NO dim_4 field — parse defaults to false → upgrade proceeds.
  const r = await e2MasterHandler({
    session_state: {
      current_quality_candidate_term: '勇敢的',
      identity_sentence_pattern_hit: true,
      cumulative_ppl_score: 0.1,
    },
    user_response: '我這人就是這樣、昨天跟主管說不',
    judges: {
      sensoryDetail: async () => ({
        has_time_marker: true, has_location_marker: true,
        has_person_marker: true, has_action_marker: true,
        sensory_detail_score: 4,
        evidence_attribution: 'self',
        derived_from_another_value: false,
        // dim_4 missing — caller (runAggregator) treats as false.
      }),
    },
  });
  // No dim_4_triggered_this_turn → upgrade succeeds.
  assert.equal(r.patch.current_quality_status, 'owned');
});
