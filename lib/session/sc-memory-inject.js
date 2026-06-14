// lib/session/sc-memory-inject.js
// v5.3 Stage C (6/13) — 記憶餵回 inject (Patrick 6/13).
//
// 問題:
//   Day8 / A009 鬼打牆 — Sonnet 重複問「這位學員已經確認過的值/身份」.
//   observer (Stage B) 把 values_collected_list / top1_value / sc_journey_evidence
//   (owned 身份 = step_4 identity_claim) 累進 students / UPE 了, 但對話沒餵回 →
//   Sonnet 看不到「已知」 → 重問.
//
// 修法 (Patrick spec, 比照 buildActiveContextSummaryInject):
//   開場 (其實是每 turn) 動態注入一段「已確認名單 + 指引」進 dynamic block
//   (NOT cached prefix), 讓 Sonnet 知道「別重問, 從未走的步驟往下推」.
//
// 設計鎖:
//   · 0 facing 條件: flag off → 完全不 inject (回到原行為, Day1/新人無副作用).
//   · 0 facing 條件: crisis primary_mode → 不 inject (專注安全, 不拉回身份工作).
//   · 0 facing 條件: 空狀態 (values + owned + top1 全空) → 不 inject.
//   · 只放 canonical 詞 (values / owned 是品質詞/身份詞,不是 raw 對話).
//     再過一次 SC_STORYBOARD_HIGH_RISK_PATTERNS denylist (defence-in-depth) +
//     長度上限 (品質詞通常 ≤ 12 字; 過長 → skip, 防 raw 滲入).
//   · 進 dynamic block, NOT cached → 不汙染 cache breakpoint (per-student
//     內容, 跟 buildActiveContextBlock / buildActiveContextSummaryInject 同樣
//     positioning).
//
// 文案 (caller 註明: Vivi 6/13 待過稿):
//   下面 INJECT_TEMPLATE 是草稿. Vivi 過完文案就 verbatim 換掉. 邏輯不動.

import { SC_STORYBOARD_HIGH_RISK_PATTERNS } from '../api/sc-storyboard-gen.js';

// ─── tunables ────────────────────────────────────────────
export const MAX_VALUES_IN_INJECT  = 5;
export const MAX_OWNED_IN_INJECT   = 4;
export const MAX_CHARS_PER_TERM    = 24;   // 品質詞/身份詞通常 ≤ 12; 24 寬鬆上限

// ─── defence-in-depth: denylist ──────────────────────────
function _isHighRiskText(text) {
  if (typeof text !== 'string') return false;
  return SC_STORYBOARD_HIGH_RISK_PATTERNS.some(p => p.test(text));
}

// ─── safe term filter — 共用給 values / owned / top1 ─────────
function isSafeTerm(s) {
  if (typeof s !== 'string') return false;
  const t = s.trim();
  if (t.length === 0) return false;
  if (t.length > MAX_CHARS_PER_TERM) return false;   // 過長 → 視為 raw 滲入, 丟
  if (_isHighRiskText(t)) return false;
  return true;
}

// ────────────────────────────────────────────────────────────────
// 從 sc_journey_evidence 抽 owned identities (step_4 identity_claim).
//
//   step_4 = identity_claim — 學員已認領的「我是 X 的人」.
//   observer postScrub 已 drop 高危; helper 再過 isSafeTerm 一次.
//   多 entries 同 quote → 去重 (insertion order).
//
// @param {object|null} scJourneyEvidence — students.sc_journey_evidence
// @returns {string[]}
// ────────────────────────────────────────────────────────────────
export function extractOwnedIdentities(scJourneyEvidence) {
  if (!scJourneyEvidence || typeof scJourneyEvidence !== 'object') return [];
  const step4 = Array.isArray(scJourneyEvidence.step_4) ? scJourneyEvidence.step_4 : [];
  const out = [];
  for (const e of step4) {
    if (!e || typeof e !== 'object') continue;
    if (e.type !== 'identity_claim') continue;
    const q = typeof e.quote === 'string' ? e.quote.trim() : null;
    if (!q || !isSafeTerm(q)) continue;
    if (!out.includes(q)) out.push(q);
  }
  return out;
}

// ────────────────────────────────────────────────────────────────
// buildScMemoryInject — main entry. Returns inject string OR null (caller skips).
//
// @param {object} args
// @param {string[]} [args.valuesCollected] — userProfile.values_collected_list
// @param {string|null} [args.top1] — userProfile.top1_value / sessionState.top1_value
// @param {object|null} [args.scJourneyEvidence] — students.sc_journey_evidence (jsonb)
// @param {string} [args.primaryMode] — 'crisis' → no inject
// @param {boolean} [args.flagEnabled] — SC_MEMORY_INJECT_ENABLED === 'true'
// @returns {string|null}
// ────────────────────────────────────────────────────────────────
export function buildScMemoryInject({
  valuesCollected,
  top1,
  scJourneyEvidence,
  primaryMode,
  flagEnabled = false,
} = {}) {
  // ─── 0-facing 三道閘 ───
  if (!flagEnabled) return null;                          // flag off → 不 inject
  if (primaryMode === 'crisis') return null;              // 危機 → 安全優先
  // (空狀態檢查在 sanitize 後做, 防 unsafe 詞被當有效)

  // sanitize values
  const safeValues = Array.isArray(valuesCollected)
    ? Array.from(new Set(
        valuesCollected.filter(isSafeTerm).map(v => v.trim())
      )).slice(0, MAX_VALUES_IN_INJECT)
    : [];

  // sanitize owned (from sc_journey_evidence step_4)
  const safeOwned = extractOwnedIdentities(scJourneyEvidence).slice(0, MAX_OWNED_IN_INJECT);

  // sanitize top1
  const safeTop1 = isSafeTerm(top1) ? top1.trim() : null;

  // 全空 → 不 inject (Day1 / 新人 0 副作用)
  if (safeValues.length === 0 && safeOwned.length === 0 && !safeTop1) return null;

  // ─── 文案 (Patrick 6/13 草稿, Vivi 待過稿 — 文案改這裡, 邏輯不動) ───
  const lines = ['〔這位學員已經確認過的東西（別重問,從未走的下一步開始)〕'];
  if (safeValues.length > 0) {
    lines.push(`・核心價值:${safeValues.join('、')}`);
  }
  if (safeTop1) {
    lines.push(`・最核心價值:${safeTop1}`);
  }
  if (safeOwned.length > 0) {
    lines.push(`・已認領身份:${safeOwned.join('、')}`);
  }
  lines.push('指引:已確立的價值/身份不要重新詢問或重新引導。從尚未走的步驟(step_5 資源 / step_6 主權 / step_7 新身分)往前推進。');
  return lines.join('\n');
}
