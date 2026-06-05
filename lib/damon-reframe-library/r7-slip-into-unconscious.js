// lib/damon-reframe-library/r7-slip-into-unconscious.js
// v5.1 Step 7 PR-7a — R7 Slip into Unconscious (身份滑入潛意識).
//
// Source: v51_damon_reframe_library.md §8 (3 份明確 + §3 紅線 8 隱含).
// 話術 = library §8.4 / §8.5 verbatim.
// 變體:
//   R7_A standard — Frequency Illusion (學員「夠不夠」型 self-check)
//   R7_B perfectionism — 「100% 才算」/「全部時間都要是」(Gap #25)
//   R7_C let_it_go_ritual — future_pacing program 收尾 (library §8.5 verbatim)
//   (⏸️ R7_C「Good Enough for Now」變體 errata v0.2 Patch 5.1 暫留、不實作; PR-7a 的 R7_C 是 Let-it-Go ritual)
//   (⏸️ R7_D「包含所有問題的感恩」errata v0.3 Patch 3 暫留、不實作)
//
// 替換點:
//   - Step 5a engine-1-signals/index.js S3_LIGHT_INJECT → 完整 R7_A
//   - Step 5c engine-4-mode-aware.js TAKEAWAY_MODE_PHRASING.future_pacing → R7_C ritual

export const R7_VARIANTS = Object.freeze({
  R7_A: 'standard',                  // Frequency Illusion
  R7_B: 'perfectionism',             // 100% / 全部時間
  R7_C: 'let_it_go_ritual',          // future_pacing program 收尾
});

const DAMON_QUOTES = Object.freeze([
  '身份滑入潛意識',
  'Slip into Unconscious',
  '不要每天去檢查你今天「夠不夠 X」',
  '那會讓你回到意識的談判與鬥爭',
  '讓 X 滑入你的潛意識、自動運作',
  '信任潛意識整合',
]);

const MODE_APPLICABILITY = Object.freeze({
  elicitation:        'not_applicable',
  identity_anchoring: 'applicable',     // Frequency Illusion 觸發時
  integration:        'applicable',     // integration 內 Let it Work step
  cascade:            'not_applicable',
  future_pacing:      'primary',        // ✓✓✓ 核心 reframe、Let it Go ritual
  crisis:             'not_applicable',
});

