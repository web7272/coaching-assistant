// lib/session/phase-context.test.js
// {{current_phase_context}} dynamic text — pure module.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PHASE_CONTEXTS, contextFor, hasContext } from './phase-context.js';
import { CURRENT_PHASES } from './phase-machine.js';

// ─────────────────────────────────────────────────────────
// completeness — every current_phase has a context
// ─────────────────────────────────────────────────────────

test('PHASE_CONTEXTS: covers all 8 current_phase enum values', () => {
  for (const phase of Object.values(CURRENT_PHASES)) {
    assert.ok(phase in PHASE_CONTEXTS, `${phase} missing from PHASE_CONTEXTS`);
  }
  assert.equal(Object.keys(PHASE_CONTEXTS).length, 8);
});

test('PHASE_CONTEXTS is frozen', () => {
  assert.ok(Object.isFrozen(PHASE_CONTEXTS));
});

test('every phase context resolves to a non-empty string', () => {
  for (const phase of Object.keys(PHASE_CONTEXTS)) {
    const text = contextFor(phase);
    assert.equal(typeof text, 'string', `${phase} must resolve to string`);
    assert.ok(text.length > 0, `${phase} must be non-empty`);
  }
});

// ─────────────────────────────────────────────────────────
// contextFor
// ─────────────────────────────────────────────────────────

test('contextFor: phase_1 default (no router_phase) → opening variant (safe fallback)', () => {
  assert.equal(contextFor('phase_1'), PHASE_CONTEXTS.phase_1.opening);
  assert.match(contextFor('phase_1'), /Values Elicitation/);
});

test('contextFor: phase_3b (string entry) returns directly', () => {
  assert.match(contextFor('phase_3b'), /Self-Concept/);
});

test('contextFor: fail-soft — unknown phase → empty string', () => {
  assert.equal(contextFor('phase_99'), '');
  assert.equal(contextFor(null), '');
  assert.equal(contextFor(undefined), '');
});

test('contextFor: phase_3a mentions Scope Overlap default (errata 5/21)', () => {
  assert.match(contextFor('phase_3a'), /Scope Overlap/);
});

test('contextFor: integration_retention mentions reinforce-not-explore', () => {
  assert.match(contextFor('integration_retention'), /reinforce/i);
});

// ─────────────────────────────────────────────────────────
// hasContext
// ─────────────────────────────────────────────────────────

test('hasContext: true for known phases, false otherwise', () => {
  assert.equal(hasContext('phase_1'), true);
  assert.equal(hasContext('program_completed'), true);
  assert.equal(hasContext('phase_99'), false);
  assert.equal(hasContext(null), false);
});

// ─────────────────────────────────────────────────────────
// PR-4c-1b 開場重複 bug 修：phase_1 router_phase-aware
// ─────────────────────────────────────────────────────────

test('phase_1: opening + elicitation variants both have Phase 1 goal/exit anchors', () => {
  for (const variant of [PHASE_CONTEXTS.phase_1.opening, PHASE_CONTEXTS.phase_1.elicitation]) {
    assert.match(variant, /Values Elicitation/);
    assert.match(variant, /Containment Judgment/);
    assert.match(variant, /3-5 個 values/);
    assert.match(variant, /exit：top1_value 確定/);
    assert.match(variant, /day range：min 1 \/ max 4/);
  }
});

test('contextFor(phase_1, opening) — 起手式變體', () => {
  const txt = contextFor('phase_1', 'opening');
  assert.match(txt, /起手式/, 'opening variant should mention 起手式');
  assert.match(txt, /在你的生命裡、你想要什麼\?/, 'opening variant should include the kick-off question');
});

test('🛑 contextFor(phase_1, elicitation) — Damon 鏈式追問 + 紅線 1 不出現「為什麼」', () => {
  const txt = contextFor('phase_1', 'elicitation');
  assert.match(txt, /擁有這個對你有什麼重要/,
    'elicitation variant must use Damon chain追問「擁有這個對你有什麼重要?」');
  assert.match(txt, /不重複起手式/, 'elicitation variant should explicitly forbid re-emitting the opening');
  assert.doesNotMatch(txt, /為什麼/,
    '紅線 1：elicitation variant must NOT contain the substring 為什麼 (defense-in-depth)');
});

