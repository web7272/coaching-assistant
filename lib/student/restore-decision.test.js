// lib/student/restore-decision.test.js
// Patrick 6/6 P0 — frontend restore reconciliation (A015 root cause).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { decideRestoreAction } from './restore-decision.js';

// ─── Path A: server fetch failed → fail-open ─────────────────────

test('🛑 P0 fetch-fail + local empty → kickoff (don\'t lock student out)', () => {
  const r = decideRestoreAction({
    local: { conversation: [], lastSessionId: null },
    serverFetchOk: false,
    server: null,
  });
  assert.equal(r.action, 'kickoff');
  assert.equal(r.reason, 'server_fetch_failed_and_local_empty');
});

test('🛑 P0 fetch-fail + local non-empty → no-op (keep what we have)', () => {
  const r = decideRestoreAction({
    local: { conversation: [{ role: 'assistant', content: 'hi' }], lastSessionId: 47 },
    serverFetchOk: false,
    server: null,
  });
  assert.equal(r.action, 'no-op');
  assert.equal(r.reason, 'server_fetch_failed_keep_local');
});

// ─── Path B: server has nothing ──────────────────────────────────

test('🛑 P0 server-nothing + local empty → kickoff (current behavior preserved)', () => {
  const r = decideRestoreAction({
    local: { conversation: [], lastSessionId: null },
    serverFetchOk: true,
    server: { hasInProgress: false, sessionId: null, messages: [] },
  });
  assert.equal(r.action, 'kickoff');
});

test('🛑 P0 server-nothing + local non-empty → no-op (closure-just-happened edge)', () => {
  const r = decideRestoreAction({
    local: { conversation: [{ role: 'assistant', content: 'something' }], lastSessionId: 50 },
    serverFetchOk: true,
    server: { hasInProgress: false, sessionId: null, messages: [] },
  });
  assert.equal(r.action, 'no-op');
  assert.equal(r.reason, 'no_server_session_keep_local');
});

test('🛑 P0 server with hasInProgress=true but EMPTY messages → treat as no-server (kickoff if local empty)', () => {
  const r = decideRestoreAction({
    local: { conversation: [], lastSessionId: null },
    serverFetchOk: true,
    server: { hasInProgress: true, sessionId: 99, messages: [] },
  });
  assert.equal(r.action, 'kickoff');
});

// ─── Path C: server has in-progress → reconcile ─────────────────

test('🛑 P0 server-has-session + local empty → use server (current behavior preserved)', () => {
  const r = decideRestoreAction({
    local: { conversation: [], lastSessionId: null },
    serverFetchOk: true,
    server: {
      hasInProgress: true, sessionId: 51,
      messages: [{ role: 'assistant', content: 'hi' }, { role: 'user', content: '2' }],
    },
  });
  assert.equal(r.action, 'use-server');
  assert.equal(r.sessionId, 51);
  assert.equal(r.messages.length, 2);
  assert.equal(r.reason, 'local_empty');
});

test('🛑 P0 A015 repro: stale lastSessionId (47 vs server 51) → use server (THE BUG)', () => {
  // This is the exact pre-hotfix failure: localStorage had 1 stale message
  // pointing to old session 47; server has the real session 51 with 4 msgs.
  // Pre-fix: state.conversation.length === 1 → skipped fetch → stale shown.
  const r = decideRestoreAction({
    local: {
      conversation: [{ role: 'assistant', content: '初始第一句(stale)' }],
      lastSessionId: 47,
    },
    serverFetchOk: true,
    server: {
      hasInProgress: true, sessionId: 51,
      messages: [
        { role: 'assistant', content: 'opening' },
        { role: 'user', content: '2' },
        { role: 'assistant', content: 'category 2' },
        { role: 'user', content: '我想自殺' },
        { role: 'assistant', content: 'Step 4 high_risk' },
      ],
    },
  });
  assert.equal(r.action, 'use-server',
    'A015: stale sessionId mismatch MUST override local cache');
  assert.equal(r.reason, 'stale_session_id');
  assert.equal(r.sessionId, 51);
  assert.equal(r.messages.length, 5);
  assert.equal(r.prevLocalCount, 1);
});

test('🛑 P0 localShorter: same sessionId but server has more msgs → use server', () => {
  // Edge: local snapshot missed a round (e.g. send fail mid-render).
  const r = decideRestoreAction({
    local: {
      conversation: [
        { role: 'assistant', content: 'a' }, { role: 'user', content: 'b' },
      ],
      lastSessionId: 51,
    },
    serverFetchOk: true,
    server: {
      hasInProgress: true, sessionId: 51,
      messages: [
        { role: 'assistant', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'assistant', content: 'c' },   // local missed this
      ],
    },
  });
  assert.equal(r.action, 'use-server');
  assert.equal(r.reason, 'local_shorter');
});

test('🛑 P0 local in sync: same sessionId AND same length → no-op (no flicker)', () => {
  const r = decideRestoreAction({
    local: {
      conversation: [
        { role: 'assistant', content: 'a' }, { role: 'user', content: 'b' },
      ],
      lastSessionId: 51,
    },
    serverFetchOk: true,
    server: {
      hasInProgress: true, sessionId: 51,
      messages: [
        { role: 'assistant', content: 'a' }, { role: 'user', content: 'b' },
      ],
    },
  });
  assert.equal(r.action, 'no-op');
  assert.equal(r.reason, 'local_in_sync');
});

