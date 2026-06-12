// api/sc-storyboard.test.js
// v5.3 件3 PR-J1 — 頁 Y endpoint 骨架 + v2 對齊契約 tests.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, {
  _setSqlClient, buildScStoryboardSteps, SC_STORYBOARD_STEPS,
} from './sc-storyboard.js';
import { _setStudentSessionReader } from '../lib/auth/student-session.js';
import { _setCoachSessionReader }   from '../lib/auth/coach-session.js';

// ── mocks ────────────────────────────────────────────────────

function mockReq({ method = 'GET', query = {} } = {}) {
  return { method, query, headers: {}, body: {} };
}
function mockRes() {
  const r = {
    statusCode: 200, body: null,
    status(s) { r.statusCode = s; return r; },
    json(b)   { r.body = b; return r; },
  };
  return r;
}

function makeMockSql(planFn) {
  const calls = [];
  const fn = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    return Promise.resolve(planFn ? planFn(text, values) : []);
  };
  fn.calls = calls;
  return fn;
}

const STUDENT_SESSION_FOR = (sid) => async () => ({ role: 'student', sid });
const COACH_OK   = async () => ({ role: 'coach' });
const NO_SESSION = async () => null;

beforeEach(() => {
  _setStudentSessionReader(null);
  _setCoachSessionReader(null);
  _setSqlClient(null);
  process.env.SESSION_SECRET = 'test-secret-32-bytes-of-entropy-aaaaaaaa';
  process.env.DATABASE_URL   = 'postgresql://test:test@test.example.com/test';
});

// ═════════════════════════════════════════════════════════
// Method gate
// ═════════════════════════════════════════════════════════

test('🛑 PR-J1: POST → 405 Method not allowed', async () => {
  const res = mockRes();
  await handler(mockReq({ method: 'POST' }), res);
  assert.equal(res.statusCode, 405);
});

test('🛑 PR-J1: PATCH → 405 (method gate strict)', async () => {
  const res = mockRes();
  await handler(mockReq({ method: 'PATCH' }), res);
  assert.equal(res.statusCode, 405);
});

// ═════════════════════════════════════════════════════════
// Auth — student path (cookie-only, ?studentId 忽略)
// ═════════════════════════════════════════════════════════

test('🛑 PR-J1 auth: student path, no session → 401', async () => {
  _setStudentSessionReader(NO_SESSION);
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 401);
});

test('🛑 PR-J1 auth: student path IGNORES ?studentId (鐵則 — cookie only)', async () => {
  // Browser also logged in as A001, but query says A002 — sid must come
  // from cookie (A001), query string ignored.
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  const sql = makeMockSql((text, values) => {
    if (/SELECT sc_journey_step/.test(text)) {
      return [{ sc_journey_step: 3, sc_journey_evidence: { step_1: [], step_2: [], step_3: [{ type: 'data_mining' }], step_4: [], step_5: [], step_6: [], step_7: [] } }];
    }
    return [];
  });
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ query: { studentId: 'A002' } }), res);
  assert.equal(res.statusCode, 200);
  // SQL called with A001 (from cookie), NOT A002 (query).
  const selectCall = sql.calls.find(c => /SELECT sc_journey_step/.test(c.text));
  assert.ok(selectCall);
  assert.ok(selectCall.values.includes('A001'),
    'student path: studentId from cookie session, ?studentId query ignored');
  assert.equal(selectCall.values.includes('A002'), false);
});

// ═════════════════════════════════════════════════════════
// Auth — coach path (?studentId required)
// ═════════════════════════════════════════════════════════

test('🛑 PR-J1 auth: coach path, no coach session → 401', async () => {
  _setCoachSessionReader(NO_SESSION);
  const res = mockRes();
  await handler(mockReq({ query: { audience: 'coach', studentId: 'A001' } }), res);
  assert.equal(res.statusCode, 401);
});

