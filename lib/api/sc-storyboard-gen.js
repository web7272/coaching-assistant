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
  6: '奪回裁判權 (Sovereignty) — external → internal locus、自己按讚存檔。',
  7: '標籤定錨 (Anchoring) — 新身份在神經系統固化、自動運行。',
});

// ────────────────────────────────────────────────────────────────
// Type priority: upward (toward sovereignty / anchoring) > pain.
//   Lower index = higher priority for quote pick.
// ────────────────────────────────────────────────────────────────
export const QUOTE_TYPE_PRIORITY = Object.freeze([
  'anchoring',            // step_7
  'sovereignty_reclaim',  // step_6
  'identity_claim',       // step_4
  'resource_retrieval',   // step_5
  'longing_surface',      // step_2
  'data_mining',          // step_3
  'pain_surface',         // step_1 — last resort
]);

// ────────────────────────────────────────────────────────────────
// Defence-in-depth denylist (mirrors api/chat.js PR-4 SC_JOURNEY_HIGH_RISK_PATTERNS).
// Re-applied here because PR-J2 NEVER trusts upstream transitively.
// ────────────────────────────────────────────────────────────────
export const SC_STORYBOARD_HIGH_RISK_PATTERNS = Object.freeze([
  /自殺/, /想死/, /去死/, /輕生/, /自傷/, /割腕/, /上吊/, /跳樓/, /燒炭/,
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
  // 2. Group by type, then walk priority order. Within a type bucket, prefer
  //    the LATEST entry (most current articulation).
  for (const preferredType of QUOTE_TYPE_PRIORITY) {
    const matches = safe.filter(e => e.type === preferredType);
    if (matches.length > 0) {
      const latest = matches[matches.length - 1];
      return latest.quote.trim();
    }
  }
  // 3. Unknown type but safe quote — fall through to latest safe entry.
  const latest = safe[safe.length - 1];
  return latest.quote.trim();
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
  model = 'claude-3-5-haiku-20241022',
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
