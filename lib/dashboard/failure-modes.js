// lib/dashboard/failure-modes.js
// v5.1 Step 8 — M-series failure mode registry + P→M alias map.
//
// Source: v51_dashboard_errata.md Patch 1 §1.1 (P→M mapping verbatim) + §1.2
//         (severity tier list verbatim).
// Strategy decision: alias map (not direct rename) — preserves 25 files of
// legacy P-references intact; getFailureMode('P10') / 'P21' throw explicit
// deprecation guards. New code uses M-IDs directly.
//
// PR phase markers like "PR-4c-green P2 / P4 / P5" in code comments are NOT
// failure mode IDs — they refer to engineering PR phases. Untouched.

/**
 * Severity tier (errata §1.2 verbatim).
 * highest = safety critical (immediate Vivi review).
 * high    = Beta core observation.
 * medium  = standard tracking.
 */
export const SEVERITY_TIER = Object.freeze({
  HIGHEST: 'highest',
  HIGH:    'high',
  MEDIUM:  'medium',
});

/**
 * Mode attribution (errata §1.1 grouping).
 */
export const MODE_BUCKET = Object.freeze({
  ELICITATION:        'elicitation',
  IDENTITY_ANCHORING: 'identity_anchoring',
  INTEGRATION:        'integration',
  CASCADE:            'cascade',
  FUTURE_PACING:      'future_pacing',
  CRISIS:             'crisis',
  CROSS_MODE:         'cross_mode',         // C-series originally
  RESERVED:           'reserved',           // M30-39 / M42-49 / M55-59 / etc.
});

/**
 * v5.0 P-series → v5.1 M-series alias map (errata §1.1 verbatim).
 * P10 / P21 → DEPRECATED — getFailureMode() throws explicit guard.
 */
export const P_TO_M_MAP = Object.freeze({
  P1:  'M1',
  P2:  'M2',
  P3:  'M3',
  P4:  'M4',
  P5:  'M5',
  P6:  'M10',
  P7:  'M11',
  P8:  'M12',
  P9:  'M13',
  // P10 — ❌ DEPRECATED (Build Vision regression concept invalid in mode arch).
  P11: 'M20',
  P12: 'M21',
  P13: 'M22',
  P14: 'M23',
  P15: 'M24',
  P16: 'M25',
  P17: 'M26',
  P18: 'M27',
  P19: 'M40',
  P20: 'M41',
  // P21 — ❌ DEPRECATED (Top 1 演進 is legitimate mode cycle, not failure).
  P22: 'M50',
  P23: 'M51',
  P24: 'M52',
  P25: 'M53',
  // C-series (cross-mode) → M80-M81 (errata §1.1).
  C1:  'M80',
  C2:  'M81',
});

/**
 * P-IDs that are explicitly废除 (mode 架構下不存在).
 */
export const DEPRECATED_P_IDS = Object.freeze({
  P10: { reason: 'Build Vision phase 倒退 — integration mode 內動態調整、不算 failure', spec: 'errata §1.1' },
  P21: { reason: 'Phase 1 latent conflict 浮現 — Top 1 演進為合法 mode cycle、不算 failure', spec: 'errata §1.1' },
});

/**
 * M-series registry — full M1-M81 catalog per errata §1.1 + §1.2 + cross-spec
 * references (Step 4 / 5a / 6 / 7 PRs).
 *
 * Each entry: { id, name_zh, mode_bucket, severity, spec_ref }.
 * Severity per errata §1.2 (highest / high / medium).
 */
