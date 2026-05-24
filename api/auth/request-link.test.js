// api/auth/request-link.test.js
// PR-4c-green Auth rebuild stage 1c — request-link endpoint.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, { _setSqlClient, _setSendMagicLinkFn } from './request-link.js';

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
});

// ── valid request → always 200 + DB insert + link sent ──

test('🛑 handler: valid email → 200 ok:true + INSERT token + sendMagicLink called', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const sent = [];
  _setSendMagicLinkFn(async (email, link) => { sent.push({ email, link }); });

  const res = mockRes();
  await handler(mockReq({ body: { email: 'Vivi@Example.COM' } }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sql.calls.length, 1);
  assert.match(sql.calls[0].text, /INSERT INTO magic_link_tokens/i);
  const vals = sql.calls[0].values;
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

test('handler: preferredName + pace flow through to INSERT', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  _setSendMagicLinkFn(async () => {});
  const res = mockRes();
  await handler(mockReq({
    body: { email: 'a@b.com', preferredName: '小薇', pace: 'self-paced' },
  }), res);
  assert.equal(res.statusCode, 200);
  const vals = sql.calls[0].values;
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
  assert.notEqual(sql.calls[0].values[0], sql.calls[1].values[0],
    'each request must mint a fresh token_hash');
});

test('🛑 handler: token_hash stored, not raw token (DB dump can\'t replay)', async () => {
  // verify the values[0] (token_hash) is NOT also in the link URL.
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  let capturedLink = null;
  _setSendMagicLinkFn(async (_email, link) => { capturedLink = link; });
  await handler(mockReq({ body: { email: 'a@b.com' } }), mockRes());
  const storedHash = sql.calls[0].values[0];
  const rawToken = capturedLink.match(/token=([a-f0-9]{64})/)[1];
  assert.notEqual(storedHash, rawToken, 'DB hash must not equal the URL token');
  // verify the relationship: sha256(rawToken) === storedHash
  const { createHash } = await import('node:crypto');
  const expectedHash = createHash('sha256').update(rawToken).digest('hex');
  assert.equal(expectedHash, storedHash);
});

// ── method enforcement ──

test('handler: non-POST → 405', async () => {
  _setSqlClient(makeMockSql([]));
  _setSendMagicLinkFn(async () => {});
  const res = mockRes();
  await handler(mockReq({ method: 'GET', body: { email: 'a@b.com' } }), res);
  assert.equal(res.statusCode, 405);
});
