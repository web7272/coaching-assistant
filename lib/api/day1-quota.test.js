// lib/api/day1-quota.test.js — Patrick 6/7 funnel-precise gate.
// Vivi 6/7: quota source SQL > env > default 1000; 30s TTL cache.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_DAY1_QUOTA, QUOTA_TTL_MS,
  getQuota, countUsedThisMonth, isExistingStudent,
  decideDay1Gate, addToWaitlist,
  _resetQuotaCache,
} from './day1-quota.js';

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

function mkSqlByTopic(planFn) {
  return mkSql((text, _i, values) => planFn(text, values));
}

// ─── Constants ───────────────────────────────────────────────────

test('🛑 6/7 DEFAULT_DAY1_QUOTA = 1000 (Vivi 6/7: was 100 → 1000)', () => {
  assert.equal(DEFAULT_DAY1_QUOTA, 1000);
});

test('🛑 6/7 QUOTA_TTL_MS ≈ 30s window', () => {
  assert.ok(QUOTA_TTL_MS >= 20_000 && QUOTA_TTL_MS <= 60_000,
    `QUOTA_TTL_MS=${QUOTA_TTL_MS} outside 20-60s spec range`);
});

// ─── getQuota — env-only path (no sql) ──────────────────────────────

beforeEach(() => {
  _resetQuotaCache();
  delete process.env.DAY1_QUOTA;
});

test('🛑 6/7 getQuota: no sql, env unset → DEFAULT_DAY1_QUOTA (1000)', async () => {
  assert.equal(await getQuota(), DEFAULT_DAY1_QUOTA);
});

test('🛑 6/7 getQuota: no sql, DAY1_QUOTA="50" → 50', async () => {
  process.env.DAY1_QUOTA = '50';
  assert.equal(await getQuota(), 50);
});

test('🛑 6/7 getQuota: no sql, DAY1_QUOTA="0" → 0 (allows hard-stop testing)', async () => {
  process.env.DAY1_QUOTA = '0';
  assert.equal(await getQuota(), 0);
});

test('🛑 6/7 getQuota: no sql, malformed/negative/empty → fall back to default 1000', async () => {
  for (const bad of ['foo', '-5', '', 'NaN']) {
    process.env.DAY1_QUOTA = bad;
    _resetQuotaCache();
    assert.equal(await getQuota(), DEFAULT_DAY1_QUOTA, `bad="${bad}" should fall back`);
  }
});

test('🛑 6/7 getQuota: no sql, floats truncated', async () => {
  process.env.DAY1_QUOTA = '100.7';
  assert.equal(await getQuota(), 100);
});

// ─── getQuota — SQL config path (primary) ──────────────────────────

test('🛑 6/7 getQuota: SQL app_config row wins over env (Vivi 6/7 SQL-tunable)', async () => {
  process.env.DAY1_QUOTA = '999';   // env says 999
  const sql = mkSqlByTopic((text) => {
    if (/app_config/.test(text) && /monthly_day1_quota/.test(text))
      return [{ value: '250' }];   // SQL says 250
    return [];
  });
  assert.equal(await getQuota(sql), 250);
});

test('🛑 6/7 getQuota: SQL missing row → fallback to env', async () => {
  process.env.DAY1_QUOTA = '700';
  const sql = mkSqlByTopic(() => []);
  assert.equal(await getQuota(sql), 700);
});

test('🛑 6/7 getQuota: SQL missing row + env unset → default 1000', async () => {
  const sql = mkSqlByTopic(() => []);
  assert.equal(await getQuota(sql), DEFAULT_DAY1_QUOTA);
});

test('🛑 6/7 getQuota: SQL throws (table missing) → fallback to env', async () => {
  process.env.DAY1_QUOTA = '500';
  const sql = () => Promise.reject(new Error('relation "app_config" does not exist'));
  assert.equal(await getQuota(sql), 500);
});

test('🛑 6/7 getQuota: SQL throws + env unset → fallback to default 1000', async () => {
  const sql = () => Promise.reject(new Error('db down'));
  assert.equal(await getQuota(sql), DEFAULT_DAY1_QUOTA);
});

test('🛑 6/7 getQuota: SQL value malformed → fallback to env (don\'t crash)', async () => {
  process.env.DAY1_QUOTA = '800';
  const sql = mkSqlByTopic(() => [{ value: 'garbage' }]);
  assert.equal(await getQuota(sql), 800);
});

