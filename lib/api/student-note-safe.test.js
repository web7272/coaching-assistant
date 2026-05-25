// lib/api/student-note-safe.test.js — B1 scrub guarantees

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeStudentNote, containsForbiddenContent, safeNoteForStudent,
  stripLeadingMarkdown, _internal,
} from './student-note-safe.js';

// ─────────────────────────────────────────────────────────
// containsForbiddenContent — the predicate
// ─────────────────────────────────────────────────────────

test('containsForbiddenContent: detects each forbidden section marker', () => {
  for (const marker of _internal.FORBIDDEN_SECTION_MARKERS) {
    assert.equal(
      containsForbiddenContent(`some warm text\n${marker}\nstuff`),
      true,
      `should detect "${marker}"`,
    );
  }
});

test('containsForbiddenContent: detects 工具一/二/三/四 + 2A/B/C tool pool tags', () => {
  for (const s of ['工具一', '工具二', '工具三', '工具四', '工具1', '2A SC 池', '2B Reactive 池', '2C Belief 池']) {
    assert.equal(containsForbiddenContent(`今天用了 ${s}、走了 chain`), true, `should flag "${s}"`);
  }
});

test('containsForbiddenContent: detects Layer 1-5 / L1-L5 numbering', () => {
  assert.equal(containsForbiddenContent('今天走到 Layer 4。'), true);
  assert.equal(containsForbiddenContent('Layer3 marker'), true,
    'Layer3 (no space) is the v4 prompt style; \\s? makes the space optional');
  assert.equal(containsForbiddenContent('停在 L4 那層'), true);
  assert.equal(containsForbiddenContent('L0 / L6 not forbidden by design'), false,
    'Layer 0 / Layer 6 are out-of-range of the v5 Damon Note 1-5');
});

test('containsForbiddenContent: clean Vivi-warm text → false', () => {
  const warm = `今天她在這裡停了一下。「我可以決定」這句話從她嘴裡冒出來。

✦ 我看見的（一個假設）

她可能正在學會、停下來這件事本身就是答案。

— V`;
  assert.equal(containsForbiddenContent(warm), false);
});

test('containsForbiddenContent: empty / nullish → false', () => {
  assert.equal(containsForbiddenContent(''), false);
  assert.equal(containsForbiddenContent(null), false);
  assert.equal(containsForbiddenContent(undefined), false);
});

// ─────────────────────────────────────────────────────────
// sanitizeStudentNote — the scrubber
// ─────────────────────────────────────────────────────────

test('🛑 sanitizeStudentNote: strips an 【SC 觀察】 section body until next header', () => {
  const dirty = `今天 warm 開頭段。

【SC 觀察】
她可能是一個 X 的人。
進一步觀察：...

✦ 我看見的

正常 warm 內容。`;
  const clean = sanitizeStudentNote(dirty);
  assert.doesNotMatch(clean, /【SC 觀察】/);
  assert.doesNotMatch(clean, /進一步觀察/);
  assert.match(clean, /今天 warm 開頭段/);
  assert.match(clean, /✦ 我看見的/);
  assert.match(clean, /正常 warm 內容/);
});

test('🛑 sanitizeStudentNote: strips ALL coach-internal sections (every marker)', () => {
  let dirty = `主敘事。\n\n`;
  for (const m of _internal.FORBIDDEN_SECTION_MARKERS) {
    dirty += `${m}\n禁區內容 — should be stripped\n\n`;
  }
  dirty += `✦ 收尾 warm。`;
  const clean = sanitizeStudentNote(dirty);
  assert.match(clean, /主敘事/);
  assert.match(clean, /✦ 收尾 warm/);
  assert.doesNotMatch(clean, /禁區內容/);
  for (const m of _internal.FORBIDDEN_SECTION_MARKERS) {
    assert.doesNotMatch(clean, new RegExp(m.replace(/[【】+\s]/g, '\\$&')));
  }
});

