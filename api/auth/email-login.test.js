// api/auth/email-login.test.js — pure helpers (nextStudentId + normalizeEmail)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextStudentId, normalizeEmail, normalizePreferredName, normalizePace,
} from './email-login.js';

// ─── nextStudentId ───

test('nextStudentId: no existing → A001', () => {
  assert.equal(nextStudentId(null), 'A001');
  assert.equal(nextStudentId(undefined), 'A001');
  assert.equal(nextStudentId(''), 'A001');
});

test('nextStudentId: bumps with zero-padding', () => {
  assert.equal(nextStudentId('A001'), 'A002');
  assert.equal(nextStudentId('A009'), 'A010');
  assert.equal(nextStudentId('A099'), 'A100');
  assert.equal(nextStudentId('A999'), 'A1000');  // overflow but well-formed
});

test('nextStudentId: defensively rejects malformed last id (falls back to A001)', () => {
  assert.equal(nextStudentId('not-a-student'), 'A001');
  assert.equal(nextStudentId('A12'), 'A001');     // wrong digit count
  assert.equal(nextStudentId('B001'), 'A001');    // wrong prefix
  assert.equal(nextStudentId('a001'), 'A001');    // wrong case (we generate uppercase A)
});

// ─── normalizeEmail ───

test('normalizeEmail: trims + lowercases valid email', () => {
  assert.equal(normalizeEmail('  Vivi@Example.COM  '), 'vivi@example.com');
});

test('normalizeEmail: missing @ or . → null', () => {
  assert.equal(normalizeEmail('no-at-sign.com'), null);
  assert.equal(normalizeEmail('no-dot@local'), null);
  assert.equal(normalizeEmail(''), null);
  assert.equal(normalizeEmail('a'), null);
});

test('normalizeEmail: non-string → null', () => {
  assert.equal(normalizeEmail(null), null);
  assert.equal(normalizeEmail(undefined), null);
  assert.equal(normalizeEmail(42), null);
  assert.equal(normalizeEmail({}), null);
});

// ─── normalizePreferredName ─── (PR-4c-4e)

test('normalizePreferredName: trims + caps at 40 chars', () => {
  assert.equal(normalizePreferredName('  Vivi  '), 'Vivi');
  assert.equal(normalizePreferredName('A'.repeat(50)).length, 40);
});

test('normalizePreferredName: empty / whitespace-only / non-string → null', () => {
  assert.equal(normalizePreferredName(''), null);
  assert.equal(normalizePreferredName('   '), null);
  assert.equal(normalizePreferredName(null), null);
  assert.equal(normalizePreferredName(undefined), null);
  assert.equal(normalizePreferredName(42), null);
});

test('normalizePreferredName: passes valid CJK names through unchanged', () => {
  assert.equal(normalizePreferredName('小薇'), '小薇');
  assert.equal(normalizePreferredName('Patrick'), 'Patrick');
});

// ─── normalizePace ─── (PR-4c-4e)

test('🛑 normalizePace: only "self-paced" gets through; everything else → daily', () => {
  assert.equal(normalizePace('self-paced'), 'self-paced');
  assert.equal(normalizePace('daily'), 'daily');
  // defensive: defaults / typos / nullish all fall back to daily
  assert.equal(normalizePace(''), 'daily');
  assert.equal(normalizePace(null), 'daily');
  assert.equal(normalizePace(undefined), 'daily');
  assert.equal(normalizePace('Daily'), 'daily', 'case-sensitive — 「Daily」 is not the canonical value');
  assert.equal(normalizePace('selfpaced'), 'daily', 'hyphen-less typo falls back');
  assert.equal(normalizePace('weekly'), 'daily', 'unknown values fall back');
});
