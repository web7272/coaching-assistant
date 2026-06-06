// lib/detector-handlers/onboarding-flow-integration.test.js
// v5.2 第四塊 PR-b — Onboarding intercept integration tests:
//   1. handler defers when crisis_in_progress (safety override) — orthogonal.
//   2. handler emits onboarding_complete_write payload at COMPLETE step
//      (chat.js consumes for atomic students UPDATE — mocked SQL would lock here).
//   3. Full 3-turn happy path: !onboarded → step 1 → step 2 → step 3 confirm
//      → COMPLETE write.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { onboardingFlowHandler } from './onboarding-flow.js';
import {
  ONBOARDING_STEPS, ONBOARDING_AWAITING,
} from '../sub-prompts/onboarding/index.js';

// ─── Full happy path (3 turns) ───────────────────────────

test('🛑 v5.2 onboarding full path: new student → step 1 → step 2 → step 3 confirm → COMPLETE', async () => {
  let state = {};
  let writePayload = null;

  // Turn 0: !onboarded + no state → init + inject step 1.
  let r = await onboardingFlowHandler({
    session_state: state, user_response: '',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, true);
  assert.match(r.inject, /Step 1 · Category Pick/);
  assert.match(r.inject, /從你最在意的地方開始/);
  state = { onboarding_step: r.patch.onboarding_step };
  assert.equal(state.onboarding_step.current_step, ONBOARDING_STEPS.STEP_1_CATEGORY_PICK);

  // Turn 1: 學員回應「2」 → step 2 articulate.
  r = await onboardingFlowHandler({
    session_state: state, user_response: '2',
    student_context_onboarded: false,
  });
  assert.match(r.inject, /Step 2 · Articulate/);
  state = { onboarding_step: r.patch.onboarding_step };
  assert.equal(state.onboarding_step.current_step, ONBOARDING_STEPS.STEP_2_ARTICULATE);
  assert.equal(state.onboarding_step.picked_category, 2);

  // Turn 2: 學員 articulate「我跟先生的溝通」 → step 3 confirm with verbatim phrasing.
  r = await onboardingFlowHandler({
    session_state: state, user_response: '我跟先生的溝通',
    student_context_onboarded: false,
  });
  assert.match(r.inject, /Step 3 · Confirm/);
  assert.match(r.inject, /這 21 天、我們聚焦在『我跟先生的溝通』/);
  state = { onboarding_step: r.patch.onboarding_step };
  assert.equal(state.onboarding_step.current_step, ONBOARDING_STEPS.STEP_3_CONFIRM);
  assert.equal(state.onboarding_step.articulate_text, '我跟先生的溝通');

  // Turn 3: 學員 confirm「對」 → COMPLETE + emit write payload.
  r = await onboardingFlowHandler({
    session_state: state, user_response: '對',
    student_context_onboarded: false,
  });
  assert.match(r.inject, /Onboarding Complete/);
  // State cleared.
  assert.equal(r.patch.onboarding_step, null);
  // Write payload contract for chat.js atomic UPDATE.
  writePayload = r.onboarding_complete_write;
  assert.deepEqual(writePayload, {
    active_context_category: 2,
    active_context_name: '我跟先生的溝通',
    active_context_definition: '我跟先生的溝通',
    context_onboarded: true,
  });
});

// ─── Reject path: step 3 → reject → step 2 → re-articulate → confirm ──

test('🛑 v5.2 onboarding reject path: step 3 reject → step 2 → re-articulate → confirm', async () => {
  let state = {
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_3_CONFIRM,
      awaiting: ONBOARDING_AWAITING.CONFIRM,
      picked_category: 3,
      articulate_text: '原生家庭',
    },
  };

  // Reject → 回 step 2 + clear articulate_text.
  let r = await onboardingFlowHandler({
    session_state: state, user_response: '不對',
    student_context_onboarded: false,
  });
  assert.match(r.inject, /回 step 2 重新 articulate/);
  state = { onboarding_step: r.patch.onboarding_step };
  assert.equal(state.onboarding_step.current_step, ONBOARDING_STEPS.STEP_2_ARTICULATE);
  assert.equal(state.onboarding_step.articulate_text, null);
  assert.equal(state.onboarding_step.picked_category, 3, 'category preserved across reject');
  assert.equal(r.onboarding_complete_write, undefined);

  // Re-articulate with new phrasing → step 3 with new text.
  r = await onboardingFlowHandler({
    session_state: state, user_response: '我跟父母的距離',
    student_context_onboarded: false,
  });
  assert.match(r.inject, /這 21 天、我們聚焦在『我跟父母的距離』/);
  state = { onboarding_step: r.patch.onboarding_step };
  assert.equal(state.onboarding_step.articulate_text, '我跟父母的距離');

  // Confirm → COMPLETE with new articulate.
  r = await onboardingFlowHandler({
    session_state: state, user_response: '對',
    student_context_onboarded: false,
  });
  assert.equal(r.onboarding_complete_write.active_context_category, 3);
  assert.equal(r.onboarding_complete_write.active_context_name, '我跟父母的距離');
  assert.equal(r.onboarding_complete_write.context_onboarded, true);
});

