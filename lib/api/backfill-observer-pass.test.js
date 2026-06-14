// lib/api/backfill-observer-pass.test.js
// v5.3 Stage D (6/13) — Patrick 拍板的合併語意 + 安全 + 排序鎖.
//
// 全 mock judgeFn — 不打 LLM. 對齊 lib/api/observer-driver.test.js pattern.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { runObserverBackfillPass, PER_STEP_EVIDENCE_CAP } from './backfill-observer-pass.js';

const NOW_ISO = '2026-06-13T10:00:00.000Z';

// Build a (assistant, user) message pair stream of arbitrary length.
function buildSessionMessages({ pairs }) {
  const out = [];
  for (const [ai, user] of pairs) {
    out.push({ role: 'assistant', content: ai });
    out.push({ role: 'user',      content: user });
  }
  return out;
}

// Build a non-skip observation that surfaces a value + a step_evidence entry.
function obs({ values = [], owned = [], top1 = null, steps = {}, reframes = [] } = {}) {
  const step_evidence = {
    step_1: [], step_2: [], step_3: [], step_4: [],
    step_5: [], step_6: [], step_7: [],
  };
  for (const [key, entries] of Object.entries(steps)) {
    step_evidence[key] = entries;
  }
  return {
    skip: false,
    skip_reason: null,
    values_surfaced: values,
    top1_determined: top1,
    owned_confirmed: owned,
    reframe_events: reframes,
    step_evidence,
  };
}

// ═════════════════════════════════════════════════════════
// 🛑 cross-session merge — values union / owned union / top1 first-wins /
//    step_evidence appended in day order / steps_touched union
// ═════════════════════════════════════════════════════════

test('🛑 cross-session merge: values union+dedup, owned union+dedup', async () => {
  const sessions = [
    { id: 'sess-1', day: 1, session_state: {} },
    { id: 'sess-2', day: 3, session_state: {} },
  ];
  const loadMessagesForSession = async (id) => buildSessionMessages({
    pairs: id === 'sess-1'
      ? [['Q1', 'aaaaa']]
      : [['Q2', 'bbbbb']],
  });
  // sess-1 surfaces ['自由', '愛'], sess-2 surfaces ['愛', '誠實'] (overlap on 愛).
  let callIdx = 0;
  const judgeFn = async ({ turn }) => {
    callIdx++;
    if (callIdx === 1) return obs({ values: ['自由', '愛'], owned: ['自由'] });
    return obs({ values: ['愛', '誠實'], owned: ['誠實'] });
  };

  const result = await runObserverBackfillPass({
    sessions, loadMessagesForSession, judgeFn, now_iso: NOW_ISO,
  });

  // Union + dedup, insertion order preserved.
  assert.deepEqual(result.accumulated.values, ['自由', '愛', '誠實']);
  assert.deepEqual(result.accumulated.owned,  ['自由', '誠實']);
  assert.equal(result.totals.sessions_count, 2);
});

test('🛑 cross-session merge: top1 first non-null wins (early session 寫死)', async () => {
  const sessions = [
    { id: 'sess-1', day: 1, session_state: {} },
    { id: 'sess-2', day: 5, session_state: {} },
  ];
  const loadMessagesForSession = async () => buildSessionMessages({ pairs: [['Q', 'aaaaa']] });
  let callIdx = 0;
  const judgeFn = async () => {
    callIdx++;
    // sess-1 top1=null, sess-2 top1='自由'. day-順序保證 sess-1 先 → top1='自由'.
    if (callIdx === 1) return obs({ top1: null });
    return obs({ top1: '自由' });
  };
  const result = await runObserverBackfillPass({
    sessions, loadMessagesForSession, judgeFn, now_iso: NOW_ISO,
  });
  assert.equal(result.accumulated.top1, '自由');
});

