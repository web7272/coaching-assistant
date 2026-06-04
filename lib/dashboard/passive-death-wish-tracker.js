// lib/dashboard/passive-death-wish-tracker.js
// Dashboard 指標: passive_death_wish (safety patch #23 / Patch 5).
// Vivi 6/4 sign-off — A006 case-driven safety + H4/H5 fail modes 監控.
//
// 對應 docs/v5-spec/design/v5_beta_failure_signals_dashboard.md §3.2/§4/§5.1
//
// 用途:
//   - cross_session_accumulation: per-learner count → escalate (≥3) / freeze (≥5)
//   - day1_miss: 同學員 Day 1 漏抓 + Day 2+ 才偵測 比率 → regex sensitivity audit
//   - false_positive (C-2 philosophical declarations): regex 過敏感檢測
//   - 連續 3 次哲學表述: H4 漏判風險 caution flag
//   - recall_rate: 人工 sample 對比 (code 只提供 aggregator, sampling 是人工流程)
//
// 設計: 純函式 (照 lib/dashboard/visual-channel-tracker.js pattern), 無 DB I/O.
//      caller (Vivi dashboard / weekly review SQL job) feeds in arrays from
//      chat_usage_log / sessions / user_profile_evolution 查詢結果.

// ─────────────────────────────────────────────────────────
// thresholds — 對齊 lib/state/handoff-escalation.js + Vivi 6/4 spec
// ─────────────────────────────────────────────────────────

export const PASSIVE_DW_ESCALATE_THRESHOLD = 3;
export const PASSIVE_DW_FREEZE_THRESHOLD   = 5;
export const PHILOSOPHICAL_CONSECUTIVE_CAUTION = 3;
export const COHORT_MIN_FOR_RATES = 50;   // 與 visual-channel-tracker 一致

export const RATE_THRESHOLDS = Object.freeze({
  FALSE_POSITIVE_HIGH:    0.30,    // >= 30% C-2 → philosophical = regex 過敏感
  DAY1_MISS_ACCEPTABLE:   0.10,    // < 10% Beta acceptable
  DAY1_MISS_AUDIT:        0.15,    // > 15% → regex sensitivity audit
  RECALL_LOW:             0.70,    // < 70% → regex 擴充
});

// ─────────────────────────────────────────────────────────
// learner-level classification
// ─────────────────────────────────────────────────────────

export const LEARNER_LEVELS = Object.freeze({
  HEALTHY:        'healthy',         // count = 0, 沒命中 passive 訊號
  REVIEW:         'review',          // count 1-2, normal 觀察 (還沒 escalate)
  ESCALATE_VIVI:  'escalate_vivi',   // count >= 3, Vivi weekly review + 三選一 移除 (c)
  FREEZE_HITL:    'freeze_hitl',     // count >= 5, freeze AI + 強制轉介
});

/**
 * Classify a single learner by their cross-session passive_death_wish_count.
 *
 * @param {number} count - user_profile_evolution.passive_death_wish_count
 * @returns {'healthy'|'review'|'escalate_vivi'|'freeze_hitl'}
 */
export function classifyLearnerLevel(count) {
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return 'healthy';
  if (count >= PASSIVE_DW_FREEZE_THRESHOLD)   return LEARNER_LEVELS.FREEZE_HITL;
  if (count >= PASSIVE_DW_ESCALATE_THRESHOLD) return LEARNER_LEVELS.ESCALATE_VIVI;
  if (count >= 1)                              return LEARNER_LEVELS.REVIEW;
  return LEARNER_LEVELS.HEALTHY;
}

// ─────────────────────────────────────────────────────────
// cross_session_accumulation: cohort histogram + alert lists
// ─────────────────────────────────────────────────────────

/**
 * Aggregate per-learner counts into a histogram + actionable lists.
 *
 * @param {Array<{student_id:string, count:number}>} learners
 * @returns {{
 *   histogram: {healthy:number, review:number, escalate_vivi:number, freeze_hitl:number},
 *   escalate_list: string[],   // student_ids needing Vivi weekly review
 *   freeze_list:   string[],   // student_ids in freeze state (HITL active)
 *   total: number,
 *   pct_healthy: number,       // target > 90%
 * }}
 */
