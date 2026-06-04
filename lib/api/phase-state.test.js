// lib/api/phase-state.test.js — Phase Report state machine (P4)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  PHASE_REPORT_NAMES, PHASE_REPORT_ROMAN, PHASE_REPORT_TEACHINGS,
  phaseSequenceIndex, computePhaseReportStates, isPhaseReportUnlocked,
} from './phase-state.js';

// ─────────────────────────────────────────────────────────
// Constants pinned to spec §5.5 + §8
// ─────────────────────────────────────────────────────────

test('PHASE_REPORT_NAMES: exactly the 5 spec §5.5 names in order', () => {
  assert.deepEqual([...PHASE_REPORT_NAMES],
    ['找到你真正要的', '你是誰', '擴大地圖', '串連起來', '放手帶著走']);
  assert.ok(Object.isFrozen(PHASE_REPORT_NAMES));
});

test('PHASE_REPORT_ROMAN: I..V frozen', () => {
  assert.deepEqual([...PHASE_REPORT_ROMAN], ['I', 'II', 'III', 'IV', 'V']);
  assert.ok(Object.isFrozen(PHASE_REPORT_ROMAN));
});

test('PHASE_REPORT_TEACHINGS: 5 entries, each a non-empty string with multiple lines', () => {
  assert.equal(PHASE_REPORT_TEACHINGS.length, 5);
  for (let i = 0; i < 5; i++) {
    const t = PHASE_REPORT_TEACHINGS[i];
    assert.equal(typeof t, 'string', `teaching ${i + 1} must be a string`);
    assert.ok(t.length > 50, `teaching ${i + 1} too short — spec says ~6-8 lines`);
    assert.ok(t.split(/\n/).length >= 5, `teaching ${i + 1} should have multiple lines`);
  }
});

test('🛑 PHASE_REPORT_TEACHINGS: 紅線 1 — none contain 為什麼', () => {
  for (let i = 0; i < 5; i++) {
    assert.doesNotMatch(PHASE_REPORT_TEACHINGS[i], /為什麼/,
      `teaching ${i + 1} must not violate red-line 1 by example`);
  }
});

// ─────────────────────────────────────────────────────────
// phaseSequenceIndex
// ─────────────────────────────────────────────────────────

test('🛑 modeProgressionIndex: v5.1 modes map to expected indices (PR-23s4c task 8)', () => {
  // v5.1 primary_mode mapping (canonical).
  assert.equal(phaseSequenceIndex('elicitation'), 0);
  assert.equal(phaseSequenceIndex('identity_anchoring'), 2);
  assert.equal(phaseSequenceIndex('integration'), 3);
  assert.equal(phaseSequenceIndex('cascade'), 5);
  assert.equal(phaseSequenceIndex('future_pacing'), 6);
  assert.equal(phaseSequenceIndex('crisis'), -1, 'in-crisis = no progression signal');
});

test('phaseSequenceIndex legacy phase_X strings (PR-23s4c task 8 dual-read fallback)', () => {
  // Legacy v5.0 phase_X strings still recognized for dual-read during transition.
  assert.equal(phaseSequenceIndex('phase_1'), 0);            // → elicitation
  assert.equal(phaseSequenceIndex('phase_2'), 2);            // → identity_anchoring
  assert.equal(phaseSequenceIndex('phase_3a'), 3);           // → integration (unified)
  assert.equal(phaseSequenceIndex('phase_3b'), 3);           // → integration (unified)
  assert.equal(phaseSequenceIndex('phase_4'), 5);            // → cascade
  assert.equal(phaseSequenceIndex('phase_5'), 6);            // → future_pacing
  assert.equal(phaseSequenceIndex('integration_retention'), 7);  // past future_pacing
  assert.equal(phaseSequenceIndex('program_completed'), 8);
});

test('phaseSequenceIndex: unknown / nullish → -1', () => {
  assert.equal(phaseSequenceIndex(null), -1);
  assert.equal(phaseSequenceIndex(undefined), -1);
  assert.equal(phaseSequenceIndex(''), -1);
  assert.equal(phaseSequenceIndex('phase_99'), -1);
  assert.equal(phaseSequenceIndex(42), -1);
});

