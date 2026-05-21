// lib/haiku-judge/containment-logic.test.js

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { _setClient } from './_base.js';
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parse,
  judge,
  aPassesContainment,
} from './containment-logic.js';

function makeMockClient(textBody) {
  return {
    messages: {
      async create() { return { content: [{ type: 'text', text: textBody }] }; },
    },
  };
}

beforeEach(() => _setClient(null));

// ─────────────────────────────────────────────────────────
// SYSTEM_PROMPT
// ─────────────────────────────────────────────────────────

test('SYSTEM_PROMPT covers Damon containment vs linear thinking distinction', () => {
  assert.match(SYSTEM_PROMPT, /containment/i);
  assert.match(SYSTEM_PROMPT, /Linear Thinking Error/i);
  assert.match(SYSTEM_PROMPT, /必須先.*才能|沒有.*就不可能/);
  assert.match(SYSTEM_PROMPT, /A_contains_B/);
});

// ─────────────────────────────────────────────────────────
// buildUserPrompt
// ─────────────────────────────────────────────────────────

test('buildUserPrompt includes both values and question', () => {
  const p = buildUserPrompt({
    user_response: '我覺得自由比較大、勇敢在自由裡',
    prior_containment_question: '沒有勇敢、自由還能存在嗎?',
    values_being_compared: ['自由', '勇敢'],
  });
  assert.match(p, /自由/);
  assert.match(p, /勇敢/);
  assert.match(p, /A = 自由/);
  assert.match(p, /B = 勇敢/);
});

// ─────────────────────────────────────────────────────────
// parse
// ─────────────────────────────────────────────────────────

test('parse: happy path A_contains_B', () => {
  const raw = JSON.stringify({
    answer_addresses_containment: true,
    linear_thinking_error_detected: false,
    containment_direction: 'A_contains_B',
    confidence: 'high',
  });
  const out = parse(raw);
  assert.equal(out.containment_direction, 'A_contains_B');
  assert.equal(out.confidence, 'high');
});

test('parse: rejects bad enum for direction', () => {
  const raw = JSON.stringify({
    answer_addresses_containment: true,
    linear_thinking_error_detected: false,
    containment_direction: 'somehow',
    confidence: 'high',
  });
  assert.throws(() => parse(raw), /containment_direction.*must be one of/);
});

test('parse: rejects bad enum for confidence', () => {
  const raw = JSON.stringify({
    answer_addresses_containment: true,
    linear_thinking_error_detected: false,
    containment_direction: 'unclear',
    confidence: 'very-sure',
  });
  assert.throws(() => parse(raw), /confidence.*must be one of/);
});

// ─────────────────────────────────────────────────────────
// judge
// ─────────────────────────────────────────────────────────

test('judge: happy path', async () => {
  _setClient(makeMockClient(JSON.stringify({
    answer_addresses_containment: true,
    linear_thinking_error_detected: false,
    containment_direction: 'A_contains_B',
    confidence: 'high',
  })));
  const out = await judge({
    user_response: '自由比較大、勇敢在自由裡',
    prior_containment_question: '沒有勇敢、自由還能存在嗎?',
    values_being_compared: ['自由', '勇敢'],
    timeoutMs: 1000,
  });
  assert.equal(out.containment_direction, 'A_contains_B');
});

test('judge: linear thinking error detected', async () => {
  _setClient(makeMockClient(JSON.stringify({
    answer_addresses_containment: false,
    linear_thinking_error_detected: true,
    containment_direction: 'unclear',
    confidence: 'high',
  })));
  const out = await judge({
    user_response: '我必須先有自由、才能勇敢',
    prior_containment_question: '沒有勇敢、自由還能存在嗎?',
    values_being_compared: ['自由', '勇敢'],
    timeoutMs: 1000,
  });
  assert.equal(out.linear_thinking_error_detected, true);
});

test('judge: rejects missing inputs', async () => {
  _setClient(makeMockClient('{}'));
  await assert.rejects(
    () => judge({ prior_containment_question: 'q', values_being_compared: ['a', 'b'] }),
    /user_response/,
  );
  await assert.rejects(
    () => judge({ user_response: 'r', values_being_compared: ['a', 'b'] }),
    /prior_containment_question/,
  );
});

test('judge: rejects bad values_being_compared shape', async () => {
  _setClient(makeMockClient('{}'));
  await assert.rejects(
    () => judge({ user_response: 'r', prior_containment_question: 'q', values_being_compared: ['only one'] }),
    /2-element array/,
  );
  await assert.rejects(
    () => judge({ user_response: 'r', prior_containment_question: 'q', values_being_compared: 'a,b' }),
    /2-element array/,
  );
  await assert.rejects(
    () => judge({ user_response: 'r', prior_containment_question: 'q', values_being_compared: ['', 'b'] }),
    /non-empty strings/,
  );
});

// ─────────────────────────────────────────────────────────
// aPassesContainment (E3_top1 Step 6 helper)
// ─────────────────────────────────────────────────────────

test('aPassesContainment: true when A_contains_B + high/medium confidence + no errors', () => {
  assert.equal(aPassesContainment({
    answer_addresses_containment: true,
    linear_thinking_error_detected: false,
    containment_direction: 'A_contains_B',
    confidence: 'high',
  }), true);
  assert.equal(aPassesContainment({
    answer_addresses_containment: true,
    linear_thinking_error_detected: false,
    containment_direction: 'A_contains_B',
    confidence: 'medium',
  }), true);
});

test('aPassesContainment: false on low confidence', () => {
  assert.equal(aPassesContainment({
    answer_addresses_containment: true,
    linear_thinking_error_detected: false,
    containment_direction: 'A_contains_B',
    confidence: 'low',
  }), false);
});

test('aPassesContainment: false when linear thinking error', () => {
  assert.equal(aPassesContainment({
    answer_addresses_containment: false,
    linear_thinking_error_detected: true,
    containment_direction: 'unclear',
    confidence: 'high',
  }), false);
});

test('aPassesContainment: false when B_contains_A or interdependent or unclear', () => {
  for (const dir of ['B_contains_A', 'interdependent', 'unclear']) {
    assert.equal(aPassesContainment({
      answer_addresses_containment: true,
      linear_thinking_error_detected: false,
      containment_direction: dir,
      confidence: 'high',
    }), false, `direction ${dir} should not pass A`);
  }
});
