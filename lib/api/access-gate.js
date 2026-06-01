// lib/api/access-gate.js
// Patrick 5/29 (Vivi 5/29 拍板) — 學員 access gate 決策層 (純函式).
//
// 兩個正交維度:
//   is_beta   — 是否封測者 (Vivi 手動標, 影響 30-day window 是否適用)
//   is_blocked — 是否被停用 (Vivi 手動 / 30 天 window 過期 lazy check)
//
// 此模組只決定「該不該擋 / 該不該觸發 lazy block」, 不做 I/O. caller (chat.js /
// conversation-today.js / verify-link.js / request-link.js / me.js) 負責 SQL +
// HTTP response shape.

export const BETA_WINDOW_DAYS = 30;
export const BETA_WINDOW_MS   = BETA_WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * 該學員當前已被 block? 簡單 truthy 檢查、容錯 null student.
 *
 * @param {object|null|undefined} student
 * @returns {boolean}
 */
export function isBlocked(student) {
  return !!(student && student.is_blocked === true);
}

/**
 * 決定是否該觸發 30-day window 自動失效.
 *
 *   返回 true → caller 應該 UPDATE students SET is_blocked=TRUE 並回 403.
 *
 *   條件 (全部成立才 trigger):
 *     · student.is_beta === true       (一般付費學員不適用 window)
 *     · student.is_blocked !== true    (已經 blocked 就不重複 trigger)
 *     · created_at 距 now > 30 天
 *     · 還沒 Day 21 完成 (hasDay21Complete=false)
 *
 *   anyone is_beta=false → false (即使過 30 天, 也不影響 — 一般學員可長期回訪).
 *   already blocked → false (避免重複 UPDATE).
 *   未來 / NaN created_at → false (defensive, 不誤觸發).
 *
 * @param {object} args
 * @param {object} args.student
 * @param {boolean} args.hasDay21Complete
 * @param {Date|number} [args.now]   defaults to Date.now()
 * @returns {boolean}
 */
export function shouldExpireBetaWindow({ student, hasDay21Complete, now } = {}) {
  if (!student || typeof student !== 'object') return false;
  if (student.is_blocked === true) return false;     // 已 blocked, 不重複 trigger
  if (student.is_beta !== true)    return false;     // 非封測者, window 不適用
  if (hasDay21Complete === true)   return false;     // 已完成 Day 21, 不該關 access

  const created = student.created_at;
  if (created === null || created === undefined) return false;
  const createdMs = created instanceof Date ? created.getTime() : new Date(created).getTime();
  if (!Number.isFinite(createdMs)) return false;     // 壞值 → 不誤觸發

  const nowMs = now instanceof Date ? now.getTime()
               : Number.isFinite(now) ? now
               : Date.now();
  return (nowMs - createdMs) > BETA_WINDOW_MS;
}

/**
 * 標準的「access 被擋」 response shape (給 status code = 403 的 endpoint 共用).
 * 文案是 Vivi 5/29 拍的「您的封測權限已結束、如有疑問請聯繫團隊」.
 */
export const BLOCKED_RESPONSE = Object.freeze({
  error:   'beta_access_ended',
  message: '您的封測權限已結束、如有疑問請聯繫團隊(lifecoach.vivichung@gmail.com)。',
});
