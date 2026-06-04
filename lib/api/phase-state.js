// lib/api/phase-state.js
// PR-4c-green P4 — pure helper that maps v5 current_phase → the 5 Phase Report
// states ("locked" / "unlocked") used by /api/journey and /api/phase-report.
//
// Per docs/v5-spec/engineering/09-green-ui-spec.md §5.5 + §8 + §10. The new
// Phase Report concept supersedes the v4 weekly-summary mechanic.
//
// Phase Report bucket → v5 CP1 phase boundary it unlocks AFTER:
//   1 「找到你真正要的」  ← past phase_1            (values elicitation done)
//   2 「你是誰」          ← past phase_2            (identity test done)
//   3 「擴大地圖」        ← past phase_3a OR 3b     (scope / counter-example work done)
//   4 「串連起來」        ← past phase_4            (cascade-down + parts integration done)
//   5 「放手帶著走」      ← past phase_5            (future-pacing + let-go done)

export const PHASE_REPORT_NAMES = Object.freeze([
  '找到你真正要的',
  '你是誰',
  '擴大地圖',
  '串連起來',
  '放手帶著走',
]);

export const PHASE_REPORT_ROMAN = Object.freeze(['I', 'II', 'III', 'IV', 'V']);

/**
 * §8 5 短教學 — fixed-content student-safe distillations. ~6-8 lines each.
 * Rendered as the upper half of each Phase Report card. Plain text — paragraph
 * splits applied on blank lines by the frontend.
 *
 * Vivi may polish wording later; the structure stays.
 */
export const PHASE_REPORT_TEACHINGS = Object.freeze([
  // 1 — 找到你真正要的
  `你以為要的——成功、錢、一個具體的目標——多半是別人貼上來的標籤。
真正要的，藏在底下，是一種感覺、一種狀態。

怎麼挖到？一層層往下問：
「擁有這個，對你來說會帶來什麼？」
「體驗到這個的時候，你是一個什麼樣的人？」

問到一個你停下來的詞——一個你不需要再解釋的詞。
那個、就是你真正要的。`,

  // 2 — 你是誰
  `身份不是天生的、是你對過去經驗的「歸納」。
歸納是可以重組的。

重組的方法：把你挖到的最高價值觀變成你堅定的特質——
「我是一個___的人」、而不是「我希望可以___」。

⚠️ 不用否定句定義自己。
大腦聽不懂「我不要___」——它只聽得到後面那個字。
改用肯定的版本。`,

  // 3 — 擴大地圖
  `你卡住、不是因為現實太硬——是因為你手上的地圖太貧乏。
地圖不等於疆域。我們的大腦把現實刪減、扭曲、才裝得下。

怎麼鬆動限制？找「反例」。
任何「我永遠不能…」「我老是…」的句子裡、
找一個哪怕只有一次「不是這樣」的時刻。

那個微小的「不是這樣」、就是地圖長出來的第一筆。`,

  // 4 — 串連起來
  `你內在的阻力、不是敵人。
它是一個「還在執行舊命令」的部分——劇本過時、可是它還在保護你。

怎麼處理？問它：
「你想保護我什麼？」
「你的正向意圖是什麼？」

不打敗它、不對抗、不切割。
邀請那個被你壓下的部分回家。
內在從分裂走向同頻、力量會自然回來。`,

  // 5 — 放手帶著走
  `不靠意志力。意志力是把自己切兩半、跟自己開戰——很累、走不遠。
放下罪惡感。它只是提醒你違背了某個價值；意識到、補救一下就好。

當你跟自己真正要的價值對齊、
你不再需要逼自己。
你會自然地朝那邊走、像水順著低處流。

新的地圖會自己長出來——不需要每天複習。`,
]);

