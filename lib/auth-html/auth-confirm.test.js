// lib/auth-html/auth-confirm.test.js — Patrick + Vivi 6/7 P0 LAUNCH BLOCKER sync-gate.
//
// Root cause: email scanners (Microsoft SafeLinks / Gmail render / Brevo
// click-tracking) fetch & RENDER auth.html. The previous version auto-POSTed
// /api/auth/verify-link inside an IIFE at load time → scanner = real user
// from the server's POV → token marked used → real user 13–21s later sees
// 「連結已失效」.
//
// Fix shape: auth.html boot must NOT POST. Boot synchronously renders a
// confirm UI containing a <button>. The POST happens ONLY inside that
// button's click event handler. Scanners don't synthesize click events,
// so they walk away without consuming the token.
//
// These tests do static analysis on the raw auth.html string — pattern
// established for landing inline JS (lib/landing/day1-quota-display.test.js).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const authHtml = readFileSync(
  join(__dirname, '..', '..', 'auth.html'),
  'utf8',
);

// Extract the <script> body once — every test inspects this.
function extractScriptBody(html) {
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, '<script> block must exist in auth.html');
  return m[1];
}
const script = extractScriptBody(authHtml);

// ─── P0: NO top-level fetch (the only allowed fetch is inside a click handler) ──

