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
  const expiresIso = sql.calls[0].values[4];
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
