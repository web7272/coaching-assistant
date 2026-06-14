// api/finalize-day.test.js
// PR-4c v5 day-numbering pure helpers (the handler itself is I/O orchestration).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveSessionDay,
  weekFromSessionDay,
  isGraduationDay,
  extractKeyPhrase,
  extractTakeawayAnchor,
  buildExportPersonalCoachPrompt,
  buildGraduationSystemPrompt,
  parseGraduationResponse,
  computeScJourneyStep,            // v5.2 七步 PR-4 Path B
  writeScJourneyStepFailSoft,      // v5.2 七步 PR-4 Path B
  writeBrainStateFailSoft,         // v5.3 件3 PR-J2
  writeSovereignActionFailSoft,    // v5.3 件3 PR-J3
  FINALIZE_MAX_DURATION_SECONDS,    // 6/13 A022 fix
  config as finalizeConfig,         // 6/13 A022 fix
} from './finalize-day.js';

// ─────────────────────────────────────────────────────────
// resolveSessionDay — PR-4c shape (preferred) + legacy week+day fallback
// ─────────────────────────────────────────────────────────

test('resolveSessionDay: PR-4c sessionDay (number) → returned as-is', () => {
  assert.equal(resolveSessionDay({ sessionDay: 1 }), 1);
  assert.equal(resolveSessionDay({ sessionDay: 7 }), 7);
  assert.equal(resolveSessionDay({ sessionDay: 21 }), 21);
});

test('resolveSessionDay: legacy week+day → (week-1)*7 + day (v5 7-day mapping)', () => {
  assert.equal(resolveSessionDay({ week: 1, day: 1 }), 1);
  assert.equal(resolveSessionDay({ week: 1, day: 7 }), 7);
  assert.equal(resolveSessionDay({ week: 2, day: 1 }), 8);
  assert.equal(resolveSessionDay({ week: 3, day: 7 }), 21);
});

test('resolveSessionDay: legacy strings → parseInt coercion', () => {
  assert.equal(resolveSessionDay({ week: '2', day: '3' }), 10);
});

test('resolveSessionDay: sessionDay wins over legacy when both present', () => {
  assert.equal(resolveSessionDay({ sessionDay: 14, week: 1, day: 1 }), 14);
});

test('resolveSessionDay: floors fractional sessionDay defensively', () => {
  assert.equal(resolveSessionDay({ sessionDay: 7.9 }), 7);
});

test('resolveSessionDay: missing both / invalid → null', () => {
  assert.equal(resolveSessionDay({}), null);
  assert.equal(resolveSessionDay(null), null);
  assert.equal(resolveSessionDay({ sessionDay: 0 }), null);
  assert.equal(resolveSessionDay({ sessionDay: -1 }), null);
  assert.equal(resolveSessionDay({ week: 'x', day: 'y' }), null);
  assert.equal(resolveSessionDay({ week: 0, day: 1 }), null);
});

// ─────────────────────────────────────────────────────────
// weekFromSessionDay — ceil(day/7)
// ─────────────────────────────────────────────────────────

test('weekFromSessionDay: day → week (3 weeks × 7 days)', () => {
  // Week 1
  for (let d = 1; d <= 7; d++) assert.equal(weekFromSessionDay(d), 1, `day ${d}`);
  // Week 2
  for (let d = 8; d <= 14; d++) assert.equal(weekFromSessionDay(d), 2, `day ${d}`);
  // Week 3
  for (let d = 15; d <= 21; d++) assert.equal(weekFromSessionDay(d), 3, `day ${d}`);
});

// ─────────────────────────────────────────────────────────
// isGraduationDay — only day 21
// (isWeekBoundary tests retired with 週報 — PR-4c-green 5/24 cleanup)
// ─────────────────────────────────────────────────────────

test('isGraduationDay: true only at day 21', () => {
  assert.equal(isGraduationDay(21), true);
  for (const d of [1, 7, 14, 20, 22]) {
    assert.equal(isGraduationDay(d), false, `day ${d} should not be graduation`);
  }
});

// ─────────────────────────────────────────────────────────
// PR-4c-2: extractKeyPhrase — daily_takeaways term source from Damon Note 【關鍵句】
// ─────────────────────────────────────────────────────────

test('extractKeyPhrase: pulls 【關鍵句】 and strips CJK + ASCII quotes', () => {
  const note = `【今天的模式】\n學員今天反覆出現「可以決定」。\n\n【關鍵句】\n「可以決定」\n\n【深度層次】\n...`;
  assert.equal(extractKeyPhrase(note), '可以決定');
});

test('extractKeyPhrase: multi-line 【關鍵句】 → first non-empty line only', () => {
  const note = `【關鍵句】\n\n  我不能停。\n  （這句反覆出現）\n\n【深度層次】\n...`;
  assert.equal(extractKeyPhrase(note), '我不能停。');
});

test('extractKeyPhrase: ASCII / fullwidth quotes both stripped', () => {
  assert.equal(extractKeyPhrase(`【關鍵句】\n"是繼承的"\n\n【x】`), '是繼承的');
  assert.equal(extractKeyPhrase(`【關鍵句】\n『被看見』\n\n【x】`), '被看見');
});

test('extractKeyPhrase: no 【關鍵句】 section → null', () => {
  assert.equal(extractKeyPhrase(`【今天的模式】\n...\n\n【深度層次】\n...`), null);
});

test('extractKeyPhrase: empty section → null (not empty string)', () => {
  assert.equal(extractKeyPhrase(`【關鍵句】\n\n【深度層次】\n...`), null);
});

test('extractKeyPhrase: non-string input → null', () => {
  assert.equal(extractKeyPhrase(null), null);
  assert.equal(extractKeyPhrase(undefined), null);
  assert.equal(extractKeyPhrase(42), null);
});

// ─────────────────────────────────────────────────────────
// PR-4c-4d B2: extractTakeawayAnchor — short anchor for 21-poem + cell display
// ─────────────────────────────────────────────────────────

test('🛑 extractTakeawayAnchor: short keyphrase passes through unchanged', () => {
  const note = `【關鍵句】\n可以決定\n\n【其他】`;
  assert.equal(extractTakeawayAnchor(note), '可以決定');
});

test('🛑 extractTakeawayAnchor: long sentence → first chunk before sentence punctuation', () => {
  const note = `【關鍵句】\n我可以決定我自己的生活、不需要等別人同意。\n\n【其他】`;
  // splits at first 、 or 。
  assert.equal(extractTakeawayAnchor(note), '我可以決定我自己的生活');
  // …and result is capped at 12 chars (above is 11 chars, still cap-safe)
});

// PR-4c-green E4 fix (Patrick 5/24): replaced the prior 「hard-cap at 12 chars」 test.
// Old behavior produced garbled mid-word cutoffs (A001 D1 stored
//「感覺追求金錢豐盛沒有比追」). New rule: no natural boundary within 12 chars →
// return null; caller falls back to extractKeyPhrase + CSS text-overflow.
test('🛑 extractTakeawayAnchor: very long unbroken text → null (no garbled cutoff)', () => {
  const note = `【關鍵句】\n這個非常非常非常非常非常非常非常長的話沒有句點\n\n【其他】`;
  assert.equal(extractTakeawayAnchor(note), null,
    'no natural boundary ≤12 chars → return null, never a slice(0,12) garble');
});