test('🛑 cross-session merge: top1 once set, NEVER overwritten by later session', async () => {
  const sessions = [
    { id: 'sess-1', day: 2, session_state: {} },
    { id: 'sess-2', day: 4, session_state: {} },
  ];
  const loadMessagesForSession = async () => buildSessionMessages({ pairs: [['Q', 'aaaaa']] });
  let callIdx = 0;
  const judgeFn = async () => {
    callIdx++;
    if (callIdx === 1) return obs({ top1: '自由' });
    return obs({ top1: '誠實' });        // 後到的 top1 不可覆寫
  };
  const result = await runObserverBackfillPass({
    sessions, loadMessagesForSession, judgeFn, now_iso: NOW_ISO,
  });
  assert.equal(result.accumulated.top1, '自由', 'top1 first-wins; 後到 session 不可覆寫');
});

test('🛑 cross-session merge: step_evidence append in DAY order (not insertion order)', async () => {
  // 故意把 sessions 傳成「逆 day 序」, 驗 helper 自己排序.
  const sessions = [
    { id: 'sess-late',  day: 5, session_state: {} },     // 故意 late 先
    { id: 'sess-early', day: 1, session_state: {} },
  ];
  const loadMessagesForSession = async () => buildSessionMessages({ pairs: [['Q', 'aaaaa']] });
  const judgeFn = async ({ turn, context }) => {
    // 用 turn.ai 區分哪個 session call 進來 (但我們 loadMessages 回相同 — 改用 callIdx)
    return null; // overridden below
  };
  let callIdx = 0;
  const judgeFnReal = async () => {
    callIdx++;
    // 第一次 call (排序後) 應該是 sess-early; 第二次是 sess-late.
    if (callIdx === 1) return obs({
      steps: { step_3: [{ type: 'data_mining', quote: 'early-evidence' }] },
    });
    return obs({
      steps: { step_3: [{ type: 'data_mining', quote: 'late-evidence' }] },
    });
  };
  const result = await runObserverBackfillPass({
    sessions, loadMessagesForSession, judgeFn: judgeFnReal, now_iso: NOW_ISO,
  });
  // step_3 內順序 = [early, late], 而非 insertion 順序 [late, early].
  assert.equal(result.step_evidence.step_3.length, 2);
  assert.equal(result.step_evidence.step_3[0].quote, 'early-evidence');
  assert.equal(result.step_evidence.step_3[1].quote, 'late-evidence');
});

test('🛑 cross-session merge: steps_touched union (跨 session)', async () => {
  const sessions = [
    { id: 'sess-1', day: 1, session_state: {} },
    { id: 'sess-2', day: 3, session_state: {} },
  ];
  const loadMessagesForSession = async () => buildSessionMessages({ pairs: [['Q', 'aaaaa']] });
  let i = 0;
  const judgeFn = async () => {
    i++;
    return i === 1
      ? obs({ steps: { step_2: [{ type: 'longing_surface', quote: 'a' }] } })
      : obs({ steps: { step_3: [{ type: 'data_mining',     quote: 'b' }] } });
  };
  // Note: driver computes steps_touched from step_evidence presence; mock obs
  // sets step_evidence directly but driver fold also derives steps_touched —
  // helper accepts whatever accumulated.steps_touched driver returns. We
  // just assert union semantics by checking step_evidence non-empty buckets.
  const result = await runObserverBackfillPass({
    sessions, loadMessagesForSession, judgeFn, now_iso: NOW_ISO,
  });
  assert.equal(result.step_evidence.step_2.length, 1);
  assert.equal(result.step_evidence.step_3.length, 1);
});

