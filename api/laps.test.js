// api/laps.test.js — Patrick 6/8 LAPS metrics endpoint.

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import handler, {
  _setSqlClient, constantTimeEqual, isValidDateString,
} from './laps.js';

// ─── Mock helpers ─────────────────────────────────────────────────

function mkReqRes({ method = 'GET', query = {} } = {}) {
  const req = { method, query, headers: {} };
  let statusCode = 0;
  let payload = null;
  const res = {
    status(c) { statusCode = c; return res; },
    json(b)   { payload = b;   return res; },
    get statusCode() { return statusCode; },
    get payload()    { return payload; },
  };
  return { req, res };
}

/**
 * SQL mock: dispatch by query text fragment. Returns rows based on a planner.
 * planner(text, values) → rows array (or throws to simulate column-missing).
 */
function mkSql(planner) {
  const calls = [];
  const fn = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    return Promise.resolve(planner(text, values));
  };
  fn.calls = calls;
  return fn;
}

let _savedKey;
beforeEach(() => {
  _savedKey = process.env.ADMIN_TOKEN;
  process.env.ADMIN_TOKEN = 'TEST_LAPS_TOKEN_32_BYTES_xxxxxxxxxxxx';
  _setSqlClient(null);
});
afterEach(() => {
  if (_savedKey === undefined) delete process.env.ADMIN_TOKEN;
  else process.env.ADMIN_TOKEN = _savedKey;
  _setSqlClient(null);
});

// ═══════════════════════════════════════════════════════════════════
// Pure helpers
// ═══════════════════════════════════════════════════════════════════

test('constantTimeEqual: equal strings → true', () => {
  assert.equal(constantTimeEqual('abc', 'abc'), true);
});

test('constantTimeEqual: different strings (same len) → false', () => {
  assert.equal(constantTimeEqual('abc', 'abd'), false);
});

test('constantTimeEqual: different lengths → false (no leak via Buffer.write)', () => {
  assert.equal(constantTimeEqual('abc', 'abcd'), false);
  assert.equal(constantTimeEqual('abcd', 'abc'), false);
});

test('constantTimeEqual: empty / non-string → false', () => {
  assert.equal(constantTimeEqual('', 'abc'), false);
  assert.equal(constantTimeEqual('abc', ''), false);
  assert.equal(constantTimeEqual(null, 'abc'), false);
  assert.equal(constantTimeEqual('abc', null), false);
});

test('isValidDateString: valid YYYY-MM-DD → true', () => {
  assert.equal(isValidDateString('2026-06-08'), true);
  assert.equal(isValidDateString('2026-01-01'), true);
  assert.equal(isValidDateString('2026-12-31'), true);
});

test('isValidDateString: format wrong → false', () => {
  for (const s of ['2026/06/08', '2026-6-8', '20260608', 'not-a-date', '', null]) {
    assert.equal(isValidDateString(s), false, `${s} should be invalid`);
  }
});

test('isValidDateString: out-of-range date → false (round-trip check)', () => {
  // 2026-13-01 / 2026-02-30 (real calendar months only).
  assert.equal(isValidDateString('2026-13-01'), false);
  assert.equal(isValidDateString('2026-02-30'), false);
});

// ═══════════════════════════════════════════════════════════════════
// Auth gate
// ═══════════════════════════════════════════════════════════════════

test('🛑 missing key → 401, no data', async () => {
  const { req, res } = mkReqRes({ query: {} });
  await handler(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error, 'Unauthorized');
  assert.equal(res.payload.L, undefined,
    '401 body must not carry any data (no L/A/P/S keys)');
});

test('🛑 wrong key → 401, no data', async () => {
  const { req, res } = mkReqRes({ query: { key: 'WRONG_KEY' } });
  await handler(req, res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.payload.error, 'Unauthorized');
});

test('🛑 ADMIN_TOKEN env unset → 401 (rejects all, even with arbitrary key)', async () => {
  delete process.env.ADMIN_TOKEN;
  const { req, res } = mkReqRes({ query: { key: 'anything' } });
  await handler(req, res);
  assert.equal(res.statusCode, 401);
});

test('🛑 method not GET → 405', async () => {
  const { req, res } = mkReqRes({ method: 'POST', query: { key: process.env.ADMIN_TOKEN } });
  await handler(req, res);
  assert.equal(res.statusCode, 405);
});

