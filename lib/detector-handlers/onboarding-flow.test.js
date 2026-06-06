// lib/detector-handlers/onboarding-flow.test.js
// v5.2 第四塊 PR-a — Lock onboarding state machine + parsers + crisis override.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onboardingFlowHandler } from './onboarding-flow.js';
import {
  ONBOARDING_STEPS, ONBOARDING_AWAITING,
  buildInitialOnboardingState,
  STEP_1_PHRASING_VERBATIM, STEP_2_PHRASING_VERBATIM,
  buildStep2Inject, buildStep3Phrasing, buildStep3Inject,
  parseCategoryPick, parseArticulate, parseConfirm,
  sanitizeName, sanitizeDefinition,
} from '../sub-prompts/onboarding/index.js';

// ─── Verbatim phrasing locks (spec §1.2 終審 + Vivi 6/6) ──

test('🛑 v5.2 STEP_1_PHRASING_VERBATIM: spec §1.2 + Vivi 6/6 phrasing 處理→探索', () => {
  assert.equal(STEP_1_PHRASING_VERBATIM, `從你最在意的地方開始、擴大你的地圖。

你今天最想探索的、比較接近下面哪一個?

1. 事業 / 工作 / 金錢
2. 親密關係(伴侶 / 戀愛)
3. 家庭(原生家庭 / 子女)
4. 健康 / 身體
5. 自我 / 內在狀態 / 心理`);
  // 6/6 hotfix assertion: 處理 fully replaced by 探索 in student-facing phrasing.
  assert.doesNotMatch(STEP_1_PHRASING_VERBATIM, /處理/,
    'Vivi 6/6: 處理 → 探索 sweep (student-facing phrasing only)');
  assert.match(STEP_1_PHRASING_VERBATIM, /探索/);
});

test('🛑 v5.2 STEP_2_PHRASING_VERBATIM: spec §1.2 終審 (Vivi 6/5)', () => {
  assert.equal(STEP_2_PHRASING_VERBATIM, '你想聚焦的是哪塊');
});

test('🛑 v5.2 buildStep3Phrasing: spec §1.2 終審 verbatim with {articulate} fill', () => {
  const p = buildStep3Phrasing('我跟先生的溝通');
  assert.equal(p, `好。
這 21 天、我們聚焦在『我跟先生的溝通』。

這樣對嗎?`);
});

// ─── 6/6 hotfix: buildStep2Inject + buildStep3Inject category anchor ─────

test('🛑 6/6 hotfix: buildStep2Inject(1) → 事業 / 工作 / 金錢 anchor (no stale studentRow)', () => {
  const inj = buildStep2Inject(1);
  assert.match(inj, /category 1 \(事業 \/ 工作 \/ 金錢\)/);
  assert.match(inj, /本 turn anchor: 「事業 \/ 工作 \/ 金錢」/);
});

test('🛑 6/6 hotfix: buildStep2Inject(2) → 親密關係 anchor', () => {
  const inj = buildStep2Inject(2);
  assert.match(inj, /category 2 \(親密關係\(伴侶 \/ 戀愛\)\)/);
  assert.match(inj, /本 turn anchor: 「親密關係\(伴侶 \/ 戀愛\)」/);
});

test('🛑 6/6 hotfix: buildStep2Inject(3) → 家庭 anchor', () => {
  const inj = buildStep2Inject(3);
  assert.match(inj, /category 3 \(家庭\(原生家庭 \/ 子女\)\)/);
});

test('🛑 6/6 hotfix: buildStep2Inject(4) → 健康 / 身體 anchor (Vivi 沙盒 repro)', () => {
  const inj = buildStep2Inject(4);
  assert.match(inj, /category 4 \(健康 \/ 身體\)/);
  assert.match(inj, /本 turn anchor: 「健康 \/ 身體」/);
  // Repro of the sandbox bug: must NOT default to 事業.
  assert.doesNotMatch(inj, /本 turn anchor: 「事業/);
});

test('🛑 6/6 hotfix: buildStep2Inject(5) → 自我 / 內在狀態 / 心理 anchor', () => {
  const inj = buildStep2Inject(5);
  assert.match(inj, /category 5 \(自我 \/ 內在狀態 \/ 心理\)/);
});

