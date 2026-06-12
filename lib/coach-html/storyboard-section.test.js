// lib/coach-html/storyboard-section.test.js
// v5.3 件3 (6/12) — 教練後台 21 天旅程 sync-gate.
//
// Patrick 紅線:
//   ① coach 端 fetch 走 audience=coach&studentId= (走 guardCoachOr401), 絕不
//      用 student cookie 路徑.
//   ② 故事單一來源: coach.html <script type="module"> import 同一份
//      lib/student/storyboard-render.js. 0 第 3 份 inline 複製.
//   ③ 教練端唯讀: 故事全展開 (collapsible: false) + 7 步全展開
//      (expandAllSteps: true). 不複製 student.js 的互動 handler.
//   ④ student 端 storyboard / endpoint / 其他 view 0 動 (sync-gate 不負責驗,
//      由 git diff scope 把關 — 這裡只鎖 coach 端正確接好).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..', '..');
const coachHtml = readFileSync(join(projectRoot, 'coach.html'), 'utf8');
const coachJs   = readFileSync(join(projectRoot, 'coach.js'),   'utf8');

// ═════════════════════════════════════════════════════════
// coach.html — section + heading + module import
// ═════════════════════════════════════════════════════════

test('🛑 coach.html: #coach-storyboard container 在學員詳情頁', () => {
  assert.match(coachHtml, /id="coach-storyboard"/,
    'coach detail view must contain a #coach-storyboard host element');
  // 必須在 view-student section 內 (不能誤放到 view-list).
  const studentView = coachHtml.match(/<section id="coach-view-student"[\s\S]*?<\/section>/);
  assert.ok(studentView, 'view-student section must be locatable');
  assert.match(studentView[0], /id="coach-storyboard"/,
    '#coach-storyboard must live inside #coach-view-student');
});

test('🛑 coach.html: 「這位學員的 21 天旅程」 標題', () => {
  assert.match(coachHtml, /這位學員的\s*21\s*天旅程/,
    '21-day journey section heading must be present');
});

test('🛑 coach.html: <script type="module"> import lib/student/storyboard-render.js (單一來源)', () => {
  // 1. 必須有 type="module" script.
  assert.match(coachHtml, /<script type="module">[\s\S]*?<\/script>/,
    'coach.html must include a <script type="module"> block');
  // 2. 必須 import 同一份 storyboard-render module.
  assert.match(coachHtml, /import\([^)]*['"]\/lib\/student\/storyboard-render\.js['"]\)/,
    'must dynamic-import /lib/student/storyboard-render.js (單一來源)');
  // 3. 必須掛到 window.StoryboardRender (coach.js classic script 讀的 hook).
  assert.match(coachHtml, /window\.StoryboardRender\s*=/,
    'must expose to window.StoryboardRender so coach.js can use it');
  assert.match(coachHtml, /renderStoryboardBodyHTML/,
    'must surface renderStoryboardBodyHTML on window');
});

test('🛑 coach.html: module load fail-soft → window.StoryboardRender = null (不炸 coach.js)', () => {
  // try/catch around the dynamic import.
  assert.match(coachHtml, /try\s*\{[\s\S]*?import\([^)]*storyboard-render\.js[\s\S]*?\}\s*catch/,
    'module import must be wrapped in try/catch for fail-soft');
  assert.match(coachHtml, /window\.StoryboardRender\s*=\s*null/,
    'on catch: set window.StoryboardRender = null so coach.js can detect + skip');
});

// ═════════════════════════════════════════════════════════
// coach.js — fetch contract (audience=coach), render call args
// ═════════════════════════════════════════════════════════

test('🔴 coach.js: fetch /api/sc-storyboard MUST use audience=coach&studentId= (no student cookie path)', () => {
  // 必須有 audience=coach + studentId 在同一個 fetch URL.
  assert.match(coachJs, /\/api\/sc-storyboard\?[^`'"\s]*audience=coach[^`'"\s]*studentId=/,
    'coach.js sc-storyboard fetch must use audience=coach with studentId in querystring');
  // Anti-regression: 不可只傳 module / 不可走 student cookie (沒 audience).
  const fetches = [...coachJs.matchAll(/api\(`\/api\/sc-storyboard[^`]+`/g)].map(m => m[0]);
  assert.ok(fetches.length >= 1, 'coach.js must contain at least 1 sc-storyboard fetch');
  for (const f of fetches) {
    assert.match(f, /audience=coach/,
      `coach.js sc-storyboard fetch MUST include audience=coach (found: ${f})`);
    assert.match(f, /studentId=/,
      `coach.js sc-storyboard fetch MUST include studentId param (found: ${f})`);
  }
});

test('🛑 coach.js: render 傳 collapsible:false + expandAllSteps:true (唯讀審閱)', () => {
  // call site 必須帶 coach 唯讀 opts.
  assert.match(coachJs, /renderStoryboardBodyHTML\([\s\S]{0,400}?collapsible:\s*false/,
    'coach.js must pass collapsible: false to renderStoryboardBodyHTML');
  assert.match(coachJs, /renderStoryboardBodyHTML\([\s\S]{0,400}?expandAllSteps:\s*true/,
    'coach.js must pass expandAllSteps: true to renderStoryboardBodyHTML');
});

test('🛑 coach.js: render 走 window.StoryboardRender (不開第 3 份 inline 故事複製)', () => {
  // 必須透過 window.StoryboardRender 呼叫 — coach.js 自己不持有故事.
  assert.match(coachJs, /window\.StoryboardRender[\s\S]{0,80}?renderStoryboardBodyHTML/,
    'coach.js must call window.StoryboardRender.renderStoryboardBodyHTML');
  // 鐵則: coach.js 內絕不可出現 verbatim 故事文字 (否則就是第 3 份複製, 會分歧).
  // 抽取 opening + closing line 各驗.
  assert.equal(/你一直覺得，現在的自己，好像不是全部的自己/.test(coachJs), false,
    '🔴 coach.js MUST NOT inline the verbatim story opening (single-source rule)');
  assert.equal(/你就是你的渴望/.test(coachJs), false,
    '🔴 coach.js MUST NOT inline the verbatim story closing (single-source rule)');
  assert.equal(/限制性信念|追求外在認可/.test(coachJs), false,
    '🔴 coach.js MUST NOT inline verbatim villain markers');
});

test('🛑 coach.js: window.StoryboardRender 缺失時 fail-soft (不炸詳情頁)', () => {
  // 必須先檢查 window.StoryboardRender 存在.
  assert.match(coachJs, /window\.StoryboardRender[\s\S]{0,200}?(renderStoryboardBodyHTML|\?\.|&&)/,
    'coach.js must guard on window.StoryboardRender before calling its method');
});
