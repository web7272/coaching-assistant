// lib/api/backfill-observer-pass.js
// v5.3 Stage D (6/13) — observer 回放 helper for old-学員 backfill.
//
// 用途:
//   Stage B 之前的舊封測者 (A003/A005/A006/A008/A009/A011/A012) finalize 沒被
//   observer 看過 → sc_journey_evidence 稀疏 → 頁Y 沒料. 既有
//   `lib/api/sc-storyboard-backfill.js` 是「從 reframe_history / surfaced_values
//   / takeaways 推回 evidence」的 workaround. Stage D 把 ground truth (observer
//   實看對話) 接上 — backfill 前先跑 observer 回放整段歷史, 用 observer 的
//   step_evidence 餵 J2/J3.
//
// 0 facing — 純讀歷史 messages + 寫 evidence/step. 不碰對話 / prompt / 對任何
//   學員可見的東西.
//
// 重用 (NOT 重寫):
//   · `runObserverOverSession` (Stage B 並行 driver) — 已驗的 per-session
//     pipeline (pre-LLM skip + 並行 dispatch + 安全 postScrub).
//   · `SC_STORYBOARD_HIGH_RISK_PATTERNS` denylist (defence-in-depth, 即使
//     observer 已 postScrub 也再過一次 — 「不信任傳遞性」 per backfill 文化).
//
// 跨 session 合併語意 (對齊 Stage B driver, Patrick spec):
//   · values:           union + dedup (string equality)
//   · owned:            union + dedup
//   · top1:             first non-null wins (早的 session 先寫死)
//   · step_evidence:    依 day 順序 append (各 step bucket 內順序保留)
//   · steps_touched:    union
//   · sc_journey_step:  max{N: step_evidence[step_N] non-empty}
//
// 安全:
//   · crisis/high_risk turn 由 observer pre-LLM gate 直接 skip — caller 只要把
//     正確的 primary_mode (per session, from session_state.primary_mode) 傳進來.
//   · postScrubObservation 已在 driver 內跑. 此 helper 對 quote 再過一次 denylist
//     (defence-in-depth, 同 sc-storyboard-backfill.js 既有 pattern).
//   · 報告層 (caller) 只 emit count / type / step — 0 raw 對話 / 0 高危.

import { runObserverOverSession } from './observer-driver.js';
import { SC_STORYBOARD_HIGH_RISK_PATTERNS } from './sc-storyboard-gen.js';

// 對齊 lib/api/sc-storyboard-backfill.js PER_STEP_EVIDENCE_CAP — J2/J3 也只看
// 少量代表性 quotes; 防 evidence 過長 (observer 看 10+ 天歷史會累積很多).
export const PER_STEP_EVIDENCE_CAP = 5;

// Defence-in-depth — 即使 observer 已 postScrub, 報告/J2/J3 入口仍 re-check.
function _isHighRiskText(text) {
  if (typeof text !== 'string') return false;
  return SC_STORYBOARD_HIGH_RISK_PATTERNS.some(p => p.test(text));
}

// ────────────────────────────────────────────────────────────────
// Final sanitize: drop entries lacking type, null-out high-risk quotes
// (保留 type 不丟整筆), cap to last PER_STEP_EVIDENCE_CAP (latest wins).
// 對齊 lib/api/sc-storyboard-backfill.js sanitizeAndCap.
// ────────────────────────────────────────────────────────────────
function sanitizeAndCap(entries) {
  const out = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const type = typeof e.type === 'string' ? e.type : null;
    if (!type) continue;
    let quote = (typeof e.quote === 'string' && e.quote.trim().length > 0)
      ? e.quote.trim() : null;
    if (quote && _isHighRiskText(quote)) quote = null;
    out.push({ type, quote });
  }
  return out.slice(-PER_STEP_EVIDENCE_CAP);
}

