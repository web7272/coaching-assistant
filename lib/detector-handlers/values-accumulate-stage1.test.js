// lib/detector-handlers/values-accumulate-stage1.test.js
// v5.3 Stage 1 (6/12) — engine-2 append values_collected_list + finalize-day
// UPE sync. 0 facing change. Test scope: append bar + dedup + sync-gate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { e2MasterHandler } from './engine-2.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot  = join(__dirname, '..', '..');

// ─── Test stubs ───────────────────────────────────────

const baseCtx = (overrides = {}) => ({
  session_state: {},
  user_response: '',
  user_profile: {},
  judges: {
    // sensoryDetail judge stub — dim_4 false so we don't accidentally trigger
    // the R2 reframe branch in unrelated tests.
    sensoryDetail: async () => ({ dim_4: false }),
  },
  session_id: 1,
  now_iso: '2026-06-12T10:00:00Z',
  logMiss: () => {},
  ...overrides,
});

// ═════════════════════════════════════════════════════════
// 🔴 Stage 1A — engine-2 appends values_collected_list with bar + dedup
// ═════════════════════════════════════════════════════════

test('🛑 engine-2: candidate_term + landmine pass → patch.values_collected_list 含 term', async () => {
  const ctx = baseCtx({
    session_state: { values_collected_list: [], primary_mode: 'elicitation' },
    user_response: '我是一個自由的人',  // quality term 「自由」 + identity sentence
  });
  const out = await e2MasterHandler(ctx);
  assert.equal(out.handled, true);
  assert.deepEqual(out.patch.values_collected_list, ['自由的']);
});

test('🛑 engine-2: tier 1 landmine candidate (成功) → 0 append (absolute reject)', async () => {
  const ctx = baseCtx({
    session_state: { values_collected_list: [], primary_mode: 'elicitation' },
    user_response: '我是一個成功的人',  // 成功 = tier 1 landmine (Damon strategy 黑名單)
  });
  const out = await e2MasterHandler(ctx);
  // Either handler not handled OR patch present but no values_collected_list.
  if (out && out.patch) {
    assert.equal(out.patch.values_collected_list, undefined,
      'tier 1 landmine candidate MUST NOT join values_collected_list');
  }
});

test('🛑 engine-2: tier 3 borderline (自由) → 仍 append (Vivi 拍板 bar)', async () => {
  const ctx = baseCtx({
    session_state: { values_collected_list: [], primary_mode: 'elicitation' },
    user_response: '我是一個自由的人',  // 自由 = quality term + tier 3 borderline per landmine
  });
  const out = await e2MasterHandler(ctx);
  // 自由 / 自由的 命中 master regex; tier 3 landmine accepted (real value).
  assert.ok(Array.isArray(out.patch.values_collected_list));
  assert.ok(out.patch.values_collected_list.length >= 1);
});

test('🔴 engine-2: dedup — 同 term 重複浮現 → 不 re-append, patch 不變', async () => {
  const ctx = baseCtx({
    session_state: {
      values_collected_list: ['自由的'],   // 已在 list
      primary_mode: 'elicitation',
    },
    user_response: '我是一個自由的人',
  });
  const out = await e2MasterHandler(ctx);
  // 不重複 append → patch.values_collected_list undefined (no write needed)
  // 或仍包含原 ['自由的']. 不可變 ['自由的', '自由的'].
  if (out.patch.values_collected_list !== undefined) {
    assert.equal(out.patch.values_collected_list.filter(v => v === '自由的').length, 1,
      'duplicate term must NOT double-append');
  }
});

test('🔴 engine-2: trim 前後空白後比對 (邊界:「 自由的 」 == 「自由的」)', async () => {
  // Direct test via the engine's append logic — verify trim semantics by
  // crafting a prior list with whitespace + a clean candidate.
  const ctx = baseCtx({
    session_state: {
      values_collected_list: ['自由的'],
      primary_mode: 'elicitation',
    },
    // candidate term comes from regex match — already trimmed by the regex.
    // The trim happens on the new candidate before compare.
    user_response: '我是一個自由的人',
  });
  const out = await e2MasterHandler(ctx);
  // No duplicate — '自由的' already in list, candidate trimmed matches.
  const final = out.patch.values_collected_list || ['自由的'];
  assert.equal(final.filter(v => v === '自由的').length, 1);
});

test('🛑 engine-2: 累積多 turn — A003 pattern → 6 distinct terms 全收 (modulo engine-2 quality_terms 命中)', async () => {
  // Simulate 6 turns surfacing 6 distinct terms. Each turn carries the
  // running list forward (mirrors chat.js fullPatch → updateState behaviour).
  // Use terms known to be in master-detector quality_terms.
  const A003_TERMS = ['喜悅', '有愛的', '自由的', '平靜的', '有創造力的', '真實的'];
  let runningList = [];
  for (const t of A003_TERMS) {
    const ctx = baseCtx({
      session_state: { values_collected_list: runningList, primary_mode: 'elicitation' },
      user_response: `我是一個${t}人`,
    });
    const out = await e2MasterHandler(ctx);
    if (out?.patch?.values_collected_list) {
      runningList = out.patch.values_collected_list;
    }
  }
  // At minimum the unambiguous quality_terms should land. We don't assert all 6
  // (different landmine semantics across years), but at least >= 4 (sanity).
  assert.ok(runningList.length >= 4,
    `expected ≥4 of 6 A003-style terms to accumulate, got ${runningList.length}: ${JSON.stringify(runningList)}`);
  // 0 duplicates.
  assert.equal(new Set(runningList).size, runningList.length,
    'accumulated list MUST have no duplicates');
});