test('contextFor: phase_1 unknown router_phase → falls back to first variant (safe default)', () => {
  // top1_determination is a valid router_phase but phase_1 only defines opening/elicitation
  const txt = contextFor('phase_1', 'top1_determination');
  assert.equal(typeof txt, 'string');
  assert.ok(txt.length > 0, 'fallback must yield non-empty string');
  // first key in the object is 'opening' → safe default
  assert.equal(txt, PHASE_CONTEXTS.phase_1.opening);
});

test('contextFor: string-shaped phase entries ignore router_phase', () => {
  // phase_2 is a plain string; passing router_phase should not change return
  const a = contextFor('phase_2');
  const b = contextFor('phase_2', 'identity_test_routing');
  const c = contextFor('phase_2', 'made_up_router_phase');
  assert.equal(a, b);
  assert.equal(b, c);
});

// PR-4c-green E4 fix — phase_1.day_opening_inject deferred variant
test('🛑 contextFor(phase_1, opening, {dayOpeningInjectActive:true}) — swaps cold 起手式 for deferred variant', () => {
  const txt = contextFor('phase_1', 'opening', { dayOpeningInjectActive: true });
  assert.match(txt, /\[SYSTEM INJECT — Day Opening Active Reference\][\s\S]*?主導開場/,
    'must defer to the E4 inject when day-opening is active');
  assert.match(txt, /不另起 phase_1 起手式/,
    'must explicitly forbid the cold 起手式');
  // Defensive: the literal cold-opener string must NOT appear verbatim in the
  // deferred variant — Sonnet has mimicked verbatim forbidden strings in the
  // past (mimicry risk). The forbid is expressed by category ("phase_1 冷起手式
  // 那種「想要什麼」 開放抽象大問題"), not by quoting「在你的生命裡你想要什麼?」.
  assert.doesNotMatch(txt, /在你的生命裡、你想要什麼\?/,
    'cold opener question must NOT appear verbatim in the deferred variant');
});

// PR-4c-green 5/24 (A002 真機驗) — deferred variant 必須語氣強到「紅線」 等級.
test('🛑 contextFor day_opening_inject: 紅線 + v4 鬼打牆還魂 wording present', () => {
  const txt = contextFor('phase_1', 'opening', { dayOpeningInjectActive: true });
  assert.match(txt, /紅線/, 'suppression must be flagged as 紅線 (highest severity)');
  assert.match(txt, /v4 鬼打牆/, 'must connect cold-opener fallback to the v4 antipattern');
  assert.match(txt, /模式 A/, 'must point at the inject\'s mode A / B framework');
  assert.match(txt, /永遠不杜撰/, 'no-fabrication rule must be explicit');
});

test('contextFor(phase_1, opening) without flag → cold 起手式 (Day 1 unchanged)', () => {
  const txt = contextFor('phase_1', 'opening');
  assert.match(txt, /起手式「在你的生命裡、你想要什麼\?」/,
    'Day 1 first session must still get the cold 起手式 when no E4 inject');
});

test('contextFor(phase_1, opening, {dayOpeningInjectActive:false}) → cold 起手式', () => {
  const txt = contextFor('phase_1', 'opening', { dayOpeningInjectActive: false });
  assert.match(txt, /起手式「在你的生命裡、你想要什麼\?」/);
});

test('contextFor: dayOpeningInjectActive only swaps phase_1 + opening, not elicitation', () => {
  // E4 should never collide with phase_1.elicitation (which means we're already
  // past the kick-off turn); flag must not accidentally fire on it.
  const txt = contextFor('phase_1', 'elicitation', { dayOpeningInjectActive: true });
  assert.match(txt, /擁有這個對你有什麼重要/);
  assert.doesNotMatch(txt, /由 \[SYSTEM INJECT/);
});

test('contextFor: dayOpeningInjectActive does not affect non-phase_1 phases', () => {
  const txt = contextFor('phase_2', 'opening', { dayOpeningInjectActive: true });
  // phase_2 is a static string variant — flag is a no-op there
  assert.equal(txt, PHASE_CONTEXTS.phase_2);
});
