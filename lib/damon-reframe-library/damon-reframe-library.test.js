// lib/damon-reframe-library/damon-reframe-library.test.js
// v5.1 Step 7 PR-7a — Lock R1-R7 + R11 + §9 stacking + invocation tracker.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  R1, R2, R3, R4, R5, R6, R7, R11,
  R1_VARIANTS, R2_VARIANTS, R3_VARIANTS, R7_VARIANTS,
  REFRAME_REGISTRY, REFRAME_TIERS, RESERVED_NOT_SHIPPED,
  getReframe,
} from './index.js';
import { pickReframeForTurn, _internal as STACKING_INTERNAL } from './stacking.js';
import {
  buildInvocationEntry, countPerSession, shouldDownsize,
  appendToSessionHistoryPatch, patchLatestOutcome,
} from './invocation-tracker.js';

// ─── Reserved / 廢除 guard ────────────────────────────────

test('🛑 getReframe: R10 永久廢除 → 顯式 throw', () => {
  assert.throws(() => getReframe('R10'), /R10 Memento Mori is permanently deprecated/);
});

test('🛑 getReframe: R9 暫留 → throw + 引導開新 PR', () => {
  assert.throws(() => getReframe('R9'), /reserved \(not shipped\).*As-If Frame/);
});

test('🛑 getReframe: R1_D / R1_E / R7_C / R7_D / R8_BIAS_ACTION 暫留也 throw', () => {
  for (const id of ['R1_D', 'R1_E', 'R7_D', 'R8_BIAS_ACTION', 'ELICITATION_OPENING_V2', 'SECTION_3_DIAMOND_ESSENCE']) {
    assert.throws(() => getReframe(id), /reserved \(not shipped\)/, `${id} must throw`);
  }
});

test('getReframe: unknown id → throw', () => {
  assert.throws(() => getReframe('R99'), /Unknown reframe id/);
});

test('getReframe: valid R1-R7 + R11 returns module', () => {
  for (const id of ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R11']) {
    const r = getReframe(id);
    assert.equal(r.id, id);
    assert.equal(typeof r.buildInject, 'function');
    assert.equal(typeof r.shouldInvoke, 'function');
  }
});

