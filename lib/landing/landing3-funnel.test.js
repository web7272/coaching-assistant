// lib/landing/landing3-funnel.test.js
// Patrick 6/26 — Phase A 漏斗移植鎖測 (landing3.html /landing3 noindex preview).
//
// landing3.html 原為純視覺 mock，Phase A 把 landing.html 的漏斗移植進來：
//   • 真表單 <form id="quiz">，3 題用 radio/checkbox + data-qkey 三鍵
//     (性別 / 卡關領域 / 試過的方式)，Q3 為可複選 checkbox。
//   • email input #quizEmail、submit 鈕、訊息列 #quizMsg。
//   • submit handler：validEmail + collectQuiz(含 checkbox) → POST /api/request-guide
//     {email, option:3, answers}；成功凍 form「已寄出 ✓」、失敗解凍。
//   • Phase A 仍維持 noindex (Phase C 才移除)。
//   • 舊「純視覺預覽」mock 字樣已移除。
//
// 跑 raw 檔內容 (landing3 為 inline vanilla DOM、無 build step)。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', '..', 'landing3.html'), 'utf8');

// ─── Phase A：noindex 仍在 (Phase C 才移除) ───────────────────────
test('🛑 landing3 Phase A: noindex 仍在', () => {
  assert.match(html, /<meta\s+name=["']robots["']\s+content=["']noindex,nofollow["']/);
});

// ─── 真表單存在 ───────────────────────────────────────────────────
test('🛑 landing3 Phase A: quiz 是真 <form>，非純視覺 mock', () => {
  assert.match(html, /<form\s+class=["']quiz["']\s+id=["']quiz["']/);
});

test('🛑 landing3 Phase A: 舊「純視覺預覽」mock 字樣已移除', () => {
  assert.doesNotMatch(html, /純視覺預覽/);
});

// ─── 新 3 題 + data-qkey 三鍵 ─────────────────────────────────────
test('🛑 landing3 Phase A: Q1 radio name=q1 data-qkey=性別', () => {
  assert.match(html, /<input\s+type=["']radio["']\s+name=["']q1["']\s+data-qkey=["']性別["']/);
});

test('🛑 landing3 Phase A: Q2 radio name=q2 data-qkey=卡關領域', () => {
  assert.match(html, /<input\s+type=["']radio["']\s+name=["']q2["']\s+data-qkey=["']卡關領域["']/);
});

test('🛑 landing3 Phase A: Q3 為可複選 checkbox name=q3 data-qkey=試過的方式', () => {
  assert.match(html, /<input\s+type=["']checkbox["']\s+name=["']q3["']\s+data-qkey=["']試過的方式["']/);
});

test('🛑 landing3 Phase A: 三鍵齊全 (性別/卡關領域/試過的方式)', () => {
  ['性別', '卡關領域', '試過的方式'].forEach(k => {
    assert.ok(html.includes(`data-qkey="${k}"`), `缺 data-qkey ${k}`);
  });
});

// ─── email / 訊息列 / submit ─────────────────────────────────────
test('🛑 landing3 Phase A: email input #quizEmail', () => {
  assert.match(html, /<input\s+type=["']email["']\s+id=["']quizEmail["']/);
});

test('🛑 landing3 Phase A: 訊息列 #quizMsg aria-live', () => {
  assert.match(html, /id=["']quizMsg["'][^>]*aria-live/);
});

test('🛑 landing3 Phase A: submit 鈕 type=submit', () => {
  assert.match(html, /<button\s+type=["']submit["'][^>]*class=["']btn-primary submit["']/);
});

// ─── submit handler + 漏斗邏輯 ───────────────────────────────────
test('🛑 landing3 Phase A: form submit handler 存在', () => {
  assert.match(html, /quiz\.addEventListener\(\s*['"]submit['"]/);
  assert.match(html, /e\.preventDefault\(\)/);
});

test('🛑 landing3 Phase A: validEmail 移植', () => {
  assert.match(html, /function validEmail\(v\)\{return \/\^\[\^@\\s\]\+@/);
});

test('🛑 landing3 Phase A: collectQuiz 含 checkbox 分支 (Q3 陣列)', () => {
  assert.match(html, /function collectQuiz\(form\)/);
  assert.match(html, /input\[type=checkbox\]\[data-qkey\]:checked/);
});

test('🛑 landing3 Phase A: POST /api/request-guide option:3', () => {
  assert.match(html, /fetch\(['"]\/api\/request-guide['"]\s*,\s*\{\s*method:\s*['"]POST['"]/);
  assert.match(html, /option:\s*3/);
});

test('🛑 landing3 Phase A: 成功凍 form「已寄出 ✓」、失敗解凍', () => {
  assert.match(html, /已寄出 ✓/);
  assert.match(html, /querySelectorAll\(['"]input,button['"]\)\.forEach/);
  assert.match(html, /網路好像斷了、再試一次。/);
});

// ─── 開合 toggle 保留、舊 .sel mock toggle 移除 ──────────────────
test('🛑 landing3 Phase A: #openQuiz 開合 toggle 保留', () => {
  assert.match(html, /getElementById\(['"]openQuiz['"]\)/);
  assert.match(html, /quiz\.classList\.toggle\(['"]open['"]\)/);
});

test('🛑 landing3 Phase A: 舊 .opts button .sel mock toggle 已移除', () => {
  assert.doesNotMatch(html, /classList\.add\(['"]sel['"]\)/);
});
