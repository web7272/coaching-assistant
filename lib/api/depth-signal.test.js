// lib/api/depth-signal.test.js
// Patrick 5/29 — PRODUCT-TRUTH v2.3 §2.5 depth signal helper.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { computeDepthSignal } from './depth-signal.js';

// ─── 0: 還沒開始 ────────────────────────────────────────────────────

test('depth 0: turnCount=0 → 0 even with non-empty state', () => {
  assert.equal(computeDepthSignal({ current_quality_status: 'owned' }, 0), 0);
  assert.equal(computeDepthSignal({}, 0), 0);
});

test('depth 0: turnCount missing / undefined → 0', () => {
  assert.equal(computeDepthSignal({}), 0);
  assert.equal(computeDepthSignal(null), 0);
});

// ─── 1: 開始對話, quality=none ───────────────────────────────────────

test('depth 1: turnCount>0 + quality=none → 1', () => {
  assert.equal(computeDepthSignal({ current_quality_status: 'none' }, 1), 1);
  assert.equal(computeDepthSignal({ current_quality_status: 'none' }, 5), 1);
});

test('depth 1: turnCount>0 + missing quality_status → 1 (defensive default)', () => {
  assert.equal(computeDepthSignal({}, 3), 1);
  assert.equal(computeDepthSignal(null, 3), 1);
});

// ─── 2: candidate (身份測試啟動) ────────────────────────────────────

test('depth 2: candidate → 2', () => {
  assert.equal(computeDepthSignal({ current_quality_status: 'candidate' }, 3), 2);
});

// ─── 3: ambiguous (挖中、未收斂) ────────────────────────────────────

test('depth 3: ambiguous → 3', () => {
  assert.equal(computeDepthSignal({ current_quality_status: 'ambiguous' }, 5), 3);
});

// ─── 4: owned / owned_via_acceptance ────────────────────────────────

test('depth 4: owned → 4', () => {
  assert.equal(computeDepthSignal({ current_quality_status: 'owned' }, 6), 4);
});

test('depth 4: owned_via_acceptance → 4 (P18 fallback path)', () => {
  assert.equal(computeDepthSignal({ current_quality_status: 'owned_via_acceptance' }, 6), 4);
});

// ─── 5: 收尾層 (takeaway seeded / cascade completed) ────────────────

test('🛑 depth 5: takeaway_seeded_this_session=true → 5', () => {
  assert.equal(
    computeDepthSignal({
      current_quality_status: 'owned',
      takeaway_seeded_this_session: true,
    }, 9),
    5,
  );
});

test('🛑 depth 5: cascade_down_progress.status=completed → 5', () => {
  assert.equal(
    computeDepthSignal({
      current_quality_status: 'owned',
      cascade_down_progress: { status: 'completed', step: 3 },
    }, 9),
    5,
  );
});

test('depth 5: takeaway_seeded wins over absent owned (defensive)', () => {
  assert.equal(
    computeDepthSignal({
      current_quality_status: 'ambiguous',
      takeaway_seeded_this_session: true,
    }, 9),
    5,
  );
});

// ─── 邊界 / 防禦 ────────────────────────────────────────────────────

test('cascade_down_progress 但 status !== completed → 不算 5', () => {
  assert.equal(
    computeDepthSignal({
      current_quality_status: 'ambiguous',
      cascade_down_progress: { status: 'in_progress', step: 1 },
    }, 5),
    3,
  );
});

test('cascade_down_progress=null → 不算 5', () => {
  assert.equal(
    computeDepthSignal({
      current_quality_status: 'owned',
      cascade_down_progress: null,
    }, 9),
    4,
  );
});

test('未知 quality_status 值 → 1 (走到了但 enum 對不上)', () => {
  assert.equal(
    computeDepthSignal({ current_quality_status: 'some_weird_value' }, 3),
    1,
  );
});

test('takeaway_seeded_this_session=false → 依其他欄位走 (不誤觸發 5)', () => {
  assert.equal(
    computeDepthSignal({
      current_quality_status: 'candidate',
      takeaway_seeded_this_session: false,
    }, 3),
    2,
  );
});

test('🛑 monotonic order: 0 < 1 < 2 < 3 < 4 < 5 (沒有跳格)', () => {
  const seq = [
    computeDepthSignal(null, 0),                                          // 0
    computeDepthSignal({ current_quality_status: 'none' }, 1),            // 1
    computeDepthSignal({ current_quality_status: 'candidate' }, 1),       // 2
    computeDepthSignal({ current_quality_status: 'ambiguous' }, 1),       // 3
    computeDepthSignal({ current_quality_status: 'owned' }, 1),           // 4
    computeDepthSignal({ takeaway_seeded_this_session: true }, 1),        // 5
  ];
  assert.deepEqual(seq, [0, 1, 2, 3, 4, 5]);
});

test('🛑 範圍鎖死: 永遠 0..5、不會超 (paper-aesthetic invariant)', () => {
  for (let i = 0; i < seq().length; i++) {
    const n = seq()[i];
    assert.ok(n >= 0 && n <= 5, `depth signal must be 0..5; got ${n}`);
  }
  function seq() {
    return [
      computeDepthSignal({}, 0),
      computeDepthSignal({}, 100),
      computeDepthSignal({ takeaway_seeded_this_session: true }, 999),
    ];
  }
});
