// lib/prompt-sections/prompt-sections.test.js
// 驗證 export shape + 跟 PR-3c registry 介面相容性
// 25 個檔案: 4 cached + 20 conditional + 1 aggregate index

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CACHED_PREFIX_SECTIONS,
  CACHED_PREFIX_TOKEN_ESTIMATE,
} from './cached/index.js';

import {
  DIRECTLY_REGISTERED_DETECTORS,
  ALL_PROMPT_SECTIONS,
  ENGINE_1_PIPELINE,
  ENGINE_2_PIPELINE,
  ENGINE_3_SUB_ROUTERS,
  ENGINE_4_COMPONENTS,
} from './conditional/index.js';

import {
  DETECTOR_TYPES,
  TRIGGER_EVENTS,
  CASCADE_PRIORITY,
  DetectorRegistry,
} from '../detector/registry.js';

// ─────────────────────────────────────────────────────────
// cached/ 4 段
// ─────────────────────────────────────────────────────────

test('cached prefix: exactly 4 sections in fixed order', () => {
  assert.equal(CACHED_PREFIX_SECTIONS.length, 4);
  assert.equal(CACHED_PREFIX_SECTIONS[0].order, 1);
  assert.equal(CACHED_PREFIX_SECTIONS[1].order, 2);
  assert.equal(CACHED_PREFIX_SECTIONS[2].order, 3);
  assert.equal(CACHED_PREFIX_SECTIONS[3].order, 4);
});

test('cached prefix: last section has cache_breakpoint=true (spec 04 §1)', () => {
  const last = CACHED_PREFIX_SECTIONS[CACHED_PREFIX_SECTIONS.length - 1];
  assert.equal(last.cache_breakpoint, true, 'cache_control: ephemeral 必須標在最後一段');
  assert.equal(last.id, 'active_reference_styles');
});

test('cached prefix: every section has non-empty content + positive token_estimate', () => {
  for (const s of CACHED_PREFIX_SECTIONS) {
    assert.ok(typeof s.content === 'string' && s.content.length > 0, `${s.id} has empty content`);
    assert.ok(typeof s.token_estimate === 'number' && s.token_estimate > 0, `${s.id} bad token_estimate`);
    assert.equal(s.type, 'always_on_cached');
  }
});

test('cached prefix: total token estimate matches spec 04 (~4000)', () => {
  // spec 04 §0: damon 1200 + 5-layer 600 + 4-7-router 1400 + active-ref 800 = 4000
  // I used 1250 + 600 + 1400 + 800 = 4050 — close enough
  assert.ok(CACHED_PREFIX_TOKEN_ESTIMATE >= 3800 && CACHED_PREFIX_TOKEN_ESTIMATE <= 4200,
    `token estimate ${CACHED_PREFIX_TOKEN_ESTIMATE} outside [3800, 4200]`);
});

test('cached: damon-core-philosophy includes 16 紅線', () => {
  const damonCore = CACHED_PREFIX_SECTIONS[0];
  assert.match(damonCore.content, /16 條紅線/);
  assert.match(damonCore.content, /不問「為什麼」/);
  // spot-check key rules
  assert.match(damonCore.content, /付費對等性原則/);
  assert.match(damonCore.content, /擁有這個，對你有什麼重要/);
});

test('cached: five-layer-unwrap includes 5 動作', () => {
  const fiveLayer = CACHED_PREFIX_SECTIONS[1];
  assert.match(fiveLayer.content, /動作 1:指認/);
  assert.match(fiveLayer.content, /動作 2:區分/);
  assert.match(fiveLayer.content, /動作 3:Mirror/);
  assert.match(fiveLayer.content, /動作 4:連結/);
  assert.match(fiveLayer.content, /動作 5:現場 Mirror/);
});

test('cached: four-seven-router covers 5 大塊 (藍圖 / Top 1 / Cascade / Re-imprinting / Parts / 開場)', () => {
  const router = CACHED_PREFIX_SECTIONS[2];
  assert.match(router.content, /4\.7 中央路由器藍圖/);
  assert.match(router.content, /Top 1 判定/);
  assert.match(router.content, /Cascade Down 驗證/);
  assert.match(router.content, /Re-imprinting 訊號清單/);
  assert.match(router.content, /Parts Integration 切換條件/);
  assert.match(router.content, /特殊開場分支/);
});

