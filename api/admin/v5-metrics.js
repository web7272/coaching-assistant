// api/admin/v5-metrics.js
// v5.1 Step 8 — Admin metrics endpoint (errata Patch 4 task_4 — additive、API先行).
//
// 回傳:
//   - 8 metrics (errata §3.1-§3.4 metric_1 ~ metric_8 + signal cascade)
//   - per-student alert flags (errata §2.2 6 categories)
//   - M-series event counts (M71/M72/M73 from PR-6b + future M aggregates)
//   - 6.10 four failure signals current state + mode-aware context (errata task_4)
//
// 教練後台 UI 不在本批 — API先行,後台 dashboard 接 metrics 顯示是另案.
//
// Auth: requireAdmin (mirrors api/admin/v4-metrics.js pattern).

import { neon } from '@neondatabase/serverless';
import { requireAdmin } from '../../lib/auth/require-admin.js';

import {
  buildModeTransitionReport,
} from '../../lib/dashboard/mode-transition-tracker.js';
import {
  buildReframeReport,
} from '../../lib/dashboard/reframe-invocation-tracker.js';
import {
  buildLandingPageReport,
} from '../../lib/dashboard/landing-page-alignment-tracker.js';
import {
  buildSignalCascadeReport,
} from '../../lib/dashboard/signal-cascade-tracker.js';
import {
  evaluateAllRules,
} from '../../lib/dashboard/alert-rules.js';
import {
  M_REGISTRY, getByTier, SEVERITY_TIER,
} from '../../lib/dashboard/failure-modes.js';
import {
  buildActiveContextReport,
  classifySwapLevel, SWAP_LEVELS,
} from '../../lib/dashboard/active-context-tracker.js';

export const config = {
  maxDuration: 30,
};

/**
 * 6.10 four failure signals (维持 v5.0 既有 4 signals + mode-aware context label
 * per errata task_4). Each signal annotated with the mode it most commonly fires in.
 */
const SIX_TEN_SIGNALS = Object.freeze({
  signal_1_takeaway_sentiment_negative: {
    name_zh: 'Takeaway 學員 sentiment 負面',
    mode_aware_context: ['identity_anchoring', 'integration', 'future_pacing'],
  },
  signal_2_amnesia_consecutive: {
    name_zh: 'Amnesia 連續 sessions 無 anchor recall',
    mode_aware_context: ['future_pacing', 'integration_retention'],
  },
  signal_3_e1c_repeat_trigger: {
    name_zh: 'E1c 反例避免 repeat trigger',
    mode_aware_context: ['identity_anchoring', 'integration'],
  },
  signal_4_consecutive_hard_limit: {
    name_zh: 'Hard limit 連續 sessions 強制收尾',
    mode_aware_context: ['elicitation', 'identity_anchoring', 'integration'],
  },
});

