// lib/detector-handlers/top1-pk-stage2.test.js
// v5.3 Stage 2 (6/12) — top1 PK king-of-the-hill + transitionPrimary integration.
//
// Coverage:
//   · pure helpers (buildTop1PkPairFooter / decidePkElimination / buildTop1PkHandoffInject)
//   · state machine: init / A wins / B wins / interdependent retry / linear retry / converge
//   · 🔴 Stage 2B transitionPrimary in same patch as top1_value write
//   · safety cap → handoff (A006 protection)
//   · sandbox-style traces for Patrick verification

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  e3Top1JudgeHandler,
  buildTop1PkPairFooter,
  decidePkElimination,
  buildTop1PkHandoffInject,
  TOP1_PK_CONSTANTS,
} from './engine-3.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = join(__dirname, '..', '..');

// ─── Fixtures ──────────────────────────────────────

const baseState = (overrides = {}) => ({
  primary_mode: 'elicitation',
  values_collected_list: ['自由', '勇敢', '創造力'],
  top1_value: null,
  last_ai_question: '沒有「勇敢」, 「自由」 還能存在嗎? 沒有「自由」, 「勇敢」 還能存在嗎?',
  turn_count_this_session: 5,
  ...overrides,
});

const baseCtx = (state, judgeResponse) => ({
  session_state: state,
  user_response: '自由比較大, 沒有自由就不可能勇敢',
  judges: {
    containment: async () => judgeResponse,
  },
  logMiss: () => {},
});

// ═════════════════════════════════════════════════════════
// Pure helpers
// ═════════════════════════════════════════════════════════

test('🛑 buildTop1PkPairFooter: parametrize 帶上 pair + round count', () => {
  const footer = buildTop1PkPairFooter(['自由', '勇敢'], 0, 6);
  assert.match(footer, /本輪比 「自由」 跟 「勇敢」/);
  assert.match(footer, /「自由」 是當前 king/);
  assert.match(footer, /Round 1 of max 6/);
  // 帶上 containment 雙向問句.
  assert.match(footer, /沒有「勇敢」, 「自由」 還能存在嗎/);
  assert.match(footer, /沒有「自由」, 「勇敢」 還能存在嗎/);
});

test('🛑 decidePkElimination: aPassesContainment → A wins', () => {
  const j = {
    answer_addresses_containment: true,
    linear_thinking_error_detected: false,
    containment_direction: 'A_contains_B',
    confidence: 'high',
  };
  assert.equal(decidePkElimination(j), 'A');
});

test('🛑 decidePkElimination: B_contains_A + high confidence → B wins (dual condition)', () => {
  const j = {
    answer_addresses_containment: true,
    linear_thinking_error_detected: false,
    containment_direction: 'B_contains_A',
    confidence: 'medium',
  };
  assert.equal(decidePkElimination(j), 'B');
});

test('🛑 decidePkElimination: low confidence → null (retry, no eliminate)', () => {
  const j = {
    answer_addresses_containment: true,
    linear_thinking_error_detected: false,
    containment_direction: 'A_contains_B',
    confidence: 'low',
  };
  assert.equal(decidePkElimination(j), null);
});

test('🛑 decidePkElimination: linear_thinking_error_detected → null (retry)', () => {
  const j = {
    answer_addresses_containment: true,
    linear_thinking_error_detected: true,
    containment_direction: 'A_contains_B',
    confidence: 'high',
  };
  assert.equal(decidePkElimination(j), null);
});

test('🛑 decidePkElimination: !answer_addresses_containment → null (retry, off-topic)', () => {
  const j = {
    answer_addresses_containment: false,
    linear_thinking_error_detected: false,
    containment_direction: 'A_contains_B',
    confidence: 'high',
  };
  assert.equal(decidePkElimination(j), null);
});

test('🛑 decidePkElimination: interdependent / unclear → null', () => {
  for (const dir of ['interdependent', 'unclear']) {
    const j = {
      answer_addresses_containment: true,
      linear_thinking_error_detected: false,
      containment_direction: dir,
      confidence: 'high',
    };
    assert.equal(decidePkElimination(j), null,
      `direction=${dir} should yield null (retry)`);
  }
});

test('🛑 decidePkElimination: null / non-object → null (defensive)', () => {
  assert.equal(decidePkElimination(null), null);
  assert.equal(decidePkElimination(undefined), null);
  assert.equal(decidePkElimination('str'), null);
  assert.equal(decidePkElimination({}), null);
});

