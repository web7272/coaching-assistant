// lib/util/coach-filter.test.js
// Patrick 6/3 — 教練後台 filter boundary lock.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COACH_FILTERS, matchesCoachFilter, applyCoachFilter,
} from './coach-filter.js';

const NOW = new Date('2026-06-15T12:00:00Z');
const D = 24 * 60 * 60 * 1000;
const daysAgo = (n) => new Date(NOW.getTime() - n * D).toISOString();

// 9-student fixture mirroring封測 reality.
const fixture = [
  // A001 — 封測 + 活躍
  { student_id: 'A001', is_beta: true,  is_blocked: false, effective_day: 5,  last_active: daysAgo(2) },
  // A002 — 封測 + 14 天沒動
  { student_id: 'A002', is_beta: true,  is_blocked: false, effective_day: 3,  last_active: daysAgo(15) },
  // A003 — 封測 + 完成 Day 21
  { student_id: 'A003', is_beta: true,  is_blocked: false, effective_day: 21, last_active: daysAgo(1) },
  // A004 — 封測 + blocked
  { student_id: 'A004', is_beta: true,  is_blocked: true,  effective_day: 8,  last_active: daysAgo(40) },
  // A005 — 正式 + 活躍
  { student_id: 'A005', is_beta: false, is_blocked: false, effective_day: 7,  last_active: daysAgo(1) },
  // A006 — 正式 + 完成 Day 21
  { student_id: 'A006', is_beta: false, is_blocked: false, effective_day: 21, last_active: daysAgo(5) },
  // A007 — 正式 + blocked
  { student_id: 'A007', is_beta: false, is_blocked: true,  effective_day: 2,  last_active: daysAgo(60) },
  // A008 — 正式 + 30 天沒動 (at_risk)
  { student_id: 'A008', is_beta: false, is_blocked: false, effective_day: 4,  last_active: daysAgo(30) },
  // A009 — 沒登入過
  { student_id: 'A009', is_beta: false, is_blocked: false, effective_day: 1,  last_active: null },
];

// ─── COACH_FILTERS constant ──────────────────────────

test('COACH_FILTERS: frozen + 6 values', () => {
  assert.ok(Object.isFrozen(COACH_FILTERS));
  assert.deepEqual([...COACH_FILTERS],
    ['all', 'beta', 'blocked', 'active', 'finished', 'at_risk']);
});

// ─── matchesCoachFilter ──────────────────────────────

test('🛑 filter="all" → 所有 row 都 true', () => {
  for (const s of fixture) {
    assert.equal(matchesCoachFilter(s, 'all', NOW), true);
  }
});

test('🛑 filter="beta" → 只 is_beta=true (4 個: A001-A004)', () => {
  const matched = fixture.filter(s => matchesCoachFilter(s, 'beta', NOW));
  assert.deepEqual(matched.map(s => s.student_id), ['A001', 'A002', 'A003', 'A004']);
});

test('🛑 filter="blocked" → 只 is_blocked=true (2 個: A004, A007)', () => {
  const matched = fixture.filter(s => matchesCoachFilter(s, 'blocked', NOW));
  assert.deepEqual(matched.map(s => s.student_id), ['A004', 'A007']);
});

test('🛑 filter="active" → 正式 + 沒 block (4 個: A005, A006, A008, A009)', () => {
  const matched = fixture.filter(s => matchesCoachFilter(s, 'active', NOW));
  assert.deepEqual(matched.map(s => s.student_id), ['A005', 'A006', 'A008', 'A009']);
});

test('🛑 filter="finished" → effective_day >= 21 (2 個: A003, A006)', () => {
  const matched = fixture.filter(s => matchesCoachFilter(s, 'finished', NOW));
  assert.deepEqual(matched.map(s => s.student_id), ['A003', 'A006']);
});

test('🛑 filter="at_risk" → 14+ 天沒動 + 還在跑 (A002, A008; A004 blocked 排除, A009 沒登入排除)', () => {
  const matched = fixture.filter(s => matchesCoachFilter(s, 'at_risk', NOW));
  assert.deepEqual(matched.map(s => s.student_id), ['A002', 'A008']);
});

// ─── boundary ────────────────────────────────────────