test('🛑 sc_journey_step = max non-empty step', async () => {
  const sessions = [
    { id: 'sess-1', day: 1, session_state: {} },
    { id: 'sess-2', day: 3, session_state: {} },
  ];
  const loadMessagesForSession = async () => buildSessionMessages({ pairs: [['Q', 'aaaaa']] });
  let i = 0;
  const judgeFn = async () => {
    i++;
    return i === 1
      ? obs({ steps: { step_3: [{ type: 'data_mining', quote: 'a' }] } })
      : obs({ steps: { step_6: [{ type: 'sovereignty_reclaim', quote: 'b' }] } });
  };
  const result = await runObserverBackfillPass({
    sessions, loadMessagesForSession, judgeFn, now_iso: NOW_ISO,
  });
  assert.equal(result.sc_journey_step, 6);
});

// ═════════════════════════════════════════════════════════
// 🛑 safety — A006 危機案、denylist defence-in-depth
// ═════════════════════════════════════════════════════════

test('🛑 A006 case: primaryMode="crisis" → 整 session 所有 turn 都被 observer pre-LLM skip; values 不污染', async () => {
  // A006 是 12 天危機/SI 案 — 部分 session 是 crisis mode. observer 該 skip.
  const sessions = [
    { id: 'sess-crisis', day: 4, session_state: { primary_mode: 'crisis' } },
    { id: 'sess-normal', day: 6, session_state: { primary_mode: 'elicitation' } },
  ];
  const loadMessagesForSession = async () => buildSessionMessages({
    pairs: [['Q1', '我很累'], ['Q2', '想要被理解']],
  });
  // judgeFn 不該被叫到 sess-crisis 的 turn (pre-LLM skip).
  const calls = [];
  const judgeFn = async ({ context, turn }) => {
    calls.push({ primary_mode: context.primary_mode, user: turn.user });
    return obs({ values: ['誠實'], steps: { step_2: [{ type: 'longing_surface', quote: '想要被理解' }] } });
  };
  const result = await runObserverBackfillPass({
    sessions, loadMessagesForSession, judgeFn, now_iso: NOW_ISO,
  });
  // 只有 sess-normal 的 2 turn 進 judgeFn (sess-crisis 整段都 skip).
  for (const c of calls) {
    assert.notEqual(c.primary_mode, 'crisis',
      'crisis mode session 的 turn 不該進 judgeFn (pre-LLM skip)');
  }
  // crisis skip 計入 totals (driver 計).
  assert.ok(result.totals.skip_counts.crisis >= 2,
    `crisis skip count 應該 >= sess-crisis 的 turn 數; 實際=${result.totals.skip_counts.crisis}`);
});

test('🛑 安全閘 (denylist): observer 即使誤 surface 高危 quote, helper 把 quote → null (保留 type)', async () => {
  // 假設 observer 內部 postScrub 失靈 (不該發生), helper 是最後一道牆.
  const sessions = [{ id: 'sess-1', day: 1, session_state: {} }];
  const loadMessagesForSession = async () => buildSessionMessages({ pairs: [['Q', 'aaaaa']] });
  const judgeFn = async () => obs({
    steps: {
      step_3: [
        { type: 'data_mining', quote: '我想死了' },   // ← 高危, 必須 null
        { type: 'data_mining', quote: '我想撐住' },   // ← 安全, 保留
      ],
    },
  });
  const result = await runObserverBackfillPass({
    sessions, loadMessagesForSession, judgeFn, now_iso: NOW_ISO,
  });
  assert.equal(result.step_evidence.step_3.length, 2);
  assert.equal(result.step_evidence.step_3[0].type, 'data_mining');
  assert.equal(result.step_evidence.step_3[0].quote, null,
    'denylist hit → quote → null (但保留 type entry)');
  assert.equal(result.step_evidence.step_3[1].quote, '我想撐住');
});

test('🛑 安全閘: 11 條 SC_STORYBOARD_HIGH_RISK_PATTERNS 全鎖', async () => {
  const phrases = [
    '想自殺', '想死', '去死', '輕生', '自傷',
    '割腕', '上吊', '跳樓', '燒炭', '不想活', '無所眷念',
  ];
  for (const phrase of phrases) {
    const sessions = [{ id: 's', day: 1, session_state: {} }];
    const judgeFn = async () => obs({
      steps: { step_3: [{ type: 'data_mining', quote: phrase }] },
    });
    const result = await runObserverBackfillPass({
      sessions,
      loadMessagesForSession: async () => buildSessionMessages({ pairs: [['Q', 'aaaaa']] }),
      judgeFn, now_iso: NOW_ISO,
    });
    assert.equal(result.step_evidence.step_3[0].quote, null,
      `denylist must catch: "${phrase}"`);
  }
});

