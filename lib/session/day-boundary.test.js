// lib/session/day-boundary.test.js
// 守則 2 最關鍵 regression：reset patch 絕對不含 phase progress 7 欄位。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  RESET_FIELDS,
  PHASE_PROGRESS_NEVER_RESET,
  ERRATA_NOW_RESET,
  calcCalendarDayDiff,
  detectNewSessionDay,
  buildResetPatch,
} from './day-boundary.js';

// ─────────────────────────────────────────────────────────
// ⭐ regression：phase progress 7 欄位絕不在 reset patch
// ─────────────────────────────────────────────────────────

test('🛑 buildResetPatch does NOT include any phase progress field', () => {
  const patch = buildResetPatch();
  for (const forbidden of PHASE_PROGRESS_NEVER_RESET) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(patch, forbidden),
      false,
      `phase progress field "${forbidden}" must NOT appear in reset patch — would erase 學員努力產出的進度`,
    );
  }
});

test('🛑 RESET_FIELDS constant does NOT include any phase progress field', () => {
  for (const forbidden of PHASE_PROGRESS_NEVER_RESET) {
    assert.equal(
      Object.prototype.hasOwnProperty.call(RESET_FIELDS, forbidden),
      false,
      `RESET_FIELDS leaks phase progress field "${forbidden}"`,
    );
  }
});

// ─────────────────────────────────────────────────────────
// errata 三欄位（5/21）必須在 reset patch
// ─────────────────────────────────────────────────────────

test('errata 5/21: current_quality_status / router_phase / elicitation_mode_active are reset', () => {
  const patch = buildResetPatch();
  for (const f of ERRATA_NOW_RESET) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(patch, f),
      `errata 5/21: ${f} must be in reset patch`,
    );
  }
  // Specific reset values
  assert.equal(patch.current_quality_status, 'none', 'current_quality_status resets to "none"');
  assert.equal(patch.router_phase, 'opening', 'router_phase resets to "opening"');
  assert.equal(
    patch.elicitation_mode_active, true,
    'elicitation_mode_active resets to TRUE (re-enter elicitation Day N+1)',
  );
});

// ─────────────────────────────────────────────────────────
// reset patch 完整性（22 欄位、按 migration 014 §3 + Q1 patch 5/21）
// ⚠️ Q1 patch：mid_session_takeaway_count 已移出 RESET_FIELDS
//    （phase-scoped、reset_on phase exit、不是 new_session_day）→ 23→22
// ─────────────────────────────────────────────────────────

test('RESET_FIELDS contains exactly 22 transient fields per migration 014 §3 + Q1 patch', () => {
  const expected = [
    // Engine 1 (8)
    'cumulative_ppl_score', 'consecutive_short_responses',
    'consecutive_offtopic_turns', 'consecutive_vague_turns',
    'recent_specific_examples_count', 'bypassing_layer_progress',
    'requires_typing_active', 'handoff_triggered_count',
    // Engine 2 errata (3)
    'current_quality_status', 'current_quality_candidate_term', 'identity_test_evidence_count',
    // Engine 3 errata (5)
    'router_phase', 'cascade_down_progress', 'deep_signal_flags',
    'opening_branch_handled', 'elicitation_mode_active',
    // Engine 4 (2)
    'opening_reference_variant_used', 'takeaway_seeded_this_session',
    // Dashboard (4)
    'amnesia_signal_this_session', 'e1c_trigger_count_this_session',
    'turn_count_this_session', 'hard_limit_hit_this_session',
  ];
  const actual = Object.keys(RESET_FIELDS).sort();
  assert.deepEqual(actual, expected.sort(), 'RESET_FIELDS keys mismatch with spec §3');
  assert.equal(actual.length, 22);
});

test('🛑 Q1 patch: mid_session_takeaway_count moved OUT of RESET_FIELDS', () => {
  // phase-scoped 欄位、跨 day 保留、只在 phase-advance.js phaseEntryPatch 時 reset。
  assert.equal(
    Object.prototype.hasOwnProperty.call(RESET_FIELDS, 'mid_session_takeaway_count'),
    false,
    'mid_session_takeaway_count must NOT be cross-day reset (Q1 patch 5/21)',
  );
  assert.ok(
    PHASE_PROGRESS_NEVER_RESET.includes('mid_session_takeaway_count'),
    'mid_session_takeaway_count must be in PHASE_PROGRESS_NEVER_RESET',
  );
});

test('PHASE_PROGRESS_NEVER_RESET contains exactly 7 phase-scoped fields', () => {
  const expected = [
    'current_phase', 'phase_progress', 'integration_retention_mode_active',
    'build_vision_progress', 'self_concept_progress', 'counter_examples_list',
    'mid_session_takeaway_count',
  ];
  assert.deepEqual([...PHASE_PROGRESS_NEVER_RESET].sort(), expected.sort());
  assert.equal(PHASE_PROGRESS_NEVER_RESET.length, 7);
});

test('RESET_FIELDS is frozen (defensive: cannot be mutated)', () => {
  assert.ok(Object.isFrozen(RESET_FIELDS));
});

