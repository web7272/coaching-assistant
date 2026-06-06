// lib/api/case-id.test.js
// Daniel 6/5 客服 ticketing — case_id generation lock.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  formatTaipeiDate, buildCaseId, getNextSequenceForToday,
  generateCaseId, isCaseIdUniqueConflict, tryGenerateAndInsert,
  CASE_CATEGORIES, CASE_STATUSES,
} from './case-id.js';

// ─── formatTaipeiDate ────────────────────────────────────

test('🛑 formatTaipeiDate: 2026-06-06 UTC mid-day → 20260606 (Taipei)', () => {
  // UTC 06:00 on 2026-06-06 = Taipei 14:00 — same calendar date.
  const d = new Date('2026-06-06T06:00:00Z');
  assert.equal(formatTaipeiDate(d), '20260606');
});

test('🛑 formatTaipeiDate: UTC 17:00 → next Taipei day', () => {
  // UTC 17:00 = Taipei 01:00 next day.
  const d = new Date('2026-06-06T17:00:00Z');
  assert.equal(formatTaipeiDate(d), '20260607');
});

test('🛑 formatTaipeiDate: UTC 15:59 same calendar Taipei', () => {
  // UTC 15:59 = Taipei 23:59 same day.
  const d = new Date('2026-06-06T15:59:00Z');
  assert.equal(formatTaipeiDate(d), '20260606');
});

// ─── buildCaseId ─────────────────────────────────────────

test('🛑 buildCaseId: pads sequence to 3 digits', () => {
  assert.equal(buildCaseId('20260606', 1),   'SY-20260606-001');
  assert.equal(buildCaseId('20260606', 12),  'SY-20260606-012');
  assert.equal(buildCaseId('20260606', 123), 'SY-20260606-123');
});

test('🛑 buildCaseId: ≥ 1000 keeps native width (no truncation)', () => {
  assert.equal(buildCaseId('20260606', 1000), 'SY-20260606-1000');
});

test('🛑 buildCaseId: defensive — non-positive sequence → defaults to 1', () => {
  assert.equal(buildCaseId('20260606', 0),    'SY-20260606-001');
  assert.equal(buildCaseId('20260606', -5),   'SY-20260606-001');
  assert.equal(buildCaseId('20260606', null), 'SY-20260606-001');
  assert.equal(buildCaseId('20260606', NaN),  'SY-20260606-001');
});

// ─── Mock sql helper for getNextSequenceForToday / generateCaseId ──

function mkSql(rowsPlan) {
  const calls = [];
  let i = 0;
  const fn = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    if (typeof rowsPlan === 'function') return Promise.resolve(rowsPlan(text, i++));
    if (Array.isArray(rowsPlan)) return Promise.resolve(rowsPlan[i++] || []);
    return Promise.resolve([]);
  };
  fn.calls = calls;
  return fn;
}

// ─── getNextSequenceForToday ─────────────────────────────

test('🛑 getNextSequenceForToday: zero existing → 1', async () => {
  const sql = mkSql([[{ cnt: 0 }]]);
  assert.equal(await getNextSequenceForToday(sql), 1);
});

test('🛑 getNextSequenceForToday: 7 existing today → 8', async () => {
  const sql = mkSql([[{ cnt: 7 }]]);
  assert.equal(await getNextSequenceForToday(sql), 8);
});

test('🛑 getNextSequenceForToday: defensive — missing row → 1', async () => {
  const sql = mkSql([[]]);
  assert.equal(await getNextSequenceForToday(sql), 1);
});

// ─── generateCaseId ──────────────────────────────────────

test('🛑 generateCaseId: returns SY-YYYYMMDD-NNN (clock injected)', async () => {
  const sql = mkSql([[{ cnt: 0 }]]);
  const now = new Date('2026-06-06T08:00:00Z');   // Taipei 16:00 same day
  const id = await generateCaseId(sql, { now });
  assert.equal(id, 'SY-20260606-001');
});

test('🛑 generateCaseId: respects existing count', async () => {
  const sql = mkSql([[{ cnt: 42 }]]);
  const now = new Date('2026-06-06T08:00:00Z');
  const id = await generateCaseId(sql, { now });
  assert.equal(id, 'SY-20260606-043');
});

// ─── isCaseIdUniqueConflict ──────────────────────────────

test('🛑 isCaseIdUniqueConflict: pg code 23505 → true', () => {
  assert.equal(isCaseIdUniqueConflict({ code: '23505' }), true);
});

test('🛑 isCaseIdUniqueConflict: code on cause → true', () => {
  assert.equal(isCaseIdUniqueConflict({ cause: { code: '23505' } }), true);
});

test('🛑 isCaseIdUniqueConflict: neon message text match → true', () => {
  assert.equal(
    isCaseIdUniqueConflict({ message: 'duplicate key value violates unique constraint "cases_case_id_key"' }),
    true,
  );
});

