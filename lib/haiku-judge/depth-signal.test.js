// lib/haiku-judge/depth-signal.test.js

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { _setClient } from './_base.js';
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parse,
  judge,
  shouldDeepRoute,
} from './depth-signal.js';

function makeMockClient(textBody) {
  return {
    messages: {
      async create() { return { content: [{ type: 'text', text: textBody }] }; },
    },
  };
}

beforeEach(() => _setClient(null));

// ─────────────────────────────────────────────────────────
// SYSTEM_PROMPT Damon-aligned criteria
// ─────────────────────────────────────────────────────────

test('SYSTEM_PROMPT covers Damon worth-fiction signals', () => {
  assert.match(SYSTEM_PROMPT, /不夠好|不配|沒價值/);
  assert.match(SYSTEM_PROMPT, /body metaphor|身體/i);
  assert.match(SYSTEM_PROMPT, /repetition/i);
  assert.match(SYSTEM_PROMPT, /emotional_intensity/i);
});

test('SYSTEM_PROMPT explains depth_judgment_score 0-3 routing semantics', () => {
  assert.match(SYSTEM_PROMPT, /0\s*=/);
  assert.match(SYSTEM_PROMPT, /1\s*=/);
  assert.match(SYSTEM_PROMPT, /2\s*=/);
  assert.match(SYSTEM_PROMPT, /3\s*=/);
  assert.match(SYSTEM_PROMPT, /Vivi/, 'depth_judgment_score 3 should mention Vivi handoff');
});

// ─────────────────────────────────────────────────────────
// buildUserPrompt
// ─────────────────────────────────────────────────────────

test('buildUserPrompt includes current response + context', () => {
  const p = buildUserPrompt({
    user_response: '我覺得我就是不夠好',
    last_3_turns: ['第一句', '第二句', '第三句'],
    anchors_top3: ['踏實', '勇敢'],
  });
  assert.match(p, /不夠好/);
  assert.match(p, /第一句/);
  assert.match(p, /踏實.*勇敢/);
});

test('buildUserPrompt handles empty context arrays', () => {
  const p = buildUserPrompt({
    user_response: 'X',
    last_3_turns: [],
    anchors_top3: [],
  });
  assert.match(p, /no prior context|none yet/i);
});

// ─────────────────────────────────────────────────────────
// parse
// ─────────────────────────────────────────────────────────

test('parse: happy path', () => {
  const raw = JSON.stringify({
    has_specific_event_marker: false,
    repetition_pattern: true,
    body_metaphor_present: true,
    emotional_intensity_estimate: 2,
    depth_judgment_score: 2,
  });
  const out = parse(raw);
  assert.equal(out.depth_judgment_score, 2);
  assert.equal(out.body_metaphor_present, true);
});

test('parse: rejects out-of-range emotional_intensity', () => {
  const raw = JSON.stringify({
    has_specific_event_marker: false, repetition_pattern: false,
    body_metaphor_present: false, emotional_intensity_estimate: 4,  // > 3
    depth_judgment_score: 0,
  });
  assert.throws(() => parse(raw), /emotional_intensity_estimate out of range/);
});

test('parse: rejects out-of-range depth_judgment_score', () => {
  const raw = JSON.stringify({
    has_specific_event_marker: false, repetition_pattern: false,
    body_metaphor_present: false, emotional_intensity_estimate: 0,
    depth_judgment_score: -1,
  });
  assert.throws(() => parse(raw), /depth_judgment_score out of range/);
});

test('parse: rejects missing field', () => {
  const raw = JSON.stringify({
    has_specific_event_marker: false,
    repetition_pattern: false,
    body_metaphor_present: false,
    emotional_intensity_estimate: 0,
    // depth_judgment_score missing
  });
  assert.throws(() => parse(raw), /missing key "depth_judgment_score"/);
});

// ─────────────────────────────────────────────────────────
// judge
// ─────────────────────────────────────────────────────────

test('judge: happy path', async () => {
  _setClient(makeMockClient(JSON.stringify({
    has_specific_event_marker: false, repetition_pattern: true,
    body_metaphor_present: true, emotional_intensity_estimate: 3,
    depth_judgment_score: 3,
  })));
  const out = await judge({
    user_response: '身體裡很重 我真的覺得自己什麼都不是',
    last_3_turns: ['我老是搞砸', '我不配', '我沒救了'],
    timeoutMs: 1000,
  });
  assert.equal(out.depth_judgment_score, 3);
});

test('judge: rejects missing user_response', async () => {
  _setClient(makeMockClient('{}'));
  await assert.rejects(() => judge({ last_3_turns: [], anchors_top3: [] }), /user_response/);
});

test('judge: rejects non-array context inputs', async () => {
  _setClient(makeMockClient('{}'));
  await assert.rejects(
    () => judge({ user_response: 'x', last_3_turns: 'not array' }),
    /last_3_turns must be array/,
  );
  await assert.rejects(
    () => judge({ user_response: 'x', anchors_top3: 'not array' }),
    /anchors_top3 must be array/,
  );
});

test('judge: works without optional context', async () => {
  _setClient(makeMockClient(JSON.stringify({
    has_specific_event_marker: false, repetition_pattern: false,
    body_metaphor_present: false, emotional_intensity_estimate: 1,
    depth_judgment_score: 1,
  })));
  const out = await judge({ user_response: '我覺得我還好', timeoutMs: 1000 });
  assert.equal(out.depth_judgment_score, 1);
});

// ─────────────────────────────────────────────────────────
// shouldDeepRoute (engine 3 routing)
// ─────────────────────────────────────────────────────────

test('shouldDeepRoute: false for 0-1', () => {
  assert.equal(shouldDeepRoute({ depth_judgment_score: 0 }), false);
  assert.equal(shouldDeepRoute({ depth_judgment_score: 1 }), false);
});

test('shouldDeepRoute: true for 2-3', () => {
  assert.equal(shouldDeepRoute({ depth_judgment_score: 2 }), true);
  assert.equal(shouldDeepRoute({ depth_judgment_score: 3 }), true);
});
