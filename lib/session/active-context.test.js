// lib/session/active-context.test.js
// v5.2 第二塊 PR-a — Lock active_context inject block + derive helper.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CATEGORY_CODES, CATEGORY_LABELS_ZH, CATEGORY_SHORT_LABELS,
  ACTIVE_CONTEXT_BLOCK_TOKEN_ESTIMATE,
  buildActiveContextBlock, deriveContextNameForPhrasing, pickActiveContext,
} from './active-context.js';

// ─── enums (verbatim spec §1.3) ────────────────────────────

test('🛑 CATEGORY_CODES: 5 entries verbatim spec §1.3 (英文 internal codes)', () => {
  assert.ok(Object.isFrozen(CATEGORY_CODES));
  assert.equal(CATEGORY_CODES[1], 'career_work_money');
  assert.equal(CATEGORY_CODES[2], 'intimate_relationship');
  assert.equal(CATEGORY_CODES[3], 'family');
  assert.equal(CATEGORY_CODES[4], 'health');
  assert.equal(CATEGORY_CODES[5], 'self_internal');
});

test('🛑 CATEGORY_LABELS_ZH: 5 entries verbatim (顯示在 Active Context block)', () => {
  assert.ok(Object.isFrozen(CATEGORY_LABELS_ZH));
  assert.equal(CATEGORY_LABELS_ZH[1], '事業 / 工作 / 金錢');
  assert.equal(CATEGORY_LABELS_ZH[2], '親密關係 (伴侶 / 戀愛)');
  assert.equal(CATEGORY_LABELS_ZH[3], '家庭 (原生家庭 / 子女)');
  assert.equal(CATEGORY_LABELS_ZH[4], '健康 / 身體');
  assert.equal(CATEGORY_LABELS_ZH[5], '自我 / 內在狀態 / 心理');
});

test('🛑 CATEGORY_SHORT_LABELS: 5 entries verbatim (phrasing anchor fallback)', () => {
  assert.ok(Object.isFrozen(CATEGORY_SHORT_LABELS));
  assert.deepEqual(CATEGORY_SHORT_LABELS, Object.freeze({
    1: '事業', 2: '親密關係', 3: '家庭', 4: '健康', 5: '自我',
  }));
});

test('ACTIVE_CONTEXT_BLOCK_TOKEN_ESTIMATE: 80 (spec §4.1)', () => {
  assert.equal(ACTIVE_CONTEXT_BLOCK_TOKEN_ESTIMATE, 80);
});

// ─── buildActiveContextBlock — spec §4.1 verbatim template ─

