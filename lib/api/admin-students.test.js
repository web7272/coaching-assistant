// lib/api/admin-students.test.js
// Patrick 5/29 — derived-field shape + status filter boundary lock.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  STATUS_FILTERS, AT_RISK_DAYS, ACTIVE_DAYS,
  shapeStudentRow, applyStatusFilter, parseBoolQuery,
  ACTIVE_CONTEXT_CATEGORIES, ACTIVE_CONTEXT_SHORT_LABELS,
  activeContextLabel,
} from './admin-students.js';

// ─── shape ──────────────────────────────────────────────────────

test('STATUS_FILTERS: frozen + 5 known values', () => {
  assert.ok(Object.isFrozen(STATUS_FILTERS));
  assert.deepEqual(
    [...STATUS_FILTERS].sort(),
    ['active', 'at_risk', 'blocked', 'finished', 'needs_30_day_notice'],
  );
});

test('AT_RISK_DAYS = 14, ACTIVE_DAYS = 7 (spec constants)', () => {
  assert.equal(AT_RISK_DAYS, 14);
  assert.equal(ACTIVE_DAYS,  7);
});

// ─── v5.2 active_context enum (Vivi 6/5 + spec §1.3) ─────────────

test('🛑 v5.2 ACTIVE_CONTEXT_CATEGORIES: 5 enum entries (1-5) frozen', () => {
  assert.ok(Object.isFrozen(ACTIVE_CONTEXT_CATEGORIES));
  assert.deepEqual(Object.keys(ACTIVE_CONTEXT_CATEGORIES).map(Number).sort((a, b) => a - b),
    [1, 2, 3, 4, 5]);
  // Spec §1.3 verbatim — code + label.
  assert.equal(ACTIVE_CONTEXT_CATEGORIES[1].code,  'career_work_money');
  assert.equal(ACTIVE_CONTEXT_CATEGORIES[2].code,  'intimate_relationship');
  assert.equal(ACTIVE_CONTEXT_CATEGORIES[3].code,  'family');
  assert.equal(ACTIVE_CONTEXT_CATEGORIES[4].code,  'health');
  assert.equal(ACTIVE_CONTEXT_CATEGORIES[5].code,  'self_internal');
  assert.match(ACTIVE_CONTEXT_CATEGORIES[1].label, /事業/);
});

test('🛑 v5.2 ACTIVE_CONTEXT_SHORT_LABELS: pill 短字 1-5', () => {
  assert.deepEqual(ACTIVE_CONTEXT_SHORT_LABELS, Object.freeze({
    1: '事業', 2: '親密關係', 3: '家庭', 4: '健康', 5: '自我',
  }));
});

test('🛑 v5.2 activeContextLabel: 1-5 returns short labels, invalid → 事業', () => {
  assert.equal(activeContextLabel(1), '事業');
  assert.equal(activeContextLabel(2), '親密關係');
  assert.equal(activeContextLabel(3), '家庭');
  assert.equal(activeContextLabel(4), '健康');
  assert.equal(activeContextLabel(5), '自我');
  // Default fallback for invalid (per Vivi 6/5: all migrate to 事業).
  for (const bad of [0, 6, null, undefined, 'x', NaN]) {
    assert.equal(activeContextLabel(bad), '事業', `${bad} → 事業 fallback`);
  }
});

// ─── shapeStudentRow ────────────────────────────────────────────

const baseRow = {
  student_id: 'A003',
  email: 'vivi@example.com',
  preferred_name: 'Vivi',
  pace: 'daily',
  is_beta: true,
  is_blocked: false,
  created_at: '2026-05-20T14:23:11+08:00',
  days_since_register: 9,
  last_unlocked_day: 5,
  last_session_at: '2026-05-29T09:55:12+08:00',
  days_since_last_session: 0,
  finished_21: false,
  finished_at: null,
};

test('🛑 shapeStudentRow: spec-shape exact fields (frozen contract, v5.2 +4 active_context_*)', () => {
  const s = shapeStudentRow(baseRow);
  assert.deepEqual(Object.keys(s).sort(), [
    // v5.0/v5.1 fields
    'created_at', 'days_remaining_in_beta_window', 'days_since_last_session',
    'days_since_register', 'email', 'finished_21', 'finished_at',
    'is_at_risk', 'is_beta', 'is_blocked', 'last_session_at',
    'last_unlocked_day', 'pace', 'preferred_name', 'student_id',
    // ⭐ v5.2 第一塊 (Vivi 6/5) — 4 new active_context_* fields
    'active_context_category', 'active_context_label',
    'active_context_name', 'active_context_definition',
  ].sort());
});

