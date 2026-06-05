// lib/damon-reframe-library/r1-reclaim-source.js
// v5.1 Step 7 PR-7a — R1 Reclaim Source (收回源頭).
//
// Source: v51_damon_reframe_library.md §2 (Damon 8/16 份分析最高頻 reframe).
// 話術 = library §2.4 verbatim (4 step + multi-turn 強化).
// 變體 = R1_A standard / R1_B negative generalization / R1_C crisis (ship 前臨床 review).
//
// 替換點:
//   - Step 5b landmine-check buildTier1RejectInject (Damon strategy reject 後深挖)
//   - Step 5a S1 medium+ external_locus_signals
//   - Step 5b landmine tier 2 「希望」 cascade

export const R1_VARIANTS = Object.freeze({
  R1_A: 'standard',
  R1_B: 'with_negative_generalization',
  R1_C: 'crisis_with_passive_ideation',   // ⚠️ ship 前臨床 review、AI 不單獨 invoke
});

const DAMON_QUOTES = Object.freeze([
  '你才是價值的源頭',
  'Reclaim Source',
  '愛是你內在的資源、不是別人給的',
  '資源斷連的幻覺',
  '你才是所有感受的源頭(Source)',
]);

const MODE_APPLICABILITY = Object.freeze({
  elicitation:        'applicable',     // 學員 surface「他給我 X 重要」時
  identity_anchoring: 'applicable',     // evidence 來自外部對象時
  integration:        'applicable',     // 反例整合內、學員投射時
  cascade:            'not_applicable', // 罕見
  future_pacing:      'not_applicable', // 預期已 owned source
  crisis:             'limited',        // 只 R1_C 變體、ship 前臨床 review
});

/**
 * Build R1 SYSTEM INJECT — 4-step verbatim script per library §2.4.
 *
 * @param {object} ctx — { variant?, projection_quote?, mode?, prior_invocations?, landmine_term? }
 * @returns {string} system inject text
 */
export function buildInject(ctx = {}) {
  const variant = ctx.variant || R1_VARIANTS.R1_A;
  const quote = (ctx.projection_quote || '[那句投射到他人的話]').trim();
  const mode = ctx.mode || 'unknown';
  const prior = Number(ctx.prior_invocations || 0);

  // R1_C — Step 6 PR-6a unlocked for de-escalation sub-mode only.
  //   ✅ Allowed: crisis-mixed-with-meaning-making sub-mode (de-escalation, R1 limited invoke).
  //   ❌ Blocked: active crisis (Step 0-7 of SOP) — crisis SOP handler takes the turn.
  //   ❌ Blocked: passive_dw 未經 SOP 完整 step 2-4 — R1_C 不單獨繞過 SOP.
  //   Gate signal: ctx.de_escalation_sub_mode === true (set by crisis-sop on natural exit per §10.4).
  if (variant === R1_VARIANTS.R1_C) {
    if (!ctx.de_escalation_sub_mode) {
      return `[SYSTEM INJECT — R1_C Reclaim Source (crisis variant, ⚠️ disabled)]

R1_C 是 crisis mode + passive death wish 的特殊變體 ("[他/她] 不在我就沒動力活下去").
本 turn 沒進入 crisis-mixed-with-meaning-making de-escalation sub-mode (per §10.4 signal_de_escalation).
→ 不單獨 invoke、必須先走 crisis SOP (Step 6 PR-6a crisis-sop.js).

退到 crisis flow handler、不 inject R1 話術.`;
    }
    // De-escalation sub-mode active — limited R1_C invoke per §10.4 + M70 guard.
    return `[SYSTEM INJECT — R1_C Reclaim Source (de-escalation sub-mode, Step 6 PR-6a unlocked)]

mode: crisis-mixed-with-meaning-making sub-mode (§10.4 signal_de_escalation).
trigger: 學員自主 surface「我現在好多了 / 想繼續走」+ AI 判斷 risk 降低.

⚠️ M70 guard: 此 sub-mode AI 不啟動標準 elicitation、不推進過快 — focus on meaning + reframe.
   R1 limited invoke — 收回源頭 framing 不挖深處、給「你內在的資源」reassurance.

話術 (R1_C limited, library §2.4 R1_A 簡化版):

> 「上次你停在這裡——你說『[creating quote referring to "他不在我就沒動力"]』。
>  我想跟你說一個東西——
>  那個動力、是你內在的能量在和外部共鳴。
>  [他/她] 不在這刻、那個能量仍在你裡面。
>  你願意往這個方向看看嗎?」

機制:
- multi-turn — 不期待當下 owned、後續 light touch reference.
- failure_mode: 學員 push back → 不強推、退到 acknowledge.
- 限制: per session R1_C 不得 > 2 次 (避免 toxic positivity in de-escalation).
- ship 前臨床 review waived (Vivi 6/4) — Beta-eligible direct merge.`;
  }

  // R1_B prelude — negative generalization 「總是 / 又 / 一直」 → 先區分 pattern vs 感覺.
  const negGenPrelude = (variant === R1_VARIANTS.R1_B)
    ? `\n[R1_B 前置 — negative generalization 區分]\n`
      + `> 「『總是 / 又 / 一直』——這個我先停一下。這個 pattern、我們先看清楚。\n`
      + `> [感覺] 跟 [pattern] 是兩件事——pattern 是發生在你身上的、[感覺] 是你內在的。\n`
      + `> 我們先看 [感覺]、不看 pattern——那個 [感覺]、是從哪裡來的?」\n`
    : '';

  // Multi-turn reference — 同 session 已 invoke 過、不重做完整 4 step、改 anchor reference.
  if (prior > 0) {
    return `[SYSTEM INJECT — R1 Reclaim Source (multi-turn anchor reference, prior=${prior})]

學員又 surface 投射型句式「${quote}」、本 session R1 已 invoke 過 ${prior} 次.
不重新 walk through 4 step、改 anchor reference (library §9.4 cross-turn continuity):

> 「我們之前說過——那個 [感覺] 是你的、不是 [他/她] 給的。
> 今天這件事、你內在的 [感覺] 在哪裡?」

機制:
- AI 不重複完整 reframe (避免 toxic positivity).
- ${prior >= 3 ? '⚠️ 過度 invoke 風險 — session 內 R1 已 >= 3 次、考慮降頻或退到 acknowledge。' : '繼續錨點強化、不展開。'}`;
  }

  // R1_A / R1_B standard 4-step script per library §2.4.
  return `[SYSTEM INJECT — R1 Reclaim Source (${variant})]

mode: ${mode}.
trigger: 學員 surface 投射型句式「${quote}」(把感覺 / 愛 / 動力 歸功外部對象).

話術 (library §2.4 逐字 multi-turn 4 step):
${negGenPrelude}
**Step 1 — pause and notice**:
> 「等一下、我注意到你說『${quote}』——
>  我想停在這裡。」

**Step 2 — question the source** (擇一、依 context):
> 「那個 [感覺/愛/開心/動力]、是從哪裡來的?」
> 「[他/她] 出現之前、那個 [感覺] 存在嗎?」
> 「[感覺]——是 [他/她] 給你的、還是你給出去的、然後感受到自己的?」

**Step 3 — let learner articulate**:
等學員自己回答、不引導 / 不暗示答案.

**Step 4 — acknowledge and anchor**:
若學員 surface「是我自己的」:
> 「對。那個 [感覺]、一直在你裡面。
>  [他/她] 不是給你的、是你內在的資源在和外部共鳴。
>  這不是你想成為的、是你本來就是的。」

若學員仍認為「是對方給的」:
> 「我聽到了。換個方式問——
>  你 [付出 / 觀察 / 在 / 陪伴] 的那個能力、是 [他/她] 給你的嗎?
>  還是你本來就有、只是現在用在 [他/她] 身上?」

**Step 5 — strengthen anchor** (若學員 owned):
> 「這個——『我就是 [源頭]』——你記著。
>  接下來無論發生什麼、這個是真的。」

機制:
- Multi-turn reframe — 學員不會一次就 owned、後續 turns 仍 reference anchor 不重複問.
- failure_mode R1_F1 學員拒絕 → 不強推、後續 turn 試 R1_B 變體.
- failure_mode R1_F2 同 session > 3 次 → 降頻、退到 R2 或 acknowledge.
- failure_mode R1_F3 事實陳述 (「他打了我」) → context_filter 阻擋、本 handler 應 NOT invoke.${ctx.landmine_term ? `\n- landmine context: 學員 surface strategy「${ctx.landmine_term}」、R1 深挖 underlying real quality.` : ''}`;
}

