// lib/landing/auto-redirect-logged-in.test.js
// Vivi 6/7 task 2 sync-gate — Phase C 改結構 (Patrick 6/26).
//
// Problem: 已登入學員打 /landing (CTA / bookmark / Google) → 看到行銷頁、
// 不是 journey → 以為要重註冊. session cookie 是好的, UX 問題.
//
// Fix shape: landing.html on load → fetch /api/me. 200 + studentId → redirect
// to /#/journey. 401 / no studentId / fetch fail → stay (fail-open). The IIFE
// runs early (body 頂) so the redirect fires before the visitor reads much.
//
// Phase C: landing.html 現在 = 身分重塑新頁 (原 landing3). day1-quota 顯示
// 已不在此頁 (Phase B 跳過), 故本檔不再鎖 initDay1Quota; 「早跑」改錨在
// 漏斗 submit handler 之前.
//
// Static-analysis pattern (raw 檔內容, landing 為 inline vanilla DOM).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', '..', 'landing.html'), 'utf8');

// ─── IIFE existence + early position ──────────────────────────────

test('🛑 landing: autoRedirectIfLoggedIn IIFE exists', () => {
  assert.match(html, /async function autoRedirectIfLoggedIn\s*\(/);
});

test('🛑 landing: autoRedirectIfLoggedIn 早跑 — 在漏斗 submit handler 之前 (body 頂)', () => {
  // 導向越早評估越好, 別讓已登入者看完行銷頁才跳.
  const autoIdx = html.indexOf('(async function autoRedirectIfLoggedIn(');
  const submitIdx = html.search(/quiz\.addEventListener\(\s*['"]submit['"]/);
  assert.ok(autoIdx > 0, 'autoRedirectIfLoggedIn IIFE 必須存在');
  assert.ok(submitIdx > 0, '漏斗 submit handler 必須存在');
  assert.ok(autoIdx < submitIdx,
    'autoRedirectIfLoggedIn 必須在 submit handler 之前 (最早跑)');
});

// ─── Fetch contract ────────────────────────────────────────────────

test('🛑 landing: fetches /api/me', () => {
  assert.match(html, /fetch\(['"]\/api\/me['"]/);
});

test('🛑 landing: /api/me fetch 不帶 credentials:omit (session cookie 必須送)', () => {
  const iife = html.match(/async function autoRedirectIfLoggedIn[\s\S]*?\}\)\(\)/);
  assert.ok(iife, 'autoRedirect IIFE must be locatable');
  assert.ok(!/fetch\(['"]\/api\/me['"][^)]*credentials\s*:\s*['"]omit['"]/.test(iife[0]),
    '/api/me fetch 不可用 credentials:omit (cookie 要到 server)');
});

// ─── 3 branches: 200+studentId / not-ok / throw ───────────────────

test('🛑 landing: branch "200 + studentId" → redirect /#/journey', () => {
  const iife = html.match(/async function autoRedirectIfLoggedIn[\s\S]*?\}\)\(\)/);
  assert.match(iife[0], /\.ok/);
  assert.match(iife[0], /studentId/);
  assert.match(iife[0], /location\.href\s*=\s*['"]\/#\/journey['"]/);
});

test('🛑 landing: branch "non-ok (401/403/5xx)" → 不導向, return early', () => {
  const iife = html.match(/async function autoRedirectIfLoggedIn[\s\S]*?\}\)\(\)/);
  assert.match(iife[0], /if\s*\(\s*!r\.ok\s*\)\s*return/);
});

test('🛑 landing: branch "fetch throws" → fail-open (try/catch, catch 內不導向)', () => {
  const iife = html.match(/async function autoRedirectIfLoggedIn[\s\S]*?\}\)\(\)/);
  assert.match(iife[0], /try\s*\{[\s\S]*?\}\s*catch\s*\(/);
  const catchBlock = iife[0].match(/catch\s*\([^)]*\)\s*\{([\s\S]*?)\}\s*\}\)\(\)/);
  assert.ok(catchBlock, 'catch block must be locatable');
  assert.ok(!/location\.href/.test(catchBlock[1]),
    'catch block 不可導向 (fail-open: 新訪客留 landing)');
});

// ─── Defensive guards ────────────────────────────────────────────

test('🛑 landing: studentId guard 要 string AND 非空 (不空/不 null 導向)', () => {
  const iife = html.match(/async function autoRedirectIfLoggedIn[\s\S]*?\}\)\(\)/);
  assert.match(iife[0], /typeof\s+j[\.\?]?[a-z]*\.?studentId\s*===\s*['"]string['"]/i,
    'must check typeof studentId === "string"');
  assert.match(iife[0], /studentId\.length\s*>\s*0/,
    'must require non-empty studentId');
});

// ─── Non-interference: 漏斗 ctaSubmit 不受影響 ──────────────────────

test('🛑 landing: 漏斗 submit 仍 POST /api/request-guide (新訪客流程不受影響)', () => {
  assert.match(html, /fetch\(['"]\/api\/request-guide['"]/);
});
