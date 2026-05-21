// lib/haiku-judge/_json.test.js

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { extractJSON, assertShape } from './_json.js';

// ─────────────────────────────────────────────────────────
// extractJSON
// ─────────────────────────────────────────────────────────

test('extractJSON: clean JSON object', () => {
  assert.deepEqual(extractJSON('{"a":1,"b":"x"}'), { a: 1, b: 'x' });
});

test('extractJSON: leading/trailing whitespace', () => {
  assert.deepEqual(extractJSON('  \n  {"a":1}  \n'), { a: 1 });
});

test('extractJSON: strips ```json fence', () => {
  const raw = '```json\n{"a":1}\n```';
  assert.deepEqual(extractJSON(raw), { a: 1 });
});

test('extractJSON: strips bare ``` fence', () => {
  const raw = '```\n{"a":1}\n```';
  assert.deepEqual(extractJSON(raw), { a: 1 });
});

test('extractJSON: explanation text before JSON', () => {
  const raw = 'Here is my analysis:\n{"score":3}';
  assert.deepEqual(extractJSON(raw), { score: 3 });
});

test('extractJSON: explanation text after JSON', () => {
  const raw = '{"score":3}\nThat is my conclusion.';
  assert.deepEqual(extractJSON(raw), { score: 3 });
});

test('extractJSON: nested object', () => {
  const raw = '{"outer":{"inner":{"deep":true}},"count":2}';
  assert.deepEqual(extractJSON(raw), { outer: { inner: { deep: true } }, count: 2 });
});

test('extractJSON: braces inside strings are ignored', () => {
  const raw = '{"text":"hello } world {","ok":true}';
  assert.deepEqual(extractJSON(raw), { text: 'hello } world {', ok: true });
});

test('extractJSON: escaped quotes inside strings', () => {
  const raw = '{"text":"she said \\"hi\\"","ok":true}';
  assert.deepEqual(extractJSON(raw), { text: 'she said "hi"', ok: true });
});

test('extractJSON: throws when no JSON found', () => {
  assert.throws(() => extractJSON('just text, no braces'), /no JSON object found/);
});

test('extractJSON: throws on unterminated object', () => {
  assert.throws(() => extractJSON('{"a":1,'), /unterminated/);
});

test('extractJSON: throws on malformed JSON', () => {
  assert.throws(() => extractJSON('{"a":1,,"b":2}'), /JSON\.parse failed/);
});

test('extractJSON: rejects non-string input', () => {
  assert.throws(() => extractJSON(null), /must be string/);
  assert.throws(() => extractJSON(123), /must be string/);
  assert.throws(() => extractJSON({ a: 1 }), /must be string/);
});

// ─────────────────────────────────────────────────────────
// assertShape
// ─────────────────────────────────────────────────────────

test('assertShape: happy path with all types', () => {
  const obj = { name: 'a', count: 3, ok: true, mode: 'self' };
  assert.doesNotThrow(() => assertShape(obj, [
    ['name', 'string'],
    ['count', 'integer'],
    ['ok', 'boolean'],
    ['mode', ['self', 'others']],
  ]));
});

test('assertShape: throws on missing key', () => {
  assert.throws(() => assertShape({ a: 1 }, [['b', 'integer']]), /missing key "b"/);
});

test('assertShape: throws on wrong primitive type', () => {
  assert.throws(() => assertShape({ a: 'oops' }, [['a', 'integer']]), /must be integer/);
  assert.throws(() => assertShape({ a: 3.14 }, [['a', 'integer']]), /must be integer/);
  assert.throws(() => assertShape({ a: 1 }, [['a', 'string']]), /must be string/);
  assert.throws(() => assertShape({ a: 'x' }, [['a', 'boolean']]), /must be boolean/);
});

test('assertShape: throws on enum mismatch', () => {
  assert.throws(
    () => assertShape({ mode: 'banana' }, [['mode', ['self', 'others']]]),
    /must be one of/,
  );
});

test('assertShape: rejects non-object input', () => {
  assert.throws(() => assertShape(null, []), /expected object/);
  assert.throws(() => assertShape([1, 2], []), /expected object/);
  assert.throws(() => assertShape('x', []), /expected object/);
});

test('assertShape: integer accepts 0', () => {
  assert.doesNotThrow(() => assertShape({ n: 0 }, [['n', 'integer']]));
});

test('assertShape: integer rejects NaN', () => {
  assert.throws(() => assertShape({ n: NaN }, [['n', 'integer']]), /must be integer/);
});
