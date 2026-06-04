// lib/state/handoff-escalation.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  HITL_ALERT_THRESHOLD,
  HANDOFF_TRIGGER_SOURCES,
  POST_HANDOFF_BRANCHES,
  incrementHandoffCount,
  shouldAlertHITL,
  isValidTriggerSource,
  isValidPostHandoffBranch,
  patchForHandoff,
  evaluateHandoff,
  // ⭐ §3 patch 6/4 (safety patch #23) — passive DW thresholds + helpers.
  PASSIVE_DW_ESCALATE_THRESHOLD,
  PASSIVE_DW_FREEZE_THRESHOLD,
  selectPassiveDWVariant,
  passiveDWVariantToTriggerSource,
} from './handoff-escalation.js';

// ─────────────────────────────────────────────────────────
// constants
// ─────────────────────────────────────────────────────────

test('HITL_ALERT_THRESHOLD = 2 (Engine 1 §A3)', () => {
  assert.equal(HITL_ALERT_THRESHOLD, 2);
});

test('HANDOFF_TRIGGER_SOURCES: covers 6 spec sources across engines 1+3+4', () => {
  const keys = Object.keys(HANDOFF_TRIGGER_SOURCES);
  // Engine 1: E1c, E1d, E1a
  assert.ok(keys.some(k => k.startsWith('E1c')));
  assert.ok(keys.some(k => k.startsWith('E1d')));
  assert.ok(keys.some(k => k.startsWith('E1a')));
  // Engine 3: deep_signal, opening_branch, top1
  assert.ok(keys.some(k => k.includes('deep_signal')));
  assert.ok(keys.some(k => k.includes('opening_branch')));
  assert.ok(keys.some(k => k.includes('top1')));
  // Engine 4: day_opening
  assert.ok(keys.some(k => k.includes('day_opening')));
});

test('POST_HANDOFF_BRANCHES: 3 branches', () => {
  assert.equal(POST_HANDOFF_BRANCHES.REDIRECT, 'redirect');
  assert.equal(POST_HANDOFF_BRANCHES.PAUSE, 'pause');
  assert.equal(POST_HANDOFF_BRANCHES.SILENT, 'silent');
});

test('enums are frozen', () => {
  assert.ok(Object.isFrozen(HANDOFF_TRIGGER_SOURCES));
  assert.ok(Object.isFrozen(POST_HANDOFF_BRANCHES));
});

// ─────────────────────────────────────────────────────────
// incrementHandoffCount
// ─────────────────────────────────────────────────────────

test('incrementHandoffCount: increments by 1', () => {
  assert.equal(incrementHandoffCount(0), 1);
  assert.equal(incrementHandoffCount(5), 6);
});

test('incrementHandoffCount: undefined / null → 1', () => {
  assert.equal(incrementHandoffCount(undefined), 1);
  assert.equal(incrementHandoffCount(null), 1);
});

// ─────────────────────────────────────────────────────────
// shouldAlertHITL
// ─────────────────────────────────────────────────────────

test('shouldAlertHITL: false at 0/1, true at 2+', () => {
  assert.equal(shouldAlertHITL(0), false);
  assert.equal(shouldAlertHITL(1), false);
  assert.equal(shouldAlertHITL(2), true);
  assert.equal(shouldAlertHITL(5), true);
});

test('shouldAlertHITL: false on non-number', () => {
  assert.equal(shouldAlertHITL('many'), false);
  assert.equal(shouldAlertHITL(null), false);
});

// ─────────────────────────────────────────────────────────
// validators
// ─────────────────────────────────────────────────────────

test('isValidTriggerSource: accepts known sources by value', () => {
  assert.equal(isValidTriggerSource('E1c_requires_typing_failed'), true);
  assert.equal(isValidTriggerSource('E3_deep_signal'), true);
});

test('isValidTriggerSource: rejects unknown', () => {
  assert.equal(isValidTriggerSource('made_up_source'), false);
  assert.equal(isValidTriggerSource(''), false);
  assert.equal(isValidTriggerSource(null), false);
});

test('isValidPostHandoffBranch: accepts the 3 branches', () => {
  assert.equal(isValidPostHandoffBranch('redirect'), true);
  assert.equal(isValidPostHandoffBranch('pause'), true);
  assert.equal(isValidPostHandoffBranch('silent'), true);
});

test('isValidPostHandoffBranch: rejects unknown', () => {
  assert.equal(isValidPostHandoffBranch('quit'), false);
});

// ─────────────────────────────────────────────────────────
// patchForHandoff
// ─────────────────────────────────────────────────────────

test('patchForHandoff: builds session_state patch', () => {
  assert.deepEqual(patchForHandoff(0), { handoff_triggered_count: 1 });
  assert.deepEqual(patchForHandoff(3), { handoff_triggered_count: 4 });
});

test('patchForHandoff: undefined currentCount → starts at 1', () => {
  assert.deepEqual(patchForHandoff(undefined), { handoff_triggered_count: 1 });
});

// ─────────────────────────────────────────────────────────
// evaluateHandoff (full orchestration)
// ─────────────────────────────────────────────────────────

test('evaluateHandoff: 1st handoff in session → no HITL yet', () => {
  const r = evaluateHandoff({ currentCount: 0, source: 'E1c_requires_typing_failed' });
  assert.deepEqual(r.patch, { handoff_triggered_count: 1 });
  assert.equal(r.hitl_alert, false);
  assert.equal(r.new_count, 1);
});

test('evaluateHandoff: 2nd handoff in session → HITL alert', () => {
  const r = evaluateHandoff({ currentCount: 1, source: 'E3_deep_signal' });
  assert.deepEqual(r.patch, { handoff_triggered_count: 2 });
  assert.equal(r.hitl_alert, true);
  assert.equal(r.new_count, 2);
});

