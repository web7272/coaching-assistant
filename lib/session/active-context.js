// lib/session/active-context.js
// v5.2 第二塊 PR-a (Vivi 6/5) — active_context dynamic block + derive helper.
//
// Source: v52_context_anchored_spec §4.1 (AI internal awareness block, verbatim).
//
// 設計:
//   - 純函式. caller (api/chat.js buildDynamicContext) compose.
//   - active_context 走 dynamic block (breakpoint 後), NOT cached prefix.
//     per-student 內容、進 cached 會破全員 cache (Patrick 6/5 工程鐵則).
//   - Graceful fallback (per task spec §7.3 in-progress 不 break):
//       category null / invalid → return null block + null phrasing name
//       → buildDynamicContext omits the block → v5.1 既有行為.
//
// Phrasing anchor (v5.2 第二塊 PR-b 用此 derive helper):
//   {context_name} fill 規則: 若 students.active_context_name 有 → 用 name;
//                            若 null → fallback 用 category short label.

/**
 * Category enum → 英文 internal code (for Active Context block).
 * Aligns with migration 029 CHECK (1-5) + ACTIVE_CONTEXT_CATEGORIES in
 * lib/api/admin-students.js.
 */
export const CATEGORY_CODES = Object.freeze({
  1: 'career_work_money',
  2: 'intimate_relationship',
  3: 'family',
  4: 'health',
  5: 'self_internal',
});

/**
 * Category enum → 中文 full label (顯示在 Active Context block Category line).
 */
export const CATEGORY_LABELS_ZH = Object.freeze({
  1: '事業 / 工作 / 金錢',
  2: '親密關係 (伴侶 / 戀愛)',
  3: '家庭 (原生家庭 / 子女)',
  4: '健康 / 身體',
  5: '自我 / 內在狀態 / 心理',
});

/**
 * Category enum → 中文短字 (phrasing anchor fallback when name is null).
 */
export const CATEGORY_SHORT_LABELS = Object.freeze({
  1: '事業',
  2: '親密關係',
  3: '家庭',
  4: '健康',
  5: '自我',
});

/**
 * Estimated tokens for the full Active Context block (~80 per spec §4.1).
 * Used by token-budget assertions / monitoring.
 */
export const ACTIVE_CONTEXT_BLOCK_TOKEN_ESTIMATE = 80;

/**
 * Build the [Active Context] block per spec §4.1 verbatim template.
 * Returns null when active_context is missing/invalid → caller skips inject.
 *
 * @param {object} args
 * @param {number} args.category — 1-5 per ACTIVE_CONTEXT_CATEGORIES
 * @param {string|null} args.name — students.active_context_name (nullable until Vivi 聯繫)
 * @param {string|null} args.definition — students.active_context_definition (nullable)
 * @returns {string|null} block text, OR null to skip (fallback to v5.1)
 */
export function buildActiveContextBlock({ category, name, definition } = {}) {
  const cat = Number(category);
  if (!Number.isInteger(cat) || cat < 1 || cat > 5) return null;

  const categoryLabel = CATEGORY_LABELS_ZH[cat];
  const displayName = (typeof name === 'string' && name.trim().length > 0)
    ? name.trim()
    : categoryLabel;   // graceful fallback when Vivi 還沒填 name
  const displayDef = (typeof definition === 'string' && definition.trim().length > 0)
    ? definition.trim()
    : '(unspecified, learner to surface as they speak)';

  // §4.1 verbatim template — English internal awareness for Sonnet.
  return `[Active Context]
Category: ${categoryLabel}
Name: ${displayName}
Definition: ${displayDef}

Today's conversation focuses on this context.
All your questions and reflections should anchor to this context.

If learner surfaces content from other contexts:
- If related to active_context → integrate as evidence
- If completely unrelated → acknowledge, note, return to active_context

Do not initiate cross-context exploration unless learner naturally surfaces.`;
}

/**
 * Derive the {context_name} value used for v5.2 第二塊 PR-b phrasing anchor.
 *   - If name set → use name (學員 surface 過的 specific 場景).
 *   - If name null → fallback to category short label (事業 / 親密關係 / etc).
 *   - If category invalid → null (caller falls back to v5.1 phrasing, no anchor).
 *
 * @param {object} args — { category, name }
 * @returns {string|null}
 */
export function deriveContextNameForPhrasing({ category, name } = {}) {
  const cat = Number(category);
  if (!Number.isInteger(cat) || cat < 1 || cat > 5) return null;
  if (typeof name === 'string' && name.trim().length > 0) return name.trim();
  return CATEGORY_SHORT_LABELS[cat];
}

/**
 * Extract activeContext object from a row containing active_context_* fields.
 * Used by chat.js to build the shape from students table SELECT.
 *
 * @param {object} row — students row OR studentRow-like object with the 3 fields
 * @returns {{category:number|null, name:string|null, definition:string|null}}
 */
export function pickActiveContext(row) {
  if (!row || typeof row !== 'object') return { category: null, name: null, definition: null };
  const catRaw = Number(row.active_context_category);
  return {
    category: (Number.isInteger(catRaw) && catRaw >= 1 && catRaw <= 5) ? catRaw : null,
    name: typeof row.active_context_name === 'string' ? row.active_context_name : null,
    definition: typeof row.active_context_definition === 'string' ? row.active_context_definition : null,
  };
}
