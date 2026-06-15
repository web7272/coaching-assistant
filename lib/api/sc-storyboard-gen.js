// lib/api/sc-storyboard-gen.js
// v5.3 件3 PR-J2 — 大腦現狀 (brain_state) generation.
//
// Architecture (Patrick 6/11 ruling):
//   - finalize-day 增量生成 + 存欄 + endpoint 純讀 (avoids 7 LLM call/page-open).
//   - 只對「本 session 新增 evidence 的步」 生成 (通常 1-2 步).
//
// Safety (核心 — Patrick will gate here):
//   1. quote 來源:students.sc_journey_evidence[step_N] entries (已過 PR-4 denylist).
//      Re-apply denylist defence-in-depth (不信任傳遞性).
//   2. 優先 upward types (resource_retrieval / identity_claim / sovereignty_reclaim /
//      anchoring / longing_surface) > pain_surface (避免大腦現狀以痛苦語句結尾).
//   3. 1 quote max per step (絕不把 evidence 全量倒進去).
//   4. description: LLM system prompt forbids 自殺/輕生/dark-原話 (Defense 1).
//   5. description + quote 都過 sanitizeStudentNote (Defense 2, scrubber).
//   6. Empty / no-safe-quote / LLM fail → return null (graceful fallback;
//      endpoint 走 placeholder「這塊土還沒走過」).
//
// SC step definitions: REUSE §3.5 cached「學員當下在做什麼」 column verbatim
// (Vivi 已終審). 不新寫內容 (避免再過終審).

import { sanitizeStudentNote, containsForbiddenContent }
  from './student-note-safe.js';

// ────────────────────────────────────────────────────────────────
// SC step definitions — VERBATIM from §3.5 (PR-2 cached, Vivi 終審逐字).
// Source: lib/prompt-sections/cached/mode-aware-router-reference.js §3.5
//         「學員當下在做什麼」 column.
// ────────────────────────────────────────────────────────────────
export const SC_STEP_DEFINITIONS = Object.freeze({
  1: '發現匱乏 (The Void) — surface 痛點、卡住、自我懷疑。',
  2: '承認渴望 (The Longing) — 把「不想要」翻譯成「真正想要的 quality / value」。',
  3: '挖掘數據 (Mining Database) — 找過去 1% 微證據、考古學家。',
  4: '認領身份 (Claiming Identity) — 植入新標籤「我是 X 的人」。',
  5: '發現資源 (Resource Retrieval) —「孕婦效應」、雷達變了、看見內外資源。',
  6: '奪回主權 (Sovereignty) — external → internal locus、自己按讚存檔。',
  7: '新的身分 (Anchoring) — 新身份在神經系統固化、自動運行。',
});

// ────────────────────────────────────────────────────────────────
// Type priority: ONLY upward types (toward sovereignty / anchoring).
//   Lower index = higher priority for quote pick.
//
// 🔴 Patrick 6/11 safety ruling (§1.5 rule 1 / §2.2 / §2.3):
//   pain_surface IS DELIBERATELY EXCLUDED. We never replay a learner's
//   pain phrasing verbatim back to them. Pain is承接 by description
//   (LLM-safe-rewritten); the verbatim quote field is for upward / 轉折
//   moments only. Pain-only steps surface description + quote:null
//   (留白) — per §2.3 rule 4.
// ────────────────────────────────────────────────────────────────
export const QUOTE_TYPE_PRIORITY = Object.freeze([
  'anchoring',            // step_7
  'sovereignty_reclaim',  // step_6
  'identity_claim',       // step_4
  'resource_retrieval',   // step_5
  'longing_surface',      // step_2
  'data_mining',          // step_3
  // ❌ pain_surface 移除 — 痛句不逐字顯示給學員 (轉標籤、不是記錄痛苦)
]);