test('🛑 P0 local LONGER than server (race: local sent a msg, server not yet flushed) → no-op (preserve local)', () => {
  // Defensive — student just sent a message that's queued client-side and
  // not yet visible to the read endpoint. Don't truncate local with server.
  const r = decideRestoreAction({
    local: {
      conversation: [
        { role: 'assistant', content: 'a' },
        { role: 'user', content: 'b' },
        { role: 'user', content: 'c (just-sent)' },
      ],
      lastSessionId: 51,
    },
    serverFetchOk: true,
    server: {
      hasInProgress: true, sessionId: 51,
      messages: [
        { role: 'assistant', content: 'a' },
        { role: 'user', content: 'b' },
      ],
    },
  });
  assert.equal(r.action, 'no-op');
  assert.equal(r.reason, 'local_in_sync');
});

// ─── Defensive: malformed inputs ────────────────────────────────

test('🛑 P0 defensive: missing local → treated as empty', () => {
  const r = decideRestoreAction({
    serverFetchOk: true,
    server: { hasInProgress: false, sessionId: null, messages: [] },
  });
  assert.equal(r.action, 'kickoff');
});

test('🛑 P0 defensive: missing args entirely → kickoff (fail-open)', () => {
  const r = decideRestoreAction();
  assert.equal(r.action, 'kickoff');
});

test('🛑 P0 defensive: server fetchOk but null body → treat as no in-progress', () => {
  const r = decideRestoreAction({
    local: { conversation: [], lastSessionId: null },
    serverFetchOk: true,
    server: null,
  });
  assert.equal(r.action, 'kickoff');
});

test('🛑 P0 lastSessionId null + server has session → still treated as use-server (no stale check, local was empty)', () => {
  // Defensive: localSid=null is "we don't know" not "mismatch". Without a
  // previously seen sid we can't be stale; the local-empty branch carries it.
  const r = decideRestoreAction({
    local: { conversation: [], lastSessionId: null },
    serverFetchOk: true,
    server: {
      hasInProgress: true, sessionId: 51,
      messages: [{ role: 'assistant', content: 'opening' }],
    },
  });
  assert.equal(r.action, 'use-server');
  assert.equal(r.reason, 'local_empty');
});

// ─── Sync gate: student.js inline impl must match module ─────────
//
// Patrick scope discipline gate — student.js is a non-module browser script
// and re-implements decideRestoreActionInline() with the same semantics.
// CI-level integrity is enforced by running THIS module's tests against
// the inline implementation extracted from student.js source.

test('🛑 SYNC GATE: student.js decideRestoreActionInline matches the module behaviorally', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const studentPath = join(here, '..', '..', 'student.js');
  const src = readFileSync(studentPath, 'utf8');

  // Locate the inline function body between the two sentinels.
  // We avoid full JS parsing — sentinels are unique markers we wrote in.
  const start = '// ⭐ SYNC GATE START — decideRestoreActionInline (mirror of lib/student/restore-decision.js)';
  const end   = '// ⭐ SYNC GATE END — decideRestoreActionInline';
  const startIdx = src.indexOf(start);
  const endIdx   = src.indexOf(end);
  assert.ok(startIdx !== -1, 'student.js must contain SYNC GATE START sentinel');
  assert.ok(endIdx   !== -1 && endIdx > startIdx, 'student.js must contain SYNC GATE END sentinel');

  const block = src.slice(startIdx + start.length, endIdx);
  // The block is a JS function declaration: `function decideRestoreActionInline(args) { ... }`.
  // Evaluate it in an isolated scope.
  // eslint-disable-next-line no-new-func
  const factory = new Function(`${block}; return decideRestoreActionInline;`);
  const inline = factory();
  assert.equal(typeof inline, 'function', 'inline must be a function');

  // Run the same 6 canonical scenarios against the inline impl.
  const cases = [
    {
      label: 'fetch-fail + local empty → kickoff',
      args: { local: { conversation: [], lastSessionId: null }, serverFetchOk: false, server: null },
      expectAction: 'kickoff',
    },
    {
      label: 'fetch-fail + local non-empty → no-op',
      args: { local: { conversation: [{ role:'assistant', content:'x' }], lastSessionId: 1 }, serverFetchOk: false, server: null },
      expectAction: 'no-op',
    },
    {
      label: 'server-nothing + local empty → kickoff',
      args: { local: { conversation: [], lastSessionId: null }, serverFetchOk: true,
              server: { hasInProgress: false, sessionId: null, messages: [] } },
      expectAction: 'kickoff',
    },
    {
      label: 'A015 stale repro → use-server',
      args: {
        local: { conversation: [{ role:'assistant', content:'stale' }], lastSessionId: 47 },
        serverFetchOk: true,
        server: { hasInProgress: true, sessionId: 51,
                  messages: [{ role:'assistant', content:'a' }, { role:'user', content:'b' }] },
      },
      expectAction: 'use-server',
    },
    {
      label: 'local in sync → no-op',
      args: {
        local: { conversation: [{ role:'assistant', content:'a' }], lastSessionId: 51 },
        serverFetchOk: true,
        server: { hasInProgress: true, sessionId: 51, messages: [{ role:'assistant', content:'a' }] },
      },
      expectAction: 'no-op',
    },
    {
      label: 'server-has + local empty → use-server',
      args: {
        local: { conversation: [], lastSessionId: null },
        serverFetchOk: true,
        server: { hasInProgress: true, sessionId: 99, messages: [{ role:'assistant', content:'x' }] },
      },
      expectAction: 'use-server',
    },
  ];
  for (const c of cases) {
    const moduleResult = decideRestoreAction(c.args);
    const inlineResult = inline(c.args);
    assert.equal(inlineResult.action, c.expectAction, `inline ${c.label}`);
    assert.equal(moduleResult.action, c.expectAction, `module ${c.label}`);
    assert.equal(inlineResult.action, moduleResult.action, `divergence on ${c.label}`);
    assert.equal(inlineResult.reason, moduleResult.reason, `reason divergence on ${c.label}`);
  }
});