export default async function handler(req, res) {
  const user = await requireAdmin(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  try {
    const sql = neon(process.env.DATABASE_URL);

    // Optional ?student_id=A006 for per-student drill-down; default = aggregate.
    const studentId = (req.query && typeof req.query.student_id === 'string')
      ? req.query.student_id : null;

    // ── Pull data: user_profile_evolution + recent sessions ──
    const profilesRows = studentId
      ? await sql`SELECT * FROM user_profile_evolution WHERE student_id = ${studentId}`
      : await sql`SELECT * FROM user_profile_evolution WHERE last_active_date > NOW() - INTERVAL '30 days'`;

    const recentSessionsRows = studentId
      ? await sql`
          SELECT id, student_id, session_state, created_at
          FROM sessions WHERE student_id = ${studentId}
          ORDER BY created_at DESC LIMIT 30
        `
      : await sql`
          SELECT id, student_id, session_state, created_at
          FROM sessions
          WHERE created_at > NOW() - INTERVAL '30 days'
          ORDER BY created_at DESC LIMIT 500
        `;

    // ── v5.2 第五塊: pull active_context + current_day + context_onboarded ──
    //   Aggregate-only columns from students table — small projection, no JSON
    //   blobs. Fail-soft: if migrations 029/031 not applied (legacy DB), catch
    //   and feed empty array → active_context block degrades gracefully.
    let studentsRowsForContext = [];
    try {
      studentsRowsForContext = studentId
        ? await sql`
            SELECT student_id, active_context_category, current_day, context_onboarded
            FROM students WHERE student_id = ${studentId}
          `
        : await sql`
            SELECT student_id, active_context_category, current_day, context_onboarded
            FROM students
          `;
    } catch (e) {
      // Column missing → migration 029/031 not yet applied. Leave empty so the
      // active_context section reads as zero across the board (caller knows
      // migration status separately). Log structured event for observability.
      console.warn('[v5-metrics][active_context] students columns missing — migrations 029/031 not applied?', e?.message);
    }

    // ── Build per-profile metric snapshots ──
    const perStudent = {};
    for (const profile of profilesRows) {
      const sid = profile.student_id;
      const carryForwards = [];
      if (profile.crisis_state_carry_forward) {
        carryForwards.push(profile.crisis_state_carry_forward);
      }
      const invocationHistory = Array.isArray(profile.reframe_invocation_history)
        ? profile.reframe_invocation_history : [];

      // Filter sessions for this student.
      const studentSessions = recentSessionsRows.filter(s => s.student_id === sid);

      // Extract mode_transition_log + per-turn snapshots from session_state.
      const perSessionLogs = studentSessions.map(s =>
        Array.isArray(s.session_state?.mode_transition_log) ? s.session_state.mode_transition_log : []);
      const perTurnSnapshotsPerSession = studentSessions.map(s => {
        const log = s.session_state?.mode_transition_log;
        if (!Array.isArray(log)) return [];
        return log.map(entry => ({ active_modes: entry?.to_active_modes || [] }));
      });

      // Aggregate metric reports.
      const cohort = profile.cohort_tag || 'healthy';   // optional column; default healthy
      const modeReport = buildModeTransitionReport({
        perSessionLogs, perTurnSnapshotsPerSession, cohort,
      });

      // Total turns approximation: sum of mode_transition_log lengths (or 1 if missing).
      const total_turns = studentSessions.reduce(
        (acc, s) => acc + (s.session_state?.turn_count_this_session || 0), 0);
      const reframeReport = buildReframeReport({
        invocationHistory, total_turns, recentSessionRates: [],
      });

      // M71 audits: extract from session_state.m71_reminder_audit.
      const m71Audits = studentSessions
        .map(s => s.session_state?.m71_reminder_audit)
        .filter(Boolean);
      const landingReport = buildLandingPageReport({
        crisisCarryForwards: carryForwards, m71Audits,
      });

      // Signal cascade: filter session states by cohort, compute rates.
      const perSessionStates = studentSessions.map(s => s.session_state || {});
      const signalReport = buildSignalCascadeReport({
        perSessionStatesHealthy:    cohort === 'healthy' ? perSessionStates : [],
        perSessionStatesVulnerable: cohort === 'vulnerable' ? perSessionStates : [],
      });

      // v5.2 第五塊 — extract this-student's cross_context_swap_count from
      // the most recent session_state (used both for alert eval + per-student
      // swap-level classification surfaced in the response).
      const latestSwapCount =
        Number(studentSessions[0]?.session_state?.cross_context_swap_count) || 0;
      const studentContextRow = studentsRowsForContext.find(r => r.student_id === sid);

      // Alert evaluation (errata §2.2 6 categories + v5.2 第五塊 rule 7).
      const alerts = evaluateAllRules({
        recentSessionTransitionCounts: perSessionLogs
          .map(log => log.filter(e => e.from_primary !== e.to_primary).length),
        perTurnSnapshots: perTurnSnapshotsPerSession.flat(),
        crisis_triggered_this_session: studentSessions[0]?.session_state?.crisis_in_progress === true,
        passive_death_wish_count_cumulative: Number(profile.passive_death_wish_count || 0),
        active_si_confirmed_this_session:
          studentSessions[0]?.session_state?.crisis_sop_state?.si_answer === 'confirm'
          && studentSessions[0]?.session_state?.crisis_sop_state?.plan_answer === 'has_plan',
        crisis_handler_already_fired: studentSessions[0]?.session_state?.hitl_critical_alert === true,
        // landmine + reframe inputs left empty here — populated by future ingest passes.
        recent_landmine_attempts: [],
        reframe_invocation_counts: aggregateInvocationCountsById(invocationHistory),
        recent_reframe_rates: [],
        // ⭐ v5.2 第五塊 — case 3 swap escalate inputs.
        cross_context_swap_count: latestSwapCount,
        active_context_category: studentContextRow?.active_context_category || null,
      });

      perStudent[sid] = {
        cohort,
        mode_transition: modeReport,
        reframe: reframeReport,
        landing_page: landingReport,
        signal_cascade: signalReport,
        alerts,
        // ⭐ v5.2 第五塊 — per-student cross-context swap state (drill-down).
        cross_context_swap: {
          consecutive_turns: latestSwapCount,
          level: classifySwapLevel(latestSwapCount),
          escalate_flag: studentSessions[0]?.session_state?.cross_context_swap_escalate === true,
        },
      };
    }

    // ── M-series event counts ──
    // For now, aggregate just M71/M72/M73 from PR-6b audits. Other M events
    // ingest as PRs land (M60-M70 plumbing future work).
    const m71_72_73_totals = Object.values(perStudent).reduce((acc, s) => {
      const ev = s.landing_page?.m_series_events;
      if (ev) {
        acc.m71_violations += ev.m71_violations || 0;
        acc.m72_offer_max_skips += ev.m72_offer_max_skips || 0;
        acc.m73_resolved_reset_attempts += ev.m73_resolved_reset_attempts || 0;
      }
      return acc;
    }, { m71_violations: 0, m72_offer_max_skips: 0, m73_resolved_reset_attempts: 0 });

    // ⭐ v5.2 第五塊 — aggregate active_context metrics across the cohort.
    //   (Distribution / completion / onboarded-rate from students table, not
    //   session_state.) Per-student swap classification lives in per_student.
    const activeContextReport = buildActiveContextReport(studentsRowsForContext);

    // Roll-up: how many students currently in each swap level.
    const swapLevelTotals = { healthy: 0, watching: 0, escalate_vivi: 0 };
    for (const s of Object.values(perStudent)) {
      const lvl = s.cross_context_swap?.level || SWAP_LEVELS.HEALTHY;
      swapLevelTotals[lvl] = (swapLevelTotals[lvl] || 0) + 1;
    }

    return res.status(200).json({
      generated_at: new Date().toISOString(),
      student_id_filter: studentId,
      profile_count: profilesRows.length,
      session_window_count: recentSessionsRows.length,
      // Per-student detail.
      per_student: perStudent,
      // Aggregate M events.
      m_series_event_counts: {
        m71_72_73: m71_72_73_totals,
      },
      // M-series severity-tier exposure (for UI taxonomy).
      m_series_registry_summary: {
        highest_priority_count: getByTier(SEVERITY_TIER.HIGHEST).length,
        high_priority_count:    getByTier(SEVERITY_TIER.HIGH).length,
        medium_priority_count:  getByTier(SEVERITY_TIER.MEDIUM).length,
        total_registered:       Object.keys(M_REGISTRY).length,
      },
      // 6.10 four signals + mode-aware context (errata task_4).
      six_ten_signals: SIX_TEN_SIGNALS,
      // ⭐ v5.2 第五塊 — active_context dashboard metrics.
      active_context: {
        distribution: activeContextReport.distribution,
        completion:   activeContextReport.completion,
        onboarded:    activeContextReport.onboarded,
        cross_context_swap_totals: swapLevelTotals,
      },
    });
  } catch (err) {
    console.error('[v5-metrics] error:', err?.message || err);
    return res.status(500).json({ error: 'internal_error', detail: err?.message });
  }
}

/**
 * Helper — aggregate { reframe_id: count } from invocation history.
 */
function aggregateInvocationCountsById(history) {
  if (!Array.isArray(history)) return {};
  const out = {};
  for (const e of history) {
    if (typeof e?.reframe_id === 'string') {
      out[e.reframe_id] = (out[e.reframe_id] || 0) + 1;
    }
  }
  return out;
}