// ═══════════════════════════════════════════════════════════════════
// from / to validation
// ═══════════════════════════════════════════════════════════════════

test('🛑 malformed from → 400 INVALID_FROM', async () => {
  const { req, res } = mkReqRes({
    query: { key: process.env.ADMIN_TOKEN, from: '2026/06/08' },
  });
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error, 'INVALID_FROM');
});

test('🛑 malformed to → 400 INVALID_TO', async () => {
  const { req, res } = mkReqRes({
    query: { key: process.env.ADMIN_TOKEN, to: 'foo' },
  });
  await handler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.payload.error, 'INVALID_TO');
});

// ═══════════════════════════════════════════════════════════════════
// Happy path — full LAPS query + window echo
// ═══════════════════════════════════════════════════════════════════

const FROM_TZ_ISO = '2026-05-31T16:00:00.000Z';  // 2026-06-01 00:00 Asia/Taipei
const TO_TZ_ISO   = '2026-06-07T16:00:00.000Z';  // 2026-06-08 00:00 Asia/Taipei

function happyPathPlanner() {
  return (text, _values) => {
    // window resolution (single row)
    if (/from_tz/.test(text)) {
      return [{
        from_str: '2026-06-01',
        to_str:   '2026-06-08',
        from_tz:  new Date(FROM_TZ_ISO),
        to_tz:    new Date(TO_TZ_ISO),
      }];
    }
    // L: leads count + by-option
    if (/FROM leads/.test(text)) {
      return [{ l_total: 12, opt1: 7, opt2: 2, opt3: 3 }];
    }
    // A: distinct students.day1_started_at
    if (/FROM students[\s\S]*day1_started_at/.test(text)) {
      return [{ a_count: 5 }];
    }
    // P: distinct user_profile_evolution.export_prompt_generated_at
    if (/FROM user_profile_evolution[\s\S]*export_prompt_generated_at/.test(text)) {
      return [{ p_count: 1 }];
    }
    return [];
  };
}

test('🛑 happy path: correct key + window → returns LAPS shape', async () => {
  _setSqlClient(mkSql(happyPathPlanner()));
  const { req, res } = mkReqRes({
    query: {
      key:  process.env.ADMIN_TOKEN,
      from: '2026-06-01',
      to:   '2026-06-08',
    },
  });
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  const b = res.payload;
  assert.equal(b.ok, true);
  // Numbers
  assert.equal(b.L, 12);
  assert.equal(b.A, 5);
  assert.equal(b.P, 1);
  assert.equal(b.S, 0);   // Stripe schema gap (see _note)
  // Breakdown sums to L
  assert.deepEqual(b.L_by_option, { opt1: 7, opt2: 2, opt3: 3 });
  assert.equal(b.L_by_option.opt1 + b.L_by_option.opt2 + b.L_by_option.opt3, b.L);
});

test('🛑 happy path: window echoed back (from/to as ISO strings)', async () => {
  _setSqlClient(mkSql(happyPathPlanner()));
  const { req, res } = mkReqRes({
    query: {
      key:  process.env.ADMIN_TOKEN,
      from: '2026-06-01',
      to:   '2026-06-08',
    },
  });
  await handler(req, res);
  assert.equal(res.payload.window.from, FROM_TZ_ISO);
  assert.equal(res.payload.window.to,   TO_TZ_ISO);
});

// ═══════════════════════════════════════════════════════════════════
// Window: SQL filter shape (from inclusive, to exclusive, Asia/Taipei)
// ═══════════════════════════════════════════════════════════════════

test('🛑 window filter: from inclusive (>=) + to exclusive (<)', async () => {
  let leadsCallText = null;
  _setSqlClient(mkSql((text, values) => {
    if (/FROM leads/.test(text)) leadsCallText = text;
    if (/from_tz/.test(text)) {
      return [{
        from_tz: new Date(FROM_TZ_ISO), to_tz: new Date(TO_TZ_ISO),
      }];
    }
    if (/FROM leads/.test(text))    return [{ l_total: 0, opt1: 0, opt2: 0, opt3: 0 }];
    if (/FROM students/.test(text)) return [{ a_count: 0 }];
    if (/FROM user_profile_evolution/.test(text)) return [{ p_count: 0 }];
    return [];
  }));
  const { req, res } = mkReqRes({
    query: { key: process.env.ADMIN_TOKEN, from: '2026-06-01', to: '2026-06-08' },
  });
  await handler(req, res);
  assert.ok(leadsCallText, 'leads query should have fired');
  // >= from
  assert.match(leadsCallText, /created_at >= /);
  // < to (NOT <= to)
  assert.match(leadsCallText, /created_at <\s+\?/);
});