// ─── Crisis override during onboarding ──────────────────

test('🛑 P0 Fix 2: SOP in-flight (Step 4, NOT complete) → onboarding defers + state preserved', async () => {
  // A015 case: 學員打「我想自殺」 → active SI fast-path inits sopState at
  // Step 4 → next turn (or resume turn), onboarding must defer so crisis-sop
  // takes the turn. preemptive signal text optional — sopState itself defers.
  const state = {
    // ⚠️ stale flags removed from gate; sopState now drives defer:
    crisis_sop_state: {
      current_step: 4,
      awaiting: 'handoff_ack',
      handoff_variant_used: 'high_risk',
      si_answer: 'confirm',
      active_si_explicit: true,
    },
    // crisis_sop_complete absent → in-flight
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_1_CATEGORY_PICK,
      awaiting: ONBOARDING_AWAITING.CATEGORY_PICK,
      picked_category: null,
      articulate_text: null,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state,
    user_response: 'whatever (mid-SOP next turn)',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, false,
    'mid-SOP sopState must defer; crisis-sop dispatches the turn instead');
  // Onboarding state NOT cleared — when SOP closure clears flags, learner
  // resumes onboarding at the same step (no data loss).
  assert.equal(state.onboarding_step.current_step, ONBOARDING_STEPS.STEP_1_CATEGORY_PICK);
});

test('🛑 P0 Fix 2: stale flags WITHOUT sopState → onboarding does NOT defer (A015 brick fix)', async () => {
  // This is THE A015 brick scenario: a learner whose past session set the
  // 3 lock flags but no current SOP is in flight. Pre-hotfix → permanent
  // defer → fall back to onboarding step 1 prompt → bricked. Post-hotfix
  // → handler proceeds with the saved step.
  const state = {
    crisis_in_progress: true,           // stale from prior session
    primary_mode: 'crisis',              // stale
    active_modes: ['crisis'],            // stale
    // ⚠️ NO crisis_sop_state (or completed) — actual SOP is NOT in flight
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_2_ARTICULATE,
      awaiting: ONBOARDING_AWAITING.ARTICULATE,
      picked_category: 2,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '我跟先生的溝通',  // non-crisis content
    student_context_onboarded: false,
  });
  assert.equal(r.handled, true,
    'stale flags alone must NOT defer — handler picks up at the saved onboarding step');
  // Onboarding step preserved → student picks up where they left off.
  assert.match(r.inject, /Step 3 · Confirm/);
});

test('🛑 P0 Fix 2: completed SOP → onboarding proceeds normally', async () => {
  // After Fix 1 closure: flags cleared, sopState preserved with complete=true.
  const state = {
    crisis_sop_state: { current_step: 8, awaiting: null, closure_explicit: true },
    crisis_sop_complete: true,
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_2_ARTICULATE,
      awaiting: ONBOARDING_AWAITING.ARTICULATE,
      picked_category: 5,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '我的焦慮',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, true,
    'completed SOP must not block onboarding continuation');
});