export function buildInject(ctx = {}) {
  const variant = ctx.variant || R7_VARIANTS.R7_A;
  const frequencyCheckQuote = ctx.frequency_check_quote || '[學員 surface 的成績單 / 頻率 self-check 原話]';
  const quality = ctx.quality || '[quality 詞]';
  const role = ctx.role || '[role / persona]';
  const mode = ctx.mode || 'future_pacing';
  const prior = Number(ctx.prior_invocations || 0);

  // R7_F2 過度 invoke → dismissive 風險、降頻.
  if (prior >= 3) {
    return `[SYSTEM INJECT — R7 Slip into Unconscious (downsized, prior=${prior})]

session 內 R7 已 invoke ${prior} 次、降頻避免 dismissive.
不重複 reframe、退到 sober acknowledge.

⚠️ 區分: 學員若 surface「真實 ambiguity」 (「我大部分時間是、但這次真的不是」)、
   應 cascade integration mode 反例整合、NOT R7.`;
  }

  if (variant === R7_VARIANTS.R7_C) {
    // Library §8.5 R7_C let_it_go_ritual — verbatim.
    return `[SYSTEM INJECT — R7_C Let It Go Ritual (future_pacing program 收尾)]

mode: future_pacing (program 收尾).
trigger: future_pacing mode Let it Go step 2、program 收尾 ritual.

話術 (library §8.5 R7_C let_it_go_ritual 逐字):

> 「[${quality}] 現在是你的。我們在這停一下。
>
> 接下來、我不會再問你『記得嗎』『還在嗎』——
> 因為身體記得、頭腦不一定要記得。
>
> 如果你某天突然發現自己 [${quality}] 地做了某件事——那是真的、不需要驗證。
> 如果你某天感覺 [${quality}] 暫時 fade——那也是真的、不需要焦慮。」

機制:
- 對齊 Checkpoint 1 v2 §9.3 step 2 既有 ritual.
- 對齊 §3 紅線 8「不鼓勵學員每天回顧願景——讓它沉入潛意識」.
- AI 收尾後、不再追問「記得嗎」、本 ritual 是 program lifecycle 終點 anchor.`;
  }

  // R7_B variant — perfectionism (Gap #25).
  const step2 = (variant === R7_VARIANTS.R7_B)
    ? `**Step 2 — perfectionism reframe** (R7_B):\n` +
      `> 「100% 是不存在的目標——\n` +
      `>  不是因為你不夠好、是因為任何 [${quality}] 都有 boundary、都有 event。\n` +
      `>  [崩潰是事件、${quality} 是你是誰]。\n` +
      `>  讓『100%』這個標準、放下。」\n`
    : `**Step 2 — distinguish identity vs behavior**:\n` +
      `> 「[${quality}] 是身份、不是成績單。\n` +
      `>  [${role}] 不會因為今天 [low context] 就不是 [${role}]。\n` +
      `>  例: 媽媽不會因為今天累就不是媽媽。平靜的人不會因為今天崩潰就不是平靜的人。」\n`;

  return `[SYSTEM INJECT — R7 Slip into Unconscious (${variant})]

mode: ${mode}.
trigger: 學員 surface 成績單 / 頻率檢查型語言「${frequencyCheckQuote}」.

話術 (library §8.4 逐字 5 step):

**Step 1 — pause at frequency check**:
> 「你說『${frequencyCheckQuote}』——我想停一下。」

${step2}
**Step 3 — invoke unconscious**:
> 「你現在還在『意識上檢查』——
>  這個檢查本身、就是讓 [${quality}] 不能自然運作的東西。
>  讓它滑下去。
>  不要每天問『我今天夠不夠 X』。讓 [${quality}] 變成你的自動模式。」

**Step 4 — trust the body**:
> 「身體記得、頭腦不一定要記得。
>  如果你某天突然發現自己 [${quality}] 地做了某件事——那是真的、不需要驗證。
>  如果你某天感覺 [${quality}] 暫時 fade——那也是真的、不需要焦慮。」

**Step 5 — invite let go**:
> 「把『今天我夠不夠 X』這個問題、放下。
>  一週、一個月、半年後再回來看——
>  你不會記得這個檢查、但會看見你在 [${quality}] 地活著。」

機制:
- failure_mode R7_F1 學員「需要檢查才放心」→ acknowledge anxiety、不強推、慢慢來.
- failure_mode R7_F2 學員 surface 真實 ambiguity → cascade integration、NOT R7.
- multi-turn — 對應 Future Pacing Let it Go 儀式 / Integration Retention Mode 反覆 light touch.`;
}

export function shouldInvoke(state, signal) {
  if (state?.primary_mode === 'crisis' || (state?.active_modes || []).includes('crisis')) {
    return { invoke: false, variant: null, reason: 'crisis_mode_active' };
  }
  const priorR7 = (state?.reframe_invocation_history_in_session || [])
    .filter(e => e.reframe_id === 'R7').length;
  if (priorR7 >= 5) {
    return { invoke: false, variant: null, reason: 'over_invocation_per_session_cap_5' };
  }
  // Let-it-Go ritual variant — special trigger by future_pacing program 收尾.
  if (signal?.program_close_let_it_go_ritual) {
    return { invoke: true, variant: R7_VARIANTS.R7_C, reason: null };
  }
  if (!signal?.frequency_check_marker && !signal?.perfectionism_marker) {
    return { invoke: false, variant: null, reason: 'no_frequency_illusion_signal' };
  }
  // R7_B for perfectionism marker.
  const variant = signal?.perfectionism_marker ? R7_VARIANTS.R7_B : R7_VARIANTS.R7_A;
  return { invoke: true, variant, reason: null };
}

export const R7 = Object.freeze({
  id: 'R7',
  name_zh: 'Slip into Unconscious 身份滑入潛意識',
  name_en: 'Slip into Unconscious',
  tier: 1,
  damon_quotes: DAMON_QUOTES,
  damon_frequency: '3 份分析 + §3 紅線 8 隱含',
  mode_applicability: MODE_APPLICABILITY,
  variants: R7_VARIANTS,
  buildInject,
  shouldInvoke,
});
