// lib/damon-reframe-library/r2-behavior-to-identity.js
// v5.1 Step 7 PR-7a — R2 Behavior to Identity (行為轉特質).
//
// Source: v51_damon_reframe_library.md §3 (Damon 4/16 份分析, identity_anchoring core reframe).
// 話術 = library §3.4 verbatim.
// 變體 = R2_A standard / R2_B micro_example / R2_C long_pattern.

export const R2_VARIANTS = Object.freeze({
  R2_A: 'standard',
  R2_B: 'micro_example',       // 學員給的極短瞬間 evidence
  R2_C: 'long_pattern',        // 「從小就會 / 一直都會」型
});

const DAMON_QUOTES = Object.freeze([
  '將行為轉化為身份',
  'Behavior to Identity',
  '這不是你想像自己是什麼樣的人、這是你實際做到的事',
  '這個你、一直都在',
  '從小就會做的事、不是學來的、不是決定的、就是你',
]);

const MODE_APPLICABILITY = Object.freeze({
  elicitation:        'not_applicable',   // elicitation 主要挖 quality candidate
  identity_anchoring: 'primary',          // ✓✓✓ 核心 mode、default reframe
  integration:        'applicable',       // 反例整合內、正向 evidence
  cascade:            'applicable',       // Top 2/3 evidence 後
  future_pacing:      'applicable',       // 3 時間維度引用過去 evidence
  crisis:             'not_applicable',   // crisis 內不 invoke
});

/**
 * Build R2 SYSTEM INJECT — verbatim per library §3.4.
 *
 * @param {object} ctx — { variant?, behavior_quote?, quality?, mode?, sensory_detail_count?, prior_invocations? }
 * @returns {string} system inject text
 */
export function buildInject(ctx = {}) {
  const variant = ctx.variant || R2_VARIANTS.R2_A;
  const behaviorQuote = (ctx.behavior_quote || '[學員行為原話]').trim();
  const quality = ctx.quality || '[quality 詞]';
  const mode = ctx.mode || 'identity_anchoring';
  const prior = Number(ctx.prior_invocations || 0);

  // R2_F3 過度 invoke 變 cheerleading — same-session > 5 times = downsize.
  if (prior >= 5) {
    return `[SYSTEM INJECT — R2 Behavior to Identity (downsized, prior=${prior})]

本 session R2 已 invoke ${prior} 次、降頻避免 cheerleading (failure_mode R2_F3).
不重複 reframe、改 sober acknowledge:

> 「[behavior] — 我看到了。」

不延伸、不再強化「你是 [quality] 的人」.`;
  }

  // Variant-specific Step 2 reframe statement.
  let reframeStatement;
  if (variant === R2_VARIANTS.R2_B) {
    reframeStatement = `> 「那個 ${behaviorQuote} —— 不是巧合、不是好運。\n` +
      `>  那是你本來就是的、只是平常你沒看見。」\n` +
      `(R2_B micro_example — 學員 surface 的微小瞬間易被自己忽略、強化「就是你」.)`;
  } else if (variant === R2_VARIANTS.R2_C) {
    reframeStatement = `> 「從小就會做的事——\n` +
      `>  不是學來的、不是決定的——就是你。\n` +
      `>  [你] 是 [${quality}] 的人。\n` +
      `>  不是因為你做了 [behavior]、是因為你是這樣的人、所以你做了 [behavior]。」\n` +
      `(R2_C long_pattern — Damon A006-D5 親口示範.)`;
  } else {
    reframeStatement = `> 「這不是你想像自己是什麼樣的人、這是你實際做到的事。」\n` +
      `> 「這個你、一直都在。」\n` +
      `(R2_A standard — Damon 「將行為轉化為身份」核心句式.)`;
  }

  return `[SYSTEM INJECT — R2 Behavior to Identity (${variant})]

mode: ${mode}.
trigger: 學員 surface 具體行為「${behaviorQuote}」對應 quality「${quality}」.
sensory_detail_count: ${ctx.sensory_detail_count ?? '(not measured)'} (A1 marker ≥ 2 才適合 invoke).

話術 (library §3.4 逐字 4 step):

**Step 1 — acknowledge specific behavior**:
> 「${behaviorQuote}——」

對行為 echo、不縮減學員原話.

**Step 2 — state the reframe**:
${reframeStatement}

**Step 3 — invite owning**:
> 「你是一個 [${quality}] 的人——這句話、你現在說出來、感覺是真的、還是還在期待?」

**Step 4 — handle response**:
- 學員 owned → 成功、進 takeaway / 種 anchor.
- 學員「還在期待」→ 不強推:
  > 「我聽到了。但我想把你拉回那個 [event/moment]——
  >  那個 [you in event]、就是 [${quality}] 的你。
  >  不是未來的你。是 [event] 的你。」
- 學員「大部分是、小部分懷疑」→ 不在本 reframe 處理.
  cascade integration mode (Step 4-Tier 7 反例整合 / Parts Integration).

機制:
- failure_mode R2_F1 evidence 不夠 sensory (A1 marker < 2) → 不 invoke、回到 evidence 收集.
- failure_mode R2_F2 學員多次拒絕 owning → cascade integration mode (M13).
- failure_mode R2_F3 過度 invoke (> 5/session) → downsize、本 handler 已自動降頻.`;
}

export function shouldInvoke(state, signal) {
  if (state?.primary_mode === 'crisis' || (state?.active_modes || []).includes('crisis')) {
    return { invoke: false, variant: null, reason: 'crisis_mode_active' };
  }
  // R2_F1 — evidence 不夠 sensory (A1 marker < 2).
  const sensoryCount = signal?.sensory_detail_count ?? state?.current_sensory_detail_count ?? 0;
  if (sensoryCount < 2) {
    return { invoke: false, variant: null, reason: 'insufficient_sensory_evidence_a1_lt_2' };
  }
  const priorR2 = (state?.reframe_invocation_history_in_session || [])
    .filter(e => e.reframe_id === 'R2').length;
  // §9 R2_F3 — downsize at 5.
  // (buildInject also handles > 5 — shouldInvoke gates earlier at hard 5+ cap.)
  if (priorR2 >= 5) {
    return { invoke: false, variant: null, reason: 'over_invocation_per_session_cap_5' };
  }
  // Variant routing — micro_example marker / long_pattern marker.
  let variant = R2_VARIANTS.R2_A;
  if (signal?.long_pattern_marker) variant = R2_VARIANTS.R2_C;
  else if (signal?.micro_example_marker) variant = R2_VARIANTS.R2_B;
  return { invoke: true, variant, reason: null };
}

export const R2 = Object.freeze({
  id: 'R2',
  name_zh: 'Behavior to Identity 行為轉特質',
  name_en: 'Behavior to Identity',
  tier: 1,
  damon_quotes: DAMON_QUOTES,
  damon_frequency: '4 份分析 / 16 份 (identity_anchoring 核心 reframe)',
  mode_applicability: MODE_APPLICABILITY,
  variants: R2_VARIANTS,
  buildInject,
  shouldInvoke,
});