test('🛑 window default: from = date_trunc(week) Asia/Taipei, to = NOW()', async () => {
  let windowSql = null;
  _setSqlClient(mkSql((text, values) => {
    if (/from_tz/.test(text)) {
      windowSql = text;
      return [{
        from_tz: new Date(FROM_TZ_ISO), to_tz: new Date(TO_TZ_ISO),
      }];
    }
    if (/FROM leads/.test(text))    return [{ l_total: 0, opt1: 0, opt2: 0, opt3: 0 }];
    if (/FROM students/.test(text)) return [{ a_count: 0 }];
    if (/FROM user_profile_evolution/.test(text)) return [{ p_count: 0 }];
    return [];
  }));
  // No from / to in query → defaults
  const { req, res } = mkReqRes({ query: { key: process.env.ADMIN_TOKEN } });
  await handler(req, res);
  assert.ok(windowSql, 'window SELECT must fire');
  assert.match(windowSql, /date_trunc\('week', NOW\(\) AT TIME ZONE 'Asia\/Taipei'\)/);
  assert.match(windowSql, /AT TIME ZONE 'Asia\/Taipei'/);
});

// ═══════════════════════════════════════════════════════════════════
// 🛑 鐵律 #2 — leads.answers NEVER selected / returned / logged
// ═══════════════════════════════════════════════════════════════════

test('🛑 鐵律 #2: SQL queries never SELECT leads.answers (only counts)', async () => {
  const planned = [];
  _setSqlClient(mkSql((text, _values) => {
    planned.push(text);
    if (/from_tz/.test(text)) {
      return [{ from_tz: new Date(FROM_TZ_ISO), to_tz: new Date(TO_TZ_ISO) }];
    }
    if (/FROM leads/.test(text))    return [{ l_total: 9, opt1: 3, opt2: 3, opt3: 3 }];
    if (/FROM students/.test(text)) return [{ a_count: 2 }];
    if (/FROM user_profile_evolution/.test(text)) return [{ p_count: 0 }];
    return [];
  }));
  const { req, res } = mkReqRes({
    query: { key: process.env.ADMIN_TOKEN, from: '2026-06-01', to: '2026-06-08' },
  });
  await handler(req, res);
  for (const sql of planned) {
    assert.ok(!/answers/i.test(sql),
      `SQL must NEVER reference leads.answers (鐵律 #2). saw: ${sql}`);
    assert.ok(!/content|message|note_text|preferred_name|email/i.test(sql.replace(/from\s+leads/i, '')),
      `SQL must NEVER select email/content/note_text/preferred_name. saw: ${sql}`);
  }
});

test('🛑 鐵律 #2: response body never contains any raw user text (assert seed strings)', async () => {
  // Seed strings that COULD theoretically leak if a bad query selected raw text.
  const SEED_USER_TEXT = '我以為照顧好他就夠了';
  const SEED_EMAIL     = 'private-vivi@example.com';
  _setSqlClient(mkSql((text, _values) => {
    if (/from_tz/.test(text)) {
      return [{ from_tz: new Date(FROM_TZ_ISO), to_tz: new Date(TO_TZ_ISO) }];
    }
    // Defensive: even if the DB returned extra raw fields (it shouldn't, our
    // queries only SELECT counts), the handler must ignore them.
    if (/FROM leads/.test(text)) {
      return [{
        l_total: 3, opt1: 1, opt2: 1, opt3: 1,
        answers: SEED_USER_TEXT,    // never selected — defensive guard
        email:   SEED_EMAIL,        // never selected — defensive guard
      }];
    }
    if (/FROM students/.test(text)) return [{ a_count: 1 }];
    if (/FROM user_profile_evolution/.test(text)) return [{ p_count: 0 }];
    return [];
  }));
  const { req, res } = mkReqRes({
    query: { key: process.env.ADMIN_TOKEN, from: '2026-06-01', to: '2026-06-08' },
  });
  await handler(req, res);
  const bodyStr = JSON.stringify(res.payload);
  assert.equal(bodyStr.includes(SEED_USER_TEXT), false,
    'response body must never contain raw user text');
  assert.equal(bodyStr.includes(SEED_EMAIL), false,
    'response body must never contain raw email');
});