test('🛑 6/7 P0: auth.html script contains exactly ONE fetch to /api/auth/verify-link', () => {
  // Defence against accidentally re-adding a 2nd auto-fetch.
  const matches = script.match(/fetch\(['"]\/api\/auth\/verify-link['"]/g) || [];
  assert.equal(matches.length, 1,
    `expected exactly 1 verify-link fetch (inside click handler); got ${matches.length}`);
});

test('🛑 6/7 P0: verify-link fetch is INSIDE a click event handler, NOT at top level', () => {
  // We locate the fetch and walk backwards in the source to ensure the nearest
  // enclosing function declaration is the click handler — not the IIFE body.
  const fetchIdx = script.indexOf("fetch('/api/auth/verify-link'");
  assert.ok(fetchIdx > 0, 'verify-link fetch must be present');

  // Find the addEventListener('click', ...) opening that contains it.
  // Pattern: addEventListener('click', async function ...) { ... fetch(...) ... }
  // We use a regex that captures everything from the 'click' attach to its
  // matching closing, then check the fetch is inside.
  const handlerOpenMatch = script.slice(0, fetchIdx).match(
    /addEventListener\(\s*['"]click['"][^)]*async function[^{]*\{/g,
  );
  assert.ok(handlerOpenMatch && handlerOpenMatch.length > 0,
    'click event handler must open before the fetch — fetch must be inside it');
});

test('🛑 6/7 P0: NO fetch can run before the user clicks (boot path is sync, fetch is reachable only via click handler)', () => {
  // Strategy: walk the script with a brace-balanced parser to extract the
  // boot-time control flow (everything OUTSIDE any function declaration /
  // function expression). Then assert no fetch() lives in that boot slice.
  //
  // This catches the original bug shape: the previous auth.html had
  //   (async function() { ... await fetch('/api/auth/verify-link', ...) ... })();
  // where the fetch was lexically inside the IIFE but executed at boot.
  // With the fix, the fetch is lexically AND temporally inside the click
  // handler — boot only assigns the handler and calls renderConfirm.

  // Step 1: remove every {...} body that immediately follows a "function"
  // keyword, a `=>`, or an `addEventListener('click', ...)` argument. Done
  // with a balanced-brace scanner instead of regex.
  function stripFunctionBodies(src) {
    let out = '';
    let i = 0;
    while (i < src.length) {
      // Look for a function-like opener whose `{` we should skip past.
      const remaining = src.slice(i);
      const fnDecl = remaining.match(/^(async\s+)?function\b[^{]*\{/);
      const arrow  = remaining.match(/^\([^)]*\)\s*=>\s*\{/);
      const listener = remaining.match(/^addEventListener\(\s*['"][^'"]+['"]\s*,\s*(async\s+)?function[^{]*\{/);
      const head = fnDecl || listener || arrow;
      if (head) {
        i += head[0].length;
        // Walk braces to find the matching close.
        let depth = 1;
        while (i < src.length && depth > 0) {
          const c = src[i];
          // crude string-skip to avoid braces inside strings.
          if (c === '"' || c === "'" || c === '`') {
            const quote = c;
            i++;
            while (i < src.length && src[i] !== quote) {
              if (src[i] === '\\') i += 2; else i++;
            }
            i++;
            continue;
          }
          if (c === '{') depth++;
          else if (c === '}') depth--;
          i++;
        }
        continue;
      }
      out += src[i++];
    }
    return out;
  }

  const bootOnly = stripFunctionBodies(script);
  assert.ok(!/fetch\s*\(/.test(bootOnly),
    'no fetch() may appear at boot time — must live inside a function body that only the click handler invokes');
});

// ─── P0: button is a <button>, NOT <a href> ─────────────────────────────────

test('🛑 6/7 P0: login confirm uses createElement("button"), not anchor', () => {
  // Anchors get followed by scanners. The confirm action MUST be a real button.
  assert.match(script, /createElement\(\s*['"]button['"]\s*\)/,
    'must create a <button> element for the login confirm');
});

test('🛑 6/7 P0: button text is the spec wording "登入 →"', () => {
  assert.match(script, /['"]繼續 →['"]/);
});

test('🛑 7/15 (v11): confirm headline = 「歡迎。你的 21 天旅程，從這裡開始。」', () => {
  assert.match(script, /歡迎。你的 21 天旅程，從這裡開始。/);
  // Anti-regression: 舊 v11 前品牌 (身分重塑計畫) 已清 + 舊「——」破折號已改逗號
  assert.doesNotMatch(script, /21 天身分重塑計畫/);
  assert.doesNotMatch(script, /差最後一步/);
});

test('🛑 6/7 P0: the ONLY <a> created in the script body is the /login.html (fail-path) anchor', () => {
  // 寄新連結 anchor on the fail path is fine — it does NOT carry a token.
  // But the confirm/login button MUST NOT be an anchor.
  // Match all createElement('a') occurrences and verify the immediately-
  // following href is /login.html (not /api/auth/verify-link or anything else).
  const anchorMatches = [...script.matchAll(/createElement\(\s*['"]a['"]\s*\)/g)];
  assert.equal(anchorMatches.length, 1,
    'exactly one anchor element should exist (寄新連結 fail path)');
  // The next href assignment after this createElement must be /login.html.
  const tail = script.slice(anchorMatches[0].index);
  const hrefMatch = tail.match(/\.href\s*=\s*['"]([^'"]+)['"]/);
  assert.ok(hrefMatch, 'fail-path anchor must set .href');
  assert.equal(hrefMatch[1], '/login.html',
    'fail-path anchor href must be /login.html, never a token-carrying URL');
});

// ─── Anti-double-click + loading state ──────────────────────────────────────

test('🛑 6/7 click handler: button.disabled=true on click (anti-double-submit)', () => {
  // Spec: "點按鈕後才進「登入中…」狀態(disable 按鈕、防連點)".
  assert.match(script, /btn\.disabled\s*=\s*true/);
});

test('🛑 6/7 click handler: button text → "繼續中…" while POST is in flight', () => {
  assert.match(script, /['"]繼續中…['"]/);
});

test('🛑 6/25 entry 併入 auth: name input + pace radios + PATCH /api/students (取代 #/entry)', () => {
  assert.match(script, /我可以怎麼稱呼你/);
  // 6/26 — 步調已移除,只留稱呼.
  assert.equal(/name=\"pace\"/.test(script), false, '步調 radios 已移除');
  assert.match(script, /fetch\(['"]\/api\/students['"]/);
  assert.match(script, /preferred_name/);
  assert.match(script, /請告訴我們怎麼稱呼你/);
  assert.equal((script.match(/fetch\(['"]\/api\/auth\/verify-link['"]/g) || []).length, 1);
});

// ─── Existing failure paths preserved ──────────────────────────────────────

test('🛑 missing token → still fails immediately with existing copy', () => {
  assert.match(script, /params\.get\(['"]token['"]\)/);
  assert.match(script, /連結缺少 token/);
});

test('🛑 verify-link non-ok → existing 連結已失效 copy preserved', () => {
  assert.match(script, /這個登入連結已失效/);
  assert.match(script, /連結有效 60 分鐘/);
});

test('🛑 network failure (fetch throws) → existing 沒能登入 copy preserved', () => {
  assert.match(script, /沒能登入/);
});

// ─── persistStudentSession + redirect preserved ────────────────────────────

test('🛑 successful login still persists into LS_KEY="sy.v5.student" and redirects to /#/journey', () => {
  assert.match(script, /sy\.v5\.student/);
  assert.match(script, /location\.href\s*=\s*['"]\/#\/journey['"]/);
});

// ─── verify-link.js itself MUST NOT have been touched ─────────────────────

test('🛑 6/7 P0: verify-link.js still POST-only + uses used_at (server-side contract unchanged)', () => {
  const verifyLinkJs = readFileSync(
    join(__dirname, '..', '..', 'api', 'auth', 'verify-link.js'),
    'utf8',
  );
  // Spec: "verify-link 仍 POST-only + 單次(used_at)+ 60min TTL, 完全不動".
  assert.match(verifyLinkJs, /req\.method[\s\S]{0,200}!==\s*['"]POST['"]/,
    'verify-link must remain POST-only (method guard intact)');
  assert.match(verifyLinkJs, /used_at/,
    'verify-link must still track used_at (single-use semantics)');
});
