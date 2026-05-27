// api/admin/leads.test.js
// Patrick 5/26 — Daniel 客服 / lead 經營 agent 分群 endpoint.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, { _setSqlClient } from './leads.js';
import { _setCoachSessionReader } from '../../lib/auth/coach-session.js';

// ── mock SQL: rowsByCall = [leadsRows, studentsRows] ──

function makeMockSql(plan) {
  const calls = [];
  let idx = 0;
  const fn = (strings, ...values) => {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''),
      '',
    );
    calls.push({ strings: Array.from(strings), values, text });
    if (typeof plan === 'function') return Promise.resolve(plan({ text, idx: idx++ }));
    const rows = Array.isArray(plan?.[idx]) ? plan[idx++] : [];
    return Promise.resolve(rows);
  };
  fn.calls = calls;
  return fn;
}

function mockReq({ method = 'GET', query = {} } = {}) {
  return { method, query, headers: {} };
}
function mockRes() {
  const r = {
    statusCode: 200, body: null,
    status(s) { r.statusCode = s; return r; },
    json(b)   { r.body = b; return r; },
  };
  return r;
}

const COACH_OK = async () => ({ role: 'coach' });
const NO_COACH = async () => null;

beforeEach(() => {
  _setSqlClient(null);
  _setCoachSessionReader(null);
  process.env.SESSION_SECRET = 'test-secret-32-bytes-of-entropy-aaaaaaaa';
});

// ═════════════════════════════════════════════════════════
// method + auth
// ═════════════════════════════════════════════════════════

test('non-GET → 405', async () => {
  _setCoachSessionReader(COACH_OK);
  const res = mockRes();
  await handler(mockReq({ method: 'POST' }), res);
  assert.equal(res.statusCode, 405);
});

test('🛑 no coach session → 401 + NO DB query (guard fires before any SQL)', async () => {
  _setCoachSessionReader(NO_COACH);
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 401);
  assert.equal(sql.calls.length, 0,
    'must not touch DB before coach gate clears');
});

// ═════════════════════════════════════════════════════════
// segmentation rules — all 4 buckets in one fixture
// ═════════════════════════════════════════════════════════

test('🛑 coach session: classifies pdf_lead / trial_active / trial_lapsed / purchased', async () => {
  _setCoachSessionReader(COACH_OK);
  const now = Date.now();
  const within24h  = new Date(now - 5  * 60 * 60 * 1000).toISOString();   // 5h ago
  const beyond24h  = new Date(now - 48 * 60 * 60 * 1000).toISOString();   // 48h ago
  const leadOnly   = new Date(now - 1  * 60 * 60 * 1000).toISOString();   // 1h ago

  _setSqlClient(makeMockSql([
    // leads
    [
      { email: 'pdf@example.com',   option: 1, created_at: leadOnly  },   // pdf_lead (not in students)
      { email: 'active@example.com', option: 3, created_at: within24h },  // also in students → ignored as pdf_lead
    ],
    // students
    [
      { student_id: 'A001', email: 'active@example.com',    plan: 'trial',  current_day: 1, is_beta: false, created_at: within24h },
      { student_id: 'A002', email: 'lapsed@example.com',    plan: 'trial',  current_day: 1, is_beta: false, created_at: beyond24h },
      { student_id: 'A003', email: 'paid@example.com',      plan: 'plan_a', current_day: 5, is_beta: false, created_at: beyond24h },
      { student_id: 'A099', email: 'beta@example.com',      plan: 'plan_a', current_day: 8, is_beta: true,  created_at: beyond24h },
    ],
  ]));

  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  const rows = res.body.leads;
  const byEmail = Object.fromEntries(rows.map(r => [r.email, r]));

  // pdf_lead — leads row whose email is NOT in students
  assert.ok(byEmail['pdf@example.com'], 'pdf_lead row must be present');
  assert.equal(byEmail['pdf@example.com'].segment, 'pdf_lead');
  assert.equal(byEmail['pdf@example.com'].current_day, null);
  assert.equal(byEmail['pdf@example.com'].plan, null);
  assert.equal(byEmail['pdf@example.com'].is_beta, false);

  // active@: appears in leads BUT also in students → student row drives segment
  // (only ONE row for that email, segment=trial_active).
  assert.equal(byEmail['active@example.com'].segment, 'trial_active',
    'student row should beat the pdf_lead duplicate');
  assert.equal(rows.filter(r => r.email === 'active@example.com').length, 1,
    'email that exists in BOTH leads and students must produce exactly one row');

  // trial_lapsed
  assert.equal(byEmail['lapsed@example.com'].segment, 'trial_lapsed');
  assert.equal(byEmail['lapsed@example.com'].current_day, 1);

  // purchased (plan_a) — non-beta real customer
  assert.equal(byEmail['paid@example.com'].segment, 'purchased');
  assert.equal(byEmail['paid@example.com'].plan, 'plan_a');
  assert.equal(byEmail['paid@example.com'].is_beta, false);
  assert.equal(byEmail['paid@example.com'].current_day, 5);

  // purchased (plan_a) — is_beta=true 區分封測者
  assert.equal(byEmail['beta@example.com'].segment, 'purchased');
  assert.equal(byEmail['beta@example.com'].is_beta, true,
    'is_beta flag must surface so Daniel can exclude 封測者 from catch-up / upsell');
});

