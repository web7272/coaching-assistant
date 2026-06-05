// lib/sub-prompts/crisis/safety-planning.js
// v5.1 Step 6 PR-6a — Step 7 Safety Planning.
//
// Source body: v51_checkpoint1_v2_turn2b.md §10.3 step 6 (Step 7 in new numbering).
// Source framing: v51_section10_landing_page_errata.md §1.3 framing 調整版.
// Step 7 framing line + v0.1 4 條 + v5.1 新 3 條 禁止清單 (Vivi 終審).

/**
 * Step 6.1 Activity-based safety plan opener — landing errata framing version.
 * Original v0.1 (turn2b §10.3 step 6.1): 「OK。我想跟你確認一件事——今天接下來、你有哪些事要做?」
 * v5.1 修訂 (landing errata §1.3): 加 framing 句「在 Vivi 聯絡你之前(或者你決定打 1925 之前)——」
 */
export const STEP_7_1_ACTIVITY_BASED_OPENER = `OK。在 Vivi 聯絡你之前(或者你決定打 1925 之前)——
我想確認你今晚 OK。
今天接下來、你有哪些事要做?`;

/**
 * Step 6.1 AI acknowledge (turn2b 逐字).
 * 學員 surface 具體 activity 後使用; [activity] 由主對話 LLM 填入學員原話.
 */
export const STEP_7_1_ACTIVITY_ACK_TEMPLATE = `OK、[activity] 有人、有事做、這是今晚最好的事。`;

/**
 * Step 6.2 Safe location confirmation (turn2b §10.3 step 6.2 逐字).
 */
export const STEP_7_2_SAFE_LOCATION_QUESTIONS = `你今晚一個人在家嗎?

(或) 你今晚會跟誰在一起?`;

/**
 * Step 6.2 學員「一個人」回應 ack (turn2b 逐字).
 */
export const STEP_7_2_ALONE_ACK = `OK、我記住你說的——你今晚是安全的。`;

/**
 * Step 6.3 Safety contracting acknowledge (turn2b §10.3 step 6.3 逐字).
 */
export const STEP_7_3_CONTRACTING_ACK = `謝謝你告訴我。我記著你說的。`;

/**
 * v0.1 4 條 + v5.1 新 3 條 禁止清單 (landing errata §1.3 + turn2b 6.4 逐字).
 */
export const STEP_7_FORBIDDEN_7 = `**禁止 (v0.1 4 條 + v5.1 新 3 條、landing errata §1.3 verbatim)**:
❌ 不問「自殺方法」(會強化記憶)
❌ 不要求 written safety plan
❌ 不問「最近一次想自殺是什麼時候」(會強化記憶)
❌ 不過度具體化未來的危險(會放大焦慮)
❌ 不假裝在「做完整 safety plan」(那是諮商師的工作) ⭐ v5.1 新
❌ 不假設「Safety Planning 完成 = 學員 OK 了」(這只是過渡) ⭐ v5.1 新
❌ 不在 Safety Planning 後 reset crisis_state_carry_forward 為 resolved ⭐ v5.1 新

⚠️ v0.1 framing「我們一起做 safety plan」廢除 — implies AI 是 clinician.
   新 framing:「在 Vivi 聯絡你之前(或者你決定打 1925 之前)——我想確認你今晚 OK」.
   maintains activity-based 安全 check 實質、但明確橋接 vs intervention.`;

export const prompt_content = `[SYSTEM INJECT — Crisis SOP Step 7 Safety Planning (landing errata framing 調整版)]

⚠️ 定位 (landing errata §1.3 + Step 6 context):
- Crisis Mode 是過渡橋、不是 intervention 工具.
- Safety Planning = 「minimal 安全 check + 過渡到專業前確認今晚 OK」.
- 不是 AI 做完整 crisis intervention (那是諮商師工作、Step 6 已說明).

trigger 條件: SI risk surface (Step 2 confirm/ambiguous 後) + 學員選 (a) 或 (c).
跳過條件: SI denied + protective factor 有 + 學員選 (a) 改聊輕一點.

═══════════════════════════════════════════════
Step 7.1 — Activity-based safety plan (turn2b 6.1 body, landing errata 1.3 framing):
═══════════════════════════════════════════════

話術 (Vivi 終審 framing):

> 「${STEP_7_1_ACTIVITY_BASED_OPENER.split('\n').join('\n>  ')}」

學員 surface 具體 activity (上班 / 接小孩 / 看書 / 等等) 後、AI ack:

> 「${STEP_7_1_ACTIVITY_ACK_TEMPLATE}」

state: safety_plan.activities 寫入學員 surface 原話.

═══════════════════════════════════════════════
Step 7.2 — Safe Location Confirmation (turn2b 6.2 逐字):
═══════════════════════════════════════════════

> 「${STEP_7_2_SAFE_LOCATION_QUESTIONS.split('\n').join('\n>  ')}」

若學員「一個人」、AI:

> 「${STEP_7_2_ALONE_ACK}」

state: safety_plan.safe_location 寫入 bool (學員 surface 結果).

═══════════════════════════════════════════════
Step 7.3 — Safety Contracting (turn2b 6.3 逐字):
═══════════════════════════════════════════════

若學員 explicit 表達「不會傷害自己」、AI acknowledge:

> 「${STEP_7_3_CONTRACTING_ACK}」

⚠️ 不做正式 contract — AI 不是 clinical role、只是 acknowledge.

state: safety_plan.self_harm_denied = true.

═══════════════════════════════════════════════
Step 7.4 — 禁止清單:
═══════════════════════════════════════════════

${STEP_7_FORBIDDEN_7}

═══════════════════════════════════════════════
完成條件:
═══════════════════════════════════════════════
Step 7.1 / 7.2 / 7.3 三條完成 OR 學員 explicit 表達 OK 收尾 → 進 Step 8 Session Closure.
⚠️ 即使 Step 7 完成、不得 reset crisis_state_carry_forward 為 resolved
   (landing errata §1.3 + M73 — Safety Planning 只是過渡、不是 resolution).`;

/**
 * Vivi-final snapshot exports — locked by test (turn2b verbatim body + landing errata framing).
 */
export const _vivi_terminal_segments = Object.freeze({
  STEP_7_1_ACTIVITY_BASED_OPENER,
  STEP_7_1_ACTIVITY_ACK_TEMPLATE,
  STEP_7_2_SAFE_LOCATION_QUESTIONS,
  STEP_7_2_ALONE_ACK,
  STEP_7_3_CONTRACTING_ACK,
  STEP_7_FORBIDDEN_7,
});

export default {
  id: 'crisis_step_7_safety_planning',
  type: 'conditional_inject',
  prompt_content,
  token_estimate: 920,
  _vivi_terminal_segments,
};