/**
 * R1 invocation gate — context filter per library §2.3 + §2.7.
 *
 * @param {object} state — session_state slice
 * @param {object} signal — { type, intensity, projection_quote?, is_factual_statement? }
 * @returns {{invoke: boolean, variant: string, reason?: string}}
 */
export function shouldInvoke(state, signal) {
  // §9.1 level 1 safety — crisis mode active → 不 invoke 任何 reframe (R1_C 例外、見 buildInject).
  if (state?.primary_mode === 'crisis' || (state?.active_modes || []).includes('crisis')) {
    return { invoke: false, variant: null, reason: 'crisis_mode_active' };
  }
  // R1_F3 — 「他打了我」事實陳述、不是投射、不 invoke.
  if (signal?.is_factual_statement) {
    return { invoke: false, variant: null, reason: 'factual_statement_not_projection' };
  }
  // §9.1 level 5 — 過度 invoke 降頻.
  const priorR1 = Number(state?.reframe_invocation_history_in_session?.filter
    ? state.reframe_invocation_history_in_session.filter(e => e.reframe_id === 'R1').length
    : 0);
  if (priorR1 >= 5) {
    return { invoke: false, variant: null, reason: 'over_invocation_per_session_cap_5' };
  }
  // Variant routing — negative generalization marker promotes to R1_B.
  const variant = signal?.negative_generalization
    ? R1_VARIANTS.R1_B
    : R1_VARIANTS.R1_A;
  return { invoke: true, variant, reason: null };
}

export const R1 = Object.freeze({
  id: 'R1',
  name_zh: 'Reclaim Source 收回源頭',
  name_en: 'Reclaim Source',
  tier: 1,
  damon_quotes: DAMON_QUOTES,
  damon_frequency: '8 份分析 / 16 份 (library 最高頻 reframe)',
  mode_applicability: MODE_APPLICABILITY,
  variants: R1_VARIANTS,
  buildInject,
  shouldInvoke,
});
