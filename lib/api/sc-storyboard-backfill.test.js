// lib/api/sc-storyboard-backfill.test.js
// v5.3 件3 backfill (6/12) — pure derivation unit tests.
// Patrick 先驗這個 (映射 + denylist + 計算邏輯). 通過才會被 scripts/backfill-storyboard.js
// 拿來推回 sc_journey_evidence / sc_journey_step.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REFRAME_STEP_MAP,
  PER_STEP_EVIDENCE_CAP,
  pickQuoteForReframe,
  deriveScJourneyFromHistory,
} from './sc-storyboard-backfill.js';

// ═════════════════════════════════════════════════════════
// REFRAME_STEP_MAP — 對齊 api/chat.js evidence-append 映射
// ═════════════════════════════════════════════════════════

test('🛑 mapping: R2 → step 4 identity_claim', () => {
  assert.deepEqual(REFRAME_STEP_MAP.R2, { step: 4, type: 'identity_claim' });
});

test('🛑 mapping: R1 + R1_E → step 6 sovereignty_reclaim (R1_VARIANTS)', () => {
  assert.deepEqual(REFRAME_STEP_MAP.R1,   { step: 6, type: 'sovereignty_reclaim' });
  assert.deepEqual(REFRAME_STEP_MAP.R1_E, { step: 6, type: 'sovereignty_reclaim' });
});

test('🛑 mapping: R3 → step 3 data_mining', () => {
  assert.deepEqual(REFRAME_STEP_MAP.R3, { step: 3, type: 'data_mining' });
});

test('🛑 mapping: R7 → step 7 anchoring', () => {
  assert.deepEqual(REFRAME_STEP_MAP.R7, { step: 7, type: 'anchoring' });
});

test('🛑 mapping: R5 / R6 / R12 → step 5 resource_retrieval', () => {
  assert.deepEqual(REFRAME_STEP_MAP.R5,  { step: 5, type: 'resource_retrieval' });
  assert.deepEqual(REFRAME_STEP_MAP.R6,  { step: 5, type: 'resource_retrieval' });
  assert.deepEqual(REFRAME_STEP_MAP.R12, { step: 5, type: 'resource_retrieval' });
});

test('🛑 mapping: 未列出的 reframe (e.g. R8 / R11) 不映射 → 不會出現在 evidence', () => {
  const { evidence } = deriveScJourneyFromHistory({
    reframeHistory: [
      { reframe_id: 'R8',  anchor_phrase_if_success: '錨1' },
      { reframe_id: 'R11', anchor_phrase_if_success: '錨2' },
    ],
  });
  // 7 步 evidence 全空 (R8/R11 沒映射).
  for (let n = 1; n <= 7; n++) {
    assert.equal(evidence[`step_${n}`].length, 0,
      `unknown reframe should not land in step_${n}`);
  }
});

// ═════════════════════════════════════════════════════════
// pickQuoteForReframe — anchor / surfaced / takeaway / null 4 階 precedence
// ═════════════════════════════════════════════════════════

test('🛑 quote precedence ①: anchor_phrase_if_success 最優先', () => {
  const q = pickQuoteForReframe(
    { reframe_id: 'R2', day: 4, anchor_phrase_if_success: '我是值得被愛的人' },
    [{ day: 4, value: 'love', example: '我可以開口' }],
    [{ day: 4, term: '勇敢' }],
  );
  assert.equal(q, '我是值得被愛的人',
    'anchor must beat surfaced + takeaway even when both same-day match');
});

test('🛑 quote precedence ②: anchor 缺 → 退到同 day surfaced_examples.example', () => {
  const q = pickQuoteForReframe(
    { reframe_id: 'R5', day: 7 },
    [{ day: 7, value: 'freedom', example: '我發現自己其實會說「不」' }],
    [{ day: 7, term: '自由' }],
  );
  assert.equal(q, '我發現自己其實會說「不」',
    'surfaced.example must beat takeaway when same-day matches');
});

test('🛑 quote precedence ③: anchor + surfaced 缺 → 退到同 day daily_takeaways.term', () => {
  const q = pickQuoteForReframe(
    { reframe_id: 'R3', day: 5 },
    [],
    [{ day: 5, term: '我看見了自己的努力' }],
  );
  assert.equal(q, '我看見了自己的努力');
});

