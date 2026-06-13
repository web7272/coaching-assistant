// lib/api/observer-driver.js
// v5.3 Stage B (6/13) — Shared per-session observer driver.
//
// Single source of truth for "iterate session messages → run observer judge →
// accumulate". Used by:
//   - scripts/observer-eval.js (Stage A: graded eval against fixtures)
//   - api/finalize-day.js     (Stage B: session-close production capture)
//
// 0 facing — observer purely READS what already happened in messages, writes
// state. Does NOT alter Sonnet conversation, does NOT call any LLM in caller's
// hot path (finalize-day runs after the user's last turn is already shipped).
//
// Safety: observer.judge() already has pre-LLM gate (crisis / high_risk /
// noise) + post-LLM scrub. This driver just orchestrates; safety is owned by
// observer itself.

import { judge as defaultObserverJudge } from '../haiku-judge/sc-observer.js';

// ────────────────────────────────────────────────────────────────
// Pure: pair messages into Q/A turns (assistant → user pairs).
//   - Skip leading user (no AI question to pair with).
//   - Skip trailing assistant (no learner reply yet).
//   - Skip empty content on either side.
// ────────────────────────────────────────────────────────────────
export function pairMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const turns = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const cur = messages[i];
    const nxt = messages[i + 1];
    if (!cur || !nxt) continue;
    if (cur.role !== 'assistant') continue;
    if (nxt.role !== 'user') continue;
    const ai   = String(cur.content || '');
    const user = String(nxt.content || '');
    if (ai.trim().length === 0 || user.trim().length === 0) continue;
    turns.push({
      day: cur.day ?? nxt.day ?? null,
      question_number: nxt.question_number ?? cur.question_number ?? 0,
      ai,
      user,
    });
  }
  return turns;
}

// ────────────────────────────────────────────────────────────────
// runObserverOverSession — iterate turns + accumulate observer output.
//
// @param {object} args
// @param {Array}  args.messages       — array of {role, content, question_number, day?}
// @param {string} [args.primaryMode]  — context.primary_mode for observer (default 'elicitation')
// @param {string} args.now_iso        — ISO timestamp from caller (no Date.now in pure code)
// @param {Function} [args.judgeFn]    — observer judge override (tests inject mock)
// @param {Function} [args.log]
// @returns {{
//   accumulated: { values: string[], owned: string[], top1: string|null, steps_touched: number[] },
//   step_evidence: { step_1: Array, ..., step_7: Array },
//   reframe_events: Array,
//   skip_counts: { crisis: number, high_risk: number, meta_complaint: number, app_noise: number },
//   sc_journey_step: number|null,
//   turns_count: number,
//   judged_count: number
// }}
// ────────────────────────────────────────────────────────────────
export async function runObserverOverSession({
  messages,
  primaryMode = 'elicitation',
  now_iso,
  judgeFn = defaultObserverJudge,
  log = () => {},
} = {}) {
  const turns = pairMessages(messages);
  const accumulated = {
    values: [], owned: [], top1: null, steps_touched: [],
  };
  const step_evidence = {
    step_1: [], step_2: [], step_3: [], step_4: [],
    step_5: [], step_6: [], step_7: [],
  };
  const reframe_events = [];
  const skip_counts = { crisis: 0, high_risk: 0, meta_complaint: 0, app_noise: 0 };
  let judged_count = 0;

  for (const turn of turns) {
    let obs;
    try {
      obs = await judgeFn({
        turn,
        accumulated,
        context: { primary_mode: primaryMode, now_iso },
      });
      judged_count++;
    } catch (err) {
      // judge() is fail-soft internally; this guards belt-and-suspenders.
      log(`[observer-driver] judge threw day=${turn.day} q=${turn.question_number}: ${err?.message || err}`);
      continue;
    }
    if (!obs || obs.skip) {
      const reason = obs?.skip_reason;
      if (reason && reason in skip_counts) skip_counts[reason]++;
      continue;
    }
    // Roll delta into accumulator (de-dup by string equality).
    for (const v of (obs.values_surfaced || [])) {
      if (typeof v === 'string' && v.length > 0 && !accumulated.values.includes(v)) {
        accumulated.values.push(v);
      }
    }
    for (const o of (obs.owned_confirmed || [])) {
      if (typeof o === 'string' && o.length > 0 && !accumulated.owned.includes(o)) {
        accumulated.owned.push(o);
      }
    }
    if (obs.top1_determined && typeof obs.top1_determined === 'string'
        && obs.top1_determined.length > 0 && !accumulated.top1) {
      // First top1 wins (avoid late LLM noise overwriting an earlier confirm).
      accumulated.top1 = obs.top1_determined;
    }
    for (let n = 1; n <= 7; n++) {
      const stepKey = `step_${n}`;
      const entries = (obs.step_evidence && Array.isArray(obs.step_evidence[stepKey]))
        ? obs.step_evidence[stepKey] : [];
      for (const e of entries) step_evidence[stepKey].push(e);
      if (entries.length > 0 && !accumulated.steps_touched.includes(n)) {
        accumulated.steps_touched.push(n);
      }
    }
    for (const e of (obs.reframe_events || [])) reframe_events.push(e);
  }

  // sc_journey_step = max{N : step_N non-empty}; null otherwise.
  let sc_journey_step = null;
  for (let n = 7; n >= 1; n--) {
    if (step_evidence[`step_${n}`].length > 0) { sc_journey_step = n; break; }
  }

  return {
    accumulated,
    step_evidence,
    reframe_events,
    skip_counts,
    sc_journey_step,
    turns_count: turns.length,
    judged_count,
  };
}