test('🛑 v5.2 shapeStudentRow: missing active_context_category → defaults to 1 (事業) + label', () => {
  // migration 029 sets DEFAULT 1; raw row with missing/undefined still returns 1 + 事業.
  const s = shapeStudentRow(baseRow);   // baseRow has no active_context_*
  assert.equal(s.active_context_category, 1);
  assert.equal(s.active_context_label, '事業');
  assert.equal(s.active_context_name, null);
  assert.equal(s.active_context_definition, null);
});

test('🛑 v5.2 shapeStudentRow: passes through category 3 / name / definition', () => {
  const s = shapeStudentRow({
    ...baseRow,
    active_context_category: 3,
    active_context_name: '我跟先生的溝通',
    active_context_definition: '主要是日常溝通、不含原生家庭',
  });
  assert.equal(s.active_context_category, 3);
  assert.equal(s.active_context_label, '家庭');
  assert.equal(s.active_context_name, '我跟先生的溝通');
  assert.equal(s.active_context_definition, '主要是日常溝通、不含原生家庭');
});

test('🛑 v5.2 shapeStudentRow: invalid category (0 / 6 / NaN) → fallback to 事業', () => {
  for (const bad of [0, 6, null, undefined, 'abc', 99]) {
    const s = shapeStudentRow({ ...baseRow, active_context_category: bad });
    assert.equal(s.active_context_category, 1, `${bad} should fallback to 1`);
    assert.equal(s.active_context_label, '事業');
  }
});

test('shapeStudentRow: beta + 9d → days_remaining = 21', () => {
  assert.equal(shapeStudentRow(baseRow).days_remaining_in_beta_window, 21);
});

test('shapeStudentRow: !is_beta → days_remaining null', () => {
  assert.equal(
    shapeStudentRow({ ...baseRow, is_beta: false }).days_remaining_in_beta_window,
    null,
  );
});

test('🛑 shapeStudentRow: is_at_risk = beta + !blocked + !finished + lastSeenDays>=14', () => {
  const r = shapeStudentRow({ ...baseRow, days_since_last_session: 14 });
  assert.equal(r.is_at_risk, true);
});

test('🛑 shapeStudentRow: is_at_risk false 邊界 13 天', () => {
  const r = shapeStudentRow({ ...baseRow, days_since_last_session: 13 });
  assert.equal(r.is_at_risk, false);
});

test('🛑 shapeStudentRow: is_at_risk = false 當 blocked', () => {
  const r = shapeStudentRow({ ...baseRow, days_since_last_session: 30, is_blocked: true });
  assert.equal(r.is_at_risk, false);
});

test('🛑 shapeStudentRow: is_at_risk = false 當 finished_21', () => {
  const r = shapeStudentRow({ ...baseRow, days_since_last_session: 30, finished_21: true });
  assert.equal(r.is_at_risk, false);
});

test('🛑 shapeStudentRow: is_at_risk = false 當 !is_beta', () => {
  const r = shapeStudentRow({ ...baseRow, days_since_last_session: 30, is_beta: false });
  assert.equal(r.is_at_risk, false);
});

test('🛑 shapeStudentRow: 從沒登入 (last_session_at=null) → is_at_risk=false', () => {
  // 從沒登入該由 30 天 window 處理、不算 at_risk.
  const r = shapeStudentRow({
    ...baseRow, last_session_at: null, days_since_last_session: null,
  });
  assert.equal(r.is_at_risk, false);
  assert.equal(r.days_since_last_session, null);
});

test('🛑 shapeStudentRow: days_remaining clamped to 0 (不會回負)', () => {
  const r = shapeStudentRow({ ...baseRow, days_since_register: 45 });
  assert.equal(r.days_remaining_in_beta_window, 0);
});

test('shapeStudentRow: 剛註冊 0 天 → days_remaining=30', () => {
  const r = shapeStudentRow({ ...baseRow, days_since_register: 0 });
  assert.equal(r.days_remaining_in_beta_window, 30);
});

test('🛑 shapeStudentRow: null / non-object → null (defensive)', () => {
  assert.equal(shapeStudentRow(null), null);
  assert.equal(shapeStudentRow(undefined), null);
  assert.equal(shapeStudentRow('not-an-object'), null);
});