test('🛑 buildActiveContextBlock: category=2 + name + definition → full block verbatim', () => {
  const block = buildActiveContextBlock({
    category: 2,
    name: '我跟先生的溝通',
    definition: '主要是日常溝通、不含原生家庭',
  });
  // Header verbatim.
  assert.match(block, /^\[Active Context\]/);
  // Category line uses 中文 full label (not the internal code).
  assert.match(block, /Category: 親密關係 \(伴侶 \/ 戀愛\)/);
  assert.match(block, /Name: 我跟先生的溝通/);
  assert.match(block, /Definition: 主要是日常溝通、不含原生家庭/);
  // §4.1 body anchors.
  assert.match(block, /Today's conversation focuses on this context\./);
  assert.match(block, /All your questions and reflections should anchor to this context\./);
  assert.match(block, /If learner surfaces content from other contexts:/);
  assert.match(block, /- If related to active_context → integrate as evidence/);
  assert.match(block, /- If completely unrelated → acknowledge, note, return to active_context/);
  assert.match(block, /Do not initiate cross-context exploration unless learner naturally surfaces\.$/);
});

test('🛑 buildActiveContextBlock: name null → fallback to 中文 category label', () => {
  // Vivi 6/5: migration 029 default 事業, 但 name 還沒填 (待 Vivi 一一聯繫).
  const block = buildActiveContextBlock({ category: 1, name: null, definition: null });
  assert.ok(block);
  assert.match(block, /Category: 事業 \/ 工作 \/ 金錢/);
  assert.match(block, /Name: 事業 \/ 工作 \/ 金錢/);   // fallback to category label
  assert.match(block, /Definition: \(unspecified, learner to surface as they speak\)/);
});

test('🛑 buildActiveContextBlock: name whitespace → fallback (treat as empty)', () => {
  const block = buildActiveContextBlock({ category: 3, name: '   ', definition: '   ' });
  assert.match(block, /Name: 家庭 \(原生家庭 \/ 子女\)/);
  assert.match(block, /Definition: \(unspecified/);
});

test('🛑 buildActiveContextBlock: category invalid (0/6/null/string) → null (graceful fallback)', () => {
  for (const bad of [0, 6, null, undefined, NaN, 'x', '1']) {
    if (bad === '1') continue;   // numeric strings caster intentional handle
    assert.equal(buildActiveContextBlock({ category: bad }), null, `${bad} → null`);
  }
});

test('🛑 buildActiveContextBlock: empty args → null', () => {
  assert.equal(buildActiveContextBlock(), null);
  assert.equal(buildActiveContextBlock({}), null);
});

test('🛑 buildActiveContextBlock: trim name/definition before display', () => {
  const block = buildActiveContextBlock({
    category: 2, name: '  我跟先生的溝通  ', definition: '  主要是日常  ',
  });
  // Trimmed values appear (no leading/trailing spaces in Name/Definition lines).
  assert.match(block, /Name: 我跟先生的溝通\n/);
  assert.match(block, /Definition: 主要是日常\n/);
});

// ─── deriveContextNameForPhrasing — PR-b phrasing anchor ───

test('🛑 deriveContextNameForPhrasing: name set → use name', () => {
  assert.equal(
    deriveContextNameForPhrasing({ category: 2, name: '我跟先生的溝通' }),
    '我跟先生的溝通',
  );
});

test('🛑 deriveContextNameForPhrasing: name null → category 短字 fallback', () => {
  assert.equal(deriveContextNameForPhrasing({ category: 1, name: null }), '事業');
  assert.equal(deriveContextNameForPhrasing({ category: 2, name: null }), '親密關係');
  assert.equal(deriveContextNameForPhrasing({ category: 3, name: null }), '家庭');
  assert.equal(deriveContextNameForPhrasing({ category: 4, name: null }), '健康');
  assert.equal(deriveContextNameForPhrasing({ category: 5, name: null }), '自我');
});

test('🛑 deriveContextNameForPhrasing: name whitespace → fallback to category 短字', () => {
  assert.equal(deriveContextNameForPhrasing({ category: 3, name: '   ' }), '家庭');
});

test('🛑 deriveContextNameForPhrasing: invalid category → null (PR-b uses v5.1 phrasing)', () => {
  for (const bad of [0, 6, null, undefined, NaN]) {
    assert.equal(deriveContextNameForPhrasing({ category: bad, name: 'x' }), null);
  }
});

// ─── pickActiveContext — extract from row ────────────────

test('🛑 pickActiveContext: extracts 3 fields from student row', () => {
  const r = pickActiveContext({
    student_id: 'A006',
    active_context_category: 2,
    active_context_name: '我跟先生的溝通',
    active_context_definition: '主要是日常溝通',
  });
  assert.deepEqual(r, {
    category: 2,
    name: '我跟先生的溝通',
    definition: '主要是日常溝通',
  });
});

test('🛑 pickActiveContext: missing/invalid → { null, null, null } (in-progress 不 break)', () => {
  assert.deepEqual(pickActiveContext(null),
    { category: null, name: null, definition: null });
  assert.deepEqual(pickActiveContext({}),
    { category: null, name: null, definition: null });
  assert.deepEqual(pickActiveContext({ active_context_category: 0 }),
    { category: null, name: null, definition: null });
  assert.deepEqual(pickActiveContext({ active_context_category: 6 }),
    { category: null, name: null, definition: null });
});

test('🛑 pickActiveContext: category 1-5 each pass through', () => {
  for (let cat = 1; cat <= 5; cat++) {
    const r = pickActiveContext({ active_context_category: cat });
    assert.equal(r.category, cat);
  }
});
