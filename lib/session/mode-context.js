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
 *
 * @param {string} primaryMode
 * @param {string} [routerPhase]  - optional legacy variant selector (elicitation only)
 * @param {{ dayOpeningInjectActive?: boolean }} [opts]
 * @returns {string}  — empty string if mode unknown (fail-soft)
 */
export function modeContextFor(primaryMode, routerPhase, opts = {}) {
  const entry = MODE_CONTEXTS[primaryMode];
  const dayOpen = !!(opts && opts.dayOpeningInjectActive);

  let base;
  if (typeof entry === 'string') {
    base = entry;
  } else if (entry && typeof entry === 'object') {
    if (dayOpen
        && primaryMode === ACTIVE_MODES.ELICITATION
        && routerPhase === 'opening'
        && typeof entry.day_opening_inject === 'string') {
      return entry.day_opening_inject;
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
    return CROSS_DAY_DEFER_BANNER + '\n' + base;
  }
  return base;
}

/** Is this a known mode with context? */
export function hasModeContext(primaryMode) {
  return Object.prototype.hasOwnProperty.call(MODE_CONTEXTS, primaryMode);
}
