// lib/coach-html/edit-form.test.js — Vivi 6/7 教練後台 3 改 sync-gate.
//
// Task spec (Patrick 6/7) — three frontend changes:
//   ① 拿掉「場景名稱」+「場景說明」inputs (active_context_name/definition 不再手調)
//   ② 加「封鎖(is_blocked)」checkbox + PATCH body diff
//   ③ 加「Day 1 完成日期」唯讀顯示 (從 students.day1_completed_at 來)
//
// Static analysis on raw coach.html + coach.js — established pattern
// (lib/landing/, lib/auth-html/).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');
const coachHtml = readFileSync(join(projectRoot, 'coach.html'), 'utf8');
const coachJs   = readFileSync(join(projectRoot, 'coach.js'),   'utf8');

// ─── ① 拿掉場景名/說明 inputs ────────────────────────────────────

test('🛑 6/7 ① coach.html: 場景名稱 input 已移除 (#coach-edit-ctx-name)', () => {
  assert.ok(!/id="coach-edit-ctx-name"/.test(coachHtml),
    '#coach-edit-ctx-name input must be removed (active_context_name 不再手調)');
});

test('🛑 6/7 ① coach.html: 場景說明 textarea 已移除 (#coach-edit-ctx-definition)', () => {
  assert.ok(!/id="coach-edit-ctx-definition"/.test(coachHtml),
    '#coach-edit-ctx-definition textarea must be removed');
});

test('🛑 6/7 ① coach.html: 場景名稱 label 文字「場景名稱」已移除', () => {
  assert.ok(!/場景名稱/.test(coachHtml),
    '「場景名稱」label must be removed');
});

test('🛑 6/7 ① coach.html: 場景說明 label 文字「場景說明」已移除', () => {
  assert.ok(!/場景說明/.test(coachHtml),
    '「場景說明」label must be removed');
});

test('🛑 6/7 ① coach.html: 主場景 (active_context_category) 下拉仍保留', () => {
  // Spec: 「保留主場景下拉(領域 anchor 還有意義)」.
  assert.match(coachHtml, /id="coach-edit-ctx-category"/);
  assert.match(coachHtml, /主場景/);
});

