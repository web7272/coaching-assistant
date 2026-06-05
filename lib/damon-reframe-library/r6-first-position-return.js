// lib/damon-reframe-library/r6-first-position-return.js
// v5.1 Step 7 PR-7a — R6 第一感知位置回歸.
//
// Source: v51_damon_reframe_library.md §7 (1 份明確 A005-D1, 亞洲女性 cohort 高頻).
// 話術 = library §7.4 verbatim 5 step.

const DAMON_QUOTES = Object.freeze([
  '從第二感知位置(他人需求)回到第一感知位置(自己感受)',
  '你長期把自己放在第二位置',
  '用「你自己」的視角、你看到什麼?',
]);

const MODE_APPLICABILITY = Object.freeze({
  elicitation:        'applicable',
  identity_anchoring: 'primary',         // ✓✓ 身份錨定核心、自己看自己
  integration:        'applicable',
  cascade:            'not_applicable',
  future_pacing:      'applicable',      // 從第一位置看自己 3 時間維度
  crisis:             'not_applicable',
});

export function buildInject(ctx = {}) {
  const selfNeglectQuote = ctx.self_neglect_quote || '[學員 surface 的 self-neglect 原話]';
  const yearsOfPattern = ctx.years_of_pattern || 'X';
  const mode = ctx.mode || 'identity_anchoring';
  const prior = Number(ctx.prior_invocations || 0);

  if (prior >= 3) {
    return `[SYSTEM INJECT — R6 First Position Return (downsized, prior=${prior})]

session 內 R6 已 invoke ${prior} 次、退到 anchor reference:
> 「回到你自己的視角——現在你看到什麼?」`;
  }

  return `[SYSTEM INJECT — R6 First Position Return]

mode: ${mode}.
trigger: 學員描述「我都把別人放在自己前面」型 self-neglect: 「${selfNeglectQuote}」.
亞洲女性 cohort 高頻 (照顧者角色).

話術 (library §7.4 逐字 5 step):

**Step 1 — acknowledge long pattern**:
> 「你說『${selfNeglectQuote}』——這個 pattern、聽起來不是一兩天的事。」

**Step 2 — name the position**:
> 「你 ${yearsOfPattern} 年來、都站在『他們的視角』看自己——
>  看自己『該不該』、『夠不夠』、『有沒有做對』。
>  這是第二位置。」

**Step 3 — invite first position**:
> 「現在、用『你自己』的視角——
>  不是他們看你、是你看你自己——
>  你看到什麼?」

**Step 4 — handle response**:
若學員「我看不到」:
> 「OK。看不到——也是 OK 的。
>  你長期沒站在這個位置、看不到是合理的。我們慢慢來。
>  換個方式問——你『感覺』到什麼?不是想、是感覺。」

若學員 surface 微小 self-awareness:
→ cascade R2 Behavior to Identity、強化 self-awareness 作為身份.

**Step 5 — anchor first position**:
> 「這個——『你看到的你自己』——記著。
>  這就是第一位置。這是你的 home。」

機制:
- 長期 pattern、不期待 single-turn surface — multi-turn 累積.
- 學員「看不到」是正常、acknowledge 後降階問「感覺到什麼」、不強推.`;
}

export function shouldInvoke(state, signal) {
  if (state?.primary_mode === 'crisis' || (state?.active_modes || []).includes('crisis')) {
    return { invoke: false, variant: null, reason: 'crisis_mode_active' };
  }
  const priorR6 = (state?.reframe_invocation_history_in_session || [])
    .filter(e => e.reframe_id === 'R6').length;
  if (priorR6 >= 5) {
    return { invoke: false, variant: null, reason: 'over_invocation_per_session_cap_5' };
  }
  if (!signal?.second_position_marker) {
    return { invoke: false, variant: null, reason: 'no_second_position_signal' };
  }
  return { invoke: true, variant: 'R6_A', reason: null };
}

export const R6 = Object.freeze({
  id: 'R6',
  name_zh: '第一感知位置回歸',
  name_en: 'First Position Return',
  tier: 2,
  damon_quotes: DAMON_QUOTES,
  damon_frequency: '1 份明確 (A005-D1)、亞洲女性 cohort 高頻',
  mode_applicability: MODE_APPLICABILITY,
  variants: { R6_A: 'standard' },
  buildInject,
  shouldInvoke,
});