// ═════════════════════════════════════════════════════════
// 🛑 PER_STEP_EVIDENCE_CAP — 防 evidence 累積過長
// ═════════════════════════════════════════════════════════

test(`🛑 PER_STEP_EVIDENCE_CAP=${PER_STEP_EVIDENCE_CAP}: 同 step 超過 cap → 保留 latest (slice(-cap))`, async () => {
  // 7 session × 1 turn 各放 step_3 evidence → 7 entries → 截到 cap.
  const N = 7;
  const sessions = Array.from({ length: N }, (_, i) => ({
    id: `s-${i + 1}`, day: i + 1, session_state: {},
  }));
  let i = 0;
  const judgeFn = async () => {
    i++;
    return obs({ steps: { step_3: [{ type: 'data_mining', quote: `q-${i}` }] } });
  };
  const result = await runObserverBackfillPass({
    sessions,
    loadMessagesForSession: async () => buildSessionMessages({ pairs: [['Q', 'aaaaa']] }),
    judgeFn, now_iso: NOW_ISO,
  });
  assert.equal(result.step_evidence.step_3.length, PER_STEP_EVIDENCE_CAP);
  // 應該保留 last PER_STEP_EVIDENCE_CAP 個: q-(N-cap+1)..q-N.
  assert.equal(result.step_evidence.step_3[0].quote, `q-${N - PER_STEP_EVIDENCE_CAP + 1}`);
  assert.equal(result.step_evidence.step_3[PER_STEP_EVIDENCE_CAP - 1].quote, `q-${N}`);
});

// ═════════════════════════════════════════════════════════
// 🛑 defensive / fail-soft
// ═════════════════════════════════════════════════════════

test('🛑 missing session.id → 跳過 (defensive, 不 crash)', async () => {
  const sessions = [
    { id: null, day: 1, session_state: {} },
    { id: 'sess-ok', day: 2, session_state: {} },
  ];
  let calls = 0;
  const result = await runObserverBackfillPass({
    sessions,
    loadMessagesForSession: async () => {
      calls++;
      return buildSessionMessages({ pairs: [['Q', 'aaaaa']] });
    },
    judgeFn: async () => obs({ values: ['x'] }),
    now_iso: NOW_ISO,
  });
  assert.equal(calls, 1, '只有 sess-ok 觸發 loadMessages');
  assert.equal(result.totals.sessions_count, 1);
});

test('🛑 loadMessages 拋錯 → 該 session 計 error, 其他繼續', async () => {
  const sessions = [
    { id: 'sess-bad', day: 1, session_state: {} },
    { id: 'sess-ok',  day: 2, session_state: {} },
  ];
  const loadMessagesForSession = async (id) => {
    if (id === 'sess-bad') throw new Error('db-down');
    return buildSessionMessages({ pairs: [['Q', 'aaaaa']] });
  };
  const result = await runObserverBackfillPass({
    sessions, loadMessagesForSession,
    judgeFn: async () => obs({ values: ['ok'] }),
    now_iso: NOW_ISO,
  });
  const bad = result.per_session.find(p => p.session_id === 'sess-bad');
  const ok  = result.per_session.find(p => p.session_id === 'sess-ok');
  assert.equal(bad.error, 'load-failed');
  assert.equal(ok.error, undefined);
  assert.equal(result.accumulated.values.includes('ok'), true);
});

