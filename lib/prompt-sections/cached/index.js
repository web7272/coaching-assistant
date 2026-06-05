// lib/prompt-sections/cached/index.js
// 4 cached prefix 段落、固定順序 1→2→3→4、breakpoint 在段落 4 結尾
// chat.js (P2) buildSystemPromptArray 直接用 CACHED_PREFIX_SECTIONS export
//
// v5.1 cached §3 replacement (2026-06-05):
//   fourSevenRouter (v5.0 4.7 中央路由器藍圖) → modeAwareRouterReference
//   (v5.1 6 mode 框架 + 雙向流動 + crisis orthogonal + (v5.2) forward compat).
//   Triggers cache invalidate once (Patrick 排程 跟 Step 10 simulation 一起 re-warm).

import damonCorePhilosophy from './damon-core-philosophy.js';
import fiveLayerUnwrap from './five-layer-unwrap.js';
import modeAwareRouterReference from './mode-aware-router-reference.js';
import activeReferenceStyles from './active-reference-styles.js';

/**
 * Ordered cached prefix sections.
 * Order MUST be stable (spec 04 §1 cache breakpoint design).
 * Last section (order=4) carries cache_breakpoint: true.
 */
export const CACHED_PREFIX_SECTIONS = Object.freeze([
  damonCorePhilosophy,
  fiveLayerUnwrap,
  modeAwareRouterReference,
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
  modeAwareRouterReference,
  activeReferenceStyles,
};
