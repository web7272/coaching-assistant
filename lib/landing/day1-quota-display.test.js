// lib/landing/day1-quota-display.test.js — Patrick 6/7 spec §4 sync-gate.
//
// The Day-1 quota display logic in landing.html is inline (vanilla DOM, no
// build step). This test runs against the raw file contents to verify the
// 3 required branches exist + the left card (PDF-only) is NEVER touched.
//
// Pattern matches established "sentinel-marked inline mirror" approach
// (memory: 'for inline mirrors in student.js, sentinel-marked + sync-gate
// test pattern'). Here the canonical source IS the landing.html block —
// nothing duplicated; we only verify shape and constraints.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const landingPath = join(__dirname, '..', '..', 'landing.html');
const html = readFileSync(landingPath, 'utf8');

// ─── Existence of the quota fetcher IIFE ──────────────────────────

test('🛑 6/7 landing: initDay1Quota IIFE exists', () => {
  assert.match(html, /async function initDay1Quota\s*\(/);
});

test('🛑 6/7 landing: fetches GET /api/day1-quota', () => {
  // Use the endpoint we defined in §3.
  assert.match(html, /fetch\(['"]\/api\/day1-quota['"]/);
});

test('🛑 6/7 landing: quota fetch sends credentials:omit (no PII)', () => {
  // No cookies on this endpoint — it's public, no PII.
  assert.match(html, /\/api\/day1-quota[^)]*credentials\s*:\s*['"]omit['"]/);
});

// ─── 3 branches: remaining > 0 / ≤ 0 / fail-open ─────────────────

test('🛑 6/7 landing: branch "remaining > 0" → 稀缺感 text', () => {
  // Spec wording: "本月剩餘 Day-1 名額：N"
  assert.match(html, /本月剩餘 Day-1 名額/);
});

test('🛑 6/7 landing: branch "remaining ≤ 0" → switches CTA text to 額滿', () => {
  // Spec wording: title flips to 額滿; CTA flips to 留 email 進候補.
  assert.match(html, /本月 Day-1 名額已滿/);
  assert.match(html, /留 email[^<]*進候補/);
});

test('🛑 6/7 landing: 額滿文案 includes 仍寄 PDF 安慰文 (per spec)', () => {
  // Spec: "仍寄你練習 PDF" — UX promise stays consistent with backend
  // (option 3 PDF is sent even when waitlisted).
  assert.match(html, /我們仍會把練習 PDF 寄給你|仍寄你練習 PDF/);
});

test('🛑 6/7 landing: branch "fetch 失敗" → fail-open (try/catch present)', () => {
  // The IIFE must wrap fetch in try/catch so a dead endpoint doesn't
  // break the landing page. The catch handler must NOT throw / re-throw.
  // Crude check: catch block exists inside initDay1Quota and references quotaEl.
  const iife = html.match(/async function initDay1Quota[\s\S]*?\}\)\(\)/);
  assert.ok(iife, 'initDay1Quota IIFE must be located');
  assert.match(iife[0], /try\s*\{[\s\S]*?\}\s*catch\s*\(/);
  // fail-open posture: catch must clear the quota element (no error UI shown).
  assert.match(iife[0], /catch[\s\S]*?quotaEl\.classList\.remove/);
});

test('🛑 6/7 landing: fail-open catch does NOT touch left card', () => {
  // Belt-and-suspenders: extract the catch block, verify it doesn't reach
  // for any data-opt="1" element (would be a 坑 2 regression).
  const iife = html.match(/async function initDay1Quota[\s\S]*?\}\)\(\)/);
  const catchBlock = iife[0].match(/catch\s*\([^)]*\)\s*\{([\s\S]*?)\}\s*\}\)\(\)/);
  assert.ok(catchBlock, 'catch block must be locatable');
  assert.ok(!/data-opt=["']1["']/.test(catchBlock[1]),
    'catch block must not reference the left (PDF-only) card');
});

// ─── 坑 2: left card (data-opt="1") MUST be untouched ────────────

test('🛑 6/7 坑 2: left card (data-opt="1") has NO #cta-quota element', () => {
  // Grab the left-card block and verify no quota slot snuck in.
  // The block starts at <div class="cta-card" data-opt="1"> and ends at
  // the next </div> before the right card.
  const leftCardMatch = html.match(
    /<!--\s*左卡[^>]*-->\s*<div class="cta-card"[^>]*data-opt="1"[\s\S]*?<\/div>\s*<!--\s*右卡/,
  );
  assert.ok(leftCardMatch, 'left card block must be locatable');
  const leftCardHtml = leftCardMatch[0];
  assert.ok(!/cta-quota/.test(leftCardHtml),
    'left card (PDF-only) must NEVER contain the quota element');
  assert.ok(!/本月剩餘/.test(leftCardHtml),
    'left card must NEVER show remaining-quota text');
  assert.ok(!/名額已滿/.test(leftCardHtml),
    'left card must NEVER show quota-full text');
});

test('🛑 6/7 right card (data-opt="3") has the quota slot', () => {
  const rightCardMatch = html.match(
    /<!--\s*右卡[^>]*-->\s*<div class="cta-card alt"[^>]*data-opt="3"[\s\S]*?<\/div>\s*<\/div>\s*<p class="hlead"/,
  );
  assert.ok(rightCardMatch, 'right card block must be locatable');
  assert.match(rightCardMatch[0], /id="cta-quota-3"/);
  assert.match(rightCardMatch[0], /id="cta-t-3"/);
  assert.match(rightCardMatch[0], /id="cta-d-3"/);
  assert.match(rightCardMatch[0], /id="cta-go-3"/);
});

// ─── form submission still routes through /api/request-guide ─────

test('🛑 6/7 form action unchanged — ctaSubmit still calls /api/request-guide', () => {
  // The display logic must NOT change the form-submit target. Quota-full
  // case: form still submits, backend gate handles waitlist + PDF send.
  assert.match(html, /fetch\(['"]\/api\/request-guide['"]/);
});

test('🛑 6/7 right card form has onsubmit="ctaSubmit(event, 3)" (option 3)', () => {
  // The form must still submit with option=3 even when quota is full —
  // backend gate writes waitlist + still sends PDF (per spec).
  assert.match(html, /<form class="cta-form" onsubmit="ctaSubmit\(event,\s*3\)"/);
});
