// lib/util/time-check-in.test.js
// Patrick 5/29 (Vivi proactive) — pickLine boundary 行為鎖.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_CHECK_IN_LINES, pickLine } from './time-check-in.js';

// ─── DEFAULT_CHECK_IN_LINES shape ───────────────────────────────

test('DEFAULT_CHECK_IN_LINES: frozen + 4 entries + ascending atMs', () => {
  assert.ok(Object.isFrozen(DEFAULT_CHECK_IN_LINES));
  assert.equal(DEFAULT_CHECK_IN_LINES.length, 4);
  for (let i = 1; i < DEFAULT_CHECK_IN_LINES.length; i++) {
    assert.ok(DEFAULT_CHECK_IN_LINES[i].atMs > DEFAULT_CHECK_IN_LINES[i - 1].atMs,
      `atMs must ascend (idx=${i})`);
  }
});

test('DEFAULT_CHECK_IN_LINES: thresholds = 0 / 10 / 20 / 40 minutes', () => {
  const M = 60 * 1000;
  assert.deepEqual(
    DEFAULT_CHECK_IN_LINES.map(l => l.atMs),
    [0, 10 * M, 20 * M, 40 * M],
  );
});

test('🛑 DEFAULT_CHECK_IN_LINES: 起始句保留原文「慢慢來，我等你」', () => {
  assert.equal(DEFAULT_CHECK_IN_LINES[0].text, '慢慢來，我等你');
});

test('🛑 DEFAULT_CHECK_IN_LINES: 鐵則 6 — 文案不含「該走了 / 倒數 / 剩餘 / 進度 / 達成」 計分語言', () => {
  const banned = /該走了|倒數|剩餘|剩 \d|進度|達成|完成度|還差/;
  for (const l of DEFAULT_CHECK_IN_LINES) {
    assert.equal(banned.test(l.text), false,
      `line text must avoid scoring/urgency words: "${l.text}"`);
  }
});

// ─── pickLine — boundary cases ──────────────────────────────────

test('pickLine: 0ms → 起始句', () => {
  assert.equal(pickLine(0).text, '慢慢來，我等你');
});

test('pickLine: 1ms (still before 10min) → 起始句', () => {
  assert.equal(pickLine(1).text, '慢慢來，我等你');
});

test('🛑 pickLine: exactly 10min (boundary, inclusive) → 10min 句', () => {
  const at = 10 * 60 * 1000;
  assert.match(pickLine(at).text, /陪自己 10 分鐘/);
});

test('pickLine: 10min - 1ms (just before boundary) → 起始句', () => {
  const at = 10 * 60 * 1000 - 1;
  assert.equal(pickLine(at).text, '慢慢來，我等你');
});

test('pickLine: 15min (between 10 and 20) → 10min 句', () => {
  assert.match(pickLine(15 * 60 * 1000).text, /陪自己 10 分鐘/);
});

test('🛑 pickLine: exactly 20min → 20min 句', () => {
  assert.match(pickLine(20 * 60 * 1000).text, /走了 20 分鐘/);
});

test('🛑 pickLine: exactly 40min → 40min 句', () => {
  assert.match(pickLine(40 * 60 * 1000).text, /40 分鐘了/);
});

test('🛑 pickLine: 超過 40min (e.g. 2hr) → 停在 40min 句 (不繞回、不空)', () => {
  assert.match(pickLine(2 * 60 * 60 * 1000).text, /40 分鐘了/);
  assert.match(pickLine(24 * 60 * 60 * 1000).text, /40 分鐘了/);
});

test('pickLine: negative elapsed → 起始句 (defensive)', () => {
  assert.equal(pickLine(-1000).text, '慢慢來，我等你');
  assert.equal(pickLine(-Infinity).text, '慢慢來，我等你');
});

test('pickLine: NaN / undefined → 起始句 (defensive)', () => {
  assert.equal(pickLine(NaN).text, '慢慢來，我等你');
  assert.equal(pickLine(undefined).text, '慢慢來，我等你');
});

// ─── pickLine — defensive on malformed lines ────────────────────

test('pickLine: empty lines → null', () => {
  assert.equal(pickLine(0, []), null);
});

test('pickLine: non-array lines → null', () => {
  assert.equal(pickLine(0, null), null);
  assert.equal(pickLine(0, undefined), null);
  assert.equal(pickLine(0, 'not-an-array'), null);
});

test('pickLine: lines with bad entries are skipped, valid still wins', () => {
  const lines = [
    { atMs: 0, text: 'start' },
    null,
    { /* missing atMs */ text: 'garbage' },
    { atMs: 1000, text: 'one-sec' },
  ];
  assert.equal(pickLine(0, lines).text, 'start');
  assert.equal(pickLine(1500, lines).text, 'one-sec');
});

test('pickLine: custom lines (debug mode 把分鐘壓成秒) — boundary 行為一致', () => {
  // Vivi sandbox 用 ?ckdebug=1 → unit=1000 (1s 代 1min); pickLine 對 atMs 沒成見.
  const debugLines = [
    { atMs: 0,            text: 's0' },
    { atMs: 10 * 1000,    text: 's10' },
    { atMs: 20 * 1000,    text: 's20' },
  ];
  assert.equal(pickLine(0,        debugLines).text, 's0');
  assert.equal(pickLine(9000,     debugLines).text, 's0');
  assert.equal(pickLine(10000,    debugLines).text, 's10');
  assert.equal(pickLine(19999,    debugLines).text, 's10');
  assert.equal(pickLine(20000,    debugLines).text, 's20');
  assert.equal(pickLine(100000,   debugLines).text, 's20');
});