// ────────────────────────────────────────────────────────────────
// runObserverBackfillPass — replay observer over a 学員's full session history.
//
// @param {object} args
// @param {Array}  args.sessions               — [{ id, day, session_state }] (sortable by day)
// @param {Function} args.loadMessagesForSession  — async (sessionId) → messages[]
// @param {Function} [args.judgeFn]            — observer judge override (tests; pass through to driver)
// @param {string}   args.now_iso              — caller-supplied ISO (no Date.now in pure code)
// @param {Function} [args.log]
// @param {number}   [args.concurrency]        — pass through to driver
// @param {number}   [args.softBudgetMs]       — pass through to driver
// @param {Function} [args.clockNowMs]         — pass through to driver
//
// @returns {{
//   accumulated: { values: string[], owned: string[], top1: string|null, steps_touched: number[] },
//   step_evidence: { step_1: Array, ..., step_7: Array },   // sanitized + capped
//   sc_journey_step: number|null,
//   per_session: Array<{ session_id, day, turns_count?, judged_count?, values_count?,
//                        steps_touched?, skip_counts?, budget_hit?, elapsed_ms?, error? }>,
//   totals: { sessions_count, turns_observed, judged_count, skip_counts,
//             budget_hit_count, elapsed_ms_total }
// }}
// ────────────────────────────────────────────────────────────────
export async function runObserverBackfillPass({
  sessions,
  loadMessagesForSession,
  judgeFn,
  now_iso,
  log = () => {},
  concurrency,
  softBudgetMs,
  clockNowMs,
} = {}) {
  const merged = {
    accumulated: { values: [], owned: [], top1: null, steps_touched: [] },
    step_evidence: {
      step_1: [], step_2: [], step_3: [], step_4: [],
      step_5: [], step_6: [], step_7: [],
    },
  };
  const per_session = [];
  const totals = {
    sessions_count: 0,
    turns_observed: 0,
    judged_count: 0,
    skip_counts: { crisis: 0, high_risk: 0, meta_complaint: 0, app_noise: 0 },
    budget_hit_count: 0,
    elapsed_ms_total: 0,
  };

  // Day-order replay (cross-session top1 first-wins / step_evidence append order
  // 仰賴正確 day 排序). Defensive against caller passing pre-sorted or unsorted.
  const sortedSessions = Array.isArray(sessions) ? [...sessions].sort((a, b) => {
    const ad = Number.isFinite(a?.day) ? a.day : Number.POSITIVE_INFINITY;
    const bd = Number.isFinite(b?.day) ? b.day : Number.POSITIVE_INFINITY;
    return ad - bd;
  }) : [];

  for (const sess of sortedSessions) {
    if (!sess || sess.id == null) continue;

    let messages = [];
    try {
      messages = await loadMessagesForSession(sess.id);
    } catch (err) {
      log(`[backfill-observer] loadMessages failed sess=${sess.id} day=${sess.day}: ${err?.message || err}`);
      per_session.push({ session_id: sess.id, day: sess.day, error: 'load-failed' });
      continue;
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      per_session.push({ session_id: sess.id, day: sess.day, error: 'no-messages' });
      continue;
    }

    // primary_mode: A006 crisis session 的關鍵 — observer pre-LLM gate 靠它
    // skip crisis turn. default 'elicitation' 跟 Stage B finalize 一致.
    const primaryMode = sess.session_state?.primary_mode || 'elicitation';

    let result;
    try {
      result = await runObserverOverSession({
        messages,
        primaryMode,
        now_iso,
        judgeFn,
        log,
        concurrency,
        softBudgetMs,
        clockNowMs,
      });
    } catch (err) {
      log(`[backfill-observer] driver threw sess=${sess.id} day=${sess.day}: ${err?.message || err}`);
      per_session.push({ session_id: sess.id, day: sess.day, error: 'driver-failed' });
      continue;
    }

    totals.sessions_count++;
    totals.turns_observed += result.turns_count || 0;
    totals.judged_count   += result.judged_count || 0;
    if (result.budget_hit) totals.budget_hit_count++;
    totals.elapsed_ms_total += result.elapsed_ms || 0;
    for (const k of Object.keys(totals.skip_counts)) {
      totals.skip_counts[k] += result.skip_counts?.[k] || 0;
    }

    // values: union + dedup (string equality)
    for (const v of (result.accumulated?.values || [])) {
      if (typeof v === 'string' && v.length > 0 && !merged.accumulated.values.includes(v)) {
        merged.accumulated.values.push(v);
      }
    }
    // owned: union + dedup
    for (const o of (result.accumulated?.owned || [])) {
      if (typeof o === 'string' && o.length > 0 && !merged.accumulated.owned.includes(o)) {
        merged.accumulated.owned.push(o);
      }
    }
    // top1: first non-null wins (early session 先寫死, 對齊 driver semantics)
    if (!merged.accumulated.top1
        && typeof result.accumulated?.top1 === 'string'
        && result.accumulated.top1.length > 0) {
      merged.accumulated.top1 = result.accumulated.top1;
    }
    // step_evidence: append in day order (各 step bucket 內順序保留)
    for (let n = 1; n <= 7; n++) {
      const key = `step_${n}`;
      for (const e of (result.step_evidence?.[key] || [])) {
        merged.step_evidence[key].push(e);
      }
    }
    // steps_touched: union
    for (const s of (result.accumulated?.steps_touched || [])) {
      if (!merged.accumulated.steps_touched.includes(s)) {
        merged.accumulated.steps_touched.push(s);
      }
    }

    per_session.push({
      session_id: sess.id,
      day: sess.day,
      turns_count: result.turns_count,
      judged_count: result.judged_count,
      values_count: result.accumulated?.values?.length || 0,
      steps_touched: Array.isArray(result.accumulated?.steps_touched)
        ? [...result.accumulated.steps_touched] : [],
      skip_counts: result.skip_counts || {},
      budget_hit: !!result.budget_hit,
      elapsed_ms: result.elapsed_ms,
    });
  }

  // Final defence-in-depth sanitize + cap per step bucket.
  for (let n = 1; n <= 7; n++) {
    merged.step_evidence[`step_${n}`] = sanitizeAndCap(merged.step_evidence[`step_${n}`]);
  }

  // sc_journey_step = max non-empty step (mirrors driver + lib/api/sc-storyboard-backfill.js)
  let sc_journey_step = null;
  for (let n = 7; n >= 1; n--) {
    if (merged.step_evidence[`step_${n}`].length > 0) { sc_journey_step = n; break; }
  }

  return {
    accumulated: merged.accumulated,
    step_evidence: merged.step_evidence,
    sc_journey_step,
    per_session,
    totals,
  };
}
