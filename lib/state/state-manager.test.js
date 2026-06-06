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
  incrementUserProfileCounters,
  appendDailyTakeaway,
  setLastSessionDaySummary,
  markExportEmailed,
  appendReframeInvocationHistory,
  appendActiveContextSummary,
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

// ─────────────────────────────────────────────────────────
// incrementUserProfileCounters (atomic upsert — day-boundary counters)
// ─────────────────────────────────────────────────────────

test('incrementUserProfileCounters: new session day → +gapDays / +1 atomically', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await incrementUserProfileCounters('A001', { gapDays: 2, isNewDay: true });

  assert.equal(sql.calls.length, 1);
  const { text, values } = sql.calls[0];
  assert.match(text, /INSERT INTO user_profile_evolution/i);
  assert.match(text, /ON CONFLICT \(student_id\) DO UPDATE/i);
  // atomic increment expressed in SQL, not read-modify-write
  assert.match(text, /calendar_day_count = user_profile_evolution\.calendar_day_count \+ \$/i);
  assert.match(text, /session_day_count\s+= user_profile_evolution\.session_day_count \+ \$/i);
  assert.match(text, /last_active_date\s+= now\(\)/i);
  assert.equal(values[0], 'A001');
  // new day → calInc = gapDays = 2, sessInc = 1
  assert.ok(values.includes(2), 'calendar increment 2 should be bound');
  assert.ok(values.includes(1), 'session increment 1 should be bound');
});

test('incrementUserProfileCounters: same-day continuation → no increment, only last_active_date', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await incrementUserProfileCounters('A001', { gapDays: 5, isNewDay: false });

  const { values } = sql.calls[0];
  // isNewDay false → both increments are 0 regardless of gapDays
  const nonZero = values.filter(v => v === 5);
  assert.equal(nonZero.length, 0, 'gapDays must be ignored when not a new day');
});

test('incrementUserProfileCounters: defaults (no opts) → safe no-op increment', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await incrementUserProfileCounters('A001');
  assert.equal(sql.calls.length, 1);
});

test('incrementUserProfileCounters: rejects empty student_id', async () => {
  _setSqlClient(makeMockSql());
  await assert.rejects(() => incrementUserProfileCounters('', { isNewDay: true }), /student_id/);
});

// ─────────────────────────────────────────────────────────
// PR-4c-2: appendDailyTakeaway — atomic dedup-by-day JSONB array upsert
// ─────────────────────────────────────────────────────────

test('appendDailyTakeaway: ON CONFLICT dedup-by-day + sort by day ASC', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await appendDailyTakeaway('A001', { day: 7, term: '可以決定' });

  assert.equal(sql.calls.length, 1);
  const { text, values } = sql.calls[0];
  assert.match(text, /INSERT INTO user_profile_evolution/i);
  assert.match(text, /ON CONFLICT \(student_id\) DO UPDATE/i);
  assert.match(text, /jsonb_array_elements/i,
    'must use jsonb_array_elements to dedup the existing array');
  assert.match(text, /WHERE \(e->>'day'\)::int <>/i,
    'must filter out the same day before re-appending');
  assert.match(text, /jsonb_agg\(e ORDER BY \(e->>'day'\)::int\)/i,
    'must keep array sorted by day ASC');
  assert.equal(values[0], 'A001');
  assert.equal(values[1], JSON.stringify([{ day: 7, term: '可以決定' }]));
  // day + term occur in the UPDATE branch jsonb_build_object too
  assert.ok(values.includes(7),     'day 7 bound somewhere in UPDATE branch');
  assert.ok(values.includes('可以決定'), 'term bound in UPDATE branch');
});

test('appendDailyTakeaway: rejects bad inputs (clear errors before SQL)', async () => {
  _setSqlClient(makeMockSql());
  await assert.rejects(() => appendDailyTakeaway('', { day: 1, term: 'x' }), /student_id/);
  await assert.rejects(() => appendDailyTakeaway('A001', { term: 'x' }), /day/);
  await assert.rejects(() => appendDailyTakeaway('A001', { day: 0, term: 'x' }), /day/);
  await assert.rejects(() => appendDailyTakeaway('A001', { day: 1, term: '' }), /term/);
  await assert.rejects(() => appendDailyTakeaway('A001', { day: 1 }), /term/);
});

// ─────────────────────────────────────────────────────────
// PR-4c-2: setLastSessionDaySummary — JSONB shallow merge
// ─────────────────────────────────────────────────────────

