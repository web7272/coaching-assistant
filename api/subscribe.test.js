// api/subscribe.test.js
// Vivi 7/30 seminar 上線 — subscribe endpoint tests.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import handler, {
  _setSqlClient,
  _setAddToSeminarListFn,
  _setSendSeminarConfirmationFn,
  parseMultipart,
  readBody,
  normalizeEmail,
  resolveBaseUrl,
} from './subscribe.js';

// ─── mock helpers ────────────────────────────────────────

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

function mockReq({ method = 'POST', body, headers = {} } = {}) {
  return {
    method,
    body,
    headers: {
      // default; override via headers arg
      ...headers,
    },
  };
}

function mockRes() {
  const r = {
    statusCode: 200,
    body: null,
    _headers: {},
    _ended: false,
    status(s) { r.statusCode = s; return r; },
    json(b)   { r.body = b; r._ended = true; return r; },
    setHeader(k, v) { r._headers[k.toLowerCase()] = v; return r; },
    end()     { r._ended = true; return r; },
  };
  return r;
}

// ─── env / seam save + restore ───────────────────────────

let _savedEnv;
beforeEach(() => {
  _savedEnv = {
    APP_BASE_URL:    process.env.APP_BASE_URL,
    VERCEL_URL:      process.env.VERCEL_URL,
    BREVO_API_KEY:   process.env.BREVO_API_KEY,
    SEMINAR_LIST_ID: process.env.SEMINAR_LIST_ID,
  };
  process.env.APP_BASE_URL = 'https://preview.example.com';
  delete process.env.VERCEL_URL;
  delete process.env.BREVO_API_KEY;
  delete process.env.SEMINAR_LIST_ID;
  _setSqlClient(null);
  _setAddToSeminarListFn(null);
  _setSendSeminarConfirmationFn(null);
});
afterEach(() => {
  for (const k of Object.keys(_savedEnv)) {
    if (_savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = _savedEnv[k];
  }
  _setSqlClient(null);
  _setAddToSeminarListFn(null);
  _setSendSeminarConfirmationFn(null);
});

// ═════════════════════════════════════════════════════════
// method guard
// ═════════════════════════════════════════════════════════

test('🛑 handler: non-POST → 405 with Allow: POST', async () => {
  const res = mockRes();
  await handler(mockReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.body.ok, false);
  assert.equal(res._headers['allow'], 'POST');
});

// ═════════════════════════════════════════════════════════
// happy path — JS fetch (Accept: application/json)
// ═════════════════════════════════════════════════════════

test('🛑 handler: JS fetch → 200 {ok:true} + Neon INSERT + Brevo list add + confirmation email', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const addCalls  = [];
  const sendCalls = [];
  _setAddToSeminarListFn(async (email, attrs) => { addCalls.push({ email, attrs }); return { ok: true }; });
  _setSendSeminarConfirmationFn(async (email, url) => { sendCalls.push({ email, url }); return { ok: true }; });

  const res = mockRes();
  await handler(mockReq({
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body:    { email: 'Vivi@Example.COM', question: '為什麼？', source: 'hero' },
  }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });

  // Neon INSERT: email normalized, question + source verbatim
  const insert = sql.calls.find(c => /INSERT INTO seminar_signups/i.test(c.text));
  assert.ok(insert, 'INSERT INTO seminar_signups must run');
  assert.equal(insert.values[0], 'vivi@example.com', 'email normalized');
  assert.equal(insert.values[1], '為什麼？');
  assert.equal(insert.values[2], 'hero');

  // Brevo list add
  assert.equal(addCalls.length, 1);
  assert.equal(addCalls[0].email, 'vivi@example.com');
  assert.equal(addCalls[0].attrs.question, '為什麼？');
  assert.equal(addCalls[0].attrs.source, 'hero');

  // Brevo confirmation email (thanksUrl uses APP_BASE_URL)
  assert.equal(sendCalls.length, 1);
  assert.equal(sendCalls[0].email, 'vivi@example.com');
  assert.equal(sendCalls[0].url, 'https://preview.example.com/seminar/thanks');
});

// ═════════════════════════════════════════════════════════
// happy path — native form (no Accept → 303)
// ═════════════════════════════════════════════════════════

test('🛑 handler: native form (no Accept header) → 303 Location:/seminar/thanks', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  _setAddToSeminarListFn(async () => ({ ok: true }));
  _setSendSeminarConfirmationFn(async () => ({ ok: true }));

  const res = mockRes();
  await handler(mockReq({
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body:    { email: 'a@b.co', question: 'q', source: 'signup' },
  }), res);

  assert.equal(res.statusCode, 303);
  assert.equal(res._headers['location'], '/seminar/thanks');
  assert.equal(res._ended, true);
});