// ─────────────────────────────────────────────────────────
// computePhaseReportStates
// ─────────────────────────────────────────────────────────

test('🛑 computePhaseReportStates: brand-new student (null) → all 5 locked', () => {
  const s = computePhaseReportStates(null);
  assert.equal(s.length, 5);
  for (let i = 0; i < 5; i++) {
    assert.deepEqual(s[i], { phaseId: i + 1, name: PHASE_REPORT_NAMES[i], state: 'locked' });
  }
});

test('🛑 computePhaseReportStates: still on phase_1 → all locked (phase 1 not yet done)', () => {
  const s = computePhaseReportStates('phase_1');
  for (const r of s) assert.equal(r.state, 'locked');
});

test('🛑 computePhaseReportStates: at phase_2 → Report 1 unlocks (phase 1 done)', () => {
  const s = computePhaseReportStates('phase_2');
  assert.equal(s[0].state, 'unlocked', 'Report 1「找到你真正要的」 unlocks past phase_1');
  for (let i = 1; i < 5; i++) assert.equal(s[i].state, 'locked');
});

test('🛑 computePhaseReportStates: at phase_3a (owned path) → Reports 1+2 unlock', () => {
  const s = computePhaseReportStates('phase_3a');
  assert.equal(s[0].state, 'unlocked');
  assert.equal(s[1].state, 'unlocked', 'Report 2「你是誰」 unlocks past phase_2');
  assert.equal(s[2].state, 'locked', 'Report 3「擴大地圖」 needs to be past phase_3b idx (cpIdx=2 < 3)');
});

test('🛑 computePhaseReportStates: at phase_4 (after EITHER 3a OR 3b) → Report 3 unlocks', () => {
  const s = computePhaseReportStates('phase_4');
  assert.equal(s[0].state, 'unlocked');
  assert.equal(s[1].state, 'unlocked');
  assert.equal(s[2].state, 'unlocked', 'Report 3 unlocks past phase_3b — 3a path lands at phase_4 (cpIdx=4) ✓');
  assert.equal(s[3].state, 'locked');
  assert.equal(s[4].state, 'locked');
});

test('computePhaseReportStates: at phase_5 → Reports 1-4 unlocked', () => {
  const s = computePhaseReportStates('phase_5');
  for (let i = 0; i < 4; i++) assert.equal(s[i].state, 'unlocked', `Report ${i + 1}`);
  assert.equal(s[4].state, 'locked');
});

test('🛑 computePhaseReportStates: program_completed → ALL 5 reports unlocked', () => {
  const s = computePhaseReportStates('program_completed');
  for (let i = 0; i < 5; i++) assert.equal(s[i].state, 'unlocked', `Report ${i + 1}`);
});

test('computePhaseReportStates: integration_retention → all 5 unlocked (past phase_5)', () => {
  const s = computePhaseReportStates('integration_retention');
  for (let i = 0; i < 5; i++) assert.equal(s[i].state, 'unlocked');
});

// ─────────────────────────────────────────────────────────
// isPhaseReportUnlocked — convenience gate for /api/phase-report
// ─────────────────────────────────────────────────────────

test('isPhaseReportUnlocked: rejects out-of-range phaseId', () => {
  for (const bad of [0, 6, -1, 1.5, NaN, null, 'one']) {
    assert.equal(isPhaseReportUnlocked(bad, 'program_completed'), false,
      `phaseId ${bad} should be rejected`);
  }
});

test('isPhaseReportUnlocked: aligns with computePhaseReportStates', () => {
  // Cross-check the convenience helper against the array form for every phase
  const phases = ['phase_1', 'phase_2', 'phase_3a', 'phase_3b', 'phase_4', 'phase_5', 'integration_retention', 'program_completed', null];
  for (const p of phases) {
    const states = computePhaseReportStates(p);
    for (let id = 1; id <= 5; id++) {
      const expected = states[id - 1].state === 'unlocked';
      assert.equal(isPhaseReportUnlocked(id, p), expected,
        `mismatch for phaseId=${id} currentPhase=${p}`);
    }
  }
});
