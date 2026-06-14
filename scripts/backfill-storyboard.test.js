// scripts/backfill-storyboard.test.js
// v5.3 件3 backfill (6/12) — runBackfill + composeSignals + formatStudentReport
// mock 測試 (DB / LLM 都 mock; 真跑由 Vivi 在 prod).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs,
  composeSignals,
  formatStudentReport,
  summarizeSignals,
  summarizeNullReason,
  backfillOneStudent,
  runBackfill,
} from './backfill-storyboard.js';

// ─── Fixture helpers ──────────────────────────────────────

const STUDENT_A003 = Object.freeze({
  student_id: 'A003',
  active_context_category: 'career',
  active_context_name: '創業',
  active_context_definition: '把代理事業做大',
  sc_journey_evidence: null,
  sc_journey_step: null,
  sc_storyboard: null,
});

const SESSIONS_A003 = Object.freeze([
  {
    id: 'sess-1', day: 3,
    session_state: {
      reframe_invocation_history_in_session: [
        { reframe_id: 'R3', invoked_at_turn: 5, anchor_phrase_if_success: '我那時其實有把事情撐住' },
      ],
    },
  },
  {
    id: 'sess-2', day: 5,
    session_state: {
      reframe_invocation_history_in_session: [
        { reframe_id: 'R2', invoked_at_turn: 8, anchor_phrase_if_success: '我是會撐住的人' },
      ],
    },
  },
  {
    id: 'sess-3', day: 9,
    session_state: {
      reframe_invocation_history_in_session: [
        { reframe_id: 'R1', invoked_at_turn: 12, anchor_phrase_if_success: '我自己說了算' },
      ],
    },
  },
]);

const UPE_A003 = Object.freeze({
  active_context_session_summary: {
    career: {
      surfaced_values: ['被理解', '自由'],
      surfaced_examples: [
        { day: 2, value: '被理解', example: '我跟夥伴把界線講清楚了' },
      ],
    },
  },
  daily_takeaways: [
    { day: 1, term: '勇敢' },
    { day: 4, term: '誠實' },
  ],
});

// Capture deps factory.
function makeDeps(overrides = {}) {
  const logs = [];
  const reports = [];
  const writes = [];
  const brainCalls = [];
  const sovCalls = [];
  const base = {
    dryRun: true,
    log: (m) => logs.push(m),
    report: (b) => reports.push(b),
    listTargets: async () => ['A003'],
    loadStudent: async (id) => id === 'A003' ? STUDENT_A003 : null,
    loadSessions: async () => SESSIONS_A003,
    loadUpe: async () => UPE_A003,
    writeBackfill: async (id, payload) => { writes.push({ id, payload }); },
    genBrainState: async ({ stepNo, evidenceEntries }) => {
      brainCalls.push({ stepNo, evidenceEntries });
      return { description: `brain-state-step-${stepNo}-描述`, quote: evidenceEntries[0]?.quote ?? null };
    },
    genSovereignAction: async ({ stepNo, ctx }) => {
      sovCalls.push({ stepNo, ctx });
      return `主權建議 step ${stepNo}, 領域=${ctx.activeContext.name}。我自己說了算。`;
    },
  };
  const deps = { ...base, ...overrides };
  return { deps, logs, reports, writes, brainCalls, sovCalls };
}

// ═════════════════════════════════════════════════════════
// parseArgs
// ═════════════════════════════════════════════════════════

test('🛑 parseArgs: default = dry-run, no student', () => {
  const a = parseArgs(['node', 'script.js']);
  assert.equal(a.dryRun, true);
  assert.equal(a.studentId, null);
});

test('🛑 parseArgs: --commit flips dryRun=false', () => {
  const a = parseArgs(['node', 'script.js', '--commit']);
  assert.equal(a.dryRun, false);
});

test('🛑 parseArgs: --student <id> picks single learner', () => {
  const a = parseArgs(['node', 'script.js', '--student', 'A003']);
  assert.equal(a.studentId, 'A003');
});

test('🛑 parseArgs: --dry-run overrides --commit (last wins)', () => {
  const a = parseArgs(['node', 'script.js', '--commit', '--dry-run']);
  assert.equal(a.dryRun, true);
});

test('🛑 parseArgs: --report <path>', () => {
  const a = parseArgs(['node', 'script.js', '--report', '/tmp/r.txt']);
  assert.equal(a.reportPath, '/tmp/r.txt');
});

// ═════════════════════════════════════════════════════════
// composeSignals — sessions/UPE shape → signals shape
// ═════════════════════════════════════════════════════════

