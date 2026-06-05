// lib/sub-prompts/crisis/crisis-session-closure.js
// v5.1 Step 6 PR-6a — Step 8 Session Closure (turn2b §10.3 step 7 verbatim、編號改 8).

/**
 * Step 8.1 學員 explicit 結束 (turn2b §10.3 step 7.1 逐字).
 */
export const STEP_8_1_EXPLICIT_CLOSURE = `我記著你在這裡。
你準備好的時候、回來就行。`;

export const prompt_content = `[SYSTEM INJECT — Crisis SOP Step 8 Session Closure]

═══════════════════════════════════════════════
Step 8.1 — 學員 explicit 結束 session (turn2b §10.3 step 7.1 逐字):
═══════════════════════════════════════════════

> 「${STEP_8_1_EXPLICIT_CLOSURE.split('\n').join('\n>  ')}」

═══════════════════════════════════════════════
Step 8.2 — 不種 takeaway (turn2b §10.3 step 7.2):
═══════════════════════════════════════════════

⚠️ Crisis mode 期間 / 結束時 takeaway disabled (Step 5c errata Patch 3 已 ship):
- 不總結 / 不挑出 quality「帶著走」
- 對 crisis 學員、那會是錯誤的 reinforcement
- engine-4-mode-aware.selectTakeawayPhrasing 已 enforce: crisis_disabled=true → takeaway_term=null

═══════════════════════════════════════════════
Step 8.3 — 設 crisis state carry forward (turn2b §10.3 step 7.3 schema):
═══════════════════════════════════════════════

session_state.crisis_state_carry_forward 寫入 (Step 5c 已建 shell、PR-6b 完整寫入):

\`\`\`
{
  crisis_triggered_at: timestamp,
  crisis_category: 'trauma' | 'worth_fiction' | 'passive_death_wish',
  handoff_choice: 'a' | 'b' | 'c',
  protective_factor_surfaced: str | null,
  si_risk_level: 'denied' | 'passive' | 'active_no_plan' | 'active_with_plan',
  safety_plan: {
    activities: [str, ...],
    safe_location: bool,
    self_harm_denied: bool,
  },
  next_session_focus: 'follow_up_not_explore',

  // ⭐ landing errata §2.2 新欄位 (PR-6b 完整寫入):
  landing_page_reminder_delivered: bool,        // 不 reset (cross-session 累積)
  professional_referral_acknowledged: bool,     // dashboard cohort metric
  professional_referral_refused: bool,          // 觸發 Step 6 變體 C 條件

  // Step 5c 已建欄位:
  resolved_at: null,                            // Safety Planning 完成不得 reset 為 resolved (M73)
  resolution_type: null,                        // 'vivi_handoff' | 'natural_de_escalation' | 'freeze'
  sessions_since_trigger: 0,                    // 3-session 自動 resolve threshold
}
\`\`\`

→ cross-session carry forward (Patrick implementation Step 5c 已 ship state-manager).
→ 下次 session AI 第一句 reference crisis state (V6 day-opening、PR-6b 對齊).

═══════════════════════════════════════════════
不可:
═══════════════════════════════════════════════

❌ 不種 takeaway (Step 8.2)
❌ 不在 Safety Planning 後 reset resolved (Step 7.4 + landing errata §1.3 + M73)
❌ 不假設 closure = resolved (3-session 自動 resolve only)
❌ 不在 carry_forward 寫 quality_focus / anchor (那是非 crisis closure 的 takeaway 行為)`;

/**
 * Vivi-final snapshot exports (turn2b verbatim).
 */
export const _vivi_terminal_segments = Object.freeze({
  STEP_8_1_EXPLICIT_CLOSURE,
});

export default {
  id: 'crisis_step_8_session_closure',
  type: 'conditional_inject',
  prompt_content,
  token_estimate: 540,
  _vivi_terminal_segments,
};
