// api/admin/backfill-storyboard.test.js
// v5.3 件3 (6/12) — admin-gated backfill endpoint mock tests.
//
// Covers (Patrick 6/12 spec):
//   · 401 無 token
//   · 400 missing student / 非 eligible (plan_a + is_beta + 非 blocked)
//   · 200 GET list eligible
//   · 200 POST dryRun (預設, 不寫 DB, returns report)
//   · 200 POST ?commit=true 才寫 DB
//   · token 走 header (x-admin-token), 也認 ?token query (require-admin contract)
//   · report 無 raw 對話 (鐵律 #2; 沿用 core formatStudentReport)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import handler, {
  _setSqlClient,
  _setAnthropicClient,
  _setCallAnthropic,
} from './backfill-storyboard.js';

// ─── Tiny test stubs ──────────────────────────────────────

function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return res;
}

function makeReq({ method = 'GET', query = {}, headers = {} } = {}) {
  return { method, query, headers };
}

// Mock sql tagged-template literal. Pattern-matches by SQL text fragments.
function makeMockSql(routes) {
  // routes: array of { match: string|RegExp, handler: (values) => rows }
  const calls = [];
  const sql = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    for (const r of routes) {
      const ok = typeof r.match === 'string'
        ? text.includes(r.match)
        : r.match.test(text);
      if (ok) {
        const result = typeof r.handler === 'function'
          ? r.handler(values, text) : r.handler;
        return Promise.resolve(result || []);
      }
    }
    // unmatched — fail loud so tests catch unintended queries.
    throw new Error(`mockSql: no route for ${text.slice(0, 80)}`);
  };
  sql._calls = calls;
  return sql;
}

// Tag a SQL-fragment so we can distinguish UPDATE writes from SELECT reads.
function isWrite(text) {
  return /\bUPDATE\b|\bINSERT\b|\bDELETE\b/i.test(text);
}

// Stub LLM call — always returns a fixed safe response.
async function fakeCallAnthropic(_client, _payload) {
  return {
    ok: true,
    data: { content: [{ text: '你開始說出你想要的, 不再壓抑。' }] },
  };
}

// Sovereign action needs internal-control declaration tail — different stub.
async function fakeCallAnthropicSovereign(_client, payload) {
  // Inspect system prompt to distinguish brain_state vs sovereign_action.
  const sys = String(payload?.system || '');
  if (sys.includes('主權建議') || sys.includes('SovereignAction') || sys.includes('主權動作')) {
    return {
      ok: true,
      data: { content: [{ text: '對舊信念說 不行, 拿回主導權。對外在裁判, 我自己說了算。' }] },
    };
  }
  return {
    ok: true,
    data: { content: [{ text: '你開始說出你想要的, 不再壓抑。' }] },
  };
}

const ELIGIBLE_ROW = {
  student_id: 'A003',
  active_context_category: 'career',
  active_context_name: '創業',
  active_context_definition: '把代理做大',
  sc_journey_evidence: null,
  sc_journey_step: null,
  sc_storyboard: null,
};

const SESSIONS_ROWS = [
  {
    id: 's1', day: 5,
    session_state: {
      reframe_invocation_history_in_session: [
        { reframe_id: 'R2', anchor_phrase_if_success: '我是會撐住的人' },
      ],
    },
  },
];

const UPE_ROW = {
  active_context_session_summary: {
    career: {
      surfaced_values: ['被理解', '自由'],
      surfaced_examples: [{ day: 2, value: '被理解', example: '我講出來了' }],
    },
  },
  daily_takeaways: [{ day: 1, term: '勇敢' }],
};

// Compose the standard happy-path sql mock. Lets us track whether
// UPDATE was issued (= committed) vs not (= dryRun).
function makeHappySql({ eligible = true, writes = [] } = {}) {
  return makeMockSql([
    {
      // listTargets / fetchEligibleList — no ${} binds
      match: /SELECT student_id FROM students[\s\S]*?ORDER BY/i,
      handler: () => eligible
        ? [{ student_id: 'A003' }, { student_id: 'A006' }]
        : [],
    },
    {
      // checkEligible — has WHERE student_id =
      match: /SELECT student_id FROM students[\s\S]*?WHERE student_id/i,
      handler: () => eligible ? [{ student_id: 'A003' }] : [],
    },
    {
      // loadStudent — selects sc_journey_evidence
      match: /sc_journey_evidence, sc_journey_step, sc_storyboard/i,
      handler: () => [ELIGIBLE_ROW],
    },
    {
      // loadSessions
      match: /FROM sessions[\s\S]*?ORDER BY day/i,
      handler: () => SESSIONS_ROWS,
    },
    {
      // loadUpe
      match: /FROM user_profile_evolution/i,
      handler: () => [UPE_ROW],
    },
    {
      // writeBackfill (UPDATE students SET sc_journey_evidence = ... sc_storyboard = ...)
      match: /UPDATE students[\s\S]*?SET sc_journey_evidence/i,
      handler: (values, text) => { writes.push({ text, values }); return []; },
    },
  ]);
}