test('🛑 composeSignals: flattens reframe entries across sessions, attaches day', () => {
  const s = composeSignals(STUDENT_A003, SESSIONS_A003, UPE_A003);
  assert.equal(s.reframeHistory.length, 3);
  assert.deepEqual(s.reframeHistory.map(e => ({ rid: e.reframe_id, day: e.day })),
    [{ rid: 'R3', day: 3 }, { rid: 'R2', day: 5 }, { rid: 'R1', day: 9 }]);
  assert.equal(s.reframeHistory[0].anchor_phrase_if_success, '我那時其實有把事情撐住');
});

test('🛑 composeSignals: reads surfaced_values + examples for active_context_category bucket', () => {
  const s = composeSignals(STUDENT_A003, SESSIONS_A003, UPE_A003);
  assert.deepEqual(s.surfacedValues, ['被理解', '自由']);
  assert.equal(s.surfacedExamples.length, 1);
  assert.equal(s.surfacedExamples[0].example, '我跟夥伴把界線講清楚了');
});

test('🛑 composeSignals: daily_takeaways carried verbatim', () => {
  const s = composeSignals(STUDENT_A003, SESSIONS_A003, UPE_A003);
  assert.deepEqual(s.dailyTakeaways, [
    { day: 1, term: '勇敢' },
    { day: 4, term: '誠實' },
  ]);
});

test('🛑 composeSignals: activeContext name+definition extracted', () => {
  const s = composeSignals(STUDENT_A003, SESSIONS_A003, UPE_A003);
  assert.deepEqual(s.activeContext, { name: '創業', definition: '把代理事業做大' });
});

test('🛑 composeSignals: missing UPE bucket → empty arrays, no crash', () => {
  const s = composeSignals(STUDENT_A003, SESSIONS_A003, null);
  assert.equal(s.surfacedValues.length, 0);
  assert.equal(s.surfacedExamples.length, 0);
  assert.equal(s.dailyTakeaways.length, 0);
});

test('🛑 composeSignals: missing active_context_category → no surfaced buckets (cat=null)', () => {
  const stu = { ...STUDENT_A003, active_context_category: null };
  const s = composeSignals(stu, SESSIONS_A003, UPE_A003);
  assert.equal(s.catKey, null);
  assert.equal(s.surfacedValues.length, 0);
});

test('🛑 composeSignals: session with no reframe history → skipped, no crash', () => {
  const ss = [
    { id: 's1', day: 1, session_state: {} },
    { id: 's2', day: 2, session_state: { reframe_invocation_history_in_session: [
      { reframe_id: 'R3', anchor_phrase_if_success: 'x' },
    ] } },
  ];
  const s = composeSignals(STUDENT_A003, ss, UPE_A003);
  assert.equal(s.reframeHistory.length, 1);
  assert.equal(s.reframeHistory[0].day, 2);
});

// ═════════════════════════════════════════════════════════
// backfillOneStudent — happy path (dry-run)
// ═════════════════════════════════════════════════════════

test('🛑 backfillOneStudent: dry-run A003 happy path — derives 5 steps, calls J2/J3, no DB write, report produced', async () => {
  const { deps, reports, writes, brainCalls, sovCalls } =
    makeDeps({ dryRun: true });
  const result = await backfillOneStudent('A003', deps);
  // No DB write in dry-run.
  assert.equal(writes.length, 0);
  // Report block produced.
  assert.equal(reports.length, 1);
  assert.match(reports[0], /student: A003/);
  // derived: step_2 (longing × 2), step_3 (R3), step_4 (R2), step_6 (R1) — step=6.
  assert.equal(result.derived.step, 6);
  assert.equal(result.derived.evidence.step_2.length, 2);
  assert.equal(result.derived.evidence.step_3.length, 1);
  assert.equal(result.derived.evidence.step_4.length, 1);
  assert.equal(result.derived.evidence.step_6.length, 1);
  assert.equal(result.derived.evidence.step_5.length, 0);
  assert.equal(result.derived.evidence.step_7.length, 0);
  // J2/J3 each called exactly once per populated step (4 populated).
  assert.equal(brainCalls.length, 4);
  assert.equal(sovCalls.length, 4);
  // J3 ctx must include this student's activeContext + surfacedValues + stepEvidence.
  const sov4 = sovCalls.find(c => c.stepNo === 4);
  assert.equal(sov4.ctx.activeContext.name, '創業');
  assert.deepEqual(sov4.ctx.surfacedValues, ['被理解', '自由']);
  assert.equal(sov4.ctx.stepEvidence[0].type, 'identity_claim');
});

