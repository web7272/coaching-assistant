// lib/student/story-pdf-entry.test.js — Patrick 6/26 (P3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..', '..');
const indexHtml  = readFileSync(join(root, 'index.html'), 'utf8');
const studentSrc = readFileSync(join(root, 'student.js'), 'utf8');
const coachHtml  = readFileSync(join(root, 'coach.html'), 'utf8');
const coachSrc   = readFileSync(join(root, 'coach.js'), 'utf8');

test('🛑 P3: view-storyboard 有「下載 PDF」入口 → #/story-pdf, 預設 hidden', () => {
  const sec = indexHtml.slice(indexHtml.indexOf('id="view-storyboard"'), indexHtml.indexOf('id="view-story-pdf"'));
  assert.match(sec, /id="storyboard-pdf-link"[^>]*href="#\/story-pdf"[^>]*hidden|id="storyboard-pdf-link"[^>]*hidden[^>]*href="#\/story-pdf"|href="#\/story-pdf"[^>]*hidden/);
  assert.match(sec, /下載 PDF/);
});

test('🛑 P3: renderStoryboard 用 /api/graduation gate 入口 (結業才顯示, fail-soft)', () => {
  assert.match(studentSrc, /getElementById\('storyboard-pdf-link'\)/);
  assert.match(studentSrc, /fetch\('\/api\/graduation\?module=self'/);
  assert.match(studentSrc, /g\.exists\)\s*pdfLink\.hidden = false/);
  assert.match(studentSrc, /pdfLink\.hidden = true/);
});

test('🛑 P4: coach.html 有 PDF 檢視區 + 列印鈕 + expose renderStoryPdfHTML', () => {
  assert.match(coachHtml, /id="coach-story-pdf"/);
  assert.match(coachHtml, /id="coach-pdf-print"/);
  assert.match(coachHtml, /renderStoryPdfHTML: mod\.renderStoryPdfHTML/);
});

test('🛑 P4: coach.js fetch pdf-data(audience=coach) → renderStoryPdfHTML', () => {
  assert.match(coachSrc, /storyboard-pdf-data\?audience=coach/);
  assert.match(coachSrc, /StoryboardRender\.renderStoryPdfHTML/);
});
