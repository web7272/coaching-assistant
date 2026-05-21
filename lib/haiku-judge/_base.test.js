// lib/haiku-judge/_base.test.js
// 重點：
//   - happy path：mock SDK 回 text content → parse 拿到結構化 output
//   - 200ms timeout：mock SDK 拖過 timeout → throw JudgeTimeoutError
//   - schema error：parse 丟錯 / 無 text content → throw JudgeSchemaError

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  HAIKU_MODEL,
  DEFAULT_TIMEOUT_MS,
  JudgeTimeoutError,
  JudgeSchemaError,
  runJudge,
  _setClient,
  _internal,
} from './_base.js';

// ─────────────────────────────────────────────────────────
// mock Anthropic-shaped client
// ─────────────────────────────────────────────────────────

function makeMockClient({ delayMs = 0, response, errorOnCreate } = {}) {
  const calls = [];
  const client = {
    messages: {
      create(req) {
        calls.push(req);
        if (errorOnCreate) return Promise.reject(errorOnCreate);
        return new Promise((resolve) => {
          setTimeout(() => resolve(response), delayMs);
        });
      },
    },
  };
  client.calls = calls;
  return client;
}

function textResponse(text) {
  return { content: [{ type: 'text', text }] };
}

beforeEach(() => {
  _setClient(null);
});

// ─────────────────────────────────────────────────────────
// constants
// ─────────────────────────────────────────────────────────

test('HAIKU_MODEL is claude-haiku-4-5-* (matches spec 02 §1)', () => {
  assert.match(HAIKU_MODEL, /^claude-haiku-4-5/);
});

test('DEFAULT_TIMEOUT_MS = 200 (spec 02 §1)', () => {
  assert.equal(DEFAULT_TIMEOUT_MS, 200);
});

// ─────────────────────────────────────────────────────────
// happy path
// ─────────────────────────────────────────────────────────

test('runJudge: happy path returns parsed structured output', async () => {
  const client = makeMockClient({
    response: textResponse(JSON.stringify({ sensory_detail_score: 3, evidence_attribution: 'self' })),
  });
  _setClient(client);

  const out = await runJudge({
    system: 'judge sensory detail',
    prompt: 'user said: 昨天下午在咖啡店',
    parse: (raw) => JSON.parse(raw),
    timeoutMs: 1000,
  });

  assert.deepEqual(out, { sensory_detail_score: 3, evidence_attribution: 'self' });
  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].model, HAIKU_MODEL);
  assert.equal(client.calls[0].system, 'judge sensory detail');
  assert.equal(client.calls[0].messages[0].content, 'user said: 昨天下午在咖啡店');
});

test('runJudge: passes maxTokens through to SDK', async () => {
  const client = makeMockClient({ response: textResponse('{}') });
  _setClient(client);
  await runJudge({
    system: 's',
    prompt: 'p',
    parse: () => ({}),
    timeoutMs: 500,
    maxTokens: 999,
  });
  assert.equal(client.calls[0].max_tokens, 999);
});

// ─────────────────────────────────────────────────────────
// ⭐ 200ms timeout → JudgeTimeoutError
// ─────────────────────────────────────────────────────────

test('🛑 runJudge: throws JudgeTimeoutError when SDK exceeds timeoutMs', async () => {
  // SDK takes 100ms; we cap at 30ms → must timeout
  const client = makeMockClient({
    delayMs: 100,
    response: textResponse('{"x":1}'),
  });
  _setClient(client);

  await assert.rejects(
    () => runJudge({
      system: 's',
      prompt: 'p',
      parse: (r) => JSON.parse(r),
      timeoutMs: 30,
    }),
    (err) => {
      assert.ok(err instanceof JudgeTimeoutError, 'must be JudgeTimeoutError');
      assert.equal(err.timeout_ms, 30);
      assert.ok(err.elapsed_ms >= 30, `elapsed_ms ${err.elapsed_ms} should be >= timeout`);
      assert.match(err.message, /timed out after \d+ms/);
      return true;
    },
  );
});

