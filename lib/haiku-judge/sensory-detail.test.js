// lib/haiku-judge/sensory-detail.test.js

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { _setClient } from './_base.js';
import {
  SYSTEM_PROMPT,
  buildUserPrompt,
  parse,
  judge,
  isStrictClearance,
} from './sensory-detail.js';

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
// SYSTEM_PROMPT Damon-aligned criteria
// ─────────────────────────────────────────────────────────

test('SYSTEM_PROMPT covers Damon 3 dimensions (具體事件 + self-evidence + derived)', () => {
  assert.match(SYSTEM_PROMPT, /時.*地.*人.*動作/s, 'must list 時/地/人/動作 markers');
  assert.match(SYSTEM_PROMPT, /self/i);
  assert.match(SYSTEM_PROMPT, /others/i);
  assert.match(SYSTEM_PROMPT, /derived/i);
  assert.match(SYSTEM_PROMPT, /Top 1.*Top 2|another value/i, 'must explain derived-evidence scenario');
});

// ─────────────────────────────────────────────────────────
// buildUserPrompt
// ─────────────────────────────────────────────────────────

test('buildUserPrompt includes all 3 inputs', () => {
  const p = buildUserPrompt({
    user_response: '昨天下午我在咖啡店跟同事 Sarah 說了 No',
    prior_question: '舉一個你最近覺得自己是「勇敢」的具體時刻',
    value_being_tested: '勇敢',
  });
  assert.match(p, /勇敢/);
  assert.match(p, /舉一個/);
  assert.match(p, /Sarah/);
});

// ─────────────────────────────────────────────────────────
// parse
// ─────────────────────────────────────────────────────────

test('parse: happy path with all 7 fields', () => {
  const raw = JSON.stringify({
    has_time_marker: true,
    has_location_marker: true,
    has_person_marker: true,
    has_action_marker: false,
    sensory_detail_score: 3,
    evidence_attribution: 'self',
    derived_from_another_value: false,
  });
  const out = parse(raw);
  assert.equal(out.sensory_detail_score, 3);
  assert.equal(out.evidence_attribution, 'self');
});

test('parse: rejects missing field', () => {
  const raw = JSON.stringify({
    has_time_marker: true,
    has_location_marker: true,
    has_person_marker: true,
    has_action_marker: false,
    sensory_detail_score: 3,
    evidence_attribution: 'self',
    // derived_from_another_value missing
  });
  assert.throws(() => parse(raw), /missing key "derived_from_another_value"/);
});

test('parse: rejects bad enum', () => {
  const raw = JSON.stringify({
    has_time_marker: false,
    has_location_marker: false,
    has_person_marker: false,
    has_action_marker: false,
    sensory_detail_score: 0,
    evidence_attribution: 'unknown',  // invalid
    derived_from_another_value: false,
  });
  assert.throws(() => parse(raw), /must be one of/);
});

test('parse: rejects out-of-range score', () => {
  const raw = JSON.stringify({
    has_time_marker: true,
    has_location_marker: true,
    has_person_marker: true,
    has_action_marker: true,
    sensory_detail_score: 5,  // > 4
    evidence_attribution: 'self',
    derived_from_another_value: false,
  });
  assert.throws(() => parse(raw), /out of range 0-4/);
});

test('parse: strips markdown fence around JSON', () => {
  const raw = '```json\n' + JSON.stringify({
    has_time_marker: true,
    has_location_marker: false,
    has_person_marker: false,
    has_action_marker: false,
    sensory_detail_score: 1,
    evidence_attribution: 'ambiguous',
    derived_from_another_value: false,
  }) + '\n```';
  const out = parse(raw);
  assert.equal(out.sensory_detail_score, 1);
});

// ─────────────────────────────────────────────────────────
// judge (with mocked _base client)
// ─────────────────────────────────────────────────────────

test('judge: happy path returns structured output', async () => {
  _setClient(makeMockClient(JSON.stringify({
    has_time_marker: true,
    has_location_marker: true,
    has_person_marker: true,
    has_action_marker: true,
    sensory_detail_score: 4,
    evidence_attribution: 'self',
    derived_from_another_value: false,
  })));
  const out = await judge({
    user_response: '昨天下午我在咖啡店跟同事 Sarah 說了 No、然後提早離開',
    prior_question: '舉一個具體時刻',
    value_being_tested: '勇敢',
    timeoutMs: 1000,
  });
  assert.equal(out.sensory_detail_score, 4);
  assert.equal(out.evidence_attribution, 'self');
});

test('judge: passes correct system prompt to client', async () => {
  const client = makeMockClient(JSON.stringify({
    has_time_marker: false, has_location_marker: false,
    has_person_marker: false, has_action_marker: false,
    sensory_detail_score: 0, evidence_attribution: 'ambiguous',
    derived_from_another_value: false,
  }));
  _setClient(client);
  await judge({
    user_response: '通常我都是這樣',
    prior_question: 'X',
    value_being_tested: 'Y',
    timeoutMs: 1000,
  });
  assert.equal(client.calls[0].system, SYSTEM_PROMPT);
});

test('judge: rejects missing inputs', async () => {
  _setClient(makeMockClient('{}'));
  await assert.rejects(() => judge({ prior_question: 'q', value_being_tested: 'v' }), /user_response/);
  await assert.rejects(() => judge({ user_response: 'r', value_being_tested: 'v' }), /prior_question/);
  await assert.rejects(() => judge({ user_response: 'r', prior_question: 'q' }), /value_being_tested/);
});

// ─────────────────────────────────────────────────────────
// isStrictClearance (spec 02 strict gate)
// ─────────────────────────────────────────────────────────

test('isStrictClearance: passes when all 4 dimensions clear (v5.1 Step 5b dim 4)', () => {
  assert.equal(isStrictClearance({
    sensory_detail_score: 2,
    evidence_attribution: 'self',
    derived_from_another_value: false,
    dim_4: false,
  }), true);
  assert.equal(isStrictClearance({
    sensory_detail_score: 4,
    evidence_attribution: 'self',
    derived_from_another_value: false,
    dim_4: false,
  }), true);
});

test('isStrictClearance: fails when dim_4=true (v5.1 Step 5b strategy-not-quality)', () => {
  assert.equal(isStrictClearance({
    sensory_detail_score: 4,
    evidence_attribution: 'self',
    derived_from_another_value: false,
    dim_4: true,
  }), false);
});

test('isStrictClearance: fails when score < 2', () => {
  assert.equal(isStrictClearance({
    sensory_detail_score: 1,
    evidence_attribution: 'self',
    derived_from_another_value: false,
  }), false);
});

test('isStrictClearance: fails when attribution != self', () => {
  assert.equal(isStrictClearance({
    sensory_detail_score: 4,
    evidence_attribution: 'others',
    derived_from_another_value: false,
  }), false);
  assert.equal(isStrictClearance({
    sensory_detail_score: 4,
    evidence_attribution: 'ambiguous',
    derived_from_another_value: false,
  }), false);
});

test('isStrictClearance: fails when derived', () => {
  assert.equal(isStrictClearance({
    sensory_detail_score: 4,
    evidence_attribution: 'self',
    derived_from_another_value: true,
  }), false);
});
