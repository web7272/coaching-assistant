// api/checkout.test.js
// Patrick 5/26 — Stage 3 漏斗 Stripe Checkout opener.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, { _setStripeFactory } from './checkout.js';
import { _setStudentSessionReader } from '../lib/auth/student-session.js';

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

const STUDENT_SESSION_FOR = (sid) => async () => ({ role: 'student', sid });
const NO_SESSION = async () => null;

beforeEach(() => {
  _setStudentSessionReader(null);
  _setStripeFactory(null);
  process.env.SESSION_SECRET = 'test-secret-32-bytes-of-entropy-aaaaaaaa';
  process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
  process.env.STRIPE_PRICE_ID  = 'price_xxx';
  process.env.APP_BASE_URL = 'https://preview.example.com';
  delete process.env.VERCEL_URL;
});

test('non-POST → 405', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  const res = mockRes();
  await handler(mockReq({ method: 'GET' }), res);
  assert.equal(res.statusCode, 405);
});

test('🛑 no student session → 401', async () => {
  _setStudentSessionReader(NO_SESSION);
  _setStripeFactory(() => { throw new Error('Stripe should not be reached'); });
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 401);
});

test('🛑 valid student session → calls stripe.checkout.sessions.create + returns { url }', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A007'));
  let capturedArgs = null;
  _setStripeFactory(() => ({
    checkout: {
      sessions: {
        create: async (args) => {
          capturedArgs = args;
          return { url: 'https://checkout.stripe.com/c/pay/cs_test_xxx' };
        },
      },
    },
  }));
  const res = mockRes();
  await handler(mockReq(), res);

  assert.equal(res.statusCode, 200);
  assert.match(res.body.url, /^https:\/\/checkout\.stripe\.com\//);
  // Stripe got the right shape
  assert.equal(capturedArgs.mode, 'payment');
  assert.equal(capturedArgs.line_items[0].price, 'price_xxx');
  assert.equal(capturedArgs.line_items[0].quantity, 1);
  // 🛑 client_reference_id MUST be the verified sid, not anything the client sent.
  assert.equal(capturedArgs.client_reference_id, 'A007',
    'client_reference_id must equal sid from cookie (webhook靠這個認人)');
  // success/cancel URLs target the SPA journey hash route.
  assert.match(capturedArgs.success_url, /\/#\/journey\?upgraded=1$/);
  assert.match(capturedArgs.cancel_url,  /\/#\/journey$/);
});

test('🛑 client cannot override client_reference_id by passing studentId in body', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  let capturedArgs = null;
  _setStripeFactory(() => ({
    checkout: {
      sessions: {
        create: async (args) => { capturedArgs = args; return { url: 'https://x' }; },
      },
    },
  }));
  const res = mockRes();
  // Attacker tries to checkout-as-someone-else via body.
  await handler(mockReq({ body: { studentId: 'A999', client_reference_id: 'A999' } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(capturedArgs.client_reference_id, 'A001',
    'body must not influence client_reference_id');
});

test('Stripe call throws → 500 checkout_failed', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setStripeFactory(() => ({
    checkout: {
      sessions: { create: async () => { throw new Error('Stripe API down'); } },
    },
  }));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'checkout_failed');
});