test('🛑 handler: Accept: text/html → 303 (native form treatment)', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  _setAddToSeminarListFn(async () => ({ ok: true }));
  _setSendSeminarConfirmationFn(async () => ({ ok: true }));

  const res = mockRes();
  await handler(mockReq({
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'accept': 'text/html' },
    body:    { email: 'a@b.co', question: 'q', source: 'signup' },
  }), res);

  assert.equal(res.statusCode, 303);
  assert.equal(res._headers['location'], '/seminar/thanks');
});

// ═════════════════════════════════════════════════════════
// invalid email → still respond ok (attacker probing envelope)
// ═════════════════════════════════════════════════════════

test('🛑 handler: invalid email → 200 ok (no INSERT / no Brevo)', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const addCalls  = [];
  const sendCalls = [];
  _setAddToSeminarListFn(async () => { addCalls.push(1);  return { ok: true }; });
  _setSendSeminarConfirmationFn(async () => { sendCalls.push(1); return { ok: true }; });

  const res = mockRes();
  await handler(mockReq({
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body:    { email: 'not-an-email', question: 'q', source: 'hero' },
  }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sql.calls.length, 0, 'no DB call for invalid email');
  assert.equal(addCalls.length,  0, 'no Brevo add for invalid email');
  assert.equal(sendCalls.length, 0, 'no Brevo send for invalid email');
});

test('🛑 handler: missing email → 200 ok (envelope, no side effects)', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  _setAddToSeminarListFn(async () => ({ ok: true }));
  _setSendSeminarConfirmationFn(async () => ({ ok: true }));

  const res = mockRes();
  await handler(mockReq({
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body:    {},
  }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('🛑 handler: invalid email via native form → still 303 (envelope)', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  _setAddToSeminarListFn(async () => ({ ok: true }));
  _setSendSeminarConfirmationFn(async () => ({ ok: true }));

  const res = mockRes();
  await handler(mockReq({
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body:    { email: 'bad', question: 'q' },
  }), res);
  assert.equal(res.statusCode, 303);
  assert.equal(res._headers['location'], '/seminar/thanks');
});

// ═════════════════════════════════════════════════════════
// side-effect failures never leak out
// ═════════════════════════════════════════════════════════

test('🛑 handler: Neon throw → still 200 ok:true', async () => {
  const throwingSql = () => { throw new Error('DB down'); };
  throwingSql.calls = [];
  _setSqlClient(throwingSql);
  _setAddToSeminarListFn(async () => ({ ok: true }));
  _setSendSeminarConfirmationFn(async () => ({ ok: true }));

  const res = mockRes();
  await handler(mockReq({
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body:    { email: 'a@b.co', question: 'q', source: 'hero' },
  }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { ok: true });
});

test('🛑 handler: Brevo list-add throw → still 200 ok:true', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  _setAddToSeminarListFn(async () => { throw new Error('brevo boom'); });
  _setSendSeminarConfirmationFn(async () => ({ ok: true }));

  const res = mockRes();
  await handler(mockReq({
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body:    { email: 'a@b.co', question: 'q', source: 'hero' },
  }), res);
  assert.equal(res.statusCode, 200);
});

test('🛑 handler: Brevo confirmation-email throw → still 200 ok:true', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  _setAddToSeminarListFn(async () => ({ ok: true }));
  _setSendSeminarConfirmationFn(async () => { throw new Error('mail down'); });

  const res = mockRes();
  await handler(mockReq({
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body:    { email: 'a@b.co', question: 'q', source: 'hero' },
  }), res);
  assert.equal(res.statusCode, 200);
});

// ═════════════════════════════════════════════════════════
// source / question defaults
// ═════════════════════════════════════════════════════════

test('🛑 handler: source missing → INSERT uses "unknown"', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  _setAddToSeminarListFn(async () => ({ ok: true }));
  _setSendSeminarConfirmationFn(async () => ({ ok: true }));

  const res = mockRes();
  await handler(mockReq({
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body:    { email: 'a@b.co', question: 'q' },
  }), res);
  const insert = sql.calls.find(c => /INSERT INTO seminar_signups/i.test(c.text));
  assert.equal(insert.values[2], 'unknown');
});

test('🛑 handler: empty question → INSERT NULL (not empty string)', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  _setAddToSeminarListFn(async () => ({ ok: true }));
  _setSendSeminarConfirmationFn(async () => ({ ok: true }));

  const res = mockRes();
  await handler(mockReq({
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body:    { email: 'a@b.co', source: 'hero' },
  }), res);
  const insert = sql.calls.find(c => /INSERT INTO seminar_signups/i.test(c.text));
  assert.equal(insert.values[1], null);
});

