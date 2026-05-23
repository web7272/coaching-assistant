// api/graduation.test.js — projectPoem21 pure helper

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectPoem21 } from './graduation.js';

test('projectPoem21: always returns length-21 array (per UI 21-cell rendering)', () => {
  assert.equal(projectPoem21([]).length, 21);
  assert.equal(projectPoem21([{ day: 1, term: 'x' }]).length, 21);
  assert.equal(projectPoem21(null).length, 21);
  assert.equal(projectPoem21(undefined).length, 21);
});

test('projectPoem21: sorted by day ASC, missing days as empty string', () => {
  const out = projectPoem21([
    { day: 3, term: '我不能停' },
    { day: 1, term: '可以決定' },
    { day: 21, term: '是我' },
  ]);
  assert.equal(out[0], '可以決定');   // day 1
  assert.equal(out[1], '');          // day 2 missing
  assert.equal(out[2], '我不能停');   // day 3
  assert.equal(out[20], '是我');     // day 21
});

test('projectPoem21: defensively skips malformed entries', () => {
  const out = projectPoem21([
    { day: 1, term: 'ok' },
    { day: '2', term: 'string day, dropped' },     // type mismatch
    { day: 3 },                                    // no term
    { term: 'no day' },                            // no day
    null, undefined, 'string',
  ]);
  assert.equal(out[0], 'ok');
  assert.equal(out[1], '');
  assert.equal(out[2], '');
});

test('projectPoem21: full 21-day rendering (Day 21 complete journey)', () => {
  const full = Array.from({ length: 21 }, (_, i) => ({ day: i + 1, term: `T${i + 1}` }));
  const out = projectPoem21(full);
  for (let i = 0; i < 21; i++) {
    assert.equal(out[i], `T${i + 1}`, `day ${i + 1}`);
  }
});