// ─── 6/5 SAFETY HOTFIX — preemptive crisis-signal defer (first-surface) ───
//
// Repro: new student, onboarding Turn 0, crisis_in_progress=false, user_response
// carries a deep-signal. Onboarding MUST defer (handled=false, state preserved)
// so chat.js skips onboardingTookTurn=true and runs the user_turn cascade →
// deep-signal-detector (priority 20) → crisis-SOP. Without this, the first
// surface is silently parsed as a vague category-pick.

test('🛑 6/5 hotfix: step 1 + crisis NOT yet active + PASSIVE_STRONG (「我不想活」) → defer + state preserved', async () => {
  const state = {
    crisis_in_progress: false,           // ← critical: NOT yet triggered
    primary_mode: null,
    active_modes: [],
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_1_CATEGORY_PICK,
      awaiting: ONBOARDING_AWAITING.CATEGORY_PICK,
      picked_category: null,
      articulate_text: null,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '我不想活',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, false,
    'PASSIVE_STRONG hit at Turn 0 must defer so user_turn cascade runs (crisis detector @ priority 20)');
  // State must NOT be cleared — crisis SOP exits → next turn resumes same step.
  assert.equal(state.onboarding_step.current_step, ONBOARDING_STEPS.STEP_1_CATEGORY_PICK,
    'onboarding_step preserved (no data loss)');
  // Handler must NOT have emitted a patch that clears state.
  assert.equal(r.patch, undefined, 'no patch — defer is clean');
  // Must NOT have parsed user_response as a category.
  assert.equal(r.onboarding_complete_write, undefined);
});

test('🛑 6/5 hotfix: step 1 + crisis NOT yet active + PASSIVE_IMPLICIT (「此生無憾」) → defer + state preserved', async () => {
  const state = {
    crisis_in_progress: false,
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_1_CATEGORY_PICK,
      awaiting: ONBOARDING_AWAITING.CATEGORY_PICK,
      picked_category: null,
      articulate_text: null,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '此生無憾了',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, false,
    'PASSIVE_IMPLICIT hit at Turn 0 must defer — deep-signal-detector decides co-occurrence; onboarding must not pre-empt by swallowing the turn');
  assert.equal(state.onboarding_step.current_step, ONBOARDING_STEPS.STEP_1_CATEGORY_PICK);
  assert.equal(r.patch, undefined);
});

test('🛑 6/6 v2 hotfix: step 1 + ACTIVE_SI_EXPLICIT (「我想自殺」) → defer + signal_kind=active_si_explicit', async () => {
  // Vivi 沙盒 #2: onboarding must classify active SI explicit distinctly so
  // chat.js cascade routes to crisis-sop Step 4 fast-path (not pre-fix
  // misclassification as TRAUMA which would still defer but with wrong log).
  const state = {
    crisis_in_progress: false,
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_1_CATEGORY_PICK,
      awaiting: ONBOARDING_AWAITING.CATEGORY_PICK,
      picked_category: null,
      articulate_text: null,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '我想自殺',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, false,
    'ACTIVE_SI_EXPLICIT first surface at Turn 0 must defer to crisis cascade');
  // onboarding_step preserved verbatim.
  assert.equal(state.onboarding_step.current_step, ONBOARDING_STEPS.STEP_1_CATEGORY_PICK);
  assert.equal(r.patch, undefined);
});

test('🛑 6/5 hotfix: step 2 + crisis NOT yet active + TRAUMA marker (「霸凌」) in articulate → defer + state preserved', async () => {
  // step 2 (articulate) is where a trauma marker most likely surfaces — student
  // is being asked to describe the focus area.
  const state = {
    crisis_in_progress: false,
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_2_ARTICULATE,
      awaiting: ONBOARDING_AWAITING.ARTICULATE,
      picked_category: 3,                // already picked "家庭"
      articulate_text: null,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '我小時候被霸凌',
    student_context_onboarded: false,
  });
  assert.equal(r.handled, false,
    'TRAUMA marker at articulate step must defer — cannot be written as active_context_definition');
  // Preserve picked_category — student doesn't re-pick after crisis exits.
  assert.equal(state.onboarding_step.picked_category, 3, 'picked_category preserved');
  assert.equal(state.onboarding_step.current_step, ONBOARDING_STEPS.STEP_2_ARTICULATE);
  assert.equal(r.patch, undefined);
  assert.equal(r.onboarding_complete_write, undefined);
});

