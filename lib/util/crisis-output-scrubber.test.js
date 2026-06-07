// lib/util/crisis-output-scrubber.test.js
// Vivi 6/7 P0 safety scrubber — Defense 2 unit tests.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  scrubCrisisAssistantOutput,
  isInCrisisState,
} from './crisis-output-scrubber.js';

// ─── isInCrisisState gate ───────────────────────────────────────────

test('🛑 6/7 scrubber gate: crisis_in_progress=true → in-crisis', () => {
  assert.equal(isInCrisisState({ crisis_in_progress: true }), true);
});

test('🛑 6/7 scrubber gate: primary_mode=crisis → in-crisis', () => {
  assert.equal(isInCrisisState({ primary_mode: 'crisis' }), true);
});

test('🛑 6/7 scrubber gate: active_modes includes crisis → in-crisis', () => {
  assert.equal(isInCrisisState({ active_modes: ['elicitation', 'crisis'] }), true);
});

test('🛑 6/7 scrubber gate: sopState in-flight (no flags) → in-crisis (belt-and-suspenders)', () => {
  assert.equal(isInCrisisState({
    crisis_sop_state: { current_step: 4, awaiting: 'handoff_ack' },
  }), true);
});

test('🛑 6/7 scrubber gate: sopState complete → NOT in-crisis (closure released)', () => {
  assert.equal(isInCrisisState({
    crisis_sop_state: { current_step: 8 },
    crisis_sop_complete: true,
  }), false);
});

test('🛑 6/7 scrubber gate: normal state → NOT in-crisis', () => {
  assert.equal(isInCrisisState({ primary_mode: 'elicitation' }), false);
  assert.equal(isInCrisisState({}), false);
  assert.equal(isInCrisisState(null), false);
});

// ─── Pure no-op when not in crisis ──────────────────────────────────

test('🛑 6/7 scrubber: inCrisis=false → text untouched (even if contains 自殺)', () => {
  const text = '學員提到自殺話題的歷史討論。';   // unlikely outside crisis but defensive
  const r = scrubCrisisAssistantOutput(text, { inCrisis: false });
  assert.equal(r.cleaned, text);
  assert.equal(r.scrubbed, 0);
});

test('🛑 6/7 scrubber: inCrisis omitted → no-op', () => {
  const text = 'AI 提到自殺';
  const r = scrubCrisisAssistantOutput(text);
  assert.equal(r.cleaned, text);
  assert.equal(r.scrubbed, 0);
});

// ─── No-op when no 自殺 in text (zero-cost fast-path) ───────────────

test('🛑 6/7 scrubber: inCrisis=true + no 自殺 word → no-op, returns identical', () => {
  const text = '我聽到了。你現在最需要的,是一個真人在你旁邊。';
  const r = scrubCrisisAssistantOutput(text, { inCrisis: true });
  assert.equal(r.cleaned, text);
  assert.equal(r.scrubbed, 0);
});

// ─── Production-observed A016 case (THE BUG) ────────────────────────

test('🛑 6/7 A016 repro: 「你說『想自殺』」 → 「你說的這件事」 (Vivi exact example)', () => {
  // The actual improvised output from production smoke (Vivi 6/7).
  const text = '謝謝你告訴我你還在。你說『想自殺』—— 現在這個當下,你有在想傷害自己嗎?';
  const r = scrubCrisisAssistantOutput(text, { inCrisis: true });
  assert.ok(!r.cleaned.includes('自殺'),
    'A016 production output MUST have ZERO 「自殺」 occurrences after scrubbing');
  assert.match(r.cleaned, /你說的這件事/,
    'Vivi exact replacement: 你說『想自殺』 → 你說的這件事');
  assert.ok(r.scrubbed >= 1);
});

// ─── Replacement patterns (most-specific-first ordering) ────────────

test('🛑 6/7 scrubber: 「想自殺」 → 的這件事 (Chinese quotes form)', () => {
  const r = scrubCrisisAssistantOutput('你說了「想自殺」對嗎?', { inCrisis: true });
  assert.equal(r.cleaned, '你說了的這件事對嗎?');
  assert.equal(r.scrubbed, 1);
});

