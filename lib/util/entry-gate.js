// lib/util/entry-gate.js
// Patrick 6/2 — entry setup gate (regression 修 from 377e58e).
//
// 起因 (377e58e 帶出的 regression):
//   06dec38 三狀態原本是 entry 自身做「已認證但缺 setup」 redirect 進 renderEntrySetup,
//   但 377e58e 二輪重寫後 renderEntry 在「已認證 + preferredName 有」 case 直接 jump
//   /#/journey, 從未停留 entry. Landing → magic-link 的新 user (preferredName=null,
//   verify-link 給 pace='daily' default) 點過來 → /api/me 回給他們 studentId、
//   preferredName=null、pace='daily' → 後續路由 (route='journey' 或 magic-link 設的
//   target) 跳過 entry → 永遠沒被問稱謂 + 頻率.
//
// 修法: route() 在 hydrate 後、進 switch 前, 多一層 gate:
//   已認證 + (!preferredName || !pace) + 不在 entry/blocked → 強制 /#/entry.
//
// pace 由 /api/me 預設 'daily' (verify-link create 時 || 'daily'), 所以 !pace 路徑
// 實務上不會觸發, 但保留 spec 字面 (belt-and-suspenders). 真實 trigger 是 preferredName.

/**
 * 該不該強制 redirect 到 /#/entry 完成 setup?
 *
 *   true → caller 應該 location.hash = '#/entry'; return.
 *   false → 繼續 normal route.
 *
 *   觸發條件 (全成立):
 *     · studentId 有 (已認證、否則 hydrate gate 早 bounce 去 /entry 或 /blocked).
 *     · preferredName 空 OR pace 空 (setup 沒完成).
 *     · 當前 route 不是 'entry' 也不是 'blocked' (避免無限重導).
 *
 * @param {object} args
 * @param {string|null|undefined} args.studentId
 * @param {string|null|undefined} args.preferredName
 * @param {string|null|undefined} args.pace
 * @param {string} args.route
 * @returns {boolean}
 */
export function needsEntrySetup({ studentId, preferredName, pace, route } = {}) {
  if (!studentId) return false;              // 未認證 → hydrate gate 負責, 不是這層問題.
  if (preferredName && pace) return false;   // setup 完整 → 通過.
  if (route === 'entry' || route === 'blocked') return false;  // 已在 entry/blocked → 不重導.
  return true;
}
