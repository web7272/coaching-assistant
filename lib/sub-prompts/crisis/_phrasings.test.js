// lib/sub-prompts/crisis/_phrasings.test.js
//
// ⭐ Architectural gate (Vivi 6/6, Patrick 6/6 task §二): walk every
//    production .js under lib/ and assert NONE of the deprecated crisis
//    wording fragments appears anywhere.
//
//    Pre-dedupe, 5 files had verbatim copies that diverged across 3
//    successive wording revisions. This test is the regression backstop:
//    any future edit that re-introduces the old wording fails CI.
//
// Source of truth: ./_phrasings.js (exported constants).
// Scope of scan : lib/**.js EXCLUDING *.test.js (tests legitimately
//                 quote deprecated wording in doesNotMatch / replacement
//                 assertions and in the snapshot lock for the canonical
//                 source-of-truth phrasings).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CRISIS_OUTPUT_PROHIBITIONS,
  HANDOFF_4_1_STANDARD_PHRASING,
  HANDOFF_4_2_CUMULATIVE_PHRASING,
  HANDOFF_4_3_HIGH_RISK_PHRASING,
  HANDOFF_4_3B_FREEZE_PHRASING,
  STEP_5_1_HOTLINE_1925,
  STEP_5_LIGHT_HOTLINE_1925,
  CRISIS_PHRASINGS,
} from './_phrasings.js';

// ─── Phrasings: verbatim snapshot locks ─────────────────────────────

test('🛑 6/6 dedupe: HANDOFF_4_1_STANDARD_PHRASING verbatim (Vivi 6/6 終審)', () => {
  assert.equal(HANDOFF_4_1_STANDARD_PHRASING, `我聽到了。

你說了這句話,我有聽進去——我想先停在這裡,不急著往下走。

如果你現在有立即的危險:在台灣,可以打 1925(安心專線、24 小時、免費)。
如果你不在台灣,請搜尋你所在地的緊急專線。`);
});

test('🛑 6/6 dedupe: HANDOFF_4_2_CUMULATIVE_PHRASING verbatim', () => {
  assert.equal(HANDOFF_4_2_CUMULATIVE_PHRASING, `我聽到了。

過去幾次,你提過類似的。
我想先停在這裡,不急著往下走。

如果你現在有立即的危險:在台灣,可以打 1925(安心專線、24 小時、免費)。
如果你不在台灣,請搜尋你所在地的緊急專線。

你需要的,是真正的諮商師 / 心理醫生長期陪伴——
不是 AI、不是 21 天 program。`);
});

test('🛑 6/6 dedupe: HANDOFF_4_3_HIGH_RISK_PHRASING verbatim', () => {
  assert.equal(HANDOFF_4_3_HIGH_RISK_PHRASING, `我聽到了。
你現在最需要的,是一個真人在你旁邊。

如果你現在有立即的危險:在台灣,可以打 1925(安心專線、24 小時、免費)。
如果你不在台灣,請搜尋你所在地的緊急專線。

你不需要『真的打算做什麼』才能打。就算只是現在很難受、撐不下去,打過去都可以。`);
});

test('🛑 6/6 dedupe: HANDOFF_4_3B_FREEZE_PHRASING unchanged', () => {
  assert.equal(HANDOFF_4_3B_FREEZE_PHRASING,
    '我看到你回來了。Vivi 知道你的狀況、她會直接聯絡你。');
});

test('🛑 6/6 dedupe: STEP_5_1_HOTLINE_1925 verbatim (NO 自殺防治專線)', () => {
  assert.equal(STEP_5_1_HOTLINE_1925, `另外,台灣有個地方可以接住你:
安心專線 1925(24 小時、免費)。
如果你不在台灣,請搜尋你所在地的緊急專線。`);
});

test('🛑 6/6 dedupe: STEP_5_LIGHT_HOTLINE_1925 verbatim', () => {
  assert.equal(STEP_5_LIGHT_HOTLINE_1925, `了解、謝謝你跟我說清楚。
順帶提一個地方:在台灣,安心專線 1925(24 小時、免費)。
如果你不在台灣,請搜尋你所在地的緊急專線。`);
});