test('🛑 6/7 ① coach.js: $ctxName + $ctxDef refs 已移除', () => {
  assert.ok(!/getElementById\(['"]coach-edit-ctx-name['"]\)/.test(coachJs),
    'coach.js must not reference #coach-edit-ctx-name');
  assert.ok(!/getElementById\(['"]coach-edit-ctx-definition['"]\)/.test(coachJs),
    'coach.js must not reference #coach-edit-ctx-definition');
});

test('🛑 6/7 ① coach.js: PATCH body 不再帶 active_context_name / active_context_definition', () => {
  // Anti-regression: coach.js must NEVER push these fields to PATCH body.
  // (Backend api/students.js still accepts them for backward compat —
  // onboarding-flow.js writes them via chat.js PR-b — but the coach UI is
  // out of the loop.)
  assert.ok(!/body\.active_context_name\s*=/.test(coachJs),
    'PATCH body must not include active_context_name from coach UI');
  assert.ok(!/body\.active_context_definition\s*=/.test(coachJs),
    'PATCH body must not include active_context_definition from coach UI');
});

// ─── ② is_blocked checkbox ──────────────────────────────────────

test('🛑 6/7 ② coach.html: 封鎖 (is_blocked) checkbox 存在', () => {
  assert.match(coachHtml, /id="coach-edit-isblocked"/);
  assert.match(coachHtml, /type="checkbox"[^>]*id="coach-edit-isblocked"|id="coach-edit-isblocked"[^>]*type="checkbox"/);
  assert.match(coachHtml, /封鎖.{0,4}is_blocked/);
});

test('🛑 6/7 ② coach.html: 封鎖 checkbox 跟封測者 checkbox 是 sibling (同個 group)', () => {
  // UX: both checkboxes should be together in the form. Check both ids appear
  // within reasonable distance of each other (same form section).
  const betaIdx    = coachHtml.indexOf('id="coach-edit-isbeta"');
  const blockedIdx = coachHtml.indexOf('id="coach-edit-isblocked"');
  assert.ok(betaIdx > 0 && blockedIdx > 0);
  assert.ok(Math.abs(blockedIdx - betaIdx) < 800,
    'is_beta + is_blocked checkboxes should be in the same form group');
});

test('🛑 6/7 ② coach.js: 接 is_blocked checkbox + diff + PATCH body', () => {
  assert.match(coachJs, /getElementById\(['"]coach-edit-isblocked['"]\)/);
  // Diff: only add to body when changed (mirrors is_beta).
  assert.match(coachJs, /body\.is_blocked\s*=/,
    'coach.js must set body.is_blocked when the checkbox value diffs from original');
  // original.is_blocked init from server stu.is_blocked.
  assert.match(coachJs, /is_blocked\s*:\s*!!stu\.is_blocked/,
    'original.is_blocked must initialize from stu.is_blocked (boolean coerce)');
});

test('🛑 6/7 ② coach.js: save 成功後 local mirror 更新 + list cache patched', () => {
  // UX: after save, list view's blocked pill must reflect on navigation back.
  assert.match(coachJs, /Object\.assign\(original,\s*\{[\s\S]{0,400}is_blocked\s*:\s*newBlocked/,
    'original mirror must be updated after successful PATCH');
  assert.match(coachJs, /_coachStudentsCache[\s\S]{0,400}is_blocked\s*:\s*newBlocked/,
    'list cache must be patched so the "封鎖" pill refreshes on return');
});

// ─── ③ Day 1 完成日期顯示 ──────────────────────────────────────

test('🛑 6/7 ③ coach.html: Day 1 完成日期 readonly element 存在', () => {
  assert.match(coachHtml, /id="coach-day1-completed-at"/);
  assert.match(coachHtml, /Day 1 完成日期/);
});

test('🛑 6/7 ③ coach.js: formatDay1CompletedAt 純函式存在 (pure helper)', () => {
  assert.match(coachJs, /function formatDay1CompletedAt\s*\(/);
});

test('🛑 6/7 ③ coach.js: null / undefined / "" → "尚未完成"', () => {
  // Execute the pure helper to verify the contract holds at runtime —
  // not just lexically present. Evaluate the helper body via `new Function`.
  // We extract the function source and invoke against fixed inputs.
  const fnSrc = coachJs.match(/function formatDay1CompletedAt[\s\S]*?\n\}/);
  assert.ok(fnSrc, 'formatDay1CompletedAt must be locatable for eval');
  // Construct an Intl-aware sandbox; expose the function under a known name.
  // eslint-disable-next-line no-new-func
  const exec = new Function(`
    ${fnSrc[0]}
    return formatDay1CompletedAt;
  `);
  const fn = exec();
  assert.equal(fn(null),      '尚未完成');
  assert.equal(fn(undefined), '尚未完成');
  assert.equal(fn(''),        '尚未完成');
  assert.equal(fn('not-a-date'), '尚未完成');
});

test('🛑 6/7 ③ coach.js: formatDay1CompletedAt — Asia/Taipei YYYY-MM-DD', () => {
  const fnSrc = coachJs.match(/function formatDay1CompletedAt[\s\S]*?\n\}/);
  // eslint-disable-next-line no-new-func
  const exec = new Function(`${fnSrc[0]}; return formatDay1CompletedAt;`);
  const fn = exec();
  // 2026-06-07T17:00:00Z = 2026-06-08T01:00:00 Asia/Taipei → rolls forward.
  assert.equal(fn('2026-06-07T17:00:00.000Z'), '2026-06-08');
  // 2026-06-07T15:59:00Z = 2026-06-07T23:59:00 Asia/Taipei → same day.
  assert.equal(fn('2026-06-07T15:59:00.000Z'), '2026-06-07');
  // Output is always YYYY-MM-DD format.
  assert.match(fn('2026-06-08T03:15:00.000Z'), /^\d{4}-\d{2}-\d{2}$/);
});

test('🛑 6/7 ③ coach.js: 載入時把 stu.day1_completed_at 填到 #coach-day1-completed-at', () => {
  // Locates the render line that writes to the readonly element.
  assert.match(coachJs,
    /\$day1\.textContent\s*=\s*formatDay1CompletedAt\(\s*stu\.day1_completed_at\s*\)/,
    'render line must format stu.day1_completed_at into #coach-day1-completed-at');
});

// ─── PATCH endpoint compatibility (sanity) ──────────────────────

test('🛑 6/7 sanity: coach.js still PATCH /api/students for edits', () => {
  assert.match(coachJs, /api\(['"]\/api\/students['"][^)]*method:\s*['"]PATCH['"]/);
});
