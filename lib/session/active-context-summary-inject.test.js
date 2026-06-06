// lib/session/active-context-summary-inject.test.js
// v5.2 第三塊 PR-b — Lock buildActiveContextSummaryInject + bug #7 anti-repeat.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildActiveContextSummaryInject, readCategoryBucket,
  MAX_EXAMPLES_PER_INJECT, MAX_CHARS_PER_EXAMPLE,
} from './active-context-summary-inject.js';

// ─── Constants (spec §5.2 token budget) ───────────────────

test('🛑 MAX_EXAMPLES_PER_INJECT = 8 (token cap spec §5.2)', () => {
  assert.equal(MAX_EXAMPLES_PER_INJECT, 8);
});

test('🛑 MAX_CHARS_PER_EXAMPLE = 100 (single example cap spec §5.2)', () => {
  assert.equal(MAX_CHARS_PER_EXAMPLE, 100);
});

// ─── readCategoryBucket ──────────────────────────────────

test('🛑 readCategoryBucket: extracts per-category bucket from JSONB', () => {
  const summary = {
    '2': { surfaced_values: ['被愛'], surfaced_examples: [{ day: 1, value: '被愛', example: 'x' }], last_updated_day: 1 },
    '3': { surfaced_values: ['自由'], surfaced_examples: [], last_updated_day: 0 },
  };
  const b = readCategoryBucket(summary, 2);
  assert.deepEqual(b.surfaced_values, ['被愛']);
  assert.equal(b.surfaced_examples.length, 1);
  assert.equal(b.last_updated_day, 1);
});

test('🛑 readCategoryBucket: missing category → null', () => {
  assert.equal(readCategoryBucket({ '2': {} }, 3), null);
});

test('🛑 readCategoryBucket: invalid summary → null', () => {
  assert.equal(readCategoryBucket(null, 1), null);
  assert.equal(readCategoryBucket('not object', 1), null);
  assert.equal(readCategoryBucket({}, 6), null);
  assert.equal(readCategoryBucket({}, 0), null);
});

// ─── buildActiveContextSummaryInject — happy paths ──────

test('🛑 v5.2 buildActiveContextSummaryInject: spec §5.2 template verbatim w/ values + examples', () => {
  const inj = buildActiveContextSummaryInject({
    summaryJsonb: {
      '2': {
        surfaced_values: ['被愛', '溝通'],
        surfaced_examples: [
          { day: 1, value: '被愛', example: '昨天先生陪我去看媽媽' },
          { day: 3, value: '溝通', example: '我跟他直接說了' },
        ],
        last_updated_day: 3,
      },
    },
    category: 2,
    contextName: '我跟先生的溝通',
  });
  // Header verbatim with contextName.
  assert.match(inj, /^\[Cross-Session Memory in 我跟先生的溝通\]/);
  // Values listed.
  assert.match(inj, /Surfaced values so far: 被愛、溝通/);
  // Examples format「  - Day {N}: {value} - "{example}"」.
  assert.match(inj, /  - Day 1: 被愛 - "昨天先生陪我去看媽媽"/);
  assert.match(inj, /  - Day 3: 溝通 - "我跟他直接說了"/);
  // Verbatim anti-repeat directive (bug #7 fix).
  assert.match(inj, /Do not re-ask the same value or example again\./);
  assert.match(inj, /Build on what learner already surfaced\.$/);
});

test('🛑 v5.2 buildActiveContextSummaryInject: contextName null → category 短字 fallback', () => {
  const inj = buildActiveContextSummaryInject({
    summaryJsonb: { '1': { surfaced_values: ['勇敢'], surfaced_examples: [] } },
    category: 1,
    contextName: null,
  });
  assert.match(inj, /\[Cross-Session Memory in 事業\]/);
});

test('🛑 v5.2 buildActiveContextSummaryInject: contextName whitespace → category 短字 fallback', () => {
  const inj = buildActiveContextSummaryInject({
    summaryJsonb: { '3': { surfaced_values: ['關懷'], surfaced_examples: [] } },
    category: 3,
    contextName: '   ',
  });
  assert.match(inj, /\[Cross-Session Memory in 家庭\]/);
});

// ─── Fallback (empty / missing summary) → null ──────────

test('🛑 v5.2 buildActiveContextSummaryInject: empty bucket → null (fallback to 昨天素材)', () => {
  const inj = buildActiveContextSummaryInject({
    summaryJsonb: { '2': { surfaced_values: [], surfaced_examples: [] } },
    category: 2,
  });
  assert.equal(inj, null, 'empty bucket should skip inject');
});

test('🛑 v5.2 buildActiveContextSummaryInject: missing category in summary → null', () => {
  const inj = buildActiveContextSummaryInject({
    summaryJsonb: { '1': { surfaced_values: ['勇敢'], surfaced_examples: [] } },
    category: 3,
    contextName: '家庭',
  });
  assert.equal(inj, null);
});

test('🛑 v5.2 buildActiveContextSummaryInject: summaryJsonb null → null (graceful fallback)', () => {
  const inj = buildActiveContextSummaryInject({
    summaryJsonb: null, category: 1, contextName: '事業',
  });
  assert.equal(inj, null);
});

// ─── 換領域乾淨切換 — only reads new category ───────────