// ────────────────────────────────────────────────────────────────
// Defence-in-depth denylist (mirrors api/chat.js PR-4 SC_JOURNEY_HIGH_RISK_PATTERNS).
// Re-applied here because PR-J2 NEVER trusts upstream transitively.
// ────────────────────────────────────────────────────────────────
// 6/12 — extended for observer judge (spec §4 single source of truth).
//   Additions: 不想活 / 無所眷念 (per Patrick observer spec).
//   Existing consumers (backfill / generation) inherit the stricter list,
//   which is strict-only safer (never wrongly admits a previously-safe quote).
// 6/14 — Patrick A006 dryRun 漏網修. step_6 brain_state.quote 出現「你不用擔心
//   我會傷害我自己」康復語氣但寫死「傷害我自己」 — 既有 /自傷/ 沒擋到「傷害+自己」
//   寫法. 加 /傷害.{0,2}自己/ 涵蓋:傷害自己 / 傷害我自己 / 傷害了自己; 加
//   /自我傷害/ 涵蓋:自我傷害(連體詞順序變形).
//   只強化、不放寬. consumers (sc-observer pre-LLM / backfill-observer-pass /
//   sc-memory-inject / sc-storyboard-gen pickSafeQuote / J2/J3) 一改全鏈生效.
export const SC_STORYBOARD_HIGH_RISK_PATTERNS = Object.freeze([
  /自殺/, /想死/, /去死/, /輕生/, /自傷/, /割腕/, /上吊/, /跳樓/, /燒炭/,
  /不想活/, /無所眷念/,
  /傷害.{0,2}自己/, /自我傷害/,
]);

function _isHighRiskText(text) {
  if (typeof text !== 'string') return false;
  return SC_STORYBOARD_HIGH_RISK_PATTERNS.some(p => p.test(text));
}

/**
 * Pure: pick the SAFEST + most representative quote from a step's evidence
 * entries. Defence-in-depth: drops any entry with high-risk phrasing in its
 * quote BEFORE applying type priority.
 *
 * @param {Array<{type:string, quote:string|null}>} entries
 * @returns {string|null}  the chosen quote, or null if none safe
 */
export function pickSafeQuote(entries) {
  if (!Array.isArray(entries) || entries.length === 0) return null;
  // 1. Filter to safe entries with non-empty quotes.
  const safe = entries.filter(e =>
    e && typeof e.quote === 'string' && e.quote.trim().length > 0
    && !_isHighRiskText(e.quote)
  );
  if (safe.length === 0) return null;
  // 2. Group by type, walk priority order. Within a type bucket, prefer the
  //    LATEST entry (most current articulation).
  //    🔴 Only types LISTED in QUOTE_TYPE_PRIORITY are eligible. pain_surface
  //    and any unknown / non-upward type are deliberately not selectable.
  for (const preferredType of QUOTE_TYPE_PRIORITY) {
    const matches = safe.filter(e => e.type === preferredType);
    if (matches.length > 0) {
      const latest = matches[matches.length - 1];
      return latest.quote.trim();
    }
  }
  // 3. No upward-type safe quote → null (留白, per §2.3 rule 4).
  //    ⚠️ Deliberately no fall-through to "latest safe entry" — that would
  //    surface pain_surface or unknown-typed quotes, violating §1.5 rule 1
  //    ("不可把用戶的原話回放給用戶自己看,尤其負面").
  return null;
}

/**
 * Pure: build the LLM system prompt for description generation. §2.2 verbatim
 * + safety prohibitions (Defense 1).
 *
 * @param {number} stepNo (1..7)
 * @returns {string}
 */
export function buildBrainStateSystemPrompt(stepNo) {
  const stepDef = SC_STEP_DEFINITIONS[stepNo] || '';
  return [
    '你是 SC 陪伴者,正在為「大腦現狀」段落寫 2-3 句、≤90 字、第二人稱、溫柔精準的描述。',
    '',
    `這一步 (Step ${stepNo}) 是:${stepDef}`,
    '',
    '寫作原則 (Vivi 6/11 終審):',
    '- 只承接痛、不複述黑暗原話',
    '- 不評價、不說教、不診斷',
    '- 用學員自己的視角第二人稱寫 ("你...")',
    '- 2-3 句、≤90 字,語氣溫柔精準',
    '',
    '絕對禁止 (任一觸發,輸出無效):',
    '- 出現「自殺」、「輕生」、「自傷」、「想死」、「去死」、「割腕」、「上吊」、「跳樓」、「燒炭」 任一字眼',
    '- 給建議、教學員怎麼做、prescribe',
    '- 標步驟編號 (「Step X」、「第 X 步」、「七步」)',
    '',
    '輸出格式:純文字描述,**不加引號**、不加 markdown、不加 metadata。直接寫 2-3 句。',
  ].join('\n');
}