test('🛑 6/6 hotfix: buildStep2Inject(invalid/null) → defensive placeholder fallback', () => {
  for (const bad of [null, undefined, 0, 6, 'foo', NaN]) {
    const inj = buildStep2Inject(bad);
    assert.match(inj, /\[step 1 學員所選 category\]/, `${bad} should fall back`);
  }
});

test('🛑 6/6 hotfix: buildStep2Inject — 探索 sweep (no 處理 in student-facing fragments)', () => {
  const inj = buildStep2Inject(2);
  // Vivi 6/6: re-prompt and 加多個 phrasings must say 探索.
  assert.match(inj, /輕引「就你今天最想探索的那塊」/);
  assert.match(inj, /邀請聚焦在「最想探索的那一塊」/);
  // System-side "處理規則" heading stays (internal language, not student-facing).
  assert.match(inj, /⚠️ 處理規則:/);
});

test('🛑 6/6 hotfix: buildStep3Inject(articulate, pickedCategory=4) → 健康 anchor in inject', () => {
  const inj = buildStep3Inject('我的焦慮影響我的睡眠', 4);
  assert.match(inj, /category 4 \(健康 \/ 身體\)/);
  assert.match(inj, /本 turn anchor: 「健康 \/ 身體」/);
  // Verbatim phrasing (uses articulate, not category label).
  assert.match(inj, /這 21 天、我們聚焦在『我的焦慮影響我的睡眠』/);
});

test('🛑 6/6 hotfix: buildStep3Inject(articulate, null) → defensive placeholder', () => {
  const inj = buildStep3Inject('我跟錢的關係', null);
  assert.match(inj, /\[step 1 學員所選 category\]/);
});

// ─── parseCategoryPick ────────────────────────────────────

test('🛑 parseCategoryPick: 數字 1-5 → category', () => {
  assert.equal(parseCategoryPick('1'), 1);
  assert.equal(parseCategoryPick('2'), 2);
  assert.equal(parseCategoryPick('3'), 3);
  assert.equal(parseCategoryPick('4'), 4);
  assert.equal(parseCategoryPick('5'), 5);
  // Formatted variants.
  assert.equal(parseCategoryPick('(1)'), 1);
  assert.equal(parseCategoryPick('1.'), 1);
  assert.equal(parseCategoryPick('我選 3'), 3);
});

test('🛑 parseCategoryPick: 文字 keyword → correct category', () => {
  assert.equal(parseCategoryPick('事業'), 1);
  assert.equal(parseCategoryPick('工作'), 1);
  assert.equal(parseCategoryPick('我想聊升職'), 1);
  assert.equal(parseCategoryPick('startup 想升職'), 1);
  assert.equal(parseCategoryPick('感情'), 2);
  assert.equal(parseCategoryPick('我跟男友'), 2);
  assert.equal(parseCategoryPick('老公'), 2);
  assert.equal(parseCategoryPick('原生家庭'), 3);
  assert.equal(parseCategoryPick('我跟爸媽'), 3);
  assert.equal(parseCategoryPick('小孩'), 3);
  assert.equal(parseCategoryPick('健康'), 4);
  assert.equal(parseCategoryPick('運動'), 4);
  assert.equal(parseCategoryPick('焦慮'), 5);
  assert.equal(parseCategoryPick('自我'), 5);
});

test('🛑 parseCategoryPick: unique frame「我跟錢的關係」→ category 1 (歸入事業/金錢)', () => {
  assert.equal(parseCategoryPick('我跟錢的關係'), 1);
});

test('🛑 parseCategoryPick: escape hatch → null (caller re-prompts)', () => {
  for (const escape of ['都不想', '都不是', '都可以', '都行', '隨便', '不知道', '沒差', '沒意見']) {
    assert.equal(parseCategoryPick(escape), null, `${escape} should be rejected`);
  }
});

test('🛑 parseCategoryPick: empty / non-string → null', () => {
  assert.equal(parseCategoryPick(''), null);
  assert.equal(parseCategoryPick(null), null);
  assert.equal(parseCategoryPick(undefined), null);
});

// ─── parseArticulate ──────────────────────────────────────

test('🛑 parseArticulate: 學員 articulate → trim + return', () => {
  assert.equal(parseArticulate('  我跟先生的溝通  '), '我跟先生的溝通');
  assert.equal(parseArticulate('我的焦慮'), '我的焦慮');
});