// ─── 6/6 hotfix: step-1 pick → step-2 inject anchors correct category ───
//
// Repro (Vivi 沙盒): step 1 學員選「4 健康」→ step 2 應 anchor「健康 / 身體」.
// 原 bug 來源:students.active_context_category 此時還是 migration 029 default 1,
// step 2 active-context anchor 顯示「事業」. 修法:onboarding 流程內的 category
// label 全部用 in-flight onboarding_step.picked_category (chat.js 層額外 suppress
// active-context inject during onboarding — covered by chat.js diff).

for (const cat of [1, 2, 3, 4, 5]) {
  test(`🛑 6/6 hotfix integration: step 1 picks ${cat} → step 2 inject anchors category ${cat}, NOT stale studentRow default`, async () => {
    // Fresh student, no onboarding state yet.
    let r = await onboardingFlowHandler({
      session_state: {},
      user_response: '',
      student_context_onboarded: false,
    });
    // Step 1 inject — pre-pick, no category anchor yet.
    assert.match(r.inject, /Step 1 · Category Pick/);

    // Turn 1: 學員 picks `cat`.
    const state = { onboarding_step: r.patch.onboarding_step };
    r = await onboardingFlowHandler({
      session_state: state,
      user_response: String(cat),
      student_context_onboarded: false,
    });

    // Step 2 inject must anchor the picked category (in-flight),
    // NOT stale students.active_context default 1.
    assert.match(r.inject, /Step 2 · Articulate/);
    assert.match(r.inject, new RegExp(`category ${cat} \\(`),
      `expected "category ${cat}" anchor`);
    // 6/6 bug repro: when cat != 1, anchor must NOT show 事業.
    if (cat !== 1) {
      assert.doesNotMatch(r.inject, /本 turn anchor: 「事業 \/ 工作 \/ 金錢」/,
        `category ${cat} pick must NOT anchor 事業 (stale studentRow default)`);
    }
    // picked_category persisted for next turn.
    assert.equal(r.patch.onboarding_step.picked_category, cat);
  });
}

test('🛑 6/6 hotfix integration: step 2 vague re-prompt preserves picked_category anchor', async () => {
  // Student picked 4 (健康) at step 1; says vague「不知道」 at step 2.
  const state = {
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_2_ARTICULATE,
      awaiting: ONBOARDING_AWAITING.ARTICULATE,
      picked_category: 4,
      articulate_text: null,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '不知道',
    student_context_onboarded: false,
  });
  // Re-prompt step 2 — anchor must remain 健康 / 身體.
  assert.match(r.inject, /本 turn anchor: 「健康 \/ 身體」/);
  assert.match(r.inject, /學員回應 vague/);
  // 6/6 phrasing: 探索 in vague-handle note.
  assert.match(r.inject, /輕引「就你今天最想探索的那塊」/);
});

test('🛑 6/6 hotfix integration: step 3 reject → re-prompt step 2 keeps picked_category anchor', async () => {
  // Student picked 2 (親密關係), articulated, now rejects.
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
  // Re-prompt step 2 — anchor must remain 親密關係.
  assert.match(r.inject, /本 turn anchor: 「親密關係\(伴侶 \/ 戀愛\)」/);
  // picked_category preserved.
  assert.equal(r.patch.onboarding_step.picked_category, 2);
});

test('🛑 6/6 hotfix integration: step 3 confirm phrasing inject carries category anchor', async () => {
  // Student picked 5 (自我), articulated, now confirms.
  const state = {
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_2_ARTICULATE,
      awaiting: ONBOARDING_AWAITING.ARTICULATE,
      picked_category: 5,
      articulate_text: null,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '我的焦慮',
    student_context_onboarded: false,
  });
  assert.match(r.inject, /Step 3 · Confirm/);
  assert.match(r.inject, /本 turn anchor: 「自我 \/ 內在狀態 \/ 心理」/);
  assert.match(r.inject, /這 21 天、我們聚焦在『我的焦慮』/);
});

