// lib/state/state-manager.test.js
// node:test — verify SQL shape (||, jsonb_set, ON CONFLICT) without hitting Postgres.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  _setSqlClient,
  _internal,
  getState,
  updateState,
  updateStatePath,
  resetTransient,
  getUserProfile,
  updateUserProfile,
} from './state-manager.js';

// ── mock SQL tag-template client ──
function makeMockSql(rows = []) {
  const calls = [];
  const fn = (strings, ...values) => {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''),
      '',
    );
    calls.push({ strings: Array.from(strings), values, text });
    return Promise.resolve(rows);
  };
  fn.calls = calls;
  return fn;
}

beforeEach(() => {
  _setSqlClient(null);
});

// ─────────────────────────────────────────────────────────
// getState
// ─────────────────────────────────────────────────────────

test('getState selects session_state from sessions by id', async () => {
  const sql = makeMockSql([{ session_state: { current_phase: 'phase_1' } }]);
  _setSqlClient(sql);
  const got = await getState(42);
  assert.equal(sql.calls.length, 1);
  assert.match(sql.calls[0].text, /SELECT session_state FROM sessions/i);
  assert.match(sql.calls[0].text, /WHERE id = \$1/);
  assert.deepEqual(sql.calls[0].values, [42]);
  assert.deepEqual(got, { current_phase: 'phase_1' });
});

test('getState returns null when no row found', async () => {
  _setSqlClient(makeMockSql([]));
  const got = await getState(999);
  assert.equal(got, null);
});

// ─────────────────────────────────────────────────────────
// updateState (shallow || merge)
// ─────────────────────────────────────────────────────────

test('updateState uses Postgres `||` shallow merge', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await updateState(42, { current_phase: 'phase_2', router_phase: 'identity_test_routing' });

  assert.equal(sql.calls.length, 1);
  const { text, values } = sql.calls[0];
  assert.match(text, /UPDATE sessions/i);
  assert.match(text, /session_state = session_state \|\| \$1::jsonb/i);
  assert.match(text, /WHERE id = \$2/);
  // patch is JSON-stringified for ::jsonb cast
  assert.equal(values[0], JSON.stringify({ current_phase: 'phase_2', router_phase: 'identity_test_routing' }));
  assert.equal(values[1], 42);
});

test('updateState rejects non-object patch', async () => {
  _setSqlClient(makeMockSql());
  await assert.rejects(() => updateState(1, null), /plain object/);
  await assert.rejects(() => updateState(1, [1, 2]), /plain object/);
  await assert.rejects(() => updateState(1, 'x'), /plain object/);
});

// ─────────────────────────────────────────────────────────
// updateStatePath (jsonb_set nested)
// ─────────────────────────────────────────────────────────

test('updateStatePath uses jsonb_set with constructed path', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await updateStatePath(7, ['phase_progress', 'phase_3a', 'step'], 2);

  assert.equal(sql.calls.length, 1);
  const { text, values } = sql.calls[0];
  assert.match(text, /jsonb_set\(session_state, \$1::text\[\], \$2::jsonb, true\)/i);
  assert.match(text, /WHERE id = \$3/);
  assert.equal(values[0], '{phase_progress,phase_3a,step}');
  assert.equal(values[1], JSON.stringify(2));
  assert.equal(values[2], 7);
});

test('updateStatePath quotes path segments with special chars', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await updateStatePath(1, ['a-b', 'plain'], { x: 1 });

  assert.equal(sql.calls[0].values[0], '{"a-b",plain}');
});

test('updateStatePath rejects empty / non-array path', async () => {
  _setSqlClient(makeMockSql());
  await assert.rejects(() => updateStatePath(1, [], 'v'), /non-empty array/);
  await assert.rejects(() => updateStatePath(1, 'phase_progress', 'v'), /non-empty array/);
});

test('escapePathSegment: alphanumeric+underscore passes through', () => {
  assert.equal(_internal.escapePathSegment('phase_3a'), 'phase_3a');
  assert.equal(_internal.escapePathSegment('abc123'), 'abc123');
});

test('escapePathSegment: special chars get quoted', () => {
  assert.equal(_internal.escapePathSegment('a b'), '"a b"');
  assert.equal(_internal.escapePathSegment('a"b'), '"a\\"b"');
});

// ─────────────────────────────────────────────────────────
// resetTransient (alias for updateState)
// ─────────────────────────────────────────────────────────

test('resetTransient delegates to updateState with given patch', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await resetTransient(5, { cumulative_ppl_score: 0, router_phase: 'opening' });
  assert.match(sql.calls[0].text, /session_state \|\| \$1::jsonb/i);
});

// ─────────────────────────────────────────────────────────
// getUserProfile
// ─────────────────────────────────────────────────────────

test('getUserProfile selects from user_profile_evolution by student_id', async () => {
  const sql = makeMockSql([{ student_id: 'A001', anchors: [] }]);
  _setSqlClient(sql);
  const got = await getUserProfile('A001');
  assert.match(sql.calls[0].text, /FROM user_profile_evolution/i);
  assert.match(sql.calls[0].text, /WHERE student_id = \$1/);
  assert.deepEqual(sql.calls[0].values, ['A001']);
  assert.deepEqual(got, { student_id: 'A001', anchors: [] });
});

test('getUserProfile returns null when no row', async () => {
  _setSqlClient(makeMockSql([]));
  assert.equal(await getUserProfile('A999'), null);
});

// ─────────────────────────────────────────────────────────
// updateUserProfile (upsert)
// ─────────────────────────────────────────────────────────

test('updateUserProfile builds ON CONFLICT DO UPDATE upsert', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await updateUserProfile('A001', {
    anchors: ['鑽石'],
    top1_value: '自由',
    calendar_day_count: 3,
  });

  assert.equal(sql.calls.length, 1);
  const { text, values } = sql.calls[0];
  assert.match(text, /INSERT INTO user_profile_evolution/i);
  assert.match(text, /ON CONFLICT \(student_id\) DO UPDATE/i);
  // COALESCE pattern keeps existing when EXCLUDED is null
  assert.match(text, /COALESCE\(EXCLUDED\.anchors,\s*user_profile_evolution\.anchors\)/i);
  // student_id is the first bound value
  assert.equal(values[0], 'A001');
  // anchors is JSON-stringified for ::jsonb
  const anchorsIdx = values.indexOf(JSON.stringify(['鑽石']));
  assert.ok(anchorsIdx > 0, 'anchors patch should be JSON-stringified into values');
  // top1_value is a scalar TEXT
  assert.ok(values.includes('自由'), 'top1_value scalar should be in values');
  // calendar_day_count is a scalar INT
  assert.ok(values.includes(3), 'calendar_day_count scalar should be in values');
});

test('updateUserProfile sends null for unset patch keys (COALESCE keeps existing)', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await updateUserProfile('A002', { anchors: ['鑽石'] });
  // All other 15 columns should be null in the VALUES list
  const { values } = sql.calls[0];
  const nullCount = values.filter(v => v === null).length;
  assert.ok(nullCount >= 15, `expected >=15 nulls for unset cols, got ${nullCount}`);
});

test('updateUserProfile rejects bad inputs', async () => {
  _setSqlClient(makeMockSql());
  await assert.rejects(() => updateUserProfile('', {}), /student_id/);
  await assert.rejects(() => updateUserProfile('A001', null), /plain object/);
  await assert.rejects(() => updateUserProfile('A001', [1, 2]), /plain object/);
});
