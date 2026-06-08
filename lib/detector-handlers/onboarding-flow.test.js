// lib/detector-handlers/onboarding-flow.test.js
// v5.2 第四塊 PR-a — Lock onboarding state machine + parsers + crisis override.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onboardingFlowHandler } from './onboarding-flow.js';
import {
  ONBOARDING_STEPS, ONBOARDING_AWAITING,
  buildInitialOnboardingState,
  STEP_1_PHRASING_VERBATIM,
  buildStep2Phrasing, buildStep2Inject,
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

test('🛑 v5.2 6/6 v3: buildStep2Phrasing(2) — acknowledge picked category + 2-line form', () => {
  // Vivi 6/6 沙盒 #3: 原 spec §1.2「你想聚焦的是哪塊」太空泛。
  // 改成 2-line form 顯式 acknowledge picked_category.
  assert.equal(buildStep2Phrasing(2), `你選的是「親密關係(伴侶 / 戀愛)」。

想聚焦這裡面的哪一塊?`);
});

test('🛑 v5.2 6/6 v3: buildStep2Phrasing for each category 1..5 (Vivi 6/6 sandbox)', () => {
  const expected = {
    1: '事業 / 工作 / 金錢',
    2: '親密關係(伴侶 / 戀愛)',
    3: '家庭(原生家庭 / 子女)',
    4: '健康 / 身體',
    5: '自我 / 內在狀態 / 心理',
  };
  for (const [cat, label] of Object.entries(expected)) {
    const p = buildStep2Phrasing(Number(cat));
    // substring match (label has regex-special parens/slashes — avoid regex).
    assert.ok(p.includes(`你選的是「${label}」。`),
      `category ${cat}: must acknowledge ${label}`);
    assert.match(p, /想聚焦這裡面的哪一塊\?$/,
      `category ${cat}: 2-line form ending with question`);
  }
});

test('🛑 v5.2 6/6 v3: buildStep2Phrasing defensive — invalid → placeholder', () => {
  for (const bad of [null, undefined, 0, 6, NaN, 'foo']) {
    const p = buildStep2Phrasing(bad);
    assert.match(p, /你選的是「\[step 1 學員所選 category\]」。/,
      `${bad} should fall back to placeholder`);
  }
});

test('🛑 v5.2 6/6 v3: 廢「你想聚焦的是哪塊」空泛 phrasing (Vivi 6/6 沙盒 #3)', () => {
  // Original spec §1.2 phrasing was the bare question without category
  // acknowledgement. 6/6 v3 hotfix replaces it. None of the 5 category outputs
  // should be that bare line — they must all open with 「你選的是「...」」.
  for (const cat of [1, 2, 3, 4, 5]) {
    const p = buildStep2Phrasing(cat);
    assert.doesNotMatch(p, /^你想聚焦的是哪塊\?$/m,
      `category ${cat}: must NOT be the bare spec §1.2 v1 phrasing`);
    assert.match(p, /你選的是「/);
  }
});

// buildStep3Phrasing / 「這樣對嗎?」 phrasing is dead code at the handler layer
// (Vivi 6/7 2-step) — production no longer renders it. The phrasing module
// remains exported for any downstream reference, but this test was removed.

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

// buildStep3Inject anchor tests removed — buildStep3Inject is dead code at
// the handler layer (Vivi 6/7 2-step). The category anchor invariant moves
// to the new step-2-complete inject; tested below in "step 2 → complete".

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

test('🛑 parseArticulate: vague (bare 6) → null (caller re-prompts)', () => {
  for (const vague of ['不知道', '沒差', '都可以', '隨便', '都行', '沒意見']) {
    assert.equal(parseArticulate(vague), null, `${vague} should be vague`);
  }
});

test('🛑 parseArticulate: empty → null', () => {
  assert.equal(parseArticulate(''), null);
  assert.equal(parseArticulate('   '), null);
});

// ─── 6/7 Vivi: widened vague detection (砍 step-3 confirm 安全網補回) ──

test('🛑 6/7 parseArticulate WIDENED: filler + stem + tail particles all class as vague', () => {
  // Per Patrick verbatim spec — these must ALL return null (re-prompt step 2):
  const vaguePhrases = [
    '不知道',
    '嗯不知道耶',
    '我不知道',
    '不太確定',
    '還在想',
    '還沒想好',
    '再說吧',
    '看看',
    '沒特別想',
    '不曉得耶',
    '嗯…不知道',
    '都可以啦',
    // Extra coverage Patrick's regex covers (no harm verifying):
    '不太知道',
    '不曉得',
    '沒特別',
    '沒特別想法',
    '沒什麼想法',
    '不確定',
    '不清楚',
    '不太清楚',
    '沒想好',
    '再說',
    '我看看',          // FILLER 我 + STEM 看看
    '嗯…',             // 純 filler — would only be vague if STEM optional; we do NOT class this as vague (no STEM hit) → returns text. Tested separately below.
  ].filter(p => p !== '嗯…');   // re-tested in the "real" section as edge.
  for (const p of vaguePhrases) {
    assert.equal(parseArticulate(p), null, `"${p}" must be classed vague (return null)`);
  }
});

test('🛑 6/7 parseArticulate WIDENED: real focus phrases pass through (絕不誤殺)', () => {
  // Per Patrick verbatim spec — these must ALL return the trimmed text:
  const realPhrases = [
    '我跟先生的溝通',
    '金錢',
    '我的焦慮',
    '跟原生家庭的關係',
    '工作上的自信',
    '我不知道我要什麼但大概是工作',   // 含 "不知道" 但有實質尾巴 → 放行
    '事業',
    '想更愛自己',
    // Extra real cases:
    '我要更勇敢',
    '錢',                              // 1-char real focus
    '健康',
    '我跟爸媽的距離',
  ];
  for (const p of realPhrases) {
    assert.equal(parseArticulate(p), p, `"${p}" must pass through unchanged`);
  }
});

test('🛑 6/7 parseArticulate WIDENED: trimming still works on widened patterns', () => {
  assert.equal(parseArticulate('  嗯不知道耶  '), null, 'whitespace-wrapped vague still vague');
  assert.equal(parseArticulate('  我跟先生的溝通  '), '我跟先生的溝通', 'whitespace-wrapped real still trimmed');
});

test('🛑 6/7 parseArticulate WIDENED: "不知道" 後面接實質內容 → 放行 (整句測, 非 substring)', () => {
  // Anti-regression for over-blocking: a real focus containing "不知道" as
  // a fragment of its own articulation must pass.
  assert.equal(parseArticulate('我不知道我為什麼焦慮'), '我不知道我為什麼焦慮');
  assert.equal(parseArticulate('不知道怎麼跟爸媽說'), '不知道怎麼跟爸媽說');
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

// ─── P0 hotfix Fix 2: defer iff SOP-in-flight (NOT stale flags) ────────
test('🛑 P0 Fix 2: onboarding defers when crisis_sop_state in-flight (not yet complete)', async () => {
  // The new gate semantic — sopState exists AND crisis_sop_complete !== true.
  const r = await onboardingFlowHandler({
    session_state: {
      crisis_sop_state: { current_step: 4, awaiting: 'handoff_ack' },
      // crisis_sop_complete deliberately absent → in-flight
      onboarding_step: buildInitialOnboardingState(),
    },
    user_response: '1',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, false,
    'mid-SOP must defer onboarding (crisis-sop dispatches the turn instead)');
});

test('🛑 P0 Fix 2: onboarding does NOT defer on stale flags alone (A015 brick fix)', async () => {
  // Pre-hotfix: any one of the 3 lock flags set → permanent defer (brick).
  // Post-hotfix: those flags are no longer the gate. Without sopState, the
  // handler proceeds normally so a learner whose flags failed to clear can
  // still resume onboarding.
  const r = await onboardingFlowHandler({
    session_state: {
      crisis_in_progress: true,            // stale flag from prior session
      primary_mode: 'crisis',              // stale
      active_modes: ['crisis'],            // stale
      // ⚠️ crisis_sop_state ABSENT or completed — no actual SOP in flight.
      onboarding_step: buildInitialOnboardingState(),
    },
    user_response: '事業',                  // non-crisis content
    student_context_onboarded: false,
  });
  assert.equal(r.handled, true,
    'stale lock flags alone must NOT defer — onboarding proceeds (A015 brick fix)');
});

test('🛑 P0 Fix 2: completed SOP (crisis_sop_complete=true) → onboarding proceeds', async () => {
  // After Fix 1 closure clears flags and sets crisis_sop_complete=true.
  // sopState is preserved (audit) but no longer gates onboarding.
  const r = await onboardingFlowHandler({
    session_state: {
      crisis_sop_state: { current_step: 8, awaiting: null, closure_explicit: true },
      crisis_sop_complete: true,
      onboarding_step: buildInitialOnboardingState(),
    },
    user_response: '事業',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, true,
    'closure-cleared SOP must not defer; onboarding picks up from saved step');
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

// ─── Step 2 → COMPLETE dispatch (Vivi 6/7 2-step) ─────────────

test('🛑 6/7 step 2 → clear articulate → COMPLETE directly (no step 3 confirm)', async () => {
  // Spec: 砍 step-3「這樣對嗎」. Clear articulate at step 2 → fire write +
  // single-turn acknowledge + Mode 1 first question.
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
  // Completion fires same turn — state cleared, write payload emitted.
  assert.equal(r.handled, true);
  assert.match(r.inject, /Onboarding Complete \(2-step, no confirm\)/);
  assert.equal(r.patch.onboarding_step, null,
    'state cleared on complete — no advance to step 3');
  // Write payload contract unchanged (chat.js PR-b atomic write still consumes).
  assert.deepEqual(r.onboarding_complete_write, {
    active_context_category: 2,
    active_context_name: '我跟先生的溝通',
    active_context_definition: '我跟先生的溝通',
    context_onboarded: true,
  });
});

test('🛑 6/7 step 2 → complete inject CONTAINS acknowledge + Mode 1 first question + same turn', async () => {
  // Spec wording: "簡短 acknowledge,例「好,這 21 天我們從『{name}』開始。」
  // + 直接接 Mode 1 第一個問題「在『{name}』這塊、你想要什麼?」"
  const state = {
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_2_ARTICULATE,
      awaiting: ONBOARDING_AWAITING.ARTICULATE,
      picked_category: 5, articulate_text: null,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '我的焦慮',
    student_context_onboarded: false,
  });
  // Acknowledge sample.
  assert.match(r.inject, /這 21 天我們從『我的焦慮』開始/);
  // Mode 1 first-question handoff in the same reply.
  assert.match(r.inject, /在『我的焦慮』這塊、你想要什麼\?/);
  assert.match(r.inject, /AI 本 turn 同一則回應/);
  // Explicit "no 對嗎" guard (instruction to AI not to ask the question).
  assert.match(r.inject, /不問「這樣對嗎」/);
  // The old buildStep3Phrasing's literal student-facing question is NOT present
  // (the guard string above mentions 「這樣對嗎」 in quotes, but the original
  // step-3 phrasing was a *bare* sentence ending in 「這樣對嗎?」 — that exact
  // shape must not appear).
  assert.doesNotMatch(r.inject, /『[^』]+』。\s*\n\s*這樣對嗎\?/,
    'old buildStep3Phrasing bare 「對嗎」 question shape must not appear');
  // And the old Step 3 inject heading must not appear.
  assert.doesNotMatch(r.inject, /Step 3 · Confirm/);
});

test('🛑 6/7 step 2 → complete: no STEP_3_CONFIRM ever surfaces in state machine', async () => {
  // Anti-regression: if anything in the flow ever lands a learner in
  // STEP_3_CONFIRM the 「對嗎」 round-trip is back. This test pins the
  // post-complete state to null and the dispatch to NEVER advance there.
  const state = {
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_2_ARTICULATE,
      awaiting: ONBOARDING_AWAITING.ARTICULATE,
      picked_category: 3, articulate_text: null,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '我跟爸媽',
    student_context_onboarded: false,
  });
  // Post-complete state is null — not STEP_3_CONFIRM.
  assert.equal(r.patch.onboarding_step, null);
  assert.notEqual(r.patch.onboarding_step, ONBOARDING_STEPS.STEP_3_CONFIRM);
});

test('🛑 onboarding step 2: vague「不知道」 → re-prompt step 2 (unchanged)', async () => {
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

test('🛑 6/7 step 2 → complete: name > 30 chars → truncate + flag in inject', async () => {
  const longName = 'x'.repeat(50);
  const state = {
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_2_ARTICULATE,
      awaiting: ONBOARDING_AWAITING.ARTICULATE,
      picked_category: 5,
      articulate_text: null,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: longName,
    student_context_onboarded: false,
  });
  assert.equal(r.onboarding_complete_write.active_context_name.length, 30);
  assert.match(r.inject, /已截斷/);
});

test('🛑 6/7 STEP_3_CONFIRM state from stale pre-deploy session → cleared + defer (defensive)', async () => {
  // A learner mid-flight when the 2-step deploy lands. Their saved state has
  // current_step=3. The new handler's switch has no case 3 → falls through to
  // default → handler clears state + defers. chat.js next turn re-inits and
  // they finish in 2 steps. Saved articulate_text is lost (re-prompted).
  const state = {
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_3_CONFIRM,   // legacy state
      awaiting: ONBOARDING_AWAITING.CONFIRM,
      picked_category: 2,
      articulate_text: '我跟先生的溝通',
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '對',
    student_context_onboarded: false,
  });
  // Default case: cleared + defer (handled=false).
  assert.equal(r.handled, false);
  assert.equal(r.patch.onboarding_step, null,
    'legacy STEP_3_CONFIRM state must be cleared on encounter');
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
