// lib/prompt-sections/cached/index.js
// 4 cached prefix 段落、固定順序 1→2→3→4、breakpoint 在段落 4 結尾
// chat.js (P2) buildSystemPromptArray 直接用 CACHED_PREFIX_SECTIONS export

import damonCorePhilosophy from './damon-core-philosophy.js';
import fiveLayerUnwrap from './five-layer-unwrap.js';
import fourSevenRouter from './four-seven-router.js';
import activeReferenceStyles from './active-reference-styles.js';

/**
 * Ordered cached prefix sections.
 * Order MUST be stable (spec 04 §1 cache breakpoint design).
 * Last section (order=4) carries cache_breakpoint: true.
 */
export const CACHED_PREFIX_SECTIONS = Object.freeze([
  damonCorePhilosophy,
  fiveLayerUnwrap,
  fourSevenRouter,
  activeReferenceStyles,
]);

/**
 * Total estimated tokens for the full cached prefix (sum of section estimates).
 */
export const CACHED_PREFIX_TOKEN_ESTIMATE =
  CACHED_PREFIX_SECTIONS.reduce((sum, s) => sum + (s.token_estimate || 0), 0);

export {
  damonCorePhilosophy,
  fiveLayerUnwrap,
  fourSevenRouter,
  activeReferenceStyles,
};
