// lib/detector-handlers/reframe-recording.test.js
// v5.3 (6/12) — End-to-end: each live invocation site records reframe entry
// in patch + 七步 detector reads it via detectorPatch delta (chat.js:510-515
// pattern). Plus sync-gate: each engine source must call buildInvocationPatch
// (anti-regression: 防未來新 reframe site 漏記).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { selectSignalInject } from './engine-1.js';
import { selectTakeawayPhrasing } from './engine-4-mode-aware.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = join(__dirname, '..', '..');

const baseCtx = (overrides = {}) => ({
  session_id: 99,
  now_iso: '2026-06-12T10:00:00Z',
  ...overrides,
});

// ═════════════════════════════════════════════════════════
// selectSignalInject — adds reframe_invoked field at 4 R-sites
// ═════════════════════════════════════════════════════════

test('🛑 selectSignalInject: S4 medium conditional_worth → reframe_invoked R1', () => {
  const signals = {
    inject_hints: {
      conditional_worth: { intensity: 'medium' },
    },
  };
  const r = selectSignalInject(signals, { primary_mode: 'integration' });
  assert.equal(r.reframe_invoked, 'R1');
  assert.match(r.inject, /S4 medium → R1/);
});

test('🛑 selectSignalInject: S1 medium external_locus → reframe_invoked R1', () => {
  const signals = { inject_hints: { external_locus: { intensity: 'medium' } } };
  const r = selectSignalInject(signals, {});
  assert.equal(r.reframe_invoked, 'R1');
});

test('🛑 selectSignalInject: S6 medium modal_operator → reframe_invoked R1', () => {
  const signals = { inject_hints: { modal_operator: { intensity: 'medium' } } };
  const r = selectSignalInject(signals, {});
  assert.equal(r.reframe_invoked, 'R1');
});

test('🛑 selectSignalInject: S3 frequency_illusion → reframe_invoked R7 (S3_LIGHT baked w/ R7_A)', () => {
  const signals = { inject_hints: { frequency_illusion: { intensity: 'weak' } } };
  const r = selectSignalInject(signals, {});
  assert.equal(r.reframe_invoked, 'R7');
});

test('🛑 selectSignalInject: non-reframe paths (S2 / S4 weak / S5) → no reframe_invoked field', () => {
  const noReframeCases = [
    { inject_hints: { passive_hope: { death_adjacent: false } } },       // S2 light
    { inject_hints: { conditional_worth: { intensity: 'weak' } } },      // S4 weak
    { inject_hints: { negative_generalization: {} } },                   // S5 (integration)
  ];
  for (const signals of noReframeCases) {
    const state = { primary_mode: 'integration' };
    const r = selectSignalInject(signals, state);
    assert.equal(r.reframe_invoked, undefined);
  }
});

// ═════════════════════════════════════════════════════════
// selectTakeawayPhrasing — already emits reframe_invoked for R7_C
// (existing field, engine-4 handler wires it to buildInvocationPatch)
// ═════════════════════════════════════════════════════════

test('🛑 selectTakeawayPhrasing: future_pacing + takeawayTerm → reframe_invoked R7_C', () => {
  // deriveTakeawayTerm reads top1_value | current_quality_candidate_term | success-anchor.
  const r = selectTakeawayPhrasing({
    primary_mode: 'future_pacing',
    top1_value: '勇敢',
  });
  assert.equal(r.reframe_invoked, 'R7_C');
});

// ═════════════════════════════════════════════════════════
// 🔴 Sync-gate — each invocation file must import buildInvocationPatch.
// Anti-regression: 未來新 reframe site 漏記 → 這層先紅.
// ═════════════════════════════════════════════════════════

// Engine-1 routes via `reframe_invoked: 'X'` channel (signalRouting field),
// then e1MasterHandler calls buildInvocationPatch({reframe_id: signalRouting.reframe_invoked}).
// Other engines call buildInvocationPatch with literal reframe_id.
const SITES = [
  { file: 'lib/detector-handlers/engine-1.js', reframes: ['R1', 'R7'], marker: 'reframe_invoked' },
  { file: 'lib/detector-handlers/engine-2.js', reframes: ['R1', 'R5', 'R2'], marker: 'reframe_id' },
  { file: 'lib/detector-handlers/engine-3.js', reframes: ['R2'], marker: 'reframe_id' },
  { file: 'lib/detector-handlers/engine-4.js', reframes: ['R7'], marker: 'reframe_id' },
];