test('cached: active-reference-styles covers 3 原則 + 5 變體 + gap_days 分級', () => {
  const ref = CACHED_PREFIX_SECTIONS[3];
  assert.match(ref.content, /Damon 引用風格 3 大原則/);
  assert.match(ref.content, /變體 V1/);
  assert.match(ref.content, /變體 V5/);
  assert.match(ref.content, /gap_days 分級處理範本/);
  assert.match(ref.content, /NLP Amnesia/);
});

// ─────────────────────────────────────────────────────────
// conditional/ 20 個 sub-prompts
// ─────────────────────────────────────────────────────────

test('conditional: ALL_PROMPT_SECTIONS has exactly 20 items', () => {
  assert.equal(ALL_PROMPT_SECTIONS.length, 20, 'E1 6 + E2 5 + E3 5 + E4 4 = 20');
});

test('conditional: every section has required keys { id, type, prompt_content, parse_state_patch, inputs_from_state, damon_source }', () => {
  for (const s of ALL_PROMPT_SECTIONS) {
    assert.ok(typeof s.id === 'string' && s.id.length > 0, `bad id: ${JSON.stringify(s.id)}`);
    assert.ok(DETECTOR_TYPES.includes(s.type), `${s.id} type "${s.type}" not in DETECTOR_TYPES`);
    assert.ok(typeof s.prompt_content === 'string', `${s.id} prompt_content not string`);
    assert.ok(typeof s.parse_state_patch === 'object' && s.parse_state_patch !== null,
      `${s.id} parse_state_patch missing`);
    assert.ok(Array.isArray(s.inputs_from_state), `${s.id} inputs_from_state not array`);
    assert.ok(Array.isArray(s.damon_source) && s.damon_source.length > 0,
      `${s.id} damon_source missing`);
  }
});

test('conditional: every section has unique id', () => {
  const ids = ALL_PROMPT_SECTIONS.map(s => s.id);
  const set = new Set(ids);
  assert.equal(set.size, ids.length, 'duplicate ids: ' + JSON.stringify(ids));
});

// ─────────────────────────────────────────────────────────
// PR-3c registry compatibility
// ─────────────────────────────────────────────────────────

test('DIRECTLY_REGISTERED_DETECTORS: all valid registry shapes (each can register with stub handler)', () => {
  const r = new DetectorRegistry({ logger: () => {} });
  for (const det of DIRECTLY_REGISTERED_DETECTORS) {
    const stubbed = { ...det, handler: async () => ({ handled: false }) };
    assert.doesNotThrow(() => r.register(stubbed), `${det.id} failed to register`);
  }
  assert.equal(r.size(), DIRECTLY_REGISTERED_DETECTORS.length);
});

test('user_turn detectors: trigger_event="user_turn" + numeric priority', () => {
  const userTurnDetectors = DIRECTLY_REGISTERED_DETECTORS.filter(d => d.trigger_event === 'user_turn');
  assert.equal(userTurnDetectors.length, 7, 'spec 03 §2: 7-step cascade chain');
  for (const d of userTurnDetectors) {
    assert.equal(typeof d.priority, 'number', `${d.id} priority not number`);
    assert.ok(d.priority >= 1, `${d.id} priority must be >= 1`);
  }
});

test('user_turn priorities match CASCADE_PRIORITY exactly', () => {
  const expected = [
    { id: 'E1_deviation_master_detector',       priority: CASCADE_PRIORITY.E1_deviation_pipeline },
    { id: 'E3_deep_signal_detector',            priority: CASCADE_PRIORITY.E3_deep_signal_detector },
    { id: 'E3_opening_branch_router',           priority: CASCADE_PRIORITY.E3_opening_branch_router },
    { id: 'E3_top1_determination',              priority: CASCADE_PRIORITY.E3_top1_determination },
    { id: 'E3_status_router',                   priority: CASCADE_PRIORITY.E3_status_router },
    { id: 'E3_cascade_down_validator',          priority: CASCADE_PRIORITY.E3_cascade_down_validator },
    { id: 'E2_identity_test_master_detector',   priority: CASCADE_PRIORITY.E2_identity_test_pipeline },
  ];
  for (const e of expected) {
    const det = DIRECTLY_REGISTERED_DETECTORS.find(d => d.id === e.id);
    assert.ok(det, `missing ${e.id}`);
    assert.equal(det.priority, e.priority, `${e.id} priority mismatch (got ${det.priority}, want ${e.priority})`);
  }
});

