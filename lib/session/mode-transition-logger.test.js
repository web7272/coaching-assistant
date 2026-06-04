// lib/session/mode-transition-logger.test.js
// Patrick 6/4 (v5.1 Step 4 PR-23s4a) — Lock transition log + cross-session aggregation.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TRIGGER_TYPES,
  TRIGGER_TYPE_LIST,
  buildTransitionEntry,
  appendTransitionPatch,
  aggregateForUserProfile,
} from './mode-transition-logger.js';

// ─── constants ───────────────────────────────────────────

test('🛑 TRIGGER_TYPES: frozen, exactly 6 values per spec', () => {
  assert.ok(Object.isFrozen(TRIGGER_TYPES));
  assert.deepEqual([...TRIGGER_TYPE_LIST].sort(), [
    'ai_initiated', 'learner_surfaced', 'mode_natural_progression',
    'natural_completion', 'session_natural_end', 'signal_cascade',
  ]);
});

// ─── buildTransitionEntry ────────────────────────────────

test('🛑 buildTransitionEntry: full shape with all fields', () => {
  const entry = buildTransitionEntry({
    from_active_modes: ['elicitation'],
    to_active_modes: ['elicitation', 'cascade'],
    from_primary: 'elicitation',
    to_primary: 'cascade',
    trigger_type: 'mode_natural_progression',
    trigger_detail: 'top1_confirmed_owned',
    turn_count: 12,
    timestamp: '2026-06-04T10:00:00Z',
  });
  assert.equal(entry.timestamp, '2026-06-04T10:00:00Z');
  assert.equal(entry.turn_count, 12);
  assert.deepEqual(entry.from_active_modes, ['elicitation']);
  assert.deepEqual(entry.to_active_modes, ['elicitation', 'cascade']);
  assert.equal(entry.from_primary, 'elicitation');
  assert.equal(entry.to_primary, 'cascade');
  assert.equal(entry.trigger_type, 'mode_natural_progression');
  assert.equal(entry.trigger_detail, 'top1_confirmed_owned');
});

test('buildTransitionEntry: arrays are copies (caller mutation safe)', () => {
  const from = ['elicitation'];
  const entry = buildTransitionEntry({
    from_active_modes: from, to_active_modes: ['cascade'],
    from_primary: 'elicitation', to_primary: 'cascade',
    trigger_type: 'ai_initiated',
  });
  from.push('mutated');
  assert.deepEqual(entry.from_active_modes, ['elicitation']);
});

test('buildTransitionEntry: timestamp defaults to ISO string now', () => {
  const entry = buildTransitionEntry({
    from_active_modes: [], to_active_modes: [],
    from_primary: 'elicitation', to_primary: 'elicitation',
    trigger_type: 'ai_initiated',
  });
  assert.match(entry.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
    'ISO timestamp shape');
});

test('🛑 buildTransitionEntry: rejects unknown trigger_type', () => {
  assert.throws(() => buildTransitionEntry({
    from_active_modes: [], to_active_modes: [],
    from_primary: 'elicitation', to_primary: 'cascade',
    trigger_type: 'bogus_trigger',
  }), /unknown trigger_type "bogus_trigger"/);
});

test('buildTransitionEntry: defensive defaults for missing fields', () => {
  const entry = buildTransitionEntry({
    trigger_type: 'session_natural_end',
  });
  assert.deepEqual(entry.from_active_modes, []);
  assert.deepEqual(entry.to_active_modes, []);
  assert.equal(entry.from_primary, null);
  assert.equal(entry.to_primary, null);
  assert.equal(entry.turn_count, 0);
  assert.equal(entry.trigger_detail, null);
});

test('buildTransitionEntry: non-finite turn_count → 0 (defensive)', () => {
  const entry = buildTransitionEntry({
    trigger_type: 'ai_initiated', turn_count: NaN,
  });
  assert.equal(entry.turn_count, 0);
});

// ─── appendTransitionPatch ───────────────────────────────

test('🛑 appendTransitionPatch: append to empty log', () => {
  const entry = buildTransitionEntry({
    trigger_type: 'ai_initiated',
    from_primary: 'elicitation', to_primary: 'cascade',
  });
  const patch = appendTransitionPatch({}, entry);
  assert.deepEqual(patch, { mode_transition_log: [entry] });
});

test('🛑 appendTransitionPatch: append to existing log (preserves order)', () => {
  const existing = [{ trigger_type: 'ai_initiated', turn_count: 1 }];
  const newEntry = buildTransitionEntry({
    trigger_type: 'signal_cascade',
    from_primary: 'elicitation', to_primary: 'crisis',
    turn_count: 2,
  });
  const patch = appendTransitionPatch(
    { mode_transition_log: existing },
    newEntry,
  );
  assert.equal(patch.mode_transition_log.length, 2);
  assert.equal(patch.mode_transition_log[0].turn_count, 1);
  assert.equal(patch.mode_transition_log[1].turn_count, 2);
});

test('appendTransitionPatch: null sessionState → still appends', () => {
  const entry = buildTransitionEntry({ trigger_type: 'ai_initiated' });
  const patch = appendTransitionPatch(null, entry);
  assert.deepEqual(patch.mode_transition_log, [entry]);
});

test('appendTransitionPatch: non-array log field → treats as empty', () => {
  const entry = buildTransitionEntry({ trigger_type: 'ai_initiated' });
  const patch = appendTransitionPatch({ mode_transition_log: 'garbage' }, entry);
  assert.deepEqual(patch.mode_transition_log, [entry]);
});