test('🛑 v5.2 buildActiveContextSummaryInject: 換領域 — category 3 inject does NOT include category 1 累積', () => {
  // Vivi 一一聯繫學員後將 category 1→3, runtime 只讀新 category bucket.
  const summary = {
    '1': {
      surfaced_values: ['事業勇敢', '事業堅毅'],
      surfaced_examples: [{ day: 1, value: '事業勇敢', example: '上週 push back 主管' }],
    },
    '3': {   // new category after switch
      surfaced_values: ['家庭關懷'],
      surfaced_examples: [{ day: 10, value: '家庭關懷', example: '昨天陪媽媽' }],
    },
  };
  const inj = buildActiveContextSummaryInject({
    summaryJsonb: summary, category: 3, contextName: '家庭',
  });
  // 家庭 bucket loaded.
  assert.match(inj, /家庭關懷/);
  assert.match(inj, /昨天陪媽媽/);
  // 事業 bucket NOT leaked.
  assert.doesNotMatch(inj, /事業勇敢/);
  assert.doesNotMatch(inj, /事業堅毅/);
  assert.doesNotMatch(inj, /push back 主管/);
});

// ─── Token control — 8 examples max ─────────────────────

test('🛑 v5.2 buildActiveContextSummaryInject: > 8 examples → trim to most recent 8', () => {
  const examples = [];
  for (let day = 1; day <= 15; day++) {
    examples.push({ day, value: `val${day}`, example: `ex${day}` });
  }
  const inj = buildActiveContextSummaryInject({
    summaryJsonb: { '1': { surfaced_values: ['v'], surfaced_examples: examples } },
    category: 1,
  });
  // Should contain Day 8-15 (most recent 8), NOT Day 1-7.
  for (let day = 8; day <= 15; day++) {
    assert.match(inj, new RegExp(`Day ${day}:`), `Day ${day} should appear`);
  }
  for (let day = 1; day <= 7; day++) {
    assert.doesNotMatch(inj, new RegExp(`Day ${day}:`), `Day ${day} should be trimmed`);
  }
});

test('🛑 v5.2 buildActiveContextSummaryInject: examples sorted ASC after trim', () => {
  const examples = [
    { day: 7, value: 'v7', example: 'e7' },
    { day: 1, value: 'v1', example: 'e1' },
    { day: 5, value: 'v5', example: 'e5' },
  ];
  const inj = buildActiveContextSummaryInject({
    summaryJsonb: { '2': { surfaced_values: ['v'], surfaced_examples: examples } },
    category: 2, contextName: 'X',
  });
  const idx1 = inj.indexOf('Day 1');
  const idx5 = inj.indexOf('Day 5');
  const idx7 = inj.indexOf('Day 7');
  assert.ok(idx1 < idx5 && idx5 < idx7, 'examples should display in ascending day order');
});

// ─── Token control — single example ≤ 100 chars ────────

test('🛑 v5.2 buildActiveContextSummaryInject: example > 100 chars → truncate + ellipsis', () => {
  const long = 'x'.repeat(150);
  const inj = buildActiveContextSummaryInject({
    summaryJsonb: { '1': {
      surfaced_values: ['v'],
      surfaced_examples: [{ day: 1, value: 'v', example: long }],
    } },
    category: 1,
  });
  // 100 chars + … (ellipsis appended).
  assert.match(inj, /xxx…"/);
  // Total runaway not in output.
  assert.doesNotMatch(inj, /x{150}/);
});

// ─── Dedup defense ──────────────────────────────────────

test('🛑 v5.2 buildActiveContextSummaryInject: duplicate values deduped (defense in depth)', () => {
  const inj = buildActiveContextSummaryInject({
    summaryJsonb: { '2': {
      surfaced_values: ['被愛', '被愛', '溝通'],
      surfaced_examples: [],
    } },
    category: 2, contextName: '親密關係',
  });
  // 被愛 should appear once in the comma-joined list.
  const occurrences = (inj.match(/被愛/g) || []).length;
  assert.equal(occurrences, 1, `expected '被愛' once, got ${occurrences}`);
});

// ─── Defensive — values empty but examples present ──────

test('🛑 v5.2 buildActiveContextSummaryInject: examples only (values empty) → inject still emits', () => {
  const inj = buildActiveContextSummaryInject({
    summaryJsonb: { '4': {
      surfaced_values: [],
      surfaced_examples: [{ day: 1, value: null, example: '今天健身' }],
    } },
    category: 4, contextName: '健康',
  });
  assert.ok(inj);
  assert.match(inj, /Surfaced values so far: \(none surfaced yet\)/);
  // Falls back to "(no value)" for null value field.
  assert.match(inj, /Day 1: \(no value\) - "今天健身"/);
});

// ─── Defensive — examples empty but values present ──────

test('🛑 v5.2 buildActiveContextSummaryInject: values only (examples empty) → inject still emits w/ fallback line', () => {
  const inj = buildActiveContextSummaryInject({
    summaryJsonb: { '5': {
      surfaced_values: ['自我接納'],
      surfaced_examples: [],
    } },
    category: 5, contextName: '自我',
  });
  assert.ok(inj);
  assert.match(inj, /Surfaced values so far: 自我接納/);
  assert.match(inj, /\(no specific examples surfaced yet\)/);
});
