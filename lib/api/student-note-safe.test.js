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

// ═══════════════════════════════════════════════════════════════════════════
// 🛑 6/8 Vivi v5.2 errata PR-a — scrubber synced with new template markers.
//   v3.3 markers retained (歷史 damon_notes 仍 v3.3 格式).
//   v5.2 markers added: 【Mode 軌跡】 / 【應 invoke 但未 invoke 的技術】 /
//     【Day 1-N 採集追蹤】 / 【active_context】 / 【sc_step_when_generated】.
// ═══════════════════════════════════════════════════════════════════════════

test('🛑 6/8 v5.2 PR-a scrubber: FORBIDDEN_SECTION_MARKERS contains the 5 new headers', () => {
  const required = [
    '【Mode 軌跡】',
    '【應 invoke 但未 invoke 的技術】',
    '【Day 1-N 採集追蹤】',
    '【active_context】',
    '【sc_step_when_generated】',
  ];
  for (const h of required) {
    assert.ok(
      _internal.FORBIDDEN_SECTION_MARKERS.includes(h),
      `FORBIDDEN_SECTION_MARKERS must include "${h}"`,
    );
  }
});

test('🛑 6/8 v5.2 PR-a scrubber: 歷史 v3.3 markers retained (Layer 1-5 / 工具N / 池 / 採集 6)', () => {
  // 歷史 damon_notes 仍 v3.3 格式 — scrubber 要繼續擋舊 header.
  const v33Headers = [
    '【深度層次】',
    '【Day 1-6 採集追蹤】',
    '【Scope 證據】',
    '【賦予新角色狀態】',
    '【確定類別 + Scope】',
    '【Transfer 結果】',
    '【微證據 + 反例預演結果】',
    '【宣言】',
  ];
  for (const h of v33Headers) {
    assert.ok(
      _internal.FORBIDDEN_SECTION_MARKERS.includes(h),
      `v3.3 historical header "${h}" must STILL be in FORBIDDEN_SECTION_MARKERS`,
    );
  }
});

test('🛑 6/8 v5.2 PR-a: containsForbiddenContent flags each new v5.2 marker', () => {
  for (const m of ['【Mode 軌跡】', '【應 invoke 但未 invoke 的技術】',
                   '【Day 1-N 採集追蹤】', '【active_context】',
                   '【sc_step_when_generated】']) {
    assert.equal(
      containsForbiddenContent(`some text\n${m}\nbody`),
      true,
      `containsForbiddenContent should flag "${m}"`,
    );
  }
});

test('🛑 6/8 v5.2 PR-a end-to-end: full v5.2 Damon Note → scrubbed → 0 internal leak', () => {
  // Simulate the FULL shape of a v5.2 Damon Note (system-prepended anchors + AI body),
  // ensure passing through sanitizeStudentNote drops every coach-internal section
  // and leaves only the parts a student could safely see.
  const v52DamonNote = `【active_context】
category: 2
name: 我跟先生的溝通
definition: 主要是日常溝通

【sc_step_when_generated】
step: null
evidence_focus: null

【今天的模式】
學員今天反覆出現「我不夠好」這個敘述。事件層觀察。

【關鍵句】
「我以為照顧好他就夠了。」

【Mode 軌跡】
elicitation → identity_anchoring → reframe_invitation → containment

【SC 觀察】
段 1: Locus 是 external-other; Trap Value: 被需要; Quality 候選: 負責任.
段 2: 學員的 SC 可能是「只有被需要的時候我才有資格存在」.

【還沒碰到的】
surface 但未深入:學員提到童年原生家庭, 沒展開細節.

【明天的入口】
你提到「夠了」這個詞、那個「夠」對你是什麼?

【應 invoke 但未 invoke 的技術】
應 invoke R3 (Anchor Shift) — surface Trap Value 但沒 anchor 轉移.

【Day 1-N 採集追蹤】
今天觸發 Mode: elicitation / identity_anchoring.
surface Damon 概念: Locus / Trap Value / Quality 候選.
invoke R-series: R1.
Top 1-3 Quality 演進: Day 1 surface「負責任」「被需要」, 待收斂.

注意:總長 1000 字內.`;

  const clean = sanitizeStudentNote(v52DamonNote);

  // All 5 new v5.2 section headers stripped.
  for (const m of ['【active_context】', '【sc_step_when_generated】',
                   '【Mode 軌跡】', '【應 invoke 但未 invoke 的技術】',
                   '【Day 1-N 採集追蹤】']) {
    assert.ok(!clean.includes(m), `v5.2 marker "${m}" must be scrubbed`);
  }
  // All 3 regex-locked headers + 今天的模式 + 還沒碰到的 also stripped (v3.3 list).
  for (const m of ['【今天的模式】', '【關鍵句】', '【SC 觀察】',
                   '【還沒碰到的】', '【明天的入口】']) {
    assert.ok(!clean.includes(m), `v3.3 marker "${m}" must STILL be scrubbed`);
  }
  // Damon naming vocabulary that appeared inside sections must NOT leak.
  for (const term of ['Locus', 'Trap Value', 'R3', 'R-series', 'category: 2',
                       'evidence_focus', 'name: 我跟先生的溝通']) {
    assert.ok(!clean.includes(term),
      `coach-internal term "${term}" must not survive scrub`);
  }
  // containsForbiddenContent should now return false on the cleaned result.
  assert.equal(containsForbiddenContent(clean), false,
    'cleaned v5.2 Damon Note must not flag any forbidden content');
});
