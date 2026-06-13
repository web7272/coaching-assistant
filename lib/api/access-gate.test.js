// lib/api/access-gate.test.js
// Patrick 5/29 — access gate boundary lock.
// Patrick 6/13 — 政策反轉 (Vivi 6/13): is_beta 凌駕一切, 移除 shouldExpireBetaWindow.
//   保留 isBlocked / BLOCKED_RESPONSE / BETA_WINDOW_DAYS (後者降為 admin 參考欄).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  BETA_WINDOW_DAYS, BLOCKED_RESPONSE,
  isBlocked,
} from './access-gate.js';

const __filename   = fileURLToPath(import.meta.url);
const __dirname    = dirname(__filename);
const REPO_ROOT    = resolve(__dirname, '..', '..');
const CHAT_JS      = resolve(REPO_ROOT, 'api', 'chat.js');
const CONV_TODAY   = resolve(REPO_ROOT, 'api', 'conversation-today.js');

// ─── constants ──────────────────────────────────────────────────

test('BETA_WINDOW_DAYS = 30 (保留作 admin 參考欄, 6/13 起不再 enforce)', () => {
  assert.equal(BETA_WINDOW_DAYS, 30);
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

// ─── 6/13 政策驗 — 移除確認 (確保 dead code 真的死) ────────────────

test('🛑 6/13: shouldExpireBetaWindow 已移除 (政策反轉, is_beta 凌駕一切)', async () => {
  const mod = await import('./access-gate.js');
  assert.equal(mod.shouldExpireBetaWindow, undefined,
    'shouldExpireBetaWindow 應該已移除, 不該再 export');
});

test('🛑 6/13: BETA_WINDOW_MS 已移除 (只被 shouldExpireBetaWindow 用)', async () => {
  const mod = await import('./access-gate.js');
  assert.equal(mod.BETA_WINDOW_MS, undefined,
    'BETA_WINDOW_MS 應該已移除, 不該再 export');
});

// ═════════════════════════════════════════════════════════
// 🛑 6/13 政策反轉 — source-grep guards on chat.js + conversation-today.js
//   是 Patrick 拍板的 4 條 invariants, 防 future refactor 改回頭:
//     (1) chat.js 不可再 import / 用 shouldExpireBetaWindow.
//     (2) chat.js isBlocked gate 必須包 !isBetaPass (封測者凌駕).
//     (3) chat.js trial gate 必須包 !isBetaPass + lookupOk (凌駕 + fail-open).
//     (4) conversation-today.js 同 (1) + (2).
// ═════════════════════════════════════════════════════════

test('🛑 chat.js: 不可 import / 呼叫 shouldExpireBetaWindow (政策已死)', () => {
  const src = readFileSync(CHAT_JS, 'utf8');
  assert.equal(/shouldExpireBetaWindow/.test(src), false,
    'chat.js 不該再 reference shouldExpireBetaWindow (政策 6/13 反轉, 該函式已移除)');
});

test('🛑 chat.js: 必須 compute isBetaPass = studentRow?.is_beta === true', () => {
  const src = readFileSync(CHAT_JS, 'utf8');
  assert.match(src, /const\s+isBetaPass\s*=\s*studentRow\?\.is_beta\s*===\s*true/,
    'chat.js 必須有 `const isBetaPass = studentRow?.is_beta === true`');
});

test('🛑 chat.js: isBlocked gate 必須包 !isBetaPass (封測者凌駕)', () => {
  const src = readFileSync(CHAT_JS, 'utf8');
  // 鎖一條 isBlocked 的 if 包含 !isBetaPass.
  assert.match(
    src,
    /if\s*\([^)]*isBlocked\(studentRow\)[^)]*!isBetaPass[^)]*\)/,
    'chat.js isBlocked gate 必須加 && !isBetaPass — 封測者凌駕 isBlocked',
  );
});

test('🛑 chat.js: trial gate 必須包 lookupOk + !isBetaPass (fail-open + 封測者凌駕)', () => {
  const src = readFileSync(CHAT_JS, 'utf8');
  // Trial gate 段必須同時鎖 lookupOk + !isBetaPass.
  const trialBlock = src.match(/TRIAL_GATING_ENABLED[\s\S]{0,500}?TRIAL_UPGRADE_REQUIRED/);
  assert.ok(trialBlock, 'trial gate block 應該存在');
  assert.match(trialBlock[0], /\blookupOk\b/,
    'trial gate 條件必須包 lookupOk — SELECT 拋錯時 fail-open');
  assert.match(trialBlock[0], /!isBetaPass/,
    'trial gate 條件必須包 !isBetaPass — 封測者凌駕 trial gate');
});

test('🛑 conversation-today.js: 不可 import / 呼叫 shouldExpireBetaWindow', () => {
  const src = readFileSync(CONV_TODAY, 'utf8');
  assert.equal(/shouldExpireBetaWindow/.test(src), false,
    'conversation-today.js 不該再 reference shouldExpireBetaWindow');
});

test('🛑 conversation-today.js: isBlocked gate 必須包 !isBetaPass', () => {
  const src = readFileSync(CONV_TODAY, 'utf8');
  assert.match(
    src,
    /if\s*\([^)]*isBlocked\(studentRow\)[^)]*!isBetaPass[^)]*\)/,
    'conversation-today.js isBlocked gate 必須加 && !isBetaPass',
  );
});

test('🛑 access-gate.js 自身: 不可再 export shouldExpireBetaWindow (dead removal)', () => {
  const src = readFileSync(resolve(REPO_ROOT, 'lib', 'api', 'access-gate.js'), 'utf8');
  assert.equal(/export\s+function\s+shouldExpireBetaWindow/.test(src), false,
    'access-gate.js 不該再 export shouldExpireBetaWindow');
  assert.equal(/export\s+const\s+BETA_WINDOW_MS/.test(src), false,
    'access-gate.js 不該再 export BETA_WINDOW_MS (內部用, 已死)');
});