// ═════════════════════════════════════════════════════════
// 鐵律 #2 — response must NOT leak coach-internal columns
// ═════════════════════════════════════════════════════════

test('🛑 response row shape locked: {email, segment, current_day, plan, is_beta, created_at} only', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([
    [],   // leads
    [{ student_id: 'A001', email: 'x@y.io', plan: 'plan_a', current_day: 2, is_beta: false, created_at: '2026-05-26' }],
  ]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  const allowed = ['email', 'segment', 'current_day', 'plan', 'is_beta', 'created_at'].sort();
  for (const row of res.body.leads) {
    assert.deepEqual(Object.keys(row).sort(), allowed,
      `row keys must be exactly ${JSON.stringify(allowed)}. got: ${JSON.stringify(Object.keys(row))}`);
  }
});

test('🛑 SELECT 不取 damon_note / damon_note_public / sc_observation 等敏感欄位 (鐵律 #2 grep guard)', async () => {
  _setCoachSessionReader(COACH_OK);
  const sql = makeMockSql([[], []]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  const allText = sql.calls.map(c => c.text).join('\n');
  // Strong guard — these substrings must NOT appear in any query text.
  for (const banned of ['damon_note', 'note_text', 'sc_observation', 'breakthrough', 'layer']) {
    assert.equal(new RegExp(banned, 'i').test(allText), false,
      `query text must not reference '${banned}' (鐵律 #2 諮商保密). text:\n${allText}`);
  }
});

// ═════════════════════════════════════════════════════════
// ?segment=<seg> filter
// ═════════════════════════════════════════════════════════

test('?segment=trial_lapsed → returns only that bucket', async () => {
  _setCoachSessionReader(COACH_OK);
  const now = Date.now();
  const beyond24h = new Date(now - 48 * 60 * 60 * 1000).toISOString();
  const within24h = new Date(now - 5  * 60 * 60 * 1000).toISOString();
  _setSqlClient(makeMockSql([
    [{ email: 'pdf@x.com', option: 1, created_at: within24h }],
    [
      { student_id: 'A001', email: 'a@x.com', plan: 'trial',  current_day: 1, is_beta: false, created_at: beyond24h },
      { student_id: 'A002', email: 'b@x.com', plan: 'trial',  current_day: 1, is_beta: false, created_at: within24h },
      { student_id: 'A003', email: 'c@x.com', plan: 'plan_a', current_day: 5, is_beta: false, created_at: beyond24h },
    ],
  ]));
  const res = mockRes();
  await handler(mockReq({ query: { segment: 'trial_lapsed' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.leads.length, 1);
  assert.equal(res.body.leads[0].email, 'a@x.com');
  assert.equal(res.body.leads[0].segment, 'trial_lapsed');
});

test('?segment=pdf_lead → returns only pdf_lead bucket (not students-side rows)', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([
    [
      { email: 'p1@x.com', option: 1, created_at: '2026-05-26' },
      { email: 'p2@x.com', option: 1, created_at: '2026-05-26' },
    ],
    [{ student_id: 'A001', email: 'p2@x.com', plan: 'trial', current_day: 1, is_beta: false, created_at: new Date().toISOString() }],
  ]));
  const res = mockRes();
  await handler(mockReq({ query: { segment: 'pdf_lead' } }), res);
  assert.equal(res.statusCode, 200);
  // p2 is in students → NOT a pdf_lead; only p1 remains.
  assert.equal(res.body.leads.length, 1);
  assert.equal(res.body.leads[0].email, 'p1@x.com');
});

// ═════════════════════════════════════════════════════════
// edge cases — empty tables, SQL throw, email normalization
// ═════════════════════════════════════════════════════════

test('empty leads + empty students → 200 with empty array', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(makeMockSql([[], []]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { leads: [] });
});

test('SQL throws → 500 admin_leads_failed', async () => {
  _setCoachSessionReader(COACH_OK);
  _setSqlClient(() => Promise.reject(new Error('DB down')));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'admin_leads_failed');
});

test('email matching is case-insensitive + trim (pdf "Foo@x" matches student "foo@x")', async () => {
  _setCoachSessionReader(COACH_OK);
  const now = new Date().toISOString();
  _setSqlClient(makeMockSql([
    [{ email: '  Foo@Example.COM ', option: 1, created_at: now }],
    [{ student_id: 'A001', email: 'foo@example.com', plan: 'trial', current_day: 1, is_beta: false, created_at: now }],
  ]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  // Should be exactly 1 row (student-side) — the lead is matched out.
  assert.equal(res.body.leads.length, 1);
  assert.equal(res.body.leads[0].segment, 'trial_active');
});
