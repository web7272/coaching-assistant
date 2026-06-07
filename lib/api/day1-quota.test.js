// lib/api/day1-quota.test.js — Patrick 6/7 funnel-precise gate.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DAY1_QUOTA,
  getQuota, countUsedThisMonth, isExistingStudent,
  decideDay1Gate, addToWaitlist,
} from './day1-quota.js';

// ─── getQuota ───────────────────────────────────────────────────────

beforeEach(() => { delete process.env.DAY1_QUOTA; });

test('🛑 6/7 getQuota: env unset → DEFAULT_DAY1_QUOTA (100)', () => {
  assert.equal(getQuota(), DEFAULT_DAY1_QUOTA);
  assert.equal(DEFAULT_DAY1_QUOTA, 100);
});

test('🛑 6/7 getQuota: DAY1_QUOTA="50" → 50', () => {
  process.env.DAY1_QUOTA = '50';
  assert.equal(getQuota(), 50);
});

test('🛑 6/7 getQuota: DAY1_QUOTA="0" → 0 (allows hard-stop testing)', () => {
  process.env.DAY1_QUOTA = '0';
  assert.equal(getQuota(), 0);
});

test('🛑 6/7 getQuota: malformed / negative → fall back to default', () => {
  for (const bad of ['foo', '-5', '', 'NaN']) {
    process.env.DAY1_QUOTA = bad;
    assert.equal(getQuota(), DEFAULT_DAY1_QUOTA, `bad="${bad}" should fall back`);
  }
});

test('🛑 6/7 getQuota: floats truncated', () => {
  process.env.DAY1_QUOTA = '100.7';
  assert.equal(getQuota(), 100);
});

// ─── Mock sql helper ────────────────────────────────────────────────

function mkSql(planFn) {
  const calls = [];
  let i = 0;
  const fn = (strings, ..._values) => {
    const text = strings.join('?');
    calls.push({ text, values: _values });
    if (typeof planFn === 'function') return Promise.resolve(planFn(text, i++, _values));
    return Promise.resolve([]);
  };
  fn.calls = calls;
  return fn;
}

// ─── countUsedThisMonth ─────────────────────────────────────────────

test('🛑 6/7 countUsedThisMonth: returns integer used count', async () => {
  const sql = mkSql(() => [{ used: 42 }]);
  const used = await countUsedThisMonth(sql);
  assert.equal(used, 42);
  // Query references day1_started_at + Asia/Taipei month boundary.
  assert.match(sql.calls[0].text, /day1_started_at/);
  assert.match(sql.calls[0].text, /Asia\/Taipei/);
  assert.match(sql.calls[0].text, /COUNT\(DISTINCT student_id\)/);
});

test('🛑 6/7 countUsedThisMonth: defensive — no rows / null → 0', async () => {
  const sql = mkSql(() => []);
  assert.equal(await countUsedThisMonth(sql), 0);
});

test('🛑 6/7 countUsedThisMonth: defensive — used is null → 0', async () => {
  const sql = mkSql(() => [{ used: null }]);
  assert.equal(await countUsedThisMonth(sql), 0);
});

// ─── isExistingStudent ─────────────────────────────────────────────

test('🛑 6/7 isExistingStudent: row present → true (returning student)', async () => {
  const sql = mkSql(() => [{ exists: 1 }]);
  assert.equal(await isExistingStudent(sql, 'a@b.c'), true);
});

test('🛑 6/7 isExistingStudent: no row → false (new email)', async () => {
  const sql = mkSql(() => []);
  assert.equal(await isExistingStudent(sql, 'new@example.com'), false);
});

test('🛑 6/7 isExistingStudent: defensive — empty / non-string → false', async () => {
  const sql = mkSql(() => [{ exists: 1 }]);
  assert.equal(await isExistingStudent(sql, ''), false);
  assert.equal(await isExistingStudent(sql, null), false);
  assert.equal(await isExistingStudent(sql, undefined), false);
});

// ─── decideDay1Gate ────────────────────────────────────────────────