test('evaluateHandoff: 3rd handoff → still HITL alert', () => {
  const r = evaluateHandoff({ currentCount: 2, source: 'E1d_bypassing_layer_maxed' });
  assert.equal(r.hitl_alert, true);
  assert.equal(r.new_count, 3);
});

test('evaluateHandoff: rejects unknown source', () => {
  assert.throws(
    () => evaluateHandoff({ currentCount: 0, source: 'bogus' }),
    /unknown trigger source/,
  );
});

test('evaluateHandoff: undefined currentCount defaults to 0', () => {
  const r = evaluateHandoff({ source: 'E1a_offtopic_persistent' });
  assert.equal(r.new_count, 1);
});

// ═════════════════════════════════════════════════════════
// ⭐ §3 patch 6/4 (safety patch #23) — Passive DW thresholds + variant selector
// ═════════════════════════════════════════════════════════

test('🛑 PASSIVE_DW_ESCALATE_THRESHOLD = 3 (spec patch #23 §A5)', () => {
  assert.equal(PASSIVE_DW_ESCALATE_THRESHOLD, 3);
});

test('🛑 PASSIVE_DW_FREEZE_THRESHOLD = 5 (spec patch #23 §A5)', () => {
  assert.equal(PASSIVE_DW_FREEZE_THRESHOLD, 5);
});

test('HANDOFF_TRIGGER_SOURCES: adds 4 passive DW sub-sources (safety patch #23)', () => {
  const keys = Object.keys(HANDOFF_TRIGGER_SOURCES);
  assert.ok(keys.includes('E3_passive_dw_strong'));
  assert.ok(keys.includes('E3_passive_dw_implicit'));
  assert.ok(keys.includes('E3_passive_dw_repeat'));
  assert.ok(keys.includes('E3_passive_dw_freeze'));
});

test('isValidTriggerSource: accepts new passive DW sources', () => {
  assert.equal(isValidTriggerSource('E3_passive_dw_strong'), true);
  assert.equal(isValidTriggerSource('E3_passive_dw_implicit'), true);
  assert.equal(isValidTriggerSource('E3_passive_dw_repeat'), true);
  assert.equal(isValidTriggerSource('E3_passive_dw_freeze'), true);
});

// ─── selectPassiveDWVariant ──────────────────────────────

test('🛑 selectPassiveDWVariant: strong signal + low count → "strong" (C-1)', () => {
  assert.equal(selectPassiveDWVariant({ signal: 'strong', newCount: 1 }), 'strong');
  assert.equal(selectPassiveDWVariant({ signal: 'strong', newCount: 2 }), 'strong');
});

test('🛑 selectPassiveDWVariant: implicit signal + low count → "implicit" (C-2)', () => {
  assert.equal(selectPassiveDWVariant({ signal: 'implicit', newCount: 1 }), 'implicit');
  assert.equal(selectPassiveDWVariant({ signal: 'implicit', newCount: 2 }), 'implicit');
});

test('🛑 selectPassiveDWVariant: count = 3 (escalate threshold) → "repeat" (C-3)', () => {
  assert.equal(selectPassiveDWVariant({ signal: 'strong', newCount: 3 }), 'repeat');
  assert.equal(selectPassiveDWVariant({ signal: 'implicit', newCount: 3 }), 'repeat');
});

test('🛑 selectPassiveDWVariant: count = 4 → still "repeat" (between 3 and 5)', () => {
  assert.equal(selectPassiveDWVariant({ signal: 'strong', newCount: 4 }), 'repeat');
});

test('🛑 selectPassiveDWVariant: count = 5 (freeze threshold) → "freeze" (C-4)', () => {
  assert.equal(selectPassiveDWVariant({ signal: 'strong', newCount: 5 }), 'freeze');
  assert.equal(selectPassiveDWVariant({ signal: 'implicit', newCount: 5 }), 'freeze');
});

test('selectPassiveDWVariant: count > 5 → still "freeze" (highest level)', () => {
  assert.equal(selectPassiveDWVariant({ signal: 'strong', newCount: 12 }), 'freeze');
});

test('selectPassiveDWVariant: rejects bad signal', () => {
  assert.throws(
    () => selectPassiveDWVariant({ signal: 'whatever', newCount: 1 }),
    /signal must be 'strong' or 'implicit'/,
  );
});

test('selectPassiveDWVariant: rejects bad newCount', () => {
  assert.throws(
    () => selectPassiveDWVariant({ signal: 'strong', newCount: -1 }),
    /newCount must be non-negative number/,
  );
  assert.throws(
    () => selectPassiveDWVariant({ signal: 'strong', newCount: NaN }),
    /newCount must be non-negative number/,
  );
});

// ─── passiveDWVariantToTriggerSource ─────────────────────

test('passiveDWVariantToTriggerSource: each variant maps to its enum source', () => {
  assert.equal(passiveDWVariantToTriggerSource('strong'),   'E3_passive_dw_strong');
  assert.equal(passiveDWVariantToTriggerSource('implicit'), 'E3_passive_dw_implicit');
  assert.equal(passiveDWVariantToTriggerSource('repeat'),   'E3_passive_dw_repeat');
  assert.equal(passiveDWVariantToTriggerSource('freeze'),   'E3_passive_dw_freeze');
});

test('passiveDWVariantToTriggerSource: rejects unknown variant', () => {
  assert.throws(
    () => passiveDWVariantToTriggerSource('bogus'),
    /unknown variant/,
  );
});