test('🛑 6/6 dedupe: CRISIS_PHRASINGS bundle exposes all 6 keys', () => {
  assert.deepEqual(Object.keys(CRISIS_PHRASINGS).sort(), [
    'HANDOFF_4_1_STANDARD',
    'HANDOFF_4_2_CUMULATIVE',
    'HANDOFF_4_3B_FREEZE',
    'HANDOFF_4_3_HIGH_RISK',
    'STEP_5_1_HOTLINE_1925',
    'STEP_5_LIGHT_HOTLINE_1925',
  ]);
});

// ─── All-lib grep gate (Patrick 6/6 task §二) ───────────────────────

// Patterns that should NEVER appear in production .js (= the AI-facing
// wording that 6/6 revised). If any of these reappear, a future change
// regressed and CI fails.
const FORBIDDEN_FRAGMENTS = Object.freeze([
  '只是很重',                  // 4.3 high_risk / Step 5.1 OLD trailing
  '這句話很重',                // 4.1 standard OLD opener
  '請撥打 1925',               // OLD 1925 framing (no Taiwan localization)
  '真的要做什麼',              // OLD hedge → revised to 「真的打算做什麼」
  '自殺防治專線',              // OLD hotline name → revised to 「安心專線」
]);

// Affirmative pattern: every standard / cumulative / high_risk emission
// MUST carry the Taiwan-fallback line.
const NON_TAIWAN_FALLBACK = '如果你不在台灣,請搜尋你所在地的緊急專線';

function repoRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  // Walk up to repo root: lib/sub-prompts/crisis/_phrasings.test.js → ../../../
  return join(here, '..', '..', '..');
}

function walkJsFiles(rootDir, isExcluded) {
  const out = [];
  function recur(dir) {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (name === 'node_modules' || name === '.git') continue;
        recur(full);
      } else if (st.isFile() && name.endsWith('.js') && !isExcluded(full, name)) {
        out.push(full);
      }
    }
  }
  recur(rootDir);
  return out;
}

test('🛑 6/6 dedupe gate: NO deprecated wording fragment appears in production lib/**.js', () => {
  const libRoot = join(repoRoot(), 'lib');
  // Exclude test files (legitimately mention deprecated wording in
  // doesNotMatch assertions) and exclude this very test file.
  const files = walkJsFiles(libRoot, (_full, name) => name.endsWith('.test.js'));

  const hits = [];
  for (const file of files) {
    const content = readFileSync(file, 'utf8');
    for (const frag of FORBIDDEN_FRAGMENTS) {
      const idx = content.indexOf(frag);
      if (idx !== -1) {
        // Compute line number for diagnostic.
        const lineNum = content.slice(0, idx).split('\n').length;
        const relPath = file.split(sep + 'lib' + sep)[1];
        hits.push({ file: 'lib/' + relPath, line: lineNum, fragment: frag });
      }
    }
  }

  assert.equal(hits.length, 0,
    `Deprecated crisis-wording residuals found in production lib/ files:\n`
    + hits.map(h => `  ${h.file}:${h.line} contains 「${h.fragment}」`).join('\n')
    + `\n\nAll AI-facing crisis phrasings must import from lib/sub-prompts/crisis/_phrasings.js.`
    + `\nFix: edit _phrasings.js (single source of truth) — every consumer auto-updates.`);
});

test('🛑 6/6 dedupe gate: every Step 4 phrasing carries the non-Taiwan fallback line', () => {
  // Lock the localization safety net at the source-of-truth layer.
  const phrasings = [
    HANDOFF_4_1_STANDARD_PHRASING,
    HANDOFF_4_2_CUMULATIVE_PHRASING,
    HANDOFF_4_3_HIGH_RISK_PHRASING,
    STEP_5_1_HOTLINE_1925,
    STEP_5_LIGHT_HOTLINE_1925,
  ];
  for (const [i, p] of phrasings.entries()) {
    assert.ok(p.includes(NON_TAIWAN_FALLBACK),
      `Phrasing #${i} missing non-Taiwan fallback: ${JSON.stringify(NON_TAIWAN_FALLBACK)}`);
    assert.ok(p.includes('在台灣') || p.includes('台灣有個地方'),
      `Phrasing #${i} missing Taiwan framing`);
  }
  // freeze is intentionally exempt (different phrasing context — "Vivi 主動聯絡").
});