test('🛑 6/7 scrubber: 『自殺』 → 這件事 (alternate quote)', () => {
  const r = scrubCrisisAssistantOutput('關於『自殺』這件事', { inCrisis: true });
  assert.equal(r.cleaned, '關於這件事這件事');
  // Awkward but safe — Vivi 6/7 spec: 置換 over regen.
  assert.equal(r.scrubbed, 1);
});

test('🛑 6/7 scrubber: bare 想自殺 → 想做的這件事 (preserves verb structure)', () => {
  const r = scrubCrisisAssistantOutput('我聽到你想自殺。', { inCrisis: true });
  assert.equal(r.cleaned, '我聽到你想做的這件事。');
  assert.equal(r.scrubbed, 1);
});

test('🛑 6/7 scrubber: bare 自殺 → 這件事 (fallback)', () => {
  const r = scrubCrisisAssistantOutput('提到自殺。', { inCrisis: true });
  assert.equal(r.cleaned, '提到這件事。');
  assert.equal(r.scrubbed, 1);
});

test('🛑 6/7 scrubber: multiple occurrences in same text → all replaced', () => {
  const r = scrubCrisisAssistantOutput(
    '想自殺是嚴重的。「自殺」是禁忌。提到自殺。',
    { inCrisis: true },
  );
  assert.ok(!r.cleaned.includes('自殺'),
    'no 自殺 should remain anywhere after scrubbing');
  assert.equal(r.scrubbed, 3);
});

test('🛑 6/7 scrubber: 自殺 inside larger compound word still replaced', () => {
  // Defensive — "自殺防治專線" already removed from production by 3a727d5,
  // but if an LLM improv emits it, scrubber catches the bare 自殺 substring.
  const r = scrubCrisisAssistantOutput('打給自殺防治專線', { inCrisis: true });
  assert.equal(r.cleaned, '打給這件事防治專線');   // intentionally ugly — log will surface
  assert.equal(r.scrubbed, 1);
});

// ─── Defensive: non-string / null inputs ────────────────────────────

test('🛑 6/7 scrubber: non-string input → empty cleaned, no-op', () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    const r = scrubCrisisAssistantOutput(bad, { inCrisis: true });
    assert.equal(r.cleaned, '');
    assert.equal(r.scrubbed, 0);
  }
});

test('🛑 6/7 scrubber: empty string → empty cleaned, no-op', () => {
  const r = scrubCrisisAssistantOutput('', { inCrisis: true });
  assert.equal(r.cleaned, '');
  assert.equal(r.scrubbed, 0);
});

// ─── Boundary: scrubber NEVER touches student/system text ────────────

test('🛑 6/7 scrubber: contract — scrubber only changes its input string, never reads state', () => {
  // Caller is responsible for only invoking scrubber on assistant output.
  // This test documents the contract: the API doesn't look at session_state,
  // doesn't fetch student utterances, doesn't modify any global. It's pure
  // string-in / string-out.
  const r = scrubCrisisAssistantOutput('AI 即興: 「想自殺」', { inCrisis: true });
  assert.ok(!r.cleaned.includes('自殺'));
});

// ─── Pre-3a727d5-era canonical injects don't get touched ─────────────

test('🛑 6/7 scrubber: canonical 1925 phrasings (post-3a727d5) → no-op (no 自殺)', () => {
  // The canonical phrasings from _phrasings.js are scrubbed-safe by design.
  // Confirms scrubber doesn't false-positive on production-correct copy.
  const safeAiOutputs = [
    '我聽到了。你現在最需要的,是一個真人在你旁邊。',
    '在台灣,可以打 1925(安心專線、24 小時、免費)。',
    '如果你不在台灣,請搜尋你所在地的緊急專線。',
    '你不需要『真的打算做什麼』才能打。就算只是現在很難受、撐不下去,打過去都可以。',
    '我看到你回來了。Vivi 知道你的狀況、她會直接聯絡你。',
  ];
  for (const text of safeAiOutputs) {
    const r = scrubCrisisAssistantOutput(text, { inCrisis: true });
    assert.equal(r.cleaned, text);
    assert.equal(r.scrubbed, 0);
  }
});
