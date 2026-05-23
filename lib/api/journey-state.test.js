// lib/api/journey-state.test.js — pure cell-state rules per 07 §3-C

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  computeDailyCells, computeWeeklyCells, computeGraduationCell, MODULE_LABEL,
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
test('🛑 brand-new student (post-floor) — currentDay=1 → day1 active-empty + W1 active + grad future', () => {
  const days  = computeDailyCells({ currentDay: 1, dailyTakeaways: [] });
  const weeks = computeWeeklyCells({ currentDay: 1, weeksWithSummary: [] });
  const grad  = computeGraduationCell({ currentDay: 1, exportPromptGeneratedAt: null });

  // day 1 is "today, nothing yet" → clickable into conversation
  assert.deepEqual(days[0], { day: 1, state: 'active-empty', phrase: null });
  // days 2-21 future
  for (let i = 1; i < 21; i++) assert.equal(days[i].state, 'future', `day ${i + 1}`);

  // week 1 in progress; weeks 2/3 not yet
  assert.equal(weeks[0].state, 'active');
  assert.equal(weeks[1].state, 'future');
  assert.equal(weeks[2].state, 'future');

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

// ─────────────────────────────────────────────────────────
// computeWeeklyCells
// ─────────────────────────────────────────────────────────

test('computeWeeklyCells: brand-new (currentDay=0) → all 3 weeks future', () => {
  const cells = computeWeeklyCells({ currentDay: 0 });
  assert.equal(cells.length, 3);
  for (const c of cells) assert.equal(c.state, 'future');
});

test('🛑 computeWeeklyCells: day 1-7 → week 1 active, week 2/3 future', () => {
  for (const d of [1, 3, 7]) {
    const cells = computeWeeklyCells({ currentDay: d });
    assert.equal(cells[0].state, 'active', `day ${d}: week 1 active`);
    assert.equal(cells[1].state, 'future');
    assert.equal(cells[2].state, 'future');
  }
});

test('🛑 computeWeeklyCells: past week with summary → revealed', () => {
  // currentDay=10 (week 2), week 1 already past + summary exists
  const cells = computeWeeklyCells({ currentDay: 10, weeksWithSummary: [1] });
  assert.equal(cells[0].state, 'revealed');
  assert.equal(cells[1].state, 'active');
  assert.equal(cells[2].state, 'future');
});

test('computeWeeklyCells: past week WITHOUT summary → future (strict per 07 §3-C 3-bucket rule)', () => {
  // currentDay=10 (week 2), week 1 past but no summary (e.g. Day 7 generateWeekSummary
  // failed fail-soft). Spec has only 3 states {revealed, active, future} and ties
  // revealed↔summary exists. Past-no-summary falls into the "未到 → future" residual
  // bucket — surfaces as a faint, non-clickable cell visually equivalent to "yet to come".
  // Edge case: only happens when Day 7/14 finalize-day silently failed.
  const cells = computeWeeklyCells({ currentDay: 10, weeksWithSummary: [] });
  assert.equal(cells[0].state, 'future',
    'past-no-summary maps to future per strict 07 §3-C — flag if you want different fallback');
});

test('computeWeeklyCells: at Day 21 with both summaries → both revealed, week 3 active', () => {
  const cells = computeWeeklyCells({ currentDay: 21, weeksWithSummary: new Set([1, 2]) });
  assert.equal(cells[0].state, 'revealed');
  assert.equal(cells[1].state, 'revealed');
  assert.equal(cells[2].state, 'active');
});

test('computeWeeklyCells: accepts both array and Set for weeksWithSummary', () => {
  const a = computeWeeklyCells({ currentDay: 10, weeksWithSummary: [1] });
  const b = computeWeeklyCells({ currentDay: 10, weeksWithSummary: new Set([1]) });
  assert.deepEqual(a, b);
});

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