test('🛑 at_risk 邊界: 14 天整 → true, 13 天 → false', () => {
  const s14 = { is_beta: false, is_blocked: false, effective_day: 5, last_active: daysAgo(14) };
  const s13 = { is_beta: false, is_blocked: false, effective_day: 5, last_active: daysAgo(13) };
  assert.equal(matchesCoachFilter(s14, 'at_risk', NOW), true);
  assert.equal(matchesCoachFilter(s13, 'at_risk', NOW), false);
});

test('🛑 finished 邊界: effective_day=21 → true, 20 → false', () => {
  const s21 = { effective_day: 21, is_beta: false, is_blocked: false };
  const s20 = { effective_day: 20, is_beta: false, is_blocked: false };
  assert.equal(matchesCoachFilter(s21, 'finished'), true);
  assert.equal(matchesCoachFilter(s20, 'finished'), false);
});

test('🛑 at_risk 排除 blocked + finished (即使 30 天沒動)', () => {
  // blocked + 60 天沒動 → at_risk false (已 blocked 不需要關心)
  assert.equal(matchesCoachFilter({
    is_blocked: true, effective_day: 5, last_active: daysAgo(60),
  }, 'at_risk', NOW), false);
  // 已完成 Day 21 + 30 天沒動 → at_risk false (走完了, 不算缺席)
  assert.equal(matchesCoachFilter({
    is_blocked: false, effective_day: 21, last_active: daysAgo(30),
  }, 'at_risk', NOW), false);
});

// ─── defensive ───────────────────────────────────────

test('matchesCoachFilter: null/undefined student → false', () => {
  assert.equal(matchesCoachFilter(null, 'beta'), false);
  assert.equal(matchesCoachFilter(undefined, 'beta'), false);
});

test('matchesCoachFilter: 未知 filter → true (caller bug 不該讓 UI 變空白)', () => {
  assert.equal(matchesCoachFilter({ is_beta: true }, 'unknown_filter'), true);
});

test('matchesCoachFilter: 缺 effective_day → 用 current_day fallback', () => {
  assert.equal(matchesCoachFilter({ current_day: 21 }, 'finished'), true);
  assert.equal(matchesCoachFilter({ current_day: 20 }, 'finished'), false);
});

test('matchesCoachFilter: 缺 effective_day + current_day → 視為 0', () => {
  assert.equal(matchesCoachFilter({}, 'finished'), false);
});

test('matchesCoachFilter: at_risk 無 last_active → false (沒登入過, 30 天 window 處理)', () => {
  assert.equal(matchesCoachFilter({
    is_beta: false, is_blocked: false, effective_day: 5, last_active: null,
  }, 'at_risk', NOW), false);
});

test('matchesCoachFilter: last_active 不合法 → false', () => {
  assert.equal(matchesCoachFilter({
    is_beta: false, is_blocked: false, effective_day: 5, last_active: 'not-a-date',
  }, 'at_risk', NOW), false);
});

test('matchesCoachFilter: 嚴格 ===true (DB 回字串 t / 1 不算)', () => {
  // is_beta 應該 boolean. 任何非嚴格 true 都不算 beta.
  assert.equal(matchesCoachFilter({ is_beta: 'true' }, 'beta'), false);
  assert.equal(matchesCoachFilter({ is_beta: 1 }, 'beta'), false);
  assert.equal(matchesCoachFilter({ is_beta: 't' }, 'beta'), false);
  assert.equal(matchesCoachFilter({ is_beta: true }, 'beta'), true);
});

// ─── applyCoachFilter ───────────────────────────────

test('🛑 applyCoachFilter: all → 回原長度 (slice copy, 非 ref)', () => {
  const out = applyCoachFilter(fixture, 'all', NOW);
  assert.equal(out.length, fixture.length);
  assert.notEqual(out, fixture, 'must return a copy, not the same reference');
});

test('applyCoachFilter: 非陣列 → []', () => {
  assert.deepEqual(applyCoachFilter(null), []);
  assert.deepEqual(applyCoachFilter('not-an-array'), []);
  assert.deepEqual(applyCoachFilter(undefined), []);
});

test('applyCoachFilter: 空陣列 → []', () => {
  assert.deepEqual(applyCoachFilter([], 'beta'), []);
});

test('applyCoachFilter: missing filter / undefined filter → 所有 (= all)', () => {
  assert.equal(applyCoachFilter(fixture, undefined, NOW).length, fixture.length);
  assert.equal(applyCoachFilter(fixture, '', NOW).length, fixture.length);
});
