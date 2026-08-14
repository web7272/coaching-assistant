// api/daily-signup-report.test.js
// Vivi 8/13 每日 21:00 快報 cron endpoint tests.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, {
  _setSqlClient,
  _setSendDailyReportFn,
  getRecipients,
  isAuthorized,
} from './daily-signup-report.js';

// ─── mock helpers ─────────────────────────────────────

function makeMockSql(routes = {}) {
  // routes: { /today/i: [{question,source}], /COUNT/i: [{n:27}], /GROUP BY/i: [...] }
  const calls = [];
  const fn = (strings, ...values) => {
    const text = strings.reduce((a, s, i) => a + s + (i < values.length ? `$${i+1}` : ''), '');
    calls.push({ text, values });
    // Dispatch by matcher — first match wins.
    for (const [pattern, rows] of Object.entries(routes)) {
      const re = new RegExp(pattern.replace(/^\/|\/[a-z]*$/g, ''), 'i');
      if (re.test(text)) return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  };
  fn.calls = calls;
  return fn;
}

function mockReq({ headers = {} } = {}) {
  return { headers };
}
function mockRes() {
  const r = {
    statusCode: 200, body: null,
    status(s) { r.statusCode = s; return r; },
    json(b)   { r.body = b; return r; },
  };
  return r;
}

// ─── env save/restore ─────────────────────────────────

let _savedEnv;
beforeEach(() => {
  _savedEnv = {
    CRON_SECRET:                process.env.CRON_SECRET,
    SEMINAR_REPORT_RECIPIENTS:  process.env.SEMINAR_REPORT_RECIPIENTS,
  };
  process.env.CRON_SECRET = 'test-secret';
  delete process.env.SEMINAR_REPORT_RECIPIENTS;
  _setSqlClient(null);
  _setSendDailyReportFn(null);
});
afterEach(() => {
  for (const k of Object.keys(_savedEnv)) {
    if (_savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = _savedEnv[k];
  }
  _setSqlClient(null);
  _setSendDailyReportFn(null);
});

// ═════════════════════════════════════════════════════════
// isAuthorized — CRON_SECRET guard
// ═════════════════════════════════════════════════════════

test('🛑 isAuthorized: no CRON_SECRET env → false (fail-closed)', () => {
  delete process.env.CRON_SECRET;
  assert.equal(isAuthorized(mockReq({ headers: { authorization: 'Bearer x' } })), false);
});

test('🛑 isAuthorized: correct Bearer → true', () => {
  process.env.CRON_SECRET = 'sekret';
  assert.equal(isAuthorized(mockReq({ headers: { authorization: 'Bearer sekret' } })), true);
});

test('🛑 isAuthorized: wrong secret → false', () => {
  process.env.CRON_SECRET = 'sekret';
  assert.equal(isAuthorized(mockReq({ headers: { authorization: 'Bearer wrong' } })), false);
});

test('🛑 isAuthorized: no header → false', () => {
  process.env.CRON_SECRET = 'sekret';
  assert.equal(isAuthorized(mockReq()), false);
});

test('🛑 isAuthorized: raw secret (missing Bearer prefix) → false', () => {
  process.env.CRON_SECRET = 'sekret';
  assert.equal(isAuthorized(mockReq({ headers: { authorization: 'sekret' } })), false);
});

// ═════════════════════════════════════════════════════════
// handler — 401 unauthorized
// ═════════════════════════════════════════════════════════

test('🛑 handler: no auth header → 401 (no DB / no send)', async () => {
  const sql = makeMockSql();
  _setSqlClient(sql);
  const res = mockRes();
  await handler(mockReq(), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.ok, false);
  assert.equal(sql.calls.length, 0, 'no DB call for unauthed');
});

test('🛑 handler: CRON_SECRET unset → 401 even with any Bearer', async () => {
  delete process.env.CRON_SECRET;
  const res = mockRes();
  await handler(mockReq({ headers: { authorization: 'Bearer anything' } }), res);
  assert.equal(res.statusCode, 401);
});

// ═════════════════════════════════════════════════════════
// handler — happy path
// ═════════════════════════════════════════════════════════

test('🛑 handler: authed → 200 + subject verbatim「報名累計 N 人」+ Neon 3 queries', async () => {
  const sql = makeMockSql({
    '/AT TIME ZONE/': [
      { question: '為什麼？',   source: 'hero' },
      { question: '我是誰？',   source: 'signup' },
    ],
    '/COUNT\\(\\*\\)::int AS n FROM seminar_signups\\s*$/': [{ n: 27 }],
    '/GROUP BY source/':      [
      { source: 'hero',   n: 18 },
      { source: 'signup', n:  9 },
    ],
  });
  _setSqlClient(sql);
  const sent = [];
  _setSendDailyReportFn(async (args) => { sent.push(args); return { ok: true, count: args.recipients.length }; });

  const res = mockRes();
  await handler(mockReq({ headers: { authorization: 'Bearer test-secret' } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.total, 27);
  assert.equal(res.body.todayCount, 2);
  assert.equal(res.body.recipientsCount, 3, 'default 3 recipients (Vivi/Terry/support)');

  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, '報名累計 27 人', 'subject verbatim, 手機通知列直接看數字');
  assert.match(sent[0].html, /27 <span/);
  assert.match(sent[0].html, /為什麼？/);
  assert.match(sent[0].text, /為什麼？/);
  assert.deepEqual(sent[0].recipients, [
    'iamvivi@gmail.com',
    'terrylin1130@gmail.com',
    'support@seeyourself.now',
  ]);
});

test('🛑 handler: 0 人日子 也照樣寄 (心跳訊號)', async () => {
  const sql = makeMockSql({
    '/AT TIME ZONE/': [],
    '/COUNT\\(\\*\\)::int AS n FROM seminar_signups\\s*$/': [{ n: 27 }],
    '/GROUP BY source/':      [{ source: 'hero', n: 27 }],
  });
  _setSqlClient(sql);
  const sent = [];
  _setSendDailyReportFn(async (args) => { sent.push(args); return { ok: true, count: 3 }; });

  const res = mockRes();
  await handler(mockReq({ headers: { authorization: 'Bearer test-secret' } }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.todayCount, 0);
  assert.equal(sent.length, 1, '照樣寄 (心跳訊號, 不寄分不出「沒人」還是「壞了」)');
  assert.equal(sent[0].subject, '報名累計 27 人');
  assert.match(sent[0].text, /今天 0 位。/);
});

test('🛑 handler: Neon 用 Asia/Taipei 切日 (Vivi 明確要求, 不用 UTC)', async () => {
  const sql = makeMockSql({
    '/AT TIME ZONE/':                                    [],
    '/COUNT\\(\\*\\)::int AS n FROM seminar_signups\\s*$/': [{ n: 0 }],
    '/GROUP BY source/':                                 [],
  });
  _setSqlClient(sql);
  _setSendDailyReportFn(async () => ({ ok: true, count: 3 }));

  await handler(mockReq({ headers: { authorization: 'Bearer test-secret' } }), mockRes());

  const todayQuery = sql.calls.find(c => /AT TIME ZONE 'Asia\/Taipei'/.test(c.text));
  assert.ok(todayQuery, "今天 query 必須含 Asia/Taipei timezone (不用 UTC 避免錯位)");
});

// ═════════════════════════════════════════════════════════
// handler — errors
// ═════════════════════════════════════════════════════════

test('🛑 handler: SQL throw → 500', async () => {
  const throwingSql = () => { throw new Error('DB down'); };
  throwingSql.calls = [];
  _setSqlClient(throwingSql);
  _setSendDailyReportFn(async () => ({ ok: true }));

  const res = mockRes();
  await handler(mockReq({ headers: { authorization: 'Bearer test-secret' } }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.ok, false);
});

test('🛑 handler: sendDailyReport ok:false → 200 with sendResult 傳出來 (讓 cron log 看得到)', async () => {
  const sql = makeMockSql({
    '/AT TIME ZONE/':                                    [],
    '/COUNT\\(\\*\\)::int AS n FROM seminar_signups\\s*$/': [{ n: 5 }],
    '/GROUP BY source/':                                 [],
  });
  _setSqlClient(sql);
  _setSendDailyReportFn(async () => ({ ok: false, reason: 'Brevo 400', status: 400, detail: 'sender not verified' }));

  const res = mockRes();
  await handler(mockReq({ headers: { authorization: 'Bearer test-secret' } }), res);
  // Endpoint 仍回 200 (cron 不 retry), 但 sendResult 帶出失敗細節讓 Vercel log 看到.
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sendResult.ok, false);
  assert.match(res.body.sendResult.reason, /Brevo 400/);
});

// ═════════════════════════════════════════════════════════
// getRecipients — env override
// ═════════════════════════════════════════════════════════

test('🛑 getRecipients: default = 3 (Vivi/Terry/support · .now 不是 .com)', () => {
  const list = getRecipients();
  assert.deepEqual(list, [
    'iamvivi@gmail.com',
    'terrylin1130@gmail.com',
    'support@seeyourself.now',
  ]);
});

test('🛑 getRecipients: env SEMINAR_REPORT_RECIPIENTS override', () => {
  process.env.SEMINAR_REPORT_RECIPIENTS = 'a@b.co, c@d.co , e@f.co';
  assert.deepEqual(getRecipients(), ['a@b.co', 'c@d.co', 'e@f.co']);
});

test('🛑 getRecipients: env 空字串 → 回 default', () => {
  process.env.SEMINAR_REPORT_RECIPIENTS = '   ';
  assert.equal(getRecipients().length, 3);
});