test('🛑 backfillOneStudent: --commit writes one UPDATE with full payload', async () => {
  const { deps, reports, writes } = makeDeps({ dryRun: false });
  await backfillOneStudent('A003', deps);
  // No report block in commit mode.
  assert.equal(reports.length, 0);
  // Exactly one UPDATE call per student.
  assert.equal(writes.length, 1);
  assert.equal(writes[0].id, 'A003');
  const p = writes[0].payload;
  // payload shape: keyed evidence + step int + storyboard{module,currentStep,steps}.
  assert.ok(p.sc_journey_evidence.step_4.length === 1);
  assert.equal(p.sc_journey_step, 6);
  assert.equal(p.sc_storyboard.module, 'self');
  assert.equal(p.sc_storyboard.currentStep, 6);
  assert.equal(p.sc_storyboard.steps.step_4.state, 'filled');
  assert.equal(p.sc_storyboard.steps.step_1.state, 'empty');  // pain_surface 留空
});

test('🛑 backfillOneStudent: 不存在的 student_id → skipped, no LLM call, no write', async () => {
  const { deps, writes, brainCalls } = makeDeps({
    loadStudent: async () => null,
    dryRun: false,
  });
  const result = await backfillOneStudent('NOPE', deps);
  assert.equal(result.skipped, 'not-found');
  assert.equal(writes.length, 0);
  assert.equal(brainCalls.length, 0);
});

// ═════════════════════════════════════════════════════════
// 🔴 Safety — high-risk anchor → quote dropped (defence-in-depth)
// ═════════════════════════════════════════════════════════

test('🔴 backfillOneStudent: anchor 含「自殺」 → derived quote=null, type 保留, LLM still called with safe entry', async () => {
  const dangerousSessions = [
    {
      id: 's1', day: 5,
      session_state: {
        reframe_invocation_history_in_session: [
          { reframe_id: 'R2', anchor_phrase_if_success: '有時候我想自殺' },
        ],
      },
    },
  ];
  const { deps, brainCalls, reports } = makeDeps({
    loadSessions: async () => dangerousSessions,
    dryRun: true,
  });
  const result = await backfillOneStudent('A003', deps);
  // Evidence kept, quote dropped to null.
  assert.equal(result.derived.evidence.step_4.length, 1);
  assert.equal(result.derived.evidence.step_4[0].type, 'identity_claim');
  assert.equal(result.derived.evidence.step_4[0].quote, null);
  // J2 received entry with quote=null (safety upstream).
  const j2 = brainCalls.find(c => c.stepNo === 4);
  assert.equal(j2.evidenceEntries[0].quote, null);
  // Report block must NOT contain the raw dangerous string.
  assert.equal(reports[0].includes('自殺'), false,
    '🔴 raw high-risk text must NEVER appear in report');
});

test('🔴 backfillOneStudent: 多種高危詞全攔下 (自殺/想死/輕生/自傷/上吊/跳樓)', async () => {
  const dangerousValues = ['想死的念頭', '輕生', '上吊', '勇敢'];
  const { deps } = makeDeps({
    loadUpe: async () => ({
      active_context_session_summary: {
        career: { surfaced_values: dangerousValues, surfaced_examples: [] },
      },
      daily_takeaways: [],
    }),
    loadSessions: async () => [],
    dryRun: true,
  });
  const result = await backfillOneStudent('A003', deps);
  // 4 longing entries, 3 with quote=null (high-risk) + 1 safe.
  const step2 = result.derived.evidence.step_2;
  assert.equal(step2.length, 4);
  assert.equal(step2.filter(e => e.quote === null).length, 3);
  assert.equal(step2.find(e => e.quote === '勇敢').type, 'longing_surface');
});

// ═════════════════════════════════════════════════════════
// Empty path — no signals → all留白, no LLM call wasted, no DB write
// ═════════════════════════════════════════════════════════

test('🛑 backfillOneStudent: 全空訊號 → 0 LLM call, all steps empty, sc_step=null, no DB write (commit mode)', async () => {
  const { deps, brainCalls, sovCalls, writes } = makeDeps({
    loadSessions: async () => [],
    loadUpe: async () => null,
    dryRun: false,
  });
  const result = await backfillOneStudent('A003', deps);
  assert.equal(brainCalls.length, 0, '0 evidence → 0 brain_state LLM call');
  assert.equal(sovCalls.length, 0, '0 evidence → 0 sovereign_action LLM call');
  assert.equal(result.derived.step, null);
  // Commit mode still writes (the empty payload, locking in the "we ran" state
  // — students that newly receive evidence later will re-derive correctly
  // because chat.js Path A keeps appending).
  assert.equal(writes.length, 1);
  assert.equal(writes[0].payload.sc_journey_step, null);
  // All steps empty.
  for (let n = 1; n <= 7; n++) {
    assert.equal(writes[0].payload.sc_storyboard.steps[`step_${n}`].state, 'empty');
  }
});