test('🛑 quote precedence ④: 全缺 → null (entry 仍會被 derive 記錄, 但 quote=null)', () => {
  const q = pickQuoteForReframe(
    { reframe_id: 'R2', day: 9 },
    [{ day: 3, value: 'x', example: '錯日' }],     // 不同 day, 不命中
    [{ day: 4, term: '錯日' }],                    // 不同 day, 不命中
  );
  assert.equal(q, null);
});

test('🛑 quote precedence: 同 day 多筆 surfaced → 用 find 的第一筆 (caller 控順序)', () => {
  const q = pickQuoteForReframe(
    { reframe_id: 'R5', day: 6 },
    [
      { day: 6, value: 'a', example: '第一句' },
      { day: 6, value: 'b', example: '第二句' },
    ],
    [],
  );
  assert.equal(q, '第一句');
});

test('🛑 quote precedence: entry.day 不是整數 → 跳過 day-matched fallback, 直接 null', () => {
  const q = pickQuoteForReframe(
    { reframe_id: 'R3' },  // no day field
    [{ day: 5, value: 'x', example: '某句' }],
    [{ day: 5, term: '某詞' }],
  );
  assert.equal(q, null);
});

test('🛑 quote precedence: 空字串 anchor 跳過 → 進入 fallback', () => {
  const q = pickQuoteForReframe(
    { reframe_id: 'R2', day: 4, anchor_phrase_if_success: '   ' },
    [{ day: 4, value: 'x', example: 'surfaced 句' }],
    [],
  );
  assert.equal(q, 'surfaced 句');
});

// ═════════════════════════════════════════════════════════
// High-risk denylist — defence-in-depth (即使 source 已 sanitize)
// ═════════════════════════════════════════════════════════

test('🔴 safety: anchor 含高危 (自殺/想死/...) → derive 後 quote 變 null, type 保留', () => {
  const { evidence } = deriveScJourneyFromHistory({
    reframeHistory: [
      { reframe_id: 'R2', day: 5, anchor_phrase_if_success: '我有時候會想自殺' },
    ],
  });
  assert.equal(evidence.step_4.length, 1, 'type entry 不丟整筆');
  assert.equal(evidence.step_4[0].type, 'identity_claim');
  assert.equal(evidence.step_4[0].quote, null,
    'high-risk quote MUST be dropped to null (defence-in-depth)');
});

test('🔴 safety: surfaced.example 含高危 → quote=null, type 保留', () => {
  const { evidence } = deriveScJourneyFromHistory({
    reframeHistory: [{ reframe_id: 'R6', day: 8 }],
    surfacedExamples: [{ day: 8, value: 'x', example: '我想去死' }],
  });
  assert.equal(evidence.step_5.length, 1);
  assert.equal(evidence.step_5[0].quote, null);
});

test('🔴 safety: dailyTakeaways.term 含高危 → quote=null, type 保留', () => {
  const { evidence } = deriveScJourneyFromHistory({
    reframeHistory: [{ reframe_id: 'R7', day: 3 }],
    dailyTakeaways:  [{ day: 3, term: '輕生' }],
  });
  assert.equal(evidence.step_7.length, 1);
  assert.equal(evidence.step_7[0].quote, null);
});

test('🔴 safety: longing surfacedValue 含高危 → quote=null, type 保留', () => {
  const { evidence } = deriveScJourneyFromHistory({
    surfacedValues: ['有用', '上吊', '勇敢'],
  });
  // 3 個 surfaced values → 3 個 longing entries, 中間那個 quote=null.
  assert.equal(evidence.step_2.length, 3);
  assert.equal(evidence.step_2[0].quote, '有用');
  assert.equal(evidence.step_2[1].quote, null);
  assert.equal(evidence.step_2[2].quote, '勇敢');
});

// ═════════════════════════════════════════════════════════
// deriveScJourneyFromHistory — full shape + step computation
// ═════════════════════════════════════════════════════════

test('🛑 derive: empty signals → 7 步 evidence 全空 + step=null', () => {
  const { evidence, step } = deriveScJourneyFromHistory({});
  for (let n = 1; n <= 7; n++) {
    assert.equal(evidence[`step_${n}`].length, 0);
  }
  assert.equal(step, null);
});

