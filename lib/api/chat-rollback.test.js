// lib/api/chat-rollback.test.js
// Patrick 5/28 — A006 case 殭屍 session rollback regression coverage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { rollbackSessionIfNeeded } from './chat-rollback.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CHAT_JS_PATH = resolve(__dirname, '..', '..', 'api', 'chat.js');

// ─── tag-template mock sql (records calls; optional throw) ──────────────

function makeMockSql({ throwOn } = {}) {
  const calls = [];
  const fn = (strings, ...values) => {
    const text = strings.reduce(
      (acc, s, i) => acc + s + (i < values.length ? `$${i + 1}` : ''),
      '',
    );
    calls.push({ text, values });
    if (typeof throwOn === 'function' && throwOn(text)) {
      return Promise.reject(new Error('mock SQL rejection'));
    }
    return Promise.resolve([]);
  };
  fn.calls = calls;
  return fn;
}

// ═════════════════════════════════════════════════════════
// rollbackSessionIfNeeded — 4 decision cases (spec)
// ═════════════════════════════════════════════════════════

test('🛑 isNew=true + succeeded=false + sessionId → DELETE FROM sessions WHERE id = $1', async () => {
  const sql = makeMockSql();
  const out = await rollbackSessionIfNeeded({
    sql, sessionId: 42, isNew: true, succeeded: false,
  });
  assert.equal(out, 'deleted');
  assert.equal(sql.calls.length, 1);
  assert.match(sql.calls[0].text, /DELETE FROM sessions WHERE id =/i);
  assert.ok(sql.calls[0].values.includes(42),
    `expected sessionId=42 in DELETE values, saw: ${JSON.stringify(sql.calls[0].values)}`);
});

test('🛑 isNew=false (reuse) + succeeded=false → NO DELETE (in-progress 對話絕不蒸發)', async () => {
  const sql = makeMockSql();
  const out = await rollbackSessionIfNeeded({
    sql, sessionId: 99, isNew: false, succeeded: false,
  });
  assert.equal(out, 'skipped:not-new');
  assert.equal(sql.calls.length, 0,
    'reused row 即使 LLM 炸了也絕對不能刪、用戶 in-progress 對話會蒸發');
});

test('🛑 isNew=true + succeeded=true → NO DELETE (happy path)', async () => {
  const sql = makeMockSql();
  const out = await rollbackSessionIfNeeded({
    sql, sessionId: 42, isNew: true, succeeded: true,
  });
  assert.equal(out, 'skipped:succeeded');
  assert.equal(sql.calls.length, 0);
});

test('🛑 DELETE itself throws → outcome=delete-failed:<msg>, original error not masked', async () => {
  const sql = makeMockSql({ throwOn: t => /DELETE FROM sessions/i.test(t) });
  const out = await rollbackSessionIfNeeded({
    sql, sessionId: 42, isNew: true, succeeded: false,
  });
  assert.match(out, /^delete-failed:/);
  // Helper does NOT throw (caller already has the original downstream error
  // to propagate; we just log the rollback failure).
});

// ─── defensive: missing inputs ──────────────────────────────────────────

test('sessionId missing → skipped:no-target', async () => {
  const sql = makeMockSql();
  const out = await rollbackSessionIfNeeded({ sql, sessionId: null, isNew: true, succeeded: false });
  assert.equal(out, 'skipped:no-target');
  assert.equal(sql.calls.length, 0);
});

test('sql missing → skipped:no-target (neon() threw before sql got assigned)', async () => {
  const out = await rollbackSessionIfNeeded({ sql: null, sessionId: 42, isNew: true, succeeded: false });
  assert.equal(out, 'skipped:no-target');
});

test('no args at all → skipped (defensive, never throws)', async () => {
  const out = await rollbackSessionIfNeeded();
  assert.match(out, /^skipped:/);
});

// ═════════════════════════════════════════════════════════
// 🛑 chat.js wiring grep guard — early returns must come BEFORE _rollbackSessionId
// 被填. 402/409 (PACING_LOCKED / PRIOR_FINALIZE_PENDING / TRIAL_UPGRADE_REQUIRED)
// 走到的是「沒新建 row」 路徑、不能誤觸發 rollback.
// ═════════════════════════════════════════════════════════

test('🛑 chat.js: _rollbackSessionId 必須在所有 402/409 early returns 之後才被填', () => {
  const src = readFileSync(CHAT_JS_PATH, 'utf8');

  const idxPacingLocked     = src.indexOf("error:      'PACING_LOCKED'");
  const idxPriorFinalize    = src.indexOf("error:      'PRIOR_FINALIZE_PENDING'");
  const idxTrialUpgrade     = src.indexOf("error: 'TRIAL_UPGRADE_REQUIRED'");
  const idxRollbackAssign   = src.indexOf('_rollbackSessionId = isNew ? sessionId : null');

  assert.ok(idxPacingLocked  > -1, 'PACING_LOCKED early-return must exist');
  assert.ok(idxPriorFinalize > -1, 'PRIOR_FINALIZE_PENDING early-return must exist');
  assert.ok(idxTrialUpgrade  > -1, 'TRIAL_UPGRADE_REQUIRED early-return must exist');
  assert.ok(idxRollbackAssign > -1, '_rollbackSessionId assignment must exist');

  assert.ok(idxRollbackAssign > idxPacingLocked,
    `_rollbackSessionId assignment (idx=${idxRollbackAssign}) must come AFTER PACING_LOCKED return (idx=${idxPacingLocked})`);
  assert.ok(idxRollbackAssign > idxPriorFinalize,
    `_rollbackSessionId assignment must come AFTER PRIOR_FINALIZE_PENDING return`);
  assert.ok(idxRollbackAssign > idxTrialUpgrade,
    `_rollbackSessionId assignment must come AFTER TRIAL_UPGRADE_REQUIRED return`);
});

test('🛑 chat.js: handler has a finally block that calls rollbackSessionIfNeeded', () => {
  const src = readFileSync(CHAT_JS_PATH, 'utf8');
  // Single source-of-truth check that the wiring is in place.
  assert.match(src, /} finally \{[\s\S]*?rollbackSessionIfNeeded\(/,
    'handler must have a `} finally { … rollbackSessionIfNeeded(…) }` block');
  // _succeeded must be set before the 200 return, with no throw in between.
  // Allow a few lines of intervening setup (e.g. computing depthSignal 5/29);
  // a `throw` would break the safety invariant so banlist it explicitly.
  const between = src.match(/_succeeded = true;([\s\S]*?)return res\.status\(200\)\.json\(/);
  assert.ok(between, '_succeeded=true must appear before the 200 return');
  assert.equal(/\bthrow\b/.test(between[1]), false,
    'no `throw` may appear between `_succeeded = true;` and the 200 return');
  // Defensive cap: don't let the gap grow unbounded (currently ~3 lines, allow 30).
  assert.ok(between[1].split('\n').length <= 30,
    `gap between _succeeded=true and 200 return is suspiciously long (${between[1].split('\n').length} lines)`);
});

test('🛑 chat.js: _rollbackSessionId is only populated when isNew=true (reuse rows never deleted)', () => {
  const src = readFileSync(CHAT_JS_PATH, 'utf8');
  assert.match(src, /_rollbackSessionId = isNew \? sessionId : null/,
    'reuse rows must yield _rollbackSessionId=null so the finally helper short-circuits');
});
