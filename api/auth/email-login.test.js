// api/auth/email-login.test.js — pure helpers (nextStudentId + normalizeEmail)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextStudentId, normalizeEmail } from './email-login.js';

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