test('🛑 PR-J1 auth: coach path + valid coach session, no ?studentId → 400', async () => {
  _setCoachSessionReader(COACH_OK);
  const res = mockRes();
  await handler(mockReq({ query: { audience: 'coach' } }), res);
  assert.equal(res.statusCode, 400);
  assert.match(String(res.body?.error || ''), /studentId/);
});

test('🛑 PR-J1 auth: coach path + valid session + ?studentId=A002 → 200, reads A002', async () => {
  _setCoachSessionReader(COACH_OK);
  // Even if student-session ALSO present (coach browsing while logged in
  // as their own learner), coach path must read query studentId.
  _setStudentSessionReader(STUDENT_SESSION_FOR('A099'));
  const sql = makeMockSql(() => [{
    sc_journey_step: null,
    sc_journey_evidence: null,
  }]);
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq({ query: { audience: 'coach', studentId: 'A002' } }), res);
  assert.equal(res.statusCode, 200);
  const selectCall = sql.calls.find(c => /SELECT sc_journey_step/.test(c.text));
  assert.ok(selectCall.values.includes('A002'),
    'coach path: studentId from query, student-session IGNORED');
  assert.equal(selectCall.values.includes('A099'), false);
});

// ═════════════════════════════════════════════════════════
// Contract shape (strict — v2 aligned, locked by Patrick)
// ═════════════════════════════════════════════════════════

test('🛑 PR-J1 contract: top-level keys = exactly {module, currentStep, steps}', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql(() => [{ sc_journey_step: null, sc_journey_evidence: null }]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  const keys = Object.keys(res.body).sort();
  assert.deepEqual(keys, ['currentStep', 'module', 'steps'],
    'contract: top-level = {module, currentStep, steps} ONLY');
});

test('🛑 PR-J1 contract: response does NOT contain safety_flag / reviewed_by_coach / turning_lines / lines', async () => {
  // v2 拍板: these fields are NOT in the public contract.
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql(() => [{
    sc_journey_step: 4,
    sc_journey_evidence: {
      step_1: [{ type: 'pain_surface', quote: 'x' }],
      step_2: [], step_3: [], step_4: [{ type: 'identity_claim', quote: 'x' }],
      step_5: [], step_6: [], step_7: [],
    },
  }]));
  const res = mockRes();
  await handler(mockReq(), res);
  const json = JSON.stringify(res.body);
  assert.equal(/safety_flag/.test(json), false,
    'safety_flag is internal LLM weight, MUST NOT appear in response');
  assert.equal(/reviewed_by_coach/.test(json), false,
    'reviewed_by_coach 廢除 (v2)');
  assert.equal(/turning_lines/.test(json), false,
    'turning_lines 廢除 (v2)');
  // "lines[]" — match exact array-style field, not the literal "lines" substring
  // in things like step name "Damon Cart 7-lines model" which we DON'T have here.
  assert.equal(/"lines"\s*:/.test(json), false,
    'lines[] 廢除 (v2)');
});

test('🛑 PR-J1 contract: steps[] = exactly 7, fixed order + locked identity', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql(() => [{ sc_journey_step: null, sc_journey_evidence: null }]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.body.steps.length, 7);
  // Order locked verbatim per spec.
  const expected = [
    { no: '01', name_zh: '發現匱乏',   name_en: 'The Void' },
    { no: '02', name_zh: '承認渴望',   name_en: 'The Longing' },
    { no: '03', name_zh: '挖掘數據',   name_en: 'Mining the Database' },
    { no: '04', name_zh: '認領身份',   name_en: 'Claiming the Identity' },
    { no: '05', name_zh: '發現資源',   name_en: 'Resource Retrieval' },
    { no: '06', name_zh: '奪回裁判權', name_en: 'Reclaiming the Sovereignty' },
    { no: '07', name_zh: '標籤定錨',   name_en: 'Anchoring the Concept' },
  ];
  for (let i = 0; i < 7; i++) {
    assert.equal(res.body.steps[i].no,      expected[i].no);
    assert.equal(res.body.steps[i].name_zh, expected[i].name_zh);
    assert.equal(res.body.steps[i].name_en, expected[i].name_en);
  }
});