/**
 * Pure: build the LLM user message for description generation.
 *
 * @param {number} stepNo
 * @param {string|null} representativeQuote
 * @returns {string}
 */
export function buildBrainStateUserMessage(stepNo, representativeQuote) {
  const stepDef = SC_STEP_DEFINITIONS[stepNo] || '';
  const lines = [
    `這一步:${stepDef}`,
    '',
    '為學員當下走在這一步時的「大腦現狀」 寫一段 2-3 句的描述。',
  ];
  if (representativeQuote) {
    lines.push('');
    lines.push(`學員具體說過的一句話 (作為情緒語境參考,不要逐字 paste):`);
    lines.push(`「${representativeQuote}」`);
    lines.push('');
    lines.push('描述可以呼應這句話的情緒底色,但用你自己的話寫,不複述。');
  }
  return lines.join('\n');
}

/**
 * Run text through Defense 2 scrubber. Returns sanitized text OR null if
 * sanitization produces empty / still-forbidden output (fail-closed).
 *
 * @param {string} text
 * @returns {string|null}
 */
export function scrubBrainStateText(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  // Belt-and-suspenders: high-risk check before / after sanitize.
  if (_isHighRiskText(text)) return null;
  const cleaned = sanitizeStudentNote(text);
  if (!cleaned || cleaned.length === 0) return null;
  if (_isHighRiskText(cleaned)) return null;
  if (containsForbiddenContent(cleaned)) return null;
  return cleaned;
}

/**
 * Generate brain_state for a single step.
 *
 * @param {object} args
 * @param {number} args.stepNo  1..7
 * @param {Array} args.evidenceEntries  the step's sc_journey_evidence entries
 * @param {object} [args.anthropic]  injected client; if absent, returns null
 *                                   (caller can supply real client at runtime)
 * @param {string} [args.model]   model id
 * @param {object} [args.opts]    additional opts for callAnthropicWithRetry
 * @returns {Promise<{description:string, quote:string|null} | null>}
 *   null when:
 *     - stepNo out of range
 *     - evidence empty
 *     - LLM call fails / throws
 *     - description scrub kills text entirely
 */
export async function generateBrainState({
  stepNo,
  evidenceEntries,
  anthropic = null,
  model = 'claude-haiku-4-5-20251001',
  maxTokens = 200,
  callAnthropicWithRetry: callAnthropic = null,
  log = (msg) => console.warn(msg),
} = {}) {
  if (!Number.isInteger(stepNo) || stepNo < 1 || stepNo > 7) return null;
  if (!Array.isArray(evidenceEntries) || evidenceEntries.length === 0) return null;
  if (!anthropic || typeof callAnthropic !== 'function') {
    log('[sc-storyboard-gen] missing anthropic / callAnthropic → fail-soft null');
    return null;
  }

  // 1. Pick safest quote (defence-in-depth denylist applied).
  const safeQuote = pickSafeQuote(evidenceEntries);

  // 2. LLM call for description.
  let descriptionRaw;
  try {
    const result = await callAnthropic(anthropic, {
      model,
      max_tokens: maxTokens,
      system: buildBrainStateSystemPrompt(stepNo),
      messages: [{ role: 'user', content: buildBrainStateUserMessage(stepNo, safeQuote) }],
    });
    if (!result?.ok || !result.data?.content?.[0]?.text) {
      log('[sc-storyboard-gen] LLM call returned no text → null');
      return null;
    }
    descriptionRaw = result.data.content[0].text.trim();
  } catch (err) {
    log(`[sc-storyboard-gen] LLM call threw: ${err?.message || err}`);
    return null;
  }

  // 3. Defense 2: scrub description.
  const descriptionSafe = scrubBrainStateText(descriptionRaw);
  if (!descriptionSafe) {
    log('[sc-storyboard-gen] description scrubbed to empty → null');
    return null;
  }

  // 4. Re-verify quote safety (belt-and-suspenders post-LLM in case the model
  //    somehow surfaced the raw quote in description we want to keep clean).
  //    Quote was already filtered upstream; null stays null.
  return { description: descriptionSafe, quote: safeQuote };
}

