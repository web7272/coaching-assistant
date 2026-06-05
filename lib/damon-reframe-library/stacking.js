// lib/damon-reframe-library/stacking.js
// v5.1 Step 7 PR-7a — Reframe Stacking 規則 (library §9 完整實作).
//
// 取代 Step 5a 的過渡單 invoke 優先序 (S2>S4>S1>S5>S3) — 不再用 signal-tier
// priority、改 reframe-level §9 stacking rules.
// Step 5a fallback 保留為 single-signal fallback 路徑 (見 engine-1.js 註解).

import { REFRAME_TIERS } from './index.js';

/**
 * §9.1 Stacking priority levels.
 *
 * level_1: crisis SOP 優先於 reframe (任何 reframe 在 crisis mode 不 invoke、除 R1_C).
 * level_2: 強訊號 (明確 regex 命中 / passive death wish) 優先於弱訊號.
 *           例: 同 turn S2 passive_death_wish + S1 external_locus → crisis SOP wins.
 * level_3: mode-specific default — 各 mode 有 default reframe (§9.3 對映表).
 * level_4: tier 排序 — tier 1 > tier 2 > tier 3.
 * level_5: 最近 invoke 避免 — 同 session 內已 invoke 該 reframe → 降優先級.
 *
 * Mutually exclusive within turn (§9.2):
 *   R1 ↔ R6  (源頭外包 vs 視角外移 overlap、選一)
 *   R5 ↔ R7  (away from vs frequency illusion、不同 context、若同 turn 選 R5)
 *   R2 ↔ R3  (失敗 reframe 處理 self-blame priority → R3、之後 R2)
 */

const MUTUAL_EXCLUSION = Object.freeze([
  ['R1', 'R6'],
  ['R5', 'R7'],
  ['R2', 'R3'],
]);

/**
 * §9.3 Mode × Reframe default 對映表.
 *   primary (✓✓✓) = 必會
 *   default (✓✓) = 很常用
 *   applicable (✓) = 條件觸發
 *   limited (△) = R1_C only, clinical review
 */
const MODE_DEFAULTS = Object.freeze({
  elicitation:        ['R5', 'R1', 'R4', 'R6'],
  identity_anchoring: ['R2', 'R1', 'R3', 'R5', 'R6', 'R7'],
  integration:        ['R3', 'R11', 'R1', 'R2', 'R4', 'R5', 'R6', 'R7'],
  cascade:            ['R2', 'R3'],
  future_pacing:      ['R7', 'R2', 'R6'],
  crisis:             [],  // ❌ no reframe in crisis (R1_C special, gated separately)
});

/**
 * Given multiple candidate reframes that all passed shouldInvoke, pick ONE
 * per §9 stacking rules.
 *
 * @param {string[]} candidates — array of reframe ids (e.g. ['R1', 'R5', 'R7'])
 * @param {object} state — session_state slice (primary_mode, active_modes, reframe history)
 * @param {object} signal — { strength?: 'weak'|'medium'|'strong', strong_signal_type? }
 * @returns {{picked: string|null, reason: string, dropped: object[]}}
 */
export function pickReframeForTurn(candidates, state, signal = {}) {
  const dropped = [];
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return { picked: null, reason: 'no_candidates', dropped };
  }

  // §9.1 level_1 — crisis SOP overrides any reframe.
  if (state?.primary_mode === 'crisis' || (state?.active_modes || []).includes('crisis')) {
    candidates.forEach(id => dropped.push({ id, reason: 'crisis_mode_active' }));
    return { picked: null, reason: 'crisis_mode_active', dropped };
  }

  // §9.1 level_2 — strong signal (passive_dw / explicit crisis cascade) preempts.
  //   If signal.strong_signal_type indicates a deep crisis signal, no reframe invoked.
  if (signal?.strong_signal_type === 'passive_death_wish' || signal?.strong_signal_type === 'sustained_landmine') {
    candidates.forEach(id => dropped.push({ id, reason: `strong_signal_preempt:${signal.strong_signal_type}` }));
    return { picked: null, reason: `strong_signal_preempt:${signal.strong_signal_type}`, dropped };
  }

  // De-dup + filter to known reframes.
  const known = Array.from(new Set(candidates)).filter(id => REFRAME_TIERS[id] != null);

  // §9.2 — mutual exclusion (within-turn).
  let remaining = [...known];
  for (const [a, b] of MUTUAL_EXCLUSION) {
    if (remaining.includes(a) && remaining.includes(b)) {
      // Tie-break per library §9.2 specific notes:
      //   R1 ↔ R6: choose R1 (source priority, R6 view shift).
      //   R5 ↔ R7: choose R5 (more foundational).
      //   R2 ↔ R3: choose R3 (self-blame priority).
      const winner = a === 'R2' && b === 'R3' ? 'R3' : a;
      const loser = winner === a ? b : a;
      remaining = remaining.filter(id => id !== loser);
      dropped.push({ id: loser, reason: `mutually_exclusive_with_${winner}` });
    }
  }

  // §9.1 level_5 — recently-invoked drops priority. Pre-compute counts.
  const invocationHistory = state?.reframe_invocation_history_in_session || [];
  const sessionCounts = {};
  for (const e of invocationHistory) {
    if (e?.reframe_id) sessionCounts[e.reframe_id] = (sessionCounts[e.reframe_id] || 0) + 1;
  }

  // §9.1 level_3 — mode-specific default ordering.
  const mode = state?.primary_mode || 'integration';   // safe default if mode missing
  const defaults = MODE_DEFAULTS[mode] || [];
  const defaultPos = id => {
    const idx = defaults.indexOf(id);
    return idx === -1 ? Number.POSITIVE_INFINITY : idx;
  };

  // Score remaining: (a) default position lower = better; (b) tier lower = better;
  // (c) session count higher = penalize.
  remaining.sort((a, b) => {
    const dpA = defaultPos(a);
    const dpB = defaultPos(b);
    if (dpA !== dpB) return dpA - dpB;
    const tierDiff = (REFRAME_TIERS[a] || 99) - (REFRAME_TIERS[b] || 99);
    if (tierDiff !== 0) return tierDiff;
    return (sessionCounts[a] || 0) - (sessionCounts[b] || 0);
  });

  const picked = remaining[0] || null;
  for (const id of remaining.slice(1)) dropped.push({ id, reason: 'lower_priority_in_mode' });
  if (!picked) {
    return { picked: null, reason: 'no_applicable_after_filter', dropped };
  }
  return {
    picked,
    reason: `mode=${mode} default_priority + tier=${REFRAME_TIERS[picked]} + session_count=${sessionCounts[picked] || 0}`,
    dropped,
  };
}

/**
 * Helper — exposed for tests + dashboards.
 */
export const _internal = Object.freeze({ MUTUAL_EXCLUSION, MODE_DEFAULTS });
