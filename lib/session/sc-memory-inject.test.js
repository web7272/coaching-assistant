// lib/session/sc-memory-inject.test.js
// v5.3 Stage C (6/13) — 記憶餵回 inject 鎖.
//
// 三道 0-facing 閘:
//   · flag off → null
//   · primary_mode='crisis' → null
//   · 全空狀態 → null
// 安全:
//   · denylist 11 條 SI 詞全鎖 (values / owned / top1 三來源各鎖)
//   · 長度 > MAX_CHARS_PER_TERM → skip (防 raw 滲入)
//   · 報告字串 不含 raw 對話 markers (role: / user: / assistant:)

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildScMemoryInject,
  extractOwnedIdentities,
  MAX_VALUES_IN_INJECT,
  MAX_OWNED_IN_INJECT,
  MAX_CHARS_PER_TERM,
} from './sc-memory-inject.js';

// ═════════════════════════════════════════════════════════
// 🛑 0-facing 三道閘 — flag off / crisis / 全空 → null
// ═════════════════════════════════════════════════════════

test('🛑 flag off (default) → null (0-facing, Vivi 未過稿前 ship-safe)', () => {
  const inj = buildScMemoryInject({
    valuesCollected: ['自由', '誠實'],
    top1: '自由',
    scJourneyEvidence: { step_4: [{ type: 'identity_claim', quote: '會撐住的人' }] },
    primaryMode: 'elicitation',
    // flagEnabled 不傳 → default false
  });
  assert.equal(inj, null,
    'flag 未開時必須回 null, 確保 0-facing (預設行為跟修前一樣)');
});

test('🛑 flag off explicit false → null', () => {
  const inj = buildScMemoryInject({
    valuesCollected: ['自由'], top1: '自由',
    flagEnabled: false,
  });
  assert.equal(inj, null);
});

test('🛑 primary_mode=crisis → null (危機 session 不拉回身份工作)', () => {
  const inj = buildScMemoryInject({
    valuesCollected: ['自由', '誠實'],
    top1: '自由',
    scJourneyEvidence: { step_4: [{ type: 'identity_claim', quote: '會撐住的人' }] },
    primaryMode: 'crisis',
    flagEnabled: true,
  });
  assert.equal(inj, null,
    'crisis primaryMode 即使 flag 開, 仍必須回 null');
});

test('🛑 全空狀態 (Day 1 新人) → null (0 副作用)', () => {
  const inj = buildScMemoryInject({
    valuesCollected: [], top1: null, scJourneyEvidence: null,
    primaryMode: 'elicitation', flagEnabled: true,
  });
  assert.equal(inj, null);
});

test('🛑 valuesCollected 全 unsafe / null top1 / 無 evidence → 視同空 → null', () => {
  const inj = buildScMemoryInject({
    valuesCollected: ['', '   ', null, undefined],
    top1: '',
    scJourneyEvidence: { step_4: [] },
    primaryMode: 'elicitation',
    flagEnabled: true,
  });
  assert.equal(inj, null);
});

// ═════════════════════════════════════════════════════════
// 🛑 happy path — flag 開 + 有 values + 有 owned + 有 top1 → 三段都出
// ═════════════════════════════════════════════════════════

test('🛑 happy path: values + owned + top1 → 三段 inject + 指引', () => {
  const inj = buildScMemoryInject({
    valuesCollected: ['自由', '誠實', '被理解'],
    top1: '自由',
    scJourneyEvidence: {
      step_4: [
        { type: 'identity_claim', quote: '會撐住的人' },
        { type: 'identity_claim', quote: '能助人的人' },
      ],
    },
    primaryMode: 'elicitation',
    flagEnabled: true,
  });
  assert.ok(inj, 'flag 開 + 有素材 → 必須回 inject 字串');
  // 三段 + 指引
  assert.match(inj, /核心價值[:：][^\n]*自由[、\s]*誠實[、\s]*被理解/);
  assert.match(inj, /最核心價值[:：]\s*自由/);
  assert.match(inj, /已認領身份[:：][^\n]*會撐住的人[、\s]*能助人的人/);
  assert.match(inj, /指引/);
  assert.match(inj, /從尚未走的步驟/);
});

test('🛑 only values (沒 owned, 沒 top1) → 只有「核心價值」+ 指引', () => {
  const inj = buildScMemoryInject({
    valuesCollected: ['自由', '誠實'],
    flagEnabled: true,
  });
  assert.match(inj, /核心價值/);
  assert.equal(/最核心價值/.test(inj), false);
  assert.equal(/已認領身份/.test(inj), false);
  assert.match(inj, /指引/);
});

