// lib/student/views-coverage.test.js
// 6/12 P0 防再犯 — student.js 的 VIEWS 陣列必須涵蓋 index.html 所有
// <section id="view-*"> 區塊.
//
// 觸發本 test 的事件: 6/12 線上 #/storyboard 整頁空白. 根因 — 件3 PR-J4 加了
// <section id="view-storyboard"> 但 VIEWS 沒同步 → showView('storyboard') 把
// 其他 8 個 view 移除 active 卻沒啟用 view-storyboard → 整頁空白.
//
// 防再犯邏輯: 以後新增 <section id="view-X"> 但忘記在 VIEWS 加 'X' → 紅.
// 反向也鎖: VIEWS 列了 index.html 沒有的 view → 紅 (避免漂浮 entry).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = join(__dirname, '..', '..');
const studentJs = readFileSync(join(repoRoot, 'student.js'),  'utf8');
const indexHtml = readFileSync(join(repoRoot, 'index.html'), 'utf8');

// Extract VIEWS array literal from student.js source.
// Source-string match (not eval) — locks the exact const VIEWS = [...] line.
function extractViewsFromStudentJs() {
  const m = studentJs.match(/const VIEWS = \[([^\]]+)\];/);
  if (!m) throw new Error('Could not locate `const VIEWS = [...]` in student.js');
  const names = [];
  const re = /'([a-z][a-z0-9-]*)'/g;
  let mm;
  while ((mm = re.exec(m[1])) !== null) names.push(mm[1]);
  return names;
}

// Extract all `<section id="view-X" ...>` ids from index.html.
function extractViewIdsFromIndexHtml() {
  const ids = [];
  const re = /<section id="view-([a-z][a-z0-9-]*)"/g;
  let m;
  while ((m = re.exec(indexHtml)) !== null) ids.push(m[1]);
  return ids;
}

// ═════════════════════════════════════════════════════════
// 鎖死 — VIEWS ↔ index.html view-* id 必須一致
// ═════════════════════════════════════════════════════════

test('🛑 VIEWS coverage: VIEWS array must include every <section id="view-*"> in index.html', () => {
  const views   = extractViewsFromStudentJs();
  const viewIds = extractViewIdsFromIndexHtml();
  assert.ok(viewIds.length > 0, 'index.html must contain at least one view-* section');
  const missing = viewIds.filter(id => !views.includes(id));
  assert.deepEqual(missing, [],
    `student.js VIEWS missing entries for index.html sections: ${missing.join(', ')}. ` +
    `Add them to VIEWS, else showView() will silently hide every view when routing here.`);
});

test('🛑 VIEWS coverage: VIEWS array must not list views absent from index.html (no floating entries)', () => {
  const views   = extractViewsFromStudentJs();
  const viewIds = extractViewIdsFromIndexHtml();
  const stray = views.filter(v => !viewIds.includes(v));
  assert.deepEqual(stray, [],
    `student.js VIEWS contains entries with no matching <section id="view-*"> in index.html: ${stray.join(', ')}. ` +
    `Remove them, else they shadow real views or hint at a deleted section.`);
});

// Anti-regression anchor for the SPECIFIC bug this file was created for.
// Even if the general coverage test above mutates, 'storyboard' must remain.
test('🛑 VIEWS coverage: anti-regression — VIEWS must contain "storyboard" (6/12 P0)', () => {
  const views = extractViewsFromStudentJs();
  assert.ok(views.includes('storyboard'),
    'VIEWS must include "storyboard" — without it, #/storyboard renders blank (6/12 P0).');
});
