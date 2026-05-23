// api/finalize-day.test.js
// PR-4c v5 day-numbering pure helpers (the handler itself is I/O orchestration).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveSessionDay,
  weekFromSessionDay,
  isWeekBoundary,
  isGraduationDay,
} from './finalize-day.js';

// ─────────────────────────────────────────────────────────
// resolveSessionDay — PR-4c shape (preferred) + legacy week+day fallback
// ─────────────────────────────────────────────────────────

test('resolveSessionDay: PR-4c sessionDay (number) → returned as-is', () => {
  assert.equal(resolveSessionDay({ sessionDay: 1 }), 1);
  assert.equal(resolveSessionDay({ sessionDay: 7 }), 7);
  assert.equal(resolveSessionDay({ sessionDay: 21 }), 21);
});

test('resolveSessionDay: legacy week+day → (week-1)*7 + day (v5 7-day mapping)', () => {
  assert.equal(resolveSessionDay({ week: 1, day: 1 }), 1);
  assert.equal(resolveSessionDay({ week: 1, day: 7 }), 7);
  assert.equal(resolveSessionDay({ week: 2, day: 1 }), 8);
  assert.equal(resolveSessionDay({ week: 3, day: 7 }), 21);
});

test('resolveSessionDay: legacy strings → parseInt coercion', () => {
  assert.equal(resolveSessionDay({ week: '2', day: '3' }), 10);
});

test('resolveSessionDay: sessionDay wins over legacy when both present', () => {
  assert.equal(resolveSessionDay({ sessionDay: 14, week: 1, day: 1 }), 14);
});

test('resolveSessionDay: floors fractional sessionDay defensively', () => {
  assert.equal(resolveSessionDay({ sessionDay: 7.9 }), 7);
});

test('resolveSessionDay: missing both / invalid → null', () => {
  assert.equal(resolveSessionDay({}), null);
  assert.equal(resolveSessionDay(null), null);
  assert.equal(resolveSessionDay({ sessionDay: 0 }), null);
  assert.equal(resolveSessionDay({ sessionDay: -1 }), null);
  assert.equal(resolveSessionDay({ week: 'x', day: 'y' }), null);
  assert.equal(resolveSessionDay({ week: 0, day: 1 }), null);
});

// ─────────────────────────────────────────────────────────
// weekFromSessionDay — ceil(day/7)
// ─────────────────────────────────────────────────────────

test('weekFromSessionDay: day → week (3 weeks × 7 days)', () => {
  // Week 1
  for (let d = 1; d <= 7; d++) assert.equal(weekFromSessionDay(d), 1, `day ${d}`);
  // Week 2
  for (let d = 8; d <= 14; d++) assert.equal(weekFromSessionDay(d), 2, `day ${d}`);
  // Week 3
  for (let d = 15; d <= 21; d++) assert.equal(weekFromSessionDay(d), 3, `day ${d}`);
});

// ─────────────────────────────────────────────────────────
// 🛑 isWeekBoundary — 7 / 14 / 21 only（PR-4c：v4 day===6 廢、改 v5 邊界）
// ─────────────────────────────────────────────────────────

test('🛑 isWeekBoundary: true only on day 7 / 14 / 21', () => {
  assert.equal(isWeekBoundary(7), true);
  assert.equal(isWeekBoundary(14), true);
  assert.equal(isWeekBoundary(21), true);
});

test('🛑 isWeekBoundary: every other day in 1-21 → false', () => {
  for (const d of [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20]) {
    assert.equal(isWeekBoundary(d), false, `day ${d} should NOT be a week boundary`);
  }
});

test('🛑 isWeekBoundary: day 6 (v4 boundary) is NOT a v5 boundary', () => {
  assert.equal(isWeekBoundary(6), false,
    'v4.0 used day===6 as the week boundary; PR-4c moved to 7/14/21');
});

// ─────────────────────────────────────────────────────────
// isGraduationDay — only day 21
// ─────────────────────────────────────────────────────────

test('isGraduationDay: true only at day 21', () => {
  assert.equal(isGraduationDay(21), true);
  for (const d of [1, 7, 14, 20, 22]) {
    assert.equal(isGraduationDay(d), false, `day ${d} should not be graduation`);
  }
});
