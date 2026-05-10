#!/usr/bin/env node
// scripts/reset-test-data.js
// 跑 migration/reset_database.sql、TRUNCATE 三張表、清光測試資料
// ⚠️ 不可還原（除非 Neon PITR）、需要打 YES 才會跑
//
// 用法：npm run reset-test-data
// DATABASE_URL 從 process.env 或專案根目錄 .env 讀

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { createInterface } from 'readline';
import { neon } from '@neondatabase/serverless';

const SQL_FILE = resolve(process.cwd(), 'migration/reset_database.sql');

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

  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL 沒設、把它放 .env 或從 shell export');
    process.exit(1);
  }
  if (!existsSync(SQL_FILE)) {
    console.error(`❌ 找不到 SQL 檔：${SQL_FILE}`);
    process.exit(1);
  }

  const sqlText = readFileSync(SQL_FILE, 'utf8');

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('⚠️  RESET TEST DATA — 不可還原！');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('');
  console.log('這個 script 會跑：');
  console.log(`  ${SQL_FILE}`);
  console.log('');
  console.log('效果：TRUNCATE messages, sessions, students RESTART IDENTITY CASCADE');
  console.log('       → 三張表全清光、id 自增重設');
  console.log('       → 不能 undo（除非 Neon PITR）');
  console.log('');

  const ans = await ask('確認要清光、請打 YES（注意大小寫）：');
  if (ans !== 'YES') {
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
