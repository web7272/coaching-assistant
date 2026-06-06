// lib/sub-prompts/session-resume/resume-guidance.js
// v5.2 6/6 hotfix (Vivi 拍板) — A011 (Jessie) cross-day session reuse cold-opening fix.
//
// Repro (Patrick ground-truth):
//   A011 Day 1 unfinished (day_complete=FALSE, 15 user_msgs, primary_mode=elicitation).
//   Student returns 1 week later. Frontend sends kickoff trigger
//   (KICKOFF_TRIGGER_CONTENT) → chat.js sets ctx with primary_mode=elicitation →
//   AI uses elicitation 起手式「在你的生命裡、你想要什麼?」 → 學員體驗像「從 Day 1
//   重來」. Actual data is intact (session 24 reused, 15 msgs in context), but
//   the cold-start phrasing destroys continuity.
//
// Fix (Vivi 6/6):
//   When `loadOrCreateSession` returns `wasReuse=true` AND `gap_days >= 1`,
//   chat.js sets `resumeAcrossGap=true` and (on kickoff turn) pushes this
//   guidance inject. AI reads the message history (already in context — no
//   data fetch needed) + this guidance, references the prior thread naturally.
//
// NOT done (per Vivi spec §B):
//   - Auto-finalize abandoned session (Vivi 否決:學員 perception = "少一天").
//   - Override session-end / Day-counter mechanics.

/**
 * Build the resume-across-gap guidance inject.
 *
 * @param {number} gapDays — calendar days since last session_date (≥ 1 to fire)
 * @returns {string}
 */
export function buildResumeGuidanceInject(gapDays) {
  const g = Number(gapDays);
  const days = Number.isFinite(g) && g >= 1 ? Math.floor(g) : 1;
  return `[SESSION RESUME — 接續未完成的對話]

學員上次的對話還沒結束、隔了 ${days} 天回來。
上面的對話歷史是同一場、沒有重來。

你的開場:
- 看上面的對話歷史、reference 學員上次聊到的(用他自己的話)
- 自然接續、像「我們上次聊到 X、今天接著」
- ❌ 不要重新起手式(不要問「在你的生命裡、你想要什麼?」這種從零開始的問句)
- ❌ 不要當新的一天 / 新 program 開始
- 接著上次的 thread 繼續挖`;
}

export default {
  id: 'session_resume_guidance',
  type: 'conditional_inject',
  trigger_event: 'kickoff_turn',
  buildResumeGuidanceInject,
  token_estimate: 180,
  source: 'A011 troubleshoot (Patrick 6/6) + Vivi 6/6 拍板 (接續開場, 不自動結算)',
};