test('🛑 cascade priority enforces E1 BEFORE E2 (spec 03 §2)', () => {
  const e1 = DIRECTLY_REGISTERED_DETECTORS.find(d => d.id === 'E1_deviation_master_detector');
  const e2 = DIRECTLY_REGISTERED_DETECTORS.find(d => d.id === 'E2_identity_test_master_detector');
  assert.ok(e1.priority < e2.priority, 'E1 偏離治理 must be lower priority number (= higher pri) than E2 身份測試');
});

test('lifecycle detectors: 4 events from E4', () => {
  const eventDetectors = {
    new_session_day:   ENGINE_4_COMPONENTS.day_opening,
    session_end:       ENGINE_4_COMPONENTS.takeaway,
    paired:            ENGINE_4_COMPONENTS.cascade_ref,
    program_milestone: ENGINE_4_COMPONENTS.export,
  };
  for (const [event, det] of Object.entries(eventDetectors)) {
    assert.equal(det.trigger_event, event, `${det.id} trigger_event mismatch`);
    assert.ok(TRIGGER_EVENTS.includes(det.trigger_event));
  }
});

test('paired detector: paired_with set to E3_cascade_down_validator', () => {
  const pairedDet = ENGINE_4_COMPONENTS.cascade_ref;
  assert.equal(pairedDet.trigger_event, 'paired');
  assert.equal(pairedDet.paired_with, 'E3_cascade_down_validator');
});

// ─────────────────────────────────────────────────────────
// Pipeline structure (engine 1 + engine 2)
// ─────────────────────────────────────────────────────────

test('engine 1 pipeline: master + classifier + 4 sub-prompts (E1a/b/c/d)', () => {
  assert.equal(ENGINE_1_PIPELINE.master.id, 'E1_deviation_master_detector');
  assert.equal(ENGINE_1_PIPELINE.classifier.id, 'E1_subtype_classifier');
  assert.ok(ENGINE_1_PIPELINE.sub_prompts.E1a);
  assert.ok(ENGINE_1_PIPELINE.sub_prompts.E1b);
  assert.ok(ENGINE_1_PIPELINE.sub_prompts.E1c);
  assert.ok(ENGINE_1_PIPELINE.sub_prompts.E1d);
});

test('engine 1 pipeline internals point to correct parent', () => {
  assert.equal(ENGINE_1_PIPELINE.classifier.pipeline_parent, 'E1_deviation_master_detector');
  for (const sub of Object.values(ENGINE_1_PIPELINE.sub_prompts)) {
    assert.equal(sub.pipeline_parent, 'E1_subtype_classifier');
  }
});

test('engine 2 pipeline: master + aggregator + 3 sub-prompts', () => {
  assert.equal(ENGINE_2_PIPELINE.master.id, 'E2_identity_test_master_detector');
  assert.equal(ENGINE_2_PIPELINE.aggregator.id, 'E2_aggregator');
  assert.equal(ENGINE_2_PIPELINE.sub_prompts.upgrade.id, 'E2_upgrade_to_owned');
  assert.equal(ENGINE_2_PIPELINE.sub_prompts.stay.id, 'E2_stay_candidate');
  assert.equal(ENGINE_2_PIPELINE.sub_prompts.continue.id, 'E2_continue_elicitation');
});

test('engine 3: 5 sub-routers all standalone (no pipeline_parent)', () => {
  assert.equal(ENGINE_3_SUB_ROUTERS.length, 5);
  for (const router of ENGINE_3_SUB_ROUTERS) {
    assert.equal(router.pipeline_parent, null, `${router.id} should be standalone`);
    assert.equal(router.pipeline_role, 'standalone');
  }
});

test('engine 4: 4 components with different trigger events', () => {
  const events = new Set([
    ENGINE_4_COMPONENTS.day_opening.trigger_event,
    ENGINE_4_COMPONENTS.takeaway.trigger_event,
    ENGINE_4_COMPONENTS.cascade_ref.trigger_event,
    ENGINE_4_COMPONENTS.export.trigger_event,
  ]);
  assert.equal(events.size, 4, 'each E4 component should have distinct trigger_event');
});

// ─────────────────────────────────────────────────────────
// Damon-aligned content spot checks (search & replace did not corrupt content)
// ─────────────────────────────────────────────────────────

test('content uses student_id (not user_id) — P0 errata', () => {
  for (const s of ALL_PROMPT_SECTIONS) {
    assert.equal(/\buser_id\b/.test(s.prompt_content), false,
      `${s.id} contains "user_id" — should be "student_id" per P0 errata`);
  }
});

