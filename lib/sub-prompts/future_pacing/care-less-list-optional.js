// lib/sub-prompts/future_pacing/care-less-list-optional.js
// v5.1 Step 7 PR-7b — Care Less List Optional Exercise (Vivi 終審版逐字).
//
// Source: v51_errata_v03_damon_supplementary_tier3.md §6 Patch 6.2 Vivi 終審版.
// Positioning: Mode 5 future_pacing step 4 optional exercise — invitation、不強制.
//
// ⚠️ phrasing 規則 (Vivi 指定 guard #2):
//   整段 phrasing = Vivi 終審版逐字、設計師端不改、不留動態生成 space.
//   snapshot test 鎖住每段 (見 care-less-list-optional.test.js).
//   模板填空僅: Top 1 quality + 學員自己列的清單項.
//
// 設計原則 (進 code comment、整段不可改):
//   1. 不用「少 care / 放下 / 不要在乎」
//   2. 用 expansion framing (把自己加進名單)、不用 contraction framing
//   3. 體貼善良是 quality、明確強化、不挑戰
//   4. 「不是失去、是還給自己」+「對自己好、也是善良」雙 anchor
//   5. 順序不能反: 先 validate 善良、再加入自己
//   6. 學員 surface「就是你自己」反應後、AI 給沉默、不繼續說
//   7. 整段 phrasing = ⚠️ Vivi 終審版、設計師端不改

// ─── Vivi 終審版逐字 — 4 段 phrasing snapshot ─────────────

/**
 * Segment 1 — AI 邀請開場 (⚠️ Vivi 終審版、不改、不動態生成).
 *
 * 唯一變數: TOP_1_QUALITY (學員 Top 1).
 */
export const SEGMENT_1_INVITATION = `我們做一個小小的整理、想做再做、不想做也完全沒關係。

你剛剛說、你想成為一個 {{TOP_1_QUALITY}} 的人。

那……有沒有什麼事、是你一直很用力在顧、很用力在意——
可是對現在的你來說、其實已經可以放鬆一點點、不用抓那麼緊了?`;

/**
 * Segment 2 — AI 引導 critical 紅線 (⚠️ Vivi 終審版).
 * 設計師端禁區規則 — embedded 為 inject guidance (告訴 Sonnet 怎麼引導、不寫死話術).
 */
export const SEGMENT_2_GUIDANCE_RAILS = `引導 critical 紅線 (Vivi 終審版規則、Sonnet 必須遵守):

❌ 不能用「少 care」這三個字當開場 (亞洲女性聽到會內疚).
✅ 用「不用抓那麼緊」「可以放鬆一點」「把力氣留一些給自己」這種說法 —
   門檻低很多、不會踩到「妳變冷漠了」恐懼.

學員 surface 例子 (參考、Sonnet 不複誦):
  - 「我一直很在意別人怎麼看我——這個其實可以鬆一點」
  - 「我一直要做到 100% 才安心——這個可以放下一點」
  - 「我一直用別人的標準在衡量自己——這個可以慢慢放掉」`;

/**
 * Segment 2b — 學員講不出來、Sonnet 用此輕引 (⚠️ Vivi 終審版).
 */
export const SEGMENT_2B_SOFT_PROMPT = `比如說、別人的眼光、別人的標準、要做到完美……
這裡面有沒有哪一個、你其實有點累了?

📌 等她自己說出那個詞、不要替她選`;

/**
 * Segment 3 — AI 確認第一段 (⚠️ Vivi 終審版、設計師端不改).
 * 變數: STUDENT_LISTED_ITEMS (學員 surface 的清單項).
 */
export const SEGMENT_3_CONFIRM = `好。那你想慢慢放鬆一點的、是 {{STUDENT_LISTED_ITEMS}}。

我想跟你說清楚一件事——
這不是叫你變得不在乎、更不是叫你變得冷漠。

你還是那個會在乎、會顧人的你。
我們只是把你一直往外借出去的那些力氣、慢慢收回來一點點、
留給你想成為的那個人。

少抓那一點點、不是失去什麼。
是還給自己。`;

/**
 * Segment 4 — AI 確認收尾延伸 (⚠️ Vivi 終審版、設計師端不改、整段是落點).
 *
 * critical: 教練說完這段、給沉默、等她自己反應. 不繼續分析 / 不繼續提問.
 */