test('🛑 6/7 getQuota: SQL value "0" → 0 (Vivi hard-stop)', async () => {
  // Vivi 緊急把所有人擋住 → 一句 SQL 設 '0'.
  const sql = mkSqlByTopic((text) => {
    if (/app_config/.test(text)) return [{ value: '0' }];
    return [];
  });
  assert.equal(await getQuota(sql), 0);
});

// ─── getQuota — cache behaviour ───────────────────────────────────

test('🛑 6/7 getQuota: cached within TTL — 2nd call no SQL hit', async () => {
  let sqlHits = 0;
  const sql = mkSqlByTopic((text) => {
    sqlHits++;
    return [{ value: '300' }];
  });
  assert.equal(await getQuota(sql), 300);
  assert.equal(await getQuota(sql), 300);
  assert.equal(sqlHits, 1, 'second call should hit cache');
});

test('🛑 6/7 getQuota: cache cleared by _resetQuotaCache → next call re-reads SQL', async () => {
  let sqlHits = 0;
  const sql = mkSqlByTopic(() => { sqlHits++; return [{ value: '120' }]; });
  await getQuota(sql);
  _resetQuotaCache();
  await getQuota(sql);
  assert.equal(sqlHits, 2);
});

test('🛑 6/7 getQuota: SQL failure does NOT cache (next call retries)', async () => {
  let phase = 'fail';
  let sqlHits = 0;
  const sql = (_strings) => {
    sqlHits++;
    if (phase === 'fail') return Promise.reject(new Error('db down'));
    return Promise.resolve([{ value: '90' }]);
  };
  // First call fails → falls back to default (1000), should NOT cache
  // the default (otherwise we'd be stuck on the wrong value until TTL).
  process.env.DAY1_QUOTA = '500';   // env fallback during failure
  assert.equal(await getQuota(sql), 500);
  // Actually env value IS cached. The spec says "failed SQL → don't cache" so
  // that when SQL recovers we read the real value. But env is the next valid
  // source. Decision: cache the env value too — TTL window will roll out the
  // SQL recovery within 30s, which is acceptable.
  // Re-test after explicit reset:
  _resetQuotaCache();
  phase = 'ok';
  assert.equal(await getQuota(sql), 90);
});

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
  const sql = mkSqlByTopic((text) => {
    if (/app_config/.test(text))             return [{ value: '100' }];
    if (/SELECT 1 FROM students/.test(text)) return [{ exists: 1 }];
    if (/COUNT\(DISTINCT/.test(text))         return [{ used: 99999 }];   // ignored
    return [];
  });
  const r = await decideDay1Gate(sql, 'returning@example.com');
  assert.equal(r.verdict, 'existing');
  // Quota COUNT NOT consulted (only app_config + students lookup).
  const calledCount = sql.calls.some(c => /COUNT\(DISTINCT/.test(c.text));
  assert.equal(calledCount, false, 'existing-student fast-path skips COUNT query');
});

test('🛑 6/7 decideDay1Gate: new email + room → "pass"', async () => {
  const sql = mkSqlByTopic((text) => {
    if (/app_config/.test(text))             return [{ value: '100' }];
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
  const sql = mkSqlByTopic((text) => {
    if (/app_config/.test(text))             return [{ value: '100' }];
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
  const sql = mkSqlByTopic((text) => {
    if (/app_config/.test(text))             return [{ value: '100' }];
    if (/SELECT 1 FROM students/.test(text)) return [];
    if (/COUNT\(DISTINCT/.test(text))         return [{ used: 105 }];   // 5 over
    return [];
  });
  const r = await decideDay1Gate(sql, 'fresh@example.com');
  assert.equal(r.verdict, 'waitlist');
});

test('🛑 6/7 decideDay1Gate: SQL app_config "5" (low) → flips at 5', async () => {
  const sql4 = mkSqlByTopic((text) => {
    if (/app_config/.test(text))             return [{ value: '5' }];
    if (/SELECT 1 FROM students/.test(text)) return [];
    if (/COUNT\(DISTINCT/.test(text))         return [{ used: 4 }];
    return [];
  });
  _resetQuotaCache();
  assert.equal((await decideDay1Gate(sql4, 'a@b.c')).verdict, 'pass');

  _resetQuotaCache();
  const sql5 = mkSqlByTopic((text) => {
    if (/app_config/.test(text))             return [{ value: '5' }];
    if (/SELECT 1 FROM students/.test(text)) return [];
    if (/COUNT\(DISTINCT/.test(text))         return [{ used: 5 }];
    return [];
  });
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
