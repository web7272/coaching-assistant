// lib/api/access-gate.test.js
// Patrick 5/29 — access gate boundary lock.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  BETA_WINDOW_DAYS, BETA_WINDOW_MS, BLOCKED_RESPONSE,
  isBlocked, shouldExpireBetaWindow,
} from './access-gate.js';

// ─── constants ──────────────────────────────────────────────────

test('BETA_WINDOW_DAYS = 30 (Vivi 5/29 拍板)', () => {
  assert.equal(BETA_WINDOW_DAYS, 30);
});

test('BETA_WINDOW_MS = 30 days in ms', () => {
  assert.equal(BETA_WINDOW_MS, 30 * 24 * 60 * 60 * 1000);
});

test('BLOCKED_RESPONSE: frozen + has stable error code + 聯絡 email', () => {
  assert.ok(Object.isFrozen(BLOCKED_RESPONSE));
  assert.equal(BLOCKED_RESPONSE.error, 'beta_access_ended');
  assert.match(BLOCKED_RESPONSE.message, /封測權限已結束/);
  assert.match(BLOCKED_RESPONSE.message, /lifecoach\.vivichung@gmail\.com/);
});

// ─── isBlocked ──────────────────────────────────────────────────

test('isBlocked: is_blocked=true → true', () => {
  assert.equal(isBlocked({ is_blocked: true }),  true);
});

test('isBlocked: is_blocked=false → false', () => {
  assert.equal(isBlocked({ is_blocked: false }), false);
});

test('isBlocked: defensive on null / undefined / missing field', () => {
  assert.equal(isBlocked(null),                  false);
  assert.equal(isBlocked(undefined),             false);
  assert.equal(isBlocked({}),                    false);
});

test('isBlocked: truthy-but-not-true → false (strict equality lock)', () => {
  // DB might return 't' / 1 / 'TRUE' if a raw client doesn't coerce; require strict true.
  assert.equal(isBlocked({ is_blocked: 'true' }), false);
  assert.equal(isBlocked({ is_blocked: 1 }),      false);
  assert.equal(isBlocked({ is_blocked: 't' }),    false);
});

// ─── shouldExpireBetaWindow — happy + 4 negative paths ─────────

const NOW = new Date('2026-06-29T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const created = (daysAgo) => new Date(NOW.getTime() - daysAgo * DAY);

test('🛑 expire: is_beta=true + 31 days ago + no Day21 → TRUE', () => {
  assert.equal(
    shouldExpireBetaWindow({
      student: { is_beta: true, is_blocked: false, created_at: created(31) },
      hasDay21Complete: false,
      now: NOW,
    }),
    true,
  );
});

test('🛑 expire: is_beta=true + 29 days ago → FALSE (still in window)', () => {
  assert.equal(
    shouldExpireBetaWindow({
      student: { is_beta: true, is_blocked: false, created_at: created(29) },
      hasDay21Complete: false,
      now: NOW,
    }),
    false,
  );
});

test('🛑 expire boundary: exactly 30 days ago → FALSE (> 30, not >=)', () => {
  // Exact 30-day mark stays in-window; only > 30 expires.
  assert.equal(
    shouldExpireBetaWindow({
      student: { is_beta: true, is_blocked: false, created_at: created(30) },
      hasDay21Complete: false,
      now: NOW,
    }),
    false,
  );
});

test('🛑 expire boundary: 30 days + 1ms ago → TRUE', () => {
  assert.equal(
    shouldExpireBetaWindow({
      student: { is_beta: true, is_blocked: false, created_at: new Date(NOW.getTime() - BETA_WINDOW_MS - 1) },
      hasDay21Complete: false,
      now: NOW,
    }),
    true,
  );
});

test('🛑 expire: is_beta=FALSE + 365 days ago → FALSE (一般學員 window 不適用)', () => {
  assert.equal(
    shouldExpireBetaWindow({
      student: { is_beta: false, is_blocked: false, created_at: created(365) },
      hasDay21Complete: false,
      now: NOW,
    }),
    false,
  );
});

test('🛑 expire: already blocked → FALSE (不重複 trigger)', () => {
  assert.equal(
    shouldExpireBetaWindow({
      student: { is_beta: true, is_blocked: true, created_at: created(60) },
      hasDay21Complete: false,
      now: NOW,
    }),
    false,
  );
});

test('🛑 expire: hasDay21Complete=true → FALSE (走完了不該關 access)', () => {
  assert.equal(
    shouldExpireBetaWindow({
      student: { is_beta: true, is_blocked: false, created_at: created(40) },
      hasDay21Complete: true,
      now: NOW,
    }),
    false,
  );
});

test('expire: ISO string created_at parsed correctly', () => {
  assert.equal(
    shouldExpireBetaWindow({
      student: { is_beta: true, is_blocked: false, created_at: '2026-05-25T00:00:00Z' },
      hasDay21Complete: false,
      now: NOW,   // 2026-06-29 → 35 days later
    }),
    true,
  );
});

test('expire: future created_at → FALSE (defensive, 不誤觸發)', () => {
  assert.equal(
    shouldExpireBetaWindow({
      student: { is_beta: true, is_blocked: false, created_at: new Date(NOW.getTime() + 7 * DAY) },
      hasDay21Complete: false,
      now: NOW,
    }),
    false,
  );
});

test('expire: missing created_at → FALSE', () => {
  assert.equal(
    shouldExpireBetaWindow({
      student: { is_beta: true, is_blocked: false /* no created_at */ },
      hasDay21Complete: false,
      now: NOW,
    }),
    false,
  );
});

test('expire: garbage created_at (NaN-yielding) → FALSE', () => {
  assert.equal(
    shouldExpireBetaWindow({
      student: { is_beta: true, is_blocked: false, created_at: 'not-a-date' },
      hasDay21Complete: false,
      now: NOW,
    }),
    false,
  );
});

test('expire: null / undefined / non-object student → FALSE', () => {
  assert.equal(shouldExpireBetaWindow({ student: null,      hasDay21Complete: false, now: NOW }), false);
  assert.equal(shouldExpireBetaWindow({ student: undefined, hasDay21Complete: false, now: NOW }), false);
  assert.equal(shouldExpireBetaWindow({ student: 'A001',    hasDay21Complete: false, now: NOW }), false);
});

test('expire: no opts at all → FALSE (defensive, never throws)', () => {
  assert.equal(shouldExpireBetaWindow(),    false);
  assert.equal(shouldExpireBetaWindow({}),  false);
});
