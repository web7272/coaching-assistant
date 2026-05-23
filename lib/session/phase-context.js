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
 * @param {string} currentPhase
 * @param {string} [routerPhase] - optional router_phase; selects variant for
 *                                  multi-variant phases (e.g. phase_1)
 * @returns {string} — empty string if phase unknown (fail-soft)
 */
export function contextFor(currentPhase, routerPhase) {
  const entry = PHASE_CONTEXTS[currentPhase];
  if (typeof entry === 'string') return entry;
  if (entry && typeof entry === 'object') {
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
