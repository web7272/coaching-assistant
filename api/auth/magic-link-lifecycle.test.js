// api/auth/magic-link-lifecycle.test.js
// PR-4c-green Auth rebuild stage 1e — cross-cutting magic-link lifecycle proofs.
//
// Things that only make sense when request-link + verify-link are tested as a
// pair (one mints the token, the other claims it). These complement the
// per-endpoint tests in request-link.test.js + verify-link.test.js.

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import requestHandler, {
  _setSqlClient as _setRequestSql,
  _setSendMagicLinkFn,
} from './request-link.js';
import verifyHandler, {
  _setSqlClient as _setVerifySql,
} from './verify-link.js';

const SECRET = 'test-secret-32-bytes-of-entropy-aaaaaaaa';

function makeMockSql(rowsByCallOrFn = []) {
  const calls = [];
  let i = 0;
  const fn = (strings, ...values) => {
    const text = strings.reduce(
      (acc, s, j) => acc + s + (j < values.length ? `$${j + 1}` : ''),
      '',
    );
    calls.push({ strings: Array.from(strings), values, text });
    if (typeof rowsByCallOrFn === 'function') {
      return Promise.resolve(rowsByCallOrFn({ text, values, callIdx: i++ }));
    }
    const rows = Array.isArray(rowsByCallOrFn[0])
      ? (rowsByCallOrFn[i++] || [])
      : rowsByCallOrFn;
    return Promise.resolve(rows);
  };
  fn.calls = calls;
  return fn;
}

function mockReq({ method = 'POST', body = {} } = {}) {
  return { method, body, headers: {} };
}
function mockRes() {
  const headers = {};
  const r = {
    statusCode: 200, body: null, headers,
    status(s) { r.statusCode = s; return r; },
    json(b)   { r.body = b; return r; },
    setHeader(k, v) { headers[k] = v; },
    getHeader(k) { return headers[k]; },
  };
  return r;
}

beforeEach(() => {
  _setRequestSql(null);
  _setVerifySql(null);
  _setSendMagicLinkFn(null);
  process.env.SESSION_SECRET = SECRET;
  process.env.APP_BASE_URL = 'https://preview.example.com';
});

// ── 1. End-to-end: request → mints token → verify → claims → sets cookie ──