test('🛑 derive: step_1 pain_surface 永遠空 (對齊 live + Patrick: 痛句不顯示)', () => {
  const { evidence } = deriveScJourneyFromHistory({
    // 即使我們丟一堆 reframe / surfaced, step_1 也不會被填.
    reframeHistory: [{ reframe_id: 'R2', day: 1, anchor_phrase_if_success: 'x' }],
    surfacedValues: ['y', 'z'],
    surfacedExamples: [{ day: 1, value: 'a', example: 'b' }],
    dailyTakeaways:   [{ day: 1, term: 'c' }],
  });
  assert.equal(evidence.step_1.length, 0,
    'step_1 pain_surface 必須永遠空');
});

test('🛑 derive: surfaced_values 主, 早期 takeaways (day ≤ 3) 退 fallback', () => {
  const a = deriveScJourneyFromHistory({
    surfacedValues: ['被理解', '自由'],
    dailyTakeaways: [{ day: 1, term: '勇氣' }, { day: 5, term: '太晚' }],
  });
  // surfaced 有 → 不用 takeaway fallback.
  assert.equal(a.evidence.step_2.length, 2);
  assert.deepEqual(a.evidence.step_2.map(e => e.quote), ['被理解', '自由']);

  const b = deriveScJourneyFromHistory({
    surfacedValues: [],
    dailyTakeaways: [
      { day: 1, term: '勇氣' },
      { day: 3, term: '誠實' },
      { day: 5, term: '已經太晚' },  // day>3 → 不算 early longing
    ],
  });
  assert.equal(b.evidence.step_2.length, 2);
  assert.deepEqual(b.evidence.step_2.map(e => e.quote), ['勇氣', '誠實']);
});

test('🛑 derive: sc_journey_step = max{N: step_N 非空}', () => {
  // 只 R3 命中 → step_3 有, 其他空 → sc_journey_step=3.
  const a = deriveScJourneyFromHistory({
    reframeHistory: [{ reframe_id: 'R3', day: 5, anchor_phrase_if_success: 'x' }],
  });
  assert.equal(a.step, 3);

  // R3 + R7 命中 → max=7.
  const b = deriveScJourneyFromHistory({
    reframeHistory: [
      { reframe_id: 'R3', day: 5, anchor_phrase_if_success: 'x' },
      { reframe_id: 'R7', day: 9, anchor_phrase_if_success: 'y' },
    ],
  });
  assert.equal(b.step, 7);

  // 只 surfaced_values → step_2 only → step=2.
  const c = deriveScJourneyFromHistory({ surfacedValues: ['x'] });
  assert.equal(c.step, 2);

  // 都空 → null.
  const d = deriveScJourneyFromHistory({});
  assert.equal(d.step, null);
});

test('🛑 derive: 多個 R1 / R1_E 命中 → step_6 多筆, type 都 sovereignty_reclaim', () => {
  const { evidence } = deriveScJourneyFromHistory({
    reframeHistory: [
      { reframe_id: 'R1',   day: 5, anchor_phrase_if_success: '我說了算 #1' },
      { reframe_id: 'R1_E', day: 7, anchor_phrase_if_success: '我說了算 #2' },
    ],
  });
  assert.equal(evidence.step_6.length, 2);
  assert.ok(evidence.step_6.every(e => e.type === 'sovereignty_reclaim'));
  assert.deepEqual(evidence.step_6.map(e => e.quote), ['我說了算 #1', '我說了算 #2']);
});

test('🛑 derive: PER_STEP_EVIDENCE_CAP 鎖死 — 超過上限只保留最後 N 筆', () => {
  const N = PER_STEP_EVIDENCE_CAP;
  // 10 筆 R3 → 應該只保留最後 5 筆 (latest wins).
  const hits = Array.from({ length: 10 }, (_, i) => ({
    reframe_id: 'R3', day: i + 1, anchor_phrase_if_success: `句${i + 1}`,
  }));
  const { evidence } = deriveScJourneyFromHistory({ reframeHistory: hits });
  assert.equal(evidence.step_3.length, N);
  // 最後 N 筆是 6..10.
  assert.deepEqual(evidence.step_3.map(e => e.quote),
    Array.from({ length: N }, (_, i) => `句${i + 6}`));
});

