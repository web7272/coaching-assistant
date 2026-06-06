// lib/session/active-context-summary-inject.js
// v5.2 第三塊 PR-b — Format per-category summary into dynamic block inject.
//
// Source: v52_context_anchored_spec §5.2 — Cross-Session Memory in {context_name} block.
// Fixes Beta feedback #7 (跨天重問同 value/example).
//
// 設計:
//   - Pure function. caller (chat.js buildDynamicContext) compose into dynamic block
//     AFTER the existing「昨天素材」 inject. NOT cached (per-student, 進 cached 破全員).
//   - Token control per spec §5.2 (~200 tok total cap, 6-8 examples max,
//     single example ≤100 chars).
//   - Graceful fallback: summary[category] absent / empty → return null →
//     caller skips inject → 既有「昨天素材」 inject path 保留 continuity.
//   - 換領域 (category change in students) → 自然只讀新 category → 舊 category
//     累積保留 in JSONB 但不引用 → 乾淨切換 (no cleanup needed, design即乾淨).

import { CATEGORY_SHORT_LABELS } from './active-context.js';

/**
 * Max examples per inject (spec §5.2 token budget — keep most recent N).
 */
export const MAX_EXAMPLES_PER_INJECT = 8;

/**
 * Max chars per example after truncation (spec §5.2: single example ≤ 100 chars).
 */
export const MAX_CHARS_PER_EXAMPLE = 100;

/**
 * Read the per-category bucket from UPE.active_context_session_summary.
 *
 * @param {object} summaryJsonb — userProfile.active_context_session_summary
 * @param {number} category — 1-5
 * @returns {{surfaced_values: string[], surfaced_examples: object[], last_updated_day: number}|null}
 */
export function readCategoryBucket(summaryJsonb, category) {
  if (!summaryJsonb || typeof summaryJsonb !== 'object') return null;
  const cat = Number(category);
  if (!Number.isInteger(cat) || cat < 1 || cat > 5) return null;
  const bucket = summaryJsonb[String(cat)];
  if (!bucket || typeof bucket !== 'object') return null;
  return {
    surfaced_values: Array.isArray(bucket.surfaced_values) ? bucket.surfaced_values : [],
    surfaced_examples: Array.isArray(bucket.surfaced_examples) ? bucket.surfaced_examples : [],
    last_updated_day: Number(bucket.last_updated_day) || 0,
  };
}

/**
 * Build the [Cross-Session Memory in {context_name}] inject text per spec §5.2.
 *
 * @param {object} args
 * @param {object|null} args.summaryJsonb — userProfile.active_context_session_summary OR null
 * @param {number|null} args.category — active_context_category 1-5
 * @param {string|null} args.contextName — name OR category 短字 fallback
 * @returns {string|null} inject text OR null when empty (caller skips)
 */
export function buildActiveContextSummaryInject({ summaryJsonb, category, contextName } = {}) {
  const bucket = readCategoryBucket(summaryJsonb, category);
  if (!bucket) return null;
  if (bucket.surfaced_values.length === 0 && bucket.surfaced_examples.length === 0) {
    // Empty bucket (new context / 剛上線 / 舊學員未累積) — fallback to 「昨天素材」.
    return null;
  }

  // Derive context_name (caller-supplied OR fallback to category 短字).
  const name = (typeof contextName === 'string' && contextName.trim().length > 0)
    ? contextName.trim()
    : (CATEGORY_SHORT_LABELS[Number(category)] || '[active context]');

  // Truncate examples: keep most recent N by day (DESC), then re-sort ASC for display.
  const recentExamples = [...bucket.surfaced_examples]
    .filter(e => e && typeof e === 'object')
    .sort((a, b) => (Number(b.day) || 0) - (Number(a.day) || 0))
    .slice(0, MAX_EXAMPLES_PER_INJECT)
    .sort((a, b) => (Number(a.day) || 0) - (Number(b.day) || 0));

  // Format examples per spec §5.2: "  - Day {N}: {value} - "{example}""
  // Truncate single example to MAX_CHARS_PER_EXAMPLE.
  const exampleLines = recentExamples.map(e => {
    const day = Number(e.day) || 0;
    const val = (typeof e.value === 'string' && e.value.trim().length > 0)
      ? e.value.trim() : '(no value)';
    const exRaw = typeof e.example === 'string' ? e.example.trim() : '';
    const ex = exRaw.length > MAX_CHARS_PER_EXAMPLE
      ? exRaw.slice(0, MAX_CHARS_PER_EXAMPLE) + '…'
      : exRaw;
    return `  - Day ${day}: ${val} - "${ex}"`;
  });

  // De-dup values (defensive — runtime already dedups via SQL UNION).
  const uniqueValues = Array.from(new Set(
    bucket.surfaced_values
      .filter(v => typeof v === 'string' && v.trim().length > 0)
      .map(v => v.trim())
  ));
  const valuesListText = uniqueValues.length > 0
    ? uniqueValues.join('、')
    : '(none surfaced yet)';

  const examplesBody = exampleLines.length > 0
    ? exampleLines.join('\n')
    : '  (no specific examples surfaced yet)';

  // §5.2 verbatim template.
  return `[Cross-Session Memory in ${name}]
Surfaced values so far: ${valuesListText}
Surfaced examples so far:
${examplesBody}

Do not re-ask the same value or example again.
Build on what learner already surfaced.`;
}
