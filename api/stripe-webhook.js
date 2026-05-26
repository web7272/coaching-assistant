// api/stripe-webhook.js
// Patrick 5/26 — 漏斗 Stage 3：Stripe webhook → 升級 plan='plan_a'.
//
// POST /api/stripe-webhook
//   - 驗 stripe-signature 簽章（raw body、不能用 parse 過的物件）
//   - event.type === 'checkout.session.completed':
//       sid = event.data.object.client_reference_id (在 checkout.js 設好)
//       UPDATE students SET plan='plan_a' WHERE student_id=sid
//   - 其他 event 一律回 200 received:true（Stripe 不會 retry、不會噪音）.
//
// ⚠️ Vercel ESM serverless function (非 Next.js):
//   - export const config = { api: { bodyParser: false } } — 別讓平台 JSON.parse
//     掉 body. constructEvent 必須吃 raw bytes (Buffer)、不然簽章驗失敗.
//   - readRawBody(req) — for-await stream → Buffer.concat.
//   - 簽章失敗 → 400 invalid_signature (Stripe 會 retry → 之後修錯了再對).
//   - 升級 plan 失敗 → log + still 200 (避免 Stripe 卡 retry 暴 webhook noise).
//
// 安全：plan 升級ONLY 從這個 webhook 寫. 前端絕對不能呼叫「設我 plan=plan_a」.

import Stripe from 'stripe';
import { neon } from '@neondatabase/serverless';

export const config = { api: { bodyParser: false } };
export const maxDuration = 10;

// Test seams — let tests inject fake Stripe + sql + raw-body reader.
let _stripeFactory = null;
let _sql = null;
let _rawBodyFn = null;
export function _setStripeFactory(fn) { _stripeFactory = fn; }
export function _setSqlClient(client) { _sql = client; }
export function _setRawBodyFn(fn)   { _rawBodyFn = fn; }
function getStripe() {
  if (_stripeFactory) return _stripeFactory();
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}
function getSql() {
  if (_sql) return _sql;
  return neon(process.env.DATABASE_URL);
}

/**
 * Read the raw request body as a Buffer. Stripe's constructEvent verifies
 * an HMAC over the EXACT bytes Stripe sent — any parse / re-serialize
 * (even via JSON) breaks the signature. Pure helper, exported for testing.
 */
export async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    const raw = _rawBodyFn ? await _rawBodyFn(req) : await readRawBody(req);
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('[stripe-webhook] signature verify failed:', e?.message || e);
    return res.status(400).json({ error: 'invalid_signature' });
  }

  if (event.type === 'checkout.session.completed') {
    const studentId = event.data?.object?.client_reference_id;
    if (studentId) {
      try {
        const sql = getSql();
        await sql`UPDATE students SET plan = 'plan_a' WHERE student_id = ${studentId}`;
        console.log('[stripe-webhook] upgraded plan_a for', studentId);
      } catch (e) {
        // Log but still 200 — Stripe retry doesn't help an SQL outage.
        console.error('[stripe-webhook] plan upgrade SQL failed:', e?.message || e);
      }
    } else {
      console.warn('[stripe-webhook] checkout.session.completed without client_reference_id');
    }
  }

  return res.status(200).json({ received: true });
}
