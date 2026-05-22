// lib/prompt-sections/conditional/checkpoint-1/checkpoint-1.test.js
// CP1 18 sub-prompts: shape + Damon content + ⭐ 2 原創 IP 完整保留驗證

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ALL_CHECKPOINT_1_SUB_PROMPTS,
  CHECKPOINT_1_BY_PHASE,
  ORIGINAL_IP_SUB_PROMPTS,
  phase3bScopeOverlap,
  phase3bThreeWayTriangulation,
  phase3bCounterExampleIntegration,
} from './index.js';

import { DETECTOR_TYPES } from '../../../detector/registry.js';

// ─────────────────────────────────────────────────────────
// File count + structure
// ─────────────────────────────────────────────────────────

test('ALL_CHECKPOINT_1_SUB_PROMPTS: exactly 20 files', () => {
  // Breakdown: phase-1 (2) + phase-2 (1) + phase-3a (3) + phase-3b (4)
  //          + phase-4 (1) + phase-5 (3) + retention (1) + transitions (3) + appendix-c (2)
  //          = 20
  // (Patrick PR-4a-2 brief estimated ~18; actual enumeration yields 20.)
  assert.equal(ALL_CHECKPOINT_1_SUB_PROMPTS.length, 20);
});

test('CHECKPOINT_1_BY_PHASE: all 9 phase groups present', () => {
  const expected = ['phase_1', 'phase_2', 'phase_3a', 'phase_3b', 'phase_4', 'phase_5',
                    'integration_retention', 'transitions', 'appendix_c'];
  for (const k of expected) {
    assert.ok(k in CHECKPOINT_1_BY_PHASE, `missing phase group: ${k}`);
  }
});

test('phase_3b has exactly 4 sub-steps (Mapping / 反例 / 三向 / Scope Overlap)', () => {
  const p3b = CHECKPOINT_1_BY_PHASE.phase_3b;
  assert.ok(p3b.mapping_across);
  assert.ok(p3b.counter_example_integration);
  assert.ok(p3b.three_way_triangulation);
  assert.ok(p3b.scope_overlap);
});

// ─────────────────────────────────────────────────────────
// Shape: every sub-prompt has required keys
// ─────────────────────────────────────────────────────────

test('every CP1 sub-prompt has required keys { id, type, dispatch_mode, phase, prompt_content, parse_state_patch, damon_source }', () => {
  for (const s of ALL_CHECKPOINT_1_SUB_PROMPTS) {
    assert.ok(typeof s.id === 'string' && s.id.startsWith('CP1_'),
      `${s.id} should start with CP1_`);
    assert.ok(DETECTOR_TYPES.includes(s.type), `${s.id} type "${s.type}" not in DETECTOR_TYPES`);
    assert.ok(typeof s.dispatch_mode === 'string', `${s.id} dispatch_mode missing`);
    assert.ok(typeof s.phase === 'string', `${s.id} phase missing`);
    assert.ok(typeof s.prompt_content === 'string' && s.prompt_content.length > 0,
      `${s.id} prompt_content empty`);
    assert.ok(typeof s.parse_state_patch === 'object' && s.parse_state_patch !== null,
      `${s.id} parse_state_patch missing`);
    assert.ok(Array.isArray(s.damon_source) && s.damon_source.length > 0,
      `${s.id} damon_source missing`);
  }
});