test('E1c includes "我不喜歡這個答案" (Damon Lucia 親口)', () => {
  assert.match(ENGINE_1_PIPELINE.sub_prompts.E1c.prompt_content, /我不喜歡這個答案/);
});

test('E1d references TECHNIQUE_5_LAYER_UNWRAP cached reference', () => {
  assert.equal(ENGINE_1_PIPELINE.sub_prompts.E1d.cached_reference, 'TECHNIQUE_5_LAYER_UNWRAP');
});

test('E2 master detector includes Quality 詞表 + 身份句結構', () => {
  const masterDet = ENGINE_2_PIPELINE.master;
  assert.ok(masterDet.quality_terms, 'missing quality_terms');
  assert.ok(masterDet.identity_sentence_structures, 'missing identity_sentence_structures');
  // 5 groups in quality_terms
  assert.ok(masterDet.quality_terms.damon_validated.length > 0);
  assert.ok(masterDet.quality_terms.east_asian_adapted.length > 0);
  assert.ok(masterDet.quality_terms.a001_corpus.length > 0);
  // 8 identity sentence structures
  assert.equal(masterDet.identity_sentence_structures.length, 8, '8 身份句結構 (IS1-IS8)');
});

test('E2 quality_terms.blacklist includes Damon-rejected fake qualities', () => {
  const blacklist = ENGINE_2_PIPELINE.master.quality_terms.blacklist;
  assert.ok(blacklist.includes('成功的'), 'blacklist must include 成功的 (external validation trap)');
  assert.ok(blacklist.includes('自律的'), 'blacklist must include 自律的 (self-discipline framework)');
});

test('E3 deep_signal_detector has Haiku A4 trigger + handoff template', () => {
  const deep = ENGINE_3_SUB_ROUTERS.find(d => d.id === 'E3_deep_signal_detector');
  assert.equal(deep.haiku_judge_used, 'A4_depth_signal');
  assert.match(deep.prompt_content, /handoff_escalation/);
  assert.match(deep.prompt_content, /Vivi/);
});

test('E3 top1_determination uses Haiku A5 containment_logic', () => {
  const top1 = ENGINE_3_SUB_ROUTERS.find(d => d.id === 'E3_top1_determination');
  assert.equal(top1.haiku_judge_used, 'A5_containment_logic');
  assert.match(top1.prompt_content, /存在依賴/);
  assert.match(top1.prompt_content, /Linear Thinking Error/);
});

test('E4 day_opening includes 5 variants V1-V5', () => {
  const dayOpen = ENGINE_4_COMPONENTS.day_opening;
  for (const v of ['V1', 'V2', 'V3', 'V4', 'V5']) {
    assert.ok(dayOpen.variants.includes(v));
  }
});

test('E4 export prompt includes 3-段 Markdown structure', () => {
  const exp = ENGINE_4_COMPONENTS.export;
  assert.match(exp.prompt_content, /第一段:你是誰/);
  assert.match(exp.prompt_content, /第二段:對 AI 教練的引導風格指引/);
  assert.match(exp.prompt_content, /第三段:使用說明/);
  // Damon-style guidance in section 2
  assert.match(exp.prompt_content, /不要問我「為什麼」/);
});

// ─────────────────────────────────────────────────────────
// All 7 user_turn detectors register without conflict (E1 deviation + E3 5 routers + E2)
// ─────────────────────────────────────────────────────────

test('🛑 all 7 user_turn detectors register together + listForEvent returns in priority order', () => {
  const r = new DetectorRegistry({ logger: () => {} });
  for (const det of DIRECTLY_REGISTERED_DETECTORS) {
    r.register({ ...det, handler: async () => ({ handled: false }) });
  }
  const userTurnList = r.listForEvent('user_turn');
  assert.equal(userTurnList.length, 7);
  // Verify priority order strictly ascending
  for (let i = 1; i < userTurnList.length; i++) {
    assert.ok(userTurnList[i].priority > userTurnList[i - 1].priority,
      `order broken at idx ${i}: ${JSON.stringify(userTurnList[i - 1])} → ${JSON.stringify(userTurnList[i])}`);
  }
  // First in order = E1 (lowest priority number = highest priority)
  assert.equal(userTurnList[0].id, 'E1_deviation_master_detector');
  // Last = E2
  assert.equal(userTurnList[userTurnList.length - 1].id, 'E2_identity_test_master_detector');
});
