// lib/landing/auto-redirect-logged-in.test.js — Vivi 6/7 task 2 sync-gate.
//
// Problem: 已登入學員打 /landing (CTA / bookmark / Google) → 看到行銷頁、
// 不是 journey → 以為要重註冊. session cookie 是好的, UX 問題.
//
// Fix shape: landing.html on load → fetch /api/me. 200 + studentId → redirect
// to /#/journey. 401 / no studentId / fetch fail → stay (fail-open). The IIFE
// must run early in the script so the redirect happens before too much
// scrolling, but a brief flash of marketing content is acceptable.
//
// Static-analysis pattern, established for:
//   - lib/landing/day1-quota-display.test.js
//   - lib/auth-html/auth-confirm.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(
  join(__dirname, '..', '..', 'landing.html'),
  'utf8',
);

// ─── IIFE existence + early position ──────────────────────────────

test('🛑 6/7 landing: autoRedirectIfLoggedIn IIFE exists', () => {
  assert.match(html, /async function autoRedirectIfLoggedIn\s*\(/);
});

test('🛑 6/7 landing: autoRedirectIfLoggedIn fires BEFORE the day1-quota IIFE (runs early)', () => {
  // Why this matters: the redirect should evaluate as early as possible so
  // logged-in users don't watch the marketing page render. Both IIFEs are
  // declared but the auto-redirect must come first lexically.
  // Anchor on the actual IIFE-open syntax (not bare name) — bare-name match
  // would pick up references in comments.
  const autoIdx = html.indexOf('(async function autoRedirectIfLoggedIn(');
  const day1Idx = html.indexOf('(async function initDay1Quota(');
  assert.ok(autoIdx > 0, 'autoRedirectIfLoggedIn IIFE must be present');
  assert.ok(day1Idx > 0, 'initDay1Quota IIFE must still be present');
  assert.ok(autoIdx < day1Idx,
    'autoRedirectIfLoggedIn IIFE must come before initDay1Quota (run earliest)');
});

// ─── Fetch contract ────────────────────────────────────────────────

test('🛑 6/7 landing: fetches /api/me (not /api/day1-quota by accident)', () => {
  // Use the canonical endpoint.
  assert.match(html, /fetch\(['"]\/api\/me['"]/);
});

test('🛑 6/7 landing: /api/me fetch does NOT pass credentials:omit (session cookie must travel)', () => {
  // /api/me reads the student_session cookie. credentials:'omit' would strip
  // it and make the endpoint always return 401. We rely on the default
  // (same-origin) which sends same-origin cookies automatically.
  const iife = html.match(/async function autoRedirectIfLoggedIn[\s\S]*?\}\)\(\)/);
  assert.ok(iife, 'autoRedirect IIFE must be locatable');
  // Specifically check the /api/me fetch line — NOT the day1-quota one.
  assert.ok(!/fetch\(['"]\/api\/me['"][^)]*credentials\s*:\s*['"]omit['"]/.test(iife[0]),
    '/api/me fetch must NOT use credentials:omit (cookie must reach server)');
});

// ─── 3 branches: 200+studentId / not-ok / throw ───────────────────

test('🛑 6/7 landing: branch "200 + studentId" → redirect /#/journey', () => {
  const iife = html.match(/async function autoRedirectIfLoggedIn[\s\S]*?\}\)\(\)/);
  // Must check `r.ok` (or equivalent) AND extract `studentId` from the body.
  assert.match(iife[0], /\.ok/);
  assert.match(iife[0], /studentId/);
  // The redirect target.
  assert.match(iife[0], /location\.href\s*=\s*['"]\/#\/journey['"]/);
});

test('🛑 6/7 landing: branch "non-ok response (401/403/5xx)" → NO redirect, return early', () => {
  // Pattern: `if (!r.ok) return;` (or equivalent guard).
  const iife = html.match(/async function autoRedirectIfLoggedIn[\s\S]*?\}\)\(\)/);
  assert.match(iife[0], /if\s*\(\s*!r\.ok\s*\)\s*return/);
});

test('🛑 6/7 landing: branch "fetch throws / network error" → fail-open (try/catch, no redirect in catch)', () => {
  const iife = html.match(/async function autoRedirectIfLoggedIn[\s\S]*?\}\)\(\)/);
  // try/catch wraps the fetch.
  assert.match(iife[0], /try\s*\{[\s\S]*?\}\s*catch\s*\(/);
  // The catch block must NOT contain a redirect (fail-open: stay on landing).
  const catchBlock = iife[0].match(/catch\s*\([^)]*\)\s*\{([\s\S]*?)\}\s*\}\)\(\)/);
  assert.ok(catchBlock, 'catch block must be locatable');
  assert.ok(!/location\.href/.test(catchBlock[1]),
    'catch block must NOT redirect (fail-open: stay on landing for new visitors)');
});

// ─── Defensive guards ────────────────────────────────────────────

test('🛑 6/7 landing: studentId guard requires string AND non-empty (no empty/null redirect)', () => {
  // A server response { studentId: null } would 200 OK but is not actually
  // logged in. Guard must filter it out.
  const iife = html.match(/async function autoRedirectIfLoggedIn[\s\S]*?\}\)\(\)/);
  // Look for a typeof string check on the parsed json.
  assert.match(iife[0], /typeof\s+j[\.\?]?[a-z]*\.?studentId\s*===\s*['"]string['"]/i,
    'must check typeof studentId === "string"');
  assert.match(iife[0], /studentId\.length\s*>\s*0/,
    'must require non-empty studentId');
});

// ─── Non-interference: existing initDay1Quota + ctaSubmit unchanged ──

test('🛑 6/7 landing: initDay1Quota fetch (/api/day1-quota credentials:omit) unaffected', () => {
  // The day1-quota IIFE was added in an earlier commit (63b11bc); this PR
  // must not regress its behaviour.
  assert.match(html, /fetch\(['"]\/api\/day1-quota['"][^)]*credentials\s*:\s*['"]omit['"]/);
});

test('🛑 6/7 landing: ctaSubmit still POSTs /api/request-guide (CTA flow unaffected)', () => {
  // New-visitor (logged-out) path: marketing page renders, they fill the form,
  // ctaSubmit fires /api/request-guide. That contract is untouched by this PR.
  assert.match(html, /fetch\(['"]\/api\/request-guide['"]/);
});