// ═════════════════════════════════════════════════════════
// State machine: init / progress / converge / transition
// ═════════════════════════════════════════════════════════

test('🛑 init: first trigger (list ≥3 + top1=null + elicitation) → init top1_pk_state + parametrized inject', async () => {
  const state = baseState({ top1_pk_state: undefined });
  const ctx = baseCtx(state);
  const out = await e3Top1JudgeHandler(ctx);
  assert.equal(out.handled, true);
  assert.match(out.inject, /本輪比 「自由」 跟 「勇敢」/);
  assert.deepEqual(out.patch.top1_pk_state, {
    remaining: ['自由', '勇敢', '創造力'],
    eliminated: [],
    original_count: 3,
    rounds: 0,
  });
  assert.equal(out.patch.router_phase, 'top1_determination');
  // No top1_value yet, no mode transition.
  assert.equal(out.patch.top1_value, undefined);
  assert.equal(out.patch.primary_mode, undefined);
});

test('🛑 progress: A wins → eliminate B, next pair = [A, rest[0]]', async () => {
  const state = baseState({
    top1_pk_state: {
      remaining: ['自由', '勇敢', '創造力'],
      eliminated: [], original_count: 3, rounds: 0,
    },
  });
  const ctx = baseCtx(state, {
    answer_addresses_containment: true,
    linear_thinking_error_detected: false,
    containment_direction: 'A_contains_B',
    confidence: 'high',
  });
  const out = await e3Top1JudgeHandler(ctx);
  assert.equal(out.patch.top1_pk_state.remaining[0], '自由', 'king stays');
  assert.equal(out.patch.top1_pk_state.remaining[1], '創造力', 'next challenger');
  assert.deepEqual(out.patch.top1_pk_state.eliminated, ['勇敢']);
  assert.equal(out.patch.top1_pk_state.rounds, 1);
  // Still no top1_value (PK not converged).
  assert.equal(out.patch.top1_value, undefined);
  // Footer updated to new pair.
  assert.match(out.inject, /本輪比 「自由」 跟 「創造力」/);
});

test('🛑 progress: B wins → eliminate A, B becomes new king', async () => {
  const state = baseState({
    top1_pk_state: {
      remaining: ['自由', '勇敢', '創造力'],
      eliminated: [], original_count: 3, rounds: 0,
    },
  });
  const ctx = baseCtx(state, {
    answer_addresses_containment: true,
    linear_thinking_error_detected: false,
    containment_direction: 'B_contains_A',
    confidence: 'medium',
  });
  const out = await e3Top1JudgeHandler(ctx);
  assert.equal(out.patch.top1_pk_state.remaining[0], '勇敢', 'B becomes new king');
  assert.equal(out.patch.top1_pk_state.remaining[1], '創造力');
  assert.deepEqual(out.patch.top1_pk_state.eliminated, ['自由']);
});

test('🛑 progress: linear error → no eliminate, rounds++, retry same pair', async () => {
  const state = baseState({
    top1_pk_state: {
      remaining: ['自由', '勇敢', '創造力'],
      eliminated: [], original_count: 3, rounds: 0,
    },
  });
  const ctx = baseCtx(state, {
    answer_addresses_containment: true,
    linear_thinking_error_detected: true,    // linear error
    containment_direction: 'A_contains_B',
    confidence: 'high',
  });
  const out = await e3Top1JudgeHandler(ctx);
  // Same pair, no eliminate.
  assert.deepEqual(out.patch.top1_pk_state.remaining, ['自由', '勇敢', '創造力']);
  assert.deepEqual(out.patch.top1_pk_state.eliminated, []);
  assert.equal(out.patch.top1_pk_state.rounds, 1);
  // Footer still same pair.
  assert.match(out.inject, /本輪比 「自由」 跟 「勇敢」/);
});

test('🛑 progress: interdependent / unclear → no eliminate, retry', async () => {
  const state = baseState({
    top1_pk_state: {
      remaining: ['自由', '勇敢', '創造力'],
      eliminated: [], original_count: 3, rounds: 1,
    },
  });
  const ctx = baseCtx(state, {
    answer_addresses_containment: true,
    linear_thinking_error_detected: false,
    containment_direction: 'unclear',
    confidence: 'low',
  });
  const out = await e3Top1JudgeHandler(ctx);
  assert.deepEqual(out.patch.top1_pk_state.remaining, ['自由', '勇敢', '創造力']);
  assert.deepEqual(out.patch.top1_pk_state.eliminated, []);
  assert.equal(out.patch.top1_pk_state.rounds, 2);
});

