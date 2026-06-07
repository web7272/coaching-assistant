// lib/util/crisis-output-scrubber.js
//
// Defense 2 (Vivi 6/7 P0 safety, A016 production smoke):
// deterministic output scrubber for assistant text emitted during crisis-mode
// turns. Pure prompt rules can lower the probability of LLM emitting 「自殺」
// but cannot guarantee zero — crisis safety can't bet on probability.
//
// Background: production smoke caught AI improvising「謝謝你告訴我你還在。
// 你說『想自殺』—— 現在這個當下,你有在想傷害自己嗎?」 after Step 4 1925
// inject. The「想自殺」 quoted echo was never in any inject (3a727d5 grep
// gate confirmed); it was the LLM's free generation. This module is the
// last-line backstop.
//
// Behavior (Vivi 6/7 spec verbatim):
//   - Gated on `inCrisis` (any of crisis_in_progress / primary_mode==='crisis'
//     / active_modes includes 'crisis' / sopState in-flight). NOT applied to
//     non-crisis turns — would over-touch normal copy.
//   - Only touches assistant text. Student messages, system injects, and
//     detector regex are untouched.
//   - Targeted in-place replacement (not full regeneration) — crisis can't
//     afford added latency or losing the 1925 line.
//   - Logs structured event { event, scrubbed: count } when any replacement
//     fires. 鐵律 #2: no raw text logged.

// ─── Replacement patterns ────────────────────────────────────────────
//
// Patterns are applied in MOST-SPECIFIC-FIRST order so quoted forms get
// grammar-preserving substitutions before bare-word fallback.
//
//   1. Quoted student verb     「想自殺」 / 『想自殺』  → 的這件事
//      (Vivi 6/7 example:「你說『想自殺』」 → 「你說的這件事」)
//   2. Quoted bare word        「自殺」 / 『自殺』      → 這件事
//   3. Bare verb               想自殺                    → 想做的這件事
//   4. Bare word (fallback)    自殺                      → 這件事
//
// All replacements are deterministic; no LLM-driven rewriting. Awkward
// grammar after replacement is acceptable — safety > prose quality.

const REPLACEMENT_PATTERNS = Object.freeze([
  { pattern: /「想自殺」/g, replacement: '的這件事' },
  { pattern: /『想自殺』/g, replacement: '的這件事' },
  { pattern: /「自殺」/g,   replacement: '這件事'   },
  { pattern: /『自殺』/g,   replacement: '這件事'   },
  { pattern: /想自殺/g,     replacement: '想做的這件事' },
  { pattern: /自殺/g,       replacement: '這件事' },
]);

/**
 * @param {object} state
 * @returns {boolean}
 */
export function isInCrisisState(state) {
  if (!state || typeof state !== 'object') return false;
  if (state.crisis_in_progress === true) return true;
  if (state.primary_mode === 'crisis') return true;
  if (Array.isArray(state.active_modes) && state.active_modes.includes('crisis')) return true;
  // belt-and-suspenders — sopState in-flight even if flags missing.
  if (state.crisis_sop_state != null
      && typeof state.crisis_sop_state === 'object'
      && state.crisis_sop_complete !== true) {
    return true;
  }
  return false;
}

/**
 * Scrub the「自殺」 word from assistant output during crisis turns.
 *
 * @param {string} text - assistant message text (response.content[0].text)
 * @param {object} [opts]
 * @param {boolean} [opts.inCrisis] - explicit gate; when false (or omitted)
 *                                    the scrubber is a no-op.
 * @returns {{cleaned: string, scrubbed: number}}
 *   cleaned  — text with all matched patterns replaced.
 *   scrubbed — total count of replacements applied across all patterns.
 */
export function scrubCrisisAssistantOutput(text, { inCrisis = false } = {}) {
  if (typeof text !== 'string') return { cleaned: '', scrubbed: 0 };
  if (!inCrisis) return { cleaned: text, scrubbed: 0 };
  if (!text.includes('自殺')) return { cleaned: text, scrubbed: 0 };

  let cleaned = text;
  let scrubbed = 0;
  for (const { pattern, replacement } of REPLACEMENT_PATTERNS) {
    cleaned = cleaned.replace(pattern, () => {
      scrubbed += 1;
      return replacement;
    });
  }
  return { cleaned, scrubbed };
}
