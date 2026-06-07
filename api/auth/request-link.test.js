// api/auth/request-link.test.js
// PR-4c-green Auth rebuild stage 1c — request-link endpoint.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, {
  _setSqlClient,
  _setSendMagicLinkFn,
  resolveBaseUrl,
} from './request-link.js';

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
// 5/29 Patrick (access gate) — find the magic-link INSERT among the new is_blocked
// SELECT + INSERT 2-call sequence. Existing tests assert INSERT shape; use this
// helper so order-of-queries can move without churning every test.
function findInsertCall(sql) {
  return sql.calls.find(c => /INSERT INTO magic_link_tokens/i.test(c.text));
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
  _setSendMagicLinkFn(null);
  process.env.APP_BASE_URL = 'https://preview.example.com';
  delete process.env.VERCEL_URL;
});

// ── valid request → always 200 + DB insert + link sent ──

test('🛑 handler: valid email → 200 ok:true + INSERT token + sendMagicLink called', async () => {
  const sql = makeMockSql([]);   // 1st call: students is_blocked lookup (empty) → not blocked, proceeds.
  _setSqlClient(sql);
  const sent = [];
  _setSendMagicLinkFn(async (email, link) => { sent.push({ email, link }); });

  const res = mockRes();
  await handler(mockReq({ body: { email: 'Vivi@Example.COM' } }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  // 5/29 Patrick (access gate) — query 順序 now: ① SELECT students.is_blocked ② INSERT magic_link_tokens.
  // Find INSERT by text-match (順序未來再變 test 仍綠).
  const insertCall = sql.calls.find(c => /INSERT INTO magic_link_tokens/i.test(c.text));
  assert.ok(insertCall, 'INSERT INTO magic_link_tokens must have happened');
  const vals = insertCall.values;
  // [tokenHash, email, preferredName, pace, expiresAt]
  assert.equal(vals[1], 'vivi@example.com', 'email normalized (lowercased + trimmed)');
  assert.equal(vals[2], null, 'no preferredName provided → null');
  assert.equal(vals[3], 'daily', 'pace defaults to "daily"');
  assert.match(vals[0], /^[a-f0-9]{64}$/, 'token_hash is sha256 hex (64 chars)');
  // sendMagicLink received the same email + link with the (un-hashed) token
  assert.equal(sent.length, 1);
  assert.equal(sent[0].email, 'vivi@example.com');
  assert.match(sent[0].link, /^https:\/\/preview\.example\.com\/auth\?token=[a-f0-9]{64}$/);
});

// 🛑 5/28 Vivi+Patrick — TTL 20→60 分鐘. 封測 real-data: A006 收信+點之間
// 最多 18 分鐘、3 筆過期裡 2 筆是 Vivi 自己沒點. 把 expires_at - now 鎖在
// 60 分鐘 ± 2 秒 (allow test execution drift).
test('🛑 TTL = 60 minutes (5/28 spec, was 20)', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  _setSendMagicLinkFn(async () => {});
  const tNow = Date.now();
  const res = mockRes();
  await handler(mockReq({ body: { email: 'a@b.com' } }), res);
  assert.equal(res.statusCode, 200);
  const expiresIso = findInsertCall(sql).values[4];
  assert.ok(typeof expiresIso === 'string', 'expiresAt should be ISO string');
  const ttlMs = new Date(expiresIso).getTime() - tNow;
  const SIXTY_MIN = 60 * 60 * 1000;
  assert.ok(Math.abs(ttlMs - SIXTY_MIN) < 2000,
    `expected ~60min TTL (${SIXTY_MIN}ms ± 2s); got ${ttlMs}ms`);
  // Defense: 必須 > 20 分鐘 + 1 秒 (證明真的從 20 改成 60、不是還是 20).
  assert.ok(ttlMs > 20 * 60 * 1000 + 1000,
    `regression: TTL must be > 20 min (got ${ttlMs}ms)`);
});

test('handler: preferredName + pace flow through to INSERT', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  _setSendMagicLinkFn(async () => {});
  const res = mockRes();
  await handler(mockReq({
    body: { email: 'a@b.com', preferredName: '小薇', pace: 'self-paced' },
  }), res);
  assert.equal(res.statusCode, 200);
  const vals = findInsertCall(sql).values;
  assert.equal(vals[2], '小薇');
  assert.equal(vals[3], 'self-paced');
});

// ── envelope must always be {ok:true} — no email-existence leak ──