test('🛑 only top1 (沒 values, 沒 owned) → 只有「最核心價值」+ 指引', () => {
  const inj = buildScMemoryInject({
    top1: '自由',
    flagEnabled: true,
  });
  assert.match(inj, /最核心價值[:：]\s*自由/);
  assert.equal(/核心價值[:：](?!\s*\S*$)/.test(inj.split('\n')[1] || ''), false);
});

test('🛑 only owned (沒 values, 沒 top1) → 只有「已認領身份」+ 指引', () => {
  const inj = buildScMemoryInject({
    scJourneyEvidence: { step_4: [{ type: 'identity_claim', quote: '會撐住的人' }] },
    flagEnabled: true,
  });
  assert.match(inj, /已認領身份[:：]\s*會撐住的人/);
});

// ═════════════════════════════════════════════════════════
// 🛑 安全閘 — denylist 11 條 SI 詞全鎖 (values / owned / top1)
// ═════════════════════════════════════════════════════════

const SI_PHRASES = [
  '想自殺', '想死', '去死', '想輕生', '自傷',
  '割腕', '上吊', '跳樓', '燒炭', '不想活', '無所眷念',
  // 6/14 Patrick A006 漏網修.
  '傷害自己', '傷害我自己', '自我傷害',
];

test('🛑 denylist: values 含 SI 詞 → 過濾掉 (defence-in-depth)', () => {
  for (const phrase of SI_PHRASES) {
    const inj = buildScMemoryInject({
      valuesCollected: [phrase, '誠實'],
      flagEnabled: true,
    });
    if (inj) {
      assert.equal(inj.includes(phrase), false,
        `denylist 必須過濾 values 中的「${phrase}」`);
      assert.match(inj, /誠實/);
    }
    // (誠實 為唯一 safe term → 必有 inject)
  }
});

test('🛑 denylist: top1 是 SI 詞 → 該欄不出 (但其他欄仍可出)', () => {
  const inj = buildScMemoryInject({
    valuesCollected: ['誠實'],
    top1: '想死',
    flagEnabled: true,
  });
  assert.match(inj, /誠實/);
  assert.equal(inj.includes('想死'), false,
    'top1=想死 必須完全不出現');
  assert.equal(/最核心價值/.test(inj), false,
    'top1 過 denylist → 該行不出');
});

test('🛑 denylist: owned (sc_journey_evidence.step_4) 含 SI 詞 → drop', () => {
  const inj = buildScMemoryInject({
    valuesCollected: ['誠實'],
    scJourneyEvidence: {
      step_4: [
        { type: 'identity_claim', quote: '想死的人' },     // ← SI, 必 drop
        { type: 'identity_claim', quote: '會撐住的人' },   // ← safe, 保留
      ],
    },
    flagEnabled: true,
  });
  assert.equal(inj.includes('想死'), false,
    'owned 含「想死」 必須完全不出現');
  assert.match(inj, /會撐住的人/);
});

// ═════════════════════════════════════════════════════════
// 🛑 長度上限 — MAX_CHARS_PER_TERM 防 raw 對話原文滲入
// ═════════════════════════════════════════════════════════

test(`🛑 MAX_CHARS_PER_TERM=${MAX_CHARS_PER_TERM}: 過長 value → skip (raw 句滲入防護)`, () => {
  const longRaw = '我覺得這整段對話讓我意識到自己其實一直在尋找的不只是表面上的成功';
  assert.ok(longRaw.length > MAX_CHARS_PER_TERM, 'fixture sanity');
  const inj = buildScMemoryInject({
    valuesCollected: [longRaw, '誠實'],
    flagEnabled: true,
  });
  assert.equal(inj.includes('我覺得這整段'), false);
  assert.match(inj, /誠實/);
});

test('🛑 MAX_CHARS_PER_TERM: 過長 top1 → 整行不出', () => {
  const inj = buildScMemoryInject({
    valuesCollected: ['誠實'],
    top1: '一個非常長的句子用來模擬被誤塞進 top1_value 欄位的真實 raw 對話片段',
    flagEnabled: true,
  });
  assert.equal(/最核心價值/.test(inj), false);
});

// ═════════════════════════════════════════════════════════
// 🛑 caps + dedup
// ═════════════════════════════════════════════════════════