test('🛑 6/7 decideDay1Gate: existing student → "existing" (always pass, 坑 1)', async () => {
  // Spec 坑 1: request-link is dual-purpose; returning students must NEVER
  // be quota-checked. They've already counted toward the month they started.
  const sql = mkSql((text) => {
    if (/SELECT 1 FROM students/.test(text)) return [{ exists: 1 }];
    if (/COUNT\(DISTINCT/.test(text))         return [{ used: 99999 }];   // ignored
    return [];
  });
  const r = await decideDay1Gate(sql, 'returning@example.com');
  assert.equal(r.verdict, 'existing');
  // Quota count NOT consulted.
  assert.equal(sql.calls.length, 1, 'existing-student fast-path skips COUNT query');
});

test('🛑 6/7 decideDay1Gate: new email + room → "pass"', async () => {
  const sql = mkSql((text) => {
    if (/SELECT 1 FROM students/.test(text)) return [];               // new email
    if (/COUNT\(DISTINCT/.test(text))         return [{ used: 7 }];   // 7 < 100
    return [];
  });
  const r = await decideDay1Gate(sql, 'fresh@example.com');
  assert.equal(r.verdict, 'pass');
  assert.equal(r.used, 7);
  assert.equal(r.quota, 100);
});

test('🛑 6/7 decideDay1Gate: new email + full → "waitlist"', async () => {
  const sql = mkSql((text) => {
    if (/SELECT 1 FROM students/.test(text)) return [];
    if (/COUNT\(DISTINCT/.test(text))         return [{ used: 100 }];   // at cap
    return [];
  });
  const r = await decideDay1Gate(sql, 'fresh@example.com');
  assert.equal(r.verdict, 'waitlist');
  assert.equal(r.used, 100);
  assert.equal(r.quota, 100);
});

test('🛑 6/7 decideDay1Gate: new email + over cap (overage) → "waitlist"', async () => {
  // Soft cap: magic-links already issued before tipover still consume slots.
  // The gate's job is to stop NEW sends past the line, not retroactively cap.
  const sql = mkSql((text) => {
    if (/SELECT 1 FROM students/.test(text)) return [];
    if (/COUNT\(DISTINCT/.test(text))         return [{ used: 105 }];   // 5 over
    return [];
  });
  const r = await decideDay1Gate(sql, 'fresh@example.com');
  assert.equal(r.verdict, 'waitlist');
});

test('🛑 6/7 decideDay1Gate: DAY1_QUOTA=5 (low) → flips at 5', async () => {
  process.env.DAY1_QUOTA = '5';
  const sql4 = mkSql((text) => {
    if (/SELECT 1 FROM students/.test(text)) return [];
    if (/COUNT\(DISTINCT/.test(text))         return [{ used: 4 }];
    return [];
  });
  const sql5 = mkSql((text) => {
    if (/SELECT 1 FROM students/.test(text)) return [];
    if (/COUNT\(DISTINCT/.test(text))         return [{ used: 5 }];
    return [];
  });
  assert.equal((await decideDay1Gate(sql4, 'a@b.c')).verdict, 'pass');
  assert.equal((await decideDay1Gate(sql5, 'a@b.c')).verdict, 'waitlist');
});

// ─── addToWaitlist ────────────────────────────────────────────────

test('🛑 6/7 addToWaitlist: INSERT shape (email + source)', async () => {
  const sql = mkSql(() => []);
  await addToWaitlist(sql, 'fresh@example.com', 'request_link');
  assert.equal(sql.calls.length, 1);
  assert.match(sql.calls[0].text, /INSERT INTO day1_waitlist/);
  assert.deepEqual(sql.calls[0].values, ['fresh@example.com', 'request_link']);
});

test('🛑 6/7 addToWaitlist: source enum validated (unknown → request_link default)', async () => {
  const sql = mkSql(() => []);
  await addToWaitlist(sql, 'fresh@example.com', 'garbage');
  assert.equal(sql.calls[0].values[1], 'request_link');
});

test('🛑 6/7 addToWaitlist: request_guide source preserved', async () => {
  const sql = mkSql(() => []);
  await addToWaitlist(sql, 'a@b.c', 'request_guide');
  assert.equal(sql.calls[0].values[1], 'request_guide');
});

test('🛑 6/7 addToWaitlist: empty / non-string email → no INSERT (defensive)', async () => {
  const sql = mkSql(() => []);
  await addToWaitlist(sql, '', 'request_link');
  await addToWaitlist(sql, null, 'request_link');
  await addToWaitlist(sql, undefined, 'request_link');
  assert.equal(sql.calls.length, 0);
});

test('🛑 6/7 addToWaitlist: SQL failure → swallow + log (no throw — 信封 envelope must hold)', async () => {
  const sql = (_strings) => Promise.reject(new Error('table missing'));
  // Must not throw — funnel response envelope (ok:true) must stay consistent.
  await addToWaitlist(sql, 'a@b.c', 'request_link');
});