// ═══════════════════════════════════════════════════════════════════
// P/S 來源 notes
// ═══════════════════════════════════════════════════════════════════

test('🛑 P: column exists → counts returned, P_note=null', async () => {
  _setSqlClient(mkSql((text, _values) => {
    if (/from_tz/.test(text)) {
      return [{ from_tz: new Date(FROM_TZ_ISO), to_tz: new Date(TO_TZ_ISO) }];
    }
    if (/FROM leads/.test(text))    return [{ l_total: 0, opt1: 0, opt2: 0, opt3: 0 }];
    if (/FROM students/.test(text)) return [{ a_count: 0 }];
    if (/FROM user_profile_evolution/.test(text)) return [{ p_count: 4 }];
    return [];
  }));
  const { req, res } = mkReqRes({ query: { key: process.env.ADMIN_TOKEN } });
  await handler(req, res);
  assert.equal(res.payload.P, 4);
  assert.equal(res.payload.P_note, null);
});

test('🛑 P: column missing (migration not applied) → 0 + P_note (fail-soft)', async () => {
  _setSqlClient(mkSql((text, _values) => {
    if (/from_tz/.test(text)) {
      return [{ from_tz: new Date(FROM_TZ_ISO), to_tz: new Date(TO_TZ_ISO) }];
    }
    if (/FROM leads/.test(text))    return [{ l_total: 0, opt1: 0, opt2: 0, opt3: 0 }];
    if (/FROM students/.test(text)) return [{ a_count: 0 }];
    if (/FROM user_profile_evolution/.test(text)) {
      throw new Error('column "export_prompt_generated_at" does not exist');
    }
    return [];
  }));
  const { req, res } = mkReqRes({ query: { key: process.env.ADMIN_TOKEN } });
  await handler(req, res);
  assert.equal(res.statusCode, 200, 'overall query should not 500 — fail-soft for P');
  assert.equal(res.payload.P, 0);
  assert.equal(typeof res.payload.P_note, 'string');
  assert.match(res.payload.P_note, /export_prompt_generated_at/);
});

test('🛑 S: stripe payment timestamp schema gap → 0 + S_note (待補來源)', async () => {
  // S is structurally 0 + note per Patrick spec (api/stripe-webhook.js
  // only does UPDATE students.plan; no payment timestamp landed).
  _setSqlClient(mkSql((text, _values) => {
    if (/from_tz/.test(text)) {
      return [{ from_tz: new Date(FROM_TZ_ISO), to_tz: new Date(TO_TZ_ISO) }];
    }
    if (/FROM leads/.test(text))    return [{ l_total: 0, opt1: 0, opt2: 0, opt3: 0 }];
    if (/FROM students/.test(text)) return [{ a_count: 0 }];
    if (/FROM user_profile_evolution/.test(text)) return [{ p_count: 0 }];
    return [];
  }));
  const { req, res } = mkReqRes({ query: { key: process.env.ADMIN_TOKEN } });
  await handler(req, res);
  assert.equal(res.payload.S, 0);
  assert.equal(typeof res.payload.S_note, 'string');
  assert.match(res.payload.S_note, /stripe-webhook/);
  assert.match(res.payload.S_note, /timestamp/);
});

// ═══════════════════════════════════════════════════════════════════
// Defensive: SQL error → 500 (not 200 with bad data)
// ═══════════════════════════════════════════════════════════════════

test('🛑 leads query throws → 500 (not silent 0)', async () => {
  _setSqlClient(mkSql((text, _values) => {
    if (/from_tz/.test(text)) {
      return [{ from_tz: new Date(FROM_TZ_ISO), to_tz: new Date(TO_TZ_ISO) }];
    }
    if (/FROM leads/.test(text)) throw new Error('connection refused');
    return [];
  }));
  const { req, res } = mkReqRes({ query: { key: process.env.ADMIN_TOKEN } });
  await handler(req, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.payload.error, 'SERVER_ERROR');
});