test('🛑 progress: judge throws JudgeTimeoutError → retry, no eliminate, logMiss', async () => {
  const state = baseState({
    top1_pk_state: {
      remaining: ['自由', '勇敢', '創造力'],
      eliminated: [], original_count: 3, rounds: 0,
    },
  });
  // Import JudgeTimeoutError to construct one.
  const { JudgeTimeoutError } = await import('../haiku-judge/_base.js');
  const misses = [];
  const ctx = {
    session_state: state,
    user_response: '答案',
    judges: {
      containment: async () => { throw new JudgeTimeoutError('timeout'); },
    },
    logMiss: (m) => misses.push(m),
  };
  const out = await e3Top1JudgeHandler(ctx);
  // Same pair, no eliminate.
  assert.deepEqual(out.patch.top1_pk_state.remaining, ['自由', '勇敢', '創造力']);
  assert.equal(out.patch.top1_pk_state.rounds, 1);
  assert.equal(misses.length, 1);
  assert.equal(misses[0].detector, 'E3_top1_pk_containment');
});

// ═════════════════════════════════════════════════════════
// 🔴 CONVERGE — Stage 2B: same patch transitionPrimary + top1_value
// ═════════════════════════════════════════════════════════

test('🔴 converge: remaining.length === 1 → write top1_value + transitionPrimary in SAME patch', async () => {
  const state = baseState({
    top1_pk_state: {
      remaining: ['自由', '勇敢'],   // last round
      eliminated: ['創造力'],
      original_count: 3, rounds: 1,
    },
  });
  const ctx = baseCtx(state, {
    answer_addresses_containment: true,
    linear_thinking_error_detected: false,
    containment_direction: 'A_contains_B',  // 自由 wins
    confidence: 'high',
  });
  const out = await e3Top1JudgeHandler(ctx);
  // 🔴 same patch must contain BOTH top1_value AND primary_mode transition.
  assert.equal(out.patch.top1_value, '自由');
  assert.equal(out.patch.primary_mode, 'identity_anchoring',
    'transitionPrimary MUST land in SAME patch (Stage 2B 紅線)');
  // values_ranking: winner first, eliminated order reversed (last eliminated = rank 2).
  assert.deepEqual(out.patch.values_ranking, ['自由', '勇敢', '創造力']);
  // PK state cleared.
  assert.equal(out.patch.top1_pk_state, null);
  // Mode transition log appended.
  assert.ok(Array.isArray(out.patch.mode_transition_log)
            || Array.isArray(out.patch.mode_transition_history),
    'mode-transition-logger patch (mode_transition_log or _history) must be in patch');
  // Inject confirms convergence.
  assert.match(out.inject, /Top 1 = 「自由」/);
  assert.match(out.inject, /identity_anchoring/);
});

test('🔴 converge: B wins on last round → top1 = B', async () => {
  const state = baseState({
    top1_pk_state: {
      remaining: ['自由', '勇敢'],
      eliminated: ['創造力'],
      original_count: 3, rounds: 1,
    },
  });
  const ctx = baseCtx(state, {
    answer_addresses_containment: true,
    linear_thinking_error_detected: false,
    containment_direction: 'B_contains_A',
    confidence: 'high',
  });
  const out = await e3Top1JudgeHandler(ctx);
  assert.equal(out.patch.top1_value, '勇敢');
  assert.equal(out.patch.primary_mode, 'identity_anchoring');
});

// ═════════════════════════════════════════════════════════
// 🔴 SAFETY CAP — handoff (A006 protection)
// ═════════════════════════════════════════════════════════

test('🔴 safety cap: rounds > 2*N → handoff (ambiguous + landmine_insistence)', async () => {
  const state = baseState({
    top1_pk_state: {
      remaining: ['自由', '勇敢', '創造力'],
      eliminated: [], original_count: 3,
      rounds: 6,  // 2 * 3 = 6, next round will hit cap (7 > 6)
    },
  });
  const ctx = baseCtx(state, {
    answer_addresses_containment: false,  // doesn't matter — cap fires first
    linear_thinking_error_detected: false,
    containment_direction: 'unclear',
    confidence: 'low',
  });
  const out = await e3Top1JudgeHandler(ctx);
  // 🔴 No top1_value, no transition.
  assert.equal(out.patch.top1_value, undefined);
  assert.equal(out.patch.primary_mode, undefined);
  // M_LM_1 path reused.
  assert.equal(out.patch.current_quality_status, 'ambiguous');
  assert.equal(out.patch.landmine_insistence_handoff, true);
  // PK state cleared (no infinite retry).
  assert.equal(out.patch.top1_pk_state, null);
  // Round at cap recorded.
  assert.equal(out.patch.top1_pk_stalled_at_round, 7);
  // Inject signals handoff.
  assert.match(out.inject, /Top 1 PK stalled handoff/);
  assert.match(out.inject, /M_LM_1/);
});