test('🛑 lifecycle: request mints token, verify claims it once (happy path)', async () => {
  // Step A: request-link
  const requestSql = makeMockSql([]);
  _setRequestSql(requestSql);
  let issuedLink = null;
  _setSendMagicLinkFn(async (_email, link) => { issuedLink = link; });

  await requestHandler(mockReq({ body: { email: 'vivi@example.com', preferredName: 'Vivi', pace: 'self-paced' } }), mockRes());

  // Server stored sha256(token), the URL has the raw token.
  // 5/29 Patrick (access gate) — request-link 多了一個 is_blocked SELECT 在 INSERT
  // 之前, find INSERT by text-match instead of index.
  const insertCall = requestSql.calls.find(c => /INSERT INTO magic_link_tokens/i.test(c.text));
  assert.ok(insertCall, 'INSERT INTO magic_link_tokens must have happened');
  const storedHash = insertCall.values[0];
  const rawToken   = issuedLink.match(/token=([a-f0-9]{64})/)[1];
  assert.equal(createHash('sha256').update(rawToken).digest('hex'), storedHash);

  // Step B: verify-link — simulate the DB returning the same row the request stored
  // call 1: UPDATE...RETURNING claims the row
  // call 2: SELECT student by email → none (new student)
  // call 3: SELECT last A### → A042 stub
  // call 4: INSERT student row
  const verifySql = makeMockSql([
    [{ email: 'vivi@example.com', preferred_name: 'Vivi', pace: 'self-paced' }],
    [],
    [{ student_id: 'A042' }],
    [],
  ]);
  _setVerifySql(verifySql);
  const res = mockRes();
  await verifyHandler(mockReq({ body: { token: rawToken } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.studentId, 'A043');
  assert.equal(res.body.preferredName, 'Vivi');
  assert.equal(res.body.pace, 'self-paced');
  // student_session cookie set
  assert.match(res.headers['Set-Cookie'][0], /^student_session=/);
});

// ── 2. Replay defense: 2nd verify-link with same token → 401 ──

test('🛑 lifecycle: replay attempt (2nd verify with same token) → 401', async () => {
  const rawToken = 'a'.repeat(64);
  // First call: UPDATE...RETURNING claims (returns 1 row)
  // Second call: UPDATE...RETURNING finds 0 rows (used_at is now set)
  let attemptIdx = 0;
  _setVerifySql(makeMockSql(({ text, callIdx }) => {
    if (/UPDATE magic_link_tokens/i.test(text)) {
      attemptIdx++;
      return attemptIdx === 1
        ? [{ email: 'a@b.com', preferred_name: null, pace: null }]
        : [];   // 2nd attempt: 0 rows (used_at already set)
    }
    if (/SELECT student_id, current_module/i.test(text)) {
      return [{ student_id: 'A001', current_module: 'self', current_day: 1, preferred_name: null, pace: null }];
    }
    return [];
  }));

  const res1 = mockRes();
  await verifyHandler(mockReq({ body: { token: rawToken } }), res1);
  assert.equal(res1.statusCode, 200, 'first claim succeeds');

  const res2 = mockRes();
  await verifyHandler(mockReq({ body: { token: rawToken } }), res2);
  assert.equal(res2.statusCode, 401, 'replay 401');
  assert.equal(res2.headers['Set-Cookie'], undefined, 'no cookie on replay');
});

// ── 3. Expired token: UPDATE…RETURNING gets 0 rows → 401 ──

test('🛑 lifecycle: expired token (DB filters on expires_at > NOW) → 401', async () => {
  // Stub SQL: UPDATE returns 0 rows for ANY query because the WHERE includes
  // `AND expires_at > NOW()` and the row's expires_at is in the past.
  _setVerifySql(makeMockSql([]));
  const res = mockRes();
  await verifyHandler(mockReq({ body: { token: 'b'.repeat(64) } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['Set-Cookie'], undefined);
});

// ── 4. Envelope invariant: request-link returns same response shape always ──

test('🛑 envelope: request-link returns {ok:true} for valid + invalid + DB-fail (no email-existence leak)', async () => {
  _setRequestSql(makeMockSql([]));
  _setSendMagicLinkFn(async () => {});

  // valid
  let res = mockRes();
  await requestHandler(mockReq({ body: { email: 'a@b.com' } }), res);
  assert.deepEqual(res.body, { ok: true });

  // bad shape
  res = mockRes();
  await requestHandler(mockReq({ body: { email: 'not-an-email' } }), res);
  assert.deepEqual(res.body, { ok: true });

  // DB throws
  _setRequestSql(() => { throw new Error('db boom'); });
  res = mockRes();
  await requestHandler(mockReq({ body: { email: 'a@b.com' } }), res);
  assert.deepEqual(res.body, { ok: true });

  // send fails
  _setRequestSql(makeMockSql([]));
  _setSendMagicLinkFn(async () => { throw new Error('brevo down'); });
  res = mockRes();
  await requestHandler(mockReq({ body: { email: 'a@b.com' } }), res);
  assert.deepEqual(res.body, { ok: true });
});

// ── 5. Token shape rejection: verify-link 401s on bad-shape token BEFORE DB ──

test('🛑 envelope: verify-link with malformed token never touches DB', async () => {
  const sql = makeMockSql([]);
  _setVerifySql(sql);
  for (const bad of ['', 'short', 'A'.repeat(64), 'g'.repeat(64), null, undefined, 42]) {
    const res = mockRes();
    await verifyHandler(mockReq({ body: { token: bad } }), res);
    assert.equal(res.statusCode, 401, `token=${JSON.stringify(bad)} must 401`);
  }
  assert.equal(sql.calls.length, 0, 'bad-shape tokens never reach the DB');
});

// ── 6. SESSION_SECRET unset → verify-link fail-closed (no cookie) ──

test('🛑 env fail-closed: SESSION_SECRET unset → verify-link 401 even with valid token shape', async () => {
  process.env.SESSION_SECRET = '';
  _setVerifySql(makeMockSql([
    [{ email: 'a@b.com', preferred_name: null, pace: null }],
    [{ student_id: 'A001', current_module: 'self', current_day: 1, preferred_name: null, pace: null }],
  ]));
  const res = mockRes();
  await verifyHandler(mockReq({ body: { token: 'a'.repeat(64) } }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.headers['Set-Cookie'], undefined);
});