test('🛑 PR-J1 contract: each step = exactly {no, name_zh, name_en, state, brain_state, sovereign_action}', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql(() => [{ sc_journey_step: null, sc_journey_evidence: null }]));
  const res = mockRes();
  await handler(mockReq(), res);
  for (const step of res.body.steps) {
    const keys = Object.keys(step).sort();
    assert.deepEqual(keys, ['brain_state', 'name_en', 'name_zh', 'no', 'sovereign_action', 'state'],
      'per-step keys locked');
  }
});

test('🛑 PR-J1 contract: brain_state + sovereign_action ALWAYS null in J1 (J2/J3 fill later)', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql(() => [{
    sc_journey_step: 7,
    sc_journey_evidence: {
      step_1: [{ type: 'pain_surface' }], step_2: [{ type: 'longing_surface' }],
      step_3: [{ type: 'data_mining' }],  step_4: [{ type: 'identity_claim' }],
      step_5: [{ type: 'resource_retrieval' }], step_6: [{ type: 'sovereignty_reclaim' }],
      step_7: [{ type: 'anchoring' }],
    },
  }]));
  const res = mockRes();
  await handler(mockReq(), res);
  for (const step of res.body.steps) {
    assert.equal(step.brain_state,      null, `${step.no} brain_state must be null in PR-J1`);
    assert.equal(step.sovereign_action, null, `${step.no} sovereign_action must be null in PR-J1`);
  }
});

// ═════════════════════════════════════════════════════════
// state derivation (empty / filled by evidence keyed object)
// ═════════════════════════════════════════════════════════

test('🛑 PR-J1 state: evidence[step_N] non-empty → state="filled"', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql(() => [{
    sc_journey_step: 3,
    sc_journey_evidence: {
      step_1: [{ type: 'pain_surface',    quote: 'x' }],
      step_2: [],
      step_3: [{ type: 'data_mining',     quote: 'x' }, { type: 'data_mining', quote: 'y' }],
      step_4: [],
      step_5: [{ type: 'resource_retrieval', quote: 'x' }],
      step_6: [],
      step_7: [],
    },
  }]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.body.steps[0].state, 'filled', 'step_1 non-empty → filled');
  assert.equal(res.body.steps[1].state, 'empty',  'step_2 empty → empty');
  assert.equal(res.body.steps[2].state, 'filled', 'step_3 non-empty → filled');
  assert.equal(res.body.steps[3].state, 'empty',  'step_4 empty');
  assert.equal(res.body.steps[4].state, 'filled', 'step_5 non-empty');
  assert.equal(res.body.steps[5].state, 'empty',  'step_6 empty');
  assert.equal(res.body.steps[6].state, 'empty',  'step_7 empty');
});

test('🛑 PR-J1 state: evidence null / missing → all 7 steps state="empty"', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql(() => [{ sc_journey_step: null, sc_journey_evidence: null }]));
  const res = mockRes();
  await handler(mockReq(), res);
  for (const step of res.body.steps) {
    assert.equal(step.state, 'empty');
  }
});

// ═════════════════════════════════════════════════════════
// currentStep = sc_journey_step (null OR 1..7)
// ═════════════════════════════════════════════════════════

test('🛑 PR-J1 currentStep: sc_journey_step=null → currentStep=null', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql(() => [{ sc_journey_step: null, sc_journey_evidence: null }]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.body.currentStep, null);
});

test('🛑 PR-J1 currentStep: sc_journey_step=4 → currentStep=4', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql(() => [{ sc_journey_step: 4, sc_journey_evidence: null }]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.body.currentStep, 4);
});

