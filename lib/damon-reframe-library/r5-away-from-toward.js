// lib/damon-reframe-library/r5-away-from-toward.js
// v5.1 Step 7 PR-7a — R5 Away From → Toward.
//
// Source: v51_damon_reframe_library.md §6 (3 份分析 A003-D2 / A009 / A005-D1).
// 話術 = library §6.4 verbatim 5 step.
//
// 替換點:
//   - Step 5b landmine-check tier 3 「自由」 → Freedom From vs Freedom To.

const DAMON_QUOTES = Object.freeze([
  '從遠離恐懼 → 迎向願景',
  'Away From → Toward',
  'Freedom From vs Freedom To Be',
  '這個「不要」的背面、你想要的是什麼?',
]);

const MODE_APPLICABILITY = Object.freeze({
  elicitation:        'primary',         // ✓✓✓ 最高頻 invoke
  identity_anchoring: 'applicable',      // 身份句也可能是 negative form
  integration:        'applicable',
  cascade:            'not_applicable',
  future_pacing:      'not_applicable',  // 預期已 Toward
  crisis:             'not_applicable',
});

export function buildInject(ctx = {}) {
  const negQuote = ctx.negative_quote || '[學員 surface 的「不要 X」原話]';
  const mode = ctx.mode || 'elicitation';
  const landmineTerm = ctx.landmine_term;
  const prior = Number(ctx.prior_invocations || 0);

  if (prior >= 5) {
    return `[SYSTEM INJECT — R5 Away→Toward (downsized, prior=${prior})]

session 內 R5 已 invoke ${prior} 次、降頻避免重複翻轉.
退到 acknowledge:「我聽到了。」`;
  }

  const landmineNote = landmineTerm
    ? `\n⚠️ landmine context: 候選 Top 1「${landmineTerm}」命中 tier 3 borderline (「自由」).\n` +
      `本 reframe 接管 — Freedom From vs Freedom To Be 區分.\n`
    : '';

  return `[SYSTEM INJECT — R5 Away From → Toward]

mode: ${mode}.
trigger: 學員用否定句式描述 want「${negQuote}」(「不 X」「不要 X」「擺脫」「免於」).${landmineNote}

話術 (library §6.4 逐字 5 step):

**Step 1 — pause at negative form**:
> 「你說『${negQuote}』——我想把這個翻過來看。」

**Step 2 — the flip**:
> 「這個『不要 [X]』的背面——你『想要』的、是什麼?」

**Step 3 — let learner articulate**:
等學員 surface 正向 want.

若學員給不出正向版本:
> 「用『想要』替換『不要』——
>  不要焦慮、那你想要什麼狀態?
>  不要壓抑、那你想要怎麼活?」

**Step 4 — continue chain question**:
一旦學員 surface 正向 want、繼續鏈式追問:
> 「擁有 [正向 want]、對你有什麼重要?」

**Step 5 — if persistent negative**:
若學員多次 push back「我就是想擺脫、不是想要什麼」:
→ 進入 Survival Mode 處理 (不強推 Toward reframe):
> 「OK、現在你需要的是 away、那是真的。我們先在這、慢慢來。」

機制:
- failure_mode 學員 persistent negative → cascade integration (可能 Survival mode).
- Top 1 = 「自由」 時、本 reframe 是 default 接管路徑.${landmineTerm === '真實' ? '\n- 「真實 Authenticity」 → Damon 推薦、特殊優先、直接 accept (R5 不適用、走 R1 anchor).' : ''}`;
}

export function shouldInvoke(state, signal) {
  if (state?.primary_mode === 'crisis' || (state?.active_modes || []).includes('crisis')) {
    return { invoke: false, variant: null, reason: 'crisis_mode_active' };
  }
  const priorR5 = (state?.reframe_invocation_history_in_session || [])
    .filter(e => e.reframe_id === 'R5').length;
  if (priorR5 >= 5) {
    return { invoke: false, variant: null, reason: 'over_invocation_per_session_cap_5' };
  }
  if (!signal?.away_from_marker && !signal?.landmine_freedom_from) {
    return { invoke: false, variant: null, reason: 'no_away_from_signal' };
  }
  return { invoke: true, variant: 'R5_A', reason: null };
}

export const R5 = Object.freeze({
  id: 'R5',
  name_zh: 'Away From → Toward',
  name_en: 'Away From → Toward',
  tier: 2,
  damon_quotes: DAMON_QUOTES,
  damon_frequency: '3 份分析 (A003-D2 / A009-D1 / A005-D1)',
  mode_applicability: MODE_APPLICABILITY,
  variants: { R5_A: 'standard' },
  buildInject,
  shouldInvoke,
});