test('🛑 handler: invalid email shape → STILL 200 ok:true (no leak)', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  _setSendMagicLinkFn(async () => {});
  for (const bad of [{}, { email: '' }, { email: 'no-at-sign' }, { email: 42 }, null]) {
    const res = mockRes();
    await handler(mockReq({ body: bad }), res);
    assert.equal(res.statusCode, 200, `body=${JSON.stringify(bad)} → must still 200`);
    assert.deepEqual(res.body, { ok: true });
  }
  assert.equal(sql.calls.length, 0, 'invalid input must not touch DB');
});

test('🛑 handler: DB throw → STILL 200 ok:true (no leak, server-side log only)', async () => {
  _setSqlClient(() => { throw new Error('db boom'); });
  _setSendMagicLinkFn(async () => {});
  const res = mockRes();
  await handler(mockReq({ body: { email: 'a@b.com' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('🛑 handler: sendMagicLink throws → STILL 200 ok:true', async () => {
  _setSqlClient(makeMockSql([]));
  _setSendMagicLinkFn(async () => { throw new Error('brevo down'); });
  const res = mockRes();
  await handler(mockReq({ body: { email: 'a@b.com' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

// ── token security properties ──

test('🛑 handler: tokens are random per request (no replay across requests)', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  _setSendMagicLinkFn(async () => {});
  await handler(mockReq({ body: { email: 'a@b.com' } }), mockRes());
  await handler(mockReq({ body: { email: 'a@b.com' } }), mockRes());
  // After the access-gate SELECT precedes the INSERT, find the 2 INSERT calls.
  const inserts = sql.calls.filter(c => /INSERT INTO magic_link_tokens/i.test(c.text));
  assert.equal(inserts.length, 2, 'two INSERTs (one per request)');
  assert.notEqual(inserts[0].values[0], inserts[1].values[0],
    'each request must mint a fresh token_hash');
});

test('🛑 handler: token_hash stored, not raw token (DB dump can\'t replay)', async () => {
  // verify the values[0] (token_hash) is NOT also in the link URL.
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  let capturedLink = null;
  _setSendMagicLinkFn(async (_email, link) => { capturedLink = link; });
  await handler(mockReq({ body: { email: 'a@b.com' } }), mockRes());
  const storedHash = findInsertCall(sql).values[0];
  const rawToken = capturedLink.match(/token=([a-f0-9]{64})/)[1];
  assert.notEqual(storedHash, rawToken, 'DB hash must not equal the URL token');
  // verify the relationship: sha256(rawToken) === storedHash
  const { createHash } = await import('node:crypto');
  const expectedHash = createHash('sha256').update(rawToken).digest('hex');
  assert.equal(expectedHash, storedHash);
});

// ── resolveBaseUrl (PR-4c-green Auth rebuild 1g — fallback chain) ──

test('🛑 resolveBaseUrl: APP_BASE_URL wins when present + http(s)-prefixed', () => {
  process.env.APP_BASE_URL = 'https://preview.example.com';
  process.env.VERCEL_URL = 'random-vercel.app';
  assert.equal(resolveBaseUrl(), 'https://preview.example.com');
});

test('🛑 resolveBaseUrl: APP_BASE_URL with trailing slashes → stripped', () => {
  process.env.APP_BASE_URL = 'https://preview.example.com/////';
  assert.equal(resolveBaseUrl(), 'https://preview.example.com');
});

test('🛑 resolveBaseUrl: APP_BASE_URL missing → falls back to https://${VERCEL_URL}', () => {
  delete process.env.APP_BASE_URL;
  process.env.VERCEL_URL = 'my-preview-abc123.vercel.app';
  assert.equal(resolveBaseUrl(), 'https://my-preview-abc123.vercel.app');
});

test('🛑 resolveBaseUrl: APP_BASE_URL malformed (no http://) → falls back to VERCEL_URL', () => {
  // Vivi-was-here scenario: someone sets APP_BASE_URL='preview.example.com'
  // forgetting the scheme. We treat that as malformed + fall through.
  process.env.APP_BASE_URL = 'preview.example.com';
  process.env.VERCEL_URL = 'my-vercel.app';
  assert.equal(resolveBaseUrl(), 'https://my-vercel.app');
});

test('🛑 resolveBaseUrl: VERCEL_URL with stray https:// prefix → not double-prepended', () => {
  // Defensive: if some env-loader weirdly sets VERCEL_URL = 'https://x' we
  // strip the duplicated scheme rather than producing 'https://https://x'.
  delete process.env.APP_BASE_URL;
  process.env.VERCEL_URL = 'https://x.vercel.app';
  assert.equal(resolveBaseUrl(), 'https://x.vercel.app');
});

test('🛑 resolveBaseUrl: both env vars unset → localhost fallback (dev only)', () => {
  delete process.env.APP_BASE_URL;
  delete process.env.VERCEL_URL;
  assert.equal(resolveBaseUrl(), 'http://localhost:3000');
});

test('🛑 resolveBaseUrl: APP_BASE_URL whitespace → trimmed before scheme check', () => {
  process.env.APP_BASE_URL = '  https://preview.example.com  ';
  assert.equal(resolveBaseUrl(), 'https://preview.example.com');
});

test('🛑 handler: VERCEL_URL fallback flows into magic-link URL when APP_BASE_URL missing', async () => {
  delete process.env.APP_BASE_URL;
  process.env.VERCEL_URL = 'my-preview.vercel.app';
  _setSqlClient(makeMockSql([]));
  let capturedLink = null;
  _setSendMagicLinkFn(async (_email, link) => { capturedLink = link; });
  await handler(mockReq({ body: { email: 'a@b.com' } }), mockRes());
  assert.match(capturedLink, /^https:\/\/my-preview\.vercel\.app\/auth\?token=[a-f0-9]{64}$/);
});

// ── method enforcement ──

test('handler: non-POST → 405', async () => {
  _setSqlClient(makeMockSql([]));
  _setSendMagicLinkFn(async () => {});
  const res = mockRes();
  await handler(mockReq({ method: 'GET', body: { email: 'a@b.com' } }), res);
  assert.equal(res.statusCode, 405);
});

// ═════════════════════════════════════════════════════════
// 🛑 5/29 Patrick (Vivi access gate) — silently 不寄信給 blocked 學員
// ═════════════════════════════════════════════════════════

test('🛑 request-link: is_blocked=true → 200 ok:true but NO INSERT + NO sendMagicLink (silent skip)', async () => {
  // 1st query (students SELECT) returns blocked row.
  let queryIdx = 0;
  const calls = [];
  _setSqlClient((strings, ...values) => {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''),
      '',
    );
    calls.push({ text, values });
    if (queryIdx++ === 0) {
      // students lookup → blocked
      return Promise.resolve([{ student_id: 'A001', is_blocked: true }]);
    }
    return Promise.resolve([]);
  });
  const sent = [];
  _setSendMagicLinkFn(async (email, link) => { sent.push({ email, link }); });

  const res = mockRes();
  await handler(mockReq({ body: { email: 'blocked@example.com' } }), res);

  // 仍回 200 ok:true (跟未註冊 case 同一回應, 不洩漏帳號狀態).
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  // 但沒 INSERT magic_link_tokens, 也沒寄信.
  assert.equal(sent.length, 0, 'blocked 學員不能寄 magic link');
  assert.equal(calls.some(c => /INSERT INTO magic_link_tokens/i.test(c.text)), false,
    'blocked 學員不能新增 token row');
});

test('🛑 request-link: is_blocked lookup fails → fail-open (寧可寄出去也不誤鎖)', async () => {
  // 1st call (students SELECT) throws; subsequent calls (INSERT) succeed.
  let queryIdx = 0;
  _setSqlClient((strings, ...values) => {
    if (queryIdx++ === 0) return Promise.reject(new Error('students lookup down'));
    return Promise.resolve([]);
  });
  const sent = [];
  _setSendMagicLinkFn(async (email, link) => { sent.push({ email, link }); });
  const res = mockRes();
  await handler(mockReq({ body: { email: 'a@b.com' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sent.length, 1, 'lookup 失敗時 fail-open 仍寄信');
});

// ═════════════════════════════════════════════════════════
// 🛑 Patrick 6/7 Day-1 monthly quota gate (3 funnel pitfalls fixed)
// ═════════════════════════════════════════════════════════

// SQL plan helper — routes each query by its text content rather than call-order
// (the gate flow changes call ordering as new branches are added).
function mkSqlByTopic({ existingStudent, used }) {
  const calls = [];
  const fn = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    // is_blocked guard: SELECT student_id, is_blocked
    if (/SELECT student_id, is_blocked/.test(text)) {
      return Promise.resolve(existingStudent
        ? [{ student_id: 'A123', is_blocked: false }] : []);
    }
    // decideDay1Gate isExistingStudent: SELECT 1 FROM students
    if (/SELECT 1 FROM students/.test(text)) {
      return Promise.resolve(existingStudent ? [{ exists: 1 }] : []);
    }
    // decideDay1Gate countUsedThisMonth
    if (/COUNT\(DISTINCT student_id\)/.test(text)) {
      return Promise.resolve([{ used }]);
    }
    // waitlist INSERT / magic-link INSERT
    return Promise.resolve([]);
  };
  fn.calls = calls;
  return fn;
}

test('🛑 6/7 坑 1: existing student (回訪) → always pass, no quota check, no waitlist', async () => {
  delete process.env.DAY1_QUOTA;
  const sql = mkSqlByTopic({ existingStudent: true, used: 99999 });
  _setSqlClient(sql);
  const sent = [];
  _setSendMagicLinkFn(async (email, link) => { sent.push({ email, link }); });
  const res = mockRes();
  await handler(mockReq({ body: { email: 'returning@example.com' } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sent.length, 1, 'returning student must always receive magic-link');
  assert.ok(sql.calls.find(c => /INSERT INTO magic_link_tokens/i.test(c.text)),
    'magic-link INSERT must fire for returning student');
  assert.ok(!sql.calls.find(c => /INSERT INTO day1_waitlist/i.test(c.text)),
    'returning student must NEVER be added to waitlist');
});

test('🛑 6/7 new email + room (used < quota) → pass, magic-link sent', async () => {
  process.env.DAY1_QUOTA = '100';
  const sql = mkSqlByTopic({ existingStudent: false, used: 50 });
  _setSqlClient(sql);
  const sent = [];
  _setSendMagicLinkFn(async (e, l) => { sent.push({ email: e, link: l }); });
  const res = mockRes();
  await handler(mockReq({ body: { email: 'new@example.com' } }), res);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sent.length, 1);
  assert.ok(sql.calls.find(c => /INSERT INTO magic_link_tokens/i.test(c.text)));
  assert.ok(!sql.calls.find(c => /INSERT INTO day1_waitlist/i.test(c.text)));
  delete process.env.DAY1_QUOTA;
});

test('🛑 6/7 new email + quota full → NO magic-link, waitlist INSERT, same ok:true envelope', async () => {
  process.env.DAY1_QUOTA = '100';
  const sql = mkSqlByTopic({ existingStudent: false, used: 100 });
  _setSqlClient(sql);
  const sent = [];
  _setSendMagicLinkFn(async (e, l) => { sent.push({ email: e, link: l }); });
  const res = mockRes();
  await handler(mockReq({ body: { email: 'fresh@example.com' } }), res);
  // Envelope identical (no leak).
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  // Magic-link NOT sent.
  assert.equal(sent.length, 0, 'quota-full new email must NOT receive magic-link');
  // No magic_link_tokens INSERT.
  assert.ok(!sql.calls.find(c => /INSERT INTO magic_link_tokens/i.test(c.text)),
    'no magic_link_tokens row when waitlisted');
  // Waitlist INSERT recorded.
  const waitlistCall = sql.calls.find(c => /INSERT INTO day1_waitlist/i.test(c.text));
  assert.ok(waitlistCall, 'waitlist INSERT must fire');
  assert.deepEqual(waitlistCall.values, ['fresh@example.com', 'request_link']);
  delete process.env.DAY1_QUOTA;
});

test('🛑 6/7 over-cap (used > quota — soft overage) → still waitlist new emails', async () => {
  process.env.DAY1_QUOTA = '100';
  const sql = mkSqlByTopic({ existingStudent: false, used: 105 });
  _setSqlClient(sql);
  const sent = [];
  _setSendMagicLinkFn(async (e) => { sent.push(e); });
  await handler(mockReq({ body: { email: 'x@y.z' } }), mockRes());
  assert.equal(sent.length, 0);
  assert.ok(sql.calls.find(c => /INSERT INTO day1_waitlist/i.test(c.text)));
  delete process.env.DAY1_QUOTA;
});

test('🛑 6/7 gate throws → fail-open (still send magic-link rather than lock funnel)', async () => {
  // Gate helper failing must not bring the funnel down. Mild overage > outage.
  _setSqlClient((strings, ..._v) => {
    const text = strings.join('?');
    if (/SELECT student_id, is_blocked/.test(text)) return Promise.resolve([]);
    if (/SELECT 1 FROM students/.test(text)) {
      return Promise.reject(new Error('gate SELECT down'));
    }
    return Promise.resolve([]);
  });
  const sent = [];
  _setSendMagicLinkFn(async (e) => { sent.push(e); });
  await handler(mockReq({ body: { email: 'x@y.z' } }), mockRes());
  assert.equal(sent.length, 1, 'gate failure → fail-open, magic-link still sent');
});