test('🛑 PR-J1 currentStep: out-of-range step (e.g. 8) → currentStep=null (defensive)', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql(() => [{ sc_journey_step: 8, sc_journey_evidence: null }]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.body.currentStep, null);
});

// ═════════════════════════════════════════════════════════
// fail-soft: DB read fails → 200 with empty skeleton
// ═════════════════════════════════════════════════════════

test('🛑 PR-J1 fail-soft: SQL throws → 200 + currentStep=null + all empty', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(() => Promise.reject(new Error('column does not exist')));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200,
    'fail-soft: DB read failure (e.g. col missing) MUST NOT 500');
  assert.equal(res.body.currentStep, null);
  assert.equal(res.body.steps.length, 7);
  for (const step of res.body.steps) {
    assert.equal(step.state, 'empty');
  }
});

test('🛑 PR-J1 fail-soft: student row absent (0 rows) → 200 + currentStep=null + empty', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A999'));
  _setSqlClient(makeMockSql(() => []));   // no row
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.currentStep, null);
});

// ═════════════════════════════════════════════════════════
// module default + override
// ═════════════════════════════════════════════════════════

test('🛑 PR-J1: module default = "self"', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql(() => [{ sc_journey_step: null, sc_journey_evidence: null }]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.body.module, 'self');
});

test('🛑 PR-J1: ?module=money → echoed as-is', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(makeMockSql(() => [{ sc_journey_step: null, sc_journey_evidence: null }]));
  const res = mockRes();
  await handler(mockReq({ query: { module: 'money' } }), res);
  assert.equal(res.body.module, 'money');
});

// ═════════════════════════════════════════════════════════
// Pure helper unit tests
// ═════════════════════════════════════════════════════════

test('🛑 PR-J1 pure: buildScStoryboardSteps(null) → 7 empty steps', () => {
  const out = buildScStoryboardSteps(null);
  assert.equal(out.length, 7);
  for (const s of out) {
    assert.equal(s.state, 'empty');
    assert.equal(s.brain_state, null);
    assert.equal(s.sovereign_action, null);
  }
});

test('🛑 PR-J1 pure: buildScStoryboardSteps respects keyed-object evidence', () => {
  const out = buildScStoryboardSteps({
    step_1: [], step_2: [{ type: 'longing_surface', quote: 'x' }],
    step_3: [], step_4: [], step_5: [], step_6: [], step_7: [],
  });
  assert.equal(out[0].state, 'empty');
  assert.equal(out[1].state, 'filled');
  assert.equal(out[2].state, 'empty');
});

test('🛑 PR-J1 pure: malformed evidence (array / wrong shape) → all empty (defensive)', () => {
  assert.equal(buildScStoryboardSteps([]).every(s => s.state === 'empty'),         true);
  assert.equal(buildScStoryboardSteps('string').every(s => s.state === 'empty'),  true);
  assert.equal(buildScStoryboardSteps(42).every(s => s.state === 'empty'),        true);
});

test('🛑 PR-J1 pure: SC_STORYBOARD_STEPS is frozen + 7 entries', () => {
  assert.equal(Object.isFrozen(SC_STORYBOARD_STEPS), true);
  assert.equal(SC_STORYBOARD_STEPS.length, 7);
});

// ═════════════════════════════════════════════════════════
// 🔴 ship-gate sanity: no UPDATE / INSERT (pure read)
// ═════════════════════════════════════════════════════════

test('🛑 PR-J1 ship-gate: handler source contains NO UPDATE/INSERT (pure read)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync('api/sc-storyboard.js', 'utf8');
  assert.equal(/\bUPDATE\s+students/i.test(src), false,
    'PR-J1 is pure read — must not write to students');
  assert.equal(/\bINSERT\s+INTO/i.test(src),     false,
    'PR-J1 is pure read — must not insert');
});

// ═════════════════════════════════════════════════════════
// 🛑 v5.3 件3 PR-J2 — brain_state wire (read sc_storyboard col)
// ═════════════════════════════════════════════════════════

