// lib/session/phase-context.js
// {{current_phase_context}} dynamic placeholder 內容 — 純函數模組
//
// 每個 current_phase 的 entry context + 目標 + exit condition hint。
// chat.js v5.0 buildSystemPromptArray 用 contextFor(current_phase, router_phase)
// 取得文字、塞進 dynamic 區（不 cached、每 turn 重算）。
//
// 對齊：CP1 turn 1 §2.1 Framework C day range + milestone
// spec 04 §4：{{current_phase_context}} ~100 tokens
//
// ⭐ PR-4c-1b（開場重複 bug 修）：phase_1 → router_phase-aware 兩變體。
//   opening 變體含起手式、elicitation 變體用 Damon 鏈式追問且不重複起手式。
//   chat.js 在 phase_1 turn 1 結束後 auto-transition router_phase opening→elicitation。

export const PHASE_CONTEXTS = Object.freeze({
  // Phase 1 — router_phase-aware (opening vs elicitation)
  phase_1: Object.freeze({
    // Turn 1（router_phase='opening'）：AI 用起手式開場
    opening: `【Phase 1：Values Elicitation — 開場】
目標：Damon 鏈式追問挖出 3-5 個 values、用 Containment Judgment 定 Top 1。
day range：min 1 / max 4 session days。
exit：top1_value 確定 + Goal Alignment Test 通過 → Phase 2。
起手式「在你的生命裡、你想要什麼?」`,
    // Turn 2+（router_phase='elicitation'）：已開場、改 Damon 鏈式追問
    // ⚠️ 此變體絕不含「為什麼」字串（紅線 1 由 cached prefix Damon Core 統一治理、
    //    phase context 不重述、避免任何「為...麼」殘字落到 prompt）。
    elicitation: `【Phase 1：Values Elicitation — 鏈式追問】
目標：Damon 鏈式追問挖出 3-5 個 values、用 Containment Judgment 定 Top 1。
day range：min 1 / max 4 session days。
exit：top1_value 確定 + Goal Alignment Test 通過 → Phase 2。
開場已過、用 Damon 鏈式追問「擁有這個對你有什麼重要?」、不重複起手式。`,
    // PR-4c-green E4 fix — Day N+1 with E4 day-opening inject active.
    // The cold 起手式 must be suppressed (otherwise the AI is given two
    // contradictory opening instructions and falls back to the most concrete one,
    // which is the cold 起手式 → A001 Day 2 災難). This variant defers ALL opening
    // content to the [SYSTEM INJECT — Day Opening Active Reference] block
    // appended in conditionalInjects.
    // 5/24 rewrite (Patrick 真機驗 A002): inject 規則名稱換 V1-V5 → A / A-short /
    // B-safe / A+gap*; suppression 語氣加強到「紅線」等級. 「你想要什麼」 在跨日
    // turn 是 v4 鬼打牆還魂、明寫禁止。
    day_opening_inject: `【Phase 1：Values Elicitation — 跨日開場（由 E4 主導、紅線）】
目標：Damon 鏈式追問挖出 3-5 個 values、用 Containment Judgment 定 Top 1。
day range：min 1 / max 4 session days。
exit：top1_value 確定 + Goal Alignment Test 通過 → Phase 2。

🛑 本 turn 是「跨日開場」、由 [SYSTEM INJECT — Day Opening Active Reference]
   主導開場句。**不另起 phase_1 起手式**。
🛑 **絕對禁止** 在跨日 turn 用 phase_1 冷起手式（那種「想要什麼」 開放抽象大問題）
   ← 在跨日 turn 出現 = 紅線、= v4 鬼打牆還魂、= 跨日連續性破功。
   看上面【本場學員狀態】的「昨天的素材」區塊（有 takeaway 或「無真實素材」說明）
   → 一律依 [SYSTEM INJECT] 的「模式 A / A-short / A+gap* / B-safe」 生產開場句。
🛑 有素材時必須溫暖地接住昨天那句的「意思」（不直引、不機械、不評估）；
   無素材時走 [SYSTEM INJECT] 的「模式 B 安全暖開場」、**永遠不杜撰**
   「你昨天說…」 開頭。`,
  }),

  phase_2: `【Phase 2：身份測試】
目標：對 Top 1 做 Damon 身份測試（confirm + evidence、4 重組合判決）。
day range：min 1 / max 2 session days。
exit：current_quality_status 確定（owned → Phase 3a / ambiguous → Phase 3b）。
AI 主動發起「你是一個『[top1_value]』的人嗎?」`,

  phase_3a: `【Phase 3a：Owned Path（4 步驟改變法）】
目標：Build Vision（生活場景化）→ Check Resistance → Let it Work。
day range：min 2 / max 4 session days。
exit：4 步驟改變法完成、takeaway 種下 → Phase 4。
Scope Overlap default：問生活場景（跟誰見面 / 做哪幾件事 / 選哪個方向）、不主動問身體。`,

  phase_3b: `【Phase 3b：Ambiguous Path（Self-Concept 模型）】
目標：Mapping Across（生活場景）→ 反例整合 → 三向歸類 → Scope Overlap。
day range：min 3 / max 8 session days（v5.0 最長 phase）。
exit：top1_value 升級 owned → Phase 3a Simplified；或接受 ambiguous → Phase 4。
反例整合佔 40-90% 時間、亞洲學員主動引出反例。`,

  phase_4: `【Phase 4：Cascade Down 驗證】
目標：對 Top 2 / Top 3 重新做身份測試。
day range：min 2 / max 4 session days。
exit：values_ranking 全處理完 → Phase 5。
通過 → 下個；失敗 → mini Self-Concept。`,

  phase_5: `【Phase 5：Future Pacing + Let it Go + Export】
目標：3 時間維度 Future Pacing → Let it Go 儀式 → Export 個人教練 prompt。
day range：min 2 / max 3 session days。
exit：export_prompt_generated_at != null → Integration Retention 或 program_completed。`,

  integration_retention: `【Integration Retention Mode（Day 8-21）】
目標：reinforce 不 explore。Light touch follow-up、Future Pacing 強化。
turn budget：5-10 turn/day soft limit。
不挖新 quality、不深化新技術。Day 21 final wrap-up + export 二次更新。`,

  program_completed: `【Program Completed】
21 天 program 已結束。學員拿到 export 個人教練 prompt。
不再推進 phase。`,
});

