// lib/damon-reframe-library/r3-failure-as-feedback.js
// v5.1 Step 7 PR-7a — R3 失敗作為 Feedback.
//
// Source: v51_damon_reframe_library.md §4 (1 份明確 + §3 紅線 10 隱含).
// 話術 = library §4.4 verbatim 5 step.
// 變體 = R3_A standard / R3_B with_negative_generalization (cascade R11 / integration).
//
// ⏸️ R3_C 科學家精神 vs 受審判的犯人 變體 → errata v0.2 Patch 5.2 → PR-7b.

export const R3_VARIANTS = Object.freeze({
  R3_A: 'standard',
  R3_B: 'with_negative_generalization',   // 又 / 總是 / 永遠 → cascade R11
});

const DAMON_QUOTES = Object.freeze([
  '失敗不會動搖你、它教你',                  // §3 紅線 ship 版核心句式
  '航向修正、不是身份否定',
  '失敗是回饋(Feedback)、不是判決',
]);

const MODE_APPLICABILITY = Object.freeze({
  elicitation:        'not_applicable',
  identity_anchoring: 'applicable',     // 身份測試「不是」時、reframe 不算 failure
  integration:        'primary',        // ✓✓ 反例整合、resistance 處理最常用
  cascade:            'applicable',     // Top 2/3 failed 時
  future_pacing:      'not_applicable',
  crisis:             'not_applicable',
});

export function buildInject(ctx = {}) {
  const variant = ctx.variant || R3_VARIANTS.R3_A;
  const failureEvent = ctx.failure_quote || '[學員 surface 的失敗 event]';
  const selfBlame = ctx.self_blame_quote || '[學員 self-blame 原話]';
  const mode = ctx.mode || 'integration';
  const prior = Number(ctx.prior_invocations || 0);

  // R3_F2 — AI 過度 reframe → acknowledge 優先.
  if (prior >= 3) {
    return `[SYSTEM INJECT — R3 Failure as Feedback (acknowledge-priority, prior=${prior})]

session 內 R3 已 invoke ${prior} 次、避免 toxic positivity:
不再 reframe、退到 sober acknowledge:

> 「我聽到了。」

學員 surface failure 後給空間、不每次都翻成 feedback.`;
  }

  // R3_B → cascade R11 (integration negative_generalization).
  if (variant === R3_VARIANTS.R3_B) {
    return `[SYSTEM INJECT — R3_B Failure with Negative Generalization → cascade R11]

學員 surface「${selfBlame}」帶「又 / 總是 / 永遠」型 negative generalization.
本 reframe 不單獨完成、cascade R11 Negative Generalization (integration mode 內專用).

R11 接管 — 見 prompt-sections/conditional/engine-3/integration-router.js
+ S5_INTEGRATION_INJECT phrasing「這個『又』、我想停下來」.`;
  }

  // R3_A standard 5-step script per library §4.4.
  return `[SYSTEM INJECT — R3_A Failure as Feedback (standard)]

mode: ${mode}.
trigger: 學員 surface 失敗 / 挫折 + self-blame.

話術 (library §4.4 逐字 5 step):

**Step 1 — pause at self-blame**:
> 「我聽到你說『${selfBlame}』——我想停一下。」

**Step 2 — distinction**:
> 「那個 ${failureEvent} 是發生的事——
>  『我這個人 X』是你對自己下的判決。
>  這兩個是不一樣的事。」

**Step 3 — state the reframe**:
> 「失敗不會動搖你、它教你。
>  那個 ${failureEvent} 沒有告訴你『你不是 [quality] 的人』——
>  它告訴你『[what to adjust]』。」

**Step 4 — invite articulation**:
> 「你願意這樣看那個 ${failureEvent} 嗎?它在告訴你什麼?」

**Step 5 — if resistant**:
若學員「不、就是我不夠」→ cascade R1 Reclaim Source 或 Parts Integration:
> 「我聽到了。不夠——這個感覺、是從哪裡來的?
>  是 ${failureEvent} 給你的、還是你拿來判決自己的?」

⚠️ 進入 worth fiction / Bargain 領域 → 可能 cascade crisis mode.

機制:
- failure_mode R3_F1 學員拒絕 reframe → 不美化、改說「我不是要美化、是要把 event 和 judgment 分開」.
- failure_mode R3_F2 過度 reframe → acknowledge 優先 (本 handler 已自動降頻 prior >= 3).`;
}

export function shouldInvoke(state, signal) {
  if (state?.primary_mode === 'crisis' || (state?.active_modes || []).includes('crisis')) {
    return { invoke: false, variant: null, reason: 'crisis_mode_active' };
  }
  const priorR3 = (state?.reframe_invocation_history_in_session || [])
    .filter(e => e.reframe_id === 'R3').length;
  if (priorR3 >= 5) {
    return { invoke: false, variant: null, reason: 'over_invocation_per_session_cap_5' };
  }
  const variant = signal?.negative_generalization
    ? R3_VARIANTS.R3_B
    : R3_VARIANTS.R3_A;
  return { invoke: true, variant, reason: null };
}

export const R3 = Object.freeze({
  id: 'R3',
  name_zh: '失敗作為 Feedback',
  name_en: 'Failure as Feedback',
  tier: 3,
  damon_quotes: DAMON_QUOTES,
  damon_frequency: '1 份明確 + §3 紅線 10 隱含',
  mode_applicability: MODE_APPLICABILITY,
  variants: R3_VARIANTS,
  buildInject,
  shouldInvoke,
});