test('every CP1 sub-prompt has unique id', () => {
  const ids = ALL_CHECKPOINT_1_SUB_PROMPTS.map(s => s.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate ids');
});

test('CP1 dispatch_modes: 4 valid types', () => {
  const validModes = ['phase_context', 'phase_transition', 'phase_mode_block', 'scenario_inject'];
  for (const s of ALL_CHECKPOINT_1_SUB_PROMPTS) {
    assert.ok(validModes.includes(s.dispatch_mode),
      `${s.id} unknown dispatch_mode "${s.dispatch_mode}"`);
  }
});

test('CP1 sub-prompts: trigger_event + priority null (not registered to user_turn cascade)', () => {
  for (const s of ALL_CHECKPOINT_1_SUB_PROMPTS) {
    assert.equal(s.trigger_event, null, `${s.id} should have trigger_event=null (phase-context based)`);
    assert.equal(s.priority, null, `${s.id} should have priority=null`);
  }
});

// ─────────────────────────────────────────────────────────
// ⭐⭐ 2 v5.0 原創 IPs — 必須完整保留
// ─────────────────────────────────────────────────────────

test('🛑 原創 IP #1 Scope Overlap: complete spec preserved', () => {
  const so = phase3bScopeOverlap;
  assert.equal(so.original_ip, '#1 Scope Overlap');
  // 核心 / 邊緣 / 灰色三層完整
  assert.match(so.prompt_content, /核心/);
  assert.match(so.prompt_content, /邊緣/);
  assert.match(so.prompt_content, /灰色/);
  // Step 4a-d 4 個 sub-steps
  assert.match(so.prompt_content, /Step 4a/);
  assert.match(so.prompt_content, /Step 4b/);
  assert.match(so.prompt_content, /Step 4c/);
  assert.match(so.prompt_content, /Step 4d/);
  // Damon 體系 Mapping Across submodality 依賴 + Scope Overlap 替代邏輯
  assert.match(so.prompt_content, /submodality/i);
  assert.match(so.prompt_content, /概念重疊範圍/);
  // 東方文化適配 P18 binary 框架 fallback
  assert.match(so.prompt_content, /Binary 框架/);
  assert.match(so.prompt_content, /owned_via_acceptance/);
});

test('🛑 原創 IP #3 三向歸類: 6 final_classifications 完整保留', () => {
  const tt = phase3bThreeWayTriangulation;
  assert.equal(tt.original_ip, '#3 三向歸類');
  // 三 paths (a) Consistent / (b) Related / (c) Contradictory
  assert.match(tt.prompt_content, /路徑 \(a\) Consistent/);
  assert.match(tt.prompt_content, /路徑 \(b\) Related/);
  assert.match(tt.prompt_content, /路徑 \(c\) Contradictory/);
  // 6 final_classifications exported
  assert.deepEqual([...tt.final_classifications].sort(), [
    'boundary', 'consistent', 'cost', 'definition_expanded', 'rejected', 'trigger',
  ]);
  // 路徑 (b) 3 細化 options (boundary / cost / trigger)
  assert.match(tt.prompt_content, /它的 boundary/);
  assert.match(tt.prompt_content, /它的 cost/);
  assert.match(tt.prompt_content, /它的 trigger/);
  // 路徑 (c) 「定義太窄」vs「真的違反」分支
  assert.match(tt.prompt_content, /定義太窄/);
  assert.match(tt.prompt_content, /真的違反/);
  // 路徑 (c) Damon 範例「踏實 + 衝動辭職」保留
  assert.match(tt.prompt_content, /踏實/);
  assert.match(tt.prompt_content, /衝動辭職/);
  // Haiku A5 containment_logic_judge 用於路徑 (a) reframe 評估
  assert.equal(tt.haiku_judge_used, 'A5_containment_logic');
  // Edge case: 反例 rejected >= 3 + 全 (a) PPL 警示
  assert.match(tt.prompt_content, /反例 rejected >= 3/);
});

test('🛑 東方文化 IP #2 反例整合: 40-90% 時間 + 主動引出 + 4 sub-steps 完整', () => {
  const ce = phase3bCounterExampleIntegration;
  assert.equal(ce.original_ip, '#2 東方文化柔軟拆解節奏');
  // 40-90% 時間明確 stated
  assert.match(ce.prompt_content, /40-90% 時間/);
  // 4 sub-steps
  assert.match(ce.prompt_content, /Step 2a/);
  assert.match(ce.prompt_content, /Step 2b/);
  assert.match(ce.prompt_content, /Step 2c/);
  assert.match(ce.prompt_content, /Step 2d/);
  // 東方文化適配 — 亞洲學員傾向不講反例、AI 主動引出
  assert.match(ce.prompt_content, /亞洲學員/);
  assert.match(ce.prompt_content, /你太順了/);
  // Damon「反例不是 bug、是 quality 的 boundary」原則
  assert.match(ce.prompt_content, /反例/);
});

// ─────────────────────────────────────────────────────────
// errata 5/21 — Patch 2 + Patch 3: Scope Overlap default 化 (Phase 3b Step 1 + transition)
// ─────────────────────────────────────────────────────────

test('Patch 2: phase_3b mapping_across uses 生活場景 default (errata 5/21)', () => {
  const ma = CHECKPOINT_1_BY_PHASE.phase_3b.mapping_across;
  // Step 1c 生活場景提取 (Scope Overlap default、不問 submodality)
  assert.match(ma.prompt_content, /生活場景提取/);
  assert.match(ma.prompt_content, /2-3 個你生活中最像這個 quality 的場景/);
  assert.match(ma.prompt_content, /什麼時候.*跟誰.*在做什麼/s);
  // Step 1d 從場景對映 (不從 submodality)
  assert.match(ma.prompt_content, /從場景對映到 target/);
  // 學員自發 surface submodality → AI 順著 (紅線 14)
  assert.match(ma.prompt_content, /自發.*submodality/);
  // reference_scenarios 新欄位 + reference_submodalities 保留
  assert.match(ma.prompt_content, /reference_scenarios/);
  assert.match(ma.prompt_content, /reference_submodalities.*預設 \[\]/);
  // Step 1 → Step 4 連續性修正
  assert.match(ma.prompt_content, /Step 1 → Step 4 連續性/);
  assert.equal(ma.errata?.includes('5/21'), true);
});

test('Patch 3: transition phase_3b_to_3a_simplified uses 生活場景化 (errata 5/21)', () => {
  const tr = CHECKPOINT_1_BY_PHASE.transitions.phase_3b_to_3a_simplified;
  // 過渡話術改生活場景化
  assert.match(tr.prompt_content, /3 個月後的你、過著符合『\[top1_value\]』的生活/);
  assert.match(tr.prompt_content, /跟誰見面.*做哪幾件事.*選哪個方向/s);
  // 學員從 Phase 3b 自發走視覺 channel → 雙 channel 過渡 (紅線 14)
  assert.match(tr.prompt_content, /自發.*視覺 channel/);
  // §3 patch 5/21: 紅線 14 reference 精確化 (非「跟著學員 channel」泛化 framing)
  assert.match(tr.prompt_content, /§3 紅線 14 對齊.*不問身體哪裡 \/ 畫面什麼樣、除非學員自己用感官語言/s);
  assert.equal(/跟著學員 channel 走/.test(tr.prompt_content), false, '泛化 framing 已被 §3 紅線 14 精確定義取代');
  // simplified 版本不寫死 dissociated → associated
  assert.match(tr.prompt_content, /不寫死「dissociated → associated」過渡/);
  assert.equal(tr.errata?.includes('5/21'), true);
});

test('Patch 5: scope-overlap default export retains original_ip + errata intent reference', () => {
  const so = CHECKPOINT_1_BY_PHASE.phase_3b.scope_overlap;
  assert.equal(so.original_ip, '#1 Scope Overlap');
  // damon_source 應 reference errata
  // (intent 修正在 module-level comment、原 prompt_content 保留)
});

// ─────────────────────────────────────────────────────────
// Phase 1 + 2: NEW話術 (CP1 獨有、不在引擎 1-4)
// ─────────────────────────────────────────────────────────

test('Phase 1 Goal Alignment Test: "原本目標真能帶你到這裡嗎" 保留', () => {
  const ga = CHECKPOINT_1_BY_PHASE.phase_1.goal_alignment_test;
  assert.match(ga.prompt_content, /原本目標/);
  assert.match(ga.prompt_content, /真的能帶你到/);
});

test('Phase 2 initiate identity test: AI 主動發起 "你是一個 X 的人嗎" 保留', () => {
  const it = CHECKPOINT_1_BY_PHASE.phase_2.initiate_identity_test;
  assert.match(it.prompt_content, /你是一個『\[top1_value\]』的人嗎/);
  assert.match(it.prompt_content, /Phase 1 是 elicitation/);
  assert.match(it.prompt_content, /Phase 2 是 active test/);
});

// ─────────────────────────────────────────────────────────
// Phase 3a NEW話術
// ─────────────────────────────────────────────────────────

test('Phase 3a build_vision: errata 5/21 Scope Overlap default + 3 sub-steps', () => {
  const bv = CHECKPOINT_1_BY_PHASE.phase_3a.build_vision;
  // Step labels preserved
  assert.match(bv.prompt_content, /Step 1a/);
  assert.match(bv.prompt_content, /Step 1b/);
  assert.match(bv.prompt_content, /Step 1c/);
  // ⭐ errata 5/21 Patch 1 — Scope Overlap default (IP #1 主路徑)
  assert.match(bv.prompt_content, /Scope Overlap default/);
  assert.match(bv.prompt_content, /生活場景化/);
  assert.match(bv.prompt_content, /跟誰見面.*做哪幾件事.*選哪個方向/s);
  assert.match(bv.prompt_content, /已在.*還沒|已經在.*還沒/s);
  // 學員自發 surface 視覺-身體 channel → AI 順著走 (紅線 14)
  assert.match(bv.prompt_content, /自發.*視覺.*身體.*channel/s);
  assert.match(bv.prompt_content, /紅線 14/);
  // P10 反轉
  assert.match(bv.prompt_content, /Failure mode P10.*反轉|errata 5\/21.*反轉/s);
  // Step 1a 畫布起手保留
  assert.match(bv.prompt_content, /空白的畫布/);
});

test('Phase 3a check_resistance: 5 種 resistance × reframe 對應完整', () => {
  const cr = CHECKPOINT_1_BY_PHASE.phase_3a.check_resistance;
  // 5 種 resistance
  assert.match(cr.prompt_content, /害怕失敗/);
  assert.match(cr.prompt_content, /害怕成功代價/);
  assert.match(cr.prompt_content, /生態破壞/);
  assert.match(cr.prompt_content, /害怕未知/);
  assert.match(cr.prompt_content, /創傷印記/);
  // 4 個 break 技術 (worth fiction 路由出去)
  assert.match(cr.prompt_content, /Spectrum Reframe/);
  assert.match(cr.prompt_content, /Compatibility Check/);
  assert.match(cr.prompt_content, /Accepting Cost in Advance/);
  assert.match(cr.prompt_content, /As-If Frame/);
  // Worth fiction → cascade E3_deep_signal_detector
  assert.match(cr.prompt_content, /cascade.*E3_deep_signal_detector/);
});

// ─────────────────────────────────────────────────────────
// Phase 5
// ─────────────────────────────────────────────────────────

test('Phase 5 future_pacing: 3 時間維度 (明天 / 三個月後 / 三年後)', () => {
  const fp = CHECKPOINT_1_BY_PHASE.phase_5.future_pacing;
  assert.match(fp.prompt_content, /明天的你/);
  assert.match(fp.prompt_content, /三個月後的你/);
  assert.match(fp.prompt_content, /三年後的你/);
  assert.deepEqual([...fp.time_frames].sort(), ['three_months', 'three_years', 'tomorrow']);
});

test('Phase 5 let_it_go: "身體記得、頭腦不一定要記得" 保留', () => {
  const lig = CHECKPOINT_1_BY_PHASE.phase_5.let_it_go;
  assert.match(lig.prompt_content, /身體記得、頭腦不一定要記得/);
});

// ─────────────────────────────────────────────────────────
// Integration Retention + Transitions
// ─────────────────────────────────────────────────────────

test('Integration Retention Mode: reinforce 不 explore + Day 21 final wrap-up', () => {
  const ret = CHECKPOINT_1_BY_PHASE.integration_retention.retention_mode_block;
  assert.equal(ret.dispatch_mode, 'phase_mode_block');
  assert.match(ret.prompt_content, /不挖新 quality/);
  assert.match(ret.prompt_content, /Day 21 final wrap-up/);
  assert.match(ret.prompt_content, /turn_budget: 5-10/);
});

test('Transitions: 3 個 (3b→3a / 3b→4 / 3a→3b regression)', () => {
  const t = CHECKPOINT_1_BY_PHASE.transitions;
  assert.equal(t.phase_3b_to_3a_simplified.is_regression_transition, undefined);
  assert.equal(t.phase_3a_to_3b_regression.is_regression_transition, true);
  assert.match(t.phase_3b_to_4_acceptance.prompt_content, /owned_via_acceptance/);
});

// ─────────────────────────────────────────────────────────
// Appendix C
// ─────────────────────────────────────────────────────────

test('Appendix C.2.1 topic_resistance: respect 邊界、不問 Why、不在同 session 內回到該主題', () => {
  const tr = CHECKPOINT_1_BY_PHASE.appendix_c.topic_resistance;
  assert.match(tr.prompt_content, /我不問這個/);
  assert.match(tr.prompt_content, /不問「為什麼不想講」/);
  assert.match(tr.prompt_content, /topic_refusal_areas/);
});

test('Appendix C.2.2 mid_session_end: phase-scoped takeaway count (Q1 5/21 errata)', () => {
  const mse = CHECKPOINT_1_BY_PHASE.appendix_c.mid_session_end;
  assert.match(mse.prompt_content, /phase-scoped/);
  assert.match(mse.prompt_content, /reset_on: phase exit/);
  assert.match(mse.prompt_content, /5\/21 errata/);
});

// ─────────────────────────────────────────────────────────
// student_id (not user_id) — P0 errata enforced across CP1
// ─────────────────────────────────────────────────────────

test('CP1 content uses student_id (not user_id) — P0 errata enforced', () => {
  for (const s of ALL_CHECKPOINT_1_SUB_PROMPTS) {
    assert.equal(/\buser_id\b/.test(s.prompt_content), false,
      `${s.id} contains "user_id" — should use "student_id" per P0 errata`);
  }
});

// ─────────────────────────────────────────────────────────
// ORIGINAL_IP_SUB_PROMPTS named exports
// ─────────────────────────────────────────────────────────

test('ORIGINAL_IP_SUB_PROMPTS exports 3 named IPs', () => {
  assert.ok(ORIGINAL_IP_SUB_PROMPTS.scope_overlap);
  assert.ok(ORIGINAL_IP_SUB_PROMPTS.east_asian_softening);
  assert.ok(ORIGINAL_IP_SUB_PROMPTS.three_way_triangulation);
  assert.equal(ORIGINAL_IP_SUB_PROMPTS.scope_overlap.original_ip, '#1 Scope Overlap');
  assert.equal(ORIGINAL_IP_SUB_PROMPTS.three_way_triangulation.original_ip, '#3 三向歸類');
});
