// lib/student/identity-card-name.test.js
// Patrick 6/26 — 學員端每日卡更名「教練筆記」→「身分解析卡」(Vivi).
//   • 對齊 landing / auth 早已用的新名「身分解析卡」。
//   • 「教練」角色/語氣保留(署名「— 教練」不動)。
//   • 後端生成 prompt 的「教練筆記」與 coach 後台「後端教練筆記」不在此範圍。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', '..', 'index.html'), 'utf8');

const noteSec = html.slice(html.indexOf('id="view-note"'), html.indexOf('id="view-phase-report"'));

test('🛑 身分解析卡: view-note eyebrow = 身分解析卡', () => {
  assert.match(noteSec, /paper-card__eyebrow">身分解析卡</);
});
test('🛑 身分解析卡: view-note aria-label = 身分解析卡', () => {
  assert.match(html, /id="view-note"[^>]*aria-label="身分解析卡"/);
});
test('🛑 身分解析卡: view-note 不再出現「教練筆記」', () => {
  assert.doesNotMatch(noteSec, /教練筆記/);
});
test('🛑 身分解析卡: 「教練」角色保留 — 卡署名仍「— 教練」', () => {
  assert.match(noteSec, /paper-card__sig">— 教練</);
});
