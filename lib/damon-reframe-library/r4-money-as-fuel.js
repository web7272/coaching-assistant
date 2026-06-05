// lib/damon-reframe-library/r4-money-as-fuel.js
// v5.1 Step 7 PR-7a — R4 金錢/物質作為 Fuel.
//
// Source: v51_damon_reframe_library.md §5 (1 份明確 A003-D2, 亞洲學員高頻).
// 話術 = library §5.4 verbatim 5 step.

const DAMON_QUOTES = Object.freeze([
  '金錢本身沒有內在價值、所有價值都是投射上去的',
  '金錢從障礙轉為燃料(Fuel)',
  '金錢是 strategy、不是 value',
]);

const MODE_APPLICABILITY = Object.freeze({
  elicitation:        'applicable',     // 學員 surface 金錢衝突時
  identity_anchoring: 'not_applicable',
  integration:        'applicable',
  cascade:            'not_applicable',
  future_pacing:      'not_applicable',
  crisis:             'not_applicable',
});

export function buildInject(ctx = {}) {
  const moneyConflict = ctx.conflict_quote || '[學員 surface 的金錢/物質衝突原話]';
  const topQuality = ctx.top_quality || '[學員 Top 1 quality]';
  const mode = ctx.mode || 'elicitation';

  return `[SYSTEM INJECT — R4 Money as Fuel]

mode: ${mode}.
trigger: 學員把金錢 / 物質 / 條件當 value 衝突「${moneyConflict}」.

⚠️ context filter: 若學員 Top 1 = 「踏實」 / 「物質本身」、本 reframe NOT applicable.

話術 (library §5.4 逐字 5 step):

**Step 1 — acknowledge apparent conflict**:
> 「我聽到你說『${moneyConflict}』——我想停一下、看看這個矛盾。」

**Step 2 — introduce the distinction**:
> 「那個 [金錢/物質]——對你來說是 value 本身、還是用來服務 [${topQuality}] 的 fuel?」

**Step 3 — let learner articulate**:
等學員 surface 自己的關係.

**Step 4 — strengthen if fuel**:
若學員「啊、是 fuel」:
> 「對。[金錢] 是用來服務 [${topQuality}] 的 fuel——
>  不是跟 [${topQuality}] 衝突。
>  所以你不是『要金錢 vs 要自由』、是『用金錢來支持自由』。」

**Step 5 — if learner says money IS the value**:
不強推 reframe、進 elicitation mode 重新挖:
> 「OK。那 [金錢] 本身對你有什麼重要?擁有它、會帶給你什麼?」

→ 鏈式追問 underlying quality (可能是「安全感 / 自由 / 尊嚴」).
→ 之後可能改 R1 Reclaim Source.

機制:
- 高 specific reframe — 若 invoke 通常 match (Beta target success > 70%).
- 不在 Top 1 = 物質本身 時觸發 (context filter).`;
}

export function shouldInvoke(state, signal) {
  if (state?.primary_mode === 'crisis' || (state?.active_modes || []).includes('crisis')) {
    return { invoke: false, variant: null, reason: 'crisis_mode_active' };
  }
  // R4 only when money/value conflict context — caller must set the marker.
  if (!signal?.money_value_conflict) {
    return { invoke: false, variant: null, reason: 'no_money_value_conflict_signal' };
  }
  // Context filter — Top 1 = 物質本身 → skip.
  if (state?.top1_value && /^(踏實|物質|金錢)$/.test(state.top1_value)) {
    return { invoke: false, variant: null, reason: 'top1_is_material_quality_itself' };
  }
  return { invoke: true, variant: 'R4_A', reason: null };
}

export const R4 = Object.freeze({
  id: 'R4',
  name_zh: '金錢/物質作為 Fuel',
  name_en: 'Money/Material as Fuel',
  tier: 3,
  damon_quotes: DAMON_QUOTES,
  damon_frequency: '1 份明確 (A003-D2)',
  mode_applicability: MODE_APPLICABILITY,
  variants: { R4_A: 'standard' },
  buildInject,
  shouldInvoke,
});
