// lib/api/journey-state.test.js — pure cell-state rules per 07 §3-C

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeDailyCells, computeGraduationCell, MODULE_LABEL,
  computeUnlockedCurrentDay,
} from './journey-state.js';

// ─────────────────────────────────────────────────────────
// MODULE_LABEL — 硬傷 1
// ─────────────────────────────────────────────────────────

test('🛑 MODULE_LABEL = 看見自己 (硬傷 1: 移除「金錢事業」)', () => {
  assert.equal(MODULE_LABEL, '看見自己');
});

// ─────────────────────────────────────────────────────────
// computeDailyCells
// ─────────────────────────────────────────────────────────

test('computeDailyCells: brand-new student (currentDay=0) → all 21 cells future (pure-fn defensive)', () => {
  const cells = computeDailyCells({ currentDay: 0 });
  assert.equal(cells.length, 21);
  for (const c of cells) {
    assert.equal(c.state, 'future');
    assert.equal(c.phrase, null);
  }
});

// 🛑 PR-4c-4 preview bug regression — api/journey.js floors session_day_count to ≥1
// so a brand-new / reset student sees Day 1 active-empty (clickable) and can start.
// Without this end-to-end shape, the journey grid is 21 future cells and the
// student has no way to begin (Patrick caught in #16 preview review).
// PR-4c-green 5/24 cleanup: weeks[] assertions removed with the rest of 週報.
test('🛑 brand-new student (post-floor) — currentDay=1 → day1 active-empty + grad future', () => {
  const days  = computeDailyCells({ currentDay: 1, dailyTakeaways: [] });
  const grad  = computeGraduationCell({ currentDay: 1, exportPromptGeneratedAt: null });

  // day 1 is "today, nothing yet" → clickable into conversation
  assert.deepEqual(days[0], { day: 1, state: 'active-empty', phrase: null });
  // days 2-21 future
  for (let i = 1; i < 21; i++) assert.equal(days[i].state, 'future', `day ${i + 1}`);

  // graduation cell — pre-Day-21, no export → future
  assert.deepEqual(grad, { state: 'future' });
});

test('🛑 computeDailyCells: day < currentDay AND takeaway exists → revealed with phrase', () => {
  const cells = computeDailyCells({
    currentDay: 5,
    dailyTakeaways: [
      { day: 1, term: '可以決定' },
      { day: 2, term: '是繼承的' },
      { day: 4, term: '我不能停' },
    ],
  });
  assert.deepEqual(cells[0], { day: 1, state: 'revealed', phrase: '可以決定' });
  assert.deepEqual(cells[1], { day: 2, state: 'revealed', phrase: '是繼承的' });
  // day 3 < currentDay 5 but no takeaway → revealed with null phrase (UI handles)
  assert.deepEqual(cells[2], { day: 3, state: 'revealed', phrase: null });
  assert.deepEqual(cells[3], { day: 4, state: 'revealed', phrase: '我不能停' });
});

test('🛑 computeDailyCells: day === currentDay, NO takeaway today → active-empty', () => {
  const cells = computeDailyCells({
    currentDay: 5,
    dailyTakeaways: [{ day: 1, term: '可以決定' }],
  });
  assert.deepEqual(cells[4], { day: 5, state: 'active-empty', phrase: null });
});

test('🛑 computeDailyCells: day === currentDay, HAS takeaway (closed today) → active-filled', () => {
  const cells = computeDailyCells({
    currentDay: 5,
    dailyTakeaways: [{ day: 5, term: '被看見' }],
  });
  assert.deepEqual(cells[4], { day: 5, state: 'active-filled', phrase: '被看見' });
});

test('computeDailyCells: day > currentDay → future regardless of takeaway data', () => {
  const cells = computeDailyCells({
    currentDay: 3,
    dailyTakeaways: [{ day: 10, term: '不該存在的 term' }],  // defensive
  });
  for (let i = 3; i < 21; i++) assert.equal(cells[i].state, 'future');
  assert.equal(cells[9].phrase, null, 'future cell never carries phrase even if takeaway data leaks');
});