test('setLastSessionDaySummary: || merges keys, preserves existing', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await setLastSessionDaySummary('A001', {
    graduation: { coach_letter: '...', declaration: '我是一個可以決定的人。' },
  });

  const { text, values } = sql.calls[0];
  assert.match(text, /INSERT INTO user_profile_evolution/i);
  assert.match(text, /ON CONFLICT \(student_id\) DO UPDATE/i);
  assert.match(text,
    /COALESCE\(user_profile_evolution\.last_session_day_summary, '\{\}'::jsonb\) \|\|/i,
    'must use || merge against COALESCE-defaulted existing summary');
  assert.equal(values[0], 'A001');
  const payload = JSON.parse(values[1]);
  assert.deepEqual(payload, {
    graduation: { coach_letter: '...', declaration: '我是一個可以決定的人。' },
  });
});

test('setLastSessionDaySummary: rejects bad inputs', async () => {
  _setSqlClient(makeMockSql());
  await assert.rejects(() => setLastSessionDaySummary('', {}), /student_id/);
  await assert.rejects(() => setLastSessionDaySummary('A001', null), /plain object/);
  await assert.rejects(() => setLastSessionDaySummary('A001', [1, 2]), /plain object/);
});

// ─────────────────────────────────────────────────────────
// PR-4c-2: markExportEmailed — set export_prompt_generated_at = now()
// ─────────────────────────────────────────────────────────

test('markExportEmailed: stamps now() on the user_profile row (upsert)', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await markExportEmailed('A001');

  const { text, values } = sql.calls[0];
  assert.match(text, /INSERT INTO user_profile_evolution/i);
  assert.match(text, /export_prompt_generated_at\s*=\s*now\(\)/i);
  assert.match(text, /ON CONFLICT \(student_id\) DO UPDATE/i);
  assert.equal(values[0], 'A001');
});

test('markExportEmailed: rejects empty student_id', async () => {
  _setSqlClient(makeMockSql());
  await assert.rejects(() => markExportEmailed(''), /student_id/);
});

// ─────────────────────────────────────────────────────────
// v5.1 Step 5c: appendReframeInvocationHistory — cross-session JSONB append
// ─────────────────────────────────────────────────────────

test('appendReframeInvocationHistory: ON CONFLICT append + COALESCE bootstrap', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await appendReframeInvocationHistory('A001', {
    reframe_id: 'R2', invoked_at_turn: 8, session_id: 42,
    outcome: 'success', anchor_phrase_if_success: '我是溫暖的',
    invoked_at: '2026-06-05T00:00:00Z',
  });

  assert.equal(sql.calls.length, 1);
  const { text, values } = sql.calls[0];
  assert.match(text, /INSERT INTO user_profile_evolution/i);
  assert.match(text, /reframe_invocation_history/i);
  assert.match(text, /ON CONFLICT \(student_id\) DO UPDATE/i);
  assert.match(text,
    /COALESCE\(user_profile_evolution\.reframe_invocation_history, '\[\]'::jsonb\)\s*\|\|/i,
    'must append to existing array via || (COALESCE-defaulted)');
  assert.equal(values[0], 'A001');
  const payload = JSON.parse(values[1]);
  assert.equal(payload.length, 1);
  assert.equal(payload[0].reframe_id, 'R2');
  assert.equal(payload[0].outcome, 'success');
});

test('appendReframeInvocationHistory: rejects bad inputs', async () => {
  _setSqlClient(makeMockSql());
  await assert.rejects(() => appendReframeInvocationHistory('', { reframe_id: 'R1' }), /student_id/);
  await assert.rejects(() => appendReframeInvocationHistory('A001', null), /plain object/);
  await assert.rejects(() => appendReframeInvocationHistory('A001', { reframe_id: 'X' }), /R1-R7/);
  await assert.rejects(() => appendReframeInvocationHistory('A001', { reframe_id: 'R8' }), /R1-R7/);
});

test('appendReframeInvocationHistory: fail-open when migration 027 not applied', async () => {
  // Simulate column-missing error from Postgres.
  const sql = () => Promise.reject(new Error('column "reframe_invocation_history" does not exist'));
  sql.calls = [];
  _setSqlClient(sql);
  // Should NOT throw — fail-open per repo pattern.
  await assert.doesNotReject(() =>
    appendReframeInvocationHistory('A001', {
      reframe_id: 'R1', invoked_at_turn: 1, session_id: 1,
      outcome: 'success', invoked_at: '2026-06-05T00:00:00Z',
    })
  );
});

test('appendReframeInvocationHistory: re-throws non-migration errors', async () => {
  const sql = () => Promise.reject(new Error('connection refused'));
  sql.calls = [];
  _setSqlClient(sql);
  await assert.rejects(() =>
    appendReframeInvocationHistory('A001', {
      reframe_id: 'R1', invoked_at_turn: 1, session_id: 1,
      outcome: 'success', invoked_at: '2026-06-05T00:00:00Z',
    }), /connection refused/);
});