test('🛑 parseArticulate: vague → null (caller re-prompts)', () => {
  for (const vague of ['不知道', '沒差', '都可以', '隨便', '都行', '沒意見']) {
    assert.equal(parseArticulate(vague), null, `${vague} should be vague`);
  }
});

test('🛑 parseArticulate: empty → null', () => {
  assert.equal(parseArticulate(''), null);
  assert.equal(parseArticulate('   '), null);
});

// ─── parseConfirm ─────────────────────────────────────────

test('🛑 parseConfirm: 確認詞 → confirm', () => {
  for (const ok of ['對', '是', '嗯', '沒錯', '對的', '是的', 'yes', 'OK', '好的', '可以']) {
    assert.equal(parseConfirm(ok), 'confirm', `${ok} should be confirm`);
  }
});

test('🛑 parseConfirm: 修正詞 → reject', () => {
  for (const rej of ['不對', '不是', '不', '錯了', '想改', '還要加', '不太對', '要改']) {
    assert.equal(parseConfirm(rej), 'reject', `${rej} should be reject`);
  }
});

test('🛑 parseConfirm: vague → null (caller re-prompts)', () => {
  assert.equal(parseConfirm('嗯…'), null);
  assert.equal(parseConfirm(''), null);
});

// ─── sanitizeName / sanitizeDefinition ──────────────────

test('🛑 sanitizeName: ≤ 30 chars passthrough', () => {
  const r = sanitizeName('我跟先生的溝通');
  assert.equal(r.name, '我跟先生的溝通');
  assert.equal(r.truncated, false);
});

test('🛑 sanitizeName: > 30 chars → truncate + flag', () => {
  const r = sanitizeName('x'.repeat(50));
  assert.equal(r.name.length, 30);
  assert.equal(r.truncated, true);
});

test('🛑 sanitizeName: empty → null', () => {
  assert.deepEqual(sanitizeName(''), { name: null, truncated: false });
  assert.deepEqual(sanitizeName('   '), { name: null, truncated: false });
});

test('🛑 sanitizeDefinition: ≤ 200 chars passthrough', () => {
  const r = sanitizeDefinition('主要是日常溝通、不含原生家庭');
  assert.equal(r.definition, '主要是日常溝通、不含原生家庭');
  assert.equal(r.truncated, false);
});

test('🛑 sanitizeDefinition: > 200 chars → truncate + flag', () => {
  const r = sanitizeDefinition('x'.repeat(300));
  assert.equal(r.definition.length, 200);
  assert.equal(r.truncated, true);
});

// ─── Handler: gate semantics ─────────────────────────────