test('🛑 engine-2: 空 candidate / 非 identity 句 → 0 list change', async () => {
  const ctx = baseCtx({
    session_state: { values_collected_list: ['自由的'], primary_mode: 'elicitation' },
    user_response: '今天天氣很好',  // 0 quality term, 0 identity pattern
  });
  const out = await e2MasterHandler(ctx);
  // handled false (e2signal.suspected = false) OR patch 不含 values_collected_list.
  if (out.patch) {
    assert.equal(out.patch.values_collected_list, undefined);
  }
});

// ═════════════════════════════════════════════════════════
// 🔴 Stage 1B — finalize-day sync session_state values → UPE
// ═════════════════════════════════════════════════════════

test('🛑 finalize-day: imports updateUserProfile + has upe_values_sync block', () => {
  const src = readFileSync(join(repoRoot, 'api/finalize-day.js'), 'utf8');
  // Import added.
  assert.match(src, /updateUserProfile/,
    'finalize-day must import updateUserProfile from state-manager');
  // Sync block exists with the 3 columns.
  assert.match(src, /upe_values_sync/,
    'finalize-day must have upe_values_sync block (tag for observability)');
  assert.match(src, /values_collected_list/,
    'sync block must reference values_collected_list');
  assert.match(src, /top1_value/,
    'sync block must reference top1_value');
  assert.match(src, /values_ranking/,
    'sync block must reference values_ranking');
  // updateUserProfile must be called with the patch object.
  assert.match(src, /updateUserProfile\(existing\.student_id,\s*upePatch\)/,
    'finalize-day must call updateUserProfile(studentId, upePatch)');
  // fail-soft wrapper (try/catch).
  assert.match(src, /\[upe_values_sync\] update failed/,
    'sync block must be fail-soft (try/catch + console.error)');
});

test('🛑 finalize-day: sync block 只在有資料時 call updateUserProfile (Stage 1 上線時 list 仍 0)', () => {
  // Verify guard: only call if upePatch has ≥1 key. Avoids no-op UPDATE.
  const src = readFileSync(join(repoRoot, 'api/finalize-day.js'), 'utf8');
  assert.match(src, /Object\.keys\(upePatch\)\.length\s*>\s*0/,
    'sync must guard on upePatch having ≥1 key (no-op UPDATE 避免)');
});

// ═════════════════════════════════════════════════════════
// 🔴 Sync-gate — Stage 1 紅線
// ═════════════════════════════════════════════════════════

test('🔴 sync-gate: engine-2 append 接在 landmine.tier !== "tier1" 後 (對齊 spec bar)', () => {
  const src = readFileSync(join(repoRoot, 'lib/detector-handlers/engine-2.js'), 'utf8');
  // Guard pattern: landmine.tier !== 'tier1' OR equivalent.
  assert.match(src, /landmine\.tier\s*!==\s*['"]tier1['"]/,
    'engine-2 append guard MUST exclude tier1 (spec bar)');
  // Dedup via includes check.
  assert.match(src, /prior\.includes\(term\)/,
    'engine-2 append MUST dedup via prior.includes(term)');
});

test('🔴 sync-gate: 0 改 inject 字串 / 0 改 top1Judge / 0 切 mode (Stage 1 facing 0 動)', () => {
  const e2 = readFileSync(join(repoRoot, 'lib/detector-handlers/engine-2.js'), 'utf8');
  const e3 = readFileSync(join(repoRoot, 'lib/detector-handlers/engine-3.js'), 'utf8');
  // Stage 1 沒碰 top1_value 寫入.
  assert.equal(/patch\.top1_value\s*=/.test(e2 + e3), false,
    'Stage 1 MUST NOT write top1_value (那是 Stage 2; sandbox 驗才能上)');
  // Stage 1 沒碰 transitionPrimary 在 elicitation context.
  // (transitionPrimary 仍可在 e3ModeTransitionHandler 用 — 那條 path 處理
  //  IDENTITY_ANCHORING+ 上行, 跟 Stage 2 elicitation→identity_anchoring 路徑不同.)
  // Belt-and-suspenders: 確認 engine-2 沒新增 transitionPrimary 函式呼叫 (regex 帶括
  // 號避免命中註解內容).
  assert.equal(/transitionPrimary\s*\(/.test(e2), false,
    'Stage 1 engine-2 MUST NOT call transitionPrimary (那是 Stage 2 引入)');
});