export function aggregateCohort(learners) {
  if (!Array.isArray(learners)) {
    return {
      histogram: { healthy: 0, review: 0, escalate_vivi: 0, freeze_hitl: 0 },
      escalate_list: [], freeze_list: [], total: 0, pct_healthy: 1,
    };
  }
  const histogram = { healthy: 0, review: 0, escalate_vivi: 0, freeze_hitl: 0 };
  const escalate_list = [];
  const freeze_list = [];
  for (const l of learners) {
    if (!l || typeof l !== 'object') continue;
    const level = classifyLearnerLevel(Number(l.count) || 0);
    histogram[level]++;
    if (level === LEARNER_LEVELS.ESCALATE_VIVI) escalate_list.push(l.student_id);
    if (level === LEARNER_LEVELS.FREEZE_HITL)   freeze_list.push(l.student_id);
  }
  const total = learners.length;
  const pct_healthy = total === 0 ? 1 : histogram.healthy / total;
  return { histogram, escalate_list, freeze_list, total, pct_healthy };
}

// ─────────────────────────────────────────────────────────
// false_positive_rate: C-2 → philosophical declarations
// ─────────────────────────────────────────────────────────

/**
 * Compute the rate at which C-2 implicit detections turn out to be philosophical.
 * Vivi 6/4 折衷裁決: philosophical declarations are recorded events (still +1 to
 * counter), but don't trigger handoff. > 30% → regex 過敏感 (collapse implicit
 * regex). Below cohort min, return early_signal_hold.
 *
 * @param {{c2_fired_count:number, philosophical_declaration_count:number, cohort_size?:number}} args
 * @returns {{rate:number, decision:'healthy'|'regex_oversensitive'|'no_data'|'early_signal_hold'}}
 */
export function computeFalsePositiveRate({
  c2_fired_count, philosophical_declaration_count, cohort_size,
}) {
  if (typeof c2_fired_count !== 'number' || c2_fired_count < 0) {
    throw new TypeError('computeFalsePositiveRate: c2_fired_count must be non-negative number');
  }
  if (typeof philosophical_declaration_count !== 'number' || philosophical_declaration_count < 0) {
    throw new TypeError('computeFalsePositiveRate: philosophical_declaration_count must be non-negative number');
  }
  if (c2_fired_count === 0) return { rate: 0, decision: 'no_data' };
  const rate = Math.min(1, philosophical_declaration_count / c2_fired_count);
  if (typeof cohort_size === 'number' && cohort_size < COHORT_MIN_FOR_RATES) {
    return { rate, decision: 'early_signal_hold' };
  }
  if (rate >= RATE_THRESHOLDS.FALSE_POSITIVE_HIGH) {
    return { rate, decision: 'regex_oversensitive' };
  }
  return { rate, decision: 'healthy' };
}

// ─────────────────────────────────────────────────────────
// day1_miss_rate: same learner Day 1 false → Day 2+ true
// ─────────────────────────────────────────────────────────

/**
 * @param {Array<{student_id:string, day1_detected:boolean, day2plus_detected:boolean}>} learners
 * @returns {{rate:number, decision:'healthy'|'borderline'|'regex_sensitivity_audit'|'no_data', missed:string[]}}
 */
export function computeDay1MissRate(learners) {
  if (!Array.isArray(learners) || learners.length === 0) {
    return { rate: 0, decision: 'no_data', missed: [] };
  }
  const total = learners.length;
  const missed = learners.filter(l =>
    l && l.day2plus_detected === true && l.day1_detected !== true
  );
  const rate = missed.length / total;
  let decision;
  if (rate > RATE_THRESHOLDS.DAY1_MISS_AUDIT) {
    decision = 'regex_sensitivity_audit';
  } else if (rate > RATE_THRESHOLDS.DAY1_MISS_ACCEPTABLE) {
    decision = 'borderline';
  } else {
    decision = 'healthy';
  }
  return { rate, decision, missed: missed.map(l => l.student_id) };
}

// ─────────────────────────────────────────────────────────
// consecutivePhilosophicalCaution: H4 漏判 check per learner
// ─────────────────────────────────────────────────────────

/**
 * Per-learner H4 check: did the last K (default 3) C-2 outcomes ALL turn out
 * to be philosophical declarations? If yes → caution flag (likely H4 漏判).
 *
 * @param {Array<{event_type:'c2_fired'|'philosophical_declaration'|'real_escalation', timestamp:string|Date}>} events
 *   ONE learner's events, sorted descending by timestamp (newest first).
 * @param {number} [k=PHILOSOPHICAL_CONSECUTIVE_CAUTION]
 * @returns {boolean}
 */