test('🛑 isCaseIdUniqueConflict: unrelated error → false', () => {
  assert.equal(isCaseIdUniqueConflict({ code: '42P01' }), false);
  assert.equal(isCaseIdUniqueConflict({ message: 'connection lost' }), false);
  assert.equal(isCaseIdUniqueConflict(null), false);
  assert.equal(isCaseIdUniqueConflict(undefined), false);
});

// ─── tryGenerateAndInsert ────────────────────────────────

test('🛑 tryGenerateAndInsert: happy path → first attempt succeeds', async () => {
  let sqlCallNum = 0;
  const sql = (strings, ..._values) => {
    sqlCallNum += 1;
    const text = strings.join('?');
    if (/SELECT COUNT/.test(text)) return Promise.resolve([{ cnt: 0 }]);
    if (/INSERT INTO cases/.test(text)) {
      return Promise.resolve([{
        case_id: 'SY-20260606-001',
        created_at: '2026-06-06T08:00:00Z',
      }]);
    }
    return Promise.resolve([]);
  };
  const r = await tryGenerateAndInsert(sql, {
    email: 'test@example.com', category: 'bug',
  }, { now: new Date('2026-06-06T08:00:00Z') });
  assert.equal(r.case_id, 'SY-20260606-001');
  assert.equal(r.attempts, 1);
  // 2 sql calls (COUNT + INSERT).
  assert.equal(sqlCallNum, 2);
});

test('🛑 tryGenerateAndInsert: retries on UNIQUE conflict, succeeds 2nd attempt', async () => {
  // Simulate race: 1st INSERT hits 23505, COUNT recomputed (now =1), 2nd
  // INSERT succeeds at -002.
  let countCalls = 0;
  let insertCalls = 0;
  const sql = (strings) => {
    const text = strings.join('?');
    if (/SELECT COUNT/.test(text)) {
      countCalls += 1;
      // First read: 0 (still race window). Second read: 1 (the conflicting
      // case has now been committed by the other request).
      return Promise.resolve([{ cnt: countCalls === 1 ? 0 : 1 }]);
    }
    if (/INSERT INTO cases/.test(text)) {
      insertCalls += 1;
      if (insertCalls === 1) {
        const err = new Error('duplicate key value violates unique constraint "cases_case_id_key"');
        err.code = '23505';
        return Promise.reject(err);
      }
      return Promise.resolve([{
        case_id: 'SY-20260606-002',
        created_at: '2026-06-06T08:00:00Z',
      }]);
    }
    return Promise.resolve([]);
  };
  const r = await tryGenerateAndInsert(sql, {
    email: 'test@example.com', category: 'bug',
  }, { now: new Date('2026-06-06T08:00:00Z') });
  assert.equal(r.case_id, 'SY-20260606-002');
  assert.equal(r.attempts, 2);
  assert.equal(countCalls, 2);
  assert.equal(insertCalls, 2);
});

test('🛑 tryGenerateAndInsert: non-UNIQUE error propagates immediately', async () => {
  const sql = (strings) => {
    const text = strings.join('?');
    if (/SELECT COUNT/.test(text)) return Promise.resolve([{ cnt: 0 }]);
    if (/INSERT INTO cases/.test(text)) {
      const err = new Error('connection lost');
      err.code = '08006';
      return Promise.reject(err);
    }
    return Promise.resolve([]);
  };
  await assert.rejects(
    () => tryGenerateAndInsert(sql, { email: 'x@y.z' }, { now: new Date('2026-06-06T08:00:00Z') }),
    /connection lost/,
  );
});

test('🛑 tryGenerateAndInsert: exhausts retries → throws CASE_ID_RETRY_EXHAUSTED', async () => {
  let count = 0;
  const sql = (strings) => {
    const text = strings.join('?');
    if (/SELECT COUNT/.test(text)) {
      // Always return same count → same case_id → always UNIQUE conflict.
      return Promise.resolve([{ cnt: 0 }]);
    }
    if (/INSERT INTO cases/.test(text)) {
      count += 1;
      const err = new Error('duplicate key');
      err.code = '23505';
      return Promise.reject(err);
    }
    return Promise.resolve([]);
  };
  await assert.rejects(
    () => tryGenerateAndInsert(sql, { email: 'x@y.z' }, {
      now: new Date('2026-06-06T08:00:00Z'), maxRetries: 3,
    }),
    /exhausted retries/,
  );
  assert.equal(count, 3);
});

// ─── Enum exports ────────────────────────────────────────

test('🛑 CASE_CATEGORIES verbatim from migration 032 CHECK', () => {
  assert.deepEqual([...CASE_CATEGORIES].sort(),
    ['bug','feedback','login','other','progress','refund'].sort());
});

test('🛑 CASE_STATUSES verbatim from migration 032 CHECK', () => {
  assert.deepEqual([...CASE_STATUSES].sort(),
    ['awaiting_vivi','open','resolved'].sort());
});