// ════════════════════════════════════════════════════════════════
// v5.3 件3 PR-J3 — 主權建議 (sovereign_action) generation.
// ════════════════════════════════════════════════════════════════
//
// 🔴 Top red lines (Patrick 6/11):
//   1. 每個人必須不一樣 — output substantially differs per learner.
//   2. 素材不夠 → null (絕不掉 generic 範本).
//   3. 結尾必落內控宣告 ("我自己說了算" / 等義).
//   4. 剛性對準舊信念 + 外在裁判, NEVER 對學員自己.
//   5. 0 自殺 / FORBIDDEN (Defense 2 scrubber).
//
// Source structure (§2.4 verbatim 7 prototypes): each step has a fixed
// 結構骨架 (every learner's sovereign_action follows the same logic skeleton
// for that step), but the BODY is filled with that learner's own materials.

/**
 * §2.4 verbatim prototype skeletons (one per step). LLM receives this as the
 * structural template + must populate with the learner's own materials.
 * NOT shown to learner directly (internal scaffolding).
 */
export const SOVEREIGN_ACTION_PROTOTYPES = Object.freeze({
  1: '指認「你把『我存不存在』的開關交給外在 X」→ 要求拿回 → 內控宣告。',
  2: '對舊標籤英雄式歡迎 (它保護過你) → 翻譯成中性能力 → 卸下防禦。',
  3: '與陰暗面擁抱 → 數據工程師挖 1% 鋼鐵證據 → 封住限制性信念。',
  4: '趁信念鬆動現在式宣告新身份 → 舊標籤翻譯成能力。',
  5: '看穿處境真相 (誰索取 / 逃避) → 拿回主導權 + 指認自生資源。',
  6: '撕開「對方的選擇」 vs「你的價值」 → 收回主權 → 愛轉回自己。',
  7: '用學員定錨句 → 每天掃描微證據 → 釘進神經系統 +「我說了算」。',
});

/**
 * Self-control declaration patterns — the suffix that sovereign_action MUST
 * end with. Detector for the validator + the prompt cites these as examples.
 *
 * 🔴 No-end → reject output (Patrick: 「結尾沒落內控宣告 = 不可接受」).
 */
export const SELF_CONTROL_DECLARATION_PATTERNS = Object.freeze([
  /我自己說了算/,
  /我說了算/,
  /不需要任何人?批准/,
  /不需要外在/,
  /我才是裁判/,
  /我才是源頭/,
  /我自己決定/,
  /主導權在我/,
  /主動權在我/,
]);

function _endsWithSelfControlDeclaration(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  // Look at the last ~30 chars (the spec is 80-140 字; tail is the natural
  // landing for the declaration).
  const tail = text.slice(-30);
  return SELF_CONTROL_DECLARATION_PATTERNS.some(p => p.test(tail));
}

/**
 * Patterns that would mean the rigidity vector points AT the learner (red line).
 * If output matches any, reject (force regen / fall through to null).
 *
 * 「你錯了」/「你不夠」/「你失敗」 etc. point AT learner. The sovereign
 * action must point AT OLD BELIEFS / EXTERNAL JUDGES.
 */
export const RIGIDITY_AT_SELF_PATTERNS = Object.freeze([
  /你錯了/,
  /你太/,                    // "你太弱" / "你太懶" — judgement at self
  /你不夠/,
  /你失敗/,
  /你應該責備自己/,
  /怪你自己/,
  /都是你的錯/,
]);

function _pointsRigidityAtSelf(text) {
  if (typeof text !== 'string' || text.length === 0) return false;
  return RIGIDITY_AT_SELF_PATTERNS.some(p => p.test(text));
}

