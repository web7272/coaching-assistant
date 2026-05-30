// lib/util/time-check-in.js
// Patrick 5/29 (Vivi proactive) — 會話內依經過時間遞增的紙感 check-in 文案.
// 對應 PRODUCT-TRUTH v2.3 §2.5 鬆綁 (無計分鐵律維持).
//
// 鐵則:
//   1. 不是計時器 — 沒有秒數倒數、沒有「剩 X 分鐘」.
//   2. 不是催促 — 是「我也在、停下也好」, 不是「該走了」.
//   3. 可忽略 — 用戶完全可以不看、對話完全不受影響.
//   4. 不打斷流 — 不跳 modal、不推訊息進對話、就是輸入框下方那一行靜靜換句.
//   5. 紙感 — 文字褪色、無動畫、無顏色變化.
//   6. 把選擇權還給用戶 — 文案核心是「跟我直說」「告訴我就好」.
//
// 純函式抽出來 (從 student.js 內聯實作), 方便 unit-test boundary 行為.
// student.js UMD/classic-script loader 不能 import lib ESM, 同份邏輯內聯一份.

/**
 * Default 文案行 — 依「會話經過的 wall-clock 毫秒」 遞增切換.
 * atMs=0 是起始句,「✦」 起手是 Vivi 5/29 確定的紙感 marker (跟 depth dot 同調).
 */
export const DEFAULT_CHECK_IN_LINES = Object.freeze([
  Object.freeze({ atMs: 0,                 text: '慢慢來，我等你' }),
  Object.freeze({ atMs: 10 * 60 * 1000,    text: '✦ 已經陪自己 10 分鐘了 — 想停下來、跟我直說就好' }),
  Object.freeze({ atMs: 20 * 60 * 1000,    text: '✦ 走了 20 分鐘 — 任何時候說「先到這裡」我都會收下' }),
  Object.freeze({ atMs: 40 * 60 * 1000,    text: '✦ 40 分鐘了、明天再回來消化也是一種完整 — 告訴我就好' }),
]);

/**
 * 從一個排序好的 {atMs, text} 列表挑出「elapsedMs 該對應的最新一句」.
 *
 * 行為:
 *   · elapsedMs 小於最小 atMs → 回 lines[0] (起始句).
 *   · elapsedMs 落在某個 atMs 之上 (含 ==) → 回該行.
 *   · elapsedMs 超過最後一個 atMs → 停在最後一句 (不繞回頭、不空).
 *   · lines 空 / 非陣列 → 回 null.
 *   · negative elapsedMs → fall through 到 lines[0] (起始).
 *
 * 不對 lines 做排序; caller 保證 ascending atMs (DEFAULT_CHECK_IN_LINES 已排好).
 *
 * @param {number} elapsedMs
 * @param {ReadonlyArray<{atMs:number, text:string}>} lines
 * @returns {{atMs:number, text:string}|null}
 */
export function pickLine(elapsedMs, lines) {
  // `lines` 預設 DEFAULT_CHECK_IN_LINES, 但只有「真的沒傳」 才用 default;
  // 顯式傳 undefined/null/non-array 都當「caller 在問空表會怎樣」 → null.
  // (test boundary 鎖住這條: pickLine(0, undefined) → null, NOT default-eaten.)
  const actual = arguments.length < 2 ? DEFAULT_CHECK_IN_LINES : lines;
  if (!Array.isArray(actual) || actual.length === 0) return null;
  let current = actual[0];
  const e = Number.isFinite(elapsedMs) ? elapsedMs : 0;
  for (const l of actual) {
    if (!l || typeof l.atMs !== 'number') continue;
    if (e >= l.atMs) current = l;
  }
  return current;
}
