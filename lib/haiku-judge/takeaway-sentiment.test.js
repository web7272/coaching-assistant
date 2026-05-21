// lib/haiku-judge/takeaway-sentiment.test.js

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { _setClient } from './_base.js';
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parse,
  judge,
  isNegative,
} from './takeaway-sentiment.js';

function makeMockClient(textBody) {
  return {
    messages: {
      async create() { return { content: [{ type: 'text', text: textBody }] }; },
    },
  };
}

beforeEach(() => _setClient(null));

// ─────────────────────────────────────────────────────────
// SYSTEM_PROMPT covers A001 「無力」 calibration
// ─────────────────────────────────────────────────────────

test('SYSTEM_PROMPT covers A001 無力 = negative calibration (not neutral)', () => {
  assert.match(SYSTEM_PROMPT, /無力/);
  assert.match(SYSTEM_PROMPT, /算了|反正/);
  assert.match(SYSTEM_PROMPT, /A001/);
  assert.match(SYSTEM_PROMPT, /coaching made it worse|architectural|made the student worse/i);
});

test('SYSTEM_PROMPT covers all 3 sentiment categories', () => {
  assert.match(SYSTEM_PROMPT, /negative/i);
  assert.match(SYSTEM_PROMPT, /positive/i);
  assert.match(SYSTEM_PROMPT, /neutral/i);
});

test('SYSTEM_PROMPT mentions dashboard failure signal threshold (3 negative)', () => {
  assert.match(SYSTEM_PROMPT, /3.*negative|architectural/i);
});

// ─────────────────────────────────────────────────────────
// buildUserPrompt
// ─────────────────────────────────────────────────────────

test('buildUserPrompt includes anchor + context', () => {
  const p = buildUserPrompt({
    takeaway_term: '發光',
    session_end_context: 'AI: 你今天帶走「發光」\n學員: 嗯…好',
  });
  assert.match(p, /發光/);
  assert.match(p, /嗯…好/);
});

// ─────────────────────────────────────────────────────────
// parse
// ─────────────────────────────────────────────────────────

test('parse: happy path positive', () => {
  assert.deepEqual(parse('{"takeaway_sentiment":"positive"}'), { takeaway_sentiment: 'positive' });
});

test('parse: happy path negative', () => {
  assert.deepEqual(parse('{"takeaway_sentiment":"negative"}'), { takeaway_sentiment: 'negative' });
});

test('parse: rejects bad enum', () => {
  assert.throws(
    () => parse('{"takeaway_sentiment":"meh"}'),
    /takeaway_sentiment.*must be one of/,
  );
});

test('parse: rejects missing field', () => {
  assert.throws(() => parse('{}'), /missing key "takeaway_sentiment"/);
});

test('parse: handles markdown fence', () => {
  const raw = '```json\n{"takeaway_sentiment":"neutral"}\n```';
  assert.deepEqual(parse(raw), { takeaway_sentiment: 'neutral' });
});

// ─────────────────────────────────────────────────────────
// judge
// ─────────────────────────────────────────────────────────

test('judge: happy path negative (A001 無力 scenario)', async () => {
  _setClient(makeMockClient('{"takeaway_sentiment":"negative"}'));
  const out = await judge({
    takeaway_term: '發光',
    session_end_context: 'AI: 帶走「發光」\n學員: 嗯…我覺得我還是很無力',
    timeoutMs: 1000,
  });
  assert.equal(out.takeaway_sentiment, 'negative');
});

test('judge: rejects missing inputs', async () => {
  _setClient(makeMockClient('{"takeaway_sentiment":"positive"}'));
  await assert.rejects(() => judge({ session_end_context: 'x' }), /takeaway_term/);
  await assert.rejects(() => judge({ takeaway_term: 't' }), /session_end_context/);
});

// ─────────────────────────────────────────────────────────
// isNegative (dashboard signal-1 hook)
// ─────────────────────────────────────────────────────────

test('isNegative: only negative counts', () => {
  assert.equal(isNegative({ takeaway_sentiment: 'negative' }), true);
  assert.equal(isNegative({ takeaway_sentiment: 'neutral' }), false);
  assert.equal(isNegative({ takeaway_sentiment: 'positive' }), false);
});