/**
 * Pure: assess whether the personalization context has enough material to
 * write a meaningful sovereign_action. Returns true ONLY when at least 2 of
 * 3 source categories are substantive (Patrick: 幾乎全空 → null).
 *
 * Sources:
 *   1. active_context (name AND definition both non-trivial)
 *   2. surfaced_values (≥1 cross-session quality the learner surfaced)
 *   3. step evidence (≥1 entry with quote / type info in THIS step)
 *
 * @param {object} ctx
 * @returns {boolean}
 */
export function hasSufficientPersonalization(ctx = {}) {
  const ac = ctx.activeContext || {};
  const hasContext = (typeof ac.name === 'string' && ac.name.trim().length > 0)
    && (typeof ac.definition === 'string' && ac.definition.trim().length > 0);
  const surfacedValues = Array.isArray(ctx.surfacedValues) ? ctx.surfacedValues : [];
  const hasValues = surfacedValues.some(v => typeof v === 'string' && v.trim().length > 0);
  const stepEvidence = Array.isArray(ctx.stepEvidence) ? ctx.stepEvidence : [];
  const hasEvidence = stepEvidence.some(e => e && typeof e === 'object' && (e.quote || e.type));
  const score = (hasContext ? 1 : 0) + (hasValues ? 1 : 0) + (hasEvidence ? 1 : 0);
  return score >= 2;
}

/**
 * Pure: build the LLM system prompt for sovereign_action generation.
 * §2.4 verbatim 結構 + safety prohibitions + 個人化紅線.
 */
export function buildSovereignActionSystemPrompt(stepNo) {
  const prototype = SOVEREIGN_ACTION_PROTOTYPES[stepNo] || '';
  const stepDef = SC_STEP_DEFINITIONS[stepNo] || '';
  return [
    '你是 SC 陪伴者,正在為「主權建議」段落寫一段可執行的指令。',
    '',
    `這一步 (Step ${stepNo}) 是:${stepDef}`,
    '',
    `這一步的「主權動作原型」 (§2.4 固定結構,你必須嚴格按此邏輯展開):`,
    `  ${prototype}`,
    '',
    '🔴 個人化紅線 (Patrick 6/11):',
    '- 必須用學員自己的材料 (active_context / surfaced_values / 該 step evidence) 填成具體有效的指令',
    '- 結果對「這個學員」具體有效,不能寫成可以套在任何人身上的通用句',
    '',
    '寫作原則:',
    '- 80-140 字,第二人稱,要有力量',
    '- 嚴格依原型結構展開三段邏輯',
    '- 結尾必落內控宣告 (例:「我自己說了算」、「我才是裁判」、「主導權在我」、「不需要外在批准」)',
    '- 剛性對準舊信念 + 外在裁判 (the OLD label / the external judge)',
    '- 絕不剛性對準學員自己 (不寫「你錯了」、「你不夠」、「你失敗」、「都是你的錯」)',
    '',
    '絕對禁止 (任一觸發,輸出無效):',
    '- 出現「自殺」、「輕生」、「自傷」、「想死」、「去死」、「割腕」、「上吊」、「跳樓」、「燒炭」 任一字眼',
    '- 給普世道德訓誡、診斷學員、評價學員人格',
    '- 標步驟編號 (「Step X」、「第 X 步」、「七步」)',
    '- 寫成 generic 範本可以套到任何人身上',
    '',
    '輸出格式:純文字指令,不加引號、不加 markdown、不加 metadata、不加標題。直接寫 80-140 字。',
  ].join('\n');
}

/**
 * Pure: build the LLM user message (personalization payload).
 */