test('computeDailyCells: at Day 21, closed → cell 21 active-filled', () => {
  const takeaways = Array.from({ length: 21 }, (_, i) => ({ day: i + 1, term: `t${i + 1}` }));
  const cells = computeDailyCells({ currentDay: 21, dailyTakeaways: takeaways });
  for (let i = 0; i < 20; i++) {
    assert.equal(cells[i].state, 'revealed', `day ${i + 1} revealed`);
  }
  assert.equal(cells[20].state, 'active-filled');
  assert.equal(cells[20].phrase, 't21');
});

test('computeDailyCells: defensive — non-array takeaways → all empty', () => {
  const cells = computeDailyCells({ currentDay: 5, dailyTakeaways: null });
  assert.equal(cells[0].state, 'revealed');
  assert.equal(cells[0].phrase, null);
});

// computeWeeklyCells retired — PR-4c-green 5/24 cleanup. 5 phase reports
// replace the 3-bucket week structure on the journey screen (spec 09 §10).
// See lib/api/phase-state.js + lib/api/phase-state.test.js for the new lock /
// unlock rules.

// ─────────────────────────────────────────────────────────
// computeGraduationCell
// ─────────────────────────────────────────────────────────

test('computeGraduationCell: export already generated → revealed (final state)', () => {
  assert.deepEqual(
    computeGraduationCell({ currentDay: 21, exportPromptGeneratedAt: '2026-05-22T..' }),
    { state: 'revealed' },
  );
  // even if currentDay is somehow lower, exportPromptGeneratedAt trumps
  assert.deepEqual(
    computeGraduationCell({ currentDay: 20, exportPromptGeneratedAt: new Date() }),
    { state: 'revealed' },
  );
});

test('computeGraduationCell: Day 21 in progress, no export yet → active', () => {
  assert.deepEqual(
    computeGraduationCell({ currentDay: 21 }),
    { state: 'active' },
  );
  assert.deepEqual(
    computeGraduationCell({ currentDay: 21, exportPromptGeneratedAt: null }),
    { state: 'active' },
  );
});

test('computeGraduationCell: pre-Day-21 → future', () => {
  for (const d of [0, 1, 7, 14, 20]) {
    assert.deepEqual(
      computeGraduationCell({ currentDay: d }),
      { state: 'future' },
      `day ${d} should be future`,
    );
  }
});

// ─────────────────────────────────────────────────────────
// PR-4c-4e: computeUnlockedCurrentDay — pace-aware unlock
// ─────────────────────────────────────────────────────────

test('🛑 computeUnlockedCurrentDay: daily mode + same Taipei day (gapDays=0) → no auto-advance on completion', () => {
  // Day 1 just completed in daily mode AND it's still the same Taipei calendar day →
  // still on Day 1. The 隔日才解 gate is the daily 步調的本意.
  assert.equal(
    computeUnlockedCurrentDay({ pace: 'daily', sessionDayCount: 1, lastSessionComplete: true, gapDaysSinceLastSession: 0 }),
    1,
  );
  assert.equal(
    computeUnlockedCurrentDay({ pace: 'daily', sessionDayCount: 5, lastSessionComplete: true, gapDaysSinceLastSession: 0 }),
    5,
  );
  // 無 gapDays 參數 (legacy callers) → 預設 0、同上.
  assert.equal(
    computeUnlockedCurrentDay({ pace: 'daily', sessionDayCount: 1, lastSessionComplete: true }),
    1,
    'omitting gapDays defaults to 0 — same-day daily still on Day 1 (back-compat)',
  );
});