test('🛑 onboardingFlowHandler: !onboarded + no state → init + inject step 1', async () => {
  const r = await onboardingFlowHandler({
    session_state: {},
    user_response: '',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, true);
  assert.match(r.inject, /Onboarding Step 1 · Category Pick/);
  assert.match(r.inject, /從你最在意的地方開始/);
  assert.equal(r.patch.onboarding_step.current_step, ONBOARDING_STEPS.STEP_1_CATEGORY_PICK);
  assert.equal(r.patch.onboarding_step.awaiting, ONBOARDING_AWAITING.CATEGORY_PICK);
});

test('🛑 onboardingFlowHandler: onboarded=TRUE + no state → defer (normal flow)', async () => {
  const r = await onboardingFlowHandler({
    session_state: {},
    user_response: '',
    student_context_onboarded: true,
  });
  assert.equal(r.handled, false);
});

test('🛑 onboardingFlowHandler: crisis active → defer (safety override)', async () => {
  // Even with onboarding_step set, crisis takes precedence.
  const r = await onboardingFlowHandler({
    session_state: {
      crisis_in_progress: true,
      onboarding_step: buildInitialOnboardingState(),
    },
    user_response: '1',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, false,
    'crisis_in_progress must defer to crisis SOP regardless of onboarding state');
});

test('🛑 onboardingFlowHandler: primary_mode=crisis → defer', async () => {
  const r = await onboardingFlowHandler({
    session_state: { primary_mode: 'crisis', onboarding_step: buildInitialOnboardingState() },
    user_response: '1',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, false);
});

// ─── Step 1 dispatch ─────────────────────────────────────

test('🛑 onboarding step 1 → 學員 "事業" → advances to step 2 articulate', async () => {
  const state = { onboarding_step: buildInitialOnboardingState() };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '事業',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, true);
  assert.match(r.inject, /Step 2 · Articulate/);
  assert.equal(r.patch.onboarding_step.current_step, ONBOARDING_STEPS.STEP_2_ARTICULATE);
  assert.equal(r.patch.onboarding_step.picked_category, 1);
});

test('🛑 onboarding step 1: escape hatch「都不想」 → re-prompt step 1, state unchanged', async () => {
  const prev = buildInitialOnboardingState();
  const r = await onboardingFlowHandler({
    session_state: { onboarding_step: prev },
    user_response: '都不想',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, true);
  assert.match(r.inject, /輕推回選擇/);
  assert.deepEqual(r.patch, {}, 'state unchanged on escape');
});

// ─── Step 2 → 3 dispatch ─────────────────────────────────

test('🛑 onboarding step 2 → articulate → step 3 confirm with verbatim phrasing', async () => {
  const state = {
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_2_ARTICULATE,
      awaiting: ONBOARDING_AWAITING.ARTICULATE,
      picked_category: 2, articulate_text: null,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '我跟先生的溝通',
    student_context_onboarded: false,
  });
  assert.match(r.inject, /Step 3 · Confirm/);
  assert.match(r.inject, /這 21 天、我們聚焦在『我跟先生的溝通』/);
  assert.equal(r.patch.onboarding_step.current_step, ONBOARDING_STEPS.STEP_3_CONFIRM);
  assert.equal(r.patch.onboarding_step.articulate_text, '我跟先生的溝通');
});

test('🛑 onboarding step 2: vague「不知道」 → re-prompt step 2', async () => {
  const state = {
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_2_ARTICULATE,
      awaiting: ONBOARDING_AWAITING.ARTICULATE,
      picked_category: 2,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '不知道',
    student_context_onboarded: false,
  });
  assert.match(r.inject, /學員回應 vague/);
  assert.deepEqual(r.patch, {});
});

// ─── Step 3 confirm → complete ───────────────────────────

test('🛑 onboarding step 3 → 學員 confirm「對」 → complete + write payload', async () => {
  const state = {
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_3_CONFIRM,
      awaiting: ONBOARDING_AWAITING.CONFIRM,
      picked_category: 2,
      articulate_text: '我跟先生的溝通',
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '對',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, true);
  assert.match(r.inject, /Onboarding Complete/);
  assert.equal(r.patch.onboarding_step, null, 'state cleared on complete');
  // Write payload for chat.js to atomic UPDATE students.
  assert.deepEqual(r.onboarding_complete_write, {
    active_context_category: 2,
    active_context_name: '我跟先生的溝通',
    active_context_definition: '我跟先生的溝通',
    context_onboarded: true,
  });
});

test('🛑 onboarding step 3 → 學員 reject「不對」 → 回 step 2 articulate', async () => {
  const state = {
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_3_CONFIRM,
      awaiting: ONBOARDING_AWAITING.CONFIRM,
      picked_category: 2,
      articulate_text: '我跟先生的溝通',
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '不對',
    student_context_onboarded: false,
  });
  assert.match(r.inject, /回 step 2 重新 articulate/);
  assert.equal(r.patch.onboarding_step.current_step, ONBOARDING_STEPS.STEP_2_ARTICULATE);
  assert.equal(r.patch.onboarding_step.articulate_text, null);
  assert.equal(r.onboarding_complete_write, undefined,
    'reject must NOT signal write (Vivi 6/5: 修正 → 回 step 2)');
});

test('🛑 onboarding step 3: confirm + name > 30 chars → truncate + flag', async () => {
  const longName = 'x'.repeat(50);
  const state = {
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_3_CONFIRM,
      awaiting: ONBOARDING_AWAITING.CONFIRM,
      picked_category: 5,
      articulate_text: longName,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '是的',
    student_context_onboarded: false,
  });
  assert.equal(r.onboarding_complete_write.active_context_name.length, 30);
  assert.match(r.inject, /已截斷/);
});

test('🛑 onboarding handler: unknown step → defer + clear state (defensive)', async () => {
  const state = { onboarding_step: { current_step: 99, awaiting: 'x' } };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: 'x',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, false);
  assert.equal(r.patch.onboarding_step, null);
});
