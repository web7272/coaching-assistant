// lib/landing/landing-funnel.test.js
// Patrick 6/26 — Phase C 切 live 後 landing 漏斗鎖測 (landing.html /landing, indexable).
//
// landing3.html 原為純視覺 mock，Phase A 把 landing.html 的漏斗移植進來：
//   • 真表單 <form id="quiz">，3 題用 radio/checkbox + data-qkey 三鍵
//     (性別 / 卡關領域 / 試過的方式)，Q3 為可複選 checkbox。
//   • email input #quizEmail、submit 鈕、訊息列 #quizMsg。
//   • submit handler：validEmail + collectQuiz(含 checkbox) → POST /api/request-guide
//     {email, option:3, answers}；成功凍 form「已寄出 ✓」、失敗解凍。
// //   • 舊「純視覺預覽」mock 字樣已移除。
//
// 跑 raw 檔內容 (landing3 為 inline vanilla DOM、無 build step)。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', '..', 'landing.html'), 'utf8');

// ─── Phase C：noindex 已移除 (頁面可被索引) ───────────────────────
test('🛑 landing Phase C: noindex 已移除 (可被搜尋索引)', () => {
  assert.doesNotMatch(html, /noindex/);
});

// ─── 真表單存在 ───────────────────────────────────────────────────
test('🛑 landing: quiz 是真 <form>，非純視覺 mock', () => {
  assert.match(html, /<form\s+class=["']quiz["']\s+id=["']quiz["']/);
});

test('🛑 landing: 舊「純視覺預覽」mock 字樣已移除', () => {
  assert.doesNotMatch(html, /純視覺預覽/);
});

// ─── 新 3 題 + data-qkey 三鍵 ─────────────────────────────────────
test('🛑 landing: Q1 radio name=q1 data-qkey=性別', () => {
  assert.match(html, /<input\s+type=["']radio["']\s+name=["']q1["']\s+data-qkey=["']性別["']/);
});

test('🛑 landing: Q2 radio name=q2 data-qkey=卡關領域', () => {
  assert.match(html, /<input\s+type=["']radio["']\s+name=["']q2["']\s+data-qkey=["']卡關領域["']/);
});

test('🛑 landing: Q3 為可複選 checkbox name=q3 data-qkey=試過的方式', () => {
  assert.match(html, /<input\s+type=["']checkbox["']\s+name=["']q3["']\s+data-qkey=["']試過的方式["']/);
});

test('🛑 landing: 三鍵齊全 (性別/卡關領域/試過的方式)', () => {
  ['性別', '卡關領域', '試過的方式'].forEach(k => {
    assert.ok(html.includes(`data-qkey="${k}"`), `缺 data-qkey ${k}`);
  });
});

// ─── email / 訊息列 / submit ─────────────────────────────────────
test('🛑 landing: email input #quizEmail', () => {
  assert.match(html, /<input\s+type=["']email["']\s+id=["']quizEmail["']/);
});

test('🛑 landing: 訊息列 #quizMsg aria-live', () => {
  assert.match(html, /id=["']quizMsg["'][^>]*aria-live/);
});

test('🛑 landing: submit 鈕 type=submit', () => {
  assert.match(html, /<button\s+type=["']submit["'][^>]*class=["']btn-primary submit["']/);
});

// ─── submit handler + 漏斗邏輯 ───────────────────────────────────
test('🛑 landing: form submit handler 存在', () => {
  assert.match(html, /quiz\.addEventListener\(\s*['"]submit['"]/);
  assert.match(html, /e\.preventDefault\(\)/);
});

test('🛑 landing: validEmail 移植', () => {
  assert.match(html, /function validEmail\(v\)\{return \/\^\[\^@\\s\]\+@/);
});

test('🛑 landing: collectQuiz 含 checkbox 分支 (Q3 陣列)', () => {
  assert.match(html, /function collectQuiz\(form\)/);
  assert.match(html, /input\[type=checkbox\]\[data-qkey\]:checked/);
});

test('🛑 landing: POST /api/request-guide option:3', () => {
  assert.match(html, /fetch\(['"]\/api\/request-guide['"]\s*,\s*\{\s*method:\s*['"]POST['"]/);
  assert.match(html, /option:\s*3/);
});

test('🛑 landing: 成功凍 form「已寄出 ✓」、失敗解凍', () => {
  assert.match(html, /已寄出 ✓/);
  assert.match(html, /querySelectorAll\(['"]input,button['"]\)\.forEach/);
  assert.match(html, /網路好像斷了、再試一次。/);
});

// ─── 開合 toggle 保留、舊 .sel mock toggle 移除 ──────────────────
test('🛑 landing: #openQuiz 開合 toggle 保留', () => {
  assert.match(html, /getElementById\(['"]openQuiz['"]\)/);
  assert.match(html, /quiz\.classList\.toggle\(['"]open['"]\)/);
});

test('🛑 landing: 舊 .opts button .sel mock toggle 已移除', () => {
  assert.doesNotMatch(html, /classList\.add\(['"]sel['"]\)/);
});

// ─── 全站 logo 統一:landing 內嵌 logo = 官方新 logo (Patrick 6/26) ──────
test('🛑 landing logo: 頂條+頁尾內嵌 logo 都換成官方新 logo (微笑弧 x2)', () => {
  const smiles = (html.match(/M42 58 Q50 54 58 58/g) || []).length;
  assert.equal(smiles, 2, '微笑弧應出現 2 次 (頂條 + 頁尾)');
});

test('🛑 landing logo: 用官方金 #D8B27F、星芒齊 (頂條+頁尾)', () => {
  const sparkles = (html.match(/M82 20 L84\.5 26/g) || []).length;
  assert.equal(sparkles, 2, '星芒應出現 2 次 (頁尾也補上)');
});

test('🛑 landing logo: 舊手刻 logo (cy=60 r=15 / stroke #B58F5C 雙圈) 已清', () => {
  assert.doesNotMatch(html, /cy="60" r="15"/);
  assert.doesNotMatch(html, /<svg[^>]*stroke="#B58F5C"[^>]*><circle/);
});

// ─── Patrick 6/26 — 第一天格子鑲金邊 + 免費 (Vivi) ──────────────
test('🛑 landing 21天總攬: 第一天 (i===0) 鑲金邊 jr-card--free + 免費 badge', () => {
  assert.match(html, /i===0\?' jr-card--free':''/);
  assert.match(html, /i===0\?'<span class="jr-free">免費<\/span>':''/);
  assert.match(html, /\.jr-card--free\{border:1\.5px solid var\(--gold\)/);
  assert.match(html, /\.jr-free\{position:absolute/);
});
