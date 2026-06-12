// lib/api/sc-storyboard-backfill.js
// v5.3 件3 backfill (6/12) — pure derivation: 從既有訊號 (reframe history /
// surfaced values+examples / daily takeaways) 推回 sc_journey_evidence
// + sc_journey_step. 給 scripts/backfill-storyboard.js 用.
//
// ⚠️ 範圍: 純函式. 不碰 DB / LLM / network. Patrick 先驗這個的映射 +
//   denylist + 計算邏輯, 才會去動 script.
//
// 對齊 live (api/chat.js) 的 reframe → step → type 映射:
//   R2          → step 4 identity_claim
//   R1 / R1_E   → step 6 sovereignty_reclaim
//   R3          → step 3 data_mining
//   R7          → step 7 anchoring
//   R5/R6/R12   → step 5 resource_retrieval
//   (R12 = Hero's Welcome inject, 對齊 chat.js heroFired branch.)
//
// Quote precedence (per Patrick):
//   1. reframe entry 自帶的 anchor_phrase_if_success (該 reframe 成功時的錨句)
//   2. 同 day 的 surfaced_examples.example (active_context_session_summary[cat])
//   3. 同 day 的 daily_takeaways.term (user_profile_evolution)
//   4. null (只記 type, 不放 quote)
// 任何 quote 過 SC_STORYBOARD_HIGH_RISK_PATTERNS (defence-in-depth):
//   命中 → quote dropped to null, type entry 保留 (不丟整筆).
//
// step_1 pain_surface 刻意留空 (對齊 live 行為 + Patrick: 痛句絕不顯示).
// step_2 longing_surface: surfaced_values 主、早期 (day ≤ 3) daily_takeaways 次.

import { SC_STORYBOARD_HIGH_RISK_PATTERNS } from './sc-storyboard-gen.js';

// ────────────────────────────────────────────────────────────────
// Mapping table (對齊 api/chat.js L518-583 evidence-append entries).
// 對外 frozen 以利測試直接斷言.
// ────────────────────────────────────────────────────────────────
export const REFRAME_STEP_MAP = Object.freeze({
  R2:   { step: 4, type: 'identity_claim' },
  R1:   { step: 6, type: 'sovereignty_reclaim' },
  R1_E: { step: 6, type: 'sovereignty_reclaim' }, // R1_VARIANTS per Patrick
  R3:   { step: 3, type: 'data_mining' },
  R7:   { step: 7, type: 'anchoring' },
  R5:   { step: 5, type: 'resource_retrieval' },
  R6:   { step: 5, type: 'resource_retrieval' },
  R12:  { step: 5, type: 'resource_retrieval' }, // Hero's Welcome inject
});

// Max entries kept per step (latest wins). 防止 evidence 過長, 也對齊 J2/J3
// 只需要看少量代表性 quotes.
export const PER_STEP_EVIDENCE_CAP = 5;

// Internal — mirror sc-storyboard-gen.js `_isHighRiskText` (defence-in-depth,
// 不信任傳遞性: 即使 quote 來自 anchor / surfaced / takeaway 也再過一次).
function _isHighRiskText(text) {
  if (typeof text !== 'string') return false;
  return SC_STORYBOARD_HIGH_RISK_PATTERNS.some(p => p.test(text));
}

// ────────────────────────────────────────────────────────────────
// Pure: pick the quote for a reframe entry per Patrick's precedence.
//   1. anchor_phrase_if_success → trim → return
//   2. same-day surfaced_examples.example → trim → return
//   3. same-day daily_takeaways.term → trim → return
//   4. null
// ────────────────────────────────────────────────────────────────
export function pickQuoteForReframe(entry, surfacedExamples = [], dailyTakeaways = []) {
  if (!entry || typeof entry !== 'object') return null;
  const anchor = entry.anchor_phrase_if_success;
  if (typeof anchor === 'string' && anchor.trim().length > 0) {
    return anchor.trim();
  }
  const day = Number.isInteger(entry.day) ? entry.day : null;
  if (day === null) return null;
  const ex = surfacedExamples.find(e =>
    e && e.day === day && typeof e.example === 'string' && e.example.trim().length > 0);
  if (ex) return ex.example.trim();
  const tk = dailyTakeaways.find(t =>
    t && t.day === day && typeof t.term === 'string' && t.term.trim().length > 0);
  if (tk) return tk.term.trim();
  return null;
}