test('🛑 safety cap config: SAFETY_CAP_MULTIPLIER = 2 (Patrick 拍板)', () => {
  assert.equal(TOP1_PK_CONSTANTS.SAFETY_CAP_MULTIPLIER, 2);
  assert.equal(TOP1_PK_CONSTANTS.MIN_LIST_FOR_TRIGGER, 3);
});

// ═════════════════════════════════════════════════════════
// Non-trigger paths
// ═════════════════════════════════════════════════════════

test('🛑 no trigger: list <3 → handled:false', async () => {
  const state = baseState({ values_collected_list: ['自由'] });
  const out = await e3Top1JudgeHandler(baseCtx(state));
  assert.equal(out.handled, false);
});

test('🛑 no trigger: top1_value already set → handled:false', async () => {
  const state = baseState({ top1_value: '自由' });
  const out = await e3Top1JudgeHandler(baseCtx(state));
  assert.equal(out.handled, false);
});

test('🛑 no trigger: primary_mode != elicitation AND router_phase not eligible → handled:false', async () => {
  const state = baseState({ primary_mode: 'identity_anchoring', router_phase: 'cascade_down' });
  const out = await e3Top1JudgeHandler(baseCtx(state));
  assert.equal(out.handled, false);
});

// ═════════════════════════════════════════════════════════
// 🔴 Sync-gate — Stage 2 spec compliance
// ═════════════════════════════════════════════════════════

test('🔴 sync-gate: engine-3 imports containment-logic judge + aPassesContainment', () => {
  const src = readFileSync(join(repoRoot, 'lib/detector-handlers/engine-3.js'), 'utf8');
  assert.match(src, /from ['"][^'"]*containment-logic(\.js)?['"]/,
    'engine-3 must import from containment-logic');
  assert.match(src, /judge as containmentJudge/,
    'engine-3 must import the judge as containmentJudge');
  assert.match(src, /aPassesContainment/);
});

test('🔴 sync-gate: top1Judge.prompt_content 0 改 (verbatim) — 只 append parametrized footer', () => {
  // Read the verbatim prompt + verify engine-3 uses + concat, never substring overwrite.
  const e3 = readFileSync(join(repoRoot, 'lib/detector-handlers/engine-3.js'), 'utf8');
  assert.match(e3, /top1Judge\.prompt_content\s*\+\s*footer/,
    'engine-3 must concat: top1Judge.prompt_content + footer (verbatim + append)');
  assert.match(e3, /top1Judge\.prompt_content\s*\+\s*nextFooter/,
    'engine-3 progress path must also use + append (not splice / substring)');
});

test('🔴 sync-gate: converged patch includes BOTH top1_value AND transitionPrimary result', () => {
  // Anti-regression: ensure the SAME patch block has top1_value, primary_mode (from transitionPrimary), AND log.
  const src = readFileSync(join(repoRoot, 'lib/detector-handlers/engine-3.js'), 'utf8');
  // converged-block ordering grep: transitionPrimary call followed by buildTransitionEntry + appendTransitionPatch + top1_value in same return.
  assert.match(src, /transitionPrimary\(modeRead,\s*ACTIVE_MODES\.IDENTITY_ANCHORING\)/,
    'converged path must call transitionPrimary(→IDENTITY_ANCHORING)');
  assert.match(src, /appendTransitionPatch/,
    'converged path must call appendTransitionPatch (log entry)');
  assert.match(src, /top1_value:\s*winner/,
    'converged path must set top1_value: winner in patch');
});

