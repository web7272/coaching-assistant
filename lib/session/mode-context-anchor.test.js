// lib/session/mode-context-anchor.test.js
// v5.2 第二塊 PR-b — Lock modeContextFor context_name anchor for Mode 1/2/4/5
//                    + Mode 3/6 phrasing unchanged guard.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { modeContextFor } from './mode-context.js';
import { ACTIVE_MODES } from './mode-tracker.js';

// ─── Mode 1 (elicitation) phrasing anchor ─────────────────

test('🛑 v5.2 modeContextFor Mode 1 (elicitation): no contextName → v5.1 phrasing intact', () => {
  const txt = modeContextFor(ACTIVE_MODES.ELICITATION, 'opening');
  assert.match(txt, /起手式「在你的生命裡、你想要什麼\?」/);
  assert.doesNotMatch(txt, /v5\.2 context anchor/);
});

test('🛑 v5.2 modeContextFor Mode 1: contextName=「我跟先生的溝通」 → 起手式改寫 verbatim', () => {
  const txt = modeContextFor(ACTIVE_MODES.ELICITATION, 'opening', {
    contextName: '我跟先生的溝通',
  });
  // v5.1 base 仍在 (fallback path).
  assert.match(txt, /起手式「在你的生命裡、你想要什麼\?」/);
  // v5.2 anchor appended.
  assert.match(txt, /v5\.2 context anchor — 起手式改寫/);
  assert.match(txt, /v5\.1「在你的生命裡、你想要什麼\?」 → v5\.2「在「我跟先生的溝通」這塊、你想要什麼\?」/);
  assert.match(txt, /全程鏈式追問 anchor 回「我跟先生的溝通」/);
});

test('🛑 v5.2 modeContextFor Mode 1: contextName=「事業」 (category fallback) → 起手式 anchor「事業」', () => {
  const txt = modeContextFor(ACTIVE_MODES.ELICITATION, 'opening', {
    contextName: '事業',
  });
  assert.match(txt, /v5\.2「在「事業」這塊、你想要什麼\?」/);
});

// ─── Mode 2 (identity_anchoring) phrasing anchor ──────────

test('🛑 v5.2 modeContextFor Mode 2: contextName set → identity test 改寫 verbatim', () => {
  const txt = modeContextFor(ACTIVE_MODES.IDENTITY_ANCHORING, null, {
    contextName: '健康',
  });
  assert.match(txt, /v5\.2 context anchor — identity test 改寫/);
  assert.match(txt, /v5\.2「在「健康」裡、你是一個『\[top1_value\]』的人嗎\?」/);
  assert.match(txt, /學員回應 partial 時深挖 context-specificity \(這個說法在「健康」之外也一致嗎\?\)/);
});

test('🛑 v5.2 modeContextFor Mode 2: no contextName → v5.1 phrasing unchanged', () => {
  const txt = modeContextFor(ACTIVE_MODES.IDENTITY_ANCHORING, null);
  assert.doesNotMatch(txt, /v5\.2 context anchor/);
  // v5.1 base lives in IDENTITY_ANCHORING_BASE; verify intact.
  assert.match(txt, /AI 主動發起「你是一個『\[top1_value\]』的人嗎\?」/);
});

// ─── Mode 4 (cascade) phrasing anchor ─────────────────────

test('🛑 v5.2 modeContextFor Mode 4 (cascade): contextName set → Top 2/3 提問 anchor verbatim', () => {
  const txt = modeContextFor(ACTIVE_MODES.CASCADE, null, { contextName: '親密關係' });
  assert.match(txt, /v5\.2 context anchor — cascade Top 2\/3 提問/);
  assert.match(txt, /「在「親密關係」裡、\[Top 2 quality\] 對你的重要程度\?」/);
  assert.match(txt, /Cascade 順序對齊引擎 2 既有機制、context anchor 不改排序/);
});

// ─── Mode 5 (future_pacing) phrasing anchor ───────────────

test('🛑 v5.2 modeContextFor Mode 5 (future_pacing): contextName set → Future Pacing 邀請 verbatim', () => {
  const txt = modeContextFor(ACTIVE_MODES.FUTURE_PACING, null, { contextName: '自我' });
  assert.match(txt, /v5\.2 context anchor — Future Pacing 邀請/);
  assert.match(txt, /「未來在「自我」裡、你想成為什麼樣的人\?」/);
  assert.match(txt, /Let it Go ritual \+ 自然 generalize by mirror/);
  assert.match(txt, /不主動 prescribe「自我」之外 swap/);
  assert.match(txt, /Export Personal Coach Prompt 主場景 = 「自我」/);
});

// ─── Mode 3 (integration) + Mode 6 (crisis): phrasing 不動 ──

test('🛑 v5.2 modeContextFor Mode 3 (integration): contextName set → NO anchor appended (spec §3.2)', () => {
  const txt = modeContextFor(ACTIVE_MODES.INTEGRATION, null, { contextName: '家庭' });
  // Mode 3 反例機制 internal aware — phrasing 不動 per spec §3.2.
  assert.doesNotMatch(txt, /v5\.2 context anchor/);
  // v5.1 base intact.
  assert.match(txt, /Self-Concept 收編 toolbox/);
});

test('🛑 v5.2 modeContextFor Mode 6 (crisis): contextName set → NO anchor (crisis orthogonal, 不提 context)', () => {
  const txt = modeContextFor(ACTIVE_MODES.CRISIS, null, { contextName: '親密關係' });
  assert.doesNotMatch(txt, /v5\.2 context anchor/);
  // v5.1 crisis base intact.
  assert.match(txt, /Crisis Mode:Deep Signal Handoff/);
});

// ─── Edge: empty / whitespace contextName → no anchor (graceful) ──

test('🛑 v5.2 modeContextFor: empty contextName → no anchor (fallback v5.1)', () => {
  for (const empty of ['', '   ', null, undefined]) {
    const txt = modeContextFor(ACTIVE_MODES.ELICITATION, 'opening', { contextName: empty });
    assert.doesNotMatch(txt, /v5\.2 context anchor/, `contextName=${JSON.stringify(empty)} should suppress anchor`);
  }
});

test('🛑 v5.2 modeContextFor: contextName whitespace-padded → trimmed in output', () => {
  const txt = modeContextFor(ACTIVE_MODES.ELICITATION, 'opening', { contextName: '  我跟先生的溝通  ' });
  assert.match(txt, /v5\.2「在「我跟先生的溝通」這塊、你想要什麼\?」/);
  // No leading/trailing spaces inside the 引號.
  assert.doesNotMatch(txt, /「  我/);
});

// ─── Day opening inject path: anchor still appends ────────

test('🛑 v5.2 modeContextFor: dayOpeningInjectActive=true (elicitation) + contextName → anchor appends', () => {
  const txt = modeContextFor(ACTIVE_MODES.ELICITATION, 'opening', {
    dayOpeningInjectActive: true, contextName: '事業',
  });
  // Day-opening defer banner OR variant.
  assert.match(txt, /跨日開場/);
  // Anchor still appended (Mode 1 cross-day still gets context anchor).
  assert.match(txt, /v5\.2「在「事業」這塊/);
});
