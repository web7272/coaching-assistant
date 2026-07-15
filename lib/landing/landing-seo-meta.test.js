// lib/landing/landing-seo-meta.test.js
// Patrick 6/26 — Phase C 後 /landing 可被索引, 補 SEO / 社群分享 meta (Vivi 拍板).
//   • description (Vivi 核可文案).
//   • canonical 自指 https://seeyourself.now/landing.
//   • OG (type/site_name/locale/url/title/description/image).
//   • Twitter (card=summary ∵ logo 為方形; image=logo.png 暫用, 換檔同路徑自動生效).
// Static-analysis (raw 檔內容, landing 為 inline、無 build step).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(__dirname, '..', '..', 'landing.html'), 'utf8');

test('🛑 landing SEO: description meta 存在', () => {
  assert.match(html, /<meta\s+name=["']description["']\s+content=["'][^"']*免費開始 Day 1[^"']*["']>/);
});

test('🛑 landing SEO: canonical 自指 /landing', () => {
  assert.match(html, /<link\s+rel=["']canonical["']\s+href=["']https:\/\/seeyourself\.now\/landing["']>/);
});

test('🛑 landing SEO: OG type/url/title/image 齊', () => {
  assert.match(html, /<meta\s+property=["']og:type["']\s+content=["']website["']>/);
  assert.match(html, /<meta\s+property=["']og:url["']\s+content=["']https:\/\/seeyourself\.now\/landing["']>/);
  assert.match(html, /<meta\s+property=["']og:title["']\s+content=["'][^"']+["']>/);
  assert.match(html, /<meta\s+property=["']og:image["']\s+content=["']https:\/\/seeyourself\.now\/assets\/logo\.png["']>/);
});

test('🛑 landing SEO: twitter card + image', () => {
  assert.match(html, /<meta\s+name=["']twitter:card["']\s+content=["']summary["']>/);
  assert.match(html, /<meta\s+name=["']twitter:image["']\s+content=["']https:\/\/seeyourself\.now\/assets\/logo\.png["']>/);
});

test('🛑 landing SEO: noindex 不可回退 (頁面須維持可索引)', () => {
  assert.doesNotMatch(html, /noindex/);
});