// ────────────────────────────────────────────────────────────────
// Pure: sanitize a list of {type, quote} entries.
//   - drop entries without a valid type.
//   - quote 命中 denylist → null (保留 type entry, 不丟整筆).
//   - cap to last PER_STEP_EVIDENCE_CAP (latest moves win).
// ────────────────────────────────────────────────────────────────
function sanitizeAndCap(entries) {
  const out = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const type = typeof e.type === 'string' ? e.type : null;
    if (!type) continue;
    let quote = (typeof e.quote === 'string' && e.quote.trim().length > 0)
      ? e.quote.trim() : null;
    if (quote && _isHighRiskText(quote)) {
      quote = null;
    }
    out.push({ type, quote });
  }
  return out.slice(-PER_STEP_EVIDENCE_CAP);
}

// ────────────────────────────────────────────────────────────────
// Pure: derive sc_journey_evidence + sc_journey_step from existing signals.
//
// signals: {
//   reframeHistory:   [{ reframe_id, day, anchor_phrase_if_success, ... }],
//   surfacedValues:   string[],          // cross-session quality terms
//   surfacedExamples: [{ day, value, example }],
//   dailyTakeaways:   [{ day, term }],
// }
//
// returns: { evidence: {step_1..step_7:[]}, step: number|null }
// ────────────────────────────────────────────────────────────────
export function deriveScJourneyFromHistory(signals = {}) {
  // Defensive: null/non-object also acceptable (caller may pass missing data).
  const s = (signals && typeof signals === 'object') ? signals : {};
  const reframeHistory    = Array.isArray(s.reframeHistory)    ? s.reframeHistory    : [];
  const surfacedValues    = Array.isArray(s.surfacedValues)    ? s.surfacedValues    : [];
  const surfacedExamples  = Array.isArray(s.surfacedExamples)  ? s.surfacedExamples  : [];
  const dailyTakeaways    = Array.isArray(s.dailyTakeaways)    ? s.dailyTakeaways    : [];

  const evidence = {
    step_1: [], step_2: [], step_3: [], step_4: [],
    step_5: [], step_6: [], step_7: [],
  };

  // step_1 pain_surface: INTENTIONAL gap. 對齊 live chat.js (L584 comment).
  //   痛句絕不逐字顯示給學員; brain_state.description (LLM-safe) 承接.

  // step_2 longing_surface — surfaced_values 主.
  const longing = [];
  for (const v of surfacedValues) {
    if (typeof v === 'string' && v.trim().length > 0) {
      longing.push({ type: 'longing_surface', quote: v.trim() });
    }
  }
  // 退一步: surfaced_values 全空 → 取 day ≤ 3 的 daily_takeaways.term
  // (早期 takeaways 接近 longing/quality 的 articulation).
  if (longing.length === 0) {
    for (const t of dailyTakeaways) {
      if (t && Number.isInteger(t.day) && t.day <= 3
          && typeof t.term === 'string' && t.term.trim().length > 0) {
        longing.push({ type: 'longing_surface', quote: t.term.trim() });
      }
    }
  }
  evidence.step_2 = sanitizeAndCap(longing);

  // step_3..7 — from reframe history.
  for (const entry of reframeHistory) {
    if (!entry || typeof entry !== 'object') continue;
    const mapped = REFRAME_STEP_MAP[entry.reframe_id];
    if (!mapped) continue;
    const quote = pickQuoteForReframe(entry, surfacedExamples, dailyTakeaways);
    evidence[`step_${mapped.step}`].push({ type: mapped.type, quote });
  }
  // sanitize + cap on the populated buckets.
  for (let n = 3; n <= 7; n++) {
    evidence[`step_${n}`] = sanitizeAndCap(evidence[`step_${n}`]);
  }

  // sc_journey_step = max{N: evidence[step_N] non-empty}, else null.
  let step = null;
  for (let n = 7; n >= 1; n--) {
    if (evidence[`step_${n}`].length > 0) { step = n; break; }
  }

  return { evidence, step };
}
