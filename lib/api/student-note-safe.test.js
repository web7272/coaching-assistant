// lib/api/student-note-safe.test.js — B1 scrub guarantees

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitizeStudentNote, containsForbiddenContent, _internal,
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
