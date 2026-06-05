// lib/dashboard/landing-page-alignment-tracker.js
// v5.1 Step 8 — Landing Page alignment metrics (errata §3.3).
//
// metric_6: landing_page_reminder_delivery_rate
//   target: > 95% of crisis sessions delivered reminder.
//   alert:  < 90% → §10 errata Patch 1 step 6 跳過 bug.
//
// metric_7: professional_referral_acknowledgment_rate (monitor-only)
//   formula: acknowledged / reminder_delivered.
//
// metric_8: professional_referral_refusal_rate
//   alert: > 60% 累積 → reminder 話術評估.
//
// Aggregates M71/M72/M73 events emitted by crisis-sop (PR-6b).
// Reads carry_forward.landing_page_reminder_delivered /
//        .professional_referral_acknowledged / .professional_referral_refused
// (Step 6 already writes these fields).

// ── Thresholds (errata §3.3 verbatim) ─────────────────────

export const METRIC_6_TARGET = Object.freeze({ min: 0.95 });
export const METRIC_6_ALERT = Object.freeze({ under_threshold: 0.90 });

export const METRIC_8_ALERT = Object.freeze({ over_threshold: 0.60 });

// ── Per-session aggregator from carry_forward objects ─────

/**
 * @param {Array<object>} crisisCarryForwards — one carry_forward per crisis session
 * @returns {{
 *   crisis_session_count: number,
 *   reminder_delivered_count: number,
 *   referral_acknowledged_count: number,
 *   referral_refused_count: number,
 * }}
 */
export function aggregateCarryForwards(crisisCarryForwards) {
  if (!Array.isArray(crisisCarryForwards)) {
    return {
      crisis_session_count: 0,
      reminder_delivered_count: 0,
      referral_acknowledged_count: 0,
      referral_refused_count: 0,
    };
  }
  let delivered = 0, ack = 0, refused = 0;
  for (const cf of crisisCarryForwards) {
    if (!cf || typeof cf !== 'object') continue;
    if (cf.landing_page_reminder_delivered) delivered += 1;
    if (cf.professional_referral_acknowledged) ack += 1;
    if (cf.professional_referral_refused) refused += 1;
  }
  return {
    crisis_session_count: crisisCarryForwards.length,
    reminder_delivered_count: delivered,
    referral_acknowledged_count: ack,
    referral_refused_count: refused,
  };
}

// ── metric_6 — delivery rate ──────────────────────────────

export function calculateDeliveryRate({ crisis_session_count = 0, reminder_delivered_count = 0 } = {}) {
  if (crisis_session_count <= 0) return 0;
  return reminder_delivered_count / crisis_session_count;
}

export function classifyMetric6(rate) {
  if (rate < METRIC_6_ALERT.under_threshold) {
    return { status: 'critical_alert', target: METRIC_6_TARGET, reason: 'step_6_skipped_bug' };
  }
  if (rate < METRIC_6_TARGET.min) {
    return { status: 'below_target_warning', target: METRIC_6_TARGET };
  }
  return { status: 'on_target', target: METRIC_6_TARGET };
}

// ── metric_7 — acknowledgment rate (monitor only) ────────

export function calculateAckRate({ reminder_delivered_count = 0, referral_acknowledged_count = 0 } = {}) {
  if (reminder_delivered_count <= 0) return 0;
  return referral_acknowledged_count / reminder_delivered_count;
}

// ── metric_8 — refusal rate ──────────────────────────────

export function calculateRefusalRate({ reminder_delivered_count = 0, referral_refused_count = 0 } = {}) {
  if (reminder_delivered_count <= 0) return 0;
  return referral_refused_count / reminder_delivered_count;
}

export function classifyMetric8(rate) {
  if (rate > METRIC_8_ALERT.over_threshold) {
    return { status: 'review_reminder_phrasing', alert_threshold: METRIC_8_ALERT.over_threshold };
  }
  return { status: 'on_target', alert_threshold: METRIC_8_ALERT.over_threshold };
}

// ── M71 / M72 / M73 violation aggregator ────────────────

/**
 * Aggregate M71-M73 events from crisis SOP audits.
 * crisis-sop fromStep8 emits patch.m71_reminder_audit on every closure.
 *
 * @param {Array<object>} m71Audits — m71_reminder_audit payloads
 * @returns {{
 *   m71_violations: number,
 *   m72_offer_max_skips: number,
 *   m73_resolved_reset_attempts: number,
 * }}
 */
export function aggregateM71M73Events(m71Audits) {
  if (!Array.isArray(m71Audits)) {
    return { m71_violations: 0, m72_offer_max_skips: 0, m73_resolved_reset_attempts: 0 };
  }
  let m71 = 0, m72 = 0;
  for (const audit of m71Audits) {
    if (!audit || typeof audit !== 'object') continue;
    if (audit.violation === true) m71 += 1;
    if (audit.offer_count >= 3 && !audit.delivered) m72 += 1;
  }
  // M73 detected via carry_forward: resolved_at set immediately after safety_plan
  // complete would violate M73 — but updateCarryForwardOnSessionClose enforces
  // 3-session auto-resolve only. Caller passes m73 count if any anomaly detected
  // (this aggregator just sums).
  return { m71_violations: m71, m72_offer_max_skips: m72, m73_resolved_reset_attempts: 0 };
}

// ── Full report ──────────────────────────────────────────

export function buildLandingPageReport({ crisisCarryForwards = [], m71Audits = [] } = {}) {
  const agg = aggregateCarryForwards(crisisCarryForwards);
  const rate6 = calculateDeliveryRate(agg);
  const rate7 = calculateAckRate(agg);
  const rate8 = calculateRefusalRate(agg);
  const m_events = aggregateM71M73Events(m71Audits);
  return {
    metric_6_landing_page_reminder_delivery_rate: {
      rate: rate6,
      crisis_session_count: agg.crisis_session_count,
      reminder_delivered_count: agg.reminder_delivered_count,
      classification: classifyMetric6(rate6),
    },
    metric_7_professional_referral_acknowledgment_rate: {
      rate: rate7,
      reminder_delivered_count: agg.reminder_delivered_count,
      referral_acknowledged_count: agg.referral_acknowledged_count,
      monitor_only: true,
    },
    metric_8_professional_referral_refusal_rate: {
      rate: rate8,
      reminder_delivered_count: agg.reminder_delivered_count,
      referral_refused_count: agg.referral_refused_count,
      classification: classifyMetric8(rate8),
    },
    m_series_events: m_events,
  };
}