test('🛑 shapeStudentRow: 鐵則 #2 — 絕不 echo messages / damon_note / SC 觀察 / Layer', () => {
  // Even if the raw row accidentally carries leaked fields (defense in depth),
  // shape must strip them.
  const leaky = {
    ...baseRow,
    messages: 'leak',
    damon_note: 'coach internal',
    damon_note_public: 'leak',
    sc_observation: 'leak',
    layer_3: 'leak',
    note_text: 'leak',
  };
  const r = shapeStudentRow(leaky);
  for (const banned of ['messages', 'damon_note', 'damon_note_public',
                        'sc_observation', 'layer_3', 'note_text']) {
    assert.equal(banned in r, false,
      `shape output must NOT carry forbidden coach-internal field "${banned}"`);
  }
});

// ─── applyStatusFilter ──────────────────────────────────────────

const fixture = [
  // A: needs_30_day_notice (beta + !blocked + !finished_21, 但 active)
  shapeStudentRow({ ...baseRow, student_id: 'A001', days_since_last_session: 0  }),
  // B: at_risk (beta + !blocked + !finished + 20 天沒動)
  shapeStudentRow({ ...baseRow, student_id: 'A002', days_since_last_session: 20 }),
  // C: finished_21
  shapeStudentRow({ ...baseRow, student_id: 'A003', finished_21: true, days_since_last_session: 5 }),
  // D: blocked
  shapeStudentRow({ ...baseRow, student_id: 'A004', is_blocked: true,  days_since_last_session: 10 }),
  // E: !is_beta + active
  shapeStudentRow({ ...baseRow, student_id: 'A005', is_beta: false,    days_since_last_session: 3 }),
  // F: 從沒登入過
  shapeStudentRow({ ...baseRow, student_id: 'A006',
                    last_session_at: null, days_since_last_session: null }),
];

test('🛑 applyStatusFilter: needs_30_day_notice (beta + !blocked + !finished, 含從沒登入)', () => {
  const out = applyStatusFilter(fixture, 'needs_30_day_notice');
  const ids = out.map(r => r.student_id).sort();
  assert.deepEqual(ids, ['A001', 'A002', 'A006']);
});

test('🛑 applyStatusFilter: at_risk = 14+ 天沒動 + 封測 + !blocked + !finished', () => {
  const out = applyStatusFilter(fixture, 'at_risk');
  const ids = out.map(r => r.student_id);
  assert.deepEqual(ids, ['A002']);
});

test('🛑 applyStatusFilter: finished → 只 finished_21 = true', () => {
  const out = applyStatusFilter(fixture, 'finished');
  assert.deepEqual(out.map(r => r.student_id), ['A003']);
});

test('🛑 applyStatusFilter: blocked → 只 is_blocked = true', () => {
  const out = applyStatusFilter(fixture, 'blocked');
  assert.deepEqual(out.map(r => r.student_id), ['A004']);
});

test('🛑 applyStatusFilter: active → !blocked + 7天以內有動', () => {
  const out = applyStatusFilter(fixture, 'active');
  // A001 (0d), A003 (5d) — finished_21 NOT excluded from active
  // A005 (3d, !is_beta) — !blocked, lastSeen<=7
  // A002 (20d), A004 (blocked), A006 (從沒登入) excluded
  const ids = out.map(r => r.student_id).sort();
  assert.deepEqual(ids, ['A001', 'A003', 'A005']);
});

test('applyStatusFilter: unknown / blank status → return as-is (no filter)', () => {
  assert.equal(applyStatusFilter(fixture, '').length, fixture.length);
  assert.equal(applyStatusFilter(fixture, undefined).length, fixture.length);
  assert.equal(applyStatusFilter(fixture, 'garbage').length, fixture.length);
});

test('applyStatusFilter: non-array input → []', () => {
  assert.deepEqual(applyStatusFilter(null, 'at_risk'), []);
  assert.deepEqual(applyStatusFilter('not-an-array', 'at_risk'), []);
});

// ─── parseBoolQuery ─────────────────────────────────────────────

test('parseBoolQuery: "true"/"TRUE" → true, "false"/"FALSE" → false', () => {
  assert.equal(parseBoolQuery('true'),  true);
  assert.equal(parseBoolQuery('TRUE'),  true);
  assert.equal(parseBoolQuery('false'), false);
  assert.equal(parseBoolQuery('FALSE'), false);
  assert.equal(parseBoolQuery(' true '), true);   // trim
});

test('parseBoolQuery: undefined / non-string / 不認識 → undefined (no filter)', () => {
  assert.equal(parseBoolQuery(undefined), undefined);
  assert.equal(parseBoolQuery(null),      undefined);
  assert.equal(parseBoolQuery(true),      undefined);   // non-string
  assert.equal(parseBoolQuery('yes'),     undefined);
  assert.equal(parseBoolQuery(''),        undefined);
});
