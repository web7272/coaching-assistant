// lib/sub-prompts/onboarding/parse-helpers.js
// v5.2 第四塊 PR-a — user response parsers for onboarding state machine.
//
// 鐵律 #2: parsers operate on text, never log raw text.

/**
 * Parse step 1 category pick.
 *
 * Accepts:
 *   - 數字 1-5
 *   - 文字 category keyword:
 *       事業 / 工作 / 金錢 / 賺錢 / 升職 / startup → 1
 *       親密 / 戀愛 / 伴侶 / 感情 / 男友 / 女友 / 老公 / 老婆 / 先生 / 太太 → 2
 *       家庭 / 家裡 / 原生 / 父母 / 爸 / 媽 / 子女 / 小孩 / 孩子 → 3
 *       健康 / 身體 / 運動 / 減肥 / 睡眠 → 4
 *       自我 / 內在 / 心理 / 焦慮 / 情緒 / 自信 → 5
 *   - Unique frame (例「我跟錢的關係」) → match via keyword
 *
 * Returns null when no category can be inferred (caller re-prompts).
 *
 * @param {string} text
 * @returns {number|null} 1-5 OR null
 */
export function parseCategoryPick(text) {
  if (typeof text !== 'string' || text.trim().length === 0) return null;
  const t = text.trim();

  // 1. 數字 1-5 (also accepts「(1)」/「1.」 etc).
  const numMatch = t.match(/(?:^|[^0-9])([1-5])(?:[^0-9]|$)/);
  if (numMatch) return Number(numMatch[1]);

  // 2. Escape hatch check — refuse 「都...」 / 「隨便」 etc → return null (re-prompt).
  if (/^(都(不|可|沒).{0,3}|隨便|不知道|沒差|沒意見|都行)$/.test(t)) return null;

  // 3. 文字 category keyword — order matters (more specific patterns first).
  // category 2 親密關係 (check before 家庭 since some overlap with 老公/老婆).
  if (/(親密|戀愛|伴侶|感情|男友|女友|男朋友|女朋友|老公|老婆|先生|太太|另一半)/.test(t)) return 2;
  // category 3 家庭 (原生家庭 / 子女).
  if (/(家庭|家裡|原生|父母|爸媽|父母|爸爸|媽媽|子女|小孩|孩子|手足|兄弟|姊妹|長輩)/.test(t)) return 3;
  // category 4 健康.
  if (/(健康|身體|運動|減肥|睡眠|體力|生病|疾病|身材)/.test(t)) return 4;
  // category 5 自我 / 內在.
  if (/(自我|內在|心理|焦慮|情緒|自信|憂鬱|抑鬱|內心|心靈|平靜|安全感|不安)/.test(t)) return 5;
  // category 1 事業 / 工作 / 金錢 (last — broadest catch).
  if (/(事業|工作|職場|職業|公司|主管|老闆|同事|金錢|錢|薪水|升職|加薪|startup|新創|生意|創業|理財|存錢|賺錢)/.test(t)) return 1;

  return null;
}

/**
 * Parse step 2 articulate. Returns the trimmed text or null if empty/vague.
 * Caller handles vague case (輕引、不寫入).
 *
 * @param {string} text
 * @returns {string|null}
 */
export function parseArticulate(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (t.length === 0) return null;
  // Vague responses → null (caller re-prompts).
  if (/^(不知道|沒差|都可以|隨便|都行|沒意見)$/.test(t)) return null;
  return t;
}

/**
 * Parse step 3 confirm.
 *
 * @param {string} text
 * @returns {'confirm'|'reject'|null}
 */
export function parseConfirm(text) {
  if (typeof text !== 'string') return null;
  const t = text.trim();
  if (t.length === 0) return null;
  // Reject 先 check (因為「不對」可能 substring「對」).
  if (/^(不對|不是|不|錯了|不太對|想改|還要加|還想加|想加|要改|不好|還想再|還想說|還想)/.test(t)) return 'reject';
  if (/^(對|是|嗯|沒錯|對的|是的|yes|ok|對啊|沒問題|好的|可以|沒錯啊)$/i.test(t)) return 'confirm';
  return null;
}

/**
 * Trim active_context_name to ≤ 30 chars (per spec §1).
 * Returns object with sanitized name + flag if truncation happened.
 */
export function sanitizeName(text) {
  const trimmed = (typeof text === 'string') ? text.trim() : '';
  if (trimmed.length === 0) return { name: null, truncated: false };
  if (trimmed.length <= 30) return { name: trimmed, truncated: false };
  return { name: trimmed.slice(0, 30), truncated: true };
}

/**
 * Trim active_context_definition to ≤ 200 chars (per spec §1).
 */
export function sanitizeDefinition(text) {
  const trimmed = (typeof text === 'string') ? text.trim() : '';
  if (trimmed.length === 0) return { definition: null, truncated: false };
  if (trimmed.length <= 200) return { definition: trimmed, truncated: false };
  return { definition: trimmed.slice(0, 200), truncated: true };
}