// ═════════════════════════════════════════════════════════
// formatStudentReport — 鐵律 #2: 不含 raw 對話
// ═════════════════════════════════════════════════════════

test('🔴 formatStudentReport: contains step/type/quote + LLM-generated text, NO raw conversation markers', () => {
  const derived = {
    step: 4,
    evidence: {
      step_1: [], step_2: [{ type: 'longing_surface', quote: '被理解' }],
      step_3: [], step_4: [{ type: 'identity_claim',  quote: '我是會撐住的人' }],
      step_5: [], step_6: [], step_7: [],
    },
  };
  const generated = {
    step_2: { brain_state: { description: '你開始說出真正想要的。', quote: '被理解' }, sovereign_action: '...我自己說了算。' },
    step_4: { brain_state: { description: '你親口認領自己的身份。', quote: '我是會撐住的人' }, sovereign_action: '...我自己說了算。' },
  };
  const block = formatStudentReport({ studentId: 'A003', derived, generated });
  // Has expected fields.
  assert.match(block, /student: A003/);
  assert.match(block, /sc_journey_step: 4/);
  assert.match(block, /type=longing_surface/);
  assert.match(block, /type=identity_claim/);
  assert.match(block, /我是會撐住的人/);  // OK — this is anchor (not raw chat)
  assert.match(block, /你親口認領自己的身份/);
  // Must NOT contain typical raw-chat markers (e.g. "role:", "user:", "assistant:").
  assert.equal(/role:|user:|assistant:/i.test(block), false,
    'no raw conversation role markers');
});