test('🔴 sync-gate: Stage 2 0 改 LLM 輸出格式 (no [STATE:] markers added)', () => {
  const e3 = readFileSync(join(repoRoot, 'lib/detector-handlers/engine-3.js'), 'utf8');
  // Footer / handoff inject should NOT instruct Sonnet to emit [STATE:] markers.
  assert.equal(/\[STATE:/.test(e3), false,
    'Stage 2 MUST NOT add [STATE:] markers to LLM output (走 judge 抽取, 不要 Sonnet emit)');
});

// ═════════════════════════════════════════════════════════
// Sandbox transcript — Patrick verification (multi-turn happy path + edge cases)
// ═════════════════════════════════════════════════════════

test('🔵 sandbox trace: A003 6-value happy path → 5 rounds, converge top1=自由', async () => {
  // Simulate 6-value PK: 喜悅, 有愛的, 自由的, 平靜的, 有創造力的, 真實的.
  // Plausible king-of-the-hill outcomes (deterministic for trace clarity):
  //   round 1: 喜悅 vs 有愛的 → A wins (喜悅 contains 有愛的)
  //   round 2: 喜悅 vs 自由的 → B wins (自由的 contains 喜悅)
  //   round 3: 自由的 vs 平靜的 → A wins
  //   round 4: 自由的 vs 有創造力的 → A wins
  //   round 5: 自由的 vs 真實的 → A wins → converge
  const judgeResults = [
    { dir: 'A_contains_B', expect: 'eliminate 有愛的' },
    { dir: 'B_contains_A', expect: 'eliminate 喜悅, 自由的 becomes king' },
    { dir: 'A_contains_B', expect: 'eliminate 平靜的' },
    { dir: 'A_contains_B', expect: 'eliminate 有創造力的' },
    { dir: 'A_contains_B', expect: 'eliminate 真實的 + converge' },
  ];
  let state = baseState({
    values_collected_list: ['喜悅', '有愛的', '自由的', '平靜的', '有創造力的', '真實的'],
    top1_pk_state: undefined,
  });
  // Round 0: init.
  const initOut = await e3Top1JudgeHandler(baseCtx(state));
  state = { ...state, ...initOut.patch };
  assert.equal(state.top1_pk_state.remaining.length, 6);
  // Rounds 1-5: judge results.
  for (let i = 0; i < judgeResults.length; i++) {
    const r = judgeResults[i];
    const ctx = baseCtx(state, {
      answer_addresses_containment: true,
      linear_thinking_error_detected: false,
      containment_direction: r.dir,
      confidence: 'high',
    });
    const out = await e3Top1JudgeHandler(ctx);
    state = { ...state, ...out.patch };
  }
  // Converged.
  assert.equal(state.top1_value, '自由的');
  assert.equal(state.primary_mode, 'identity_anchoring');
  assert.equal(state.values_ranking.length, 6);
  assert.equal(state.values_ranking[0], '自由的');
});

test('🔵 sandbox trace: A006 high-risk PK stall → safety cap fires, handoff (M_LM_1)', async () => {
  // Simulate A006: all judge results indecisive (unclear/low conf) — never converges.
  let state = baseState({
    values_collected_list: ['被理解', '被需要', '安全感'],
    top1_pk_state: undefined,
  });
  const initOut = await e3Top1JudgeHandler(baseCtx(state));
  state = { ...state, ...initOut.patch };
  const N = state.top1_pk_state.original_count; // 3
  const cap = N * 2;                            // 6
  // Run cap rounds of indecisive judge results.
  for (let i = 0; i < cap; i++) {
    const ctx = baseCtx(state, {
      answer_addresses_containment: false,  // off-topic
      linear_thinking_error_detected: false,
      containment_direction: 'unclear',
      confidence: 'low',
    });
    const out = await e3Top1JudgeHandler(ctx);
    state = { ...state, ...out.patch };
  }
  // After cap rounds (still in progress, no convergence). Next round must trigger cap.
  const finalCtx = baseCtx(state, {
    answer_addresses_containment: false,
    linear_thinking_error_detected: false,
    containment_direction: 'unclear',
    confidence: 'low',
  });
  const finalOut = await e3Top1JudgeHandler(finalCtx);
  state = { ...state, ...finalOut.patch };
  // No top1, no transition.
  assert.equal(state.top1_value, null);
  assert.notEqual(state.primary_mode, 'identity_anchoring');
  // M_LM_1 handoff signals set.
  assert.equal(state.current_quality_status, 'ambiguous');
  assert.equal(state.landmine_insistence_handoff, true);
  assert.equal(state.top1_pk_state, null);
  assert.ok(state.top1_pk_stalled_at_round > 0);
});