// ─── errata v02 alignment: onboarding preemptive crisis defer → new Step 4 ───
//
// Per Vivi 6/6 task spec: onboarding preemptive crisis defer (hotfix aa81194)
// must hand off to the NEW Step 4 direct-1925 phrasing (not the old ABC mechanic).
// This test confirms the chain:
//   onboarding step 1 + user_response='我不想活' →
//     onboardingFlowHandler defers (handled=false) →
//     [chat.js dispatches user_turn cascade] →
//     deep-signal-detector fires C-1 strong → crisis_in_progress=true →
//     [next turn] crisis-sop takes over → eventually hits Step 4 →
//     getHandoffInject(variant) → direct-1925 phrasing (no 三選一, no 預約).
//
// We assert the Step 4 phrasing 終 sink (verbatim errata v02) since the
// preemptive defer + cascade is already locked by aa81194's tests.

test('🛑 errata v02: onboarding preemptive crisis defer → Step 4 direct-1925 phrasing (NOT abc)', async () => {
  // Import errata v02 phrasing source. Confirm none of the deprecated mechanics
  // appears in any of the 4 variants — what onboarding-deferred crisis ends up using.
  const { HANDOFF_PHRASINGS_VERBATIM, getHandoffInject } = await import(
    '../sub-prompts/crisis/handoff-three-options.js'
  );
  // Standard variant — Vivi 沙盒 case「我不想活」 first surface fires this.
  assert.match(HANDOFF_PHRASINGS_VERBATIM.standard, /1925/);
  assert.match(HANDOFF_PHRASINGS_VERBATIM.standard, /不繼續往前推/);
  for (const v of ['standard', 'cumulative', 'high_risk', 'freeze']) {
    const inject = getHandoffInject(v);
    assert.doesNotMatch(inject, /\(a\) 先停在這、不繼續挖/,
      `${v}: errata v02 廢「(a) 先停在這」`);
    assert.doesNotMatch(inject, /\(b\) 我幫你預約跟 Vivi/,
      `${v}: errata v02 廢「我幫你預約 1-on-1」`);
    assert.doesNotMatch(inject, /\(c\) 我們先回到日常/,
      `${v}: errata v02 廢「(c) 回到日常」`);
  }
  // freeze still uses「Vivi 知道你的狀況、她會直接聯絡你」 (capacity OK — 主動非 booking).
  assert.match(HANDOFF_PHRASINGS_VERBATIM.freeze, /Vivi 知道你的狀況、她會直接聯絡你/);
});

// ─── Existing beta student (onboarded=TRUE) ──────────────

test('🛑 v5.2 onboarding: existing beta student (onboarded=TRUE) → defer (normal flow)', async () => {
  const r = await onboardingFlowHandler({
    session_state: {},
    user_response: '我想要更勇敢',
    student_context_onboarded: true,
  });
  assert.equal(r.handled, false, 'onboarded student bypasses onboarding intercept');
});

// ─── Edge: long articulate truncation ───────────────────

test('🛑 v5.2 onboarding: articulate > 30 chars → name truncated + def 200 cap', async () => {
  const longText = '我跟先生的溝通主要是日常溝通也包含原生家庭的影響很複雜需要慢慢處理';
  assert.ok(longText.length > 30, 'test fixture must exceed 30');
  const state = {
    onboarding_step: {
      current_step: ONBOARDING_STEPS.STEP_3_CONFIRM,
      awaiting: ONBOARDING_AWAITING.CONFIRM,
      picked_category: 2,
      articulate_text: longText,
    },
  };
  const r = await onboardingFlowHandler({
    session_state: state, user_response: '是的',
    student_context_onboarded: false,
  });
  assert.equal(r.onboarding_complete_write.active_context_name.length, 30);
  assert.equal(r.onboarding_complete_write.active_context_definition.length,
    Math.min(longText.length, 200));
});