// ─────────────────────────────────────────────────────────
// ⭐ v5.2 第三塊 PR-a: appendActiveContextSummary — per-category JSONB
// ─────────────────────────────────────────────────────────

test('🛑 v5.2 appendActiveContextSummary: ON CONFLICT jsonb_set per-category bucket', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await appendActiveContextSummary('A006', 2, {
    day: 1, value: '被愛', example: '昨天先生陪我',
  });
  assert.equal(sql.calls.length, 1);
  const { text, values } = sql.calls[0];
  // Must use jsonb_set with category key + ON CONFLICT semantics.
  assert.match(text, /INSERT INTO user_profile_evolution/i);
  assert.match(text, /ON CONFLICT \(student_id\) DO UPDATE/i);
  assert.match(text, /jsonb_set/i);
  assert.match(text, /surfaced_values/);
  assert.match(text, /surfaced_examples/);
  assert.match(text, /last_updated_day/);
  // Category key bound as string '2' (jsonb_set path).
  assert.ok(values.includes('2'), `expected category '2' in values. saw: ${JSON.stringify(values)}`);
  // Student id + day + value + example bound.
  assert.equal(values[0], 'A006');
  assert.ok(values.includes(1) || values.includes('1'),
    'day=1 should appear in values');
  assert.ok(values.includes('被愛'));
  assert.ok(values.includes('昨天先生陪我'));
});

test('🛑 v5.2 appendActiveContextSummary: value-only (no example) still appends', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await appendActiveContextSummary('A006', 3, { day: 2, value: '自由' });
  assert.equal(sql.calls.length, 1);
  assert.ok(sql.calls[0].values.includes('自由'));
});

test('🛑 v5.2 appendActiveContextSummary: example-only (no value) still appends', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await appendActiveContextSummary('A006', 4, { day: 3, example: '今天運動好爽' });
  assert.equal(sql.calls.length, 1);
  assert.ok(sql.calls[0].values.includes('今天運動好爽'));
});

test('🛑 v5.2 appendActiveContextSummary: both value+example missing → no SQL (no-op)', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await appendActiveContextSummary('A006', 1, { day: 5 });
  assert.equal(sql.calls.length, 0, 'no value + no example → no append');
});

test('🛑 v5.2 appendActiveContextSummary: rejects bad inputs', async () => {
  _setSqlClient(makeMockSql());
  await assert.rejects(() => appendActiveContextSummary('', 1, { day: 1, value: 'x' }), /student_id/);
  await assert.rejects(() => appendActiveContextSummary('A006', 0, { day: 1, value: 'x' }), /category/);
  await assert.rejects(() => appendActiveContextSummary('A006', 6, { day: 1, value: 'x' }), /category/);
  await assert.rejects(() => appendActiveContextSummary('A006', 1, { day: 0, value: 'x' }), /day/);
  await assert.rejects(() => appendActiveContextSummary('A006', 1, { value: 'x' }), /day/);
});

test('🛑 v5.2 appendActiveContextSummary: fail-open when migration 030 not applied', async () => {
  const sql = () => Promise.reject(new Error('column "active_context_session_summary" does not exist'));
  sql.calls = [];
  _setSqlClient(sql);
  // Should NOT throw — fail-soft per repo pattern.
  await assert.doesNotReject(() =>
    appendActiveContextSummary('A006', 2, { day: 1, value: '被愛', example: '...' })
  );
});

test('🛑 v5.2 appendActiveContextSummary: re-throws non-migration errors', async () => {
  const sql = () => Promise.reject(new Error('connection refused'));
  sql.calls = [];
  _setSqlClient(sql);
  await assert.rejects(() =>
    appendActiveContextSummary('A006', 2, { day: 1, value: '被愛' }),
    /connection refused/,
  );
});

test('🛑 v5.2 appendActiveContextSummary: trims value/example before storing', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  await appendActiveContextSummary('A006', 3, {
    day: 1, value: '  被愛  ', example: '  日常溝通  ',
  });
  assert.ok(sql.calls[0].values.includes('被愛'));
  assert.ok(sql.calls[0].values.includes('日常溝通'));
});

test('🛑 v5.2 appendActiveContextSummary: example truncated to 200 chars (defensive)', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  const long = 'x'.repeat(300);
  await appendActiveContextSummary('A006', 1, { day: 1, example: long });
  const stored = sql.calls[0].values.find(v => typeof v === 'string' && v.startsWith('x'));
  assert.equal(stored.length, 200, 'example truncated at 200 chars (inject layer further trims to 100)');
});
