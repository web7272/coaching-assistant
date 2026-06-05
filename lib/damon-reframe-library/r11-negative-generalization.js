// lib/damon-reframe-library/r11-negative-generalization.js
// v5.1 Step 7 PR-7a — R11 Negative Generalization (integration mode 內 core reframe).
//
// 不在原 library R1-R7 列表 — per Vivi 採納邊界 §A2、negative_generalization 整合進
// integration mode. R11 = code-level reframe id, body = engine-1-signals 既有
// S5_INTEGRATION_INJECT ship-able phrasing (「這個『又』、我想停下來」).
//
// 接點:
//   - integration-router.js — R11 reference 取代 TODO(Step 5a/7).
//   - R3_B 變體 cascade 到 R11 (見 r3-failure-as-feedback.js).
//   - engine-1-signals s5 integration injection 路徑保留 (R11 = wrapper, body 不重複).

import { S5_INTEGRATION_INJECT } from '../detector-handlers/engine-1-signals/index.js';

const DAMON_QUOTES = Object.freeze([
  'Damon 親口: 「又」字為 negative generalization 關鍵 trigger',
  '這個感覺、最早是什麼時候開始的?',
]);

const MODE_APPLICABILITY = Object.freeze({
  elicitation:        'not_applicable',
  identity_anchoring: 'not_applicable',
  integration:        'primary',         // ✓✓✓ integration mode 專用
  cascade:            'not_applicable',
  future_pacing:      'not_applicable',
  crisis:             'not_applicable',
});

export function buildInject(ctx = {}) {
  const prior = Number(ctx.prior_invocations || 0);
  if (prior >= 3) {
    return `[SYSTEM INJECT — R11 Negative Generalization (downsized, prior=${prior})]

session 內 R11 已 invoke ${prior} 次、降頻避免反覆挖.
退到 sober acknowledge:「我聽到了。」`;
  }
  // R11 body = existing S5_INTEGRATION_INJECT — ship-able、Vivi 已 review.
  // 不重複話術 in this file、reference engine-1-signals.
  return `[SYSTEM INJECT — R11 Negative Generalization (integration mode)]

mode: integration.
trigger: 學員 surface negative generalization「又 / 總是 / 永遠」 + integration mode active.

話術 = engine-1-signals S5_INTEGRATION_INJECT 既有 ship-able 版本:

${S5_INTEGRATION_INJECT}

機制:
- R3_B 變體 cascade 進此 reframe (R3 失敗 + negative generalization).
- multi-turn — 學員 surface「最早什麼時候開始」 後可能 cascade Parts Integration.
- Step 7 PR-7a: R11 = code-level id, body 不獨立寫死、reference 既有 S5 phrasing.`;
}

export function shouldInvoke(state, signal) {
  if (state?.primary_mode === 'crisis' || (state?.active_modes || []).includes('crisis')) {
    return { invoke: false, variant: null, reason: 'crisis_mode_active' };
  }
  // R11 ONLY in integration mode.
  if (state?.primary_mode !== 'integration' && !(state?.active_modes || []).includes('integration')) {
    return { invoke: false, variant: null, reason: 'not_integration_mode' };
  }
  if (!signal?.negative_generalization) {
    return { invoke: false, variant: null, reason: 'no_negative_generalization_signal' };
  }
  const priorR11 = (state?.reframe_invocation_history_in_session || [])
    .filter(e => e.reframe_id === 'R11').length;
  if (priorR11 >= 5) {
    return { invoke: false, variant: null, reason: 'over_invocation_per_session_cap_5' };
  }
  return { invoke: true, variant: 'R11_A', reason: null };
}

export const R11 = Object.freeze({
  id: 'R11',
  name_zh: 'Negative Generalization 整合 (又 / 總是 / 永遠)',
  name_en: 'Negative Generalization Integration',
  tier: 2,
  damon_quotes: DAMON_QUOTES,
  damon_frequency: 'integration mode 內 core reframe (S5 ship-able phrasing wrapper)',
  mode_applicability: MODE_APPLICABILITY,
  variants: { R11_A: 'standard' },
  buildInject,
  shouldInvoke,
});