test('🛑 formatStudentReport: null brain_state / null sovereign_action → clearly marked (留白 transparency)', () => {
  const derived = {
    step: 4,
    evidence: {
      step_1: [], step_2: [], step_3: [],
      step_4: [{ type: 'identity_claim', quote: null }],
      step_5: [], step_6: [], step_7: [],
    },
  };
  const generated = { step_4: { brain_state: null, sovereign_action: null } };
  const block = formatStudentReport({ studentId: 'A003', derived, generated });
  assert.match(block, /brain_state: \(null/);
  assert.match(block, /sovereign_action: \(null/);
});

// ═════════════════════════════════════════════════════════
// runBackfill — orchestration loop
// ═════════════════════════════════════════════════════════

test('🛑 runBackfill: dry-run loops over listTargets, never writes', async () => {
  const { deps, writes, reports } = makeDeps({
    listTargets: async () => ['A001', 'A003', 'A006'],
    loadStudent: async (id) => ({ ...STUDENT_A003, student_id: id }),
    dryRun: true,
  });
  const results = await runBackfill(deps);
  assert.equal(results.length, 3);
  assert.equal(writes.length, 0);
  // 1 leading「mode header」report + 1 per student = 4 blocks.
  assert.equal(reports.length, 4);
  assert.match(reports[0], /mode=DRY-RUN/);
});

// ═════════════════════════════════════════════════════════
// 6/12 — summarizeSignals (純函式, 訊號診斷)
// ═════════════════════════════════════════════════════════

test('🛑 summarizeSignals: 列出 8 個 reframe_id 計數 + 順序固定', () => {
  const s = summarizeSignals({
    reframeHistory: [
      { reframe_id: 'R2' }, { reframe_id: 'R2' },
      { reframe_id: 'R3' },
      { reframe_id: 'R7' },
    ],
    surfacedValues: ['勇敢'],
    surfacedExamples: [],
    dailyTakeaways: [{ day: 1, term: 'x' }],
  });
  // 順序固定 (R1 R1_E R2 R3 R5 R6 R7 R12), 計數正確.
  assert.match(s, /R1×0 R1_E×0 R2×2 R3×1 R5×0 R6×0 R7×1 R12×0/);
  assert.match(s, /reframe entries: 4 筆/);
  assert.match(s, /surfaced_examples: 0 筆/);
  assert.match(s, /surfaced_values:\s*1 筆 \(勇敢\)/);
  assert.match(s, /daily_takeaways:\s*1 筆/);
});

test('🛑 summarizeSignals: empty signals → 0 全列出 (不藏)', () => {
  const s = summarizeSignals({});
  assert.match(s, /reframe entries: 0 筆/);
  assert.match(s, /R1×0 R1_E×0 R2×0 R3×0 R5×0 R6×0 R7×0 R12×0/);
  assert.match(s, /surfaced_examples: 0 筆/);
  assert.match(s, /surfaced_values:\s*0 筆/);
  assert.match(s, /daily_takeaways:\s*0 筆/);
});

test('🛑 summarizeSignals: unmapped reframe_id (R8 / R11) 收進 unmapped 桶 (誠實)', () => {
  const s = summarizeSignals({
    reframeHistory: [
      { reframe_id: 'R2' },
      { reframe_id: 'R8' },
      { reframe_id: 'R11' }, { reframe_id: 'R11' },
    ],
  });
  assert.match(s, /reframe entries: 4 筆/);
  // R2 = 1
  assert.match(s, /R2×1/);
  // unmapped 包 R8 + R11.
  assert.match(s, /unmapped×3 \(R11,R8\)/);
});

test('🛑 summarizeSignals: surfaced_values 多於 5 → 列前 5 + 計數', () => {
  const s = summarizeSignals({
    surfacedValues: ['a','b','c','d','e','f','g'],
  });
  assert.match(s, /surfaced_values:\s*7 筆 \(a, b, c, d, e \.\.\. \(\+2\)\)/);
});

test('🛑 summarizeSignals: null / 非物件 → 安全降級, 不炸', () => {
  assert.match(summarizeSignals(null), /signals 缺/);
  assert.match(summarizeSignals(undefined), /signals 缺/);
  assert.match(summarizeSignals('not obj'), /signals 缺/);
});

// ═════════════════════════════════════════════════════════
// 6/12 — summarizeNullReason (純函式, 抽 generate* log 原因)
// ═════════════════════════════════════════════════════════

test('🛑 summarizeNullReason: 抓最後一條 "→ null" line + strip prefix', () => {
  const r = summarizeNullReason([
    '[sc-storyboard-gen][sovereign_action] step 2 insufficient personalization → null',
  ]);
  assert.match(r, /insufficient personalization → null/);
  // Prefix 已 strip.
  assert.equal(/^\[sc-storyboard-gen\]/.test(r), false);
  // 「step 2」 也 strip (避免外層已印 step_N 又重複).
  assert.equal(/^step 2/.test(r), false);
});

test('🛑 summarizeNullReason: 5 個生成 null path 各驗一次', () => {
  const cases = [
    { in: '[sc-storyboard-gen] LLM call returned no text → null',
      want: /LLM call returned no text/ },
    { in: '[sc-storyboard-gen] LLM call threw: 404 model not found',
      want: /LLM call threw: 404/ },
    { in: '[sc-storyboard-gen] description scrubbed to empty → null',
      want: /description scrubbed to empty/ },
    { in: '[sc-storyboard-gen][sovereign_action] step 3 rigidity-at-self detected → null',
      want: /rigidity-at-self detected/ },
    { in: '[sc-storyboard-gen][sovereign_action] step 4 missing self-control declaration → null',
      want: /missing self-control declaration/ },
  ];
  for (const c of cases) {
    const r = summarizeNullReason([c.in]);
    assert.match(r, c.want, `case "${c.in}" should yield ${c.want}`);
  }
});

test('🛑 summarizeNullReason: 多條 logs → 抓最後相關 (不被前面的 noise 騙)', () => {
  const r = summarizeNullReason([
    '[sc-storyboard-gen] some neutral noise log',
    '[sc-storyboard-gen][sovereign_action] step 2 insufficient personalization → null',
  ]);
  assert.match(r, /insufficient personalization/);
});

test('🛑 summarizeNullReason: 空 / 非陣列 → null', () => {
  assert.equal(summarizeNullReason([]), null);
  assert.equal(summarizeNullReason(null), null);
  assert.equal(summarizeNullReason('str'), null);
});

// ═════════════════════════════════════════════════════════
// 6/12 — formatStudentReport: signals + reasons 整合
// ═════════════════════════════════════════════════════════

test('🛑 formatStudentReport: 有 signals → 開頭印 signals summary block', () => {
  const signals = {
    reframeHistory: [{ reframe_id: 'R3' }, { reframe_id: 'R2' }],
    surfacedValues: ['被理解'],
    surfacedExamples: [{ day: 3, value: 'x', example: 'y' }],
    dailyTakeaways: [],
  };
  const derived = {
    step: null,
    evidence: { step_1: [], step_2: [], step_3: [], step_4: [],
                step_5: [], step_6: [], step_7: [] },
  };
  const block = formatStudentReport({ studentId: 'A003', signals, derived, generated: {} });
  assert.match(block, /signals summary/);
  assert.match(block, /reframe entries: 2 筆/);
  assert.match(block, /R2×1 R3×1/);
  // 在 step blocks 之前 (順序鎖).
  assert.ok(block.indexOf('signals summary') < block.indexOf('── step_1 ──'),
    'signals summary must appear before step blocks');
});

test('🛑 formatStudentReport: 有 reasons → null 行印確切原因 (非 generic 列表)', () => {
  const derived = {
    step: 2,
    evidence: {
      step_1: [], step_2: [{ type: 'longing_surface', quote: '被理解' }],
      step_3: [], step_4: [], step_5: [], step_6: [], step_7: [],
    },
  };
  const generated = { step_2: { brain_state: null, sovereign_action: null } };
  const reasons = {
    'step_2.brain_state': 'description scrubbed to empty → null',
    'step_2.sovereign_action': 'missing self-control declaration → null',
  };
  const block = formatStudentReport({ studentId: 'A003', derived, generated, reasons });
  // 應印確切原因 (不再是 generic 列表).
  assert.match(block, /brain_state: \(null — description scrubbed to empty/);
  assert.match(block, /sovereign_action: \(null — missing self-control declaration/);
  // Generic fallback 應消失 (anti-regression).
  assert.equal(/insufficient personalization \/ rigidity-at-self \/ no internal-control declaration/.test(block), false,
    'generic fallback must NOT appear when specific reason was provided');
});

test('🛑 formatStudentReport: 沒 signals / reasons → 走 generic (向後相容)', () => {
  const derived = {
    step: 2,
    evidence: { step_1: [], step_2: [{ type: 'longing_surface', quote: 'x' }],
                step_3: [], step_4: [], step_5: [], step_6: [], step_7: [] },
  };
  const generated = { step_2: { brain_state: null, sovereign_action: null } };
  // 不傳 signals / reasons.
  const block = formatStudentReport({ studentId: 'A003', derived, generated });
  // 沒 signals summary block.
  assert.equal(/signals summary/.test(block), false);
  // generic null reasons 回來.
  assert.match(block, /LLM fail \/ scrub-empty \/ no-safe-quote/);
  assert.match(block, /insufficient personalization \/ rigidity-at-self/);
});

// ═════════════════════════════════════════════════════════
// 6/12 — backfillOneStudent integration: report 內含 signals + reasons
// ═════════════════════════════════════════════════════════

test('🛑 backfillOneStudent: dry-run report 內含 signals summary + reframe breakdown', async () => {
  const { deps, reports } = makeDeps({ dryRun: true });
  await backfillOneStudent('A003', deps);
  assert.equal(reports.length, 1);
  const r = reports[0];
  // signals summary present.
  assert.match(r, /signals summary/);
  // A003 fixtures have 3 sessions × 1 reframe each (R3, R2, R1) — counts must match.
  assert.match(r, /reframe entries: 3 筆/);
  assert.match(r, /R1×1/);
  assert.match(r, /R2×1/);
  assert.match(r, /R3×1/);
  // surfaced_values printed.
  assert.match(r, /surfaced_values:\s*2 筆 \(被理解, 自由\)/);
});

test('🛑 backfillOneStudent: gen 回 null → reasons capture 確切原因, 印在報告', async () => {
  // Mock gen helpers that USE the supplied log (caller-wins) to emit a structured
  // reason, then return null. backfillOneStudent must capture + thread into report.
  const { deps, reports } = makeDeps({
    dryRun: true,
    genBrainState: async ({ stepNo, log }) => {
      if (typeof log === 'function') {
        log(`[sc-storyboard-gen] description scrubbed to empty → null`);
      }
      return null;
    },
    genSovereignAction: async ({ stepNo, log }) => {
      if (typeof log === 'function') {
        log(`[sc-storyboard-gen][sovereign_action] step ${stepNo} missing self-control declaration → null`);
      }
      return null;
    },
  });
  await backfillOneStudent('A003', deps);
  const r = reports[0];
  // 確切原因印出來 (非 generic).
  assert.match(r, /brain_state: \(null — description scrubbed to empty/);
  assert.match(r, /sovereign_action: \(null — missing self-control declaration/);
});

test('🛑 backfillOneStudent: per-step log capture 不交叉污染 (step_2 vs step_4)', async () => {
  // Different reason per step + per pass. Must be threaded to correct step entry.
  const { deps, reports } = makeDeps({
    dryRun: true,
    // genBrainState 對 step_2 報 A 因, step_4 報 B 因; 都 null.
    genBrainState: async ({ stepNo, log }) => {
      log(`[sc-storyboard-gen] step ${stepNo} reason-bs-step-${stepNo} → null`);
      return null;
    },
    // genSovereignAction: 對 step_4 報 C 因.
    genSovereignAction: async ({ stepNo, log }) => {
      log(`[sc-storyboard-gen][sovereign_action] step ${stepNo} reason-sa-step-${stepNo} → null`);
      return null;
    },
  });
  await backfillOneStudent('A003', deps);
  const r = reports[0];
  // step_2 區塊內應該只看到 reason-bs-step-2 / reason-sa-step-2.
  const step2Block = r.match(/── step_2 ─[\s\S]*?(?=── step_3 ─)/)[0];
  assert.match(step2Block, /reason-bs-step-2/);
  assert.match(step2Block, /reason-sa-step-2/);
  assert.equal(/reason-bs-step-4|reason-sa-step-4/.test(step2Block), false,
    'step_2 must NOT contain step_4 reasons (no cross-step contamination)');
  // 反向也驗.
  const step4Block = r.match(/── step_4 ─[\s\S]*?(?=── step_5 ─)/)[0];
  assert.match(step4Block, /reason-bs-step-4/);
  assert.match(step4Block, /reason-sa-step-4/);
  assert.equal(/reason-bs-step-2|reason-sa-step-2/.test(step4Block), false);
});

test('🔴 鐵律 #2: signals summary 0 raw 對話 markers', async () => {
  const { deps, reports } = makeDeps({ dryRun: true });
  await backfillOneStudent('A003', deps);
  const r = reports[0];
  // 鐵則 #2: 不可有 role: / user: / assistant: markers.
  assert.equal(/\brole:|\buser:|\bassistant:/i.test(r), false,
    'report (含 signals summary) MUST NOT contain conversation role markers');
});

test('🛑 runBackfill: one student error caught, others continue', async () => {
  const { deps, writes } = makeDeps({
    listTargets: async () => ['A001', 'A003'],
    loadStudent: async (id) => {
      if (id === 'A001') throw new Error('synthetic DB error');
      return STUDENT_A003;
    },
    dryRun: false,
  });
  const results = await runBackfill(deps);
  assert.equal(results.length, 2);
  assert.match(results[0].error, /synthetic DB error/);
  assert.ok(results[1].committed);
  assert.equal(writes.length, 1); // only A003 written
});

// ═════════════════════════════════════════════════════════
// 🛑 6/13 Stage D — runObserverPass dep:
//   提供 → observer 結果取代 legacy derive 路徑 (ground truth from messages).
//   formatStudentReport 新增「observer pass」section (sessions/turns/judged/skip_counts).
//   commit 模式 write 的 evidence 用 observer 結果.
//   observer 拋錯 → 走 fall back legacy derive (fail-soft, 不阻塞 backfill).
//   不提供 → fall back 到 legacy derive (back-compat, 既有 51 測未動).
// ═════════════════════════════════════════════════════════

// Canned observer pass output — 對齊 Stage B driver output shape.
function cannedObserverPass(stepEvidence, totals = {}) {
  let sc_journey_step = null;
  for (let n = 7; n >= 1; n--) {
    if (stepEvidence[`step_${n}`]?.length > 0) { sc_journey_step = n; break; }
  }
  return async () => ({
    accumulated: { values: [], owned: [], top1: null, steps_touched: [] },
    step_evidence: {
      step_1: [], step_2: [], step_3: [], step_4: [],
      step_5: [], step_6: [], step_7: [],
      ...stepEvidence,
    },
    sc_journey_step,
    per_session: [],
    totals: {
      sessions_count: 3, turns_observed: 28, judged_count: 24,
      skip_counts: { crisis: 0, high_risk: 0, app_noise: 4, meta_complaint: 0 },
      budget_hit_count: 0, elapsed_ms_total: 5500,
      ...totals,
    },
  });
}

test('🛑 Stage D: runObserverPass 提供 → 取代 legacy derive 結果 (observer 是 ground truth)', async () => {
  // legacy derive 從 reframe history 推出 step 6, observer 卻只看到 step 4.
  // runObserverPass 結果應該贏 — 證明 observer 路徑生效, 不是 legacy fallback.
  const observerEvidence = {
    step_2: [{ type: 'longing_surface', quote: '被理解' }],
    step_4: [{ type: 'identity_claim', quote: '我是會撐住的人' }],
  };
  const { deps, writes, reports, brainCalls } = makeDeps({
    runObserverPass: cannedObserverPass(observerEvidence),
    dryRun: false,
  });
  const result = await backfillOneStudent('A003', deps);
  // ⭐ step=4 (observer), NOT 6 (legacy derive would have given 6).
  assert.equal(result.derived.step, 4,
    'observer 給的 step=4 必須勝過 legacy derive 的 step=6');
  assert.equal(result.derived.evidence.step_2.length, 1);
  assert.equal(result.derived.evidence.step_4.length, 1);
  assert.equal(result.derived.evidence.step_6.length, 0,
    'observer 沒看到 step_6 → 不該有 step_6 evidence (legacy 路徑壓不過 observer)');
  // J2/J3 只對 observer 看到的 2 步呼叫.
  assert.equal(brainCalls.length, 2);
  assert.deepEqual(brainCalls.map(c => c.stepNo).sort(), [2, 4]);
  // commit 寫進的 evidence 是 observer 的.
  assert.equal(writes[0].payload.sc_journey_step, 4);
  assert.equal(writes[0].payload.sc_storyboard.steps.step_6.state, 'empty');
});

test('🛑 Stage D: dryRun 報告新增 observer pass section (sessions/turns/judged/skip_counts)', async () => {
  const { deps, reports } = makeDeps({
    runObserverPass: cannedObserverPass(
      { step_3: [{ type: 'data_mining', quote: '撐住' }] },
      {
        sessions_count: 12, turns_observed: 240, judged_count: 210,
        skip_counts: { crisis: 5, high_risk: 2, app_noise: 18, meta_complaint: 5 },
        budget_hit_count: 1, elapsed_ms_total: 28000,
      },
    ),
    dryRun: true,
  });
  await backfillOneStudent('A003', deps);
  const block = reports[0];
  assert.match(block, /── observer pass ─/);
  assert.match(block, /sessions:\s+12/);
  assert.match(block, /turns observed:\s+240/);
  assert.match(block, /judged \(LLM\):\s+210/);
  assert.match(block, /crisis=5\s+high_risk=2\s+app_noise=18\s+meta_complaint=5/);
  assert.match(block, /soft-budget hit:\s+1/);
  assert.match(block, /elapsed_ms total:\s+28000/);
});

test('🛑 Stage D: A006 危機 — observer pass section 顯示 crisis skip count', async () => {
  // A006 是 12 天 SI 案. observer pass 計算的 crisis skip 必須誠實 surface 給
  // Vivi 後台看 (才知道哪些 turn 被 pre-LLM gate 擋掉, 安全動作 visible).
  const { deps, reports } = makeDeps({
    loadStudent: async (id) => ({ ...STUDENT_A003, student_id: id }),  // accept A006
    runObserverPass: cannedObserverPass(
      { step_2: [{ type: 'longing_surface', quote: '被需要' }] },
      { sessions_count: 12, turns_observed: 200, judged_count: 150,
        skip_counts: { crisis: 35, high_risk: 8, app_noise: 7, meta_complaint: 0 } },
    ),
    dryRun: true,
  });
  await backfillOneStudent('A006', deps);
  const block = reports[0];
  assert.match(block, /crisis=35/);
  assert.match(block, /high_risk=8/);
  // 報告本身不可有 SI 詞 (鐵律 #2).
  for (const word of ['想死', '自殺', '輕生', '上吊', '跳樓']) {
    assert.equal(block.includes(word), false,
      `report MUST NOT contain raw SI keyword "${word}"`);
  }
});

test('🛑 Stage D: observer 拋錯 → fall back 到 legacy derive (fail-soft, 不阻塞 backfill)', async () => {
  const { deps, logs, writes } = makeDeps({
    runObserverPass: async () => { throw new Error('observer-down'); },
    dryRun: false,
  });
  const result = await backfillOneStudent('A003', deps);
  // 仍走完 → 寫入 (legacy derive 結果, step=6).
  assert.equal(result.derived.step, 6, 'fall back legacy derive should produce step=6');
  assert.equal(writes.length, 1);
  // 有 log 標明 fall back 原因.
  assert.ok(logs.some(m => /observer pass threw/.test(m)),
    'fall back 必須 log 「observer pass threw」 訊息');
});

test('🛑 Stage D: observer 回 null evidence → fall back legacy derive (defensive)', async () => {
  const { deps, logs, writes } = makeDeps({
    runObserverPass: async () => null,   // ← null result
    dryRun: false,
  });
  const result = await backfillOneStudent('A003', deps);
  assert.equal(result.derived.step, 6);
  assert.equal(writes.length, 1);
  assert.ok(logs.some(m => /observer pass returned no evidence/.test(m)));
});

test('🛑 Stage D: runObserverPass 收到 { studentId, sessions } 簽名', async () => {
  let receivedArgs = null;
  const { deps } = makeDeps({
    runObserverPass: async (args) => {
      receivedArgs = args;
      return { step_evidence: { step_1: [], step_2: [], step_3: [], step_4: [],
                                step_5: [], step_6: [], step_7: [] },
               sc_journey_step: null,
               totals: { sessions_count: 0, turns_observed: 0, judged_count: 0,
                         skip_counts: { crisis: 0, high_risk: 0, app_noise: 0, meta_complaint: 0 },
                         budget_hit_count: 0, elapsed_ms_total: 0 } };
    },
    dryRun: true,
  });
  await backfillOneStudent('A003', deps);
  assert.equal(receivedArgs.studentId, 'A003');
  assert.equal(Array.isArray(receivedArgs.sessions), true);
  assert.equal(receivedArgs.sessions.length, SESSIONS_A003.length);
});