test('🛑 PR-J2 endpoint: SELECT pulls sc_storyboard column', async () => {
  const calls = [];
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient((strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    return Promise.resolve([{
      sc_journey_step: null, sc_journey_evidence: null, sc_storyboard: null,
    }]);
  });
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  assert.match(calls[0].text, /SELECT sc_journey_step, sc_journey_evidence, sc_storyboard/);
});

test('🛑 PR-J2 endpoint: precomputed brain_state in DB → surfaced in response', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(() => Promise.resolve([{
    sc_journey_step: 4,
    sc_journey_evidence: {
      step_1: [], step_2: [],
      step_3: [{ type: 'data_mining', quote: '某 term' }],
      step_4: [{ type: 'identity_claim', quote: '勇敢' }],
      step_5: [], step_6: [], step_7: [],
    },
    sc_storyboard: {
      step_3: {
        brain_state: {
          description: '那段日子,你開始翻找過去的微小證據。',
          quote: '某 term',
        },
        sovereign_action: null,
      },
      step_4: {
        brain_state: {
          description: '你開始說出「我是這樣的人」。',
          quote: '勇敢',
        },
        sovereign_action: null,
      },
    },
  }]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  // step_3 (idx 2) has brain_state wired.
  assert.ok(res.body.steps[2].brain_state);
  assert.equal(res.body.steps[2].brain_state.description, '那段日子,你開始翻找過去的微小證據。');
  assert.equal(res.body.steps[2].brain_state.quote, '某 term');
  // step_4 (idx 3) has brain_state wired.
  assert.ok(res.body.steps[3].brain_state);
  assert.match(res.body.steps[3].brain_state.description, /我是這樣的人/);
  assert.equal(res.body.steps[3].brain_state.quote, '勇敢');
  // step_5..7 still null (no evidence + no storyboard).
  assert.equal(res.body.steps[4].brain_state, null);
});

test('🛑 PR-J2 endpoint: empty step → brain_state null even if sc_storyboard has dirty data', async () => {
  // Defense-in-depth: if storyboard column got polluted (e.g. test fixture or
  // back-fill), empty steps must NOT surface brain_state.
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(() => Promise.resolve([{
    sc_journey_step: null,
    sc_journey_evidence: null,
    sc_storyboard: {
      step_3: { brain_state: { description: 'leaked', quote: 'x' } },
    },
  }]));
  const res = mockRes();
  await handler(mockReq(), res);
  // step_3 (idx 2) is empty (no evidence) → brain_state stays null.
  assert.equal(res.body.steps[2].state, 'empty');
  assert.equal(res.body.steps[2].brain_state, null,
    '🔴 ship-gate: empty step → brain_state null regardless of storyboard contents');
});

test('🛑 PR-J2 endpoint: brain_state contract = {description, quote} ONLY', async () => {
  // PR-J3 will add sovereign_action — but brain_state's own shape stays
  // strict {description, quote}. Reject any extra fields polluting the column.
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(() => Promise.resolve([{
    sc_journey_step: 4,
    sc_journey_evidence: { step_1: [], step_2: [], step_3: [], step_4: [{ type: 'identity_claim' }], step_5: [], step_6: [], step_7: [] },
    sc_storyboard: {
      step_4: {
        brain_state: {
          description: '描述。',
          quote: '某 quote',
          extra_field: 'should not leak',
          safety_flag: 'green',
          internal_metadata: { whatever: 1 },
        },
      },
    },
  }]));
  const res = mockRes();
  await handler(mockReq(), res);
  const bs = res.body.steps[3].brain_state;
  assert.ok(bs);
  // Strict key set — only description + quote.
  assert.deepEqual(Object.keys(bs).sort(), ['description', 'quote']);
  // No safety_flag leak.
  assert.equal('safety_flag'      in bs, false);
  assert.equal('extra_field'      in bs, false);
  assert.equal('internal_metadata' in bs, false);
});

test('🛑 PR-J2 endpoint: malformed brain_state in DB (missing description) → null', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(() => Promise.resolve([{
    sc_journey_step: 4,
    sc_journey_evidence: { step_1: [], step_2: [], step_3: [], step_4: [{ type: 'identity_claim' }], step_5: [], step_6: [], step_7: [] },
    sc_storyboard: {
      step_4: { brain_state: { quote: '只有 quote 沒 description' } },  // malformed
    },
  }]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.body.steps[3].brain_state, null,
    'missing description → fall back to null (don\'t surface partial)');
});

test('🛑 PR-J2 endpoint: quote=null preserved (留白 — 無安全句)', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(() => Promise.resolve([{
    sc_journey_step: 1,
    sc_journey_evidence: { step_1: [{ type: 'pain_surface' }], step_2: [], step_3: [], step_4: [], step_5: [], step_6: [], step_7: [] },
    sc_storyboard: {
      step_1: {
        brain_state: {
          description: '那段日子,你心裡空了一塊。',
          quote: null,  // pickSafeQuote returned null (all high-risk filtered)
        },
      },
    },
  }]));
  const res = mockRes();
  await handler(mockReq(), res);
  const bs = res.body.steps[0].brain_state;
  assert.ok(bs);
  assert.match(bs.description, /那段日子/);
  assert.equal(bs.quote, null,
    'quote=null preserved when no safe quote was available (留白)');
});