export function buildSovereignActionUserMessage(stepNo, ctx) {
  const ac = ctx.activeContext || {};
  const lines = [
    `這一步:${SC_STEP_DEFINITIONS[stepNo] || ''}`,
    '',
    `原型結構 (你必須照此邏輯展開,別自創):`,
    `  ${SOVEREIGN_ACTION_PROTOTYPES[stepNo] || ''}`,
    '',
    '學員的個人化材料 (你必須實際引用 / 體現,不能寫成空泛指令):',
  ];
  if (ac.name || ac.definition) {
    lines.push(`- 他現在的領域 (active_context):`);
    if (ac.name)       lines.push(`    名稱: ${String(ac.name).trim()}`);
    if (ac.definition) lines.push(`    定義: ${String(ac.definition).trim()}`);
  }
  if (Array.isArray(ctx.surfacedValues) && ctx.surfacedValues.length > 0) {
    const cleaned = ctx.surfacedValues
      .filter(v => typeof v === 'string' && v.trim().length > 0)
      .slice(0, 5);
    if (cleaned.length > 0) {
      lines.push(`- 他跨 session 累積過的價值 / quality:`);
      cleaned.forEach(v => lines.push(`    - ${v.trim()}`));
    }
  }
  if (Array.isArray(ctx.stepEvidence) && ctx.stepEvidence.length > 0) {
    // Use pickSafeQuote-like filtering: avoid pain_surface, no high-risk.
    const safeEvidence = ctx.stepEvidence.filter(e =>
      e && typeof e === 'object'
      && typeof e.quote === 'string'
      && e.quote.trim().length > 0
      && !_isHighRiskText(e.quote)
      && e.type !== 'pain_surface'
    );
    if (safeEvidence.length > 0) {
      lines.push(`- 他在這一步 surface 過的句子 / type (你可體現情緒底色,別逐字回放):`);
      safeEvidence.slice(0, 3).forEach(e => {
        lines.push(`    - type=${e.type}, quote="${e.quote.trim()}"`);
      });
    }
  }
  lines.push('');
  lines.push(`現在為這個學員寫一段 80-140 字的「主權建議」,嚴格依原型 + 用上面的個人化材料 + 結尾落內控宣告。`);
  return lines.join('\n');
}

/**
 * Max attempts for generateSovereignAction LLM retry (6/14 Patrick).
 *   原 1 次 → 多數步 missing self-control / rigidity-at-self → null. J3 是
 *   生成後驗證, LLM 單次生成變異大. 加 retry 多給機會拿到合格輸出.
 *   每次 attempt 跑完整安全 (sanitize + denylist + containsForbiddenContent +
 *   rigidity-at-self + self-control declaration), 0 安全弱化 / 0 降標.
 *   3 = 原 1 + retry 2. J3 是 Haiku 便宜; finalize maxDuration=300 有 headroom;
 *   backfill 走 GitHub Actions 無限時.
 */
export const J3_MAX_ATTEMPTS = 3;

/**
 * Generate sovereign_action for a single step.
 *
 * 6/14 Patrick: retry 包裝 — 不合格自動重生 (最多 3 次).
 *   pre-LLM check (stepNo / personalization / anthropic dep) 不 retry —
 *   stable inputs 重試無意義. 每次 LLM attempt 都跑完整安全 pipeline.
 *
 * @param {object} args
 * @param {number} args.stepNo  1..7
 * @param {object} args.ctx     personalization context
 *   - args.ctx.activeContext  { name, definition }
 *   - args.ctx.surfacedValues string[]
 *   - args.ctx.stepEvidence   Array<{type, quote, ...}>  (THIS step's evidence)
 * @param {object} [args.anthropic]      injected client
 * @param {Function} [args.callAnthropicWithRetry]
 * @param {string} [args.model]
 * @param {number} [args.maxTokens]
 * @param {Function} [args.log]
 * @returns {Promise<string | null>}
 *   - null when:
 *     * stepNo out of range
 *     * personalization insufficient (個人化紅線:寧 null 不 generic)
 *     * J3_MAX_ATTEMPTS 次 LLM attempt 全部失敗 (每次原因可能不同):
 *       no LLM text / LLM threw / scrubbed to empty / rigidity-at-self /
 *       missing self-control declaration / denylist hit.
 */
