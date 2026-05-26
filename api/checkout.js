// api/checkout.js
// Patrick 5/26 — 漏斗 Stage 3：開 Stripe Checkout Session.
// 對應 preview-1日漏斗最小測試版-spec.md.
//
// POST /api/checkout (student-cookie gated)
//   → 建立 Stripe hosted checkout session for STRIPE_PRICE_ID (NT$3,000 once-off)
//   → 回 { url } 給前端 location.href
//   → 付款成功 → success_url = #/journey?upgraded=1
//   → 付款取消 → cancel_url = #/journey
//   → webhook (api/stripe-webhook.js) 驗簽章後寫 plan='plan_a' (前端不能自己解鎖).

import Stripe from 'stripe';
import { guardStudentOr401 } from '../lib/auth/student-session.js';
import { resolveBaseUrl } from './auth/request-link.js';

export const maxDuration = 10;

// Test seam — let tests inject a fake Stripe (avoid network + key requirement).
let _stripeFactory = null;
export function _setStripeFactory(fn) { _stripeFactory = fn; }
function getStripe() {
  if (_stripeFactory) return _stripeFactory();
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 鐵則 1d — sid from cookie ONLY. client_reference_id 必須是 verified sid.
  const studentId = await guardStudentOr401(req, res);
  if (!studentId) return;

  try {
    const stripe = getStripe();
    const base = resolveBaseUrl();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      client_reference_id: studentId,                 // webhook 靠這個認人
      success_url: `${base}/#/journey?upgraded=1`,
      cancel_url:  `${base}/#/journey`,
    });
    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('[checkout] error:', e?.message || e);
    return res.status(500).json({ error: 'checkout_failed' });
  }
}