test('🛑 extractTakeawayAnchor: A001 D1 actual garble case → null', () => {
  // The exact string the A001 D1 Damon Note shipped — "感覺追求金錢豐盛沒有比追…"
  // had no comma / 、 / 。 within 12 chars and was previously stored garbled.
  const note = `【關鍵句】\n感覺追求金錢豐盛沒有比追求真實的自己更重要\n\n【其他】`;
  assert.equal(extractTakeawayAnchor(note), null,
    'A001 5/23 regression — must not store mid-word cutoff anymore');
});

test('extractTakeawayAnchor: strips quotes — fullwidth + ASCII', () => {
  assert.equal(extractTakeawayAnchor(`【關鍵句】\n「被看見」\n\n【x】`), '被看見');
  assert.equal(extractTakeawayAnchor(`【關鍵句】\n"是繼承的"\n\n【x】`), '是繼承的');
});

test('extractTakeawayAnchor: no 【關鍵句】 section → null', () => {
  assert.equal(extractTakeawayAnchor(`【深度層次】\nLayer 3`), null);
});

test('extractTakeawayAnchor: empty 【關鍵句】 → null', () => {
  assert.equal(extractTakeawayAnchor(`【關鍵句】\n\n【x】`), null);
});

test('extractTakeawayAnchor: non-string → null', () => {
  assert.equal(extractTakeawayAnchor(null), null);
  assert.equal(extractTakeawayAnchor(42), null);
});

// ─────────────────────────────────────────────────────────
// PR-4c-2: buildExportPersonalCoachPrompt — Day 21 Markdown template
// ─────────────────────────────────────────────────────────