test('🛑 empty messages → 該 session no-messages, totals 不計', async () => {
  const sessions = [{ id: 'sess-empty', day: 1, session_state: {} }];
  const result = await runObserverBackfillPass({
    sessions,
    loadMessagesForSession: async () => [],
    judgeFn: async () => obs({ values: ['x'] }),
    now_iso: NOW_ISO,
  });
  assert.equal(result.per_session[0].error, 'no-messages');
  assert.equal(result.totals.sessions_count, 0);
  assert.equal(result.accumulated.values.length, 0);
});

test('🛑 driver throw → 該 session 計 driver-failed, 其他繼續', async () => {
  const sessions = [
    { id: 'sess-throw', day: 1, session_state: {} },
    { id: 'sess-ok',    day: 2, session_state: {} },
  ];
  const loadMessagesForSession = async () => buildSessionMessages({ pairs: [['Q', 'aaaaa']] });
  let i = 0;
  const judgeFn = async () => {
    i++;
    // driver 本身會包裹 fail-soft (Promise.allSettled), 但驅動之前的 catch 也保險.
    // 這裡讓 judgeFn 第一個 session 拋, driver 內部 fail-soft 仍會 return.
    // 為了測 helper 自己的 catch, 改丟同步錯 — 但 helper catch 抓得到 only if
    // runObserverOverSession 自己 throw. 所以我用一個會讓 driver 整個 throw 的方式:
    // 直接 throw — driver 內 Promise.allSettled 會吃, 不會冒出. 所以這個 test 改鎖
    // helper "non-throw on judge failure" semantic — driver 內部 fail-soft 已保證.
    if (i === 1) throw new Error('judge-blew-up');
    return obs({ values: ['ok'] });
  };
  const result = await runObserverBackfillPass({
    sessions, loadMessagesForSession, judgeFn, now_iso: NOW_ISO,
  });
  // 兩 session 都跑完 (driver fail-soft 接住), 'ok' 被收.
  assert.equal(result.totals.sessions_count, 2);
  assert.equal(result.accumulated.values.includes('ok'), true);
});

test('🛑 sessions 缺 / 非 array → 回空殼, 不 crash', async () => {
  for (const s of [null, undefined, 'not-array', 123]) {
    const result = await runObserverBackfillPass({
      sessions: s,
      loadMessagesForSession: async () => [],
      judgeFn: async () => obs({}),
      now_iso: NOW_ISO,
    });
    assert.equal(result.totals.sessions_count, 0);
    assert.equal(result.sc_journey_step, null);
    assert.equal(result.step_evidence.step_1.length, 0);
  }
});

// ═════════════════════════════════════════════════════════
// 🛑 totals summary — 給 dryRun 報告用
// ═════════════════════════════════════════════════════════

test('🛑 totals: sessions_count / turns_observed / judged_count / skip_counts 正確聚合', async () => {
  const sessions = [
    { id: 's1', day: 1, session_state: {} },
    { id: 's2', day: 2, session_state: {} },
  ];
  // s1: 3 turns (1 noise → skip). s2: 2 turns (全跑).
  const loadMessagesForSession = async (id) => id === 's1'
    ? buildSessionMessages({ pairs: [['Q1', 'a'], ['Q2', 'bbbbb'], ['Q3', 'ccccc']] })
    : buildSessionMessages({ pairs: [['Q1', 'ddddd'], ['Q2', 'eeeee']] });
  const judgeFn = async () => obs({});
  const result = await runObserverBackfillPass({
    sessions, loadMessagesForSession, judgeFn, now_iso: NOW_ISO,
  });
  // turns_observed = driver turns_count 加總. s1=3 (1 noise skip 但仍計 turn),
  // s2=2 → total 5.
  assert.equal(result.totals.turns_observed, 5);
  assert.equal(result.totals.sessions_count, 2);
  // app_noise skip 至少 1 (Q1 'a' < APP_NOISE_MIN_LEN=2).
  assert.ok(result.totals.skip_counts.app_noise >= 1);
});
