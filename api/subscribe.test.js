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
  isValidEmail,
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
// invalid email → 400 早退 (Vivi 8/14: 不送垃圾往下游 Brevo)
// ═════════════════════════════════════════════════════════

test('🛑 8/14 handler: invalid email → 400 (no INSERT / no Brevo)', async () => {
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

  assert.equal(res.statusCode, 400);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.error, 'invalid_email');
  assert.equal(sql.calls.length, 0, 'no DB call for invalid email');
  assert.equal(addCalls.length,  0, 'no Brevo add for invalid email');
  assert.equal(sendCalls.length, 0, 'no Brevo send for invalid email');
});

test('🛑 8/14 handler: missing email → 400', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  _setAddToSeminarListFn(async () => ({ ok: true }));
  _setSendSeminarConfirmationFn(async () => ({ ok: true }));

  const res = mockRes();
  await handler(mockReq({
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body:    {},
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'invalid_email');
});

test('🛑 8/14 handler: multipart raw body 誤當 email (root cause) → 400 早退', async () => {
  // Simulate the exact prod bug: FormData 送 multipart, Vercel 沒 parse,
  // body.email 變成 raw boundary string.
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  const addCalls  = [];
  const sendCalls = [];
  _setAddToSeminarListFn(async () => { addCalls.push(1);  return { ok: true }; });
  _setSendSeminarConfirmationFn(async () => { sendCalls.push(1); return { ok: true }; });

  const res = mockRes();
  await handler(mockReq({
    headers: { 'content-type': 'application/json', 'accept': 'application/json' },
    body:    { email: '------WebKitFormBoundary2xgxJUNK\r\nContent-Disposition: form-data...', question: 'q' },
  }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(addCalls.length, 0, 'raw multipart 不能送到 Brevo (root cause 已修)');
  assert.equal(sendCalls.length, 0);
});

test('🛑 8/14 handler: invalid email via native form → 也 400 (不再 303 到 thanks)', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  _setAddToSeminarListFn(async () => ({ ok: true }));
  _setSendSeminarConfirmationFn(async () => ({ ok: true }));

  const res = mockRes();
  await handler(mockReq({
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body:    { email: 'bad', question: 'q' },
  }), res);
  assert.equal(res.statusCode, 400);
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

// ═════════════════════════════════════════════════════════
// isValidEmail (Vivi 8/14: email gate 早退避免垃圾往下游 Brevo)
// ═════════════════════════════════════════════════════════

test('isValidEmail: valid formats', () => {
  assert.equal(isValidEmail('a@b.co'), true);
  assert.equal(isValidEmail('vivi@example.com'), true);
  assert.equal(isValidEmail('user.name+tag@sub.example.co.uk'), true);
});

test('isValidEmail: invalid formats', () => {
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail('a@b'), false, '無 tld');
  assert.equal(isValidEmail('@b.co'), false);
  assert.equal(isValidEmail('a@'), false);
  assert.equal(isValidEmail('a @b.co'), false, '含空白');
  assert.equal(isValidEmail('a\n@b.co'), false, '含換行');
});

test('isValidEmail: length > 254 → false (Brevo 400 Email length exceeded)', () => {
  const long = 'a'.repeat(250) + '@b.co';
  assert.equal(long.length > 254, true);
  assert.equal(isValidEmail(long), false);
});

test('isValidEmail: multipart boundary 字串 → false (Vivi 8/14 root cause)', () => {
  const raw = '------WebKitFormBoundary2xgxJUNK\r\nContent-Disposition: form-data; name="email"\r\n\r\niamvivi@gmail.com';
  assert.equal(isValidEmail(raw), false, '整包 raw body 絕不能通過');
});

test('isValidEmail: non-string → false', () => {
  assert.equal(isValidEmail(null), false);
  assert.equal(isValidEmail(undefined), false);
  assert.equal(isValidEmail(123), false);
});

// ═════════════════════════════════════════════════════════
// 8/14 Vivi 診斷: mailer 走 stub (env 缺) → 靜默失敗. 加聚合 log 讓 Vercel
// dashboard grep [SUBSCRIBE:STUB] 直接看到 root cause.
// ═════════════════════════════════════════════════════════

test('🛑 8/14 handler: brevo mailer 回 stubbed → [SUBSCRIBE:STUB] error 一條聚合 log', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  _setAddToSeminarListFn(async () => ({ ok: true, stubbed: true, envMissing: true, reason: 'SEMINAR_LIST_ID not configured' }));
  _setSendSeminarConfirmationFn(async () => ({ ok: true, stubbed: true, envMissing: true, reason: 'BREVO_API_KEY not configured' }));

  const errs = [];
  const origErr = console.error;
  console.error = (...args) => errs.push(args.join(' '));

  try {
    const res = mockRes();
    await handler(mockReq({
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body:    { email: 'a@b.co', question: 'q', source: 'hero' },
    }), res);

    assert.equal(res.statusCode, 200);
    // 聚合 log 必須出現, 且包含兩個 stubbed 部件
    const stubLog = errs.find(l => l.includes('[SUBSCRIBE:STUB]'));
    assert.ok(stubLog, `[SUBSCRIBE:STUB] 聚合 log 必須寫出來讓 Vercel logs grep 到. errs=${JSON.stringify(errs)}`);
    assert.match(stubLog, /list\(SEMINAR_LIST_ID/);
    assert.match(stubLog, /mail\(BREVO_API_KEY/);
    assert.match(stubLog, /a@b\.co/);
    assert.match(stubLog, /BREVO_API_KEY \/ SEMINAR_LIST_ID/, 'log 明示要查的 env 名稱');
  } finally {
    console.error = origErr;
  }
});

test('🛑 8/14 handler: mailer 都正常 → 不寫 [SUBSCRIBE:STUB] (無誤報)', async () => {
  const sql = makeMockSql([]);
  _setSqlClient(sql);
  _setAddToSeminarListFn(async () => ({ ok: true, status: 201 }));
  _setSendSeminarConfirmationFn(async () => ({ ok: true, status: 201 }));

  const errs = [];
  const origErr = console.error;
  console.error = (...args) => errs.push(args.join(' '));

  try {
    const res = mockRes();
    await handler(mockReq({
      headers: { 'content-type': 'application/json', 'accept': 'application/json' },
      body:    { email: 'a@b.co', question: 'q', source: 'hero' },
    }), res);
    assert.equal(res.statusCode, 200);
    assert.equal(errs.filter(l => l.includes('[SUBSCRIBE:STUB]')).length, 0, '正常路徑不能誤報 stub');
  } finally {
    console.error = origErr;
  }
});
