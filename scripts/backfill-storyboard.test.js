// scripts/backfill-storyboard.test.js
// v5.3 件3 backfill (6/12) — runBackfill + composeSignals + formatStudentReport
// mock 測試 (DB / LLM 都 mock; 真跑由 Vivi 在 prod).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseArgs,
  composeSignals,
  formatStudentReport,
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
