// lib/util/entry-gate.test.js
// Patrick 6/2 — entry setup gate boundary lock.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { needsEntrySetup } from './entry-gate.js';

// ─── 3 spec scenarios (Vivi 驗收清單) ────────────────────────

test('🛑 Scenario 1: 新 magic-link user (preferredName 空) + route=journey → true (強制跳 entry)', () => {
  assert.equal(needsEntrySetup({
    studentId: 'A001',
    preferredName: null,
    pace: 'daily',
    route: 'journey',
  }), true);
});

test('🛑 Scenario 2: 已完整 user (有 name + pace) + route=journey → false (照舊跳 journey)', () => {
  assert.equal(needsEntrySetup({
    studentId: 'A001',
    preferredName: 'Vivi',
    pace: 'daily',
    route: 'journey',
  }), false);
});

test('🛑 Scenario 3: blocked user 仍跳 /#/blocked → false (gate 不阻擋 /blocked route)', () => {
  // 即使 setup 不完整, 在 /blocked route 上不該被 redirect 去 entry.
  assert.equal(needsEntrySetup({
    studentId: 'A001',
    preferredName: null,
    pace: 'daily',
    route: 'blocked',
  }), false);
});

// ─── 防無限重導 ────────────────────────────────────────────

test('🛑 already on /entry → false (不能在 entry 內再 redirect 去 entry, 防無限 loop)', () => {
  assert.equal(needsEntrySetup({
    studentId: 'A001',
    preferredName: null,
    pace: 'daily',
    route: 'entry',
  }), false);
});

// ─── 未認證: hydrate gate 負責, 不是這層 ────────────────────

test('未認證 (studentId 空) → false (hydrate gate 該負責、不是這層)', () => {
  assert.equal(needsEntrySetup({
    studentId: null,
    preferredName: null,
    pace: null,
    route: 'journey',
  }), false);
});

test('未認證 + undefined → false', () => {
  assert.equal(needsEntrySetup({
    studentId: undefined,
    preferredName: 'Vivi',
    pace: 'daily',
    route: 'conversation',
  }), false);
});

// ─── 缺 pace (defensive, 實務上 /api/me 預設 'daily' 不會觸發) ──

test('缺 pace (pace=null) + route=note → true', () => {
  assert.equal(needsEntrySetup({
    studentId: 'A001',
    preferredName: 'Vivi',
    pace: null,
    route: 'note',
  }), true);
});

test('缺 pace (pace="") + route=phase-report → true', () => {
  // pace 空字串視為 falsy.
  assert.equal(needsEntrySetup({
    studentId: 'A001',
    preferredName: 'Vivi',
    pace: '',
    route: 'phase-report',
  }), true);
});

// ─── 各 route 都該被 gate ──────────────────────────────────

test('🛑 缺 preferredName 在所有 non-entry/blocked route 都觸發', () => {
  for (const route of ['journey', 'conversation', 'note', 'phase-report',
                        'graduation', 'upgrade']) {
    assert.equal(
      needsEntrySetup({
        studentId: 'A001',
        preferredName: null,
        pace: 'daily',
        route,
      }),
      true,
      `route='${route}' 缺 preferredName 必須觸發 entry redirect`,
    );
  }
});

// ─── defensive ─────────────────────────────────────────────

test('no args → false (不誤觸發, never throws)', () => {
  assert.equal(needsEntrySetup(), false);
  assert.equal(needsEntrySetup({}), false);
});

test('preferredName 空字串 / undefined → 視為缺', () => {
  assert.equal(needsEntrySetup({
    studentId: 'A001', preferredName: '', pace: 'daily', route: 'journey',
  }), true);
  assert.equal(needsEntrySetup({
    studentId: 'A001', preferredName: undefined, pace: 'daily', route: 'journey',
  }), true);
});