export async function generateSovereignAction({
  stepNo,
  ctx = {},
  anthropic = null,
  callAnthropicWithRetry: callAnthropic = null,
  model = 'claude-haiku-4-5-20251001',
  maxTokens = 300,
  log = (msg) => console.warn(msg),
} = {}) {
  if (!Number.isInteger(stepNo) || stepNo < 1 || stepNo > 7) return null;
  if (!hasSufficientPersonalization(ctx)) {
    log(`[sc-storyboard-gen][sovereign_action] step ${stepNo} insufficient personalization → null`);
    return null;
  }
  if (!anthropic || typeof callAnthropic !== 'function') {
    log('[sc-storyboard-gen][sovereign_action] missing anthropic / callAnthropic → null');
    return null;
  }

  // 6/14 Patrick — retry loop. 每次 attempt 完整 LLM call + 完整安全 pipeline.
  //   通過 → 立即 return cleaned (1 次就過 → 0 額外成本 / 0 額外延遲).
  //   失敗 → continue 下一輪. 全部失敗 → null.
  let lastReason = 'unknown';
  for (let attempt = 1; attempt <= J3_MAX_ATTEMPTS; attempt++) {
    let raw;
    try {
      const result = await callAnthropic(anthropic, {
        model,
        max_tokens: maxTokens,
        system: buildSovereignActionSystemPrompt(stepNo),
        messages: [{ role: 'user', content: buildSovereignActionUserMessage(stepNo, ctx) }],
      });
      if (!result?.ok || !result.data?.content?.[0]?.text) {
        lastReason = 'no LLM text';
        log(`[sc-storyboard-gen][sovereign_action] step ${stepNo} attempt ${attempt}/${J3_MAX_ATTEMPTS}: ${lastReason}`);
        continue;
      }
      raw = result.data.content[0].text.trim();
    } catch (err) {
      lastReason = `LLM threw: ${err?.message || err}`;
      log(`[sc-storyboard-gen][sovereign_action] step ${stepNo} attempt ${attempt}/${J3_MAX_ATTEMPTS}: ${lastReason}`);
      continue;
    }

    // Defense 2: scrubber (sanitizeStudentNote + denylist + containsForbiddenContent).
    //   高危 raw 在這裡被擋 → continue (下次 attempt 仍會再過安全, retry 不洩漏).
    const cleaned = scrubBrainStateText(raw);
    if (!cleaned) {
      lastReason = 'scrubbed to empty (high-risk / forbidden / empty)';
      log(`[sc-storyboard-gen][sovereign_action] step ${stepNo} attempt ${attempt}/${J3_MAX_ATTEMPTS}: ${lastReason}`);
      continue;
    }
    // 🔴 ship-gate: rigidity must NOT point at self.
    if (_pointsRigidityAtSelf(cleaned)) {
      lastReason = 'rigidity-at-self';
      log(`[sc-storyboard-gen][sovereign_action] step ${stepNo} attempt ${attempt}/${J3_MAX_ATTEMPTS}: ${lastReason}`);
      continue;
    }
    // 🔴 ship-gate: must end with self-control declaration.
    if (!_endsWithSelfControlDeclaration(cleaned)) {
      lastReason = 'missing self-control declaration';
      log(`[sc-storyboard-gen][sovereign_action] step ${stepNo} attempt ${attempt}/${J3_MAX_ATTEMPTS}: ${lastReason}`);
      continue;
    }
    // 🟢 PASS — log retry success if relevant, return.
    if (attempt > 1) {
      log(`[sc-storyboard-gen][sovereign_action] step ${stepNo} succeeded on attempt ${attempt}/${J3_MAX_ATTEMPTS}`);
    }
    return cleaned;
  }

  // 全部 attempts 失敗.
  log(`[sc-storyboard-gen][sovereign_action] step ${stepNo} all ${J3_MAX_ATTEMPTS} attempts failed → null (last reason: ${lastReason})`);
  return null;
}

/**
 * Pure: from `sc_journey_evidence` keyed object, derive list of step numbers
 * (1..7, ascending) that have at least one entry.
 *
 * @param {object} evidence
 * @returns {number[]}
 */
export function listStepsWithEvidence(evidence) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) return [];
  const out = [];
  for (let n = 1; n <= 7; n++) {
    const arr = evidence[`step_${n}`];
    if (Array.isArray(arr) && arr.length > 0) out.push(n);
  }
  return out;
}
