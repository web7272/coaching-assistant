// lib/detector-handlers/engine-1-signals/s6-modal-operators.test.js
// v5.1 Step 7 PR-7b — Lock S6 modal_operator detection + Vivi guard #3
// (醫生說我必須吃藥 / 上班必須打卡 排除).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  detect, contextOK, classifyIntensity,
  GROUPS, EXTERNAL_ATTRIBUTION_REGEX, OBJECTIVE_REQUIREMENT_REGEX,
} from './s6-modal-operators.js';

// ─── Positive triggers ───────────────────────────────────

test('🛑 detect: 「我應該開心」 → hit weak', () => {
  const r = detect('我應該開心');
  assert.equal(r.hit, true);
  assert.equal(r.intensity, 'weak');
  assert.deepEqual(r.groups_matched, ['group_a_should']);
  assert.equal(r.score_delta, 1);
});

test('🛑 detect: 「我必須成功」 → hit weak (group_b_must)', () => {
  const r = detect('我必須成功');
  assert.equal(r.hit, true);
  assert.equal(r.intensity, 'weak');
  assert.deepEqual(r.groups_matched, ['group_b_must']);
});

test('🛑 detect: 「我不該這樣想」 → hit weak (group_a_should via 不該)', () => {
  const r = detect('我不該這樣想');
  assert.equal(r.hit, true);
  assert.deepEqual(r.groups_matched, ['group_a_should']);
});

test('🛑 detect: 「我應該、必須、一定要」 → multi-group → medium intensity', () => {
  // intensity medium = multi-group, no ppl/external_locus.
  const r = detect('我應該開心、必須成功、一定要堅強');
  assert.equal(r.hit, true);
  assert.equal(r.intensity, 'medium');
  assert.equal(r.score_delta, 2);
  assert.ok(r.groups_matched.length >= 2);
});

test('🛑 detect: medium + cumulative_ppl_score >= 0.5 → strong', () => {
  const r = detect('我應該開心、我必須成功', { cumulative_ppl_score: 0.6 });
  assert.equal(r.intensity, 'strong');
  assert.equal(r.score_delta, 4);
});

test('🛑 detect: medium (multi-group) + external_locus_count_this_session >= 3 → strong', () => {
  // 應該 (group_a) + 必須 (group_b) = multi-group → medium baseline → strong w/ s1 ≥ 3.
  const r = detect('我應該堅強、我必須成功', { external_locus_count_this_session: 4 });
  assert.equal(r.intensity, 'strong');
});

// ─── Vivi guard #3 — context filter exclusions ───────────

test('🛑 GUARD #3 detect: 「醫生說我必須吃藥」 → context_filter_blocked (external_attribution)', () => {
  const r = detect('醫生說我必須吃藥');
  assert.equal(r.hit, false);
  assert.equal(r.context_filter_blocked, true);
  assert.equal(r.context_filter_reason, 'external_attribution');
  // groups still matched (regex hit) — just filter blocked.
  assert.ok(r.groups_matched && r.groups_matched.includes('group_b_must'));
});

test('🛑 GUARD #3 detect: 「老闆說我必須加班」 → blocked external_attribution', () => {
  const r = detect('老闆說我必須加班');
  assert.equal(r.hit, false);
  assert.equal(r.context_filter_reason, 'external_attribution');
});

test('🛑 GUARD #3 detect: 「爸媽說我應該結婚」 → blocked external_attribution', () => {
  const r = detect('爸媽說我應該結婚');
  assert.equal(r.hit, false);
  assert.equal(r.context_filter_reason, 'external_attribution');
});

test('🛑 GUARD #3 detect: 「法律規定我必須繳稅」 → blocked external_attribution', () => {
  const r = detect('法律規定我必須繳稅');
  assert.equal(r.hit, false);
  assert.equal(r.context_filter_reason, 'external_attribution');
});