// 🛑 5/27 Patrick (封測 bug 根因 ②) — daily 對稱解鎖：走完 + 隔台北日 → +1.
test('🛑 computeUnlockedCurrentDay: daily + lastSessionComplete + gapDays>=1 → advance by 1', () => {
  // Day 1 走完 + 隔台北日回來 → journey 自己解鎖 Day 2 (進 chat 後 isNewDay 才 bump
  // session_day_count, 但 journey 是讓學員「能點」 進去的閘).
  assert.equal(
    computeUnlockedCurrentDay({ pace: 'daily', sessionDayCount: 1, lastSessionComplete: true, gapDaysSinceLastSession: 1 }),
    2,
    'daily Day 1 done + 隔日 → Day 2 unlocked',
  );
  // 多天 gap 仍只 +1 (不 skip 任何天).
  assert.equal(
    computeUnlockedCurrentDay({ pace: 'daily', sessionDayCount: 3, lastSessionComplete: true, gapDaysSinceLastSession: 5 }),
    4,
    'daily 缺席多天回來仍只解鎖下一天 (不 skip)',
  );
});

test('🛑 computeUnlockedCurrentDay: daily + lastSessionComplete=false + gapDays>=1 → NO advance', () => {
  // Day N 沒收尾、即使隔日回來仍停在 Day N (還沒走完不能前進).
  assert.equal(
    computeUnlockedCurrentDay({ pace: 'daily', sessionDayCount: 1, lastSessionComplete: false, gapDaysSinceLastSession: 1 }),
    1,
  );
  assert.equal(
    computeUnlockedCurrentDay({ pace: 'daily', sessionDayCount: 3, lastSessionComplete: false, gapDaysSinceLastSession: 7 }),
    3,
  );
});

test('🛑 computeUnlockedCurrentDay: daily does NOT advance past Day 21', () => {
  assert.equal(
    computeUnlockedCurrentDay({ pace: 'daily', sessionDayCount: 21, lastSessionComplete: true, gapDaysSinceLastSession: 1 }),
    21,
    'Day 21 是結業前最後一天、不會解鎖 Day 22',
  );
});

test('🛑 computeUnlockedCurrentDay: self-paced + last complete → advance by 1', () => {
  assert.equal(
    computeUnlockedCurrentDay({ pace: 'self-paced', sessionDayCount: 1, lastSessionComplete: true }),
    2,
    'Day 1 done → Day 2 active (self-paced same calendar day unlock)',
  );
  assert.equal(
    computeUnlockedCurrentDay({ pace: 'self-paced', sessionDayCount: 7, lastSessionComplete: true }),
    8,
  );
});

test('🛑 computeUnlockedCurrentDay: self-paced + last NOT complete → no advance', () => {
  // Day N in progress on self-paced — still on Day N, no double-jump
  assert.equal(
    computeUnlockedCurrentDay({ pace: 'self-paced', sessionDayCount: 3, lastSessionComplete: false }),
    3,
  );
});

test('🛑 computeUnlockedCurrentDay: self-paced does NOT advance past Day 21', () => {
  assert.equal(
    computeUnlockedCurrentDay({ pace: 'self-paced', sessionDayCount: 21, lastSessionComplete: true }),
    21,
    'Day 21 is the last day — graduation cell takes over, no Day 22',
  );
});

test('computeUnlockedCurrentDay: brand-new (sessionDayCount=0) → floored to 1', () => {
  assert.equal(
    computeUnlockedCurrentDay({ pace: 'daily', sessionDayCount: 0 }),
    1,
  );
  assert.equal(
    computeUnlockedCurrentDay({ pace: 'self-paced', sessionDayCount: 0 }),
    1,
    'no session yet → still Day 1 even on self-paced (no lastSessionComplete signal)',
  );
});

test('computeUnlockedCurrentDay: defaults (no args) → safe Day 1', () => {
  assert.equal(computeUnlockedCurrentDay(), 1);
  assert.equal(computeUnlockedCurrentDay({}), 1);
});

test('computeUnlockedCurrentDay: caps at 21 even for huge counts', () => {
  assert.equal(
    computeUnlockedCurrentDay({ pace: 'daily', sessionDayCount: 999 }),
    21,
  );
});
