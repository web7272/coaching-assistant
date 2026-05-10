#!/usr/bin/env node
// scripts/run-migration.js
// 通用 migration runner、印 SQL 預覽、Y/N 確認再跑
//
// 用法：npm run migrate -- migration/006_notebook_page.sql
//   或：node scripts/run-migration.js migration/006_notebook_page.sql
// DATABASE_URL 從 process.env 或專案根目錄 .env 讀

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';
import { neon } from '@neondatabase/serverless';

function loadDotenv() {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  const text = readFileSync(envPath, 'utf8');
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/i);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[m[1]]) process.env[m[1]] = val;
  }
}

function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(r => rl.question(question, ans => { rl.close(); r(ans); }));
}

function splitStatements(sqlText) {
  return sqlText
    .split('\n')
    .filter(l => !l.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

async function main() {
  loadDotenv();

  const argPath = process.argv[2];
  if (!argPath) {
    console.error('❌ 請傳 SQL 檔路徑：node scripts/run-migration.js migration/006_xxx.sql');
    process.exit(1);
  }
  const SQL_FILE = resolve(process.cwd(), argPath);
  if (!existsSync(SQL_FILE)) {
    console.error(`❌ 找不到 SQL 檔：${SQL_FILE}`);
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL 沒設、把它放 .env 或從 shell export');
    process.exit(1);
  }

  const sqlText = readFileSync(SQL_FILE, 'utf8');

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`Migration runner — ${argPath}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('SQL 預覽：');
  console.log('───────────────────────────────────────────────────');
  console.log(sqlText);
  console.log('───────────────────────────────────────────────────');
  console.log('');

  const ans = await ask('確認執行？(y/N) ');
  if (ans.trim().toLowerCase() !== 'y') {
    console.log('已取消、沒動到資料庫。');
    process.exit(0);
  }

  const sql = neon(process.env.DATABASE_URL);
  const statements = splitStatements(sqlText);

  console.log('');
  console.log(`執行中…（${statements.length} 個 statement）`);

  for (const stmt of statements) {
    const preview = stmt.slice(0, 80).replace(/\s+/g, ' ');
    console.log(`  → ${preview}${stmt.length > 80 ? '…' : ''}`);
    const rows = await sql(stmt);
    if (Array.isArray(rows) && rows.length > 0) {
      console.log('    ' + JSON.stringify(rows));
    }
  }

  console.log('');
  console.log('✅ 完成。');
}

main().catch(e => {
  console.error('❌ 失敗：', e.message);
  process.exit(1);
});
