// lib/sub-prompts/session-resume/resume-guidance.test.js
// 6/6 A011 hotfix — Lock the SESSION RESUME guidance phrasing + boundary behavior.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import resumeGuidance, {
  buildResumeGuidanceInject,
} from './resume-guidance.js';
import { isResumeAcrossGap } from '../../../api/chat.js';

// ─── isResumeAcrossGap gate (pure decision function) ─────

test('🛑 6/6 A011: isResumeAcrossGap — reuse + gap=7 → true (A011 case)', () => {
  assert.equal(isResumeAcrossGap({ wasReuse: true, gapDays: 7 }), true);
});

test('🛑 6/6 A011: isResumeAcrossGap — reuse + gap=1 → true (boundary)', () => {
  assert.equal(isResumeAcrossGap({ wasReuse: true, gapDays: 1 }), true);
});

test('🛑 6/6 A011: isResumeAcrossGap — reuse + gap=0 (same day) → false', () => {
  assert.equal(isResumeAcrossGap({ wasReuse: true, gapDays: 0 }), false,
    'same-day reuse does not need resume guidance (conversation already feels continuous)');
});

test('🛑 6/6 A011: isResumeAcrossGap — create (new Day N+1) + gap=1 → false', () => {
  assert.equal(isResumeAcrossGap({ wasReuse: false, gapDays: 1 }), false,
    'a brand-new Day uses normal E4 day-opening path, not resume guidance');
});

test('🛑 6/6 A011: isResumeAcrossGap — defensive — missing inputs → false', () => {
  assert.equal(isResumeAcrossGap({}), false);
  assert.equal(isResumeAcrossGap({ wasReuse: true }), false);
  assert.equal(isResumeAcrossGap({ wasReuse: true, gapDays: NaN }), false);
  assert.equal(isResumeAcrossGap({ wasReuse: true, gapDays: 'foo' }), false);
  assert.equal(isResumeAcrossGap(), false);
});

// ─── Phrasing snapshot lock (Vivi 6/6 verbatim) ──────────

test('🛑 6/6 A011: buildResumeGuidanceInject(7) — verbatim guidance phrasing', () => {
  const inj = buildResumeGuidanceInject(7);
  assert.equal(inj, `[SESSION RESUME — 接續未完成的對話]

學員上次的對話還沒結束、隔了 7 天回來。
上面的對話歷史是同一場、沒有重來。

你的開場:
- 看上面的對話歷史、reference 學員上次聊到的(用他自己的話)
- 自然接續、像「我們上次聊到 X、今天接著」
- ❌ 不要重新起手式(不要問「在你的生命裡、你想要什麼?」這種從零開始的問句)
- ❌ 不要當新的一天 / 新 program 開始
- 接著上次的 thread 繼續挖`);
});

test('🛑 6/6 A011: A011 (Jessie) scenario — gap=7 days (5/28 → 6/4)', () => {
  const inj = buildResumeGuidanceInject(7);
  // The exact A011 reproduction case (Jessie's session 24).
  assert.match(inj, /隔了 7 天回來/);
  // Anti-cold-start guard verbatim.
  assert.match(inj, /❌ 不要重新起手式/);
  assert.match(inj, /在你的生命裡、你想要什麼/);
  // Continuity directive.
  assert.match(inj, /看上面的對話歷史/);
  assert.match(inj, /接著上次的 thread 繼續挖/);
});

// ─── Boundary behavior (gap_days handling) ───────────────

test('🛑 6/6 A011: buildResumeGuidanceInject(1) — single-day gap (minimum)', () => {
  const inj = buildResumeGuidanceInject(1);
  assert.match(inj, /隔了 1 天回來/);
});

test('🛑 6/6 A011: buildResumeGuidanceInject(30) — long gap (1 month)', () => {
  const inj = buildResumeGuidanceInject(30);
  assert.match(inj, /隔了 30 天回來/);
});

test('🛑 6/6 A011: buildResumeGuidanceInject floors non-integer days', () => {
  // gap_days computed from date math can be fractional (timezone artifacts).
  const inj = buildResumeGuidanceInject(7.4);
  assert.match(inj, /隔了 7 天回來/);
});

test('🛑 6/6 A011: defensive — NaN / null / negative → defaults to 1 day', () => {
  // Caller is supposed to gate on gap_days >= 1 already; this is belt-and-braces.
  for (const bad of [NaN, null, undefined, 0, -5, 'foo']) {
    const inj = buildResumeGuidanceInject(bad);
    assert.match(inj, /隔了 1 天回來/, `${bad} should default to 1`);
  }
});

// ─── Anti-cold-start lock (the core safety property) ─────

test('🛑 6/6 A011: inject explicitly forbids elicitation 起手式 (the A011 bug)', () => {
  // The whole point: AI must NOT cold-start with "在你的生命裡、你想要什麼?"
  // when resuming a 15-message in-progress session. Lock the negative example.
  const inj = buildResumeGuidanceInject(7);
  // The exact phrase that A011 reproduced — quoted as a forbidden marker.
  assert.match(inj, /不要問「在你的生命裡、你想要什麼\?」/);
  assert.match(inj, /從零開始的問句/);
  // Anti-restart: forbid treating this as a fresh day / fresh program.
  assert.match(inj, /不要當新的一天 \/ 新 program 開始/);
});

// ─── Module metadata ────────────────────────────────────

test('🛑 6/6 A011: module metadata + spec_ref', () => {
  assert.equal(resumeGuidance.id, 'session_resume_guidance');
  assert.equal(resumeGuidance.trigger_event, 'kickoff_turn');
  assert.equal(typeof resumeGuidance.buildResumeGuidanceInject, 'function');
  assert.match(resumeGuidance.source, /A011/);
  assert.match(resumeGuidance.source, /Vivi 6\/6/);
});