test('buildResetPatch returns a fresh object each call (no aliasing const)', () => {
  const a = buildResetPatch();
  const b = buildResetPatch();
  assert.notEqual(a, b, 'patches should be distinct objects');
  a.cumulative_ppl_score = 999;
  assert.equal(b.cumulative_ppl_score, 0, 'mutation of one patch must not leak to next');
  // Nested object isolation
  a.deep_signal_flags.tampered = true;
  assert.equal(b.deep_signal_flags.tampered, undefined, 'nested object mutation must not leak');
  // deep_signal_flags retains its explicit init shape (5/21 Patrick decision)
  assert.deepEqual(b.deep_signal_flags, {
    worth_fiction_detected:  false,
    trauma_marker_detected:  false,
    parts_resistance_detected: false,
    depth_judgment_score:    0,
  });
});

test('deep_signal_flags initial value uses explicit shape (5/21 errata, no { })', () => {
  const patch = buildResetPatch();
  assert.deepEqual(patch.deep_signal_flags, {
    worth_fiction_detected:  false,
    trauma_marker_detected:  false,
    parts_resistance_detected: false,
    depth_judgment_score:    0,
  }, 'consumer should not need to default-handle missing keys');
});

// ─────────────────────────────────────────────────────────
// calcCalendarDayDiff (UTC midnight math)
// ─────────────────────────────────────────────────────────

test('calcCalendarDayDiff: same calendar day → 0 regardless of time', () => {
  const a = new Date(Date.UTC(2026, 4, 20, 0, 1, 0));
  const b = new Date(Date.UTC(2026, 4, 20, 23, 59, 59));
  assert.equal(calcCalendarDayDiff(a, b), 0);
});

test('calcCalendarDayDiff: 1 calendar day later → 1', () => {
  const a = new Date(Date.UTC(2026, 4, 20, 23, 0, 0));
  const b = new Date(Date.UTC(2026, 4, 21, 0, 1, 0));
  assert.equal(calcCalendarDayDiff(a, b), 1);
});

test('calcCalendarDayDiff: 7-day gap', () => {
  const a = new Date(Date.UTC(2026, 4, 14));
  const b = new Date(Date.UTC(2026, 4, 21));
  assert.equal(calcCalendarDayDiff(a, b), 7);
});

test('calcCalendarDayDiff: backwards (later, earlier) is negative', () => {
  const a = new Date(Date.UTC(2026, 4, 21));
  const b = new Date(Date.UTC(2026, 4, 20));
  assert.equal(calcCalendarDayDiff(a, b), -1);
});

test('calcCalendarDayDiff rejects non-Date inputs', () => {
  assert.throws(() => calcCalendarDayDiff('2026-05-20', new Date()), TypeError);
  assert.throws(() => calcCalendarDayDiff(new Date(), 12345), TypeError);
});

// ─────────────────────────────────────────────────────────
// detectNewSessionDay
// ─────────────────────────────────────────────────────────

test('detectNewSessionDay: no last_active_date → is_new_day:true, gap_days:0', () => {
  const r = detectNewSessionDay({}, new Date());
  assert.deepEqual(r, { is_new_day: true, gap_days: 0 });
});

test('detectNewSessionDay: same day → is_new_day:false', () => {
  const last = new Date(Date.UTC(2026, 4, 20, 9, 0, 0));
  const now = new Date(Date.UTC(2026, 4, 20, 22, 0, 0));
  const r = detectNewSessionDay({ last_active_date: last }, now);
  assert.equal(r.is_new_day, false);
  assert.equal(r.gap_days, 0);
});

test('detectNewSessionDay: next day → is_new_day:true, gap_days:1', () => {
  const last = new Date(Date.UTC(2026, 4, 20, 23, 0, 0));
  const now = new Date(Date.UTC(2026, 4, 21, 9, 0, 0));
  const r = detectNewSessionDay({ last_active_date: last }, now);
  assert.equal(r.is_new_day, true);
  assert.equal(r.gap_days, 1);
});

test('detectNewSessionDay: 3-day gap (學員缺席)', () => {
  const last = new Date(Date.UTC(2026, 4, 18));
  const now = new Date(Date.UTC(2026, 4, 21));
  const r = detectNewSessionDay({ last_active_date: last }, now);
  assert.equal(r.is_new_day, true);
  assert.equal(r.gap_days, 3);
});

test('detectNewSessionDay: accepts ISO string', () => {
  const r = detectNewSessionDay(
    { last_active_date: '2026-05-20T00:00:00.000Z' },
    new Date(Date.UTC(2026, 4, 21)),
  );
  assert.equal(r.is_new_day, true);
  assert.equal(r.gap_days, 1);
});

test('detectNewSessionDay: invalid last_active_date throws', () => {
  assert.throws(
    () => detectNewSessionDay({ last_active_date: 'not-a-date' }, new Date()),
    TypeError,
  );
});

test('detectNewSessionDay: now must be Date', () => {
  assert.throws(
    () => detectNewSessionDay({}, '2026-05-21'),
    TypeError,
  );
});
