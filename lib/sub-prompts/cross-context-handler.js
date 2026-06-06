// lib/sub-prompts/cross-context-handler.js
// v5.2 第二塊 PR-b — Cross-context handling guidance (spec §4.2 3 cases verbatim).
//
// Case 1 (相關): 學員 surface 跟 active_context 相關 → 整合為 evidence、不另開議題.
//   覆蓋在 Active Context block §4.1 內 (case 1+2 in the inject body).
//
// Case 2 (無關): 完全無關 → acknowledge + noted (寫 user_profile_evolution
//   .other_contexts_noted) + 不深挖 + 回 active_context.
//   覆蓋在 Active Context block §4.1 內.
//
// ⭐ Case 3 (學員口頭想換 context): 本檔處理 — reminder context lock.
//   active_context lock 是 21 天 program 級, AI 不在對話中自動 swap.
//   正式管道 (學員寫信 / Vivi 後台改 active_context) 是允許的 → 走第一塊
//   PATCH /api/students. 兩者不衝突.
//
// 設計:
//   - 純 prompt 層. caller (chat.js conditionalInjects) push 進去當 turn-level
//     guidance, NOT cached.
//   - 觸發訊號: 學員話中含「想換」「想聊別的」「不想聊 {active_context}」等 marker.
//   - 強烈堅持 (連續 3 turn 同訴求) → escalate Vivi (M-series alert, Step 8 dashboard).

/**
 * Regex to detect student-initiated context swap intent.
 *   Vivi 終審 6/5: capture「想換」「想聊別的」「不想聊 X」 等.
 */
export const CROSS_CONTEXT_SWAP_REGEX =
  /(我想.{0,5}換|今天.{0,5}想換|想聊.{0,5}別的|不想聊.{0,8}(這個|現在|這塊)|可以.{0,5}換|想談.{0,5}別|今天.{0,5}不想)/;

/**
 * Detect case 3 — student verbally requesting context swap.
 *
 * @param {string} text — user response
 * @returns {boolean}
 */
export function detectCrossContextSwapIntent(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  return CROSS_CONTEXT_SWAP_REGEX.test(text);
}

/**
 * Build the case-3 reminder lock inject (verbatim phrasing per spec §4.2).
 *
 * @param {object} args
 * @param {string} args.contextName — active_context_name OR category 短字 fallback
 * @param {string} [args.studentWantedContext] — what learner wanted to swap to (verbatim from utterance)
 * @returns {string}
 */
export function buildCrossContextReminderLockInject({ contextName, studentWantedContext = '[他想換的]' } = {}) {
  const name = (typeof contextName === 'string' && contextName.trim().length > 0)
    ? contextName.trim() : '[active context]';
  // Verbatim phrasing per spec §4.2 case 3.
  return `[SYSTEM INJECT — v5.2 Cross-Context Handler · Case 3 Context Lock Reminder]

trigger: 學員話中表達想換 context (「我想換」/「今天不想聊這個」/「想聊別的」等).

⚠️ active_context lock: 21 天 program 級, AI 不在對話中自動 swap.
   (正式管道: 學員寫信 / Vivi 後台改 → 第一塊 PATCH /api/students. 不在本 prompt 處理.)

話術 (spec §4.2 verbatim, Vivi 終審):

> 「我們這 21 天 program 鎖定在『${name}』、${studentWantedContext} 那塊我們之後可以另外處理。」

機制:
- 不在對話中自動 swap context.
- AI acknowledge 學員 wanted context、再 anchor 回 ${name}.
- 不忽略、不評判 — 學員 wanted context 仍 noted 進 user_profile_evolution.other_contexts_noted.
- 連續 3 turn 學員仍堅持換 context → escalate Vivi (M-series alert, Step 8 dashboard 接管 — 本 PR 不實作 alert 觸發, 只埋 marker).

不可做:
❌ 不對話中自動切換 active_context 為學員想換的那個.
❌ 不告訴學員「你需要找 Vivi 改」 (那是內部 admin 路徑, 學員不需知道).
❌ 不忽略學員意願 (acknowledge 後 anchor 回, 不假裝沒聽見).
❌ 不施加 framing (「你應該聊『${name}』」), 改 invitation type「我們今天先聊『${name}』、你想聊的那塊我們記著」.`;
}

/**
 * Build the Active Context block-level case 1/2 reference (concise).
 * Active Context block (active-context.js §4.1) already has case 1+2 body;
 * this is a complementary turn-level reminder if cross-context noise spikes.
 *
 * @param {object} args
 * @param {string} args.contextName
 * @param {boolean} args.relatedSurfaced — case 1 hint
 * @param {boolean} args.unrelatedSurfaced — case 2 hint
 * @returns {string|null}
 */
export function buildCrossContextNoise12Inject({ contextName, relatedSurfaced = false, unrelatedSurfaced = false } = {}) {
  if (!relatedSurfaced && !unrelatedSurfaced) return null;
  const name = (typeof contextName === 'string' && contextName.trim().length > 0)
    ? contextName.trim() : '[active context]';
  const lines = ['[SYSTEM INJECT — v5.2 Cross-Context Handler · Case 1/2 Noise Reminder]'];
  if (relatedSurfaced) {
    lines.push('', `Case 1 (相關): 學員剛才 surface 的內容跟「${name}」相關 — 整合為「${name}」evidence、不另開議題.`);
  }
  if (unrelatedSurfaced) {
    lines.push('', `Case 2 (無關): 學員 surface 的內容跟「${name}」無關 — acknowledge (不忽略) + 不深挖 + 回到「${name}」.`,
      '寫入 user_profile_evolution.other_contexts_noted (cross-session, 不在本 PR 落地 — Step 8 dashboard 接).');
  }
  return lines.join('\n');
}

export default {
  id: 'v5_2_cross_context_handler',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  // Detect via CROSS_CONTEXT_SWAP_REGEX in chat.js cascade; inject case-3
  // reminder when matched. Cases 1/2 implicit via Active Context block.
  spec_ref: 'v52_context_anchored_spec §4.2',
};
