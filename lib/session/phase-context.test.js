// lib/session/phase-context.test.js
// {{current_phase_context}} dynamic text — pure module.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { PHASE_CONTEXTS, contextFor, hasContext } from './phase-context.js';
import { CURRENT_PHASES } from './phase-machine.js';

// ─────────────────────────────────────────────────────────
// completeness — every current_phase has a context
// ─────────────────────────────────────────────────────────

test('PHASE_CONTEXTS: covers all 8 current_phase enum values', () => {
  for (const phase of Object.values(CURRENT_PHASES)) {
    assert.ok(phase in PHASE_CONTEXTS, `${phase} missing from PHASE_CONTEXTS`);
  }
  assert.equal(Object.keys(PHASE_CONTEXTS).length, 8);
});

test('PHASE_CONTEXTS is frozen', () => {
  assert.ok(Object.isFrozen(PHASE_CONTEXTS));
});

test('every phase context is a non-empty string', () => {
  for (const [phase, text] of Object.entries(PHASE_CONTEXTS)) {
    assert.equal(typeof text, 'string', `${phase} context must be string`);
    assert.ok(text.length > 0, `${phase} context must be non-empty`);
  }
});

// ─────────────────────────────────────────────────────────
// contextFor
// ─────────────────────────────────────────────────────────

test('contextFor: returns the phase text for a known phase', () => {
  assert.equal(contextFor('phase_1'), PHASE_CONTEXTS.phase_1);
  assert.match(contextFor('phase_1'), /Values Elicitation/);
  assert.match(contextFor('phase_3b'), /Self-Concept/);
});

test('contextFor: fail-soft — unknown phase → empty string', () => {
  assert.equal(contextFor('phase_99'), '');
  assert.equal(contextFor(null), '');
  assert.equal(contextFor(undefined), '');
});

test('contextFor: phase_3a mentions Scope Overlap default (errata 5/21)', () => {
  assert.match(contextFor('phase_3a'), /Scope Overlap/);
});

test('contextFor: integration_retention mentions reinforce-not-explore', () => {
  assert.match(contextFor('integration_retention'), /reinforce/i);
});

// ─────────────────────────────────────────────────────────
// hasContext
// ─────────────────────────────────────────────────────────

test('hasContext: true for known phases, false otherwise', () => {
  assert.equal(hasContext('phase_1'), true);
  assert.equal(hasContext('program_completed'), true);
  assert.equal(hasContext('phase_99'), false);
  assert.equal(hasContext(null), false);
});
