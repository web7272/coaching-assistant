// lib/damon-reframe-library/pr7b-additions.test.js
// v5.1 Step 7 PR-7b — Lock R8 / R3_C variant / 自我重要性 Landmine /
// R12 Hero's Welcome SOP (TODO Vivi 終審) / cached 段 4 R8/R12 reference.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { R3, R3_VARIANTS } from './r3-failure-as-feedback.js';
import { R8 } from './r8-tote-framework.js';
import { REFRAME_REGISTRY, REFRAME_TIERS, getReframe } from './index.js';
import { pickReframeForTurn, _internal as STACKING_INTERNAL } from './stacking.js';
import {
  buildTier1RejectInject,
} from '../detector-handlers/landmine-check.js';
import { QUALITY_TERMS } from '../prompt-sections/conditional/engine-2/master-detector.js';
import { default as herosWelcomeSop } from '../sub-prompts/integration/heros-welcome-4-step-sop.js';

// ─── R3_C 科學家精神 (errata v0.2 Patch 5.2 逐字) ──────────

test('🛑 R3_C: buildInject contains errata v0.2 Patch 5.2 verbatim anchors', () => {
  const txt = R3.buildInject({
    variant: R3_VARIANTS.R3_C,
    failure_quote: '專案失敗',
    mode: 'integration',
  });
  assert.match(txt, /R3_C 科學家精神 vs 受審判的犯人/);
  assert.match(txt, /將自己從受審判的犯人轉變為實驗室的科學家/);
  assert.match(txt, /Step 2 — the two modes/);
  assert.match(txt, /受審判的犯人/);
  assert.match(txt, /實驗室的科學家/);
  assert.match(txt, /Step 3 — invite shift/);
  assert.match(txt, /離答案更近了/);
  assert.match(txt, /Step 4 — anchor/);
  assert.match(txt, /價值在『繼續實驗的勇氣』裡/);
  // cascade hint to R8 Operate.
  assert.match(txt, /R8 T\.O\.T\.E\. step Operate/);
});

test('🛑 R3 shouldInvoke: priorR3 >= 1 (no neg_gen) → R3_C cascade variant', () => {
  const state = {
    primary_mode: 'integration',
    reframe_invocation_history_in_session: [{ reframe_id: 'R3' }],
  };
  const r = R3.shouldInvoke(state, {});
  assert.equal(r.invoke, true);
  assert.equal(r.variant, R3_VARIANTS.R3_C);
});

test('🛑 R3 shouldInvoke: signal.r3_cascade_to_scientist → R3_C', () => {
  const r = R3.shouldInvoke({ primary_mode: 'integration' }, { r3_cascade_to_scientist: true });
  assert.equal(r.invoke, true);
  assert.equal(r.variant, R3_VARIANTS.R3_C);
});

test('🛑 R3 shouldInvoke: priorR3 == 0 + no neg_gen → R3_A standard', () => {
  const r = R3.shouldInvoke({ primary_mode: 'integration' }, {});
  assert.equal(r.invoke, true);
  assert.equal(r.variant, R3_VARIANTS.R3_A);
});

// ─── R8 T.O.T.E. (errata v0.2 Patch 1 逐字) ────────────────

test('🛑 R8 registered + tier 1 + future_pacing primary', () => {
  assert.equal(R8.id, 'R8');
  assert.equal(R8.tier, 1);
  assert.equal(R8.mode_applicability.future_pacing, 'primary');
  assert.equal(R8.mode_applicability.crisis, 'not_applicable');
  assert.equal(REFRAME_REGISTRY.R8.id, 'R8');
  assert.equal(REFRAME_TIERS.R8, 1);
});

test('🛑 R8 buildInject: errata §1.4 4-step verbatim T-O-T-E anchors', () => {
  const txt = R8.buildInject({
    goal_quote: '我想開始寫書',
    mode: 'future_pacing',
  });
  assert.match(txt, /R8 T\.O\.T\.E\. Framework/);
  assert.match(txt, /Step T — Test Baseline/);
  assert.match(txt, /Step O — Operate/);
  assert.match(txt, /小到不能失敗的動作/);
  assert.match(txt, /Step T — Test Feedback/);
  assert.match(txt, /這不是失敗、這是黃金情報/);
  assert.match(txt, /科學家不會因為實驗結果而質疑自己的價值/);
  assert.match(txt, /Step E — Exit/);
  assert.match(txt, /不再重複舊有的、無效的操作/);
  // cascade R3 hint.
  assert.match(txt, /cascade R3 失敗作為 Feedback/);
  // No Bias towards Action statement (reserved).
  assert.match(txt, /暫留.*R8 Bias towards Action/);
  assert.doesNotMatch(txt, /行動偏好.*Bias towards Action.*強化話術/);
});