test('🛑 sanitizeStudentNote: strips 工具一/二/三/四 lines + 2A/B/C tool pool references', () => {
  const dirty = `學員在這裡停了一下。
今天用了工具二 2A SC 池、後接觸發 #3。
這只是猜想。`;
  const clean = sanitizeStudentNote(dirty);
  assert.doesNotMatch(clean, /工具/);
  assert.doesNotMatch(clean, /2A/);
  assert.match(clean, /學員在這裡停了一下/);
  assert.match(clean, /這只是猜想/);
});

test('🛑 sanitizeStudentNote: strips Layer 1-5 / L1-L5 numbering lines', () => {
  const dirty = `主敘事。
今天走到 Layer 4 那一層。
她碰到了一個層次的邊。`;
  const clean = sanitizeStudentNote(dirty);
  assert.doesNotMatch(clean, /Layer 4/);
  assert.match(clean, /她碰到了一個層次的邊/, 'soft 「層次」 phrasing is allowed');
});

test('sanitizeStudentNote: empty / nullish → empty string', () => {
  assert.equal(sanitizeStudentNote(''), '');
  assert.equal(sanitizeStudentNote(null), '');
  assert.equal(sanitizeStudentNote(undefined), '');
  assert.equal(sanitizeStudentNote(42), '');
});

test('sanitizeStudentNote: collapses runs of blank lines after scrubbing', () => {
  const dirty = `第一段。\n\n【SC 觀察】\nstuff\n\n第二段。`;
  const clean = sanitizeStudentNote(dirty);
  assert.match(clean, /第一段。\n\n第二段。/, 'paragraph spacing preserved');
  assert.doesNotMatch(clean, /\n{3,}/, 'no triple-newlines');
});

test('🛑 sanitizeStudentNote output: post-scrub contains nothing forbidden (round-trip)', () => {
  // Construct text with every kind of forbidden content; verify output is clean
  const dirty = `主段落 — 學員的話。

【SC 觀察】
她可能是一個 X。

【深度層次】
今天走到 Layer 4。

【還沒碰到的】
她繞過去了 — 工具二 2C Belief 池 沒填到。

✦ 我看見的

可能她在這裡停住了。`;
  const clean = sanitizeStudentNote(dirty);
  assert.equal(containsForbiddenContent(clean), false,
    'sanitize output must NEVER contain forbidden content (round-trip invariant)');
});

test('sanitizeStudentNote: idempotent', () => {
  const t = `warm content\n\n✦ 我看見的\n\n猜想內容。`;
  assert.equal(sanitizeStudentNote(sanitizeStudentNote(t)), sanitizeStudentNote(t));
});

// ═══════════════════════════════════════════════════════════════════════════
// 🚨 Patrick 5/25 A001 Day 3 leak — sanitizer must handle markdown-prefixed
// markers ("## 【深度層次】" / "**【SC 觀察】**" / "> 【關鍵句】" / "- 【…】")
// ═══════════════════════════════════════════════════════════════════════════

test('stripLeadingMarkdown: strips #/*/>/-/+ and whitespace iteratively', () => {
  assert.equal(stripLeadingMarkdown('## 【深度層次】'), '【深度層次】');
  assert.equal(stripLeadingMarkdown('### 【SC 觀察】'), '【SC 觀察】');
  assert.equal(stripLeadingMarkdown('**【關鍵句】**'),  '【關鍵句】**');
  assert.equal(stripLeadingMarkdown('> 【深度層次】'),  '【深度層次】');
  assert.equal(stripLeadingMarkdown('- 【Day 1-6 採集追蹤】'), '【Day 1-6 採集追蹤】');
  assert.equal(stripLeadingMarkdown('  ## > **【SC 觀察】**'), '【SC 觀察】**',
    'compound markdown decoration stripped iteratively');
  // Untouched cases
  assert.equal(stripLeadingMarkdown('正常一句話'), '正常一句話');
  assert.equal(stripLeadingMarkdown(''), '');
  assert.equal(stripLeadingMarkdown(null), '');
});

