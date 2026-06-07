// api/request-guide.test.js
// Patrick 5/26 — Stage 0 漏斗 lead-magnet endpoint.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, {
  _setSqlClient,
  _setSendGuideFn,
  _setSendMagicLinkFn,
} from './request-guide.js';
// 6/7 Vivi: getQuota() now caches resolved quota 30s; reset between tests.
import { _resetQuotaCache } from '../lib/api/day1-quota.js';

function makeMockSql({ rows = [], throwOn } = {}) {
  // throwOn (optional): predicate(text) → boolean; if matches, the call rejects.
  const calls = [];
  const fn = (strings, ...values) => {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''),
      '',
    );
    calls.push({ strings: Array.from(strings), values, text });
    if (typeof throwOn === 'function' && throwOn(text)) {
      return Promise.reject(new Error('mock SQL rejection'));
    }
    return Promise.resolve(rows);
  };
  fn.calls = calls;
  return fn;
}

function mockReq({ method = 'POST', body = {} } = {}) {
  return { method, body, headers: {} };
}
function mockRes() {
  const r = {
    statusCode: 200, body: null,
    status(s) { r.statusCode = s; return r; },
    json(b)   { r.body = b; return r; },
  };
  return r;
}

beforeEach(() => {
  _setSqlClient(null);
  _setSendGuideFn(null);
  _setSendMagicLinkFn(null);
  _resetQuotaCache();
  process.env.APP_BASE_URL = 'https://preview.example.com';
  delete process.env.VERCEL_URL;
});

// ═════════════════════════════════════════════════════════
// envelope: 永遠回 {ok:true}, 非 POST → 405
// ═════════════════════════════════════════════════════════