test('🛑 R8 shouldInvoke: crisis_mode → blocked', () => {
  const r = R8.shouldInvoke({ primary_mode: 'crisis' }, { action_oriented_context: true });
  assert.equal(r.invoke, false);
  assert.equal(r.reason, 'crisis_mode_active');
});

test('🛑 R8 shouldInvoke: emotional_surface → blocked', () => {
  const r = R8.shouldInvoke({ primary_mode: 'future_pacing' },
    { action_oriented_context: true, emotional_surface_context: true });
  assert.equal(r.invoke, false);
  assert.equal(r.reason, 'emotional_surface_context');
});

test('🛑 R8 shouldInvoke: no action context → blocked', () => {
  const r = R8.shouldInvoke({ primary_mode: 'future_pacing' }, {});
  assert.equal(r.invoke, false);
  assert.equal(r.reason, 'no_action_context');
});

test('🛑 R8 shouldInvoke: action_hesitation_marker → invoke R8_A', () => {
  const r = R8.shouldInvoke({ primary_mode: 'future_pacing' }, { action_hesitation_marker: true });
  assert.equal(r.invoke, true);
  assert.equal(r.variant, 'R8_A');
});

test('🛑 R8 buildInject: 2+ prior → downsize (R8_F2 framework rigidity)', () => {
  const txt = R8.buildInject({ prior_invocations: 2 });
  assert.match(txt, /downsized/);
  assert.match(txt, /framework rigidity/);
  assert.doesNotMatch(txt, /Step T — Test Baseline/);
});

test('🛑 getReframe(R8) works + getReframe(R10) still throws', () => {
  assert.equal(getReframe('R8').id, 'R8');
  assert.throws(() => getReframe('R10'), /permanently deprecated/);
});

// ─── §9 Stacking — R8 in future_pacing default order ─────

test('🛑 stacking: future_pacing MODE_DEFAULTS includes R8 first (primary)', () => {
  assert.deepEqual(STACKING_INTERNAL.MODE_DEFAULTS.future_pacing, ['R8', 'R7', 'R2', 'R6']);
});

test('🛑 stacking: pickReframeForTurn future_pacing prefers R8 over R7', () => {
  const r = pickReframeForTurn(['R7', 'R8'], { primary_mode: 'future_pacing' });
  assert.equal(r.picked, 'R8');
});

// ─── 自我重要性 Landmine (errata v0.2 Patch 5.4) ──────────

test('🛑 master-detector tier1: includes 證明自己 / 自我重要性 / 自豪', () => {
  const tier1 = QUALITY_TERMS.blacklist_tiers.tier1_absolute_reject;
  for (const term of ['證明自己', '證明我是', '讓人知道我是', '自我重要性', '自豪',
                       '被看見', '被注意']) {
    assert.ok(tier1.includes(term), `tier 1 must include 「${term}」`);
  }
});

test('🛑 buildTier1RejectInject「證明自己」: 自我重要性 deep-dig phrasing appended', () => {
  const inject = buildTier1RejectInject('證明自己');
  assert.match(inject, /自我重要性 Landmine 專屬深挖/);
  assert.match(inject, /errata v0.2 Patch 5\.4/);
  // Spec phrasing: 「如果『證明自己』這個 part 去掉、你剩下什麼?」
  assert.match(inject, /如果『證明自己』這個 part 去掉/);
  assert.match(inject, /『證明自己』.*最深的.*想被什麼/);
});

test('🛑 buildTier1RejectInject「被需要」 (non-self-importance term): NO deep-dig section', () => {
  const inject = buildTier1RejectInject('被需要');
  // Original tier 1 reject still works.
  assert.match(inject, /Landmine Check Tier 1 Reject/);
  // 自我重要性 專屬 deep-dig NOT triggered for 被需要.
  assert.doesNotMatch(inject, /自我重要性 Landmine 專屬深挖/);
});

// ─── R12 Hero's Welcome SOP (Vivi guard #1 — phrasing TODO) ──

test('🛑 R12 SOP: 4 steps documented + each phrasing == TODO(Vivi 終審)', () => {
  const txt = herosWelcomeSop.prompt_content;
  assert.match(txt, /Step 1 — 停在那個決定/);
  assert.match(txt, /Step 2 — 挖良善動機/);
  assert.match(txt, /Step 3 — 看見自己的良善/);
  assert.match(txt, /Step 4 — 整合/);
  // ⚠️ Vivi guard #1 — each step has phrasing TODO marker, NOT hardcoded phrasing.
  const todoMatches = (txt.match(/TODO\(Vivi 終審\)/g) || []).length;
  assert.ok(todoMatches >= 4, `must have ≥ 4 TODO(Vivi 終審) markers, found ${todoMatches}`);
});