test('🚨 sanitizeStudentNote: A001 Day 3 leak input — markdown-prefixed【深度層次】+Layer fully scrubbed', () => {
  // The exact leak shape Vivi saw: H2 markdown header + Layer 1-5 bullets.
  const dirty = `今天她在這裡停了一下。

## 【深度層次】
今天走到 **Layer 5**。
- Layer 1：行為
- Layer 2：感受
- Layer 3：身體
- Layer 4：價值
- Layer 5：身份

【明天的入口】
從這裡繼續。`;
  const clean = sanitizeStudentNote(dirty);
  assert.equal(containsForbiddenContent(clean), false,
    'sanitize must catch markdown-prefixed markers (PR-4c-green 5/25 fix)');
  assert.doesNotMatch(clean, /深度層次|Layer\s?[1-5]|明天的入口/);
  // The opening warm line should survive.
  assert.match(clean, /今天她在這裡停了一下/);
});

test('🚨 containsForbiddenContent: catches markdown-prefixed markers via .includes()', () => {
  // The previous bug: containsForbiddenContent used `text.includes(m)` already
  // so technically catches "## 【深度層次】" since "【深度層次】" is a substring.
  // Pin this so a future refactor to startsWith doesn't regress.
  assert.equal(containsForbiddenContent('## 【深度層次】\n…'), true);
  assert.equal(containsForbiddenContent('**【SC 觀察】**'), true);
  assert.equal(containsForbiddenContent('> 【關鍵句】'), true);
  assert.equal(containsForbiddenContent('- 【還沒碰到的】'), true);
});

// ═══════════════════════════════════════════════════════════════════════════
// safeNoteForStudent (fail-closed wrapper)
// ═══════════════════════════════════════════════════════════════════════════

test('🚨 safeNoteForStudent: clean text → sanitized cleaned string', () => {
  const out = safeNoteForStudent('正常的暖文字、沒任何禁區。');
  assert.equal(out, '正常的暖文字、沒任何禁區。');
});

test('🚨 safeNoteForStudent: empty/nullish input → safe fallback', () => {
  const FB = '（教練筆記稍後送達）';
  assert.equal(safeNoteForStudent(null), FB);
  assert.equal(safeNoteForStudent(undefined), FB);
  assert.equal(safeNoteForStudent(''), FB);
  assert.equal(safeNoteForStudent(42), FB);
});

test('🚨 safeNoteForStudent: sanitize survives clean → return cleaned (not fallback)', () => {
  const dirty = `溫暖開頭

【深度層次】
今天走到 Layer 4。

繼續暖內容。`;
  // sanitize strips the forbidden section + Layer line; the warm content remains.
  const out = safeNoteForStudent(dirty);
  assert.match(out, /溫暖開頭/);
  assert.match(out, /繼續暖內容/);
  assert.doesNotMatch(out, /深度層次|Layer/);
});

test('🚨 safeNoteForStudent: if forbidden somehow survives sanitize → safe fallback', () => {
  // Construct a contrived input that bypasses sanitize but trips
  // containsForbiddenContent. The sanitizer drops lines containing forbidden
  // markers; a marker inlined into the MIDDLE of a sentence (not at line start)
  // would survive line-level scrubbing but still fail the content check.
  const inline = '今天她說了一句話、然後我看到 【深度層次】 浮現在心裡。';
  // sanitize: this line doesn't START with the marker so it survives (line-level
  // scrub only catches startsWith). containsForbiddenContent uses .includes() →
  // sees the marker → triggers fail-closed → fallback.
  const out = safeNoteForStudent(inline);
  assert.equal(out, '（教練筆記稍後送達）');
});

test('🚨 safeNoteForStudent: custom fallback', () => {
  const out = safeNoteForStudent(null, { fallback: '（自訂 fallback）' });
  assert.equal(out, '（自訂 fallback）');
});

test('🚨 safeNoteForStudent: observe callback fires on fail-closed', () => {
  let observed = null;
  safeNoteForStudent('inline 【SC 觀察】 leak', {
    observe: (label, raw) => { observed = { label, rawLen: raw.length }; },
  });
  assert.ok(observed, 'observe must be called on fail-closed path');
  assert.match(observed.label, /forbidden survived sanitize/);
});

test('🚨 safeNoteForStudent: observe callback NOT called on clean path', () => {
  let observed = null;
  safeNoteForStudent('完全乾淨的字。', {
    observe: (label) => { observed = label; },
  });
  assert.equal(observed, null);
});
