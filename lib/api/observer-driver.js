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

import {
  judge as defaultObserverJudge,
  shouldSkipPreLLM,
  emptyObservation,
} from '../haiku-judge/sc-observer.js';

// 6/13 Stage B 修 — concurrency + soft budget defaults (Patrick spec).
//   30 turn / 6 並發 ≈ 5 波 × ~2s ≈ ~10s (原序列 ~40-60s).
//   6-8 cap 避免 Anthropic rate-limit / 429.
//   Soft budget = 25s 留 35s 給 Damon note + J2/J3 + UPE (finalize maxDuration=60).
export const DEFAULT_CONCURRENCY    = 6;
export const DEFAULT_SOFT_BUDGET_MS = 25_000;

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
  concurrency = DEFAULT_CONCURRENCY,
  softBudgetMs = DEFAULT_SOFT_BUDGET_MS,
  // Test seam — inject a clock for budget tests (returns ms-since-some-epoch).
  // Production: default Date.now (driver-local timing only; judge calls still
  // get ctx.now_iso from caller for content semantics).
  clockNowMs = () => Date.now(),
} = {}) {
  const turns = pairMessages(messages);
  const context = { primary_mode: primaryMode, now_iso };
  const startMs = clockNowMs();

  // ─── Pass 1: pre-LLM filter — turns observer would skip (crisis / high_risk /
  //   meta_complaint / app_noise) get emptyObservation directly, NO LLM call
  //   dispatched. Saves Haiku $ on noise + zero-latency-impact for safety.
  //   ⚠️ This pre-skip uses observer's OWN exported `shouldSkipPreLLM` — same
  //   logic observer.judge() runs internally. We replicate to avoid dispatching
  //   judge() at all for these turns.
  const observations = new Array(turns.length); // index-aligned slot
  const dispatchIndexes = [];
  for (let i = 0; i < turns.length; i++) {
    const pre = shouldSkipPreLLM({ turn: turns[i], context });
    if (pre) {
      observations[i] = emptyObservation(pre.skip_reason);
    } else {
      dispatchIndexes.push(i);
    }
  }

  // ─── Pass 2: batched parallel dispatch.
  //   concurrency N → run N at a time, await batch, next batch. Simple semantics,
  //   easy to debug. Soft budget check between batches — if hit, mark remaining
  //   as unprocessed (fold-stage treats as "not judged" — fail-soft, retried
  //   next finalize via the same path).
  //   ⚠️ accumulated passed as {} per Patrick spec ("擇簡單者, driver 反正會
  //   dedup"). LLM may re-surface terms across turns; fold-stage de-dups.
  let budgetHit = false;
  for (let cur = 0; cur < dispatchIndexes.length; cur += concurrency) {
    if (clockNowMs() - startMs > softBudgetMs) {
      const remaining = dispatchIndexes.length - cur;
      log(`[observer-driver] soft budget ${softBudgetMs}ms hit; ${remaining} of ${dispatchIndexes.length} judge call(s) deferred (fail-soft, retried next finalize)`);
      budgetHit = true;
      break;
    }
    const batch = dispatchIndexes.slice(cur, cur + concurrency);
    const settled = await Promise.allSettled(batch.map(async (i) => {
      const turn = turns[i];
      const obs = await judgeFn({ turn, accumulated: {}, context });
      return { i, obs };
    }));
    for (let j = 0; j < settled.length; j++) {
      const idx = batch[j];
      const turn = turns[idx];
      const s = settled[j];
      if (s.status === 'fulfilled') {
        observations[idx] = s.value.obs;
      } else {
        // Belt-and-suspenders fail-soft: log + mark null (fold skips with no judged_count++).
        log(`[observer-driver] judge threw day=${turn.day} q=${turn.question_number}: ${s.reason?.message || s.reason}`);
        observations[idx] = null;
      }
    }
  }

  // ─── Pass 3: fold in ORIGINAL turn order (matches sequential semantics exactly).
  //   - dedup values / owned via includes-check (string equality)
  //   - first top1 wins (avoid late LLM noise overwriting an earlier confirm)
  //   - step_evidence appended in order (turn N's entries follow turn N-1's)
  //   - reframe_events appended in order
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
  let budget_deferred_count = 0;

  for (let i = 0; i < observations.length; i++) {
    const obs = observations[i];
    if (obs === undefined) {
      // Budget hit → slot never filled. Track for log/observability.
      budget_deferred_count++;
      continue;
    }
    if (obs === null) {
      // Judge threw → slot null. Fail-soft, don't accumulate.
      continue;
    }
    judged_count++;
    if (obs.skip) {
      const reason = obs.skip_reason;
      if (reason && reason in skip_counts) skip_counts[reason]++;
      continue;
    }
    // Roll delta (de-dup by string equality).
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
      // First top1 wins (order-preserved fold == sequential semantics).
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
    elapsed_ms: clockNowMs() - startMs,
    budget_hit: budgetHit,
    budget_deferred_count,
  };
}