export function consecutivePhilosophicalCaution(events, k = PHILOSOPHICAL_CONSECUTIVE_CAUTION) {
  if (!Array.isArray(events) || events.length < k) return false;
  // Consider only declaration vs real outcomes (drop c2_fired which is the question).
  const outcomes = events.filter(e =>
    e && (e.event_type === 'philosophical_declaration' || e.event_type === 'real_escalation')
  );
  if (outcomes.length < k) return false;
  return outcomes.slice(0, k).every(e => e.event_type === 'philosophical_declaration');
}

// ─────────────────────────────────────────────────────────
// recall_rate: human-sampled detection rate
// ─────────────────────────────────────────────────────────

/**
 * Manual workflow: Vivi samples N sessions weekly, hand-labels truth, compares
 * with what AI detected. This helper computes recall = TP / (TP + FN).
 *
 * @param {Array<{ai_detected:boolean, human_truth:'passive_dw'|'not_passive_dw'}>} samples
 * @returns {{rate:number|null, decision:'healthy'|'recall_low'|'no_data', sample_size:number}}
 */
export function computeRecallRate(samples) {
  if (!Array.isArray(samples) || samples.length === 0) {
    return { rate: null, decision: 'no_data', sample_size: 0 };
  }
  const truePositiveGroundTruth = samples.filter(s => s && s.human_truth === 'passive_dw');
  if (truePositiveGroundTruth.length === 0) {
    return { rate: null, decision: 'no_data', sample_size: samples.length };
  }
  const truePositives = truePositiveGroundTruth.filter(s => s.ai_detected === true);
  const rate = truePositives.length / truePositiveGroundTruth.length;
  return {
    rate,
    decision: rate < RATE_THRESHOLDS.RECALL_LOW ? 'recall_low' : 'healthy',
    sample_size: samples.length,
  };
}

// ─────────────────────────────────────────────────────────
// metric metadata (for dashboard registration)
// ─────────────────────────────────────────────────────────

export const METRIC_METADATA = Object.freeze({
  id: 'passive_death_wish',
  description: 'Passive death wish 偵測指標群 — cross-session accumulation + 漏判監控 (A006 case-driven)',
  metrics: {
    cross_session_accumulation: {
      formula: 'per learner: passive_death_wish_count from user_profile_evolution',
      target: '> 90% learners healthy (count=0); 1-2 review; ≥3 escalate Vivi; ≥5 freeze + 強制轉介',
    },
    day1_miss_rate: {
      formula: 'count(learners with day1_detected=false AND day2plus_detected=true) / count(total)',
      target: '< 10% acceptable Beta; > 15% → regex sensitivity audit',
    },
    false_positive_rate: {
      formula: 'count(c2_fired AND student_answered_philosophical) / count(c2_fired total)',
      target: '< 30%; ≥ 30% → implicit regex 過敏感 / 收緊',
    },
    consecutive_philosophical_caution: {
      formula: 'per learner: last 3 C-2 outcomes ALL philosophical → H4 漏判 caution flag',
      target: 'flag triggered → manual review session content + check 是否需收緊',
    },
    recall_rate: {
      formula: 'true positives / (true positives + false negatives) from human sample (weekly N=20)',
      target: '> 70%; < 70% → regex 擴充',
    },
  },
  alert_severities: {
    count_ge_3: 'escalate Vivi for weekly review (move learner to active monitoring)',
    count_ge_5: 'freeze AI 推進, 強制轉介 (HITL alert + Vivi 1-on-1 booking)',
    day1_miss_high: 'regex sensitivity audit (Day 1 漏抓 Day 2+ 才偵測 > 15%)',
    false_positive_high: 'implicit regex 過敏感 (≥ 30% C-2 → philosophical)',
    consecutive_3_philosophical: 'H4 漏判可能 (1 learner C-2 連續 3 次都 philosophical)',
    recall_low: 'regex 漏抓 (< 70% recall from human sample)',
  },
  patch_source: 'safety patch #23 (Vivi 6/4 sign-off) Patch 5 dashboard metrics',
  related_spec: 'docs/v5-spec/design/v5_beta_failure_signals_dashboard.md §3.2/§4/§5.1',
});
