// lib/dashboard/failure-modes.test.js
// v5.1 Step 8 — Lock M-series registry + P→M alias + P10/P21 deprecation guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  M_REGISTRY, P_TO_M_MAP, DEPRECATED_P_IDS, SEVERITY_TIER, MODE_BUCKET,
  RESERVED_RANGES,
  getFailureMode, getByTier, getByMode, tryMapPtoM,
} from './failure-modes.js';

// ─── P→M mapping (errata §1.1 verbatim, 23 entries + 2 C) ─

test('🛑 P_TO_M_MAP: 23 P → M entries + 2 C-series, no P10/P21', () => {
  // Errata §1.1 — 23 mappings (P1-P25 minus P10, P21) + C1, C2.
  const expectedPs = ['P1','P2','P3','P4','P5','P6','P7','P8','P9',
                      'P11','P12','P13','P14','P15','P16','P17','P18','P19','P20',
                      'P22','P23','P24','P25'];
  for (const p of expectedPs) {
    assert.ok(P_TO_M_MAP[p], `${p} must map to an M-ID`);
  }
  assert.equal(P_TO_M_MAP.P10, undefined, 'P10 deprecated');
  assert.equal(P_TO_M_MAP.P21, undefined, 'P21 deprecated');
  // C → M.
  assert.equal(P_TO_M_MAP.C1, 'M80');
  assert.equal(P_TO_M_MAP.C2, 'M81');
});

test('🛑 P→M specific mappings verbatim from errata §1.1', () => {
  assert.equal(P_TO_M_MAP.P1, 'M1');
  assert.equal(P_TO_M_MAP.P6, 'M10');
  assert.equal(P_TO_M_MAP.P7, 'M11');
  assert.equal(P_TO_M_MAP.P9, 'M13');
  assert.equal(P_TO_M_MAP.P19, 'M40');
  assert.equal(P_TO_M_MAP.P20, 'M41');
  assert.equal(P_TO_M_MAP.P25, 'M53');
});

// ─── DEPRECATED guard (P10, P21) ─────────────────────────

test('🛑 getFailureMode(P10): throws DEPRECATED guard with reason', () => {
  assert.throws(() => getFailureMode('P10'),
    /P10 is DEPRECATED.*Build Vision phase 倒退/);
});

test('🛑 getFailureMode(P21): throws DEPRECATED guard with reason', () => {
  assert.throws(() => getFailureMode('P21'),
    /P21 is DEPRECATED.*Top 1 演進為合法 mode cycle/);
});

test('🛑 DEPRECATED_P_IDS: 2 entries (P10, P21) with reason + spec ref', () => {
  assert.deepEqual(Object.keys(DEPRECATED_P_IDS).sort(), ['P10', 'P21']);
  assert.match(DEPRECATED_P_IDS.P10.reason, /Build Vision/);
  assert.match(DEPRECATED_P_IDS.P21.reason, /mode cycle/);
});

test('tryMapPtoM(P10/P21): null (not throws — for batch migration scripts)', () => {
  assert.equal(tryMapPtoM('P10'), null);
  assert.equal(tryMapPtoM('P21'), null);
  assert.equal(tryMapPtoM('P1'), 'M1');
  assert.equal(tryMapPtoM('PXX'), null);
});

// ─── Lookup happy path ───────────────────────────────────

test('🛑 getFailureMode(M71): returns Landing Page Reminder 未 deliver, severity highest', () => {
  const m = getFailureMode('M71');
  assert.equal(m.id, 'M71');
  assert.match(m.name_zh, /Landing Page Reminder 未 deliver/);
  assert.equal(m.severity, SEVERITY_TIER.HIGHEST);
  assert.equal(m.mode_bucket, MODE_BUCKET.CRISIS);
});

test('🛑 getFailureMode(P1): legacy lookup returns M1 with _legacy_p_id marker', () => {
  const m = getFailureMode('P1');
  assert.equal(m.id, 'M1');
  assert.equal(m._legacy_p_id, 'P1');
});

test('getFailureMode: unknown id throws', () => {
  assert.throws(() => getFailureMode('M999'), /Unknown failure mode id/);
  assert.throws(() => getFailureMode(''), /non-empty string/);
});

// ─── Severity tiers (errata §1.2 verbatim) ───────────────

test('🛑 §1.2 highest_priority: M60, M61, M62, M71 (safety critical)', () => {
  const highest = getByTier(SEVERITY_TIER.HIGHEST).map(m => m.id).sort();
  assert.deepEqual(highest, ['M60', 'M61', 'M62', 'M71']);
});

test('🛑 §1.2 high_priority includes: M9, M14-M18, M28, M54, M65', () => {
  const highIds = getByTier(SEVERITY_TIER.HIGH).map(m => m.id);
  for (const expected of ['M9', 'M14', 'M15', 'M16', 'M17', 'M18', 'M28', 'M54', 'M65']) {
    assert.ok(highIds.includes(expected), `${expected} must be high_priority`);
  }
});

test('🛑 M72, M73 high_priority (ship-condition from PR-6b)', () => {
  const m72 = getFailureMode('M72');
  const m73 = getFailureMode('M73');
  assert.equal(m72.severity, SEVERITY_TIER.HIGH);
  assert.equal(m73.severity, SEVERITY_TIER.HIGH);
});

// ─── Mode bucket distribution ────────────────────────────

test('🛑 getByMode(CRISIS): M60-M73 (14 entries — Patch 23 + §10 errata)', () => {
  const crisisIds = getByMode(MODE_BUCKET.CRISIS).map(m => m.id).sort();
  // M60-M73 inclusive = 14.
  assert.equal(crisisIds.length, 14);
  for (let i = 60; i <= 73; i++) {
    assert.ok(crisisIds.includes(`M${i}`), `M${i} must be in crisis bucket`);
  }
});

test('🛑 getByMode(IDENTITY_ANCHORING): includes M10-M19 (errata §1.1 new range)', () => {
  const ids = getByMode(MODE_BUCKET.IDENTITY_ANCHORING).map(m => m.id);
  for (let i = 10; i <= 19; i++) {
    assert.ok(ids.includes(`M${i}`), `M${i} must be in identity_anchoring`);
  }
});

// ─── Reserved ranges (errata §1.1) ───────────────────────

test('🛑 RESERVED_RANGES: M30-M39 / M42-M49 / M55-M59 documented as reserved', () => {
  assert.deepEqual(Object.keys(RESERVED_RANGES).sort(), ['M30_M39', 'M42_M49', 'M55_M59']);
  // Verify no M-IDs in reserved ranges are accidentally registered.
  for (let i = 30; i <= 39; i++) {
    assert.equal(M_REGISTRY[`M${i}`], undefined, `M${i} should be reserved`);
  }
  for (let i = 42; i <= 49; i++) {
    assert.equal(M_REGISTRY[`M${i}`], undefined, `M${i} should be reserved`);
  }
  for (let i = 55; i <= 59; i++) {
    assert.equal(M_REGISTRY[`M${i}`], undefined, `M${i} should be reserved`);
  }
});

// ─── Cross-mode (C→M80/M81) ──────────────────────────────

test('🛑 M80 / M81: cross_mode bucket (C1→M80, C2→M81)', () => {
  assert.equal(getFailureMode('M80').mode_bucket, MODE_BUCKET.CROSS_MODE);
  assert.equal(getFailureMode('M81').mode_bucket, MODE_BUCKET.CROSS_MODE);
  assert.equal(getFailureMode('C1').id, 'M80');
  assert.equal(getFailureMode('C2').id, 'M81');
});
