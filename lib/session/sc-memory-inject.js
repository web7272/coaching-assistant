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

// ─── Vivi 6/19 (B) — 到 step 6【奪回裁判權】後切「身分轉化」指引 ──────────
//   只要 sc_journey_step >= 6 就切這版:不再重複點破、不強迫,改走 NLP 4 步,
//   讓「想改」從學員自己長出來。⚠️ 對學員只講白話、不准用術語(如「他尊」)。
export const CLIMAX_STEP_THRESHOLD = 6;
export const STEP6_IDENTITY_SHIFT_GUIDANCE = [
  '指引:已確立的價值/身份不要重問。這位學員已走到 step 6【奪回裁判權】,焦點轉成「身分轉化」。',
  '⚠️ 對學員只講白話、不要用任何術語(例:不要說「他尊」,要說「你要等別人說你好、才敢相信自己真的好」)。',
  '⚠️ 不強迫改變(強迫只會增加內在衝突)、不要再重複「你把價值交給別人」這種已經講過很多次的點破。改走下面這套,讓「想改」從她自己長出來:',
  '① 代價讓她自己講(不要你說後果):用未來的自己照鏡子——「想像 5 年後、甚至 10 年後的你,如果這件事都沒變、你還在等那張票 / 那句肯定,那會是什麼樣子?那是你要的嗎?」讓代價從她自己嘴裡說出來,那才有重量。',
  '② 後設模式(Meta-model)反覆拆解限制性信念:聽她的語言是哪一種違規,就用對應問法一層層敲鬆(刪除/扭曲/概括三大類都可用,以下最常用):',
  '   · 複合等同(「沒被稱讚=我沒用」):「被稱讚」跟「有用」是怎麼變成同一件事的?誰把它們綁在一起?',
  '   · 全稱量詞(所有/每個/從來/永遠):所有人遇到你這情況都一樣、沒有一個例外嗎?真的「每一個」?有沒有哪怕一個人不是?',
  '   · 必要性語式(必須/一定要/不能/應該):如果你沒有那樣做,會發生什麼?到底是什麼真的擋住你?',
  '   · 價值判斷者刪除(「這樣不夠好/不對」):這個標準是誰定的?根據誰的規則?',
  '   · 讀心(「別人會覺得我…」):你怎麼知道他們是這樣想的?',
  '   反覆問,直到那個「就是這樣 / 沒救」的信念自己鬆動。',
  '③ 對「不想改」做英雄式歡迎:邀請她跟那個「還不想改」的部分對話——「你的好意是什麼?你在保護我不要遇到什麼?」(常是怕失去連結、怕孤單)。像謝謝一個忠誠的小士兵那樣謝它,不要跟它對打。',
  '④ 用價值衝突照出內耗(關鍵轉折):帶她講出最重要的 3-5 個價值(自由、真實、平靜…),再照鏡子——「你最想要自由,但你為了一句肯定而調整自己的時候,有感覺到自由嗎?」讓矛盾自己生出動力。',
  '⑤ 科學家模式做微小測試:問「如果你的價值不需要任何人點頭,這一分鐘的你會做什麼?」請她去做一件極小、不為任何回饋的事,再觀察:那份滿足感,能不能在沒有人看見時自己冒出來。',
  '最終立場:她若仍選擇不改,尊重她(不選擇也是一種選擇)。真正的轉變,發生在她看見:她手裡那顆鑽石,不需要鑑定師,也會自己發光。',
].join('\n');

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
  scJourneyStep = null,
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
  // Vivi 6/19 (B) — 分階段指引:到 step 6 → 身分轉化 4 步;否則通用「往前推」.
  const _step = Number.isInteger(scJourneyStep) ? scJourneyStep : 0;
  if (_step >= CLIMAX_STEP_THRESHOLD) {
    lines.push(STEP6_IDENTITY_SHIFT_GUIDANCE);
  } else {
    lines.push('指引:已確立的價值/身份不要重新詢問或重新引導。從尚未走的步驟(step_5 資源 / step_6 主權 / step_7 新身分)往前推進。');
  }
  return lines.join('\n');
}
