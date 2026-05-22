// lib/haiku-judge/subtype-classifier.test.js
// E1 5-way deviation subtype classifier (Patrick 5/22 Q1 — 5th Haiku judge).

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { _setClient } from './_base.js';
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parse,
  judge,
  TIMEOUT_FALLBACK,
} from './subtype-classifier.js';

function makeMockClient(textBody) {
  const calls = [];
  const client = {
    messages: {
      async create(req) {
        calls.push(req);
        return { content: [{ type: 'text', text: textBody }] };
      },
    },
  };
  client.calls = calls;
  return client;
}

beforeEach(() => _setClient(null));

// ─────────────────────────────────────────────────────────
// SYSTEM_PROMPT — Damon-aligned 5-way taxonomy + arbitration
// ─────────────────────────────────────────────────────────

test('SYSTEM_PROMPT names all 5 deviation types', () => {
  assert.match(SYSTEM_PROMPT, /off_topic/);
  assert.match(SYSTEM_PROMPT, /vague/);
  assert.match(SYSTEM_PROMPT, /people_pleasing/);
  assert.match(SYSTEM_PROMPT, /bypassing/);
  assert.match(SYSTEM_PROMPT, /false_positive/);
});

test('SYSTEM_PROMPT documents arbitration priority order', () => {
  assert.match(SYSTEM_PROMPT, /people_pleasing > bypassing > vague > off_topic/);
});

test('SYSTEM_PROMPT documents explicit_protest priority routing', () => {
  assert.match(SYSTEM_PROMPT, /explicit_protest/);
  assert.match(SYSTEM_PROMPT, /E1c/);
  assert.match(SYSTEM_PROMPT, /E1a/);
});

// ─────────────────────────────────────────────────────────
// buildUserPrompt
// ─────────────────────────────────────────────────────────

test('buildUserPrompt embeds response, question and state signals', () => {
  const p = buildUserPrompt({
    user_response: '應該是吧',
    last_ai_question: '你最近覺得自己勇敢的時刻?',
    triggered_signals: ['vague_words'],
    cumulative_ppl_score: 0.4,
    consecutive_vague_turns: 2,
    elicitation_mode_active: true,
    recent_specific_examples_count: 1,
  });
  assert.match(p, /應該是吧/);
  assert.match(p, /勇敢的時刻/);
  assert.match(p, /vague_words/);
  assert.match(p, /0\.4/);
  assert.match(p, /consecutive_vague_turns: 2/);
});

test('buildUserPrompt tolerates missing optional fields', () => {
  const p = buildUserPrompt({ user_response: 'X' });
  assert.match(p, /\(none\)/);            // last_ai_question default
  assert.match(p, /triggered_signals: \[\]/);
});

// ─────────────────────────────────────────────────────────
// parse
// ─────────────────────────────────────────────────────────

test('parse: happy path', () => {
  const out = parse(JSON.stringify({
    deviation_type: 'people_pleasing',
    confidence: 'high',
    evidence: ['short compliance', 'echo'],
    arbitration_applied: true,
    recommended_sub_prompt: 'E1c',
  }));
  assert.equal(out.deviation_type, 'people_pleasing');
  assert.equal(out.recommended_sub_prompt, 'E1c');
});

test('parse: strips markdown fence', () => {
  const out = parse('```json\n' + JSON.stringify({
    deviation_type: 'false_positive',
    confidence: 'low',
    evidence: [],
    arbitration_applied: false,
    recommended_sub_prompt: 'none',
  }) + '\n```');
  assert.equal(out.deviation_type, 'false_positive');
});

test('parse: rejects bad deviation_type enum', () => {
  assert.throws(() => parse(JSON.stringify({
    deviation_type: 'spiral',
    confidence: 'high',
    evidence: [],
    arbitration_applied: false,
    recommended_sub_prompt: 'none',
  })), /must be one of/);
});

test('parse: rejects bad recommended_sub_prompt enum', () => {
  assert.throws(() => parse(JSON.stringify({
    deviation_type: 'off_topic',
    confidence: 'high',
    evidence: [],
    arbitration_applied: false,
    recommended_sub_prompt: 'E1z',
  })), /must be one of/);
});

test('parse: rejects non-array evidence', () => {
  assert.throws(() => parse(JSON.stringify({
    deviation_type: 'vague',
    confidence: 'medium',
    evidence: 'not-an-array',
    arbitration_applied: false,
    recommended_sub_prompt: 'E1b',
  })), /evidence must be an array/);
});

// ─────────────────────────────────────────────────────────
// judge (mocked client)
// ─────────────────────────────────────────────────────────

test('judge: happy path returns structured classification', async () => {
  _setClient(makeMockClient(JSON.stringify({
    deviation_type: 'bypassing',
    confidence: 'high',
    evidence: ['宇宙能量'],
    arbitration_applied: false,
    recommended_sub_prompt: 'E1d',
  })));
  const out = await judge({ user_response: '我覺得整個宇宙都在指引我覺醒', timeoutMs: 1000 });
  assert.equal(out.deviation_type, 'bypassing');
  assert.equal(out.recommended_sub_prompt, 'E1d');
});

test('judge: passes SYSTEM_PROMPT to the client', async () => {
  const client = makeMockClient(JSON.stringify({
    deviation_type: 'false_positive',
    confidence: 'low',
    evidence: [],
    arbitration_applied: false,
    recommended_sub_prompt: 'none',
  }));
  _setClient(client);
  await judge({ user_response: '昨天我跟同事說了 No', timeoutMs: 1000 });
  assert.equal(client.calls[0].system, SYSTEM_PROMPT);
});

test('judge: rejects missing user_response', async () => {
  _setClient(makeMockClient('{}'));
  await assert.rejects(() => judge({}), /user_response/);
  await assert.rejects(() => judge({ user_response: '' }), /user_response/);
  await assert.rejects(() => judge({ user_response: 123 }), /user_response/);
});

// ─────────────────────────────────────────────────────────
// TIMEOUT_FALLBACK — conservative: do not inject
// ─────────────────────────────────────────────────────────

test('TIMEOUT_FALLBACK: conservative — recommended_sub_prompt none, frozen', () => {
  assert.equal(TIMEOUT_FALLBACK.recommended_sub_prompt, 'none');
  assert.equal(TIMEOUT_FALLBACK.deviation_type, 'false_positive');
  assert.equal(TIMEOUT_FALLBACK.confidence, 'low');
  assert.ok(Object.isFrozen(TIMEOUT_FALLBACK));
});