export const SEGMENT_4_CLOSING_EXTENSION = `還有一件事、我想特別跟你說。

你的體貼、你的善良——
這些不是要你放掉的東西。
它們是你最珍貴的優點、不是缺點。
這個世界需要更多像你這樣會在乎別人的人。

我們從頭到尾、沒有要你變得不體貼。

我們只是發現——
你一直在照顧一份名單、
名單上有家人、有同事、有朋友、
每一個你都顧到了。

只有一個人、你一直忘了寫上去。

就是你自己。

所以今天我們不是要你少體貼、是要你做一件事:
把你自己、也加進你那份體貼善良的名單裡。

你對別人那麼好——
從今天起、那個『別人』、也包含你。`;

// ─── Prompt sub-section ──────────────────────────────────

export const prompt_content = `[SYSTEM INJECT — Care Less List Optional Exercise (Vivi 終審版逐字、Mode 5 step 4)]

mode: future_pacing.
trigger:
  ✅ Mode 5 future_pacing step 3 完成
  ✅ 學員 surface「我想成為 ___(Top 1)的人」之後
  ✅ optional invitation — 學員不想做、跳過、不勉強、不解釋太多

⚠️ phrasing 全段 Vivi 終審版逐字、設計師端不改、不留動態生成 space.
  模板填空僅: Top 1 quality + 學員自己列的清單項.

═══════════════════════════════════════════════
Segment 1 — AI 邀請開場 (Vivi 終審版)
═══════════════════════════════════════════════

${SEGMENT_1_INVITATION}

═══════════════════════════════════════════════
Segment 2 — 引導 critical 紅線 (Sonnet 必讀規則)
═══════════════════════════════════════════════

${SEGMENT_2_GUIDANCE_RAILS}

═══════════════════════════════════════════════
Segment 2b — 學員講不出來時的輕引 (Vivi 終審版)
═══════════════════════════════════════════════

${SEGMENT_2B_SOFT_PROMPT}

═══════════════════════════════════════════════
Segment 3 — AI 確認 (第一段、Vivi 終審版)
═══════════════════════════════════════════════

${SEGMENT_3_CONFIRM}

═══════════════════════════════════════════════
Segment 4 — AI 確認收尾延伸 (Vivi 終審版、整段是落點)
═══════════════════════════════════════════════

${SEGMENT_4_CLOSING_EXTENSION}

═══════════════════════════════════════════════
收尾 critical
═══════════════════════════════════════════════

- 教練說完 Segment 4、給沉默、等她自己反應.
- 很多學員會在「就是你自己」這句之後掉眼淚.
- 不要繼續分析 / 不要繼續提問.
- 對齊 Damon「Slip into Unconscious」精神.

═══════════════════════════════════════════════
state 寫入
═══════════════════════════════════════════════

- care_less_list: array of 學員 surface 的清單項
- self_added_to_list: bool — true 當學員 surface 看見「自己也要加進名單」型 statement
- cross-session memory carry forward: Day 21 export 進 Personal Coach Prompt (TODO Step 8 dashboard).

═══════════════════════════════════════════════
拒絕 / 跳過分支
═══════════════════════════════════════════════

學員拒絕「我不想做」/「跳過」/「現在不想」:
  → AI 給簡短 acknowledge、不解釋太多.
  → 進 step 5 (R7_C Let It Go Ritual 收尾).
  → care_less_list state 不寫.`;

export default {
  id: 'future_pacing_care_less_list_optional',
  type: 'conditional_inject',
  trigger_event: 'user_turn',
  priority: null,
  pipeline_role: 'standalone',
  pipeline_parent: null,
  prompt_content,
  token_estimate: 620,   // Vivi 終審版 4 段逐字 + guidance rails
  trigger_conditions: [
    'future_pacing mode active',
    'Mode 5 step 3 完成',
    '學員 surface 想成為的 Top 1 quality',
    'optional — 學員拒絕跳過',
  ],
  disable_conditions: [
    'crisis mode active',
    'student rejection (我不想做 / 跳過 / 現在不想)',
  ],
  parse_state_patch: {
    description: 'Capture care_less_list + self_added_to_list flag',
    affects: [
      'session_state.care_less_list',
      'session_state.self_added_to_list',
      'user_profile_evolution.last_session_day_summary.care_less_list (cross-session)',
    ],
  },
  damon_source: [
    'errata v0.3 Patch 6.2 Vivi 終審版逐字',
    '對齊 Damon「Slip into Unconscious」收尾精神',
    'expansion framing (亞洲女性 cohort 在地化、不用 contraction「少 care」)',
  ],
  // Snapshot-locked segments (test asserts exact strings — 設計師端不改).
  _vivi_terminal_segments: Object.freeze({
    SEGMENT_1_INVITATION,
    SEGMENT_2_GUIDANCE_RAILS,
    SEGMENT_2B_SOFT_PROMPT,
    SEGMENT_3_CONFIRM,
    SEGMENT_4_CLOSING_EXTENSION,
  }),
};