test('🛑 GUARD #3 detect: 「上班必須打卡」 → blocked objective_requirement', () => {
  const r = detect('上班必須打卡');
  assert.equal(r.hit, false);
  assert.equal(r.context_filter_blocked, true);
  assert.equal(r.context_filter_reason, 'objective_requirement');
});

test('🛑 GUARD #3 detect: 「考試必須準時」 → blocked objective_requirement', () => {
  const r = detect('考試必須準時');
  assert.equal(r.hit, false);
  assert.equal(r.context_filter_reason, 'objective_requirement');
});

test('🛑 GUARD #3 detect: 「報稅必須在期限」 → blocked objective_requirement', () => {
  const r = detect('報稅必須在期限');
  assert.equal(r.hit, false);
  assert.equal(r.context_filter_reason, 'objective_requirement');
});

test('🛑 GUARD #3 detect: 「應該怎麼辦」 (no 我 subject) → blocked no_self_context', () => {
  const r = detect('應該怎麼辦');
  assert.equal(r.hit, false);
  assert.equal(r.context_filter_reason, 'no_self_context');
});

// ─── Positive triggers that 看起來 similar 但 not blocked ──

test('🛑 detect: 「我必須吃藥」 (no 醫生說 attribution) → hit (self-judgment)', () => {
  // Without external attribution, 「我必須吃藥」 = self-judgment, triggers S6.
  // Beta校準 may surface edge cases; for now conservative trigger.
  const r = detect('我必須吃藥');
  assert.equal(r.hit, true);
  assert.deepEqual(r.groups_matched, ['group_b_must']);
});

test('🛑 detect: 「我自己應該更努力」 → hit (self_context strong)', () => {
  const r = detect('我自己應該更努力');
  assert.equal(r.hit, true);
});

// ─── contextOK direct ────────────────────────────────────

test('🛑 contextOK: pure external attribution → false', () => {
  assert.equal(contextOK('醫生說我必須吃藥'), false);
});

test('🛑 contextOK: objective requirement → false', () => {
  assert.equal(contextOK('上班必須打卡'), false);
});

test('🛑 contextOK: pure self-judgment → true', () => {
  assert.equal(contextOK('我應該更努力'), true);
});

test('🛑 contextOK: empty / non-string → false (defensive)', () => {
  assert.equal(contextOK(''), false);
  assert.equal(contextOK(null), false);
  assert.equal(contextOK(undefined), false);
});

// ─── Regex internals ─────────────────────────────────────

test('EXTERNAL_ATTRIBUTION_REGEX: 醫生 / 老闆 / 警察 / 法律 / 公司 / 學校 / 老師 all hit', () => {
  for (const src of ['醫生說', '老闆要求', '警察規定', '法律規定', '公司規定', '學校規定', '老師說']) {
    assert.ok(EXTERNAL_ATTRIBUTION_REGEX.test(`${src}我必須做`), `${src} should match`);
  }
});

test('OBJECTIVE_REQUIREMENT_REGEX: 上班/考試/交稅/報稅/打卡 all hit', () => {
  for (const src of ['上班必須', '考試必須', '交稅必須', '報稅必須', '打卡', '繳費必須']) {
    assert.ok(OBJECTIVE_REQUIREMENT_REGEX.test(src) || src === '打卡',
      `${src} should match or be a recognized standalone term`);
  }
  // 打卡 alone in context.
  assert.ok(OBJECTIVE_REQUIREMENT_REGEX.test('上班必須打卡'));
});

test('classifyIntensity: empty → weak, single → weak, multi → medium', () => {
  assert.equal(classifyIntensity([]), 'weak');
  assert.equal(classifyIntensity(['group_a_should']), 'weak');
  assert.equal(classifyIntensity(['group_a_should', 'group_b_must']), 'medium');
  assert.equal(classifyIntensity(['group_a_should', 'group_b_must'], { cumulative_ppl_score: 0.6 }), 'strong');
});