// ═════════════════════════════════════════════════════════
// Auth — 401
// ═════════════════════════════════════════════════════════

test('🔴 401 — missing x-admin-token + missing ?token', async () => {
  process.env.ADMIN_API_TOKEN = 'unit-test-token';
  _setSqlClient(makeHappySql());
  const req = makeReq({ method: 'POST', query: { student: 'A003' } });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, 'unauthorized');
});

test('🔴 401 — wrong token', async () => {
  process.env.ADMIN_API_TOKEN = 'unit-test-token';
  _setSqlClient(makeHappySql());
  const req = makeReq({
    method: 'POST',
    query: { student: 'A003' },
    headers: { 'x-admin-token': 'WRONG' },
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 401);
});

test('🛑 200 — correct x-admin-token in header passes auth', async () => {
  process.env.ADMIN_API_TOKEN = 'unit-test-token';
  const writes = [];
  _setSqlClient(makeHappySql({ writes }));
  _setCallAnthropic(fakeCallAnthropicSovereign);
  _setAnthropicClient({}); // dummy
  const req = makeReq({
    method: 'POST',
    query: { student: 'A003' },
    headers: { 'x-admin-token': 'unit-test-token' },
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
});

// ═════════════════════════════════════════════════════════
// POST validation
// ═════════════════════════════════════════════════════════

test('🛑 400 — POST missing ?student=', async () => {
  process.env.ADMIN_API_TOKEN = 'unit-test-token';
  _setSqlClient(makeHappySql());
  const req = makeReq({
    method: 'POST',
    headers: { 'x-admin-token': 'unit-test-token' },
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'STUDENT_REQUIRED');
});

test('🔴 400 — POST non-eligible student (plan != plan_a OR not beta OR blocked) → STUDENT_NOT_ELIGIBLE', async () => {
  process.env.ADMIN_API_TOKEN = 'unit-test-token';
  const writes = [];
  _setSqlClient(makeHappySql({ eligible: false, writes }));
  const req = makeReq({
    method: 'POST',
    query: { student: 'A999', commit: 'true' },
    headers: { 'x-admin-token': 'unit-test-token' },
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'STUDENT_NOT_ELIGIBLE');
  // 🔴 重要: 拒前 0 寫 DB.
  assert.equal(writes.length, 0, 'non-eligible: must NOT write DB');
});

// ═════════════════════════════════════════════════════════
// GET — list eligible
// ═════════════════════════════════════════════════════════

test('🛑 GET — lists eligible students (plan_a + is_beta + non-blocked)', async () => {
  process.env.ADMIN_API_TOKEN = 'unit-test-token';
  _setSqlClient(makeHappySql());
  const req = makeReq({
    method: 'GET',
    headers: { 'x-admin-token': 'unit-test-token' },
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.deepEqual(res.body.students, ['A003', 'A006']);
  assert.equal(res.body.count, 2);
});

// ═════════════════════════════════════════════════════════
// POST happy paths: dryRun 預設 + ?commit=true 才寫
// ═════════════════════════════════════════════════════════

test('🔴 POST default → dryRun=true; 0 UPDATE; report 回傳', async () => {
  process.env.ADMIN_API_TOKEN = 'unit-test-token';
  const writes = [];
  _setSqlClient(makeHappySql({ writes }));
  _setCallAnthropic(fakeCallAnthropicSovereign);
  _setAnthropicClient({});
  const req = makeReq({
    method: 'POST',
    query: { student: 'A003' }, // no commit
    headers: { 'x-admin-token': 'unit-test-token' },
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.dryRun, true, 'default = dryRun');
  assert.equal(res.body.committed, false, '0 commit');
  // 🔴 鐵則: dryRun 0 寫 DB.
  assert.equal(writes.length, 0, 'dryRun: must NOT issue UPDATE');
  // Report 有產生 (student block).
  assert.match(res.body.report, /student: A003/);
});

test('🔴 POST ?commit=true → dryRun=false; UPDATE 1 次; report 空', async () => {
  process.env.ADMIN_API_TOKEN = 'unit-test-token';
  const writes = [];
  _setSqlClient(makeHappySql({ writes }));
  _setCallAnthropic(fakeCallAnthropicSovereign);
  _setAnthropicClient({});
  const req = makeReq({
    method: 'POST',
    query: { student: 'A003', commit: 'true' },
    headers: { 'x-admin-token': 'unit-test-token' },
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.dryRun, false);
  assert.equal(res.body.committed, true);
  // 必須 UPDATE 1 次 (per student backfill = 1 UPDATE).
  assert.equal(writes.length, 1, 'commit: exactly 1 UPDATE');
  assert.match(writes[0].text, /UPDATE students[\s\S]*?sc_journey_evidence/);
});

test('🛑 POST ?commit=1 also accepted (truthy)', async () => {
  process.env.ADMIN_API_TOKEN = 'unit-test-token';
  const writes = [];
  _setSqlClient(makeHappySql({ writes }));
  _setCallAnthropic(fakeCallAnthropicSovereign);
  _setAnthropicClient({});
  const req = makeReq({
    method: 'POST',
    query: { student: 'A003', commit: '1' },
    headers: { 'x-admin-token': 'unit-test-token' },
  });
  const res = makeRes();
  await handler(req, res);
  assert.equal(res.body.dryRun, false);
  assert.equal(writes.length, 1);
});

test('🛑 POST commit string other than true/1 → still dryRun (defensive)', async () => {
  process.env.ADMIN_API_TOKEN = 'unit-test-token';
  const writes = [];
  _setSqlClient(makeHappySql({ writes }));
  _setCallAnthropic(fakeCallAnthropicSovereign);
  _setAnthropicClient({});
  for (const v of ['yes', 'TRUE_TYPO', '0', 'false', '']) {
    writes.length = 0;
    const req = makeReq({
      method: 'POST',
      query: { student: 'A003', commit: v },
      headers: { 'x-admin-token': 'unit-test-token' },
    });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.body.dryRun, true, `commit="${v}" should stay dryRun`);
    assert.equal(writes.length, 0, `commit="${v}" must NOT write`);
  }
});

// ═════════════════════════════════════════════════════════
// 🔴 鐵律 #2 — report 無 raw 對話 markers
// ═════════════════════════════════════════════════════════

test('🔴 鐵律 #2 — dryRun report 不含 raw 對話標記 (role:/user:/assistant:)', async () => {
  process.env.ADMIN_API_TOKEN = 'unit-test-token';
  _setSqlClient(makeHappySql());
  _setCallAnthropic(fakeCallAnthropicSovereign);
  _setAnthropicClient({});
  const req = makeReq({
    method: 'POST',
    query: { student: 'A003' },
    headers: { 'x-admin-token': 'unit-test-token' },
  });
  const res = makeRes();
  await handler(req, res);
  const report = res.body.report || '';
  assert.equal(/\brole:|\buser:|\bassistant:/i.test(report), false,
    'report MUST NOT contain conversation role markers');
});

// ═════════════════════════════════════════════════════════
// Method dispatch — only GET + POST
// ═════════════════════════════════════════════════════════

test('🛑 405 — DELETE / PATCH / PUT not allowed', async () => {
  process.env.ADMIN_API_TOKEN = 'unit-test-token';
  _setSqlClient(makeHappySql());
  for (const m of ['DELETE', 'PATCH', 'PUT']) {
    const req = makeReq({
      method: m,
      headers: { 'x-admin-token': 'unit-test-token' },
    });
    const res = makeRes();
    await handler(req, res);
    assert.equal(res.statusCode, 405, `${m}: 405 expected`);
  }
});

// ═════════════════════════════════════════════════════════
// Static sanity — endpoint imports the validated core (no re-implementation)
// ═════════════════════════════════════════════════════════

test('🛑 sync-gate — endpoint imports backfillOneStudent from scripts/backfill-storyboard.js (no re-implementation)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(
    new URL('./backfill-storyboard.js', import.meta.url), 'utf8');
  // Must import the validated core helper.
  assert.match(src, /from ['"]\.\.\/\.\.\/scripts\/backfill-storyboard\.js['"]/,
    'endpoint must import backfillOneStudent from validated core script');
  assert.match(src, /backfillOneStudent/);
  // Must import the J2/J3 generators (not re-implement).
  assert.match(src, /generateBrainState/);
  assert.match(src, /generateSovereignAction/);
  // Must use requireAdmin gate.
  assert.match(src, /requireAdmin/);
  // Must declare maxDuration: 60.
  assert.match(src, /maxDuration:\s*60/);
});