test('🛑 derive: full happy path — 5 reframe types + 2 surfaced values', () => {
  const { evidence, step } = deriveScJourneyFromHistory({
    reframeHistory: [
      { reframe_id: 'R3', day: 3, anchor_phrase_if_success: '我那時其實有把事情做出來' },
      { reframe_id: 'R2', day: 5, anchor_phrase_if_success: '我是會撐住的人' },
      { reframe_id: 'R5', day: 7, anchor_phrase_if_success: '我發現我會說「不」' },
      { reframe_id: 'R1', day: 9, anchor_phrase_if_success: '我自己說了算' },
      { reframe_id: 'R7', day: 11, anchor_phrase_if_success: '我就是這樣的人' },
    ],
    surfacedValues: ['被理解', '自由'],
  });
  assert.equal(evidence.step_1.length, 0, 'step_1 pain_surface 留空');
  assert.equal(evidence.step_2.length, 2, 'longing × 2');
  assert.equal(evidence.step_3.length, 1, 'data_mining × 1');
  assert.equal(evidence.step_4.length, 1, 'identity_claim × 1');
  assert.equal(evidence.step_5.length, 1, 'resource_retrieval × 1');
  assert.equal(evidence.step_6.length, 1, 'sovereignty_reclaim × 1');
  assert.equal(evidence.step_7.length, 1, 'anchoring × 1');
  assert.equal(step, 7, 'highest non-empty = 7');
  // type ↔ step 對齊 verify.
  assert.equal(evidence.step_3[0].type, 'data_mining');
  assert.equal(evidence.step_4[0].type, 'identity_claim');
  assert.equal(evidence.step_5[0].type, 'resource_retrieval');
  assert.equal(evidence.step_6[0].type, 'sovereignty_reclaim');
  assert.equal(evidence.step_7[0].type, 'anchoring');
});

test('🛑 derive: 素材稀疏 — 只有早期 takeaway → 只 step_2 有, sc_step=2', () => {
  const { evidence, step } = deriveScJourneyFromHistory({
    dailyTakeaways: [{ day: 2, term: '勇敢' }],
  });
  assert.equal(evidence.step_2.length, 1);
  assert.equal(evidence.step_2[0].quote, '勇敢');
  for (const n of [1, 3, 4, 5, 6, 7]) {
    assert.equal(evidence[`step_${n}`].length, 0,
      `step_${n} 應該空 (素材稀疏只動到 step_2)`);
  }
  assert.equal(step, 2);
});

// ═════════════════════════════════════════════════════════
// Defensive: garbage in (不應該炸)
// ═════════════════════════════════════════════════════════

test('🛡️ derive: malformed signals (null / 非陣列 / 物件混亂) → 不炸, 回空', () => {
  // null 整包 — 不該炸, 回 {evidence:全空, step:null}.
  const a = deriveScJourneyFromHistory(null);
  assert.equal(a.step, null);
  for (let n = 1; n <= 7; n++) assert.equal(a.evidence[`step_${n}`].length, 0);
  // 各欄丟亂值 (非陣列) — 全當沒給.
  const b = deriveScJourneyFromHistory({
    reframeHistory:   'not an array',
    surfacedValues:   { not: 'an array' },
    surfacedExamples: null,
    dailyTakeaways:   42,
  });
  assert.equal(b.step, null);
  for (let n = 1; n <= 7; n++) assert.equal(b.evidence[`step_${n}`].length, 0);
  // undefined 整包 (default parameter `={}` 路徑).
  const c = deriveScJourneyFromHistory(undefined);
  assert.equal(c.step, null);
});

test('🛡️ derive: reframeHistory 含 null / 缺 reframe_id 的 entry → 跳過, 不炸', () => {
  const { evidence, step } = deriveScJourneyFromHistory({
    reframeHistory: [
      null,
      undefined,
      { reframe_id: null },
      { reframe_id: 'R3', day: 3, anchor_phrase_if_success: '有效' },
      'not an object',
    ],
  });
  assert.equal(evidence.step_3.length, 1);
  assert.equal(evidence.step_3[0].quote, '有效');
  assert.equal(step, 3);
});
