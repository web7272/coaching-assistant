// lib/session/mode-context.js
// v5.1 Step 4 PR-23s4b — {{current_mode_context}} dynamic placeholder 內容.
// 取代 lib/session/phase-context.js (退役).
//
// 設計: 每個 primary_mode 的 entry context + 目標 + exit hint.
//   chat.js buildDynamicContext 用 modeContextFor(primary_mode, modeState) 取得
//   文字、塞進 dynamic 區 (不 cached、每 turn 重算).
//
// 對應 v5.1 6 modes: elicitation / identity_anchoring / integration / cascade /
//   future_pacing / crisis (peripheral — crisis context 在 Step 6 補完整 SOP).

import { ACTIVE_MODES } from './mode-tracker.js';

// ─── v5.2 第二塊 PR-b — context-anchored phrasing append helpers ───
// Source: v52_context_anchored_spec §3.2 verbatim phrasings (Mode 1/2/4/5 only).
//   Mode 3 + Mode 6 phrasing 不動 (Mode 3 反例機制 internal aware, Mode 6 crisis
//   orthogonal 不提 context).
//
// 設計:
//   - contextName 來自 students.active_context_name (有 name) OR category 短字 fallback
//     (deriveContextNameForPhrasing in active-context.js).
//   - 當 contextName 為 null/空 → 維持 v5.1 phrasing (graceful fallback per §7.3).
//   - 當 contextName 有值 → append context-anchored phrasing 範本 lines 進 base.

const ELICITATION_CONTEXT_ANCHOR = (name) => `
⭐ v5.2 context anchor — 起手式改寫:
   v5.1「在你的生命裡、你想要什麼?」 → v5.2「在「${name}」這塊、你想要什麼?」
   全程鏈式追問 anchor 回「${name}」、不窄化、不替學員 prescribe。`;

const IDENTITY_ANCHORING_CONTEXT_ANCHOR = (name) => `
⭐ v5.2 context anchor — identity test 改寫:
   v5.1「你是一個『[top1_value]』的人嗎?」 → v5.2「在「${name}」裡、你是一個『[top1_value]』的人嗎?」
   學員回應 partial 時深挖 context-specificity (這個說法在「${name}」之外也一致嗎?)。`;

const CASCADE_CONTEXT_ANCHOR = (name) => `
⭐ v5.2 context anchor — cascade Top 2/3 提問:
   「在「${name}」裡、[Top 2 quality] 對你的重要程度?」
   Cascade 順序對齊引擎 2 既有機制、context anchor 不改排序。`;

const FUTURE_PACING_CONTEXT_ANCHOR = (name) => `
⭐ v5.2 context anchor — Future Pacing 邀請:
   「未來在「${name}」裡、你想成為什麼樣的人?」
   Let it Go ritual + 自然 generalize by mirror (不主動 prescribe「${name}」之外 swap)。
   Export Personal Coach Prompt 主場景 = 「${name}」、附 generalization note。`;

/**
 * Get the v5.2 context anchor append text for a primary_mode + context name.
 * Returns null when mode doesn't get context anchor (Mode 3 / Mode 6) OR
 * when name is missing.
 *
 * @param {string} primaryMode
 * @param {string|null} contextName
 * @returns {string|null}
 */
function _contextAnchorFor(primaryMode, contextName) {
  if (typeof contextName !== 'string' || contextName.trim().length === 0) return null;
  const name = contextName.trim();
  switch (primaryMode) {
    case ACTIVE_MODES.ELICITATION:        return ELICITATION_CONTEXT_ANCHOR(name);
    case ACTIVE_MODES.IDENTITY_ANCHORING: return IDENTITY_ANCHORING_CONTEXT_ANCHOR(name);
    case ACTIVE_MODES.CASCADE:            return CASCADE_CONTEXT_ANCHOR(name);
    case ACTIVE_MODES.FUTURE_PACING:      return FUTURE_PACING_CONTEXT_ANCHOR(name);
    // Mode 3 integration + Mode 6 crisis: phrasing 不動 per spec §3.2.
    default:                              return null;
  }
}

// elicitation 變體 — router_phase opening / elicitation aware (legacy fallback;
// 不再 prepend 起手式 because 那是 conditional inject 接管).
const ELICITATION_BASE = `【Elicitation Mode:Values Elicitation】
目標:Damon 鏈式追問挖出 3-5 個 values、用 Containment Judgment 定 Top 1。
exit:top1_value 確定 + Goal Alignment Test 通過 → identity_anchoring mode。`;

const ELICITATION_OPENING = `${ELICITATION_BASE}
起手式「在你的生命裡、你想要什麼?」`;

const ELICITATION_CONTINUE = `${ELICITATION_BASE}
開場已過、用 Damon 鏈式追問「擁有這個對你有什麼重要?」、不重複起手式。`;

const ELICITATION_DEFERRED = `${ELICITATION_BASE}

🛑 本 turn 是「跨日開場」、由 [SYSTEM INJECT — Day Opening Active Reference] 主導開場句。
   **不另起 elicitation 冷起手式**。
   依 [SYSTEM INJECT] 的「模式 A / A-short / A+gap* / B-safe」 生產開場句。`;

const IDENTITY_ANCHORING_BASE = `【Identity Anchoring Mode:身份測試】
目標:對 Top 1 做 Damon 身份測試(confirm + evidence、4 重組合判決)。
exit:current_quality_status 確定 (owned → cascade mode / ambiguous → integration mode)。
AI 主動發起「你是一個『[top1_value]』的人嗎?」`;