export const M_REGISTRY = Object.freeze({
  // ── Elicitation mode (M1-M9) ──
  M1:  { id: 'M1',  name_zh: '想要模糊到無法鏈式追問',          mode_bucket: MODE_BUCKET.ELICITATION,         severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P1' },
  M2:  { id: 'M2',  name_zh: 'values 互相矛盾',                  mode_bucket: MODE_BUCKET.ELICITATION,         severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P2' },
  M3:  { id: 'M3',  name_zh: 'Goal Alignment 拒答',              mode_bucket: MODE_BUCKET.ELICITATION,         severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P3' },
  M4:  { id: 'M4',  name_zh: 'Top 1 Linear Thinking Error 卡',   mode_bucket: MODE_BUCKET.ELICITATION,         severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P4' },
  M5:  { id: 'M5',  name_zh: 'Phase 1 spiritual_big_words',      mode_bucket: MODE_BUCKET.ELICITATION,         severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P5' },
  M6:  { id: 'M6',  name_zh: 'elicitation mode failure #1 (新增 gap)', mode_bucket: MODE_BUCKET.ELICITATION, severity: SEVERITY_TIER.MEDIUM, spec_ref: 'errata §1.1 new' },
  M7:  { id: 'M7',  name_zh: 'elicitation mode failure #2 (新增 gap)', mode_bucket: MODE_BUCKET.ELICITATION, severity: SEVERITY_TIER.MEDIUM, spec_ref: 'errata §1.1 new' },
  M8:  { id: 'M8',  name_zh: 'elicitation mode failure #3 (新增 gap)', mode_bucket: MODE_BUCKET.ELICITATION, severity: SEVERITY_TIER.MEDIUM, spec_ref: 'errata §1.1 new' },
  M9:  { id: 'M9',  name_zh: 'Top 1 Landmine 漏 check',           mode_bucket: MODE_BUCKET.ELICITATION,         severity: SEVERITY_TIER.HIGH,   spec_ref: 'errata §1.2 high_priority' },

  // ── Identity anchoring mode (M10-M19) ──
  M10: { id: 'M10', name_zh: '過去式 evidence',                  mode_bucket: MODE_BUCKET.IDENTITY_ANCHORING,  severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P6' },
  M11: { id: 'M11', name_zh: '外部驗證 evidence',                mode_bucket: MODE_BUCKET.IDENTITY_ANCHORING,  severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P7 (critical in v5.0, medium under mode arch)' },
  M12: { id: 'M12', name_zh: 'Phase 2 Day 1 直接 owned',         mode_bucket: MODE_BUCKET.IDENTITY_ANCHORING,  severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P8' },
  M13: { id: 'M13', name_zh: 'evidence 充足但「不算是」',         mode_bucket: MODE_BUCKET.IDENTITY_ANCHORING,  severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P9' },
  M14: { id: 'M14', name_zh: 'Strategy 誤判 quality (R2 dim 4)', mode_bucket: MODE_BUCKET.IDENTITY_ANCHORING,  severity: SEVERITY_TIER.HIGH,   spec_ref: 'errata §1.2 high_priority' },
  M15: { id: 'M15', name_zh: 'Frequency Illusion 漏接',          mode_bucket: MODE_BUCKET.IDENTITY_ANCHORING,  severity: SEVERITY_TIER.HIGH,   spec_ref: 'errata §1.2 high_priority' },
  M16: { id: 'M16', name_zh: 'Bargain 條件式 worth',             mode_bucket: MODE_BUCKET.IDENTITY_ANCHORING,  severity: SEVERITY_TIER.HIGH,   spec_ref: 'errata §1.2 high_priority' },
  M17: { id: 'M17', name_zh: 'Negative Generalization 漏接',     mode_bucket: MODE_BUCKET.IDENTITY_ANCHORING,  severity: SEVERITY_TIER.HIGH,   spec_ref: 'errata §1.2 high_priority' },
  M18: { id: 'M18', name_zh: 'identity_anchoring 新 failure #5', mode_bucket: MODE_BUCKET.IDENTITY_ANCHORING,  severity: SEVERITY_TIER.HIGH,   spec_ref: 'errata §1.2 high_priority' },
  M19: { id: 'M19', name_zh: 'identity_anchoring 新 failure #6', mode_bucket: MODE_BUCKET.IDENTITY_ANCHORING,  severity: SEVERITY_TIER.MEDIUM, spec_ref: 'errata §1.1 new' },

  // ── Integration mode (M20-M29) ──
  M20: { id: 'M20', name_zh: 'Resistance 不歸 5 種',              mode_bucket: MODE_BUCKET.INTEGRATION,        severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P11' },
  M21: { id: 'M21', name_zh: 'Let it Work 學員 push 繼續挖',      mode_bucket: MODE_BUCKET.INTEGRATION,        severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P12' },
  M22: { id: 'M22', name_zh: 'Build Vision 不對應 top1_value',    mode_bucket: MODE_BUCKET.INTEGRATION,        severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P13' },
  M23: { id: 'M23', name_zh: 'reference quality 連 3 次 ambiguous', mode_bucket: MODE_BUCKET.INTEGRATION,      severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P14 (high in v5.0, medium under mode arch)' },
  M24: { id: 'M24', name_zh: '亞洲學員避反例',                    mode_bucket: MODE_BUCKET.INTEGRATION,        severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P15' },
  M25: { id: 'M25', name_zh: '三向歸類全 (a) consistent',         mode_bucket: MODE_BUCKET.INTEGRATION,        severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P16 (high in v5.0, medium under mode arch)' },
  M26: { id: 'M26', name_zh: 'Step 4c evidence 是 boundary',      mode_bucket: MODE_BUCKET.INTEGRATION,        severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P17' },
  M27: { id: 'M27', name_zh: 'Binary 框架不接受 Scope Overlap',   mode_bucket: MODE_BUCKET.INTEGRATION,        severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P18' },
  M28: { id: 'M28', name_zh: 'Resisting Resistance',              mode_bucket: MODE_BUCKET.INTEGRATION,        severity: SEVERITY_TIER.HIGH,   spec_ref: 'errata §1.2 high_priority' },
  M29: { id: 'M29', name_zh: 'integration mode failure #10',      mode_bucket: MODE_BUCKET.INTEGRATION,        severity: SEVERITY_TIER.MEDIUM, spec_ref: 'errata §1.1 new' },

  // ── Cascade mode (M40-M49) ──
  M40: { id: 'M40', name_zh: 'Top 2 反覆 failed',                 mode_bucket: MODE_BUCKET.CASCADE,            severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P19' },
  M41: { id: 'M41', name_zh: 'Top 2 derived evidence',            mode_bucket: MODE_BUCKET.CASCADE,            severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P20 (critical in v5.0, medium under mode arch)' },

  // ── Future pacing mode (M50-M59) ──
  M50: { id: 'M50', name_zh: '3 時間維度 vision 不一致',          mode_bucket: MODE_BUCKET.FUTURE_PACING,      severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P22' },
  M51: { id: 'M51', name_zh: 'Let it Go 學員拒絕「放下」',         mode_bucket: MODE_BUCKET.FUTURE_PACING,      severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P23' },
  M52: { id: 'M52', name_zh: 'Export 不滿意',                     mode_bucket: MODE_BUCKET.FUTURE_PACING,      severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P24' },
  M53: { id: 'M53', name_zh: 'Day 8 早完成失落感',                mode_bucket: MODE_BUCKET.FUTURE_PACING,      severity: SEVERITY_TIER.MEDIUM, spec_ref: 'P25' },
  M54: { id: 'M54', name_zh: 'Slip into Unconscious 未 invoke',   mode_bucket: MODE_BUCKET.FUTURE_PACING,      severity: SEVERITY_TIER.HIGH,   spec_ref: 'errata §1.2 high_priority' },

  // ── Crisis mode (M60-M73) — Patch 23 + §10 errata ──
  M60: { id: 'M60', name_zh: 'Passive Death Wish 漏接',           mode_bucket: MODE_BUCKET.CRISIS,             severity: SEVERITY_TIER.HIGHEST, spec_ref: 'Patch 23 H5 + §10.7' },
  M61: { id: 'M61', name_zh: 'Passive Death Wish 隱性訊號誤判',   mode_bucket: MODE_BUCKET.CRISIS,             severity: SEVERITY_TIER.HIGHEST, spec_ref: 'Patch 23 H4 + §10.7' },
  M62: { id: 'M62', name_zh: 'Crisis cross-session state 不 carry', mode_bucket: MODE_BUCKET.CRISIS,           severity: SEVERITY_TIER.HIGHEST, spec_ref: '§10.7 + Step 5c' },
  M63: { id: 'M63', name_zh: 'SI risk assessment SOP 未執行',     mode_bucket: MODE_BUCKET.CRISIS,             severity: SEVERITY_TIER.HIGH,   spec_ref: '§10.7 + Step 6' },
  M64: { id: 'M64', name_zh: '1925 未提供',                       mode_bucket: MODE_BUCKET.CRISIS,             severity: SEVERITY_TIER.HIGH,   spec_ref: '§10.7' },
  M65: { id: 'M65', name_zh: 'Activity-based safety plan 未 articulate', mode_bucket: MODE_BUCKET.CRISIS,      severity: SEVERITY_TIER.HIGH,   spec_ref: 'errata §1.2 high_priority + §10.7' },
  M66: { id: 'M66', name_zh: 'Handoff 三選一未提供',              mode_bucket: MODE_BUCKET.CRISIS,             severity: SEVERITY_TIER.HIGH,   spec_ref: '§10.7' },
  M67: { id: 'M67', name_zh: 'count >= 3 仍提供 (c) 選項',         mode_bucket: MODE_BUCKET.CRISIS,             severity: SEVERITY_TIER.HIGH,   spec_ref: 'Patch 23 + §10.7' },
  M68: { id: 'M68', name_zh: 'Crisis 結束後 mode 未自動回原',     mode_bucket: MODE_BUCKET.CRISIS,             severity: SEVERITY_TIER.MEDIUM, spec_ref: '§10.7' },
  M69: { id: 'M69', name_zh: 'Crisis 訊號 surface 但 AI 繼續挖 values', mode_bucket: MODE_BUCKET.CRISIS,       severity: SEVERITY_TIER.HIGH,   spec_ref: 'A006 Day 1 漏接根因' },
  M70: { id: 'M70', name_zh: 'Crisis-mixed-with-meaning-making 過度推進', mode_bucket: MODE_BUCKET.CRISIS,     severity: SEVERITY_TIER.MEDIUM, spec_ref: '§10.7' },
  M71: { id: 'M71', name_zh: 'Landing Page Reminder 未 deliver',  mode_bucket: MODE_BUCKET.CRISIS,             severity: SEVERITY_TIER.HIGHEST, spec_ref: 'landing errata §2.3 + PR-6b ship lock' },
  M72: { id: 'M72', name_zh: 'Landing Page Reminder 過度重複',     mode_bucket: MODE_BUCKET.CRISIS,             severity: SEVERITY_TIER.HIGH,   spec_ref: 'landing errata §2.3 + PR-6b ship lock' },
  M73: { id: 'M73', name_zh: 'Safety Planning 被誤當 long-term intervention', mode_bucket: MODE_BUCKET.CRISIS, severity: SEVERITY_TIER.HIGH, spec_ref: 'landing errata §2.3 + PR-6b ship lock' },

  // ── Cross-mode (M80-M81) ──
  M80: { id: 'M80', name_zh: 'Topic resistance 所有 alternative 拒', mode_bucket: MODE_BUCKET.CROSS_MODE,       severity: SEVERITY_TIER.MEDIUM, spec_ref: 'C1' },
  M81: { id: 'M81', name_zh: 'Mid-session 連續 3 場觸發',          mode_bucket: MODE_BUCKET.CROSS_MODE,         severity: SEVERITY_TIER.MEDIUM, spec_ref: 'C2' },
});

/**
 * Reserved ranges (errata §1.1 — future emergent patterns slot in).
 */
export const RESERVED_RANGES = Object.freeze({
  M30_M39: { range: 'M30-M39', note: 'reserved for new integration mode failures' },
  M42_M49: { range: 'M42-M49', note: 'reserved for cascade mode failures' },
  M55_M59: { range: 'M55-M59', note: 'reserved for future_pacing mode failures' },
});

/**
 * Lookup gate — guards against accidental use of deprecated P-IDs and
 * unknown IDs. Same pattern as damon-reframe-library's getReframe.
 *
 * @param {string} id — accepts both M-IDs (M1, M71) and P-IDs (P1) for legacy lookup.
 * @returns {object} the registry entry
 * @throws if P10 / P21 (deprecated) or unknown.
 */
export function getFailureMode(id) {
  if (typeof id !== 'string' || id.length === 0) {
    throw new TypeError('getFailureMode: id must be non-empty string');
  }
  if (DEPRECATED_P_IDS[id]) {
    throw new Error(
      `[failure-modes] ${id} is DEPRECATED: ${DEPRECATED_P_IDS[id].reason} `
      + `(${DEPRECATED_P_IDS[id].spec}). Use mode-specific failure instead.`,
    );
  }
  if (M_REGISTRY[id]) return M_REGISTRY[id];
  if (P_TO_M_MAP[id]) {
    const mId = P_TO_M_MAP[id];
    return { ...M_REGISTRY[mId], _legacy_p_id: id };
  }
  throw new Error(`[failure-modes] Unknown failure mode id: ${id}`);
}

/**
 * Filter M-registry by severity tier (errata §1.2).
 *
 * @param {string} tier — 'highest' | 'high' | 'medium'
 * @returns {object[]} array of M-entries
 */
export function getByTier(tier) {
  return Object.values(M_REGISTRY).filter(m => m.severity === tier);
}

/**
 * Filter M-registry by mode bucket.
 */
export function getByMode(mode_bucket) {
  return Object.values(M_REGISTRY).filter(m => m.mode_bucket === mode_bucket);
}

/**
 * Get the M-ID for a P-ID (or null if deprecated/unknown).
 * Non-throwing variant — useful for batch migration scripts.
 */
export function tryMapPtoM(pId) {
  if (DEPRECATED_P_IDS[pId]) return null;
  return P_TO_M_MAP[pId] || null;
}