for (const site of SITES) {
  test(`🔴 sync-gate — ${site.file} imports buildInvocationPatch + records ${site.reframes.join('/')}`, () => {
    const src = readFileSync(join(repoRoot, site.file), 'utf8');
    assert.match(src, /from ['"][^'"]*invocation-tracker(\.js)?['"]/,
      `${site.file} must import from invocation-tracker.js`);
    assert.match(src, /buildInvocationPatch/,
      `${site.file} must reference buildInvocationPatch helper`);
    for (const rid of site.reframes) {
      assert.match(src, new RegExp(`${site.marker}:\\s*['"]${rid}['"]`),
        `${site.file} must record ${site.marker}=${rid}`);
    }
  });
}

// ═════════════════════════════════════════════════════════
// 🔴 Sync-gate — chat.js threads now_iso + session_id into ctx + uses merger
// ═════════════════════════════════════════════════════════

test('🔴 sync-gate — api/chat.js threads now_iso + session_id into ctx + uses concat merger', () => {
  const src = readFileSync(join(repoRoot, 'api/chat.js'), 'utf8');
  // ctx augmentation.
  assert.match(src, /session_id:\s*sessionId/,
    'chat.js must add session_id: sessionId to ctx');
  assert.match(src, /now_iso:\s*new Date\(\)\.toISOString\(\)/,
    'chat.js must add now_iso: new Date().toISOString() to ctx');
  // Merger import + use.
  assert.match(src, /from ['"][^'"]*detector-patch-merge(\.js)?['"]/,
    'chat.js must import makeDetectorPatchMerger');
  assert.match(src, /makeDetectorPatchMerger\(sessionState\)/,
    'chat.js must instantiate merger with sessionState baseline');
  // Anti-regression: shallow merge of out.patch on detector path must be gone.
  const occurrences = (src.match(/detectorPatch = \{ \.\.\.detectorPatch, \.\.\.(onbOut|out)\.patch \}/g) || []).length;
  assert.equal(occurrences, 0,
    'no more shallow `detectorPatch = {...detectorPatch, ...x.patch}` — all 3 sites must use mergeDetectorPatch');
});

// ═════════════════════════════════════════════════════════
// 🔴 偵測器 delta — 同 turn 2 個 reframe 都到得了 detector
// (模擬 chat.js detectorPatch → detectScJourneyEvidenceForTurn 流程)
// ═════════════════════════════════════════════════════════

test('🔴 detector delta: 同 turn R1 + R5 → 偵測器 newReframeIds = {R1, R5}', async () => {
  // Build prev + patches mimicking the live merge path.
  const { buildInvocationPatch } = await import('../damon-reframe-library/invocation-tracker.js');
  const { makeDetectorPatchMerger } = await import('../state/detector-patch-merge.js');

  const prevList = [];
  const prevSessionState = { reframe_invocation_history_in_session: prevList };
  const merge = makeDetectorPatchMerger(prevSessionState);

  const patchA = buildInvocationPatch({
    reframe_id: 'R1',
    state: prevSessionState,
    ctx: baseCtx(),
  });
  const patchB = buildInvocationPatch({
    reframe_id: 'R5',
    state: prevSessionState,
    ctx: baseCtx(),
  });
  const detectorPatch = merge(merge({}, patchA), patchB);

  // Mirror chat.js:510-515 delta computation.
  const prevHistory = prevSessionState.reframe_invocation_history_in_session;
  const newHistory = detectorPatch.reframe_invocation_history_in_session;
  const newReframeIds = new Set(
    newHistory.slice(prevHistory.length).map(e => e?.reframe_id).filter(Boolean)
  );
  assert.equal(newReframeIds.size, 2);
  assert.ok(newReframeIds.has('R1'), 'detector must see R1 → step_6 sovereignty');
  assert.ok(newReframeIds.has('R5'), 'detector must see R5 → step_5 resource_retrieval');
});