test('buildExportPersonalCoachPrompt: 3 sections + dynamic substitutions land', () => {
  const md = buildExportPersonalCoachPrompt({
    studentId: 'A001',
    top1_value: '可以決定',
    anchors: ['踏實的', '善良的', '勇敢的'],
    values_ranking: [{ value: '可以決定' }, { value: '被看見' }, { value: '真實的' }],
  });
  assert.match(md, /A001 的個人 Identity Coach Prompt/);
  assert.match(md, /Top 1 quality 是「可以決定」/);
  assert.match(md, /「踏實的」/);
  assert.match(md, /「善良的」/);
  assert.match(md, /「勇敢的」/);
  assert.match(md, /1\. 可以決定（核心）/);
  assert.match(md, /## 第二段：對 AI 教練的引導風格指引/);
  assert.match(md, /## 第三段：使用說明/);
});

test('🛑 buildExportPersonalCoachPrompt: 紅線 1 — template must NOT instruct AI to ask 為什麼', () => {
  const md = buildExportPersonalCoachPrompt({
    studentId: 'A001', top1_value: 'x', anchors: ['y'], values_ranking: [{ value: 'z' }],
  });
  assert.doesNotMatch(md, /為什麼/,
    'export template instructs the external LLM — must not direct it to ask 為什麼');
});

test('buildExportPersonalCoachPrompt: empty anchors / ranking → graceful fallback strings', () => {
  const md = buildExportPersonalCoachPrompt({ studentId: 'A001' });
  assert.match(md, /Top 1 quality 是「（你的 Top 1 quality、尚未確定）」/);
  assert.match(md, /尚無 owned anchor/);
  assert.match(md, /尚未排序/);
});

test('buildExportPersonalCoachPrompt: accepts string anchors and string ranking entries', () => {
  const md = buildExportPersonalCoachPrompt({
    studentId: 'A001', top1_value: '勇敢', anchors: ['踏實的', '善良的'], values_ranking: ['勇敢', '善良'],
  });
  assert.match(md, /「踏實的」/);
  assert.match(md, /1\. 勇敢（核心）/);
});

// ─────────────────────────────────────────────────────────
// PR-4c-2: buildGraduationSystemPrompt — Day 21 Sonnet system prompt
// ─────────────────────────────────────────────────────────

test('buildGraduationSystemPrompt: 21-day poem materialised + JSON schema demanded', () => {
  const sys = buildGraduationSystemPrompt('self', [
    { day: 1, term: '可以決定' }, { day: 2, term: '是繼承的' }, { day: 21, term: '我是誰' },
  ]);
  assert.match(sys, /\[Day 1\] 可以決定/);
  assert.match(sys, /\[Day 2\] 是繼承的/);
  assert.match(sys, /\[Day 21\] 我是誰/);
  assert.match(sys, /"coach_letter"/);
  assert.match(sys, /"declaration"/);
  assert.match(sys, /嚴格的 JSON/);
});

test('🛑 buildGraduationSystemPrompt: 紅線 1 — system must instruct「不問為什麼」', () => {
  const sys = buildGraduationSystemPrompt('self', []);
  assert.match(sys, /不問「為什麼」/);
});

test('buildGraduationSystemPrompt: sorts takeaways by day even if input out-of-order', () => {
  const sys = buildGraduationSystemPrompt('self', [
    { day: 3, term: 'c' }, { day: 1, term: 'a' }, { day: 2, term: 'b' },
  ]);
  const idx_a = sys.indexOf('[Day 1] a');
  const idx_b = sys.indexOf('[Day 2] b');
  const idx_c = sys.indexOf('[Day 3] c');
  assert.ok(idx_a > 0 && idx_a < idx_b && idx_b < idx_c, 'poem must be day-ascending');
});

test('buildGraduationSystemPrompt: empty takeaways → fallback line', () => {
  const sys = buildGraduationSystemPrompt('self', []);
  assert.match(sys, /尚未累積/);
});

// ─────────────────────────────────────────────────────────
// PR-4c-2: parseGraduationResponse — Sonnet JSON output parsing
// ─────────────────────────────────────────────────────────

test('parseGraduationResponse: clean JSON object → parsed', () => {
  const out = parseGraduationResponse(JSON.stringify({
    coach_letter: '見證信內容...', declaration: '我是一個可以決定的人。',
  }));
  assert.equal(out.coach_letter, '見證信內容...');
  assert.equal(out.declaration, '我是一個可以決定的人。');
});

test('parseGraduationResponse: markdown-fenced JSON → still parsed', () => {
  const raw = '```json\n' + JSON.stringify({
    coach_letter: '...', declaration: '我是 X 的人。',
  }) + '\n```';
  const out = parseGraduationResponse(raw);
  assert.ok(out);
  assert.equal(out.declaration, '我是 X 的人。');
});

test('parseGraduationResponse: extra prose around the object → extracts inner braces', () => {
  const raw = `Here is the JSON you requested:\n${JSON.stringify({
    coach_letter: 'X', declaration: 'Y',
  })}\nThanks!`;
  const out = parseGraduationResponse(raw);
  assert.equal(out.coach_letter, 'X');
  assert.equal(out.declaration, 'Y');
});

test('parseGraduationResponse: missing required key → null', () => {
  assert.equal(parseGraduationResponse('{"coach_letter":"x"}'), null);
  assert.equal(parseGraduationResponse('{"declaration":"y"}'), null);
  assert.equal(parseGraduationResponse('{"coach_letter":"","declaration":"y"}'), null);
});

test('parseGraduationResponse: not-JSON / empty → null', () => {
  assert.equal(parseGraduationResponse(''), null);
  assert.equal(parseGraduationResponse('not json at all'), null);
  assert.equal(parseGraduationResponse('{'), null);
  assert.equal(parseGraduationResponse(null), null);
});

// ═══════════════════════════════════════════════════════════════
// ⭐ 6/7 Vivi — day1_completed_at write-if-null at finalize-day handler.
// ═══════════════════════════════════════════════════════════════
//
// Spec (Patrick 6/7):
//   - day === 1 finalize → UPDATE students SET day1_completed_at = NOW()
//                          WHERE student_id = $sid AND day1_completed_at IS NULL
//   - day === 1 re-finalize → alreadyDone early-return; write block unreached
//     (combined with the IS NULL guard = double protection)
//   - day ≥ 2 finalize → write block guarded by `if (day === 1)` → untouched
//
// Note: full handler round-trip would require mocking guardStudentOr401 +
// generateDamonNote + several state-manager helpers. We use static analysis
// of the source to lock the SQL contract + branch structure — same pattern
// established for lib/landing/, lib/auth-html/ sync-gates.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __finalizeDayDir = dirname(fileURLToPath(import.meta.url));
const finalizeDaySrc = readFileSync(
  join(__finalizeDayDir, 'finalize-day.js'),
  'utf8',
);

test('🛑 6/7 finalize-day day1_completed_at: SQL contract = write-if-null on students', () => {
  // Locks the production tagged-template shape:
  //   UPDATE students
  //      SET day1_completed_at = NOW()
  //    WHERE student_id = ${...}
  //      AND day1_completed_at IS NULL
  assert.match(finalizeDaySrc,
    /UPDATE students\s*\n\s*SET day1_completed_at\s*=\s*NOW\(\)\s*\n\s*WHERE student_id\s*=\s*\$\{[^}]+\}\s*\n\s*AND day1_completed_at IS NULL/,
    'write-if-null SQL contract must match Patrick 6/7 spec verbatim');
});

test('🛑 6/7 finalize-day: day1 write guarded by `if (day === 1)` (day ≥ 2 untouched)', () => {
  // Day 2 through Day 21 finalize must NOT touch day1_completed_at.
  // The only safeguard at the handler level is this `if (day === 1)` wrapper.
  assert.match(finalizeDaySrc,
    /if\s*\(\s*day\s*===\s*1\s*\)\s*\{[\s\S]{0,500}day1_completed_at\s*=\s*NOW\(\)/,
    'day1_completed_at write must be inside `if (day === 1)` guard');
});

test('🛑 6/7 finalize-day: day1 write is fail-soft (try/catch wraps + structured warn log)', () => {
  // Spec: 寫失敗不擋 finalize (UX 不能因為 metadata 寫不進去就讓 Day 1 結業流程當掉).
  assert.match(finalizeDaySrc,
    /try\s*\{[\s\S]{0,500}day1_completed_at\s*=\s*NOW\(\)[\s\S]{0,500}\}\s*catch\s*\([^)]*\)\s*\{[\s\S]{0,500}console\.warn[\s\S]{0,200}day1_completed_at-write-failed/,
    'day1_completed_at write must be wrapped in try/catch with structured warn log');
});

test('🛑 6/7 finalize-day: day1 write happens AFTER day_complete UPDATE (lifecycle order)', () => {
  const dayCompleteIdx = finalizeDaySrc.indexOf('SET day_complete = TRUE');
  const day1WriteIdx   = finalizeDaySrc.indexOf('day1_completed_at = NOW()');
  assert.ok(dayCompleteIdx > 0, 'day_complete UPDATE must exist');
  assert.ok(day1WriteIdx > 0,   'day1_completed_at UPDATE must exist');
  assert.ok(day1WriteIdx > dayCompleteIdx,
    'day1_completed_at write must come AFTER day_complete=TRUE (correct lifecycle order)');
});

test('🛑 6/7 finalize-day: day1 write is AFTER alreadyDone early-return (re-finalize = no-op)', () => {
  // Re-finalize of an already-done Day 1 session early-returns BEFORE the
  // write block. Combined with `WHERE day1_completed_at IS NULL` → double
  // protection; first-finalize timestamp is preserved.
  const earlyReturnIdx = finalizeDaySrc.indexOf('alreadyDone: true');
  const day1WriteIdx   = finalizeDaySrc.indexOf('day1_completed_at = NOW()');
  assert.ok(earlyReturnIdx > 0, 'alreadyDone early-return must exist');
  assert.ok(day1WriteIdx > 0,   'day1_completed_at write must exist');
  assert.ok(day1WriteIdx > earlyReturnIdx,
    'day1_completed_at write must be AFTER alreadyDone early-return');
});

test('🛑 6/7 finalize-day: _setSqlClient seam exported (enables future mock-based handler tests)', () => {
  // Locks the seam shape for any future test that wants full handler round-trip
  // (would also need to mock guardStudentOr401 + generateDamonNote downstream).
  assert.match(finalizeDaySrc, /export function _setSqlClient\s*\(/);
});

// ═══════════════════════════════════════════════════════════════
// 🛑 6/7 Vivi — notebook 「我看見的」 sharp / gentle wiring (finalize-day).
// ═══════════════════════════════════════════════════════════════

test('🛑 6/7 finalize-day: imports sessionTouchedCrisis from lib/api/crisis-session-flag.js', () => {
  assert.match(finalizeDaySrc,
    /import \{ sessionTouchedCrisis \} from ['"]\.\.\/lib\/api\/crisis-session-flag\.js['"]/);
});

test('🛑 6/7 finalize-day: derives wasCrisis from this session_state', () => {
  // existing.session_state was already SELECTed at L335 (verify still there).
  assert.match(finalizeDaySrc, /SELECT[^;]*session_state/);
  // The flag is computed from existing.session_state — the row we just SELECTed.
  assert.match(finalizeDaySrc,
    /const wasCrisis = sessionTouchedCrisis\(\s*existing\.session_state\s*\)/);
});

test('🛑 6/7 finalize-day: passes wasCrisis through to generateDamonNote', () => {
  // The notebook-page sharp/gentle register lives downstream; this is the
  // bridge from finalize-day → chat.js generateDamonNote → generateNotebookPage.
  assert.match(finalizeDaySrc,
    /generateDamonNote\(sql, sessionId, module, week, day, wasCrisis\)/);
});

// ═════════════════════════════════════════════════════════════════
// 🛑 v5.2 七步 PR-4 Path B — computeScJourneyStep (pure)
// Patrick 6/11: max(current, max{N : evidence[step_N] non-empty}).
// hold (never drop) + promote-only.
// ═════════════════════════════════════════════════════════════════

// ─── Promote ─────────────────────────────────────────────────────

test('🛑 PR-4 Path B compute: promote — current=2, evidence step_5 → 5', () => {
  const evidence = {
    step_1: [], step_2: [], step_3: [], step_4: [],
    step_5: [{ type: 'resource_retrieval', quote: 'x' }],
    step_6: [], step_7: [],
  };
  assert.equal(computeScJourneyStep(2, evidence), 5);
});

test('🛑 PR-4 Path B compute: promote from null current → max evidenced', () => {
  const evidence = {
    step_1: [], step_2: [], step_3: [{ type: 'data_mining', quote: 'x' }],
    step_4: [], step_5: [], step_6: [], step_7: [],
  };
  assert.equal(computeScJourneyStep(null, evidence), 3);
});

test('🛑 PR-4 Path B compute: promote picks HIGHEST non-empty step (not first found)', () => {
  // Multiple non-empty steps — must pick max, not min/first.
  const evidence = {
    step_1: [{ type: 'pain_surface', quote: 'a' }],
    step_2: [{ type: 'longing_surface', quote: 'b' }],
    step_3: [{ type: 'data_mining', quote: 'c' }],
    step_4: [], step_5: [], step_6: [], step_7: [],
  };
  assert.equal(computeScJourneyStep(null, evidence), 3);
});

// ─── Hold (never drop) ───────────────────────────────────────────

test('🛑 PR-4 Path B compute: HOLD — current=5, evidence only step_1 → 5 (NEVER drop)', () => {
  // Patrick: hold-and-promote-only. Even if current > max evidenced step,
  // never降. (合法降 logic deferred post-sim review.)
  const evidence = {
    step_1: [{ type: 'pain_surface', quote: 'a' }],
    step_2: [], step_3: [], step_4: [], step_5: [], step_6: [], step_7: [],
  };
  assert.equal(computeScJourneyStep(5, evidence), 5, 'must HOLD at 5, NOT drop to 1');
});

test('🛑 PR-4 Path B compute: HOLD — current=7, no evidence at all → 7', () => {
  assert.equal(computeScJourneyStep(7, {}), 7);
  assert.equal(computeScJourneyStep(7, null), 7);
});

// ─── No-op (same value) ──────────────────────────────────────────

test('🛑 PR-4 Path B compute: no-change — current=4 + max evidenced=4 → 4', () => {
  const evidence = {
    step_1: [], step_2: [], step_3: [],
    step_4: [{ type: 'identity_claim', quote: 'x' }],
    step_5: [], step_6: [], step_7: [],
  };
  assert.equal(computeScJourneyStep(4, evidence), 4);
});

// ─── Both empty / null ───────────────────────────────────────────

test('🛑 PR-4 Path B compute: both null/empty → null (don\'t write 1)', () => {
  assert.equal(computeScJourneyStep(null, null), null);
  assert.equal(computeScJourneyStep(null, {}), null);
  const allEmpty = {
    step_1: [], step_2: [], step_3: [], step_4: [], step_5: [], step_6: [], step_7: [],
  };
  assert.equal(computeScJourneyStep(null, allEmpty), null);
});

// ─── Boundary ────────────────────────────────────────────────────

test('🛑 PR-4 Path B compute: boundary current=7 + step_7 evidence → 7', () => {
  const evidence = {
    step_1: [], step_2: [], step_3: [], step_4: [], step_5: [], step_6: [],
    step_7: [{ type: 'anchoring', quote: 'x' }],
  };
  assert.equal(computeScJourneyStep(7, evidence), 7);
});

// ─── Defensive: invalid inputs ───────────────────────────────────

test('🛑 PR-4 Path B compute: invalid current types → treated as null', () => {
  const evidence = {
    step_1: [], step_2: [], step_3: [{ type: 'x', quote: 'x' }],
    step_4: [], step_5: [], step_6: [], step_7: [],
  };
  assert.equal(computeScJourneyStep(0, evidence), 3,    'step 0 invalid → null');
  assert.equal(computeScJourneyStep(8, evidence), 3,    'step 8 out-of-range → null');
  assert.equal(computeScJourneyStep('5', evidence), 3,  'string not Number.isInteger → null');
  assert.equal(computeScJourneyStep(2.5, evidence), 3,  'fractional → null');
});

test('🛑 PR-4 Path B compute: malformed evidence (array / wrong shape) → treated as empty', () => {
  // Defensive — column should always be keyed object per migration 037, but
  // function tolerates legacy NULL / wrong shape from older rows.
  assert.equal(computeScJourneyStep(5, []),         5, 'array → empty');
  assert.equal(computeScJourneyStep(5, 'a string'), 5, 'string → empty');
  assert.equal(computeScJourneyStep(5, 42),         5, 'number → empty');
  // Object with missing keys → walk what exists.
  assert.equal(computeScJourneyStep(2, { step_5: [{ x: 1 }] }), 5,
    'partial keyed object: only step_5 present → 5');
});

// ═════════════════════════════════════════════════════════════════
// 🛑 v5.2 七步 PR-4 Path B — writeScJourneyStepFailSoft (mocked SQL)
// ═════════════════════════════════════════════════════════════════

// Helper: mock sql tag that records calls and lets test plan return values.
function mkScSql(planFn) {
  const calls = [];
  const fn = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    return Promise.resolve(planFn ? planFn(text, calls.length - 1) : []);
  };
  fn.calls = calls;
  return fn;
}

test('🛑 PR-4 Path B writeFailSoft: happy promote — SELECT then UPDATE with new step', async () => {
  const sql = mkScSql((text) => {
    if (/^\s*SELECT sc_journey_step/.test(text)) {
      return [{
        sc_journey_step: 2,
        sc_journey_evidence: {
          step_1: [], step_2: [], step_3: [], step_4: [],
          step_5: [{ type: 'resource_retrieval', quote: '某 term' }],
          step_6: [], step_7: [],
        },
      }];
    }
    return [];
  });
  const r = await writeScJourneyStepFailSoft(sql, 'A001');
  assert.equal(r.ok, true);
  assert.equal(r.prev, 2);
  assert.equal(r.next, 5);
  assert.equal(sql.calls.length, 2, 'SELECT then UPDATE');
  assert.match(sql.calls[1].text, /UPDATE students/);
  assert.match(sql.calls[1].text, /sc_journey_step =/);
});

test('🛑 PR-4 Path B writeFailSoft: hold case — current=5, evidence step_1 only → NO UPDATE', async () => {
  const sql = mkScSql((text) => {
    if (/SELECT sc_journey_step/.test(text)) {
      return [{
        sc_journey_step: 5,
        sc_journey_evidence: {
          step_1: [{ type: 'pain_surface', quote: 'x' }],
          step_2: [], step_3: [], step_4: [], step_5: [], step_6: [], step_7: [],
        },
      }];
    }
    return [];
  });
  const r = await writeScJourneyStepFailSoft(sql, 'A001');
  assert.equal(r.ok, true);
  assert.equal(r.prev, 5);
  assert.equal(r.next, 5, 'computed step equals current → no promotion');
  assert.equal(sql.calls.length, 1, 'NO UPDATE fired when next === prev');
});

test('🛑 PR-4 Path B writeFailSoft: no-change — current=4, evidence step_4 → NO UPDATE', async () => {
  const sql = mkScSql((text) => {
    if (/SELECT sc_journey_step/.test(text)) {
      return [{
        sc_journey_step: 4,
        sc_journey_evidence: {
          step_1: [], step_2: [], step_3: [],
          step_4: [{ type: 'identity_claim', quote: '勇敢' }],
          step_5: [], step_6: [], step_7: [],
        },
      }];
    }
    return [];
  });
  const r = await writeScJourneyStepFailSoft(sql, 'A001');
  assert.equal(r.ok, true);
  assert.equal(r.prev, 4);
  assert.equal(r.next, 4);
  assert.equal(sql.calls.length, 1);
});

test('🛑 PR-4 Path B writeFailSoft: student not found → ok:true, no UPDATE', async () => {
  const sql = mkScSql(() => []);   // empty SELECT
  const r = await writeScJourneyStepFailSoft(sql, 'A999');
  assert.equal(r.ok, true);
  assert.equal(r.prev, null);
  assert.equal(r.next, null);
  assert.equal(r.reason, 'student_not_found');
  assert.equal(sql.calls.length, 1, 'no UPDATE when row missing');
});

test('🛑 PR-4 Path B writeFailSoft: SELECT throws → fail-soft (no rethrow), ok:false + console.warn', async () => {
  const sql = () => Promise.reject(new Error('db connection lost'));
  // Capture console.warn to verify the fail-soft log fires.
  const origWarn = console.warn;
  const warned = [];
  console.warn = (...args) => { warned.push(args.join(' ')); };
  try {
    const r = await writeScJourneyStepFailSoft(sql, 'A001');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'sql_error');
  } finally {
    console.warn = origWarn;
  }
  assert.ok(warned.some(w => /sc_journey_step-write-failed/.test(w)),
    'fail-soft must log warning with sc_journey_step-write-failed tag');
});

test('🛑 PR-4 Path B writeFailSoft: UPDATE throws → fail-soft (no rethrow)', async () => {
  let callIdx = 0;
  const sql = (strings) => {
    const text = strings.join('?');
    if (callIdx++ === 0 && /SELECT sc_journey_step/.test(text)) {
      // SELECT succeeds with promote-worthy state.
      return Promise.resolve([{
        sc_journey_step: 1,
        sc_journey_evidence: {
          step_1: [], step_2: [], step_3: [], step_4: [],
          step_5: [{ type: 'resource_retrieval', quote: 'x' }],
          step_6: [], step_7: [],
        },
      }]);
    }
    // UPDATE phase: throw.
    return Promise.reject(new Error('disk full'));
  };
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const r = await writeScJourneyStepFailSoft(sql, 'A001');
    assert.equal(r.ok, false, 'UPDATE failure → ok:false');
    assert.equal(r.reason, 'sql_error');
  } finally {
    console.warn = origWarn;
  }
});

test('🛑 PR-4 Path B writeFailSoft: NULL current step + evidence → promotes from null', async () => {
  // Legacy student (sc_journey_step never set) + first session producing evidence.
  const sql = mkScSql((text) => {
    if (/SELECT sc_journey_step/.test(text)) {
      return [{
        sc_journey_step: null,
        sc_journey_evidence: {
          step_1: [], step_2: [],
          step_3: [{ type: 'data_mining', quote: 'x' }],
          step_4: [], step_5: [], step_6: [], step_7: [],
        },
      }];
    }
    return [];
  });
  const r = await writeScJourneyStepFailSoft(sql, 'A001');
  assert.equal(r.ok, true);
  assert.equal(r.prev, null);
  assert.equal(r.next, 3);
  assert.equal(sql.calls.length, 2, 'NULL prev + valid next → UPDATE fires');
});

test('🛑 PR-4 Path B writeFailSoft: NULL current + empty evidence → ok:true, NO UPDATE', async () => {
  // Pre-PR-4-deploy student: no step, no evidence yet. Don't write a default
  // value (would skew "未起步" semantic).
  const sql = mkScSql((text) => {
    if (/SELECT sc_journey_step/.test(text)) {
      return [{
        sc_journey_step: null,
        sc_journey_evidence: {
          step_1: [], step_2: [], step_3: [], step_4: [], step_5: [], step_6: [], step_7: [],
        },
      }];
    }
    return [];
  });
  const r = await writeScJourneyStepFailSoft(sql, 'A001');
  assert.equal(r.ok, true);
  assert.equal(r.prev, null);
  assert.equal(r.next, null);
  assert.equal(sql.calls.length, 1, 'no UPDATE when nothing to write');
});

// ─── Integration: handler wiring ────────────────────────────────

test('🛑 PR-4 Path B handler: writeScJourneyStepFailSoft called after day1 block, before generateDamonNote', () => {
  // Verify hook placement via source inspection.
  const day1Idx = finalizeDaySrc.indexOf('day1_completed_at-write-failed');
  const scIdx   = finalizeDaySrc.indexOf('writeScJourneyStepFailSoft(sql, existing.student_id)');
  const noteIdx = finalizeDaySrc.indexOf('generateDamonNote(sql, sessionId, module, week, day, wasCrisis)');
  assert.ok(day1Idx > 0, 'day1 fail-soft anchor must exist');
  assert.ok(scIdx > 0,   'sc_journey_step write call must exist');
  assert.ok(noteIdx > 0, 'generateDamonNote anchor must exist');
  assert.ok(day1Idx < scIdx, 'sc_journey write must come AFTER day1 block (mirror pattern)');
  assert.ok(scIdx < noteIdx, 'sc_journey write must come BEFORE Damon note (race-safe;'
    + ' Damon picks up the new step via PR-5 wire)');
});

// ═════════════════════════════════════════════════════════════════
// 🛑 v5.3 件3 PR-J2 — writeBrainStateFailSoft (incremental gen)
// Patrick safety 命門:
//   - LLM throw → step skipped, no leak, no finalize block
//   - dirty LLM output → scrubbed to null, step skipped
//   - logs NEVER include raw quote / description text
//   - per-step UPDATE isolated (one step's fail doesn't block others)
// ═════════════════════════════════════════════════════════════════

function mkBrainSql(planFn) {
  const calls = [];
  const fn = (strings, ...values) => {
    const text = strings.join('?');
    calls.push({ text, values });
    return Promise.resolve(planFn ? planFn(text, calls.length - 1) : []);
  };
  fn.calls = calls;
  return fn;
}

const HAPPY_EVIDENCE = {
  step_1: [], step_2: [],
  step_3: [{ type: 'data_mining', quote: '某 term' }],
  step_4: [{ type: 'identity_claim', quote: '勇敢' }],
  step_5: [], step_6: [], step_7: [],
};

function mockAnthropic() {
  return { messages: { create: async () => ({ content: [{ text: 'x' }] }) } };
}

test('🛑 PR-J2 writeBrainState: empty touchedSteps → no-op, ok:true', async () => {
  const sql = mkBrainSql();
  const r = await writeBrainStateFailSoft(sql, 'A001', [], {
    anthropic: mockAnthropic(),
    callAnthropic: async () => ({ ok: true, data: { content: [{ text: 'desc' }] } }),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.generated, []);
  assert.deepEqual(r.skipped, []);
  assert.equal(sql.calls.length, 0, 'no SQL fired for empty touched');
});

test('🛑 PR-J2 writeBrainState: happy 2 steps → 1 SELECT + 2 UPDATE', async () => {
  const sql = mkBrainSql((text) => {
    if (/SELECT sc_journey_evidence/.test(text)) return [{ sc_journey_evidence: HAPPY_EVIDENCE }];
    return [];
  });
  const r = await writeBrainStateFailSoft(sql, 'A001', [3, 4], {
    anthropic: mockAnthropic(),
    callAnthropic: async () => ({
      ok: true, data: { content: [{ text: '那段日子,你看見了。' }] },
    }),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.generated.sort(), [3, 4]);
  assert.deepEqual(r.skipped, []);
  // 1 SELECT + 2 UPDATE (one per step).
  assert.equal(sql.calls.length, 3);
  assert.match(sql.calls[0].text, /SELECT sc_journey_evidence/);
  assert.match(sql.calls[1].text, /UPDATE students/);
  assert.match(sql.calls[1].text, /sc_storyboard\s*=\s*jsonb_set/);
});

test('🛑 PR-J2 writeBrainState: invalid step ranges skipped silently', async () => {
  const sql = mkBrainSql((text) => {
    if (/SELECT sc_journey_evidence/.test(text)) return [{ sc_journey_evidence: HAPPY_EVIDENCE }];
    return [];
  });
  const r = await writeBrainStateFailSoft(sql, 'A001', [0, 8, 4, 'foo'], {
    anthropic: mockAnthropic(),
    callAnthropic: async () => ({ ok: true, data: { content: [{ text: 'ok' }] } }),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.generated, [4],   'only step 4 generates (others out-of-range)');
  assert.ok(r.skipped.length >= 3, 'invalid step nos in skipped');
});

test('🛑 PR-J2 writeBrainState: step with empty evidence → skipped (no LLM call)', async () => {
  let llmCalls = 0;
  const sql = mkBrainSql((text) => {
    if (/SELECT sc_journey_evidence/.test(text)) {
      return [{ sc_journey_evidence: {
        step_1: [], step_2: [], step_3: [], step_4: [], step_5: [], step_6: [], step_7: [],
      } }];
    }
    return [];
  });
  const r = await writeBrainStateFailSoft(sql, 'A001', [3, 4], {
    anthropic: mockAnthropic(),
    callAnthropic: async () => { llmCalls++; return { ok: true, data: { content: [{ text: 'x' }] } }; },
  });
  assert.equal(llmCalls, 0, 'no LLM call when step evidence empty');
  assert.deepEqual(r.generated, []);
});

test('🛑 PR-J2 writeBrainState: SELECT throws → ok:false, all skipped, no UPDATE', async () => {
  const sql = mkBrainSql(() => { throw new Error('db down'); });
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const r = await writeBrainStateFailSoft(sql, 'A001', [3], {
      anthropic: mockAnthropic(),
      callAnthropic: async () => ({ ok: true, data: { content: [{ text: 'x' }] } }),
    });
    assert.equal(r.ok, false);
    assert.deepEqual(r.skipped, [3]);
  } finally {
    console.warn = origWarn;
  }
});

test('🛑 PR-J2 writeBrainState: LLM call throws → step skipped, no UPDATE for that step', async () => {
  const sql = mkBrainSql((text) => {
    if (/SELECT sc_journey_evidence/.test(text)) return [{ sc_journey_evidence: HAPPY_EVIDENCE }];
    return [];
  });
  let stepCalls = 0;
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const r = await writeBrainStateFailSoft(sql, 'A001', [3, 4], {
      anthropic: mockAnthropic(),
      callAnthropic: async () => {
        stepCalls++;
        if (stepCalls === 1) throw new Error('llm timeout');
        return { ok: true, data: { content: [{ text: '描述。' }] } };
      },
    });
    assert.equal(r.ok, true, 'overall still ok (fail-soft per step)');
    assert.deepEqual(r.generated, [4], 'step 3 failed, step 4 succeeded');
    assert.deepEqual(r.skipped, [3]);
  } finally {
    console.warn = origWarn;
  }
});

test('🛑 PR-J2 writeBrainState: 🔴 ship-gate — dirty LLM output → scrubbed → step skipped', async () => {
  const sql = mkBrainSql((text) => {
    if (/SELECT sc_journey_evidence/.test(text)) return [{ sc_journey_evidence: HAPPY_EVIDENCE }];
    return [];
  });
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const r = await writeBrainStateFailSoft(sql, 'A001', [3], {
      anthropic: mockAnthropic(),
      // LLM returns 自殺 — Defense 2 scrubber kills it → null → step skipped.
      callAnthropic: async () => ({ ok: true, data: { content: [{ text: '你想自殺' }] } }),
    });
    assert.equal(r.ok, true);
    assert.deepEqual(r.generated, [], '🔴 dirty LLM output MUST NOT write to DB');
    assert.deepEqual(r.skipped, [3]);
  } finally {
    console.warn = origWarn;
  }
});

test('🛑 PR-J2 writeBrainState: 🔴 ship-gate — log NEVER contains raw quote / description', async () => {
  const sql = mkBrainSql((text) => {
    if (/SELECT sc_journey_evidence/.test(text)) {
      return [{ sc_journey_evidence: {
        step_1: [], step_2: [], step_3: [], step_4: [{ type: 'identity_claim', quote: 'SECRET_QUOTE_XYZ' }],
        step_5: [], step_6: [], step_7: [],
      } }];
    }
    return [];
  });
  const SECRET_DESC = 'SECRET_DESCRIPTION_LMN 那段日子。';
  const captured = [];
  const origInfo = console.info;
  const origWarn = console.warn;
  console.info = (...args) => captured.push(['info', ...args]);
  console.warn = (...args) => captured.push(['warn', ...args]);
  try {
    await writeBrainStateFailSoft(sql, 'A001', [4], {
      anthropic: mockAnthropic(),
      callAnthropic: async () => ({ ok: true, data: { content: [{ text: SECRET_DESC }] } }),
    });
  } finally {
    console.info = origInfo;
    console.warn = origWarn;
  }
  const flat = JSON.stringify(captured);
  assert.equal(/SECRET_DESCRIPTION_LMN/.test(flat), false,
    '🔴 ship-gate: raw description MUST NOT appear in any log');
  assert.equal(/SECRET_QUOTE_XYZ/.test(flat),       false,
    '🔴 ship-gate: raw quote MUST NOT appear in any log');
});

test('🛑 PR-J2 writeBrainState: UPDATE preserves sovereign_action (jsonb merge, not replace)', async () => {
  // sovereign_action is a PR-J3 concern; UPDATE for brain_state must NOT
  // overwrite a sibling sovereign_action key. Pattern verification:
  // payload || ${...}::jsonb merges, doesn't replace step_N entirely.
  const sql = mkBrainSql((text) => {
    if (/SELECT sc_journey_evidence/.test(text)) return [{ sc_journey_evidence: HAPPY_EVIDENCE }];
    return [];
  });
  const r = await writeBrainStateFailSoft(sql, 'A001', [4], {
    anthropic: mockAnthropic(),
    callAnthropic: async () => ({ ok: true, data: { content: [{ text: 'ok' }] } }),
  });
  assert.equal(r.ok, true);
  const updateCall = sql.calls.find(c => /UPDATE students/.test(c.text));
  assert.ok(updateCall);
  // The SQL must use `|| ${payload}::jsonb` merge against existing step_N.
  assert.match(updateCall.text, /COALESCE\(sc_storyboard -> /,
    'UPDATE must COALESCE existing step_N to preserve sovereign_action');
});

test('🛑 PR-J2 writeBrainState: handler integration — call site after Path B, before Damon note', async () => {
  // Source-level verify hook placement.
  const day1Idx  = finalizeDaySrc.indexOf('day1_completed_at-write-failed');
  const pathBIdx = finalizeDaySrc.indexOf('writeScJourneyStepFailSoft(sql, existing.student_id)');
  const j2Idx    = finalizeDaySrc.indexOf('writeBrainStateFailSoft(sql, existing.student_id');
  const noteIdx  = finalizeDaySrc.indexOf('generateDamonNote(sql, sessionId, module, week, day, wasCrisis)');
  assert.ok(day1Idx > 0,  'day1 anchor');
  assert.ok(pathBIdx > 0, 'Path B anchor');
  assert.ok(j2Idx > 0,    'J2 brain_state call must exist');
  assert.ok(noteIdx > 0,  'Damon Note anchor');
  assert.ok(day1Idx < pathBIdx && pathBIdx < j2Idx && j2Idx < noteIdx,
    'order: day1 → Path B (sc_journey_step) → J2 (brain_state) → Damon Note');
});

// ═════════════════════════════════════════════════════════════════
// 🛑 v5.3 件3 PR-J3 — writeSovereignActionFailSoft (個人化紅線)
// Patrick safety:
//   - 素材不夠 → null (絕不掉 generic)
//   - 結尾必落內控宣告
//   - log NEVER includes raw sovereign_action text
//   - per-step UPDATE preserves brain_state (jsonb merge)
//   - LLM throw / scrub-empty → step skipped
// ═════════════════════════════════════════════════════════════════

const SUFFICIENT_J3_CTX = {
  activeContext: { name: '伴侶關係', definition: '我與 A 的婚姻' },
  surfacedValues: ['誠實的', '勇敢的'],
};

const J3_EVIDENCE = {
  step_1: [], step_2: [],
  step_3: [{ type: 'data_mining', quote: '某 term' }],
  step_4: [{ type: 'identity_claim', quote: '我是有膽量做決定的人' }],
  step_5: [], step_6: [], step_7: [],
};

const GOOD_SOVEREIGN_TEXT = '針對你的伴侶關係,你現在站穩自己的立場。舊標籤過時了,你拿回主動權。我自己說了算。';

test('🛑 PR-J3 writeSovereignAction: empty touchedSteps → no-op, ok:true', async () => {
  const sql = mkBrainSql();
  const r = await writeSovereignActionFailSoft(sql, 'A001', [], {
    ...SUFFICIENT_J3_CTX,
    anthropic: mockAnthropic(),
    callAnthropic: async () => ({ ok: true, data: { content: [{ text: GOOD_SOVEREIGN_TEXT }] } }),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.generated, []);
  assert.equal(sql.calls.length, 0, 'no SQL fired for empty touched');
});

test('🛑 PR-J3 writeSovereignAction: happy 2 steps → 1 SELECT + 2 UPDATE', async () => {
  const sql = mkBrainSql((text) => {
    if (/SELECT sc_journey_evidence/.test(text)) return [{ sc_journey_evidence: J3_EVIDENCE }];
    return [];
  });
  const r = await writeSovereignActionFailSoft(sql, 'A001', [3, 4], {
    ...SUFFICIENT_J3_CTX,
    anthropic: mockAnthropic(),
    callAnthropic: async () => ({ ok: true, data: { content: [{ text: GOOD_SOVEREIGN_TEXT }] } }),
  });
  assert.equal(r.ok, true);
  assert.deepEqual(r.generated.sort(), [3, 4]);
  // 1 SELECT + 2 UPDATEs.
  assert.equal(sql.calls.length, 3);
});

test('🛑 PR-J3 writeSovereignAction: 🔴 個人化素材空 → null per step (NOT generic)', async () => {
  const sql = mkBrainSql((text) => {
    if (/SELECT sc_journey_evidence/.test(text)) return [{ sc_journey_evidence: J3_EVIDENCE }];
    return [];
  });
  // Empty active_context + empty surfaced_values + step evidence has only
  // pain_surface (which user-msg excludes from personalization features).
  let llmCalls = 0;
  const r = await writeSovereignActionFailSoft(sql, 'A001', [3, 4], {
    activeContext: {},
    surfacedValues: [],
    anthropic: mockAnthropic(),
    callAnthropic: async () => { llmCalls++; return { ok: true, data: { content: [{ text: GOOD_SOVEREIGN_TEXT }] } }; },
  });
  assert.equal(llmCalls, 0,
    '🔴 ship-gate: hasSufficientPersonalization gate fires BEFORE LLM call → 0 calls');
  assert.deepEqual(r.generated, []);
});

test('🛑 PR-J3 writeSovereignAction: 🔴 LLM output missing 內控宣告 → step skipped', async () => {
  const sql = mkBrainSql((text) => {
    if (/SELECT sc_journey_evidence/.test(text)) return [{ sc_journey_evidence: J3_EVIDENCE }];
    return [];
  });
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const r = await writeSovereignActionFailSoft(sql, 'A001', [4], {
      ...SUFFICIENT_J3_CTX,
      anthropic: mockAnthropic(),
      callAnthropic: async () => ({
        ok: true, data: { content: [{ text: '這段話沒有任何主導權的尾巴。' }] },
      }),
    });
    assert.deepEqual(r.generated, [],
      '🔴 ship-gate: weak ending (no self-control declaration) → step skipped');
    assert.deepEqual(r.skipped, [4]);
  } finally {
    console.warn = origWarn;
  }
});

test('🛑 PR-J3 writeSovereignAction: 🔴 ship-gate — log NEVER contains raw sovereign_action text', async () => {
  const sql = mkBrainSql((text) => {
    if (/SELECT sc_journey_evidence/.test(text)) return [{ sc_journey_evidence: J3_EVIDENCE }];
    return [];
  });
  const SECRET_SOV = 'SECRET_SOVEREIGN_XYZ 你現在握住你的選擇。我自己說了算。';
  const captured = [];
  const origInfo = console.info;
  const origWarn = console.warn;
  console.info = (...args) => captured.push(['info', ...args]);
  console.warn = (...args) => captured.push(['warn', ...args]);
  try {
    await writeSovereignActionFailSoft(sql, 'A001', [4], {
      ...SUFFICIENT_J3_CTX,
      anthropic: mockAnthropic(),
      callAnthropic: async () => ({ ok: true, data: { content: [{ text: SECRET_SOV }] } }),
    });
  } finally {
    console.info = origInfo;
    console.warn = origWarn;
  }
  const flat = JSON.stringify(captured);
  assert.equal(/SECRET_SOVEREIGN_XYZ/.test(flat), false,
    '🔴 ship-gate: raw sovereign_action MUST NOT appear in any log');
});

test('🛑 PR-J3 writeSovereignAction: UPDATE preserves brain_state (jsonb merge, not replace)', async () => {
  const sql = mkBrainSql((text) => {
    if (/SELECT sc_journey_evidence/.test(text)) return [{ sc_journey_evidence: J3_EVIDENCE }];
    return [];
  });
  const r = await writeSovereignActionFailSoft(sql, 'A001', [4], {
    ...SUFFICIENT_J3_CTX,
    anthropic: mockAnthropic(),
    callAnthropic: async () => ({ ok: true, data: { content: [{ text: GOOD_SOVEREIGN_TEXT }] } }),
  });
  assert.equal(r.ok, true);
  const updateCall = sql.calls.find(c => /UPDATE students/.test(c.text));
  assert.ok(updateCall);
  // jsonb merge pattern: || ${payload}::jsonb against COALESCE(...->step_N).
  assert.match(updateCall.text, /COALESCE\(sc_storyboard -> /,
    'UPDATE must merge with existing step_N to preserve brain_state from J2');
});

test('🛑 PR-J3 writeSovereignAction: SELECT throws → ok:false, all skipped', async () => {
  const sql = mkBrainSql(() => { throw new Error('db down'); });
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const r = await writeSovereignActionFailSoft(sql, 'A001', [3], {
      ...SUFFICIENT_J3_CTX,
      anthropic: mockAnthropic(),
      callAnthropic: async () => ({ ok: true, data: { content: [{ text: GOOD_SOVEREIGN_TEXT }] } }),
    });
    assert.equal(r.ok, false);
    assert.deepEqual(r.skipped, [3]);
  } finally {
    console.warn = origWarn;
  }
});

test('🛑 PR-J3 writeSovereignAction: handler integration — J3 call follows J2 in same finalize block', () => {
  const j2Idx       = finalizeDaySrc.indexOf('writeBrainStateFailSoft(sql, existing.student_id');
  const j3Idx       = finalizeDaySrc.indexOf('writeSovereignActionFailSoft(sql, existing.student_id');
  const acFetchIdx  = finalizeDaySrc.indexOf('active_context_session_summary');
  const noteIdx     = finalizeDaySrc.indexOf('generateDamonNote(sql, sessionId, module, week, day, wasCrisis)');
  assert.ok(j2Idx > 0, 'J2 call must exist');
  assert.ok(j3Idx > 0, 'J3 call must exist');
  assert.ok(acFetchIdx > 0, 'active_context_session_summary fetch must exist (個人化來源)');
  assert.ok(j2Idx < j3Idx,
    'J3 sovereign_action MUST follow J2 brain_state (same touched-steps block)');
  assert.ok(j3Idx < noteIdx,
    'J3 sovereign_action runs BEFORE generateDamonNote');
});

// ═════════════════════════════════════════════════════════
// 🛑 6/13 Patrick (A022 case fix) — finalize-day 韌性鎖
//   (1) maxDuration 提到 300s (Vercel Pro plan max).
//   (2) note null 不再 500; 走 fallback shape → 200 + safeNoteForStudent.
//   (3) per-stage timing log (observer/J2/J3/note + total) emit 在 200 前.
//   (4) Day-21 graduation gen 需 _noteAvailable guard (不送 null 給 Sonnet).
//   (5) vercel.json 同步 maxDuration=300.
// ═════════════════════════════════════════════════════════

test('🛑 6/13: FINALIZE_MAX_DURATION_SECONDS === 300 (Vercel Pro plan max)', () => {
  // 60 → 300. 給 observer + J2 + J3 + Damon note 寬鬆 headroom, 不被 timeout
  // 砍掉最後一棒 (A022 case: 教練筆記 null).
  assert.equal(FINALIZE_MAX_DURATION_SECONDS, 300);
  assert.equal(finalizeConfig.maxDuration, 300,
    'export const config.maxDuration must = 300 (Vercel reads this for the function)');
});

test('🛑 6/13: vercel.json api/finalize-day.js maxDuration === 300 (deploy-side lock)', () => {
  // vercel.json 是 Vercel platform 真正的 source-of-truth (config 內注釋 import
  // 在某些 build 環境會被忽略). 兩處同步鎖.
  const vercelPath = join(__finalizeDayDir, '..', 'vercel.json');
  const vercelCfg = JSON.parse(readFileSync(vercelPath, 'utf8'));
  assert.equal(
    vercelCfg.functions?.['api/finalize-day.js']?.maxDuration, 300,
    'vercel.json api/finalize-day.js maxDuration must = 300');
  // chat.js 不動, 對話路徑要快.
  assert.equal(
    vercelCfg.functions?.['api/chat.js']?.maxDuration, 60,
    'vercel.json api/chat.js maxDuration must stay 60 (對話要快)');
});

test('🛑 6/13: note null → 不再 500; 改 fallback shape + log [finalize-day][note-null]', () => {
  // 移除舊的 `return res.status(500).json({ error: 'NOTE_GENERATION_FAILED' })`.
  // 新邏輯: log + noteResult = { fullNote: null, notebookPage: null } + 走 200.
  assert.equal(
    /NOTE_GENERATION_FAILED/.test(finalizeDaySrc), false,
    '舊的 NOTE_GENERATION_FAILED 500 path 必須移除 (A022 fix: 韌性回 200)');
  // 新觀測 log 必須存在.
  assert.match(finalizeDaySrc, /\[finalize-day\]\[note-null\]/,
    '`[finalize-day][note-null]` 觀測 log 必須存在');
  // fallback shape 必須有.
  assert.match(finalizeDaySrc, /noteResult\s*=\s*\{\s*fullNote:\s*null,\s*notebookPage:\s*null\s*\}/,
    'note null 時必須改寫 noteResult 為 { fullNote: null, notebookPage: null } fallback shape');
  // _noteAvailable sentinel 必須存在 (downstream guard).
  assert.match(finalizeDaySrc, /const\s+_noteAvailable\s*=\s*!!noteResult/,
    '_noteAvailable sentinel 必須存在, 給 Day-21 graduation guard 用');
});

test('🛑 6/13: per-stage timing — observer/J2/J3/note 各包計時 + 結尾 summary log', () => {
  // 4 個 Date.now() 計時點 — 不鎖每一個 (refactor 容忍), 鎖 summary log 一定 emit.
  assert.match(finalizeDaySrc, /\[finalize-day\]\[timing\]/,
    'finalize 結尾必須 emit [finalize-day][timing] 統一觀測 log');
  // timing 物件初始化必須存在.
  assert.match(finalizeDaySrc, /const\s+timing\s*=\s*\{[^}]*observer_ms[^}]*j2_ms[^}]*j3_ms[^}]*damon_note_ms/,
    'const timing = { observer_ms, j2_ms, j3_ms, damon_note_ms } 必須宣告');
  // total_ms 必須算
  assert.match(finalizeDaySrc, /total_ms:\s*Date\.now\(\)\s*-\s*tFinalizeStart/,
    'timing summary 必須 emit total_ms = Date.now() - tFinalizeStart');
});

test('🛑 6/13: Day-21 graduation 必須 guard _noteAvailable (不送 null 給 Sonnet)', () => {
  // 鎖 graduation block 開頭包含 _noteAvailable 檢查.
  assert.match(finalizeDaySrc, /if\s*\(\s*graduation\s+&&\s+_noteAvailable\s*\)/,
    'Day-21 graduation gen 必須以 `if (graduation && _noteAvailable)` 開, note 不在時 skip');
});

test('🛑 6/13: safeNoteForStudent(null) 流經產品 fallback (「教練筆記稍後送達」)', () => {
  // 200 response 結構不變 — notebookPage 走 safeNoteForStudent(noteResult.notebookPage).
  // 當 noteResult.notebookPage = null (本 PR fallback shape), safeNoteForStudent
  // 回 fallback string. 鎖 200 path 沒被改成 hard-null.
  assert.match(finalizeDaySrc,
    /notebookPage:\s*safeNoteForStudent\(noteResult\.notebookPage/,
    '200 response 必須繼續走 safeNoteForStudent(noteResult.notebookPage) 路徑');
});
