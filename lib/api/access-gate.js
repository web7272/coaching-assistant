// lib/api/access-gate.js
// Patrick 5/29 (Vivi 5/29 拍板) — 學員 access gate 決策層 (純函式).
// Patrick 6/13 (Vivi 6/13 拍板) — **政策反轉**:`is_beta=true` 凌駕一切.
//
//   舊政策 (5/29 ~ 6/12):
//     封測者 30 天 window 過期 → 自動 lazy 設 is_blocked=TRUE + 403.
//     結果線上問題 — 封測者 A003 走完 Day 1 後過期被擋 (#/upgrade).
//
//   新政策 (6/13, Vivi 拍板):
//     is_beta=true 無條件放行. 不再有任何 window / trial gate / is_blocked
//     可以擋封測者. 代價 (已同意): 封測者無限期免費全程. 要擋某個封測者 →
//     把該人 is_beta 設 false (光設 is_blocked 擋不住, 因 is_beta 凌駕).
//
//   實作分工:
//     · 此 module 只 export `isBlocked` + `BLOCKED_RESPONSE` (純函式 / 純常數).
//     · caller (chat.js / conversation-today.js) 自己負責檢查 `is_beta` 是否
//       凌駕 — 因為 `is_beta` 旗號需跟 SELECT 撈出來、不適合塞進這層.
//     · `shouldExpireBetaWindow` 已移除 (6/13). `BETA_WINDOW_MS` 同移除.
//     · `BETA_WINDOW_DAYS = 30` 保留 — admin-students 拿來算
//       `days_remaining_in_beta_window` 顯示給 Vivi 後台參考用 (純資訊性,
//       不再自動 enforce). 名字保留以免破壞既有 UI label.
//
// 此模組只決定「該不該擋」, 不做 I/O. caller (chat.js / conversation-today.js /
// verify-link.js / request-link.js / me.js) 負責 SQL + HTTP response shape.

/**
 * Admin reference threshold (6/13 起為純資訊欄,不再 enforce).
 *
 *   用途:`lib/api/admin-students.js` 拿來算 `days_remaining_in_beta_window`,
 *   讓 Vivi 後台知道某個 is_beta=true 學員「離原 30 天參考點還剩幾天」,
 *   作為「要不要 revoke is_beta」的決策參考. NOT used as an auto-block gate.
 */
export const BETA_WINDOW_DAYS = 30;

/**
 * 該學員當前已被 block? 簡單 truthy 檢查、容錯 null student.
 *
 *   ⚠️ caller 必須先檢查 `is_beta === true` (政策 6/13:is_beta 凌駕). 此函式
 *   不知道 is_beta, 故不在這裡判斷; 由 caller 做 `isBlocked(s) && !isBetaPass`
 *   組合條件. 範例:
 *     const isBetaPass = studentRow?.is_beta === true;
 *     if (isBlocked(studentRow) && !isBetaPass) return res.status(403)...
 *
 * @param {object|null|undefined} student
 * @returns {boolean}
 */
export function isBlocked(student) {
  return !!(student && student.is_blocked === true);
}

/**
 * 標準的「access 被擋」 response shape (給 status code = 403 的 endpoint 共用).
 * 文案是 Vivi 5/29 拍的「您的封測權限已結束、如有疑問請聯繫團隊」.
 */
export const BLOCKED_RESPONSE = Object.freeze({
  error:   'beta_access_ended',
  message: '您的封測權限已結束、如有疑問請聯繫團隊(lifecoach.vivichung@gmail.com)。',
});
