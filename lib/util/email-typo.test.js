// lib/util/email-typo.test.js
// Patrick 5/28 — 鎖住 spec 列的 7 個 case + 防 over-aggressive matching.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  KNOWN_EMAIL_DOMAINS, levenshtein1, suggestEmailFix,
} from './email-typo.js';

// ─── suggestEmailFix — spec 列的 7 case ───────────────────────────

test('🛑 suggestEmailFix: a@gamil.com → a@gmail.com (A006 real-data case)', () => {
  assert.equal(suggestEmailFix('a@gamil.com'), 'a@gmail.com');
});

test('🛑 suggestEmailFix: a@gmial.com → a@gmail.com (i/a transposition typo)', () => {
  assert.equal(suggestEmailFix('a@gmial.com'), 'a@gmail.com');
});

test('🛑 suggestEmailFix: a@gmail.com → null (already correct, no nag)', () => {
  assert.equal(suggestEmailFix('a@gmail.com'), null);
});

test('🛑 suggestEmailFix: a@unknownisp.com.tw → null (no近似 known domain, do not invent)', () => {
  assert.equal(suggestEmailFix('a@unknownisp.com.tw'), null);
});

test('🛑 suggestEmailFix: noatsign → null (no @ at all)', () => {
  assert.equal(suggestEmailFix('noatsign'), null);
});

test('🛑 suggestEmailFix: @gmail.com → null (empty local)', () => {
  assert.equal(suggestEmailFix('@gmail.com'), null);
});

test('🛑 suggestEmailFix: a@hotnail.com → a@hotmail.com', () => {
  assert.equal(suggestEmailFix('a@hotnail.com'), 'a@hotmail.com');
});

// ─── extra defensive cases ───────────────────────────────────────

test('suggestEmailFix: non-string input → null', () => {
  assert.equal(suggestEmailFix(null), null);
  assert.equal(suggestEmailFix(undefined), null);
  assert.equal(suggestEmailFix(123), null);
  assert.equal(suggestEmailFix({}), null);
});

test('suggestEmailFix: empty string → null', () => {
  assert.equal(suggestEmailFix(''), null);
});

test('suggestEmailFix: domain is uppercase known → null (case-insensitive)', () => {
  assert.equal(suggestEmailFix('a@GMAIL.COM'), null);
});

test('suggestEmailFix: only @ no domain → null', () => {
  assert.equal(suggestEmailFix('a@'), null);
});

test('suggestEmailFix: a@yahooo.com → a@yahoo.com (extra o)', () => {
  assert.equal(suggestEmailFix('a@yahooo.com'), 'a@yahoo.com');
});

test('suggestEmailFix: a@iclud.com → a@icloud.com (missing letter)', () => {
  assert.equal(suggestEmailFix('a@iclud.com'), 'a@icloud.com');
});

// ─── levenshtein1 — primitive ────────────────────────────────────

test('levenshtein1: equal strings → false (not a typo)', () => {
  assert.equal(levenshtein1('abc', 'abc'), false);
  assert.equal(levenshtein1('', ''), false);
});

test('levenshtein1: single substitution → true', () => {
  assert.equal(levenshtein1('abc', 'abd'), true);
  assert.equal(levenshtein1('cat', 'bat'), true);
});

test('levenshtein1: single insertion → true', () => {
  assert.equal(levenshtein1('abc', 'abcd'), true);
  assert.equal(levenshtein1('abc', 'aabc'), true);
});

test('levenshtein1: single deletion → true', () => {
  assert.equal(levenshtein1('abcd', 'abc'), true);
  assert.equal(levenshtein1('aabc', 'abc'), true);
});

test('levenshtein1: 2-char diff → false', () => {
  assert.equal(levenshtein1('abc', 'xyz'), false);
  assert.equal(levenshtein1('abcd', 'abef'), false);
});

test('levenshtein1: length diff > 1 → false (early exit)', () => {
  assert.equal(levenshtein1('a', 'abc'), false);
  assert.equal(levenshtein1('abcde', 'a'), false);
});

// 🛑 Damerau extension — adjacent transposition counts as 1 edit.
//   A006 real-data root cause: gamil↔gmail / gmial↔gmail are adjacent
//   swaps. Pure Lev would score them 2 and miss the typo.
test('🛑 levenshtein1: adjacent transposition → true (Damerau, the A006 case)', () => {
  assert.equal(levenshtein1('gamil', 'gmail'), true);
  assert.equal(levenshtein1('gmial', 'gmail'), true);
  assert.equal(levenshtein1('hotnail', 'hotmial'), false,
    'two separate edits (subst + transpose far apart) must NOT collapse to true');
});

test('levenshtein1: non-adjacent swap → false (not 1 Damerau edit)', () => {
  // a-c swap in 'abc' → 'cba': positions 0 and 2 differ, not adjacent.
  assert.equal(levenshtein1('abc', 'cba'), false);
});

// ─── constants shape ─────────────────────────────────────────────

test('KNOWN_EMAIL_DOMAINS: frozen + non-empty + lowercase', () => {
  assert.ok(Object.isFrozen(KNOWN_EMAIL_DOMAINS));
  assert.ok(KNOWN_EMAIL_DOMAINS.length >= 8);
  for (const d of KNOWN_EMAIL_DOMAINS) {
    assert.equal(d, d.toLowerCase(), `${d} must be lowercase for case-insensitive match`);
  }
});