test('🛑 R12 SOP: critical 紅線 4 條 verbatim 進 inject', () => {
  const txt = herosWelcomeSop.prompt_content;
  assert.match(txt, /不請學員「回想一個過去後悔的決定」/);
  assert.match(txt, /不請學員「講負面故事」/);
  assert.match(txt, /不主動拉學員去挖負面記憶/);
  assert.match(txt, /不用「失敗」「錯誤」「後悔」評判語 frame/);
});

test('🛑 R12 SOP: 不問「為什麼」、問「在保護什麼」/「想顧到什麼」', () => {
  const txt = herosWelcomeSop.prompt_content;
  assert.match(txt, /不問「為什麼」/);
  assert.match(txt, /在保護什麼/);
  assert.match(txt, /想顧到什麼/);
});

test('🛑 R12 SOP: disable 條件 + crisis exclusion', () => {
  assert.ok(herosWelcomeSop.disable_conditions.includes('crisis mode active'));
  assert.ok(herosWelcomeSop.disable_conditions.some(c => /學員沒主動 surface/.test(c)));
});

test('🛑 R12 SOP: vivi_review_pending lists all 4 step phrasings', () => {
  assert.equal(herosWelcomeSop.vivi_review_pending.length, 4);
  for (const note of herosWelcomeSop.vivi_review_pending) {
    assert.match(note, /Step \d 學員 facing phrasing/);
  }
});

test('R12 SOP: id + module shape', () => {
  assert.equal(herosWelcomeSop.id, 'integration_heros_welcome_4_step_sop');
  assert.equal(herosWelcomeSop.type, 'conditional_inject');
  assert.equal(herosWelcomeSop.trigger_event, 'user_turn');
});

// ─── cached 段 4 — R8 / R12 reference added (Patch 7b) ───

test('🛑 cached 段 4: includes R8 T.O.T.E. Framework reference', async () => {
  const { default: section } = await import('../prompt-sections/cached/active-reference-styles.js');
  assert.match(section.content, /── R8 T\.O\.T\.E\. Framework ──/);
  assert.match(section.content, /Test baseline → Operate.*Test feedback.*Exit/s);
});

test('🛑 cached 段 4: includes R12 Hero\'s Welcome reference + phrasing TODO marker', () => {
  return import('../prompt-sections/cached/active-reference-styles.js').then(m => {
    const txt = m.default.content;
    assert.match(txt, /── R12 Hero's Welcome 4-step SOP ──/);
    assert.match(txt, /學員自然 surface.*過去決定/);
    assert.match(txt, /❌ AI 不主動引發/);
    assert.match(txt, /phrasing 全部 Vivi 終審/);
  });
});

test('🛑 cached 段 4 token_estimate bumped 1200 → 1320 (R8/R12 ~120 tok)', async () => {
  const { default: section } = await import('../prompt-sections/cached/active-reference-styles.js');
  assert.equal(section.token_estimate, 1320);
});

test('🛑 cached 段 4 stacking rules: R8 added as tier 1 in stacking note', async () => {
  const { default: section } = await import('../prompt-sections/cached/active-reference-styles.js');
  assert.match(section.content, /R1\/R2\/R7\/R8 為 tier 1/);
});

// ─── engine-1 S6 medium → R1 dispatch ────────────────────

test('🛑 engine-1.js dispatch: S6 medium → R1 inject (sanity smoke)', async () => {
  const { selectSignalInject } = await import('../detector-handlers/engine-1.js');
  const signals = { inject_hints: {
    modal_operator: { intensity: 'medium', groups_matched: ['group_a_should', 'group_b_must'] },
  } };
  const r = selectSignalInject(signals, { primary_mode: 'integration' });
  assert.ok(r.inject, 'expected inject to be non-null');
  assert.match(r.inject, /S6 modal_operator medium → R1/);
  assert.match(r.inject, /『應該』這個字、我想停一下/);
  assert.match(r.inject, /R1 Reclaim Source/);
});

test('engine-1.js dispatch: S6 weak → no inject (flag-only per spec)', async () => {
  const { selectSignalInject } = await import('../detector-handlers/engine-1.js');
  const signals = { inject_hints: {
    modal_operator: { intensity: 'weak', groups_matched: ['group_a_should'] },
  } };
  const r = selectSignalInject(signals, { primary_mode: 'integration' });
  assert.equal(r.inject, null);
});