test('🛑 6/6 dedupe gate: NO 「自殺」 字眼 in AI-facing canonical phrasings (system regex is unaffected)', () => {
  // AI must not emit「自殺」; system-side detector regex (PASSIVE_STRONG /
  // ACTIVE_SI_EXPLICIT / TRAUMA in deep-signal-detector.js) intentionally
  // keeps 「自殺」 to MATCH student utterances — that's separate concern.
  for (const [key, val] of Object.entries(CRISIS_PHRASINGS)) {
    assert.doesNotMatch(val, /自殺/,
      `${key}: AI-facing phrasing must NOT contain 「自殺」`);
  }
});

// ─── 6/7 P0 safety: CRISIS_OUTPUT_PROHIBITIONS embedded in all 4 sites ─

test('🛑 6/7 P0: CRISIS_OUTPUT_PROHIBITIONS exported and well-formed', () => {
  assert.equal(typeof CRISIS_OUTPUT_PROHIBITIONS, 'string');
  // Anti-「自殺」 directive
  assert.match(CRISIS_OUTPUT_PROHIBITIONS, /AI 回應中絕不出現「自殺」二字/);
  // Anti-re-ask-SI directive
  assert.match(CRISIS_OUTPUT_PROHIBITIONS, /active SI 已 confirmed → 後續輪不再問 SI/);
  // Step 4 → Step 6 only (no looking back)
  assert.match(CRISIS_OUTPUT_PROHIBITIONS, /Step 4 1925 給完後 → 下一輪走 Step 6 landing reminder/);
});

test('🛑 6/7 P0: prohibitions embedded in getHandoffInject(high_risk) — Step 4', async () => {
  const { getHandoffInject } = await import('./handoff-three-options.js');
  const inject = getHandoffInject('high_risk');
  // Confirm the prohibitions block is present verbatim (single-source embed).
  assert.ok(inject.includes('AI 回應中絕不出現「自殺」二字'),
    'Step 4 high_risk inject must embed CRISIS_OUTPUT_PROHIBITIONS');
  assert.ok(inject.includes('後續輪不再問 SI'));
});

test('🛑 6/7 P0: prohibitions embedded in ALL Step 4 variants (uniform)', async () => {
  const { getHandoffInject } = await import('./handoff-three-options.js');
  for (const variant of ['standard', 'cumulative', 'high_risk', 'freeze']) {
    const inject = getHandoffInject(variant);
    assert.ok(inject.includes('AI 回應中絕不出現「自殺」二字'),
      `Step 4 ${variant} must embed prohibitions`);
  }
});

test('🛑 6/7 P0: prohibitions embedded in getReminderInject (Step 6 — A015 post-1925 turn)', async () => {
  const { getReminderInject } = await import('./landing-page-reminder.js');
  for (const v of ['A', 'B', 'C']) {
    const inject = getReminderInject(v);
    assert.ok(inject.includes('AI 回應中絕不出現「自殺」二字'),
      `Step 6 reminder variant ${v} must embed prohibitions (covers post-Step-4 turn)`);
    assert.ok(inject.includes('後續輪不再問 SI'));
  }
});

test('🛑 6/7 P0: prohibitions embedded in prompt_content_active_si_explicit (first-turn safety net)', async () => {
  const mod = await import('../../prompt-sections/conditional/engine-3/deep-signal-detector.js');
  const inj = mod.prompt_content_active_si_explicit;
  assert.ok(inj.includes('AI 回應中絕不出現「自殺」二字'),
    'active SI fast-path inject must embed prohibitions');
});

test('🛑 6/7 P0: prohibitions embedded in cached §3 mode-aware-router-reference Mode 6 Crisis section', async () => {
  const mod = await import('../../prompt-sections/cached/mode-aware-router-reference.js');
  assert.ok(mod.content.includes('AI 回應中絕不出現「自殺」二字'),
    'cached §3 Mode 6 Crisis section must embed prohibitions (visible on every turn)');
});