test('runJudge: no timeout when SDK responds quickly', async () => {
  const client = makeMockClient({
    delayMs: 10,
    response: textResponse('{"ok":true}'),
  });
  _setClient(client);
  const out = await runJudge({
    system: 's',
    prompt: 'p',
    parse: (r) => JSON.parse(r),
    timeoutMs: 100,
  });
  assert.deepEqual(out, { ok: true });
});

// ─────────────────────────────────────────────────────────
// schema errors
// ─────────────────────────────────────────────────────────

test('runJudge: throws JudgeSchemaError when response has no text content', async () => {
  const client = makeMockClient({ response: { content: [] } });
  _setClient(client);

  await assert.rejects(
    () => runJudge({ system: 's', prompt: 'p', parse: () => ({}), timeoutMs: 1000 }),
    (err) => {
      assert.ok(err instanceof JudgeSchemaError);
      assert.match(err.message, /no text content/i);
      return true;
    },
  );
});

test('runJudge: throws JudgeSchemaError when parse throws', async () => {
  const client = makeMockClient({ response: textResponse('not-json') });
  _setClient(client);

  await assert.rejects(
    () => runJudge({
      system: 's',
      prompt: 'p',
      parse: (raw) => { JSON.parse(raw); },
      timeoutMs: 1000,
    }),
    (err) => {
      assert.ok(err instanceof JudgeSchemaError);
      assert.match(err.message, /parse failed/);
      assert.equal(err.raw, 'not-json');
      return true;
    },
  );
});

test('runJudge: throws JudgeSchemaError when parse returns but schema validation fails', async () => {
  const client = makeMockClient({ response: textResponse('{"sensory_detail_score":"oops"}') });
  _setClient(client);

  await assert.rejects(
    () => runJudge({
      system: 's',
      prompt: 'p',
      parse: (raw) => {
        const obj = JSON.parse(raw);
        if (typeof obj.sensory_detail_score !== 'number') {
          throw new Error('sensory_detail_score must be number');
        }
        return obj;
      },
      timeoutMs: 1000,
    }),
    (err) => {
      assert.ok(err instanceof JudgeSchemaError);
      assert.match(err.message, /sensory_detail_score must be number/);
      return true;
    },
  );
});

// ─────────────────────────────────────────────────────────
// input validation
// ─────────────────────────────────────────────────────────

test('runJudge: rejects non-string system / prompt', async () => {
  _setClient(makeMockClient({ response: textResponse('{}') }));
  await assert.rejects(
    () => runJudge({ system: '', prompt: 'p', parse: () => ({}) }),
    /system must be non-empty/,
  );
  await assert.rejects(
    () => runJudge({ system: 's', prompt: '', parse: () => ({}) }),
    /prompt must be non-empty/,
  );
});

test('runJudge: rejects non-function parse', async () => {
  _setClient(makeMockClient({ response: textResponse('{}') }));
  await assert.rejects(
    () => runJudge({ system: 's', prompt: 'p', parse: 'not a fn' }),
    /parse must be a function/,
  );
});

// ─────────────────────────────────────────────────────────
// extractText helper
// ─────────────────────────────────────────────────────────

test('extractText: returns text from first text block', () => {
  assert.equal(
    _internal.extractText({ content: [{ type: 'text', text: 'hello' }] }),
    'hello',
  );
});

test('extractText: skips non-text blocks', () => {
  assert.equal(
    _internal.extractText({
      content: [
        { type: 'tool_use', id: 'x' },
        { type: 'text', text: 'real' },
      ],
    }),
    'real',
  );
});

test('extractText: returns null when no text block', () => {
  assert.equal(_internal.extractText({ content: [{ type: 'tool_use' }] }), null);
  assert.equal(_internal.extractText({ content: [] }), null);
  assert.equal(_internal.extractText(null), null);
  assert.equal(_internal.extractText({}), null);
});

test('extractText: empty text string is not counted', () => {
  assert.equal(_internal.extractText({ content: [{ type: 'text', text: '' }] }), null);
});