test('non-POST → 405', async () => {
  const res = mockRes();
  await handler(mockReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
});

test('🛑 invalid email → 200 ok:true, NO email sent, NO SQL insert attempted', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  const sentGuide = [], sentMagic = [];
  _setSendGuideFn(async (e, u) => { sentGuide.push({ e, u }); });
  _setSendMagicLinkFn(async (e, l) => { sentMagic.push({ e, l }); });

  const res = mockRes();
  await handler(mockReq({ body: { email: 'not-an-email', option: 1 } }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sentGuide.length, 0, 'must not send PDF on invalid email');
  assert.equal(sentMagic.length, 0, 'must not send magic link on invalid email');
  assert.equal(sql.calls.length, 0, 'must not touch DB on invalid email');
});

test('🛑 missing email → 200 ok:true (same envelope, security property)', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ body: { option: 1 } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

// ═════════════════════════════════════════════════════════
// option 1 — PDF only
// ═════════════════════════════════════════════════════════

test('🛑 option 1 (PDF only) → only sendGuideEmail called, NO magic link', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  const sentGuide = [], sentMagic = [];
  _setSendGuideFn(async (e, u) => { sentGuide.push({ e, u }); });
  _setSendMagicLinkFn(async (e, l) => { sentMagic.push({ e, l }); });

  const res = mockRes();
  await handler(mockReq({ body: { email: 'Vivi@Example.COM', option: 1 } }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  // 1 SQL call only: the lead INSERT (no magic_link_tokens INSERT on option 1).
  assert.equal(sql.calls.length, 1, `expected 1 SQL call (lead INSERT only). got: ${sql.calls.length}`);
  assert.match(sql.calls[0].text, /INSERT INTO leads/i);
  // email was normalized to lowercase before the INSERT.
  assert.ok(sql.calls[0].values.includes('vivi@example.com'),
    `lead INSERT must use normalized email. saw: ${JSON.stringify(sql.calls[0].values)}`);
  assert.ok(sql.calls[0].values.includes(1), 'lead row option=1');
  // sendGuideEmail called once, sendMagicLink never.
  assert.equal(sentGuide.length, 1);
  assert.equal(sentGuide[0].e, 'vivi@example.com');
  assert.match(sentGuide[0].u, /\/assets\/guide\/value-guide\.pdf$/);
  assert.match(sentGuide[0].u, /^https:\/\/preview\.example\.com/);
  assert.equal(sentMagic.length, 0, 'option 1 must NOT send magic link');
});

// ═════════════════════════════════════════════════════════
// option 2 — magic link only
// ═════════════════════════════════════════════════════════

test('🛑 option 2 (trial only) → only sendMagicLink called, NO PDF', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  const sentGuide = [], sentMagic = [];
  _setSendGuideFn(async (e, u) => { sentGuide.push({ e, u }); });
  _setSendMagicLinkFn(async (e, l) => { sentMagic.push({ e, l }); });

  const answers = { 現況: 'a', 渴望: 'b', 阻礙: 'c', 預算: 'd', 開放題: 'e' };
  const res = mockRes();
  await handler(mockReq({ body: { email: 'x@y.io', option: 2, answers } }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  // SQL calls (post-6/7 Day-1 gate): leads INSERT, gate's isExistingStudent
  //   SELECT + countUsedThisMonth COUNT, then magic_link_tokens INSERT.
  // Original test asserted exact length=2 (leads + magic_link). Now we check
  // the IMPORTANT inserts are present without pinning the count.
  const leadCall = sql.calls.find(c => /INSERT INTO leads/i.test(c.text));
  assert.ok(leadCall, 'leads INSERT must fire');
  assert.ok(leadCall.values.includes(2), 'lead row option=2');
  // answers serialized to JSON for the lead row.
  const answersJson = leadCall.values.find(v => typeof v === 'string' && v.startsWith('{'));
  assert.ok(answersJson && JSON.parse(answersJson).現況 === 'a',
    'answers must be JSON-serialized into the lead row');
  assert.ok(sql.calls.find(c => /INSERT INTO magic_link_tokens/i.test(c.text)),
    'magic_link_tokens INSERT must fire');
  // PDF NOT sent; magic link sent once.
  assert.equal(sentGuide.length, 0, 'option 2 must NOT send PDF');
  assert.equal(sentMagic.length, 1);
  assert.match(sentMagic[0].l, /\/auth\?token=[0-9a-f]{64}$/);
});

// ═════════════════════════════════════════════════════════
// option 3 — both
// ═════════════════════════════════════════════════════════

test('🛑 option 3 (PDF + trial) → BOTH sendGuideEmail and sendMagicLink called', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  const sentGuide = [], sentMagic = [];
  _setSendGuideFn(async (e, u) => { sentGuide.push({ e, u }); });
  _setSendMagicLinkFn(async (e, l) => { sentMagic.push({ e, l }); });

  const res = mockRes();
  await handler(mockReq({
    body: { email: 'both@example.org', option: 3, answers: { 現況: 'foo' } },
  }), res);

  assert.equal(res.statusCode, 200);
  // Post-6/7 gate adds 2 SELECTs between leads INSERT and magic_link INSERT.
  // Assert key INSERTs are present without pinning the total count.
  const leadCall = sql.calls.find(c => /INSERT INTO leads/i.test(c.text));
  assert.ok(leadCall, 'leads INSERT must fire');
  assert.ok(leadCall.values.includes(3));
  assert.ok(sql.calls.find(c => /INSERT INTO magic_link_tokens/i.test(c.text)),
    'magic_link_tokens INSERT must fire');
  // Both senders fired.
  assert.equal(sentGuide.length, 1, 'option 3 sends PDF');
  assert.equal(sentMagic.length, 1, 'option 3 sends magic link');
});

// ═════════════════════════════════════════════════════════
// option fallback / robustness
// ═════════════════════════════════════════════════════════

test('option value not in {1,2,3} → defaults to 1 (PDF only)', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  const sentGuide = [], sentMagic = [];
  _setSendGuideFn(async (e, u) => { sentGuide.push({ e, u }); });
  _setSendMagicLinkFn(async (e, l) => { sentMagic.push({ e, l }); });

  const res = mockRes();
  await handler(mockReq({ body: { email: 'a@b.co', option: 99 } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(sentGuide.length, 1, 'fallback option=1 must send PDF');
  assert.equal(sentMagic.length, 0);
  assert.ok(sql.calls[0].values.includes(1), 'lead row stored as option=1 fallback');
});

test('answers as non-object (e.g. array) → stored as null (not crashed)', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  _setSendGuideFn(async () => {});
  const res = mockRes();
  await handler(mockReq({ body: { email: 'a@b.co', option: 1, answers: ['malformed'] } }), res);
  assert.equal(res.statusCode, 200);
  // 3rd value in lead INSERT is the answers JSON; should be null.
  const answersPos = sql.calls[0].values[2];
  assert.equal(answersPos, null, 'array answers must be coerced to null, not crash');
});

// ═════════════════════════════════════════════════════════
// lead INSERT failure must NOT block email sends — fail-soft
// ═════════════════════════════════════════════════════════

test('🛑 lead INSERT fails (table missing) → PDF still sent, returns ok:true', async () => {
  const sql = makeMockSql({ throwOn: t => /INSERT INTO leads/i.test(t) });
  _setSqlClient(sql);
  const sentGuide = [];
  _setSendGuideFn(async (e, u) => { sentGuide.push({ e, u }); });

  const res = mockRes();
  await handler(mockReq({ body: { email: 'a@b.co', option: 1 } }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sentGuide.length, 1,
    'lead INSERT failure must NOT prevent the PDF email from being sent');
});

test('🛑 sendGuideEmail throws → handler still returns ok:true', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  _setSendGuideFn(async () => { throw new Error('email provider down'); });

  const res = mockRes();
  await handler(mockReq({ body: { email: 'a@b.co', option: 1 } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('🛑 magic-link-tokens INSERT fails on option 2 → still returns ok:true', async () => {
  const sql = makeMockSql({ throwOn: t => /INSERT INTO magic_link_tokens/i.test(t) });
  _setSqlClient(sql);
  const sentMagic = [];
  _setSendMagicLinkFn(async (e, l) => { sentMagic.push({ e, l }); });

  const res = mockRes();
  await handler(mockReq({ body: { email: 'a@b.co', option: 2 } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sentMagic.length, 0,
    'magic link must NOT be sent if the token row failed to insert (no recoverable link)');
});

// ═════════════════════════════════════════════════════════
// 🛑 Patrick 6/7 Day-1 monthly quota gate — request-guide branches
// ═════════════════════════════════════════════════════════

function mkSqlByTopic({ existingStudent, used }) {
  const calls = [];
  const fn = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    // leads INSERT
    if (/INSERT INTO leads/i.test(text)) return Promise.resolve([]);
    // isExistingStudent
    if (/SELECT 1 FROM students/.test(text)) {
      return Promise.resolve(existingStudent ? [{ exists: 1 }] : []);
    }
    // countUsedThisMonth
    if (/COUNT\(DISTINCT student_id\)/.test(text)) {
      return Promise.resolve([{ used }]);
    }
    return Promise.resolve([]);
  };
  fn.calls = calls;
  return fn;
}

test('🛑 6/7 坑 2: option 1 (PDF only) → NEVER quota-gated, no waitlist, PDF sent', async () => {
  process.env.DAY1_QUOTA = '100';
  // Even at over-cap, option 1 must pass freely (zero Anthropic cost).
  const sql = mkSqlByTopic({ existingStudent: false, used: 99999 });
  _setSqlClient(sql);
  const sentGuide = [];
  const sentMagic = [];
  _setSendGuideFn(async (e, link) => { sentGuide.push({ e, link }); });
  _setSendMagicLinkFn(async (e) => { sentMagic.push(e); });
  await handler(mockReq({ body: { email: 'fresh@example.com', option: 1 } }), mockRes());
  assert.equal(sentGuide.length, 1, 'PDF must always be sent for option 1');
  assert.equal(sentMagic.length, 0, 'magic-link must NEVER be sent for option 1');
  // No quota query consulted (early-exit before gate).
  assert.ok(!sql.calls.find(c => /COUNT\(DISTINCT student_id\)/.test(c.text)),
    'option 1 must NOT consult quota — never gated');
  // No waitlist INSERT.
  assert.ok(!sql.calls.find(c => /INSERT INTO day1_waitlist/i.test(c.text)),
    'option 1 must NEVER add to waitlist');
  delete process.env.DAY1_QUOTA;
});

test('🛑 6/7 option 2 + new email + room → magic-link sent normally', async () => {
  process.env.DAY1_QUOTA = '100';
  const sql = mkSqlByTopic({ existingStudent: false, used: 50 });
  _setSqlClient(sql);
  const sentGuide = [];
  const sentMagic = [];
  _setSendGuideFn(async (e, l) => { sentGuide.push({ e, l }); });
  _setSendMagicLinkFn(async (e, l) => { sentMagic.push({ e, l }); });
  await handler(mockReq({ body: { email: 'new@example.com', option: 2 } }), mockRes());
  assert.equal(sentGuide.length, 0, 'option 2 does NOT send PDF');
  assert.equal(sentMagic.length, 1, 'option 2 + new + room → magic-link sent');
  delete process.env.DAY1_QUOTA;
});

test('🛑 6/7 option 2 + new email + quota full → NO magic-link, waitlist with source=request_guide', async () => {
  process.env.DAY1_QUOTA = '100';
  const sql = mkSqlByTopic({ existingStudent: false, used: 100 });
  _setSqlClient(sql);
  const sentMagic = [];
  _setSendMagicLinkFn(async (e) => { sentMagic.push(e); });
  await handler(mockReq({ body: { email: 'fresh@example.com', option: 2 } }), mockRes());
  assert.equal(sentMagic.length, 0, 'no magic-link when quota full');
  const waitlistCall = sql.calls.find(c => /INSERT INTO day1_waitlist/i.test(c.text));
  assert.ok(waitlistCall, 'waitlist INSERT must fire');
  assert.deepEqual(waitlistCall.values, ['fresh@example.com', 'request_guide']);
  delete process.env.DAY1_QUOTA;
});

test('🛑 6/7 option 3 + new email + full → PDF still sent + waitlist + NO magic-link', async () => {
  // Spec: "option 3 仍寄 PDF、email 進候補、不發 magic-link".
  process.env.DAY1_QUOTA = '100';
  const sql = mkSqlByTopic({ existingStudent: false, used: 100 });
  _setSqlClient(sql);
  const sentGuide = [];
  const sentMagic = [];
  _setSendGuideFn(async (e, l) => { sentGuide.push({ e, l }); });
  _setSendMagicLinkFn(async (e) => { sentMagic.push(e); });
  await handler(mockReq({ body: { email: 'fresh@example.com', option: 3 } }), mockRes());
  assert.equal(sentGuide.length, 1,
    'option 3 PDF must STILL be sent even when magic-link is waitlisted');
  assert.equal(sentMagic.length, 0,
    'magic-link must NOT be sent for waitlisted option 3');
  assert.ok(sql.calls.find(c => /INSERT INTO day1_waitlist/i.test(c.text)),
    'option 3 waitlist INSERT must fire');
  delete process.env.DAY1_QUOTA;
});

test('🛑 6/7 option 3 + existing student (回訪) → both PDF + magic-link sent (no quota check)', async () => {
  delete process.env.DAY1_QUOTA;
  const sql = mkSqlByTopic({ existingStudent: true, used: 99999 });
  _setSqlClient(sql);
  const sentGuide = [];
  const sentMagic = [];
  _setSendGuideFn(async (e, l) => { sentGuide.push({ e, l }); });
  _setSendMagicLinkFn(async (e, l) => { sentMagic.push({ e, l }); });
  await handler(mockReq({ body: { email: 'returning@example.com', option: 3 } }), mockRes());
  assert.equal(sentGuide.length, 1);
  assert.equal(sentMagic.length, 1, 'returning student passes regardless of quota');
  assert.ok(!sql.calls.find(c => /INSERT INTO day1_waitlist/i.test(c.text)));
});

test('🛑 6/7 gate throws on option 2 → fail-open (magic-link still sent)', async () => {
  process.env.DAY1_QUOTA = '100';
  _setSqlClient((strings) => {
    const text = strings.join('?');
    if (/INSERT INTO leads/i.test(text)) return Promise.resolve([]);
    if (/SELECT 1 FROM students/.test(text)) {
      return Promise.reject(new Error('gate down'));
    }
    return Promise.resolve([]);
  });
  const sentMagic = [];
  _setSendMagicLinkFn(async (e) => { sentMagic.push(e); });
  await handler(mockReq({ body: { email: 'x@y.z', option: 2 } }), mockRes());
  assert.equal(sentMagic.length, 1, 'gate failure → fail-open');
  delete process.env.DAY1_QUOTA;
});
