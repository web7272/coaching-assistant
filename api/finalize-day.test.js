// api/finalize-day.test.js
// PR-4c v5 day-numbering pure helpers (the handler itself is I/O orchestration).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveSessionDay,
  weekFromSessionDay,
  isWeekBoundary,
  isGraduationDay,
  extractKeyPhrase,
  extractTakeawayAnchor,
  buildExportPersonalCoachPrompt,
  buildGraduationSystemPrompt,
  parseGraduationResponse,
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
// 🛑 isWeekBoundary — 7 / 14 / 21 only（PR-4c：v4 day===6 廢、改 v5 邊界）
// ─────────────────────────────────────────────────────────

test('🛑 isWeekBoundary: true only on day 7 / 14 / 21', () => {
  assert.equal(isWeekBoundary(7), true);
  assert.equal(isWeekBoundary(14), true);
  assert.equal(isWeekBoundary(21), true);
});

test('🛑 isWeekBoundary: every other day in 1-21 → false', () => {
  for (const d of [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 13, 15, 16, 17, 18, 19, 20]) {
    assert.equal(isWeekBoundary(d), false, `day ${d} should NOT be a week boundary`);
  }
});

test('🛑 isWeekBoundary: day 6 (v4 boundary) is NOT a v5 boundary', () => {
  assert.equal(isWeekBoundary(6), false,
    'v4.0 used day===6 as the week boundary; PR-4c moved to 7/14/21');
});

// ─────────────────────────────────────────────────────────
// isGraduationDay — only day 21
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

test('🛑 extractTakeawayAnchor: very long unbroken text → hard-capped at 12 chars', () => {
  const note = `【關鍵句】\n這個非常非常非常非常非常非常非常長的話沒有句點\n\n【其他】`;
  const out = extractTakeawayAnchor(note);
  assert.ok(out.length <= 12, `expected length ≤ 12, got ${out.length}`);
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