test('appendTransitionPatch: rejects non-object entry', () => {
  assert.throws(() => appendTransitionPatch({}, null), TypeError);
  assert.throws(() => appendTransitionPatch({}, 'string'), TypeError);
});

// ─── aggregateForUserProfile ─────────────────────────────

test('🛑 aggregateForUserProfile: empty transitions → empty distribution', () => {
  const out = aggregateForUserProfile({
    sessionId: 42, transitions: [], finalTurnCount: 10,
    initialPrimary: 'elicitation',
  });
  // With no transitions, the whole session held in initialPrimary.
  assert.deepEqual(out.primary_mode_distribution, { elicitation: 10 });
  assert.equal(out.transitions_in_session, 0);
  assert.equal(out.crisis_triggered, false);
  assert.equal(out.session_id, 42);
});

test('🛑 aggregateForUserProfile: turn distribution across mode transitions', () => {
  // Session timeline:
  //   turn 0-4:   elicitation
  //   turn 5-9:   identity_anchoring  (transition at turn 5)
  //   turn 10-14: cascade              (transition at turn 10)
  //   end at turn 15
  const transitions = [
    buildTransitionEntry({
      from_active_modes: ['elicitation'], to_active_modes: ['elicitation', 'identity_anchoring'],
      from_primary: 'elicitation', to_primary: 'identity_anchoring',
      trigger_type: 'ai_initiated', turn_count: 5,
    }),
    buildTransitionEntry({
      from_active_modes: ['elicitation', 'identity_anchoring'],
      to_active_modes: ['elicitation', 'identity_anchoring', 'cascade'],
      from_primary: 'identity_anchoring', to_primary: 'cascade',
      trigger_type: 'mode_natural_progression', turn_count: 10,
    }),
  ];
  const out = aggregateForUserProfile({
    sessionId: 7,
    transitions,
    initialPrimary: 'elicitation',
    finalTurnCount: 15,
  });
  assert.deepEqual(out.primary_mode_distribution, {
    elicitation: 5,           // 0 → 5
    identity_anchoring: 5,    // 5 → 10
    cascade: 5,               // 10 → 15
  });
  assert.equal(out.transitions_in_session, 2);
});

test('🛑 aggregateForUserProfile: crisis triggered passes through', () => {
  const out = aggregateForUserProfile({
    sessionId: 1, transitions: [], finalTurnCount: 0,
    crisisTriggered: true,
  });
  assert.equal(out.crisis_triggered, true);
});

test('aggregateForUserProfile: initialPrimary defaults from first transition', () => {
  const transitions = [
    buildTransitionEntry({
      from_primary: 'elicitation', to_primary: 'cascade',
      trigger_type: 'ai_initiated', turn_count: 3,
    }),
  ];
  const out = aggregateForUserProfile({
    transitions, finalTurnCount: 8,
    // initialPrimary omitted → infer from transitions[0].from_primary
  });
  assert.deepEqual(out.primary_mode_distribution, {
    elicitation: 3,    // 0 → 3
    cascade: 5,        // 3 → 8
  });
});

test('aggregateForUserProfile: skips bogus transitions', () => {
  const out = aggregateForUserProfile({
    transitions: [null, 'bogus', { trigger_type: 'ai_initiated', turn_count: 5, to_primary: 'cascade' }],
    initialPrimary: 'elicitation',
    finalTurnCount: 10,
  });
  // 1 valid transition
  assert.equal(out.transitions_in_session, 3, 'count reflects array length, not validity');
  assert.deepEqual(out.primary_mode_distribution, {
    elicitation: 5,
    cascade: 5,
  });
});

test('aggregateForUserProfile: defensive against non-array transitions', () => {
  const out = aggregateForUserProfile({
    transitions: null, initialPrimary: 'elicitation', finalTurnCount: 10,
  });
  assert.equal(out.transitions_in_session, 0);
  assert.deepEqual(out.primary_mode_distribution, { elicitation: 10 });
});

test('aggregateForUserProfile: turn_count not monotonic (defensive)', () => {
  // Out-of-order turn counts shouldn't produce negative durations.
  const transitions = [
    buildTransitionEntry({
      from_primary: 'elicitation', to_primary: 'cascade',
      trigger_type: 'ai_initiated', turn_count: 5,
    }),
    buildTransitionEntry({
      from_primary: 'cascade', to_primary: 'integration',
      trigger_type: 'ai_initiated', turn_count: 3,   // weird: earlier than previous
    }),
  ];
  const out = aggregateForUserProfile({
    transitions, initialPrimary: 'elicitation', finalTurnCount: 10,
  });
  // Negative duration clamped to non-negative; cursor stays at 5 not 3.
  assert.ok(Object.values(out.primary_mode_distribution).every(v => v >= 0));
});

test('aggregateForUserProfile: no finalTurnCount → no tail segment added', () => {
  const transitions = [
    buildTransitionEntry({
      from_primary: 'elicitation', to_primary: 'cascade',
      trigger_type: 'ai_initiated', turn_count: 5,
    }),
  ];
  const out = aggregateForUserProfile({
    transitions, initialPrimary: 'elicitation', finalTurnCount: 0,
  });
  // Only the first segment (0→5 elicitation) counts; tail is 5→5=0.
  assert.deepEqual(out.primary_mode_distribution, { elicitation: 5 });
});