const INTEGRATION_BASE = `【Integration Mode:Self-Concept 收編 toolbox】
目標:Mapping Across / 反例整合 / 三向歸類 / Scope Overlap 動態選工具(非 linear sequence)。
exit:top1_value 升級 owned → cascade mode;或接受 ambiguous → owned_via_acceptance → cascade mode。
反例整合佔 40-90% 時間、亞洲學員主動引出反例。`;

const CASCADE_BASE = `【Cascade Mode:Top 2 / Top 3 驗證】
目標:對 Top 2 / Top 3 重新做身份測試 (orthogonal — 可從 identity_anchoring / integration / future_pacing 觸發)。
exit:values_ranking 全處理完 → future_pacing mode。
通過 → 下個;失敗 → 切回 integration mode 整合該 value。`;

const FUTURE_PACING_BASE = `【Future Pacing Mode:Future Pacing + Let it Go + Export】
目標:3 時間維度 Future Pacing → Let it Go 儀式 → Export 個人教練 prompt。
exit:export_prompt_generated_at != null → program 收尾或 Integration Retention。`;

const CRISIS_BASE = `【Crisis Mode:Deep Signal Handoff】
觸發深創傷 / 強烈情緒 / passive death wish 訊號、AI 推進凍結。
本 mode 內 sub-routers (Step 6 補完整 SOP) 主導:承認 + 不分析 + handoff_escalation + 1925.
exit:SI confirm deny + 學員選 (a)/(b)/(c) → resume 前一個 paused primary_mode。`;

const CROSS_DAY_DEFER_BANNER = '🛑 本 turn 是「跨日開場」:先依 [SYSTEM INJECT — Day Opening Active Reference] 溫暖接住昨天的素材(不直引、不評估),再自然帶進今天 mode 的主題。不要冷啟、不要忽略昨天。';

// elicitation: router_phase variants (legacy compat during transition).
const ELICITATION_VARIANTS = Object.freeze({
  opening:               ELICITATION_OPENING,
  elicitation:           ELICITATION_CONTINUE,
  day_opening_inject:    ELICITATION_DEFERRED,
});

export const MODE_CONTEXTS = Object.freeze({
  [ACTIVE_MODES.ELICITATION]:        ELICITATION_VARIANTS,
  [ACTIVE_MODES.IDENTITY_ANCHORING]: IDENTITY_ANCHORING_BASE,
  [ACTIVE_MODES.INTEGRATION]:        INTEGRATION_BASE,
  [ACTIVE_MODES.CASCADE]:            CASCADE_BASE,
  [ACTIVE_MODES.FUTURE_PACING]:      FUTURE_PACING_BASE,
  [ACTIVE_MODES.CRISIS]:             CRISIS_BASE,
});

/**
 * Get the {{current_mode_context}} text for the current primary_mode.
 *
 * Behavior mirrors legacy contextFor():
 *   - elicitation has router_phase-aware variants (opening / elicitation /
 *     day_opening_inject) for transitional dual-write compat.
 *   - Other modes are static strings. dayOpeningInjectActive prepends a banner.
 *   - ⭐ v5.2 第二塊 PR-b: opts.contextName appends context-anchored phrasing
 *     for Mode 1/2/4/5 (Mode 3/6 unchanged per spec §3.2). Graceful fallback
 *     when contextName null/empty.
 *
 * @param {string} primaryMode
 * @param {string} [routerPhase]  - optional legacy variant selector (elicitation only)
 * @param {{ dayOpeningInjectActive?: boolean, contextName?: string|null }} [opts]
 * @returns {string}  — empty string if mode unknown (fail-soft)
 */
export function modeContextFor(primaryMode, routerPhase, opts = {}) {
  const entry = MODE_CONTEXTS[primaryMode];
  const dayOpen = !!(opts && opts.dayOpeningInjectActive);
  const contextName = (opts && typeof opts.contextName === 'string') ? opts.contextName : null;
  const contextAnchor = _contextAnchorFor(primaryMode, contextName);

  let base;
  if (typeof entry === 'string') {
    base = entry;
  } else if (entry && typeof entry === 'object') {
    if (dayOpen
        && primaryMode === ACTIVE_MODES.ELICITATION
        && routerPhase === 'opening'
        && typeof entry.day_opening_inject === 'string') {
      // Day-opening inject path retains its own opener — context anchor still appended.
      return contextAnchor ? entry.day_opening_inject + contextAnchor : entry.day_opening_inject;
    }
    if (routerPhase && typeof entry[routerPhase] === 'string') {
      base = entry[routerPhase];
    } else {
      const firstKey = Object.keys(entry)[0];
      base = firstKey ? entry[firstKey] : '';
    }
  } else {
    return '';
  }

  if (dayOpen && primaryMode !== ACTIVE_MODES.ELICITATION && base) {
    const banner = CROSS_DAY_DEFER_BANNER + '\n' + base;
    return contextAnchor ? banner + contextAnchor : banner;
  }
  return contextAnchor ? base + contextAnchor : base;
}

/** Is this a known mode with context? */
export function hasModeContext(primaryMode) {
  return Object.prototype.hasOwnProperty.call(MODE_CONTEXTS, primaryMode);
}
