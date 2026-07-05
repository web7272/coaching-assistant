// api/storyboard-pdf-data.test.js — Patrick 6/26 (P1 source-gate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, 'storyboard-pdf-data.js'), 'utf8');

test('🛑 pdf-data: 非 GET → 405', () => {
  assert.match(src, /req\.method !== 'GET'[\s\S]{0,60}405/);
});
test('🛑 pdf-data: 重用既有 read 元件 (storyboard/poem/safeNote/profile/guards)', () => {
  assert.match(src, /import \{ buildScStoryboardSteps \} from '\.\/sc-storyboard\.js'/);
  assert.match(src, /import \{ projectPoem21 \}\s*from '\.\/graduation\.js'/);
  assert.match(src, /import \{ safeNoteForStudent \} from '\.\.\/lib\/api\/student-note-safe\.js'/);
  assert.match(src, /import \{ getUserProfile \}\s*from '\.\.\/lib\/state\/state-manager\.js'/);
  assert.match(src, /guardStudentOr401|guardCoachOr401/);
});
test('🛑 pdf-data: Day21 gate — 沒 coachLetter && 沒 declaration → ready:false (不吐內容)', () => {
  assert.match(src, /if \(audience !== 'coach' && !coachLetter && !declaration\)\s*\{\s*\n?\s*return res\.status\(200\)\.json\(\{ ready: false \}\)/);
});
test('🛑 pdf-data: 讀 21 天進度 sc_storyboard_history', () => {
  assert.match(src, /sc_storyboard_history/);
});
test('🛑 pdf-data: 每日卡走 safeNoteForStudent (student-safe)', () => {
  assert.match(src, /safeNoteForStudent\(r\.notebook_page/);
  assert.match(src, /ORDER BY session_date ASC/);
});
test('🛑 pdf-data: 純讀 fail-soft (sub-read try/catch, 不 500)', () => {
  assert.match(src, /students read fail-soft/);
  assert.match(src, /daily cards fail-soft/);
});
test('🛑 pdf-data: 回傳含 ready:true + storyboard/history/graduation/values/dailyCards', () => {
  assert.match(src, /ready: true/);
  for (const k of ['storyboard:', 'history:', 'graduation:', 'values:', 'dailyCards']) {
    assert.ok(src.includes(k), `回傳缺 ${k}`);
  }
});
