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

// ═══════════════════════════════════════════════════════════════
// 🛑 6/8 Vivi (A006 unlock放行) — in-progress 次日 session 不再鎖死.
// ═══════════════════════════════════════════════════════════════

test('🛑 6/8 A006 repro: self-paced + in-progress Day 12 + sessionDayCount=11 + complete=false → 12', () => {
  // 中招 repro: self-paced 學員點開 Day 12 但沒講話 → 留 in-progress 空殼.
  // 原本: complete=false → self-paced +1 不觸發 → 回 floored=11 → Day 12 鎖死.
  // 修法: inProgressDay=12 → Math.max(11, 12) = 12. 學員回得去.
  assert.equal(
    computeUnlockedCurrentDay({
      pace: 'self-paced',
      sessionDayCount: 11,
      lastSessionComplete: false,
      inProgressDay: 12,
    }),
    12,
    'A006 repro: 已點開的 Day 12 不能被鎖回 Day 11',
  );
});

test('🛑 6/8 in-progress generic: 學員正在做 Day N + sessionDayCount 落後 → currentDay = N', () => {
  // 一般情境: in-progress 不只發生在「點開即離開」, 也可能 chat 中途離開.
  // 不論 sessionDayCount 落後幾天, 那個 in-progress 那天必須能回去.
  for (const day of [2, 5, 10, 15, 21]) {
    assert.equal(
      computeUnlockedCurrentDay({
        pace: 'self-paced',
        sessionDayCount: Math.max(1, day - 3),
        lastSessionComplete: false,
        inProgressDay: day,
      }),
      day,
      `in-progress Day ${day} 必須能回去, 不掉回前一天`,
    );
  }
});

test('🛑 6/8 in-progress on daily pace too (不只 self-paced)', () => {
  // Spec 沒 pace 條件 — 任何 pace 都該放行 in-progress 那天.
  assert.equal(
    computeUnlockedCurrentDay({
      pace: 'daily',
      sessionDayCount: 5,
      lastSessionComplete: false,
      gapDaysSinceLastSession: 0,
      inProgressDay: 6,
    }),
    6,
    'daily 步調的 in-progress 也要放行',
  );
});

test('🛑 6/8 inProgressDay 不會 over-unlock (取 max, 不降低 sessionDayCount-driven 解鎖)', () => {
  // Spec: 「Math.max — 不會降低原本算出的解鎖日, 只會在 in-progress 那天較大時把它放行」.
  // in-progress Day 5 但 sessionDayCount=11 → max(11, 5) = 11.
  assert.equal(
    computeUnlockedCurrentDay({
      pace: 'self-paced',
      sessionDayCount: 11,
      lastSessionComplete: false,
      inProgressDay: 5,
    }),
    11,
    'inProgressDay 較小時不會降低 sessionDayCount 給的解鎖',
  );
});

test('🛑 6/8 inProgressDay 不會 over-unlock 超過 in-progress 那天本身', () => {
  // in-progress Day 5, sessionDayCount=3 → max(3, 5) = 5 (不是 6 / 不是更高).
  assert.equal(
    computeUnlockedCurrentDay({
      pace: 'self-paced',
      sessionDayCount: 3,
      lastSessionComplete: false,
      inProgressDay: 5,
    }),
    5,
    '只放行到 in-progress 那天本身, 不會多解一天',
  );
});

test('🛑 6/8 無 in-progress (inProgressDay=0) → 行為完全不變 (回歸所有既有 case)', () => {
  // 新學員 (sessionDayCount=0) → 1.
  assert.equal(
    computeUnlockedCurrentDay({
      pace: 'daily', sessionDayCount: 0, inProgressDay: 0,
    }),
    1,
    '新學員 unchanged',
  );
  // self-paced 完成 +1.
  assert.equal(
    computeUnlockedCurrentDay({
      pace: 'self-paced', sessionDayCount: 1, lastSessionComplete: true, inProgressDay: 0,
    }),
    2,
    'self-paced 完成 +1 unchanged',
  );
  // daily 隔日 +1.
  assert.equal(
    computeUnlockedCurrentDay({
      pace: 'daily', sessionDayCount: 1, lastSessionComplete: true,
      gapDaysSinceLastSession: 1, inProgressDay: 0,
    }),
    2,
    'daily 隔日 +1 unchanged',
  );
  // daily 同日不 +1.
  assert.equal(
    computeUnlockedCurrentDay({
      pace: 'daily', sessionDayCount: 3, lastSessionComplete: true,
      gapDaysSinceLastSession: 0, inProgressDay: 0,
    }),
    3,
    'daily 同日不 +1 unchanged',
  );
  // self-paced in-progress (舊行為: 卡 sessionDayCount) — 現 inProgressDay=0 表示沒帶 in-progress.
  assert.equal(
    computeUnlockedCurrentDay({
      pace: 'self-paced', sessionDayCount: 3, lastSessionComplete: false, inProgressDay: 0,
    }),
    3,
    '沒帶 inProgressDay 時不受新邏輯影響 (回歸)',
  );
});

test('🛑 6/8 inProgressDay clamp [0, 21]', () => {
  // 負值 → 0; >21 → 21 (但實際也不可能, sessions.day CHECK in [1,21]).
  assert.equal(
    computeUnlockedCurrentDay({
      pace: 'self-paced', sessionDayCount: 1, lastSessionComplete: false, inProgressDay: -5,
    }),
    1,
    '負 inProgressDay → 視為 0',
  );
  assert.equal(
    computeUnlockedCurrentDay({
      pace: 'self-paced', sessionDayCount: 1, lastSessionComplete: false, inProgressDay: 99,
    }),
    21,
    'inProgressDay > 21 → clamp 到 21',
  );
});

test('🛑 6/8 inProgressDay 非 finite (NaN / undefined / null) → 視為 0', () => {
  for (const bad of [NaN, undefined, null, 'foo']) {
    assert.equal(
      computeUnlockedCurrentDay({
        pace: 'self-paced', sessionDayCount: 3, lastSessionComplete: false, inProgressDay: bad,
      }),
      3,
      `inProgressDay=${String(bad)} 必須 fallback 到 0 (不改變既有結果)`,
    );
  }
});

test('🛑 6/8 complete=true + inProgressDay 同時存在 (defensive — 不該發生, 但驗 Math.max)', () => {
  // 邏輯上不可能: 最後一個 session 同時 complete=true 且 in-progress.
  // 但若被誤傳, Math.max 仍給 sensible 結果 — 取兩者大者.
  // self-paced 完成 + sessionDayCount=5 → result=6; inProgressDay=4 → max(6,4)=6.
  assert.equal(
    computeUnlockedCurrentDay({
      pace: 'self-paced', sessionDayCount: 5, lastSessionComplete: true, inProgressDay: 4,
    }),
    6,
    'complete-advance 結果 (6) 大於 inProgressDay (4) → 取 6',
  );
  // 反向: inProgressDay=8 較大 (邏輯不可能, 但守住).
  assert.equal(
    computeUnlockedCurrentDay({
      pace: 'self-paced', sessionDayCount: 5, lastSessionComplete: true, inProgressDay: 8,
    }),
    8,
  );
});

test('🛑 6/8 inProgressDay Day 21 → 21 (final day in-progress)', () => {
  // 結業日 Day 21 點開沒完成 → 仍解鎖 Day 21 (cap 21, 不會 +1).
  assert.equal(
    computeUnlockedCurrentDay({
      pace: 'self-paced', sessionDayCount: 20, lastSessionComplete: false, inProgressDay: 21,
    }),
    21,
  );
});