test(`🛑 MAX_VALUES_IN_INJECT=${MAX_VALUES_IN_INJECT}: 超過 cap → 取前 N (insertion order)`, () => {
  const many = ['自由', '誠實', '被理解', '勇敢', '尊重', '創造力', '專注'];
  assert.ok(many.length > MAX_VALUES_IN_INJECT);
  const inj = buildScMemoryInject({ valuesCollected: many, flagEnabled: true });
  // 前 MAX 個出, 後面不出
  for (let i = 0; i < MAX_VALUES_IN_INJECT; i++) {
    assert.ok(inj.includes(many[i]), `前 ${MAX_VALUES_IN_INJECT} 個 should include ${many[i]}`);
  }
  for (let i = MAX_VALUES_IN_INJECT; i < many.length; i++) {
    assert.equal(inj.includes(many[i]), false,
      `cap 後的 ${many[i]} 不該出現`);
  }
});

test(`🛑 MAX_OWNED_IN_INJECT=${MAX_OWNED_IN_INJECT}: 超過 cap → 取前 N`, () => {
  const many = Array.from({ length: 8 }, (_, i) => ({
    type: 'identity_claim', quote: `身份${i + 1}`,
  }));
  const inj = buildScMemoryInject({
    scJourneyEvidence: { step_4: many },
    flagEnabled: true,
  });
  for (let i = 0; i < MAX_OWNED_IN_INJECT; i++) {
    assert.ok(inj.includes(`身份${i + 1}`));
  }
  for (let i = MAX_OWNED_IN_INJECT; i < many.length; i++) {
    assert.equal(inj.includes(`身份${i + 1}`), false);
  }
});

test('🛑 values dedup: 重複 → 去掉, 順序保留 (Set semantics)', () => {
  const inj = buildScMemoryInject({
    valuesCollected: ['自由', '誠實', '自由', '誠實'],
    flagEnabled: true,
  });
  const m = inj.match(/核心價值[:：]\s*(.+)/);
  const list = m[1];
  // 自由 + 誠實 各只出一次
  assert.equal(list.split('、').length, 2);
  assert.equal(list.split('、')[0], '自由');
  assert.equal(list.split('、')[1], '誠實');
});

// ═════════════════════════════════════════════════════════
// 🛑 extractOwnedIdentities — pure function
// ═════════════════════════════════════════════════════════

test('🛑 extractOwnedIdentities: 只抓 step_4 + type=identity_claim', () => {
  const owned = extractOwnedIdentities({
    step_3: [{ type: 'data_mining', quote: '撐住' }],
    step_4: [
      { type: 'identity_claim',   quote: '會撐住的人' },
      { type: 'pain_witness',     quote: '不該抓' },     // 非 identity_claim
      { type: 'identity_claim',   quote: '能助人的人' },
    ],
    step_6: [{ type: 'sovereignty_reclaim', quote: '不該抓' }],
  });
  assert.deepEqual(owned, ['會撐住的人', '能助人的人']);
});

test('🛑 extractOwnedIdentities: null / non-object / missing step_4 → []', () => {
  assert.deepEqual(extractOwnedIdentities(null), []);
  assert.deepEqual(extractOwnedIdentities(undefined), []);
  assert.deepEqual(extractOwnedIdentities({}), []);
  assert.deepEqual(extractOwnedIdentities({ step_4: null }), []);
  assert.deepEqual(extractOwnedIdentities('not-object'), []);
});

test('🛑 extractOwnedIdentities: 重複 quote → 去重 (insertion order)', () => {
  const owned = extractOwnedIdentities({
    step_4: [
      { type: 'identity_claim', quote: '會撐住的人' },
      { type: 'identity_claim', quote: '會撐住的人' },
      { type: 'identity_claim', quote: '能助人的人' },
    ],
  });
  assert.deepEqual(owned, ['會撐住的人', '能助人的人']);
});

// ═════════════════════════════════════════════════════════
// 🛑 鐵律 #2 — inject 字串不含 raw 對話 markers
// ═════════════════════════════════════════════════════════

test('🛑 鐵律 #2: inject 字串不含 role: / user: / assistant: markers', () => {
  const inj = buildScMemoryInject({
    valuesCollected: ['自由', '誠實'],
    top1: '自由',
    scJourneyEvidence: { step_4: [{ type: 'identity_claim', quote: '會撐住的人' }] },
    primaryMode: 'elicitation',
    flagEnabled: true,
  });
  assert.equal(/\brole:|\buser:|\bassistant:/i.test(inj), false,
    'inject 字串絕不可有對話 role markers (鐵律 #2)');
});