/**
 * v5.1 PR-23s4c task 8 — Mode progression index (取代 phaseSequenceIndex).
 *
 * Maps primary_mode → monotonic "program progression" measure for the 5 Phase
 * Report unlock thresholds. The 5 reports remain a program milestone concept
 * (learner-facing); progression is now event-driven (mode arc) not day-driven.
 *
 *   elicitation         → 0  (Report 1 still locked, learner採集 values)
 *   identity_anchoring  → 2  (past elicitation; Report 1 + 2 unlock)
 *   integration         → 3  (Reports 1-2 still 1st-pass; Report 3 unlocks when
 *                              learner has moved THROUGH integration → cascade)
 *   cascade             → 5  (past elicitation + identity + integration arcs)
 *   future_pacing       → 6  (Reports 1-4 unlocked, gearing toward Report 5)
 *   crisis              → -1 (in-crisis = no progression signal until resolve)
 *
 * Legacy phase_X strings also handled (dual-write transition window): they
 * map to the equivalent mode index.
 *
 * @param {string|null|undefined} modeOrPhase  primary_mode OR legacy current_phase
 * @returns {number} -1..6
 */
export function modeProgressionIndex(modeOrPhase) {
  if (typeof modeOrPhase !== 'string') return -1;
  // v5.1 mode primaries.
  switch (modeOrPhase) {
    case 'elicitation':         return 0;
    case 'identity_anchoring':  return 2;
    case 'integration':         return 3;
    case 'cascade':             return 5;
    case 'future_pacing':       return 6;
    case 'crisis':              return -1;
  }
  // Legacy v5.0 phase_X strings (dual-write transition window — pre-PR-23s4b
  // session_state may still carry current_phase that hasn't migrated).
  const legacy = {
    phase_1: 0,                  // → elicitation
    phase_2: 2,                  // → identity_anchoring
    phase_3a: 3, phase_3b: 3,    // → integration (both 3a + 3b unified)
    phase_4: 5,                  // → cascade
    phase_5: 6,                  // → future_pacing
    integration_retention: 7,    // past future_pacing arc (unlocks Report 5)
    program_completed: 8,        // final
  };
  return modeOrPhase in legacy ? legacy[modeOrPhase] : -1;
}

// PR-23s4c task 8 — deprecated alias for backward compat during transition.
//   Callers should use modeProgressionIndex(). This alias keeps existing
//   imports green; remove after Step 5c cached-prompt rewrite.
export const phaseSequenceIndex = modeProgressionIndex;

/**
 * Phase Report unlock thresholds — Report N unlocks when modeProgressionIndex >
 * the value at index N-1. Tuned for v5.1 mode arcs:
 *
 *   Report 1 unlocks past elicitation arc       (idx > 0)
 *   Report 2 unlocks past identity_anchoring    (idx > 2)
 *   Report 3 unlocks past integration arc       (idx > 3)  — both 3a/3b path → integration mode
 *   Report 4 unlocks past cascade arc           (idx > 5)
 *   Report 5 unlocks past future_pacing arc     (idx > 6)
 */
const PHASE_REPORT_UNLOCK_THRESHOLDS = [0, 2, 3, 5, 6];

/**
 * Compute the 5 Phase Report states given the student's current primary_mode.
 *
 * @param {string|null|undefined} primaryMode  e.g. 'elicitation', 'cascade', null
 * @returns {Array<{phaseId:number, name:string, state:'locked'|'unlocked'}>}  length 5
 */
export function computePhaseReportStates(primaryMode) {
  const cpIdx = modeProgressionIndex(primaryMode);
  return PHASE_REPORT_UNLOCK_THRESHOLDS.map((threshold, i) => ({
    phaseId: i + 1,
    name: PHASE_REPORT_NAMES[i],
    state: cpIdx > threshold ? 'unlocked' : 'locked',
  }));
}

/**
 * Convenience: is this specific Phase Report (1-5) unlocked for the given
 * primary_mode? Used by /api/phase-report to gate the read.
 *
 * @param {number} phaseId  1..5
 * @param {string|null|undefined} primaryMode
 * @returns {boolean}
 */
export function isPhaseReportUnlocked(phaseId, primaryMode) {
  if (!Number.isInteger(phaseId) || phaseId < 1 || phaseId > 5) return false;
  return modeProgressionIndex(primaryMode) > PHASE_REPORT_UNLOCK_THRESHOLDS[phaseId - 1];
}

/** Expose the thresholds for tests / introspection (not for runtime use elsewhere). */
export const _internal = { PHASE_REPORT_UNLOCK_THRESHOLDS };
