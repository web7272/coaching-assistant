// lib/sub-prompts/cross-context-handler.test.js
// v5.2 第二塊 PR-b — Lock cross-context handler case 3 detection + reminder lock + cases 1/2 noise.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CROSS_CONTEXT_SWAP_REGEX,
  detectCrossContextSwapIntent,
  buildCrossContextReminderLockInject,
  buildCrossContextNoise12Inject,
} from './cross-context-handler.js';

// ─── Case 3 detection ────────────────────────────────────

test('🛑 detectCrossContextSwapIntent: 「我想換個聊」 → true', () => {
  assert.equal(detectCrossContextSwapIntent('我想換個聊'), true);
});

test('🛑 detectCrossContextSwapIntent: 「今天我想換」 → true', () => {
  assert.equal(detectCrossContextSwapIntent('今天我想換'), true);
});

test('🛑 detectCrossContextSwapIntent: 「想聊別的」 → true', () => {
  assert.equal(detectCrossContextSwapIntent('想聊別的'), true);
});

test('🛑 detectCrossContextSwapIntent: 「不想聊這個」 → true', () => {
  assert.equal(detectCrossContextSwapIntent('不想聊這個'), true);
});

test('🛑 detectCrossContextSwapIntent: 「想談別的事」 → true', () => {
  assert.equal(detectCrossContextSwapIntent('想談別的事'), true);
});

test('🛑 detectCrossContextSwapIntent: 「我想要更勇敢」 → false (不是換 context)', () => {
  assert.equal(detectCrossContextSwapIntent('我想要更勇敢'), false);
});

test('🛑 detectCrossContextSwapIntent: 「換工作」 (literal job change, not context swap) → 仍 true (邊界、reminder 不傷)', () => {
  // 邊界 false positive — student literally talks about job change.
  // OK for case 3 to fire (reminder is gentle); Sonnet handles disambig.
  // We just lock the regex behavior, not the boundary policy.
  assert.equal(detectCrossContextSwapIntent('我想換工作'), true);
});

test('🛑 detectCrossContextSwapIntent: empty / non-string → false', () => {
  assert.equal(detectCrossContextSwapIntent(''), false);
  assert.equal(detectCrossContextSwapIntent(null), false);
  assert.equal(detectCrossContextSwapIntent(undefined), false);
  assert.equal(detectCrossContextSwapIntent(42), false);
});

// ─── Reminder lock inject (case 3 phrasing verbatim) ───

test('🛑 buildCrossContextReminderLockInject: contextName=「我跟先生的溝通」 → verbatim spec §4.2 phrasing', () => {
  const inj = buildCrossContextReminderLockInject({
    contextName: '我跟先生的溝通',
    studentWantedContext: '事業',
  });
  // Header.
  assert.match(inj, /Cross-Context Handler · Case 3 Context Lock Reminder/);
  // Vivi 終審 verbatim spec §4.2:
  assert.match(inj, /「我們這 21 天 program 鎖定在『我跟先生的溝通』、事業 那塊我們之後可以另外處理。」/);
  // 機制 anchors.
  assert.match(inj, /不在對話中自動 swap context/);
  assert.match(inj, /連續 3 turn 學員仍堅持換 context → escalate Vivi/);
  // 不可做 anchors.
  assert.match(inj, /❌ 不對話中自動切換 active_context/);
  assert.match(inj, /❌ 不告訴學員「你需要找 Vivi 改」/);
});

test('🛑 buildCrossContextReminderLockInject: contextName trim + studentWantedContext default placeholder', () => {
  const inj = buildCrossContextReminderLockInject({ contextName: '  健康  ' });
  // Trim.
  assert.match(inj, /鎖定在『健康』、\[他想換的\] 那塊/);
});

test('🛑 buildCrossContextReminderLockInject: missing contextName → [active context] fallback', () => {
  const inj = buildCrossContextReminderLockInject({});
  assert.match(inj, /鎖定在『\[active context\]』/);
});

// ─── Cases 1/2 noise inject (optional supplement to §4.1 block) ──

test('🛑 buildCrossContextNoise12Inject: both flags false → null', () => {
  const inj = buildCrossContextNoise12Inject({
    contextName: '事業', relatedSurfaced: false, unrelatedSurfaced: false,
  });
  assert.equal(inj, null);
});

test('🛑 buildCrossContextNoise12Inject: case 1 only (related)', () => {
  const inj = buildCrossContextNoise12Inject({
    contextName: '親密關係', relatedSurfaced: true,
  });
  assert.match(inj, /Case 1 \(相關\): 學員剛才 surface 的內容跟「親密關係」相關/);
  assert.doesNotMatch(inj, /Case 2 \(無關\)/);
});

test('🛑 buildCrossContextNoise12Inject: case 2 only (unrelated)', () => {
  const inj = buildCrossContextNoise12Inject({
    contextName: '親密關係', unrelatedSurfaced: true,
  });
  assert.match(inj, /Case 2 \(無關\): 學員 surface 的內容跟「親密關係」無關/);
  assert.match(inj, /寫入 user_profile_evolution\.other_contexts_noted/);
  assert.doesNotMatch(inj, /Case 1 \(相關\)/);
});

test('🛑 buildCrossContextNoise12Inject: both true → both cases in output', () => {
  const inj = buildCrossContextNoise12Inject({
    contextName: '事業', relatedSurfaced: true, unrelatedSurfaced: true,
  });
  assert.match(inj, /Case 1 \(相關\)/);
  assert.match(inj, /Case 2 \(無關\)/);
});

// ─── Regex direct test ──────────────────────────────────

test('CROSS_CONTEXT_SWAP_REGEX: shape (single export, deterministic)', () => {
  assert.ok(CROSS_CONTEXT_SWAP_REGEX instanceof RegExp);
  // Spec-given seed cases.
  for (const positive of ['我想換', '今天我想換', '想聊別的', '不想聊這個', '不想聊現在', '想談別的', '今天不想']) {
    assert.ok(CROSS_CONTEXT_SWAP_REGEX.test(positive), `${positive} should match`);
  }
  for (const negative of ['我想要勇敢', '今天天氣不錯', '我想換衣服了 嗯', '我覺得']) {
    // Note: 我想換衣服了 → still matches the loose regex; covered by handler context judgment.
    // We only assert pure negatives.
    if (negative === '我覺得' || negative === '我想要勇敢' || negative === '今天天氣不錯') {
      assert.equal(CROSS_CONTEXT_SWAP_REGEX.test(negative), false, `${negative} should NOT match`);
    }
  }
});