test('🛑 handler: question over 4000 chars → truncated', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  _setAddToSeminarListFn(async () => ({ ok: true }));
  _setSendSeminarConfirmationFn(async () => ({ ok: true }));

  const res = mockRes();
  const long = 'x'.repeat(5000);
  await handler(mockReq({
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body:    { email: 'a@b.co', question: long, source: 'hero' },
  }), res);
  const insert = sql.calls.find(c => /INSERT INTO seminar_signups/i.test(c.text));
  assert.equal(insert.values[1].length, 4000);
});

// ═════════════════════════════════════════════════════════
// parseMultipart (unit)
// ═════════════════════════════════════════════════════════

test('parseMultipart: v12 HTML 3 text fields (email / question / source)', () => {
  const boundary = '----WebKitFormBoundary123';
  const ct = `multipart/form-data; boundary=${boundary}`;
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="email"\r\n\r\n` +
    `a@b.co\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="question"\r\n\r\n` +
    `為什麼？\r\n` +
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="source"\r\n\r\n` +
    `hero\r\n` +
    `--${boundary}--\r\n`;
  const result = parseMultipart(Buffer.from(body, 'utf8'), ct);
  assert.deepEqual(result, { email: 'a@b.co', question: '為什麼？', source: 'hero' });
});

test('parseMultipart: quoted boundary attribute', () => {
  const ct = `multipart/form-data; boundary="abc"`;
  const body =
    `--abc\r\n` +
    `Content-Disposition: form-data; name="x"\r\n\r\n` +
    `1\r\n` +
    `--abc--\r\n`;
  assert.deepEqual(parseMultipart(Buffer.from(body), ct), { x: '1' });
});

test('parseMultipart: no boundary → {}', () => {
  assert.deepEqual(parseMultipart(Buffer.from(''), 'multipart/form-data'), {});
});

test('parseMultipart: preserves UTF-8 multi-byte content', () => {
  const boundary = 'xyz';
  const ct = `multipart/form-data; boundary=${boundary}`;
  const utf8Value = '關於自己的問題？「為什麼」';
  const body =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="q"\r\n\r\n` +
    `${utf8Value}\r\n` +
    `--${boundary}--\r\n`;
  const result = parseMultipart(Buffer.from(body, 'utf8'), ct);
  assert.equal(result.q, utf8Value);
});

// ═════════════════════════════════════════════════════════
// readBody — pre-parsed pass-through
// ═════════════════════════════════════════════════════════

test('readBody: Vercel already parsed req.body → pass-through', async () => {
  const req = { headers: { 'content-type': 'application/json' }, body: { a: 1, b: 'x' } };
  assert.deepEqual(await readBody(req), { a: 1, b: 'x' });
});

// ═════════════════════════════════════════════════════════
// resolveBaseUrl (fallback chain — mirror request-link.js)
// ═════════════════════════════════════════════════════════

test('resolveBaseUrl: APP_BASE_URL → strip trailing slash', () => {
  process.env.APP_BASE_URL = 'https://x.com/';
  assert.equal(resolveBaseUrl(), 'https://x.com');
});

test('resolveBaseUrl: APP_BASE_URL missing → VERCEL_URL (add scheme)', () => {
  delete process.env.APP_BASE_URL;
  process.env.VERCEL_URL = 'preview-xyz.vercel.app';
  assert.equal(resolveBaseUrl(), 'https://preview-xyz.vercel.app');
});

test('resolveBaseUrl: both missing → seeyourself.now fallback', () => {
  delete process.env.APP_BASE_URL;
  delete process.env.VERCEL_URL;
  assert.equal(resolveBaseUrl(), 'https://seeyourself.now');
});

test('resolveBaseUrl: bogus APP_BASE_URL (no scheme) → falls through', () => {
  process.env.APP_BASE_URL = 'not-a-url';
  process.env.VERCEL_URL = 'v.example.com';
  assert.equal(resolveBaseUrl(), 'https://v.example.com');
});

// ═════════════════════════════════════════════════════════
// normalizeEmail
// ═════════════════════════════════════════════════════════

test('normalizeEmail: trim + lowercase', () => {
  assert.equal(normalizeEmail('  Vivi@Example.COM '), 'vivi@example.com');
});

test('normalizeEmail: non-string → empty', () => {
  assert.equal(normalizeEmail(null), '');
  assert.equal(normalizeEmail(undefined), '');
  assert.equal(normalizeEmail(123), '');
  assert.equal(normalizeEmail({ email: 'a@b.co' }), '');
});
