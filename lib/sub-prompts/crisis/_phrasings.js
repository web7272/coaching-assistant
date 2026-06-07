// lib/sub-prompts/crisis/_phrasings.js
//
// ⭐ SINGLE SOURCE OF TRUTH for crisis-side AI-facing phrasings.
//
// 來源: 話術定稿-crisis-去書面腔+1925台灣框.md (Vivi 6/6 終審).
//
// History (why this module exists, Vivi 6/6 task: dedupe gate):
//   The Step 4.1 / 4.2 / 4.3 / Step 5.1 strings were verbatim-copied across
//   5 files:
//     - lib/sub-prompts/crisis/handoff-three-options.js
//     - lib/sub-prompts/crisis/resource-1925.js
//     - lib/prompt-sections/conditional/engine-3/deep-signal-detector.js
//     - lib/detector-handlers/engine-3.js
//     - lib/detector-handlers/engine-4-mode-aware.js
//   Three consecutive wording revisions (active SI fast-path / onboarding /
//   去書面腔) hit some copies and missed others. The 4917fee miss let
//   production keep emitting pre-revision book-toned wording because the
//   active SI fast-path reads deep-signal-detector — a copy site that was
//   never updated.
//
//   This module + all-lib grep test = the architectural gate. Future wording
//   revisions touch ONE module; CI grep enforces zero residual copies.
//
// What's IN scope (dedupe):
//   AI-facing phrasings that have been verbatim-duplicated across files.
//
// What's OUT of scope (do NOT centralize here):
//   - detection regex (PASSIVE_STRONG / ACTIVE_SI_EXPLICIT / TRAUMA): they
//     match student utterances, not AI output; stay in deep-signal-detector.
//   - safety-planning「❌ 不問自殺方法」 negation markers: system-side
//     forbid markers, not student-facing AI output.
//   - V6 day-opening sub-branch phrasings (engine-4-mode-aware
//     V6_SUB_BRANCH_PHRASING): conceptually a separate "returning student
//     opener" set, not a copy of Step 4.X. Wording principles still apply
//     but they're their own catalog.

// ─── Step 4.1 standard direct-1925 ─────────────────────────────────
export const HANDOFF_4_1_STANDARD_PHRASING = `我聽到了。

你說了這句話,我有聽進去——我想先停在這裡,不急著往下走。

如果你現在有立即的危險:在台灣,可以打 1925(安心專線、24 小時、免費)。
如果你不在台灣,請搜尋你所在地的緊急專線。`;

// ─── Step 4.2 cumulative (count >= 2) ──────────────────────────────
export const HANDOFF_4_2_CUMULATIVE_PHRASING = `我聽到了。

過去幾次,你提過類似的。
我想先停在這裡,不急著往下走。

如果你現在有立即的危險:在台灣,可以打 1925(安心專線、24 小時、免費)。
如果你不在台灣,請搜尋你所在地的緊急專線。

你需要的,是真正的諮商師 / 心理醫生長期陪伴——
不是 AI、不是 21 天 program。`;

// ─── Step 4.3 high_risk (SI confirm + plan OR no protective) ───────
export const HANDOFF_4_3_HIGH_RISK_PHRASING = `我聽到了。
你現在最需要的,是一個真人在你旁邊。

如果你現在有立即的危險:在台灣,可以打 1925(安心專線、24 小時、免費)。
如果你不在台灣,請搜尋你所在地的緊急專線。

你不需要『真的打算做什麼』才能打。就算只是現在很難受、撐不下去,打過去都可以。`;

// ─── Step 4.3b freeze (count >= 5) — unchanged per Vivi spec ───────
export const HANDOFF_4_3B_FREEZE_PHRASING =
  `我看到你回來了。Vivi 知道你的狀況、她會直接聯絡你。`;

// ─── Step 5.1 standard 1925 hotline (full form) ────────────────────
// Used as the [SYSTEM INJECT] quoted block AND as the FORBIDDEN-block coda
// reference embedded in deep-signal-detector C-1/C-3 prompt_content variants.
export const STEP_5_1_HOTLINE_1925 = `另外,台灣有個地方可以接住你:
安心專線 1925(24 小時、免費)。
如果你不在台灣,請搜尋你所在地的緊急專線。`;

// ─── Step 5 light 1925 (C-2 philosophical path — non-active SI) ────
// Different context: student verified the prior utterance was philosophical /
// completion-metaphor, not an active SI. We still surface the resource gently.
// Wording aligned with same principles (口語, no book-toned「重」 phrasing,
// no「打算」/「要做」 hedge, localization framing + fallback).
export const STEP_5_LIGHT_HOTLINE_1925 = `了解、謝謝你跟我說清楚。
順帶提一個地方:在台灣,安心專線 1925(24 小時、免費)。
如果你不在台灣,請搜尋你所在地的緊急專線。`;

// ─── Bundle export for snapshot tests + admin debug ─────────────────
export const CRISIS_PHRASINGS = Object.freeze({
  HANDOFF_4_1_STANDARD:     HANDOFF_4_1_STANDARD_PHRASING,
  HANDOFF_4_2_CUMULATIVE:   HANDOFF_4_2_CUMULATIVE_PHRASING,
  HANDOFF_4_3_HIGH_RISK:    HANDOFF_4_3_HIGH_RISK_PHRASING,
  HANDOFF_4_3B_FREEZE:      HANDOFF_4_3B_FREEZE_PHRASING,
  STEP_5_1_HOTLINE_1925:    STEP_5_1_HOTLINE_1925,
  STEP_5_LIGHT_HOTLINE_1925: STEP_5_LIGHT_HOTLINE_1925,
});
