// api/stripe-webhook.test.js
// Patrick 5/26 — Stage 3 webhook 簽章驗 + plan 升級.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, {
  _setStripeFactory,
  _setSqlClient,
  _setRawBodyFn,
  readRawBody,
} from './stripe-webhook.js';

function makeMockSql() {
  const calls = [];
  const fn = (strings, ...values) => {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''),
      '',
    );
    calls.push({ strings: Array.from(strings), values, text });
    return Promise.resolve([]);
  };
  fn.calls = calls;
  return fn;
}

function mockReq({ method = 'POST', headers = {}, body = '' } = {}) {
  return { method, headers, body };
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
  _setStripeFactory(null);
  _setSqlClient(null);
  _setRawBodyFn(null);
  process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
  process.env.STRIPE_WEBHOOK_SECRET = 'whsec_xxx';
});

// ═════════════════════════════════════════════════════════
// method + signature
// ═════════════════════════════════════════════════════════

test('non-POST → 405', async () => {
  const res = mockRes();
  await handler(mockReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
});

test('🛑 missing / bad signature → 400 invalid_signature', async () => {
  _setRawBodyFn(async () => Buffer.from('{"fake":"event"}'));
  _setStripeFactory(() => ({
    webhooks: {
      constructEvent: () => { throw new Error('No signatures found matching the expected signature'); },
    },
  }));
  const sql = makeMockSql();
  _setSqlClient(sql);

  const res = mockRes();
  await handler(mockReq({ headers: {} }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'invalid_signature');
  assert.equal(sql.calls.length, 0, 'no SQL on bad signature — no plan upgrade');
});

// ═════════════════════════════════════════════════════════
// checkout.session.completed → UPDATE plan='plan_a' for sid
// ═════════════════════════════════════════════════════════

test('🛑 checkout.session.completed → UPDATE students SET plan=plan_a WHERE student_id=sid', async () => {
  _setRawBodyFn(async () => Buffer.from('{"id":"evt_test"}'));
  _setStripeFactory(() => ({
    webhooks: {
      constructEvent: () => ({
        type: 'checkout.session.completed',
        data: { object: { client_reference_id: 'A042' } },
      }),
    },
  }));
  const sql = makeMockSql();
  _setSqlClient(sql);

  const res = mockRes();
  await handler(mockReq({ headers: { 'stripe-signature': 't=1,v1=xxx' } }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { received: true });
  // Exactly one UPDATE call hit students table with the right sid + plan_a.
  assert.equal(sql.calls.length, 1);
  assert.match(sql.calls[0].text, /UPDATE\s+students\s+SET\s+plan\s*=\s*'plan_a'/i);
  assert.match(sql.calls[0].text, /WHERE\s+student_id\s*=/i);
  assert.ok(sql.calls[0].values.includes('A042'),
    `expected SQL value to include 'A042'. saw: ${JSON.stringify(sql.calls[0].values)}`);
});

test('checkout.session.completed without client_reference_id → 200 received but NO UPDATE', async () => {
  _setRawBodyFn(async () => Buffer.from('{}'));
  _setStripeFactory(() => ({
    webhooks: {
      constructEvent: () => ({
        type: 'checkout.session.completed',
        data: { object: {} },           // no client_reference_id
      }),
    },
  }));
  const sql = makeMockSql();
  _setSqlClient(sql);

  const res = mockRes();
  await handler(mockReq({ headers: { 'stripe-signature': 'sig' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(sql.calls.length, 0, 'no SQL without sid (no row to update)');
});

test('non-checkout event (e.g. payment_intent.succeeded) → 200 received but no UPDATE', async () => {
  _setRawBodyFn(async () => Buffer.from('{}'));
  _setStripeFactory(() => ({
    webhooks: {
      constructEvent: () => ({
        type: 'payment_intent.succeeded',
        data: { object: { client_reference_id: 'A001' } },
      }),
    },
  }));
  const sql = makeMockSql();
  _setSqlClient(sql);

  const res = mockRes();
  await handler(mockReq({ headers: { 'stripe-signature': 'sig' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(sql.calls.length, 0, 'only checkout.session.completed triggers UPDATE');
});

test('SQL UPDATE throws → still 200 received (Stripe retry on plain outage 是噪音)', async () => {
  _setRawBodyFn(async () => Buffer.from('{}'));
  _setStripeFactory(() => ({
    webhooks: {
      constructEvent: () => ({
        type: 'checkout.session.completed',
        data: { object: { client_reference_id: 'A001' } },
      }),
    },
  }));
  let calls = 0;
  _setSqlClient((strings, ...values) => {
    calls++;
    return Promise.reject(new Error('DB down'));
  });

  const res = mockRes();
  await handler(mockReq({ headers: { 'stripe-signature': 'sig' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(calls, 1, 'attempted the UPDATE');
});

// ═════════════════════════════════════════════════════════
// readRawBody (pure helper)
// ═════════════════════════════════════════════════════════

test('readRawBody: concatenates async iterator chunks to a Buffer', async () => {
  // Fake request: async iterator yielding mixed string + Buffer chunks.
  const fakeReq = {
    async *[Symbol.asyncIterator]() {
      yield 'hello ';
      yield Buffer.from('world');
    },
  };
  const buf = await readRawBody(fakeReq);
  assert.ok(Buffer.isBuffer(buf), 'must return a Buffer (Stripe constructEvent requires bytes)');
  assert.equal(buf.toString('utf8'), 'hello world');
});
