// api/week-report.test.js — splitWeekSummary pure helper

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitWeekSummary } from './week-report.js';

test('splitWeekSummary: PR-4c-1 prompt output — first line title, body after blank', () => {
  const note = '從不能停，到可以決定\n\n【關鍵句】\n「我可以選」\n\n【SC 觀察】\n...';
  const { title, body } = splitWeekSummary(note);
  assert.equal(title, '從不能停，到可以決定');
  assert.match(body, /^【關鍵句】/);
  assert.match(body, /SC 觀察/);
});

test('splitWeekSummary: leading blank lines skipped to find title', () => {
  const note = '\n\n  從這裡開始  \n\n後面內容';
  const { title, body } = splitWeekSummary(note);
  assert.equal(title, '從這裡開始');
  assert.equal(body, '後面內容');
});

test('splitWeekSummary: empty / nullish → null title + empty body', () => {
  assert.deepEqual(splitWeekSummary(''),        { title: null, body: '' });
  assert.deepEqual(splitWeekSummary(null),      { title: null, body: '' });
  assert.deepEqual(splitWeekSummary(undefined), { title: null, body: '' });
});

test('splitWeekSummary: only a title (no body) → empty body', () => {
  assert.deepEqual(splitWeekSummary('就一行'), { title: '就一行', body: '' });
});

test('splitWeekSummary: defensively surfaces over-12-char title (frontend handles truncation)', () => {
  const long = '這個主題短句故意超過十二個字非常非常長';
  const { title, body } = splitWeekSummary(long + '\n\nbody');
  assert.equal(title, long, 'do not silently drop — let frontend truncate');
  assert.equal(body, 'body');
});
