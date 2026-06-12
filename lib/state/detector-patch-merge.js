// lib/state/detector-patch-merge.js
// v5.3 (6/12) — detectorPatch merger that concats reframe history instead of
// overwriting.
//
// 根因: chat.js 三個 merge 點 (L1516 onboarding / L1557 new_session_day /
// L1608 user_turn) 都用 `{ ...detectorPatch, ...out.patch }` shallow merge.
// 同 turn 若有兩個 engine 都 invoke reframe (e.g. engine-1 R1 + landmine R5),
// 兩邊都用 appendToSessionHistoryPatch(state, entry) → 各回 [...prior, entry_X].
// shallow merge 後者整個 array overwrite 前者 → 漏 1 筆 reframe history.
//
// 對策: 對 `reframe_invocation_history_in_session` 特殊處理 — 取兩邊「tail
// (slice(prevList.length))」 各別 concat 在 prevList 後. 其餘 key 維持 shallow.
//
// ⚠️ 對偵測器 chat.js:510-515 的 `newHistory.slice(prevHistory.length)` 取
// delta 邏輯保持相容: prefix 一定等於 prevList, 順序「prev 全部在前、本 turn
// 新增在後」 (engine-1 → landmine 的順序就是 array 順序).

/**
 * Build a merger function bound to the turn's prevSessionState baseline.
 * Capture `prevSessionState.reframe_invocation_history_in_session` once;
 * every subsequent merge knows the baseline to slice off.
 *
 * @param {object} prevSessionState
 * @returns {(accum: object, incoming: object) => object}
 */
export function makeDetectorPatchMerger(prevSessionState) {
  const prevList = Array.isArray(prevSessionState?.reframe_invocation_history_in_session)
    ? prevSessionState.reframe_invocation_history_in_session
    : [];
  return function mergeDetectorPatch(accum, incoming) {
    const a = accum || {};
    const i = incoming || {};
    const result = { ...a, ...i };
    // Special-case the reframe history key.
    const aHist = Array.isArray(a.reframe_invocation_history_in_session)
      ? a.reframe_invocation_history_in_session : null;
    const iHist = Array.isArray(i.reframe_invocation_history_in_session)
      ? i.reframe_invocation_history_in_session : null;
    if (aHist || iHist) {
      const aTail = aHist ? aHist.slice(prevList.length) : [];
      const iTail = iHist ? iHist.slice(prevList.length) : [];
      result.reframe_invocation_history_in_session = [...prevList, ...aTail, ...iTail];
    }
    return result;
  };
}
