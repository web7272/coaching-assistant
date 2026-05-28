// lib/api/depth-signal.js
// Patrick 5/29 — PRODUCT-TRUTH v2.3 §2.5 鬆綁: 折衷 (a) 採集深度視覺指示.
//
// 鐵則 (來自 §2.5 — 別違反):
//   1. 不是計分: 沒有「達成 X/5」「進度 60%」這種語言.
//   2. 不壓力: dot 點亮 = 「✦ 走到了這層」, 不是「還差幾層才結束」.
//   3. 紙感: 褪色、安靜、無動畫.
//   4. 不阻擋: 學員不看也能對話.
//   5. 不影響 prompt / 邏輯: 只是 UI 指示, backend 邏輯不動.
//
// 此模組純函式、回 0..5、給 chat.js response payload 用. 算法錨在 engine-2
// 真實 quality_status 轉移路徑:
//   engine-2.js: 'none' → 'candidate' (身份測試啟動)
//                       → 'ambiguous' (挖中、未收斂)
//                       → 'owned' (採集到 owned quality)
//   engine-3.js: cascade_down_progress.status='completed' (chunk-down 走完底)
//   engine-4.js: takeaway_seeded_this_session=true (Day 收尾種子已下)
//
// 跨日 reset 由 lib/session/day-boundary.js RESET_FIELDS 處理 (含
// current_quality_status, cascade_down_progress, takeaway_seeded_this_session
// 都在白名單) → 隔日 signal 自然回 0/1.
//
// 單調性 (走過不會倒退) 由 frontend 維持 watermark 處理, 此處只給 snapshot.

const QUALITY_OWNED = new Set(['owned', 'owned_via_acceptance']);

/**
 * Compute depth signal 0..5 from session_state snapshot.
 *
 *   0: 還沒開始 — turnCount=0 (尚未對話).
 *   1: 開始對話 — 有 turn, quality 還在 none.
 *   2: candidate — engine-2 已抓到候選 quality, 身份測試啟動.
 *   3: ambiguous — 挖中、quality 還未收斂 owned.
 *   4: owned — 採集到 owned quality (含 owned_via_acceptance fallback).
 *   5: 收尾層 — cascade_down 走完底 OR takeaway 已 seeded.
 *
 * @param {object|null|undefined} sessionState
 * @param {number} [turnCount]
 * @returns {number}  0..5
 */
export function computeDepthSignal(sessionState, turnCount) {
  if (!turnCount || turnCount <= 0) return 0;
  const s = sessionState || {};

  // 5: 收尾層 (任一條件即觸發).
  if (s.takeaway_seeded_this_session === true) return 5;
  if (s.cascade_down_progress
      && typeof s.cascade_down_progress === 'object'
      && s.cascade_down_progress.status === 'completed') {
    return 5;
  }

  // 4: owned / owned_via_acceptance.
  if (typeof s.current_quality_status === 'string'
      && QUALITY_OWNED.has(s.current_quality_status)) {
    return 4;
  }

  // 3: ambiguous.
  if (s.current_quality_status === 'ambiguous') return 3;

  // 2: candidate (身份測試啟動).
  if (s.current_quality_status === 'candidate') return 2;

  // 1: turn 走了、quality 仍 'none' / 未知.
  return 1;
}