/**
 * Get the {{current_phase_context}} text for a phase.
 *
 * Phase entries may be a string (static、所有 router_phase 共用) OR an object
 * keyed by router_phase. For the object form, the requested router_phase is
 * looked up; if not present, falls back to the first defined variant (safe
 * default — never throws / never returns undefined).
 *
 * PR-4c-green E4 fix — opts.dayOpeningInjectActive: when truthy AND we'd
 * normally return the phase_1.opening cold 起手式, swap to phase_1.day_opening_inject
 * (the "defer to E4 inject" variant). This is the gate that stops the cold
 * 起手式 from competing with the E4 [SYSTEM INJECT] on Day N+1 with takeaway.
 *
 * @param {string} currentPhase
 * @param {string} [routerPhase] - optional router_phase; selects variant for
 *                                  multi-variant phases (e.g. phase_1)
 * @param {{ dayOpeningInjectActive?: boolean }} [opts]
 * @returns {string} — empty string if phase unknown (fail-soft)
 */
export function contextFor(currentPhase, routerPhase, opts = {}) {
  const entry = PHASE_CONTEXTS[currentPhase];
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
    // E4 day-opening swap: phase_1 + opening + inject active → defer to inject.
    if (opts && opts.dayOpeningInjectActive
        && currentPhase === 'phase_1'
        && routerPhase === 'opening'
        && typeof entry.day_opening_inject === 'string') {
      return entry.day_opening_inject;
    }
    if (routerPhase && typeof entry[routerPhase] === 'string') return entry[routerPhase];
    // safe fallback: first variant defined（callers without router_phase 也有非空回值）
    const firstKey = Object.keys(entry)[0];
    return firstKey ? entry[firstKey] : '';
  }
  return '';
}

/**
 * Is this a known phase with context?
 */
export function hasContext(currentPhase) {
  return Object.prototype.hasOwnProperty.call(PHASE_CONTEXTS, currentPhase);
}
