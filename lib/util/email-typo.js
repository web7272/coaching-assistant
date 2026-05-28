// lib/util/email-typo.js
// Patrick 5/28 — 常見 email 網域 typo 偵測 (Levenshtein distance = 1).
// 預防 A006 case: 用戶把 @gmail.com 打成 @gamil.com → 信永遠送不到 →
// 看似申請成功但 token 過期. 非阻擋、只提示「你是不是要輸入 ...?」.
//
// ⚠️ 同份邏輯也內聯在 student.js (UMD/classic-script loader 不能 import 這支),
//    任何更動兩處同步、靠 lib/util/email-typo.test.js 鎖住行為.

export const KNOWN_EMAIL_DOMAINS = Object.freeze([
  'gmail.com', 'yahoo.com', 'yahoo.com.tw', 'hotmail.com', 'outlook.com',
  'icloud.com', 'me.com', 'live.com', 'msn.com', 'pchome.com.tw',
]);

/**
 * Returns true iff `a` and `b` differ by exactly one Damerau-Levenshtein edit:
 * single insertion / deletion / substitution OR an adjacent-character
 * transposition (e.g. `gamil` ↔ `gmail`). Damerau is required because the
 * A006 real-data typos `gamil` / `gmial` are adjacent swaps — pure Levenshtein
 * would score them as distance 2 and miss the typo.
 *
 * Returns false for equal strings, distance >= 2, and length-diff > 1.
 *
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
export function levenshtein1(a, b) {
  if (a === b) return false;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;

  // ─── Path 1: classic Lev1 (insert / delete / substitute) ───
  {
    let i = 0, j = 0, diffs = 0;
    while (i < la && j < lb) {
      if (a[i] === b[j]) { i++; j++; continue; }
      diffs++;
      if (diffs > 1) { diffs = 99; break; }
      if (la > lb)      i++;
      else if (la < lb) j++;
      else              { i++; j++; }
    }
    if (diffs <= 1) {
      if (i < la || j < lb) diffs++;
      if (diffs === 1) return true;
    }
  }

  // ─── Path 2: adjacent-character transposition (Damerau, equal-length only) ───
  if (la === lb) {
    let k = 0;
    while (k < la && a[k] === b[k]) k++;
    if (k < la - 1 && a[k] === b[k + 1] && a[k + 1] === b[k]) {
      let m = k + 2;
      while (m < la && a[m] === b[m]) m++;
      if (m === la) return true;
    }
  }
  return false;
}

/**
 * If `email`'s domain is 1 edit from a known domain (and not itself a known
 * domain), return the suggested fix. Otherwise null.
 *
 * @param {string} email
 * @returns {string|null}
 */
export function suggestEmailFix(email) {
  if (typeof email !== 'string') return null;
  const at = email.lastIndexOf('@');
  if (at < 1) return null;
  const local  = email.slice(0, at);
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain) return null;
  if (KNOWN_EMAIL_DOMAINS.includes(domain)) return null;
  for (const d of KNOWN_EMAIL_DOMAINS) {
    if (levenshtein1(domain, d)) return `${local}@${d}`;
  }
  return null;
}