test('🛑 PR-J2 endpoint: sc_storyboard null / missing → still 200 + brain_state null', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  // Pre-PR-J2-deploy: column doesn't exist. SQL throws → fail-soft kicks in.
  _setSqlClient(() => Promise.reject(new Error('column sc_storyboard does not exist')));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  for (const step of res.body.steps) {
    assert.equal(step.brain_state, null);
    assert.equal(step.state, 'empty');
  }
});

// ═════════════════════════════════════════════════════════
// 🛑 PR-J2 pure: buildScStoryboardSteps with storyboard param
// ═════════════════════════════════════════════════════════

test('🛑 PR-J2 pure: buildScStoryboardSteps(evidence, storyboard) wires brain_state', async () => {
  const { buildScStoryboardSteps } = await import('./sc-storyboard.js');
  const evidence = {
    step_1: [], step_2: [{ type: 'longing_surface', quote: 'x' }],
    step_3: [], step_4: [], step_5: [], step_6: [], step_7: [],
  };
  const storyboard = {
    step_2: { brain_state: { description: 'desc', quote: 'q' } },
  };
  const out = buildScStoryboardSteps(evidence, storyboard);
  assert.equal(out[0].brain_state, null,  'step_1 empty + no storyboard → null');
  assert.deepEqual(out[1].brain_state, { description: 'desc', quote: 'q' });
  assert.equal(out[2].brain_state, null);
});

test('🛑 PR-J2 pure: buildScStoryboardSteps backward-compat with single-arg call', async () => {
  // J1 callers (any) that don't pass storyboard must still work.
  const { buildScStoryboardSteps } = await import('./sc-storyboard.js');
  const out = buildScStoryboardSteps({
    step_1: [{ type: 'pain_surface' }], step_2: [], step_3: [], step_4: [], step_5: [], step_6: [], step_7: [],
  });
  assert.equal(out[0].state, 'filled');
  assert.equal(out[0].brain_state, null,
    'single-arg call (no storyboard) → brain_state stays null (J1 contract preserved)');
});

// ═════════════════════════════════════════════════════════
// 🛑 v5.3 件3 PR-J3 — sovereign_action wire (read sc_storyboard col)
// ═════════════════════════════════════════════════════════

