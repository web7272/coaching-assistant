// api/phase-report.test.js — Sonnet prompt builders (P4)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildBreakthroughPrompt, buildBreakthroughUserMessage,
} from './phase-report.js';

// ─────────────────────────────────────────────────────────
// buildBreakthroughPrompt — the Sonnet system prompt
// ─────────────────────────────────────────────────────────

test('🛑 buildBreakthroughPrompt: 紅線 1 — never contains 為什麼', () => {
  for (let id = 1; id <= 5; id++) {
    const s = buildBreakthroughPrompt(id, '某 phase', 'Vivi');
    assert.doesNotMatch(s, /為什麼/, `phase ${id} prompt must not violate 紅線 1`);
  }
});

test('🛑 buildBreakthroughPrompt: explicitly forbids coach-internal section names', () => {
  const s = buildBreakthroughPrompt(1, '找到你真正要的', 'Vivi');
  // The prompt should INSTRUCT Sonnet not to leak Damon-Note section headers,
  // so it MUST mention them by name as forbidden — defence-in-depth.
  assert.match(s, /【SC 觀察】/);
  assert.match(s, /【深度層次】/);
  assert.match(s, /Layer 1-5/);
  assert.match(s, /工具一/);
});

test('buildBreakthroughPrompt: weaves preferredName as a 0-1 warmth hook (not at start)', () => {
  const s = buildBreakthroughPrompt(2, '你是誰', 'Vivi');
  assert.match(s, /學員「Vivi」/);   // identifies the student in the briefing
  assert.match(s, /可少量用「Vivi」增暖/);   // tells Sonnet to use the name sparingly
});

test('buildBreakthroughPrompt: falls back to「學員」when no name given', () => {
  const s = buildBreakthroughPrompt(3, '擴大地圖', null);
  assert.match(s, /學員「學員」/);   // no name → generic
});

test('🛑 buildBreakthroughPrompt: each phaseId points at a different observation focus', () => {
  // Pin: phase 1 (values), phase 2 (identity), phase 3 (counter-examples),
  //      phase 4 (parts integration), phase 5 (let-go)
  const p1 = buildBreakthroughPrompt(1, 'x', null);
  const p2 = buildBreakthroughPrompt(2, 'x', null);
  const p3 = buildBreakthroughPrompt(3, 'x', null);
  const p4 = buildBreakthroughPrompt(4, 'x', null);
  const p5 = buildBreakthroughPrompt(5, 'x', null);
  assert.match(p1, /核心價值觀/);
  assert.match(p2, /我是/);
  assert.match(p3, /反例/);
  assert.match(p4, /阻力的正向意圖/);
  assert.match(p5, /與價值對齊/);
  // distinct briefings
  const tails = [p1, p2, p3, p4, p5].map(s => s.slice(-200));
  assert.equal(new Set(tails).size, 5, 'each phase should brief Sonnet on a distinct focus');
});

test('buildBreakthroughPrompt: format requirements explicit + 6-8 lines', () => {
  const s = buildBreakthroughPrompt(1, 'x', null);
  assert.match(s, /6-8 行/);
  assert.match(s, /引用學員真實原話/);
  assert.match(s, /平靜地指向下一步/);
});

// ─────────────────────────────────────────────────────────
// buildBreakthroughUserMessage — the per-student damon_notes context
// ─────────────────────────────────────────────────────────

test('buildBreakthroughUserMessage: empty / nullish → graceful fallback string', () => {
  const empty = buildBreakthroughUserMessage([]);
  assert.match(empty, /Damon Note 還很空/);
  assert.match(empty, /不要硬編未發生的事/);
  assert.equal(buildBreakthroughUserMessage(null), empty);
  assert.equal(buildBreakthroughUserMessage(undefined), empty);
});

test('buildBreakthroughUserMessage: sorts by day asc + uses [Day N] markers', () => {
  const out = buildBreakthroughUserMessage([
    { day: 3, note_text: 'note 3' },
    { day: 1, note_text: 'note 1' },
    { day: 2, note_text: 'note 2' },
  ]);
  // sorted
  const i1 = out.indexOf('[Day 1]');
  const i2 = out.indexOf('[Day 2]');
  const i3 = out.indexOf('[Day 3]');
  assert.ok(i1 > -1 && i2 > i1 && i3 > i2, 'notes must appear in day order');
});

test('buildBreakthroughUserMessage: separator between notes', () => {
  const out = buildBreakthroughUserMessage([
    { day: 1, note_text: 'a' }, { day: 2, note_text: 'b' },
  ]);
  assert.match(out, /---/, 'notes should be visually separated');
});

test('buildBreakthroughUserMessage: tolerates missing note_text', () => {
  const out = buildBreakthroughUserMessage([{ day: 1 }]);
  assert.match(out, /\[Day 1\]/);
});