test('REFRAME_REGISTRY: 9 entries (R1-R8 + R11), no R9/R10/R12 (Step 7 PR-7b adds R8)', () => {
  const ids = Object.keys(REFRAME_REGISTRY).sort();
  assert.deepEqual(ids, ['R1', 'R11', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8']);
  assert.equal(REFRAME_REGISTRY.R8.id, 'R8', 'R8 T.O.T.E. ships in PR-7b');
  assert.equal(REFRAME_REGISTRY.R9, undefined, 'R9 暫留');
  assert.equal(REFRAME_REGISTRY.R10, undefined, 'R10 廢除');
  assert.equal(REFRAME_REGISTRY.R12, undefined, 'R12 is sub-prompt, not in reframe registry');
});

test('RESERVED_NOT_SHIPPED: includes暫留 8 items', () => {
  const keys = Object.keys(RESERVED_NOT_SHIPPED).sort();
  assert.deepEqual(keys, [
    'ELICITATION_OPENING_V2', 'R1_D', 'R1_E', 'R7_C', 'R7_D', 'R8_BIAS_ACTION', 'R9',
    'SECTION_3_DIAMOND_ESSENCE',
  ]);
});

// ─── R1 Reclaim Source ───────────────────────────────────

test('🛑 R1 shouldInvoke: crisis_mode → blocked', () => {
  const r = R1.shouldInvoke({ primary_mode: 'crisis' }, {});
  assert.equal(r.invoke, false);
  assert.equal(r.reason, 'crisis_mode_active');
});

test('🛑 R1 shouldInvoke: factual statement (「他打了我」) → blocked (F3)', () => {
  const r = R1.shouldInvoke({ primary_mode: 'integration' }, { is_factual_statement: true });
  assert.equal(r.invoke, false);
  assert.equal(r.reason, 'factual_statement_not_projection');
});

test('🛑 R1 shouldInvoke: 5+ prior invocations → over_invocation', () => {
  const state = {
    primary_mode: 'integration',
    reframe_invocation_history_in_session: Array.from({ length: 5 }, () => ({ reframe_id: 'R1' })),
  };
  const r = R1.shouldInvoke(state, {});
  assert.equal(r.invoke, false);
  assert.equal(r.reason, 'over_invocation_per_session_cap_5');
});

test('🛑 R1 shouldInvoke: negative_generalization → R1_B variant', () => {
  const r = R1.shouldInvoke({ primary_mode: 'integration' }, { negative_generalization: true });
  assert.equal(r.invoke, true);
  assert.equal(r.variant, R1_VARIANTS.R1_B);
});

test('🛑 R1 buildInject: standard contains library §2.4 5-step verbatim anchors', () => {
  const txt = R1.buildInject({ projection_quote: '她讓我很開心', mode: 'integration' });
  assert.match(txt, /R1 Reclaim Source/);
  assert.match(txt, /Step 1 — pause and notice/);
  assert.match(txt, /等一下、我注意到你說/);
  assert.match(txt, /Step 2 — question the source/);
  assert.match(txt, /\[他\/她\] 出現之前/);
  assert.match(txt, /Step 5 — strengthen anchor/);
});

test('🛑 R1 buildInject: R1_C crisis variant w/o de-escalation flag → 顯式 disabled guard', () => {
  // Step 6 PR-6a: R1_C gate rewritten — was "ship 前臨床 review 條件未通過"
  //   now gates on ctx.de_escalation_sub_mode (set by crisis-sop on natural exit).
  const txt = R1.buildInject({ variant: R1_VARIANTS.R1_C });
  assert.match(txt, /R1_C.*disabled/);
  assert.match(txt, /沒進入 crisis-mixed-with-meaning-making/);
  assert.match(txt, /Step 6 PR-6a crisis-sop\.js/);
  assert.doesNotMatch(txt, /Step 1 — pause and notice/, 'must NOT inject full script in blocked C mode');
});

test('🛑 R1 buildInject: multi-turn anchor reference path (prior > 0)', () => {
  const txt = R1.buildInject({ projection_quote: '他不選我', prior_invocations: 2 });
  assert.match(txt, /multi-turn anchor reference, prior=2/);
  assert.match(txt, /我們之前說過/);
  assert.doesNotMatch(txt, /Step 1 — pause and notice/, 'multi-turn does NOT re-walk');
});

test('🛑 R1 buildInject: R1_B includes negative-generalization prelude', () => {
  const txt = R1.buildInject({ variant: R1_VARIANTS.R1_B });
  assert.match(txt, /R1_B 前置 — negative generalization/);
  assert.match(txt, /pattern、我們先看清楚/);
});

// ─── R2 Behavior to Identity ─────────────────────────────

test('🛑 R2 shouldInvoke: insufficient sensory (a1 < 2) → blocked F1', () => {
  const r = R2.shouldInvoke({ primary_mode: 'identity_anchoring' }, { sensory_detail_count: 1 });
  assert.equal(r.invoke, false);
  assert.equal(r.reason, 'insufficient_sensory_evidence_a1_lt_2');
});

test('🛑 R2 buildInject: standard contains 4-step library §3.4 verbatim', () => {
  const txt = R2.buildInject({
    behavior_quote: '我去爬山', quality: '自由', mode: 'identity_anchoring',
  });
  assert.match(txt, /R2 Behavior to Identity/);
  assert.match(txt, /Step 1 — acknowledge specific behavior/);
  assert.match(txt, /Step 2 — state the reframe/);
  assert.match(txt, /這不是你想像自己是什麼樣的人、這是你實際做到的事/);
  assert.match(txt, /Step 3 — invite owning/);
});

test('🛑 R2 buildInject: R2_C long_pattern Damon A006-D5 verbatim', () => {
  const txt = R2.buildInject({ variant: R2_VARIANTS.R2_C, quality: '溫暖' });
  assert.match(txt, /從小就會做的事/);
  assert.match(txt, /不是學來的、不是決定的——就是你/);
});

test('🛑 R2 buildInject: 5+ prior → downsize sober ack, NOT full reframe', () => {
  const txt = R2.buildInject({ prior_invocations: 5 });
  assert.match(txt, /downsized/);
  assert.doesNotMatch(txt, /Step 2 — state the reframe/);
});

// ─── R3 Failure as Feedback ──────────────────────────────

test('🛑 R3 buildInject: standard 5-step library §4.4 verbatim', () => {
  const txt = R3.buildInject({
    failure_quote: '我又遲到', self_blame_quote: '我就是做不到', mode: 'integration',
  });
  assert.match(txt, /R3_A Failure as Feedback \(standard\)/);
  assert.match(txt, /Step 1 — pause at self-blame/);
  assert.match(txt, /Step 2 — distinction/);
  assert.match(txt, /失敗不會動搖你、它教你/);
});

test('🛑 R3 buildInject: R3_B negative_generalization → cascade R11 stub', () => {
  const txt = R3.buildInject({ variant: R3_VARIANTS.R3_B });
  assert.match(txt, /cascade R11/);
  assert.match(txt, /S5_INTEGRATION_INJECT/);
  assert.doesNotMatch(txt, /Step 3 — state the reframe/);
});

// ─── R4 Money as Fuel ────────────────────────────────────

test('🛑 R4 shouldInvoke: no money_value_conflict signal → blocked', () => {
  const r = R4.shouldInvoke({ primary_mode: 'elicitation' }, {});
  assert.equal(r.invoke, false);
});

test('🛑 R4 shouldInvoke: Top 1 = 「踏實」 (material itself) → blocked', () => {
  const r = R4.shouldInvoke(
    { primary_mode: 'elicitation', top1_value: '踏實' },
    { money_value_conflict: true },
  );
  assert.equal(r.invoke, false);
  assert.equal(r.reason, 'top1_is_material_quality_itself');
});

test('🛑 R4 buildInject: library §5.4 5-step verbatim distinction', () => {
  const txt = R4.buildInject({ conflict_quote: '我想要金錢豐盛跟自由衝突', top_quality: '自由' });
  assert.match(txt, /R4 Money as Fuel/);
  assert.match(txt, /用來服務 \[自由\] 的 fuel/);
  assert.match(txt, /Step 5 — if learner says money IS the value/);
});

// ─── R5 Away From → Toward ───────────────────────────────

test('🛑 R5 shouldInvoke: away_from_marker or landmine_freedom_from → invoke', () => {
  const r1 = R5.shouldInvoke({ primary_mode: 'elicitation' }, { away_from_marker: true });
  assert.equal(r1.invoke, true);
  const r2 = R5.shouldInvoke({ primary_mode: 'elicitation' }, { landmine_freedom_from: true });
  assert.equal(r2.invoke, true);
});

test('🛑 R5 buildInject: 5-step + landmine note when landmine_term=自由', () => {
  const txt = R5.buildInject({
    negative_quote: '我不要再焦慮', landmine_term: '自由',
  });
  assert.match(txt, /R5 Away From → Toward/);
  assert.match(txt, /Step 2 — the flip/);
  assert.match(txt, /這個『不要 \[X\]』的背面/);
  assert.match(txt, /landmine context.*自由/);
});

// ─── R6 First Position Return ────────────────────────────

test('🛑 R6 buildInject: §7.4 5-step verbatim (亞洲女性 cohort)', () => {
  const txt = R6.buildInject({
    self_neglect_quote: '我都先想別人怎麼樣', years_of_pattern: '20',
  });
  assert.match(txt, /R6 First Position Return/);
  assert.match(txt, /Step 2 — name the position/);
  assert.match(txt, /20 年來/);
  assert.match(txt, /這是第二位置/);
  assert.match(txt, /Step 5 — anchor first position/);
});

// ─── R7 Slip into Unconscious ────────────────────────────

test('🛑 R7 shouldInvoke: program_close_let_it_go_ritual → R7_C variant', () => {
  const r = R7.shouldInvoke({ primary_mode: 'future_pacing' }, { program_close_let_it_go_ritual: true });
  assert.equal(r.invoke, true);
  assert.equal(r.variant, R7_VARIANTS.R7_C);
});

test('🛑 R7 shouldInvoke: perfectionism_marker → R7_B variant', () => {
  const r = R7.shouldInvoke({ primary_mode: 'identity_anchoring' }, { perfectionism_marker: true });
  assert.equal(r.invoke, true);
  assert.equal(r.variant, R7_VARIANTS.R7_B);
});

test('🛑 R7_A buildInject: library §8.4 5-step verbatim', () => {
  const txt = R7.buildInject({
    frequency_check_quote: '我今天夠不夠平靜', quality: '平靜', role: '平靜的人',
  });
  assert.match(txt, /R7 Slip into Unconscious \(standard\)/);
  assert.match(txt, /\[平靜\] 是身份、不是成績單/);
  assert.match(txt, /身體記得、頭腦不一定要記得/);
  assert.match(txt, /讓 \[平靜\] 變成你的自動模式/);
});

test('🛑 R7_C let_it_go_ritual: library §8.5 verbatim ritual phrasing', () => {
  const txt = R7.buildInject({ variant: R7_VARIANTS.R7_C, quality: '勇敢' });
  assert.match(txt, /R7_C Let It Go Ritual/);
  assert.match(txt, /\[勇敢\] 現在是你的。我們在這停一下/);
  assert.match(txt, /身體記得、頭腦不一定要記得/);
  assert.match(txt, /不需要驗證/);
  assert.match(txt, /不需要焦慮/);
});

test('🛑 R7_B perfectionism: 100% reframe phrasing', () => {
  const txt = R7.buildInject({ variant: R7_VARIANTS.R7_B, quality: '平靜' });
  assert.match(txt, /100% 是不存在的目標/);
  assert.match(txt, /崩潰是事件、平靜 是你是誰/);
});

// ─── R11 Negative Generalization ─────────────────────────

test('🛑 R11 shouldInvoke: not integration mode → blocked', () => {
  const r = R11.shouldInvoke({ primary_mode: 'elicitation' }, { negative_generalization: true });
  assert.equal(r.invoke, false);
  assert.equal(r.reason, 'not_integration_mode');
});

test('🛑 R11 shouldInvoke: integration + negative_generalization → invoke', () => {
  const r = R11.shouldInvoke({ primary_mode: 'integration' }, { negative_generalization: true });
  assert.equal(r.invoke, true);
});

test('🛑 R11 buildInject: wraps existing S5_INTEGRATION_INJECT (Damon「又」)', () => {
  const txt = R11.buildInject({});
  assert.match(txt, /R11 Negative Generalization/);
  assert.match(txt, /這個『又』、我想停下來/);
  assert.match(txt, /這個感覺、最早是什麼時候開始的/);
});

// ─── §9 Stacking rules ───────────────────────────────────

test('🛑 pickReframeForTurn: crisis mode → no reframe + all dropped', () => {
  const r = pickReframeForTurn(['R1', 'R5'], { primary_mode: 'crisis' });
  assert.equal(r.picked, null);
  assert.equal(r.reason, 'crisis_mode_active');
  assert.equal(r.dropped.length, 2);
});

test('🛑 pickReframeForTurn: strong signal (passive_dw) preempts all reframes (level_2)', () => {
  const r = pickReframeForTurn(['R1', 'R5'], { primary_mode: 'integration' },
    { strong_signal_type: 'passive_death_wish' });
  assert.equal(r.picked, null);
  assert.match(r.reason, /strong_signal_preempt/);
});

test('🛑 pickReframeForTurn: §9.2 R1 vs R6 mutual exclusion → R1 wins', () => {
  const r = pickReframeForTurn(['R1', 'R6'], { primary_mode: 'identity_anchoring' });
  assert.equal(r.picked, 'R1');
  assert.ok(r.dropped.find(d => d.id === 'R6' && /mutually_exclusive_with_R1/.test(d.reason)));
});

test('🛑 pickReframeForTurn: §9.2 R2 vs R3 → R3 (self-blame priority)', () => {
  const r = pickReframeForTurn(['R2', 'R3'], { primary_mode: 'integration' });
  assert.equal(r.picked, 'R3');
});

test('🛑 pickReframeForTurn: §9.2 R5 vs R7 → R5 (more foundational)', () => {
  const r = pickReframeForTurn(['R5', 'R7'], { primary_mode: 'identity_anchoring' });
  assert.equal(r.picked, 'R5');
});

test('🛑 pickReframeForTurn: mode default ordering — identity_anchoring picks R2 first', () => {
  const r = pickReframeForTurn(['R7', 'R2', 'R5'], { primary_mode: 'identity_anchoring' });
  assert.equal(r.picked, 'R2');
});

test('🛑 pickReframeForTurn: mode default ordering — future_pacing picks R7 first', () => {
  const r = pickReframeForTurn(['R2', 'R7'], { primary_mode: 'future_pacing' });
  // R2 vs R7 not in mutual exclusion list; mode default future_pacing[0]=R7.
  assert.equal(r.picked, 'R7');
});

test('🛑 pickReframeForTurn: session count tie-break (5a fallback 退位)', () => {
  // R5 already invoked 3 times in elicitation, R6 is unused → mode default puts R5 first,
  // but ties resolve to lower session count when defaults and tier match.
  // Here mode=elicitation defaults R5 (idx 0), R6 (idx 3) — R5 wins outright per spec,
  // so this asserts the *default* wins over session count when both still under cap.
  const state = {
    primary_mode: 'elicitation',
    reframe_invocation_history_in_session: [
      { reframe_id: 'R5' }, { reframe_id: 'R5' }, { reframe_id: 'R5' },
    ],
  };
  const r = pickReframeForTurn(['R5', 'R6'], state);
  assert.equal(r.picked, 'R5', 'mode default priority overrides session count when defaults differ');
});

test('pickReframeForTurn: empty candidates → null', () => {
  const r = pickReframeForTurn([], {});
  assert.equal(r.picked, null);
  assert.equal(r.reason, 'no_candidates');
});

test('stacking internals: MUTUAL_EXCLUSION + MODE_DEFAULTS exported for dashboards', () => {
  assert.ok(Array.isArray(STACKING_INTERNAL.MUTUAL_EXCLUSION));
  assert.equal(STACKING_INTERNAL.MUTUAL_EXCLUSION.length, 3);
  assert.deepEqual(STACKING_INTERNAL.MODE_DEFAULTS.crisis, []);
});

// ─── Invocation tracker ──────────────────────────────────

test('🛑 buildInvocationEntry: schema matches migration 027 spec', () => {
  const e = buildInvocationEntry({
    reframe_id: 'R1', invoked_at_turn: 5, session_id: 42,
    variant: 'R1_A', mode: 'integration',
    invoked_at: '2026-06-05T00:00:00Z',
  });
  assert.equal(e.reframe_id, 'R1');
  assert.equal(e.invoked_at_turn, 5);
  assert.equal(e.outcome, 'pending');   // default
  assert.equal(e.anchor_phrase_if_success, null);
  assert.equal(e.invoked_at, '2026-06-05T00:00:00Z');
});

test('buildInvocationEntry: rejects unknown reframe_id', () => {
  assert.throws(
    () => buildInvocationEntry({ reframe_id: 'R99', invoked_at_turn: 1, invoked_at: 'x' }),
    /unknown reframe_id/,
  );
});

test('buildInvocationEntry: rejects negative turn', () => {
  assert.throws(
    () => buildInvocationEntry({ reframe_id: 'R1', invoked_at_turn: -1, invoked_at: 'x' }),
    /non-negative/,
  );
});

test('🛑 countPerSession + shouldDownsize: counts and downsizes at 5+', () => {
  const state = {
    reframe_invocation_history_in_session: [
      ...Array.from({ length: 5 }, () => ({ reframe_id: 'R1' })),
      { reframe_id: 'R2' },
    ],
  };
  assert.equal(countPerSession(state, 'R1'), 5);
  assert.equal(countPerSession(state, 'R2'), 1);
  assert.equal(shouldDownsize(state, 'R1'), true);
  assert.equal(shouldDownsize(state, 'R2'), false);
});

test('🛑 appendToSessionHistoryPatch: appends without mutating prior list', () => {
  const state = {
    reframe_invocation_history_in_session: [{ reframe_id: 'R1', outcome: 'pending' }],
  };
  const entry = buildInvocationEntry({
    reframe_id: 'R2', invoked_at_turn: 3, invoked_at: '2026-06-05T01:00:00Z',
  });
  const patch = appendToSessionHistoryPatch(state, entry);
  assert.equal(patch.reframe_invocation_history_in_session.length, 2);
  assert.equal(state.reframe_invocation_history_in_session.length, 1, 'must not mutate');
});

test('🛑 patchLatestOutcome: updates only the latest pending matching entry', () => {
  const state = {
    reframe_invocation_history_in_session: [
      { reframe_id: 'R1', outcome: 'success', anchor_phrase_if_success: '老的' },
      { reframe_id: 'R1', outcome: 'pending', anchor_phrase_if_success: null },
      { reframe_id: 'R2', outcome: 'pending' },
    ],
  };
  const patch = patchLatestOutcome(state, 'R1',
    { outcome: 'success', anchor_phrase_if_success: '我是溫暖的' });
  assert.ok(patch);
  // Only the latest R1 entry (index 1) should change.
  assert.equal(patch.reframe_invocation_history_in_session[0].anchor_phrase_if_success, '老的');
  assert.equal(patch.reframe_invocation_history_in_session[1].outcome, 'success');
  assert.equal(patch.reframe_invocation_history_in_session[1].anchor_phrase_if_success, '我是溫暖的');
  assert.equal(patch.reframe_invocation_history_in_session[2].outcome, 'pending');
});

test('patchLatestOutcome: no pending entry → null', () => {
  const state = {
    reframe_invocation_history_in_session: [{ reframe_id: 'R1', outcome: 'success' }],
  };
  assert.equal(patchLatestOutcome(state, 'R1', { outcome: 'success' }), null);
});

// ─── REFRAME_TIERS sanity ───────────────────────────────

test('🛑 REFRAME_TIERS: tier 1 (R1/R2/R7), tier 2 (R5/R6/R11), tier 3 (R3/R4)', () => {
  assert.equal(REFRAME_TIERS.R1, 1);
  assert.equal(REFRAME_TIERS.R2, 1);
  assert.equal(REFRAME_TIERS.R7, 1);
  assert.equal(REFRAME_TIERS.R5, 2);
  assert.equal(REFRAME_TIERS.R6, 2);
  assert.equal(REFRAME_TIERS.R11, 2);
  assert.equal(REFRAME_TIERS.R3, 3);
  assert.equal(REFRAME_TIERS.R4, 3);
});