test('🛑 PR-J3 endpoint: precomputed sovereign_action surfaces as plain string', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(() => Promise.resolve([{
    sc_journey_step: 4,
    sc_journey_evidence: {
      step_1: [], step_2: [], step_3: [],
      step_4: [{ type: 'identity_claim', quote: '勇敢' }],
      step_5: [], step_6: [], step_7: [],
    },
    sc_storyboard: {
      step_4: {
        brain_state: { description: '你開始說出我是這樣的人。', quote: '勇敢' },
        sovereign_action: '針對你的伴侶關係,你拿回主動權。我自己說了算。',
      },
    },
  }]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.steps[3].sovereign_action, '針對你的伴侶關係,你拿回主動權。我自己說了算。');
  // brain_state should also still be there (J2 wire intact).
  assert.ok(res.body.steps[3].brain_state);
  assert.equal(res.body.steps[3].brain_state.quote, '勇敢');
});

test('🛑 PR-J3 endpoint: 🔴 empty step → sovereign_action null even if storyboard polluted', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(() => Promise.resolve([{
    sc_journey_step: null,
    sc_journey_evidence: null,
    sc_storyboard: {
      step_4: { sovereign_action: 'this should NOT leak' },
    },
  }]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.body.steps[3].state, 'empty');
  assert.equal(res.body.steps[3].sovereign_action, null,
    '🔴 ship-gate: empty step → sovereign_action null regardless of storyboard');
});

test('🛑 PR-J3 endpoint: 🔴 個人化驗證 — null preserved when not generated', async () => {
  // Step IS filled (has evidence), but finalize-day returned null for
  // sovereign_action (insufficient personalization). Endpoint surfaces null,
  // NOT a fallback / default / generic string.
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(() => Promise.resolve([{
    sc_journey_step: 4,
    sc_journey_evidence: { step_1: [], step_2: [], step_3: [], step_4: [{ type: 'identity_claim' }], step_5: [], step_6: [], step_7: [] },
    sc_storyboard: {
      step_4: {
        brain_state: { description: 'x', quote: null },
        // sovereign_action key missing — finalize-day didn't write (null gate).
      },
    },
  }]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.body.steps[3].brain_state.description, 'x');
  assert.equal(res.body.steps[3].sovereign_action, null,
    '🔴 ship-gate: missing sovereign_action → null (no generic fallback)');
});

test('🛑 PR-J3 endpoint: malformed sovereign_action (non-string) → null', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(() => Promise.resolve([{
    sc_journey_step: 4,
    sc_journey_evidence: { step_1: [], step_2: [], step_3: [], step_4: [{ type: 'identity_claim' }], step_5: [], step_6: [], step_7: [] },
    sc_storyboard: {
      step_4: { sovereign_action: { unexpected: 'object' } },
    },
  }]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.body.steps[3].sovereign_action, null);
});

test('🛑 PR-J3 endpoint: empty-string sovereign_action → null', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(() => Promise.resolve([{
    sc_journey_step: 4,
    sc_journey_evidence: { step_1: [], step_2: [], step_3: [], step_4: [{ type: 'identity_claim' }], step_5: [], step_6: [], step_7: [] },
    sc_storyboard: { step_4: { sovereign_action: '' } },
  }]));
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.body.steps[3].sovereign_action, null);
});

test('🛑 PR-J3 endpoint: contract still strict — brain_state + sovereign_action fields ONLY in step shape', async () => {
  _setStudentSessionReader(STUDENT_SESSION_FOR('A001'));
  _setSqlClient(() => Promise.resolve([{
    sc_journey_step: 4,
    sc_journey_evidence: { step_1: [], step_2: [], step_3: [], step_4: [{ type: 'identity_claim' }], step_5: [], step_6: [], step_7: [] },
    sc_storyboard: {
      step_4: {
        brain_state: { description: 'd', quote: 'q' },
        sovereign_action: 'a。我自己說了算。',
      },
    },
  }]));
  const res = mockRes();
  await handler(mockReq(), res);
  const step = res.body.steps[3];
  assert.deepEqual(Object.keys(step).sort(),
    ['brain_state', 'name_en', 'name_zh', 'no', 'sovereign_action', 'state']);
});
